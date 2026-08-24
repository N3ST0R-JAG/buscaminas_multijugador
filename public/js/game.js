const socket = io();

let myPlayerId = null;
let myRoomCode = null;
let isHost = false;
let boardWidth = 16;
let boardHeight = 16;
let mineCount = 40;
let myBoard = [];
let allPlayerData = {};
let spectatingPlayers = {};
let flagMode = false;
let longPressTimer = null;
let isMobile = false;
let focusedSpectatorId = null;
let gameFinished = false;
let myPowerups = { autoReveal: false };
let lastTapInfo = { cellKey: null, time: 0 };
let autoRevealExpiresAt = 0;
let powerupTimerInterval = null;

const POWERUP_LABELS = { autoReveal: 'Revelado Automatico' };
const POWERUP_DURATION_MS = 30000;

const loginScreen = document.getElementById('login-screen');
const lobbyScreen = document.getElementById('lobby-screen');
const waitingScreen = document.getElementById('waiting-screen');
const gameScreen = document.getElementById('game-screen');

const nameInput = document.getElementById('name-input');
const joinBtn = document.getElementById('join-btn');
const loginError = document.getElementById('login-error');

const lobbyWelcome = document.getElementById('lobby-welcome');
const createRoomBtn = document.getElementById('create-room-btn');
const roomCodeInput = document.getElementById('room-code-input');
const joinRoomBtn = document.getElementById('join-room-btn');
const lobbyError = document.getElementById('lobby-error');

const roomCodeDisplay = document.getElementById('room-code-display');
const waitingPlayers = document.getElementById('waiting-players');
const startGameBtn = document.getElementById('start-game-btn');
const waitingHint2 = document.getElementById('waiting-hint2');
const leaveRoomBtn = document.getElementById('leave-room-btn');
const countdownOverlay = document.getElementById('countdown-overlay');
const countdownNumber = document.getElementById('countdown-number');

const boardEl = document.getElementById('board');
const boardLabel = document.getElementById('board-label');
const spectatorBoards = document.getElementById('spectator-boards');
const playerListEl = document.getElementById('player-list');
const headerPlayersEl = document.getElementById('header-players');
const mineCountEl = document.getElementById('mine-count');
const flagCountEl = document.getElementById('flag-count');
const revealedCountEl = document.getElementById('revealed-count');
const myStatusEl = document.getElementById('my-status');
const myNameEl = document.getElementById('my-name');
const resetBtn = document.getElementById('reset-btn');
const logContent = document.getElementById('log-content');
const flagToggle = document.getElementById('flag-toggle');
const flagToggleContainer = document.getElementById('flag-toggle-container');
const sidebar = document.getElementById('sidebar');
const mainLayout = document.querySelector('.main-layout');
const sidebarSpectators = document.getElementById('sidebar-spectators');
const spectatorPanel = document.getElementById('spectator-panel');
const closeSpectatorBtn = document.getElementById('close-spectator-btn');
const spectatorBackBtn = document.getElementById('spectator-back-btn');
const navBoard = document.getElementById('nav-board');
const navPlayers = document.getElementById('nav-players');
const navSpectate = document.getElementById('nav-spectate');
const gameOverModal = document.getElementById('game-over-modal');
const gameOverTitle = document.getElementById('game-over-title');
const gameOverReason = document.getElementById('game-over-reason');
const leaderboardList = document.getElementById('leaderboard-list');
const gameOverResetBtn = document.getElementById('game-over-reset-btn');
const gameOverCloseBtn = document.getElementById('game-over-close-btn');
const powerupBadge = document.getElementById('powerup-badge');

function endAutoReveal() {
  if (powerupTimerInterval) {
    clearInterval(powerupTimerInterval);
    powerupTimerInterval = null;
  }
  autoRevealExpiresAt = 0;
  myPowerups.autoReveal = false;
  if (powerupBadge) {
    powerupBadge.classList.add('hidden');
    powerupBadge.textContent = '';
  }
}

