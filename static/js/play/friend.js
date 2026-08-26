// ============================================================
// friend.js — Play with Friend (local 2-player)
// Shared-screen: both players alternate turns.
// Board auto-flips on every move so each player sees their
// pieces at the bottom. Clocks, captured pieces, and player
// names all flip along with the board.
// ============================================================

// ── Friend state ──────────────────────────────────────────────

let frState = {
  active:       false,
  player1Name:  'White',
  player2Name:  'Black',
  // Whichever color Player 1 chose
  player1Color: 'w',
  timeControl:  false,
  timeMinutes:  10,
  whiteMs:      0,
  blackMs:      0,
  moveLog:      [],
  _turnStartedAt: 0,
  clockInterval: null,
};

let frGame = null;

// ── Setup helpers ─────────────────────────────────────────────

function frToggleTime() {
  const on = document.getElementById('fr-timecontrol').checked;
  document.getElementById('fr-time-field').style.display = on ? '' : 'none';
}

function frSelectColor(c) {
  ['white','black'].forEach(x => {
    document.getElementById('fr-pill-' + x).classList.toggle('selected', x === c);
  });
}

function frGetSelectedColor() {
  return document.getElementById('fr-pill-white').classList.contains('selected') ? 'w' : 'b';
}

// ── Start a friend match ──────────────────────────────────────

function startFriendMatch() {
  const p2Name = document.getElementById('fr-p2-name').value.trim() || 'Player 2';
  const p1Name = (playerProfile && playerProfile.name) ? playerProfile.name : 'Player 1';
  const player1Color = frGetSelectedColor();
  const timeOn   = document.getElementById('fr-timecontrol').checked;
  const timeMins = parseInt(document.getElementById('fr-time-min').value) || 10;
  const timeMs   = timeOn ? Math.max(1, Math.min(180, timeMins)) * 60000 : 0;

  frGame = new Chess();

  // Optional starting PGN (same behavior as Play vs Bot / Bot vs Bot)
  let startFen = 'start';
  const startPgnRaw = document.getElementById('fr-start-pgn').value.trim();
  if (startPgnRaw) {
    if (!frGame.load_pgn(startPgnRaw)) {
      alert('Invalid starting PGN! Ignoring it, starting from normal position.');
      frGame = new Chess();
    } else {
      startFen = frGame.fen();
    }
  }

  frState = {
    active:       true,
    player1Name:  p1Name,
    player2Name:  p2Name,
    player1Color: player1Color,
    timeControl:  timeOn,
    timeMinutes:  timeMins,
    whiteMs:      timeMs,
    blackMs:      timeMs,
    moveLog:      [],
    _turnStartedAt: Date.now(),
    clockInterval: null,
  };

  // Hide setup, show board + ingame controls
  frShowIngameUI();

  // Auto-flip to Player 1's color at bottom
  const needFlip = player1Color === 'b';
  if (needFlip !== boardFlipped) {
    board.flip();
    boardFlipped = needFlip;
    setTimeout(attachBoardTapHandlers, 100);
  }

  board.position(startFen);
  clearArrows();
  frUpdateLabelsAndClocks();
  frUpdateCapturedDisplay();

  if (timeOn) frStartClock();
}

// ── Show ingame UI ────────────────────────────────────────────

