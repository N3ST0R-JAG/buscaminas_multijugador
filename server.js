const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const MAX_PLAYERS = 5;
const BOARD_WIDTH = 16;
const BOARD_HEIGHT = 16;
const MINE_COUNT = 40;
const COUNTDOWN_SECONDS = 5;
const POWERUP_TYPES = {
  autoReveal: 'autoReveal',
};
const POWERUPS_PER_BOARD = 3;

const rooms = {};
const players = {};

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 5; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

function getRoomPlayerList(roomCode) {
  const room = rooms[roomCode];
  if (!room) return [];
  return room.playerIds.map((id) => ({
    id,
    name: players[id].name,
    status: players[id].status,
    revealedCount: players[id].revealedCount,
    flagCount: players[id].flagCount,
    mineCount: MINE_COUNT,
    hasAutoReveal: Boolean(players[id].powerups && players[id].powerups.autoReveal),
    isHost: id === room.host,
  }));
}

function broadcastRoomPlayers(roomCode) {
  io.to(roomCode).emit('playerList', getRoomPlayerList(roomCode));
}

function createEmptyBoard() {
  return Array.from({ length: BOARD_HEIGHT }, () =>
    Array.from({ length: BOARD_WIDTH }, () => ({
      mine: false,
      revealed: false,
      flagged: false,
      adjacentMines: 0,
      powerup: null,
    }))
  );
}

function placeMines(board, firstClickRow, firstClickCol) {
  let placed = 0;
  while (placed < MINE_COUNT) {
    const r = Math.floor(Math.random() * BOARD_HEIGHT);
    const c = Math.floor(Math.random() * BOARD_WIDTH);
    if (board[r][c].mine) continue;
    const isSafeZone =
      Math.abs(r - firstClickRow) <= 1 && Math.abs(c - firstClickCol) <= 1;
    if (isSafeZone) continue;
    board[r][c].mine = true;
    placed++;
  }
  for (let r = 0; r < BOARD_HEIGHT; r++) {
    for (let c = 0; c < BOARD_WIDTH; c++) {
      if (board[r][c].mine) continue;
      let count = 0;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const nr = r + dr;
          const nc = c + dc;
          if (nr >= 0 && nr < BOARD_HEIGHT && nc >= 0 && nc < BOARD_WIDTH && board[nr][nc].mine) {
            count++;
          }
        }
      }
      board[r][c].adjacentMines = count;
    }
  }
}

function placePowerUps(board) {
  let placed = 0;
  let attempts = 0;
  while (placed < POWERUPS_PER_BOARD && attempts < 500) {
    attempts++;
    const r = Math.floor(Math.random() * BOARD_HEIGHT);
    const c = Math.floor(Math.random() * BOARD_WIDTH);
    const cell = board[r][c];
    if (cell.mine || cell.powerup) continue;
    cell.powerup = POWERUP_TYPES.autoReveal;
    placed++;
  }
}

function revealCell(board, r, c) {
  if (r < 0 || r >= BOARD_HEIGHT || c < 0 || c >= BOARD_WIDTH) return [];
  if (board[r][c].revealed || board[r][c].flagged) return [];
  board[r][c].revealed = true;
  const revealed = [{ r, c, adjacentMines: board[r][c].adjacentMines, mine: board[r][c].mine, powerup: board[r][c].powerup || null }];
  if (board[r][c].adjacentMines === 0 && !board[r][c].mine) {
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        revealed.push(...revealCell(board, r + dr, c + dc));
      }
    }
  }
  return revealed;
}

function checkWin(board) {
  for (let r = 0; r < BOARD_HEIGHT; r++) {
    for (let c = 0; c < BOARD_WIDTH; c++) {
      if (!board[r][c].mine && !board[r][c].revealed) return false;
    }
  }
  return true;
}