function updatePowerupBadge() {
  const remainingMs = autoRevealExpiresAt - Date.now();
  if (!myPowerups.autoReveal || remainingMs <= 0) {
    endAutoReveal();
    return;
  }
  if (!powerupBadge) return;
  powerupBadge.classList.remove('hidden');
  powerupBadge.textContent = `⚡ ${POWERUP_LABELS.autoReveal} · ${Math.ceil(remainingMs / 1000)}s`;
}

function startPowerupBadgeTimer() {
  if (powerupTimerInterval) clearInterval(powerupTimerInterval);
  updatePowerupBadge();
  powerupTimerInterval = setInterval(updatePowerupBadge, 250);
}

function resetMyPowerups() {
  endAutoReveal();
  lastTapInfo = { cellKey: null, time: 0 };
}

function showScreen(screen) {
  loginScreen.classList.add('hidden');
  lobbyScreen.classList.add('hidden');
  waitingScreen.classList.add('hidden');
  gameScreen.classList.add('hidden');
  screen.classList.remove('hidden');
}

function detectMobile() {
  isMobile = window.innerWidth <= 768 || 'ontouchstart' in window;
  flagToggleContainer.style.display = isMobile ? 'block' : 'none';
  updateSpectatorLayout();
}

function getCellSize() {
  const w = window.innerWidth;
  if (w <= 400) return 14;
  if (w <= 768) {
    const avail = w - 24;
    return Math.floor(avail / boardWidth) - 2;
  }
  return 32;
}

function getSpectatorCellSize(detailed = false) {
  const w = window.innerWidth;
  if (w <= 330) return detailed ? 14 : 7;
  if (w <= 370) return detailed ? 15 : 8;
  if (w <= 768) return detailed ? 16 : 9;
  if (w <= 1250) return 14;
  return 16;
}

// ===== LOGIN =====
joinBtn.addEventListener('click', joinGame);
nameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') joinGame();
});

function joinGame() {
  const name = nameInput.value.trim();
  if (!name) {
    loginError.textContent = 'Escribe un nombre';
    return;
  }
  socket.emit('join', name, (response) => {
    if (response.error) {
      loginError.textContent = response.error;
      return;
    }
    myPlayerId = response.playerId;
    myNameEl.textContent = name;
    lobbyWelcome.textContent = `Bienvenido, ${name}`;
    showScreen(lobbyScreen);
  });
}

// ===== LOBBY =====
createRoomBtn.addEventListener('click', () => {
  socket.emit('createRoom', (response) => {
    if (response.error) {
      lobbyError.textContent = response.error;
      return;
    }
    myRoomCode = response.roomCode;
    isHost = true;
    roomCodeDisplay.textContent = response.roomCode;
    startGameBtn.classList.remove('hidden');
    waitingHint2.textContent = '';
    showScreen(waitingScreen);
  });
});

joinRoomBtn.addEventListener('click', () => {
  const code = roomCodeInput.value.trim().toUpperCase();
  if (!code) {
    lobbyError.textContent = 'Escribe un codigo de sala';
    return;
  }
  socket.emit('joinRoom', code, (response) => {
    if (response.error) {
      lobbyError.textContent = response.error;
      return;
    }
    myRoomCode = response.roomCode;
    isHost = false;
    roomCodeDisplay.textContent = response.roomCode;
    startGameBtn.classList.add('hidden');
    waitingHint2.textContent = 'Esperando al host...';
    showScreen(waitingScreen);
  });
});

roomCodeInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') joinRoomBtn.click();
});

leaveRoomBtn.addEventListener('click', () => {
  socket.emit('leaveRoom');
  myRoomCode = null;
  isHost = false;
  showScreen(lobbyScreen);
  lobbyError.textContent = '';
});

// ===== WAITING ROOM =====
startGameBtn.addEventListener('click', () => {
  socket.emit('startGame', (response) => {
    if (response.error) {
      lobbyError.textContent = response.error;
    }
  });
});

socket.on('newHost', (data) => {
  if (data.hostId === myPlayerId) {
    isHost = true;
    startGameBtn.classList.remove('hidden');
    waitingHint2.textContent = '';
  }
});

socket.on('countdown', (data) => {
  countdownNumber.textContent = data.seconds;
  countdownOverlay.classList.remove('hidden');
  if (data.seconds <= 0) {
    countdownOverlay.classList.add('hidden');
  }
});