function frShowIngameUI() {
  document.body.classList.remove('play-board-hidden');
  document.querySelectorAll('.play-page').forEach(p => p.classList.remove('active'));
  document.getElementById('play-subnav').style.display = 'none';

  // Show the shared ingame controls, hide bot-specific parts
  document.getElementById('ingame-controls').classList.add('show');
  document.getElementById('game-over-banner').classList.remove('show');
  document.getElementById('game-over-elo').style.display = 'none';
  document.getElementById('copy-pgn-btn').classList.add('show');
  document.getElementById('copy-pgn-btn').classList.remove('pulse');

  // Hide bot-specific buttons
  document.getElementById('ingame-hint-btn').style.display = 'none';
  document.getElementById('ingame-undo-btn').style.display = 'none';
  document.getElementById('bot-thinking').classList.remove('show');

  // Show clock rows
  document.getElementById('clock-top-row').classList.add('show');
  document.getElementById('clock-bottom-row').classList.add('show');
  document.getElementById('clock-bot').style.display = '';
  document.getElementById('clock-player').style.display = '';

  const showClocks = frState.timeControl;
  document.getElementById('clock-bot-time').style.display    = showClocks ? '' : 'none';
  document.getElementById('clock-player-time').style.display = showClocks ? '' : 'none';

  // Hide eval bar
  document.querySelector('.eval-container').style.display = 'none';

  frSetStatus(frGame.turn() === 'w' ? frState.player1Name + "'s turn" : frState.player2Name + "'s turn");
}

// ── Labels & clocks ───────────────────────────────────────────
// Top row = opponent of whoever is at bottom; bottom row = player at bottom

function frGetBottomColor() {
  // The color whose side is at the bottom of the board
  return boardFlipped ? 'b' : 'w';
}

function frGetTopColor() {
  return frGetBottomColor() === 'w' ? 'b' : 'w';
}

function frNameForColor(color) {
  if (frState.player1Color === color) return frState.player1Name;
  return frState.player2Name;
}

function frUpdateLabelsAndClocks() {
  const topColor = frGetTopColor();
  const botColor = frGetBottomColor();

  document.getElementById('clock-bot-label').textContent    = (topColor === 'w' ? '♙ ' : '♟ ') + frNameForColor(topColor);
  document.getElementById('clock-player-label').textContent = (botColor === 'w' ? '♙ ' : '♟ ') + frNameForColor(botColor);

  frUpdateClocks();
}

function frUpdateClocks() {
  document.getElementById('clock-player-time').textContent = _formatClk(frState.whiteMs);  // wrong initially
  document.getElementById('clock-bot-time').textContent    = _formatClk(frState.blackMs);

  // Map to bottom/top: bottom color's clock, top color's clock
  const botColor = frGetBottomColor();
  const topColor = frGetTopColor();

  const botMs = botColor === 'w' ? frState.whiteMs : frState.blackMs;
  const topMs = topColor === 'w' ? frState.whiteMs : frState.blackMs;

  document.getElementById('clock-player-time').textContent = _formatClk(botMs);
  document.getElementById('clock-bot-time').textContent    = _formatClk(topMs);

  const botLow = botMs < 30000;
  const topLow = topMs < 30000;
  document.getElementById('clock-player-time').classList.toggle('low', botLow);
  document.getElementById('clock-bot-time').classList.toggle('low', topLow);
  document.getElementById('clock-player').classList.toggle('low', botLow);
  document.getElementById('clock-bot').classList.toggle('low', topLow);

  // Active clock highlight — the side whose turn it is
  const turn = frGame.turn();
  document.getElementById('clock-player').classList.toggle('active', turn === botColor && !botLow);
  document.getElementById('clock-bot').classList.toggle('active', turn === topColor && !topLow);
}

// ── Clock logic ───────────────────────────────────────────────

function frStartClock() {
  if (!frState.timeControl) return;
  frStopClock();
  let lastTick = Date.now();
  frState.clockInterval = setInterval(() => {
    if (!frState.active) { lastTick = Date.now(); return; }
    const now  = Date.now();
    const diff = now - lastTick;
    lastTick = now;

    const turn = frGame.turn(); // 'w' or 'b'
    if (turn === 'w') {
      frState.whiteMs = Math.max(0, frState.whiteMs - diff);
      if (frState.whiteMs === 0) { frGameOver(frNameForColor('b') + ' wins!', 'White ran out of time'); return; }
    } else {
      frState.blackMs = Math.max(0, frState.blackMs - diff);
      if (frState.blackMs === 0) { frGameOver(frNameForColor('w') + ' wins!', 'Black ran out of time'); return; }
    }
    frUpdateClocks();
  }, 200);
}