function getPublicBoard(board, status) {
  return board.map((row, r) =>
    row.map((cell, c) => {
      if (status === 'lost') {
        return { revealed: true, mine: cell.mine, flagged: cell.flagged, adjacentMines: cell.adjacentMines, powerup: cell.powerup || null };
      }
      if (cell.revealed) {
        return { revealed: true, mine: cell.mine, flagged: false, adjacentMines: cell.adjacentMines, powerup: cell.powerup || null };
      }
      return { revealed: false, mine: false, flagged: cell.flagged, adjacentMines: 0 };
    })
  );
}

function getCorrectFlagCount(board) {
  if (!board) return 0;
  let count = 0;
  for (let r = 0; r < BOARD_HEIGHT; r++) {
    for (let c = 0; c < BOARD_WIDTH; c++) {
      if (board[r][c].mine && board[r][c].flagged) count++;
    }
  }
  return count;
}

function buildLeaderboard(room, winnerId) {
  return room.playerIds
    .map((id) => {
      const player = players[id];
      const correctFlags = getCorrectFlagCount(player.board);
      const revealedPoints = player.revealedCount;
      const flagPoints = correctFlags * 2;
      return {
        id,
        name: player.name,
        status: player.status,
        revealedCount: player.revealedCount,
        correctFlags,
        revealedPoints,
        flagPoints,
        score: revealedPoints + flagPoints,
        isWinner: id === winnerId,
      };
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.revealedCount !== a.revealedCount) return b.revealedCount - a.revealedCount;
      if (b.correctFlags !== a.correctFlags) return b.correctFlags - a.correctFlags;
      return a.name.localeCompare(b.name);
    })
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
}

function getScoreWinnerId(room) {
  const leaderboard = buildLeaderboard(room, null);
  return leaderboard[0] ? leaderboard[0].id : null;
}

function finishGame(roomCode, winnerId, reason) {
  const room = rooms[roomCode];
  if (!room || room.status !== 'playing') return;

  if (!winnerId) {
    winnerId = getScoreWinnerId(room);
  }

  const winner = players[winnerId];
  if (!winner) return;

  room.status = 'finished';
  room.winnerId = winnerId;
  room.finishedReason = reason;

  room.playerIds.forEach((id) => {
    const player = players[id];
    if (!player || !player.board) return;
    if (id === winnerId) {
      player.status = reason === 'allLost' && player.status === 'lost' ? 'lost' : 'won';
    } else if (player.status === 'playing') {
      player.status = 'finished';
    }
    io.to(roomCode).emit('boardUpdate', {
      playerId: id,
      playerName: player.name,
      board: getPublicBoard(player.board, player.status),
      status: player.status,
      revealedCount: player.revealedCount,
      flagCount: player.flagCount,
    });
  });

  broadcastRoomPlayers(roomCode);
  io.to(roomCode).emit('gameOver', {
    winnerId,
    winnerName: winner.name,
    reason,
    leaderboard: buildLeaderboard(room, winnerId),
  });
}

function finishIfOnlyOneAlive(roomCode) {
  const room = rooms[roomCode];
  if (!room || room.status !== 'playing') return;

  const aliveIds = room.playerIds.filter((id) => players[id] && players[id].status === 'playing');
  if (aliveIds.length > 1) return;

  if (aliveIds.length === 0) {
    finishGame(roomCode, getScoreWinnerId(room), 'allLost');
    return;
  }

  const winner = players[aliveIds[0]];
  winner.status = 'won';
  io.to(roomCode).emit('gameEvent', {
    playerId: aliveIds[0],
    playerName: winner.name,
    event: 'won',
  });
  finishGame(roomCode, aliveIds[0], 'lastAlive');
}

function grantPowerUps(player, revealedCells) {
  const gained = [];
  revealedCells.forEach((cellData) => {
    const type = cellData.powerup;
    if (!type) return;
    player.powerups[type] = (player.powerups[type] || 0) + 1;
    if (!gained.includes(type)) gained.push(type);
  });
  return gained;
}

function emitPowerUpGained(socket, types) {
  if (!types || types.length === 0) return;
  socket.emit('powerUpGained', { powerups: types });
}