socket.on('gameStarted', (data) => {
  countdownOverlay.classList.add('hidden');
  boardWidth = data.boardWidth;
  boardHeight = data.boardHeight;
  mineCount = data.mineCount;
  mineCountEl.textContent = mineCount;
  myStatusEl.textContent = 'Jugando';
  myStatusEl.className = 'status-badge playing';
  flagCountEl.textContent = '0';
  revealedCountEl.textContent = '0';
  spectatingPlayers = {};
  focusedSpectatorId = null;
  gameFinished = false;
  resetMyPowerups();
  gameOverModal.classList.add('hidden');
  createEmptyBoardDisplay(boardEl, boardWidth, boardHeight, true);
  boardLabel.textContent = 'Tu tablero';
  detectMobile();
  showScreen(gameScreen);
  updateMobileView('board');
  updateHeaderPlayers();
});

socket.on('gameReset', () => {
  myBoard = [];
  spectatingPlayers = {};
  focusedSpectatorId = null;
  gameFinished = false;
  resetMyPowerups();
  gameOverModal.classList.add('hidden');
  showScreen(waitingScreen);
  if (isHost) {
    startGameBtn.classList.remove('hidden');
    waitingHint2.textContent = '';
  } else {
    startGameBtn.classList.add('hidden');
    waitingHint2.textContent = 'Esperando al host...';
  }
});

// ===== PLAYER LIST =====
socket.on('playerList', (players) => {
  const activePlayerIds = new Set(players.map((p) => p.id));
  Object.keys(allPlayerData).forEach((id) => {
    if (!activePlayerIds.has(id)) delete allPlayerData[id];
  });
  players.forEach((p) => { allPlayerData[p.id] = p; });

  if (waitingScreen.classList.contains('hidden')) {
    renderGamePlayerList(players);
    updateHeaderPlayers();
    updateSpectatorLayout();
  } else {
    renderWaitingPlayers(players);
  }
});

function renderWaitingPlayers(players) {
  waitingPlayers.innerHTML = '';
  players.forEach((p) => {
    const div = document.createElement('div');
    div.className = 'waiting-player';
    if (p.id === myPlayerId) div.classList.add('me');
    if (p.isHost) div.classList.add('host');
    div.innerHTML = `
      <span class="dot ${p.status}"></span>
      <span>${p.name}${p.id === myPlayerId ? ' (tu)' : ''}</span>
      ${p.isHost ? '<span class="host-badge">HOST</span>' : ''}
    `;
    waitingPlayers.appendChild(div);
  });
}

function renderGamePlayerList(players) {
  playerListEl.innerHTML = '';
  players.forEach((p) => {
    const li = document.createElement('li');
    li.dataset.playerId = p.id;
    if (p.id === myPlayerId) li.classList.add('me');

    const statusText = {
      waiting: 'Esperando',
      playing: 'Jugando',
      won: 'Gano!',
      lost: 'Perdio',
      finished: 'Finalizado',
    };

    li.innerHTML = `
      <div class="player-name">
        <span class="dot ${p.status}"></span>
        ${p.name}${p.id === myPlayerId ? ' (tu)' : ''}${p.hasAutoReveal ? '<span class="mini-power">⚡</span>' : ''}
      </div>
      <div class="player-stats">
        ${statusText[p.status]} | Rev: ${p.revealedCount} | Band: ${p.flagCount}/${p.mineCount}
      </div>
    `;
    playerListEl.appendChild(li);
  });
}

function updateHeaderPlayers() {
  if (!gameScreen || gameScreen.classList.contains('hidden')) {
    headerPlayersEl.innerHTML = '';
    headerPlayersEl.classList.remove('room-roster');
    return;
  }
  const players = Object.values(allPlayerData);
  const others = players.filter((p) => p.id !== myPlayerId);
  const showRoomRoster = !isMobile && players.length > 3;
  const headerPlayers = showRoomRoster ? players : others;

  headerPlayersEl.innerHTML = '';
  headerPlayersEl.classList.toggle('room-roster', showRoomRoster);
  headerPlayers.forEach((p) => {
    const span = document.createElement('span');
    span.className = 'header-player-chip';
    if (p.id === myPlayerId) span.classList.add('me');
    span.innerHTML = `<span class="dot ${p.status}"></span>${p.name}${p.id === myPlayerId ? ' (tu)' : ''}${p.hasAutoReveal ? '<span class="mini-power">⚡</span>' : ''}`;
    headerPlayersEl.appendChild(span);
  });
}

