// ============================================================
// play-ui.js — Captured pieces display, arrows, eval bar,
//              board flip, UI helpers for Play vs Bot + BvB
// ============================================================

// ── Piece symbols & values ────────────────────────────────────
const PIECE_SYMBOLS = {
  wK: '♔', wQ: '♕', wR: '♖', wB: '♗', wN: '♘', wP: '♙',
  bK: '♚', bQ: '♛', bR: '♜', bB: '♝', bN: '♞', bP: '♟'
};

const PIECE_VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

// ── Captured piece calculation ────────────────────────────────

function getCapturedPieces(chessInstance) {
  const startCount = { wP:0, wN:0, wB:0, wR:0, wQ:0, wK:0, bP:0, bN:0, bB:0, bR:0, bQ:0, bK:0 };
  const gameStartFen = (playState && playState.startFen)
    ? playState.startFen
    : 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  const startBoard = new Chess(gameStartFen).board();
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const sq = startBoard[r][c];
      if (sq) {
        const key = sq.color + sq.type.toUpperCase();
        if (startCount[key] !== undefined) startCount[key]++;
      }
    }
  }

  const currentCount = { wP:0, wN:0, wB:0, wR:0, wQ:0, wK:0, bP:0, bN:0, bB:0, bR:0, bQ:0, bK:0 };
  const boardArr = chessInstance.board();
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const sq = boardArr[r][c];
      if (sq) {
        const key = sq.color + sq.type.toUpperCase();
        if (currentCount[key] !== undefined) currentCount[key]++;
      }
    }
  }

  const captured = {};
  for (const key in startCount) {
    captured[key] = Math.max(0, startCount[key] - currentCount[key]);
  }
  return captured;
}

// ── Play vs Bot captured display ─────────────────────────────

function updateCapturedDisplay() {
  if (!playState.active && playState.status !== 'over') {
    document.getElementById('cap-top-pieces').innerHTML = '';
    document.getElementById('cap-bottom-pieces').innerHTML = '';
    document.getElementById('cap-top-adv').textContent = '';
    document.getElementById('cap-bottom-adv').textContent = '';
    return;
  }

  const captured    = getCapturedPieces(playGame);
  const playerColor = playState.playerColor;
  const botColor    = playerColor === 'w' ? 'b' : 'w';

  const botCapturedPieces    = [];
  const playerCapturedPieces = [];

  ['Q','R','B','N','P'].forEach(type => {
    const key = playerColor + type;
    for (let i = 0; i < (captured[key] || 0); i++) botCapturedPieces.push(PIECE_SYMBOLS[key]);
  });

  ['Q','R','B','N','P'].forEach(type => {
    const key = botColor + type;
    for (let i = 0; i < (captured[key] || 0); i++) playerCapturedPieces.push(PIECE_SYMBOLS[key]);
  });

  let playerMat = 0, botMat = 0;
  ['Q','R','B','N','P'].forEach(type => {
    const pKey = playerColor + type;
    const bKey = botColor + type;
    const val  = PIECE_VALUES[type.toLowerCase()];
    botMat    += (captured[pKey] || 0) * val;
    playerMat += (captured[bKey] || 0) * val;
  });

  document.getElementById('cap-top-pieces').innerHTML =
    botCapturedPieces.map(s => `<span class="cap-piece">${s}</span>`).join('');
  const botAdv = botMat - playerMat;
  document.getElementById('cap-top-adv').textContent = botAdv > 0 ? `+${botAdv}` : '';

  document.getElementById('cap-bottom-pieces').innerHTML =
    playerCapturedPieces.map(s => `<span class="cap-piece">${s}</span>`).join('');
  const playerAdv = playerMat - botMat;
  document.getElementById('cap-bottom-adv').textContent = playerAdv > 0 ? `+${playerAdv}` : '';
}

// ── BvB captured display ──────────────────────────────────────

function updateBvbCapturedDisplay(chessInst) {
  const inst = chessInst || bvbGame;
  if (!inst) return;

  const captured = getCapturedPieces(inst);

  const blackCapturedPieces = [];
  ['Q','R','B','N','P'].forEach(type => {
    const key = 'w' + type;
    for (let i = 0; i < (captured[key] || 0); i++) blackCapturedPieces.push(PIECE_SYMBOLS[key]);
  });

  const whiteCapturedPieces = [];
  ['Q','R','B','N','P'].forEach(type => {
    const key = 'b' + type;
    for (let i = 0; i < (captured[key] || 0); i++) whiteCapturedPieces.push(PIECE_SYMBOLS[key]);
  });

  let whiteMat = 0, blackMat = 0;
  ['Q','R','B','N','P'].forEach(type => {
    const val = PIECE_VALUES[type.toLowerCase()];
    whiteMat += (captured['b' + type] || 0) * val;
    blackMat += (captured['w' + type] || 0) * val;
  });

  document.getElementById('cap-top-pieces').innerHTML =
    blackCapturedPieces.map(s => `<span class="cap-piece">${s}</span>`).join('');
  const blackAdv = blackMat - whiteMat;
  document.getElementById('cap-top-adv').textContent = blackAdv > 0 ? `+${blackAdv}` : '';

  document.getElementById('cap-bottom-pieces').innerHTML =
    whiteCapturedPieces.map(s => `<span class="cap-piece">${s}</span>`).join('');
  const whiteAdv = whiteMat - blackMat;
  document.getElementById('cap-bottom-adv').textContent = whiteAdv > 0 ? `+${whiteAdv}` : '';
}