function handleExplosion(socket, roomCode, player) {
  player.status = 'lost';
  io.to(roomCode).emit('boardUpdate', {
    playerId: socket.id,
    playerName: player.name,
    board: getPublicBoard(player.board, 'lost'),
    status: 'lost',
    revealedCount: player.revealedCount,
    flagCount: player.flagCount,
  });
  io.to(roomCode).emit('gameEvent', {
    playerId: socket.id,
    playerName: player.name,
    event: 'lost',
  });
  broadcastRoomPlayers(roomCode);
  finishIfOnlyOneAlive(roomCode);
}

function handleSafeReveal(socket, roomCode, player, revealedCells) {
  player.revealedCount += revealedCells.length;
  if (checkWin(player.board)) {
    player.status = 'won';
    io.to(roomCode).emit('gameEvent', {
      playerId: socket.id,
      playerName: player.name,
      event: 'won',
    });
  }
  io.to(roomCode).emit('boardUpdate', {
    playerId: socket.id,
    playerName: player.name,
    board: getPublicBoard(player.board, player.status),
    status: player.status,
    revealedCount: player.revealedCount,
    flagCount: player.flagCount,
  });
  broadcastRoomPlayers(roomCode);
  if (player.status === 'won') {
    finishGame(roomCode, socket.id, 'completed');
  }
}