// ===== SPECTATOR LAYOUT =====
function updateSpectatorLayout() {
  if (gameScreen.classList.contains('hidden')) return;

  const others = Object.values(allPlayerData).filter((p) => p.id !== myPlayerId);
  const count = others.length;
  const roomPlayerCount = Object.keys(allPlayerData).length;
  const showSplitSpectators = !isMobile && roomPlayerCount > 3;

  mainLayout.classList.toggle('many-players', showSplitSpectators);
  sidebar.classList.toggle('spectator-mode', showSplitSpectators);
  sidebarSpectators.innerHTML = '';

  if (isMobile) {
    spectatorPanel.classList.remove('hidden');
    renderMobileSpectatorBoards(spectatorBoards, others);
  } else {
    focusedSpectatorId = null;
    spectatorBackBtn.classList.add('hidden');
    spectatorBoards.classList.remove('mobile-gallery', 'mobile-detail');
    if (showSplitSpectators) {
      spectatorPanel.classList.remove('hidden');
      const half = Math.ceil(count / 2);
      renderSpectatorBoardsIn(sidebarSpectators, others.slice(0, half));
      renderSpectatorBoardsIn(spectatorBoards, others.slice(half));
    } else if (count > 0) {
      spectatorPanel.classList.remove('hidden');
      renderSpectatorBoardsIn(spectatorBoards, others);
    } else {
      spectatorPanel.classList.add('hidden');
      spectatorBoards.innerHTML = '';
    }
  }
}

function renderMobileSpectatorBoards(container, players) {
  const focusedPlayer = players.find((p) => p.id === focusedSpectatorId);
  if (focusedSpectatorId && !focusedPlayer) {
    focusedSpectatorId = null;
  }

  spectatorBackBtn.classList.toggle('hidden', !focusedSpectatorId);
  container.classList.toggle('mobile-detail', Boolean(focusedSpectatorId));
  container.classList.toggle('mobile-gallery', !focusedSpectatorId);

  if (focusedSpectatorId && focusedPlayer) {
    renderFocusedSpectatorBoard(container, focusedPlayer);
    return;
  }

  renderAllSpectatorBoards(container, players);
}

function renderAllSpectatorBoards(container, players) {
  container.innerHTML = '';
  if (players.length === 0) {
    container.innerHTML = '<p class="hint">Esperando jugadores...</p>';
    return;
  }
  players.forEach((p) => {
    const wrap = createSpectatorBoardWrap(p);
    container.appendChild(wrap);
    const data = spectatingPlayers[p.id];
    if (data) {
      renderSpectatorBoardInto(wrap.querySelector('.spectator-board'), data.board, data.status, p.name);
    }
  });
}

function renderFocusedSpectatorBoard(container, player) {
  container.innerHTML = '';
  const wrap = createSpectatorBoardWrap(player, { detailed: true });
  container.appendChild(wrap);
  const data = spectatingPlayers[player.id];
  if (data) {
    renderSpectatorBoardInto(wrap.querySelector('.spectator-board'), data.board, data.status, player.name);
  }
}

function renderSpectatorBoardsIn(container, players) {
  container.innerHTML = '';
  players.forEach((p) => {
    const wrap = createSpectatorBoardWrap(p);
    container.appendChild(wrap);
    const data = spectatingPlayers[p.id];
    if (data) {
      renderSpectatorBoardInto(wrap.querySelector('.spectator-board'), data.board, data.status, p.name);
    }
  });
}

function findSpectatorBoardWrap(playerId) {
  return Array.from(document.querySelectorAll('.spectator-board-wrap'))
    .find((wrap) => wrap.dataset.playerId === playerId);
}