function frStopClock() {
  if (frState.clockInterval) { clearInterval(frState.clockInterval); frState.clockInterval = null; }
}

// ── Captured pieces ───────────────────────────────────────────

function frUpdateCapturedDisplay() {
  if (!frState.active) {
    document.getElementById('cap-top-pieces').innerHTML = '';
    document.getElementById('cap-bottom-pieces').innerHTML = '';
    document.getElementById('cap-top-adv').textContent = '';
    document.getElementById('cap-bottom-adv').textContent = '';
    return;
  }

  const captured = getCapturedPieces(frGame);
  const topColor = frGetTopColor();
  const botColor = frGetBottomColor();

  // Top row shows captured pieces of top-side player (i.e. pieces bottom side took)
  // Same convention as BvB: top row = black's captured white pieces
  const topCaptured = []; // pieces belonging to topColor that were captured (by botColor)
  const botCaptured = []; // pieces belonging to botColor that were captured (by topColor)

  ['Q','R','B','N','P'].forEach(type => {
    const topKey = topColor + type;
    for (let i = 0; i < (captured[topKey] || 0); i++) topCaptured.push(PIECE_SYMBOLS[topKey]);
  });

  ['Q','R','B','N','P'].forEach(type => {
    const botKey = botColor + type;
    for (let i = 0; i < (captured[botKey] || 0); i++) botCaptured.push(PIECE_SYMBOLS[botKey]);
  });

  let topMat = 0, botMat = 0;
  ['Q','R','B','N','P'].forEach(type => {
    const val = PIECE_VALUES[type.toLowerCase()];
    topMat += (captured[botColor + type] || 0) * val; // botColor pieces captured by topColor
    botMat += (captured[topColor + type] || 0) * val; // topColor pieces captured by botColor
  });

  document.getElementById('cap-top-pieces').innerHTML =
    topCaptured.map(s => `<span class="cap-piece">${s}</span>`).join('');
  document.getElementById('cap-top-adv').textContent = topMat > botMat ? `+${topMat - botMat}` : '';

  document.getElementById('cap-bottom-pieces').innerHTML =
    botCaptured.map(s => `<span class="cap-piece">${s}</span>`).join('');
  document.getElementById('cap-bottom-adv').textContent = botMat > topMat ? `+${botMat - topMat}` : '';
}

// ── Status message ────────────────────────────────────────────

function frSetStatus(msg) {
  document.getElementById('play-status-msg').textContent = msg;
}

// ── Move handler (called from handleSquareTap) ────────────────