// ── Play Arrows ───────────────────────────────────────────────

function clearPlayArrows() {
  _playArrowHint   = null;
  _playArrowThreat = null;
  _playArrowLast   = null;
  const svg = document.getElementById('arrow-svg');
  [...svg.children].forEach(el => { if (el.tagName !== 'defs') el.remove(); });
}

function drawPlayArrow(from, to, type) {
  if (type === 'last') {
    _playArrowLast = { from, to };
    drawArrowSVG(from, to, 'ah-last',   'rgba(128,128,128,0.9)');
  } else if (type === 'hint') {
    _playArrowHint = { from, to };
    drawArrowSVG(from, to, 'ah-best',   'rgba(97,189,79,0.93)');
  } else if (type === 'threat') {
    _playArrowThreat = { from, to };
    drawArrowSVG(from, to, 'ah-threat', 'rgba(220,140,40,0.95)');
  }
}

async function drawSuggestionArrow() {
  if (!playState.features.suggestion) return;
  if (playGame.turn() !== playState.playerColor) return;
  try {
    const res = await fetch(`${FLASK_URL}/play/hint`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fen: playGame.fen(), depth: 8 })
    });
    const data = await res.json();
    if (data.best_move && data.best_move.length >= 4) {
      drawPlayArrow(data.best_move.slice(0,2), data.best_move.slice(2,4), 'hint');
    }
  } catch(e) { /* ignore */ }
}

async function drawThreatArrow() {
  if (!playState.features.threat) return;
  try {
    const res = await fetch(`${FLASK_URL}/play/hint`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fen: playGame.fen(), depth: 8 })
    });
    const data = await res.json();
    if (data.best_move && data.best_move.length >= 4 && playGame.turn() !== playState.playerColor) {
      drawPlayArrow(data.best_move.slice(0,2), data.best_move.slice(2,4), 'threat');
    }
  } catch(e) { /* ignore */ }
}

function analyzePlayPosition() {
  const fen = playGame.fen();
  fetch(`${FLASK_URL}/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fen, depth: 8 })
  }).then(r => r.json()).then(data => {
    if (data.score !== undefined) updateEvalBar(data.score, data.mate);
  }).catch(() => {});
}

// ── Board flip (play mode) ────────────────────────────────────

function playFlipBoard() {
  flipBoard();
  setTimeout(() => {
    const svg = document.getElementById('arrow-svg');
    [...svg.children].forEach(el => { if (el.tagName !== 'defs') el.remove(); });
    if (_playArrowLast)   drawArrowSVG(_playArrowLast.from,   _playArrowLast.to,   'ah-last',   'rgba(128,128,128,0.9)');
    if (_playArrowHint)   drawArrowSVG(_playArrowHint.from,   _playArrowHint.to,   'ah-best',   'rgba(97,189,79,0.93)');
    if (_playArrowThreat) drawArrowSVG(_playArrowThreat.from, _playArrowThreat.to, 'ah-threat', 'rgba(220,80,80,0.88)');
  }, 120);
}

// ── BvB UI helpers ────────────────────────────────────────────

function setBvbStatus(msg) {
  document.getElementById('bvb-status-msg').textContent = msg;
}

function updateBvbTurnDot(turn) {
  const topDot = document.getElementById('bvb-turn-dot-top');
  const botDot = document.getElementById('bvb-turn-dot-bottom');
  if (!topDot || !botDot) return;
  topDot.classList.toggle('show', turn === 'b');
  botDot.classList.toggle('show', turn === 'w');
}

function hideBvbTurnDots() {
  const topDot = document.getElementById('bvb-turn-dot-top');
  const botDot = document.getElementById('bvb-turn-dot-bottom');
  if (topDot) topDot.classList.remove('show');
  if (botDot) botDot.classList.remove('show');
}

function updateBvbClocks() {
  document.getElementById('clock-player-time').textContent = _formatClk(bvbState.whiteMs || 0);
  document.getElementById('clock-bot-time').textContent    = _formatClk(bvbState.blackMs || 0);
}