function createSpectatorBoardWrap(player, options = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'spectator-board-wrap';
  if (options.detailed) wrap.classList.add('spectator-detail');
  wrap.dataset.playerId = player.id;
  if (isMobile && !options.detailed) {
    wrap.setAttribute('role', 'button');
    wrap.setAttribute('tabindex', '0');
    wrap.setAttribute('aria-label', `Ver tablero de ${player.name}`);
    wrap.addEventListener('click', () => {
      focusedSpectatorId = player.id;
      updateSpectatorLayout();
    });
    wrap.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        focusedSpectatorId = player.id;
        updateSpectatorLayout();
      }
    });
  }

  const label = document.createElement('div');
  label.className = 'spectator-label';

  const statusText = { waiting: 'Esperando', playing: 'Jugando', won: 'Gano!', lost: 'Perdio', finished: 'Finalizado' };
  label.textContent = `${player.name}${player.hasAutoReveal ? ' ⚡' : ''} [${statusText[player.status]}]`;

  const board = document.createElement('div');
  board.className = 'spectator-board';

  const cellSize = getSpectatorCellSize(options.detailed);
  board.style.gridTemplateColumns = `repeat(${boardWidth}, ${cellSize}px)`;
  board.style.setProperty('--cell-size', cellSize + 'px');
  board.style.setProperty('--cell-font', Math.floor(cellSize * 0.55) + 'px');

  for (let r = 0; r < boardHeight; r++) {
    for (let c = 0; c < boardWidth; c++) {
      const cell = document.createElement('div');
      cell.className = 'cell hidden-cell';
      board.appendChild(cell);
    }
  }

  wrap.appendChild(label);
  wrap.appendChild(board);
  return wrap;
}

function renderSpectatorBoardInto(boardEl, boardData, status, playerName) {
  const parent = boardEl.parentElement;
  const label = parent ? parent.querySelector('.spectator-label') : null;
  if (label) {
    const statusText = { waiting: 'Esperando', playing: 'Jugando', won: 'Victoria!', lost: 'Explosion!', finished: 'Finalizado' };
    label.textContent = `${playerName} [${statusText[status] || status}]`;
  }

  boardEl.innerHTML = '';
  const cellSize = getSpectatorCellSize(Boolean(parent && parent.classList.contains('spectator-detail')));
  boardEl.style.gridTemplateColumns = `repeat(${boardWidth}, ${cellSize}px)`;
  boardEl.style.setProperty('--cell-size', cellSize + 'px');
  boardEl.style.setProperty('--cell-font', Math.floor(cellSize * 0.55) + 'px');

  for (let r = 0; r < boardHeight; r++) {
    for (let c = 0; c < boardWidth; c++) {
      const cellData = boardData[r] && boardData[r][c] ? boardData[r][c] : null;
      const cell = document.createElement('div');
      cell.className = 'cell';
      if (cellData) {
        if (cellData.revealed) {
          if (cellData.mine) {
            cell.classList.add('mine');
            cell.textContent = '*';
          } else {
            cell.classList.add('revealed');
            if (cellData.powerup) {
              cell.classList.add('powerup-found');
              cell.title = 'Potenciador: ' + (POWERUP_LABELS[cellData.powerup] || cellData.powerup);
            }
            if (cellData.adjacentMines > 0) {
              cell.textContent = cellData.adjacentMines;
              cell.classList.add('n' + cellData.adjacentMines);
            }
          }
        } else if (cellData.flagged) {
          cell.classList.add('flagged');
        } else {
          cell.classList.add('hidden-cell');
        }
      } else {
        cell.classList.add('hidden-cell');
      }
      boardEl.appendChild(cell);
    }
  }
}