function frHandleSquareTap(square) {
  if (!frState.active) return false;
  if (frGame.game_over()) return false;

  // No selection yet — select a piece
  if (!playSelectedSquare) {
    const piece = frGame.get(square);
    if (!piece) return true; // consumed, but nothing to do

    // Highlight selected piece + legal moves
    playSelectedSquare = square;
    document.querySelector(`.square-${square}`)?.classList.add('sq-selected');

    frGame.moves({ square, verbose: true }).forEach(m => {
      const el = document.querySelector(`.square-${m.to}`);
      if (!el) return;
      const isCapture = frGame.get(m.to) !== null || m.flags.includes('e');
      el.classList.add(isCapture ? 'sq-legal-capture' : 'sq-legal-dot');
      playLegalSquares.push(m.to);
    });
    return true;
  }

  // Already selected — try to move
  if (square === playSelectedSquare) {
    clearPlayTapSelection();
    return true;
  }

  const piece = frGame.get(playSelectedSquare);
  let promo = undefined;
  if (piece && piece.type === 'p') {
    if ((piece.color === 'w' && square[1] === '8') || (piece.color === 'b' && square[1] === '1')) {
      promo = getPromotionPiece();
    }
  }

  const move = frGame.move({ from: playSelectedSquare, to: square, promotion: promo });
  if (move !== null) {
    clearPlayTapSelection();
    if (window.SoundFX) SoundFX.playForMove(frGame, move);

    // Record time
    const now = Date.now();
    const took = frState._turnStartedAt ? (now - frState._turnStartedAt) : 0;
    frState._turnStartedAt = now;
    const moverColor = move.color === 'w' ? 'white' : 'black';
    const fullMoveNum = Math.ceil(frGame.history().length / 2);
    frState.moveLog.push({
      ply:      frGame.history().length,
      move_num: fullMoveNum,
      color:    moverColor,
      san:      move.san,
      uci:      move.from + move.to + (move.promotion || ''),
      time_ms:  Math.max(0, Math.round(took)),
    });

    board.position(frGame.fen());

    // Draw last-move arrow
    clearArrows();
    drawPlayArrow(move.from, move.to, 'last');

    frUpdateCapturedDisplay();

    // Auto-flip board (if enabled): current turn's color at bottom
    const nextTurn = frGame.turn();
    const autoFlip = document.getElementById('fr-autoflip')?.checked !== false;
    if (autoFlip) {
      const needFlip = nextTurn === 'b'; // black at bottom when black's turn
      if (needFlip !== boardFlipped) {
        board.flip();
        boardFlipped = needFlip;
        // Redraw last-move arrow after flip
        clearArrows();
        setTimeout(() => {
          drawPlayArrow(move.from, move.to, 'last');
          frUpdateLabelsAndClocks();
          frUpdateCapturedDisplay();
        }, 80);
      }
    }

    frUpdateLabelsAndClocks();
    frUpdateFENDisplay();

    // Check game over
    if (frGame.game_over()) {
      frHandleGameOver();
      return true;
    }

    // Show whose turn
    const turnName = nextTurn === 'w' ? frState.player1Name : frState.player2Name;
    frSetStatus(turnName + "'s turn");
    return true;
  }

  // Move failed — try selecting the tapped piece instead
  clearPlayTapSelection();
  const newPiece = frGame.get(square);
  if (!newPiece) return true;

  playSelectedSquare = square;
  document.querySelector(`.square-${square}`)?.classList.add('sq-selected');
  frGame.moves({ square, verbose: true }).forEach(m => {
    const el = document.querySelector(`.square-${m.to}`);
    if (!el) return;
    const isCapture = frGame.get(m.to) !== null || m.flags.includes('e');
    el.classList.add(isCapture ? 'sq-legal-capture' : 'sq-legal-dot');
    playLegalSquares.push(m.to);
  });
  return true;
}

// ── FEN display (reuse if available) ──────────────────────────

function frUpdateFENDisplay() {
  if (typeof updateFENDisplay === 'function') updateFENDisplay();
}

// ── Game over ─────────────────────────────────────────────────

function frHandleGameOver() {
  frStopClock();
  frState.active = false;

  let title, reason;
  if (frGame.in_checkmate()) {
    const loserColor = frGame.turn(); // the side in checkmate
    const winnerColor = loserColor === 'w' ? 'b' : 'w';
    const winnerName = frNameForColor(winnerColor);
    title = `🎉 ${winnerName} wins!`;
    reason = 'Checkmate';
  } else if (frGame.in_stalemate()) {
    title = '½ Draw'; reason = 'Stalemate';
  } else if (frGame.in_threefold_repetition()) {
    title = '½ Draw'; reason = 'Threefold repetition';
  } else if (frGame.insufficient_material()) {
    title = '½ Draw'; reason = 'Insufficient material';
  } else {
    title = '½ Draw'; reason = 'Draw';
  }

  frGameOver(title, reason);
}