io.on('connection', (socket) => {
  console.log(`Conectado: ${socket.id}`);

  socket.on('join', (name, callback) => {
    if (players[socket.id]) {
      return callback({ error: 'Ya estas en el servidor' });
    }
    for (const id in players) {
      if (players[id].name === name) {
        return callback({ error: 'Nombre ya en uso' });
      }
    }

    players[socket.id] = {
      name,
      room: null,
      board: null,
      status: 'waiting',
      minesPlaced: false,
      revealedCount: 0,
      flagCount: 0,
      powerups: {},
    };

    callback({ success: true, playerId: socket.id });
  });

  socket.on('createRoom', (callback) => {
    const player = players[socket.id];
    if (!player) return callback({ error: 'No estas registrado' });
    if (player.room) return callback({ error: 'Ya estas en una sala' });

    let roomCode;
    do {
      roomCode = generateRoomCode();
    } while (rooms[roomCode]);

    rooms[roomCode] = {
      host: socket.id,
      playerIds: [socket.id],
      status: 'waiting',
      countdownTimer: null,
      countdownValue: 0,
      winnerId: null,
      finishedReason: null,
    };

    player.room = roomCode;
    socket.join(roomCode);

    callback({ success: true, roomCode });
    broadcastRoomPlayers(roomCode);
  });

  socket.on('joinRoom', (roomCode, callback) => {
    const player = players[socket.id];
    if (!player) return callback({ error: 'No estas registrado' });
    if (player.room) return callback({ error: 'Ya estas en una sala' });

    roomCode = roomCode.toUpperCase().trim();
    const room = rooms[roomCode];

    if (!room) return callback({ error: 'Sala no encontrada' });
    if (room.status !== 'waiting') return callback({ error: 'La sala ya empezo' });
    if (room.playerIds.length >= MAX_PLAYERS) return callback({ error: 'Sala llena (max 5 jugadores)' });

    room.playerIds.push(socket.id);
    player.room = roomCode;
    socket.join(roomCode);

    callback({ success: true, roomCode });
    broadcastRoomPlayers(roomCode);
    io.to(roomCode).emit('gameEvent', {
      playerName: player.name,
      event: 'join',
    });
  });

  socket.on('startGame', (callback) => {
    const player = players[socket.id];
    if (!player || !player.room) return callback({ error: 'No estas en una sala' });

    const roomCode = player.room;
    const room = rooms[roomCode];
    if (!room) return callback({ error: 'Sala no encontrada' });
    if (room.host !== socket.id) return callback({ error: 'Solo el host puede iniciar' });
    if (room.playerIds.length < 2) return callback({ error: 'Necesitas al menos 2 jugadores' });
    if (room.status !== 'waiting') return callback({ error: 'El juego ya inicio' });

    room.status = 'countdown';
    room.countdownValue = COUNTDOWN_SECONDS;

    io.to(roomCode).emit('countdown', { seconds: room.countdownValue });

    room.countdownTimer = setInterval(() => {
      room.countdownValue--;
      if (room.countdownValue <= 0) {
        clearInterval(room.countdownTimer);
        room.countdownTimer = null;
        room.status = 'playing';
        room.winnerId = null;
        room.finishedReason = null;

        room.playerIds.forEach((id) => {
          const p = players[id];
          p.board = createEmptyBoard();
          p.status = 'playing';
          p.minesPlaced = false;
          p.revealedCount = 0;
          p.flagCount = 0;
          p.powerups = {};
        });

        io.to(roomCode).emit('gameStarted', {
          boardWidth: BOARD_WIDTH,
          boardHeight: BOARD_HEIGHT,
          mineCount: MINE_COUNT,
        });

        broadcastRoomPlayers(roomCode);
      } else {
        io.to(roomCode).emit('countdown', { seconds: room.countdownValue });
      }
    }, 1000);

    callback({ success: true });
  });

  socket.on('reveal', ({ row, col }) => {
    const player = players[socket.id];
    if (!player || !player.room || !player.board) return;
    const roomCode = player.room;
    const room = rooms[roomCode];
    if (!room || room.status !== 'playing') return;
    if (player.status === 'lost' || player.status === 'won' || player.status === 'finished') return;
    if (row < 0 || row >= BOARD_HEIGHT || col < 0 || col >= BOARD_WIDTH) return;
    if (player.board[row][col].revealed || player.board[row][col].flagged) return;

    if (!player.minesPlaced) {
      placeMines(player.board, row, col);
      placePowerUps(player.board);
      player.minesPlaced = true;
    }

    const revealedCells = revealCell(player.board, row, col);
    const gainedPowerUps = grantPowerUps(player, revealedCells);

    if (player.board[row][col].mine) {
      handleExplosion(socket, roomCode, player);
      return;
    }

    handleSafeReveal(socket, roomCode, player, revealedCells);
    emitPowerUpGained(socket, gainedPowerUps);
  });

  socket.on('chordReveal', ({ row, col }) => {
    const player = players[socket.id];
    if (!player || !player.room || !player.board) return;
    const roomCode = player.room;
    const room = rooms[roomCode];
    if (!room || room.status !== 'playing') return;
    if (player.status === 'lost' || player.status === 'won' || player.status === 'finished') return;
    if (!player.powerups || !player.powerups.autoReveal) return;
    if (typeof row !== 'number' || typeof col !== 'number') return;
    if (row < 0 || row >= BOARD_HEIGHT || col < 0 || col >= BOARD_WIDTH) return;

    const origin = player.board[row][col];
    if (!origin.revealed || origin.adjacentMines === 0) return;

    const targets = [];
    let adjacentFlags = 0;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const nr = row + dr;
        const nc = col + dc;
        if (nr < 0 || nr >= BOARD_HEIGHT || nc < 0 || nc >= BOARD_WIDTH) continue;
        const neighbor = player.board[nr][nc];
        if (neighbor.flagged) adjacentFlags++;
        else if (!neighbor.revealed) targets.push([nr, nc]);
      }
    }

    if (adjacentFlags !== origin.adjacentMines || targets.length === 0) return;

    const mineTarget = targets.find(([nr, nc]) => player.board[nr][nc].mine);
    if (mineTarget) {
      player.board[mineTarget[0]][mineTarget[1]].revealed = true;
      handleExplosion(socket, roomCode, player);
      return;
    }

    const revealedCells = [];
    targets.forEach(([nr, nc]) => {
      revealedCells.push(...revealCell(player.board, nr, nc));
    });

    const gainedPowerUps = grantPowerUps(player, revealedCells);
    handleSafeReveal(socket, roomCode, player, revealedCells);
    emitPowerUpGained(socket, gainedPowerUps);
  });

  socket.on('flag', ({ row, col }) => {
    const player = players[socket.id];
    if (!player || !player.room || !player.board) return;
    const room = rooms[player.room];
    if (!room || room.status !== 'playing') return;
    if (player.status === 'lost' || player.status === 'won' || player.status === 'finished') return;
    if (row < 0 || row >= BOARD_HEIGHT || col < 0 || col >= BOARD_WIDTH) return;
    if (player.board[row][col].revealed) return;
    if (!player.minesPlaced) return;

    player.board[row][col].flagged = !player.board[row][col].flagged;
    player.flagCount += player.board[row][col].flagged ? 1 : -1;

    const publicBoard = getPublicBoard(player.board, player.status);
    io.to(player.room).emit('boardUpdate', {
      playerId: socket.id,
      playerName: player.name,
      board: publicBoard,
      status: player.status,
      revealedCount: player.revealedCount,
      flagCount: player.flagCount,
    });

    broadcastRoomPlayers(player.room);
  });

  socket.on('resetGame', () => {
    const player = players[socket.id];
    if (!player || !player.room) return;

    const room = rooms[player.room];
    if (!room) return;
    if (room.host !== socket.id) return;

    if (room.countdownTimer) {
      clearInterval(room.countdownTimer);
      room.countdownTimer = null;
    }

    room.status = 'waiting';
    room.winnerId = null;
    room.finishedReason = null;
    room.playerIds.forEach((id) => {
      const p = players[id];
      p.board = null;
      p.status = 'waiting';
      p.minesPlaced = false;
      p.revealedCount = 0;
      p.flagCount = 0;
      p.powerups = {};
    });

    io.to(player.room).emit('boardReset');
    io.to(player.room).emit('gameReset');
    broadcastRoomPlayers(player.room);
  });

  socket.on('leaveRoom', () => {
    handleLeaveRoom(socket);
  });

  socket.on('disconnect', () => {
    console.log(`Desconectado: ${socket.id}`);
    handleLeaveRoom(socket);
    delete players[socket.id];
  });

  function handleLeaveRoom(sock) {
    const player = players[sock.id];
    if (!player || !player.room) return;

    const roomCode = player.room;
    const room = rooms[roomCode];
    if (!room) return;

    if (room.countdownTimer) {
      clearInterval(room.countdownTimer);
      room.countdownTimer = null;
    }

    room.playerIds = room.playerIds.filter((id) => id !== sock.id);
    sock.leave(roomCode);

    const leavingName = player.name;
    player.room = null;
    player.board = null;
    player.status = 'waiting';
    player.minesPlaced = false;
    player.revealedCount = 0;
    player.flagCount = 0;
    player.powerups = {};

    io.to(roomCode).emit('gameEvent', {
      playerName: leavingName,
      event: 'leave',
    });

    if (room.playerIds.length === 0) {
      delete rooms[roomCode];
      return;
    }

    if (room.host === sock.id) {
      room.host = room.playerIds[0];
      io.to(roomCode).emit('newHost', { hostId: room.host, hostName: players[room.host].name });
    }

    if (room.status === 'playing') {
      finishIfOnlyOneAlive(roomCode);
      if (room.status === 'finished') return;
    }

    if (room.status === 'playing' || room.status === 'countdown') {
      const anyPlaying = room.playerIds.some((id) => players[id].status === 'playing');
      if (!anyPlaying || room.playerIds.length < 2) {
        if (room.countdownTimer) {
          clearInterval(room.countdownTimer);
          room.countdownTimer = null;
        }
        room.status = 'waiting';
        room.playerIds.forEach((id) => {
          const p = players[id];
          p.board = null;
          p.status = 'waiting';
          p.minesPlaced = false;
          p.revealedCount = 0;
          p.flagCount = 0;
          p.powerups = {};
        });
        io.to(roomCode).emit('boardReset');
        io.to(roomCode).emit('gameReset');
      }
    }

    broadcastRoomPlayers(roomCode);
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