// ===== GAME EVENTS =====
socket.on('boardUpdate', (data) => {
  if (data.playerId === myPlayerId) {
    myBoard = data.board;
    renderMyBoard(data.board, data.status);
    myStatusEl.textContent = { waiting: 'Esperando...', playing: 'Jugando', won: 'Victoria!', lost: 'Explosion!', finished: 'Finalizado' }[data.status];
    myStatusEl.className = 'status-badge ' + data.status;
    flagCountEl.textContent = data.flagCount;
    revealedCountEl.textContent = data.revealedCount;
  }

  if (data.playerId !== myPlayerId) {
    spectatingPlayers[data.playerId] = {
      board: data.board,
      status: data.status,
      name: data.playerName,
    };

    let wrapEl = findSpectatorBoardWrap(data.playerId);
    if (isMobile && focusedSpectatorId && focusedSpectatorId !== data.playerId) {
      return;
    }
    if (!wrapEl) {
      updateSpectatorLayout();
      wrapEl = findSpectatorBoardWrap(data.playerId);
    }
    if (wrapEl) {
      const boardDiv = wrapEl.querySelector('.spectator-board');
      renderSpectatorBoardInto(boardDiv, data.board, data.status, data.playerName);
    }
  }
});

socket.on('boardReset', () => {
  myBoard = [];
  spectatingPlayers = {};
  focusedSpectatorId = null;
  gameFinished = false;
  resetMyPowerups();
  gameOverModal.classList.add('hidden');
  myStatusEl.textContent = 'Esperando...';
  myStatusEl.className = 'status-badge waiting';
  flagCountEl.textContent = '0';
  revealedCountEl.textContent = '0';
  createEmptyBoardDisplay(boardEl, boardWidth, boardHeight, true);
  updateSpectatorLayout();
});

socket.on('gameEvent', (data) => {
  addLogEvent(`${data.playerName} ${data.event === 'won' ? 'gano la partida!' : data.event === 'lost' ? ' exploto!' : data.event === 'join' ? ' se unio' : ' se desconecto'}`, data.event);
});

socket.on('powerUpGained', (data) => {
  (data.powerups || []).forEach((entry) => {
    const type = typeof entry === 'object' && entry !== null ? entry.type : entry;
    const count = typeof entry === 'object' && entry !== null ? (entry.count || 1) : 1;
    if (type === 'autoReveal') {
      const base = Math.max(autoRevealExpiresAt, Date.now());
      autoRevealExpiresAt = base + POWERUP_DURATION_MS * count;
      myPowerups.autoReveal = true;
      addLogEvent(`⚡ Encontraste: Revelado Automatico +${(POWERUP_DURATION_MS * count) / 1000}s (doble click/tap en numeros)`, 'powerup');
      startPowerupBadgeTimer();
    }
  });
});

socket.on('gameOver', (data) => {
  gameFinished = true;
  focusedSpectatorId = null;
  if (data.winnerId === myPlayerId && data.reason !== 'allLost') {
    myStatusEl.textContent = 'Victoria!';
    myStatusEl.className = 'status-badge won';
  } else if (!myStatusEl.classList.contains('lost')) {
    myStatusEl.textContent = 'Finalizado';
    myStatusEl.className = 'status-badge finished';
  }
  updateMobileView('board');
  showGameOverModal(data);
});

socket.on('playerLeft', (data) => {
  delete spectatingPlayers[data.playerId];
  const wrapEl = findSpectatorBoardWrap(data.playerId);
  if (wrapEl) wrapEl.remove();
  updateHeaderPlayers();
  updateSpectatorLayout();
});

resetBtn.addEventListener('click', () => {
  socket.emit('resetGame');
});

gameOverResetBtn.addEventListener('click', () => {
  socket.emit('resetGame');
});

gameOverCloseBtn.addEventListener('click', () => {
  gameOverModal.classList.add('hidden');
});