function frGameOver(title, reason) {
  frStopClock();
  frState.active = false;

  const b = document.getElementById('game-over-banner');
  document.getElementById('game-over-title').textContent  = title;
  document.getElementById('game-over-reason').textContent = reason;
  b.classList.add('show');
  frSetStatus(title);

  document.getElementById('play-subnav').style.display = 'flex';
  const copyBtn = document.getElementById('copy-pgn-btn');
  copyBtn.classList.add('show', 'pulse');

  // Save to history
  if (frGame.history().length > 0) {
    frSaveToHistory(title, reason);
  }
}

// ── Save game to history ──────────────────────────────────────

async function frSaveToHistory(title, reason) {
  const { result, winner } = _frResultFromGameOver(title, reason);

  const payload = {
    mode:           'friend',
    result,
    winner,
    reason:         reason || '',
    title:          title  || '',
    white_name:     frState.player1Color === 'w' ? frState.player1Name : frState.player2Name,
    black_name:     frState.player1Color === 'w' ? frState.player2Name : frState.player1Name,
    white_bot_id:   null,
    black_bot_id:   null,
    player_color:   null,
    pgn:            _frInjectClkComments(frGame.pgn(), frState.moveLog),
    fen_final:      frGame.fen(),
    time_control:   frState.timeControl ? { minutes: frState.timeMinutes } : null,
    white_time_left_ms: frState.whiteMs,
    black_time_left_ms: frState.blackMs,
    moves:          frState.moveLog || [],
  };

  try {
    await fetch(`${FLASK_URL}/play/history`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } catch(e) { /* ignore */ }
}

function _frResultFromGameOver(title, reason) {
  // Combined text — title sirf player naam + "wins!" rakhta hai,
  // asli wajah (ran out of time / Resignation / Stalemate) reason mein hoti hai
  const txt = ((title || '') + ' ' + (reason || '')).toLowerCase();

  if (/draw|½|stalemate|repetition|insufficient/.test(txt)) {
    return { result: '1/2-1/2', winner: 'draw' };
  }

  // Decisive result (checkmate / time-out / resignation):
  // har case mein frGame.turn() = losing side
  const loserColor = frGame.turn();
  const winnerColor = loserColor === 'w' ? 'b' : 'w';
  return {
    result: winnerColor === 'w' ? '1-0' : '0-1',
    winner: winnerColor === 'w' ? 'white' : 'black',
  };
}

function _frInjectClkComments(pgn, moveLog) {
  if (!moveLog || moveLog.length === 0) return pgn;
  let plyIdx = 0;
  return pgn.replace(
    /((?:[NBRQK]?[a-h]?[1-8]?x?[a-h][1-8](?:=[NBRQK])?|O-O(?:-O)?)[+#]?)/g,
    (match) => {
      const entry = moveLog[plyIdx++];
      if (!entry || entry.clk_ms === undefined) return match;
      return match + ` { [%clk ${_formatClk(entry.clk_ms)}] }`;
    }
  );
}

// ── Resign handler ────────────────────────────────────────────

function frResign() {
  if (!frState.active) return;
  if (!confirm('Resign karna chahte ho?')) return;
  const loserColor = frGame.turn();
  const winnerColor = loserColor === 'w' ? 'b' : 'w';
  const winnerName = frNameForColor(winnerColor);
  frGameOver(`🏳 ${winnerName} wins!`, 'Resignation');
}

// ── Flip board (friend mode: manual flip via button) ──────────

function frFlipBoard() {
  playFlipBoard();
  setTimeout(() => {
    frUpdateLabelsAndClocks();
    frUpdateCapturedDisplay();
  }, 120);
}

// ── Expose on window ──────────────────────────────────────────
window.startFriendMatch = startFriendMatch;
window.frHandleSquareTap = frHandleSquareTap;
window.frResign = frResign;
window.frFlipBoard = frFlipBoard;

// ── Game-over New Game button: route to friend or playbot page ─
function friendOrBotPage() {
  if (typeof frState !== 'undefined' && frState && !frState.active && frGame) {
    playSubSwitch('friend');
  } else {
    playSubSwitch('playbot');
  }
}
window.friendOrBotPage = friendOrBotPage;