function showGameOverModal(data) {
  const winnerText = data.winnerName ? `${data.winnerName} gana` : 'Partida finalizada';
  const reasonText = {
    completed: 'Completo todo el tablero antes que los demas.',
    lastAlive: 'Fue el ultimo jugador con vida.',
    allLost: 'Todos explotaron. Gana el primer lugar por puntos.',
  }[data.reason] || 'Resultados finales de la partida.';

  gameOverTitle.textContent = winnerText;
  gameOverReason.textContent = reasonText;
  gameOverResetBtn.classList.toggle('hidden', !isHost);
  leaderboardList.innerHTML = '';

  data.leaderboard.forEach((entry) => {
    const row = document.createElement('div');
    row.className = 'leaderboard-row';
    if (entry.isWinner) row.classList.add('winner');

    const place = document.createElement('div');
    place.className = 'leaderboard-rank';
    place.textContent = `#${entry.rank}`;

    const info = document.createElement('div');
    info.className = 'leaderboard-player';

    const name = document.createElement('div');
    name.className = 'leaderboard-name';
    name.textContent = entry.name + (entry.id === myPlayerId ? ' (tu)' : '');

    const detail = document.createElement('div');
    detail.className = 'leaderboard-detail';
    detail.textContent = `${entry.revealedCount} reveladas + ${entry.correctFlags} minas acertadas`;

    const score = document.createElement('div');
    score.className = 'leaderboard-score';
    score.innerHTML = `<strong>${entry.score}</strong><span>pts</span>`;

    info.appendChild(name);
    info.appendChild(detail);
    row.appendChild(place);
    row.appendChild(info);
    row.appendChild(score);
    leaderboardList.appendChild(row);
  });

  gameOverModal.classList.remove('hidden');
}

// ===== FLAG TOGGLE =====
flagToggle.addEventListener('click', () => {
  flagMode = !flagMode;
  flagToggle.classList.toggle('active', flagMode);
  flagToggle.querySelector('span').textContent = flagMode ? 'ON' : 'OFF';
});

// ===== MOBILE NAV =====
navBoard.addEventListener('click', () => updateMobileView('board'));
navPlayers.addEventListener('click', () => updateMobileView('players'));
navSpectate.addEventListener('click', () => updateMobileView('spectate'));
closeSpectatorBtn.addEventListener('click', () => updateMobileView('board'));
spectatorBackBtn.addEventListener('click', () => {
  focusedSpectatorId = null;
  updateSpectatorLayout();
});

function updateMobileView(view) {
  if (view !== 'spectate') {
    focusedSpectatorId = null;
  }

  navBoard.classList.toggle('active', view === 'board');
  navPlayers.classList.toggle('active', view === 'players');
  navSpectate.classList.toggle('active', view === 'spectate');

  sidebar.classList.toggle('mobile-visible', view === 'players');

  if (view === 'spectate') {
    updateSpectatorLayout();
    spectatorPanel.classList.add('mobile-overlay');
  } else {
    spectatorPanel.classList.remove('mobile-overlay');
    spectatorBackBtn.classList.add('hidden');
  }
}

// ===== BOARD RENDERING =====
function createEmptyBoardDisplay(container, width, height, interactive) {
  container.innerHTML = '';
  const cellSize = interactive ? getCellSize() : getSpectatorCellSize();
  container.style.gridTemplateColumns = `repeat(${width}, ${cellSize}px)`;
  container.style.setProperty('--cell-size', cellSize + 'px');
  container.style.setProperty('--cell-font', Math.floor(cellSize * 0.55) + 'px');

  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const cell = document.createElement('div');
      cell.className = 'cell hidden-cell';
      cell.dataset.row = r;
      cell.dataset.col = c;

      if (interactive) {
        setupCellEvents(cell, r, c);
      }

      container.appendChild(cell);
    }
  }
}

function setupCellEvents(cell, r, c) {
  let pressStarted = false;
  let longPressed = false;

  cell.addEventListener('click', () => {
    if (gameFinished) return;
    if (longPressed) {
      longPressed = false;
      return;
    }
    if (flagMode) {
      socket.emit('flag', { row: r, col: c });
      return;
    }
    socket.emit('reveal', { row: r, col: c });
  });

  cell.addEventListener('dblclick', (e) => {
    e.preventDefault();
    tryChord(r, c);
  });

  cell.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (gameFinished) return;
    socket.emit('flag', { row: r, col: c });
  });

  cell.addEventListener('touchstart', () => {
    pressStarted = true;
    longPressed = false;
    if (gameFinished) return;
    longPressTimer = setTimeout(() => {
      if (pressStarted) {
        longPressed = true;
        socket.emit('flag', { row: r, col: c });
      }
    }, 500);
  }, { passive: true });

  cell.addEventListener('touchend', () => {
    pressStarted = false;
    clearTimeout(longPressTimer);
    const now = Date.now();
    const key = r + ':' + c;
    if (lastTapInfo.cellKey === key && now - lastTapInfo.time < 300) {
      lastTapInfo = { cellKey: null, time: 0 };
      tryChord(r, c);
    } else {
      lastTapInfo = { cellKey: key, time: now };
    }
  });

  cell.addEventListener('touchmove', () => {
    pressStarted = false;
    clearTimeout(longPressTimer);
  });
}

function tryChord(row, col) {
  if (gameFinished || flagMode) return;
  if (!myPowerups.autoReveal) return;
  if (!myBoard || !myBoard[row] || !myBoard[row][col]) return;
  const origin = myBoard[row][col];
  if (!origin.revealed || origin.mine || origin.adjacentMines === 0) return;

  let adjacentFlags = 0;
  let hiddenCount = 0;
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const nr = row + dr;
      const nc = col + dc;
      if (nr < 0 || nr >= boardHeight || nc < 0 || nc >= boardWidth) continue;
      const neighbor = myBoard[nr][nc];
      if (neighbor.flagged) adjacentFlags++;
      else if (!neighbor.revealed) hiddenCount++;
    }
  }

  if (adjacentFlags !== origin.adjacentMines || hiddenCount === 0) return;
  socket.emit('chordReveal', { row, col });
}

function renderMyBoard(board, status) {
  boardEl.innerHTML = '';
  const cellSize = getCellSize();
  boardEl.style.gridTemplateColumns = `repeat(${boardWidth}, ${cellSize}px)`;
  boardEl.style.setProperty('--cell-size', cellSize + 'px');
  boardEl.style.setProperty('--cell-font', Math.floor(cellSize * 0.55) + 'px');

  for (let r = 0; r < boardHeight; r++) {
    for (let c = 0; c < boardWidth; c++) {
      const cellData = board[r][c];
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.row = r;
      cell.dataset.col = c;

      if (cellData.revealed) {
        if (cellData.mine) {
          const isExploded = status === 'lost' && r === getFirstRevealedMineRow(board) && c === getFirstRevealedMineCol(board);
          cell.classList.add(isExploded ? 'mine-exploded' : 'mine');
          cell.textContent = '*';
        } else {
          cell.classList.add('revealed');
          if (cellData.powerup) {
            cell.classList.add('powerup-found');
            cell.title = 'Potenciador: ' + (POWERUP_LABELS[cellData.powerup] || cellData.powerup);
          }
          if (cellData.adjacentMines > 0) {
            cell.textContent = cellData.adjacentMines;
            cell.classList.add('n' + cellData.adjacentMines);
          }
        }
      } else if (cellData.flagged) {
        cell.classList.add('flagged');
      } else {
        cell.classList.add('hidden-cell');
      }

      if (status !== 'lost' && status !== 'won' && status !== 'finished') {
        setupCellEvents(cell, r, c);
      }

      boardEl.appendChild(cell);
    }
  }
}

function getFirstRevealedMineRow(board) {
  for (let r = 0; r < boardHeight; r++) {
    for (let c = 0; c < boardWidth; c++) {
      if (board[r][c].mine && board[r][c].revealed) return r;
    }
  }
  return -1;
}

function getFirstRevealedMineCol(board) {
  for (let r = 0; r < boardHeight; r++) {
    for (let c = 0; c < boardWidth; c++) {
      if (board[r][c].mine && board[r][c].revealed) return c;
    }
  }
  return -1;
}

function addLogEvent(text, type) {
  const span = document.createElement('span');
  span.className = 'log-event ' + type;
  span.textContent = text;
  logContent.appendChild(span);
  logContent.scrollLeft = logContent.scrollWidth;
}

// ===== RESIZE =====
let resizeTimeout;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimeout);
  resizeTimeout = setTimeout(() => {
    detectMobile();
    if (myPlayerId && myBoard.length > 0) {
      renderMyBoard(myBoard, myStatusEl.className.replace('status-badge ', ''));
    } else if (myPlayerId && !gameScreen.classList.contains('hidden')) {
      createEmptyBoardDisplay(boardEl, boardWidth, boardHeight, true);
    }
    updateSpectatorLayout();
  }, 200);
});

detectMobile();
