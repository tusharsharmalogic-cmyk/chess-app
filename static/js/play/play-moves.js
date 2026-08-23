// ============================================================
// play-moves.js — Move handling, bot move loop, undo, hint,
//                 game-over, ELO update, history save
//                 (Play vs Bot only)
// ============================================================

// ── Tap selection state ───────────────────────────────────────
let playSelectedSquare = null;
let playLegalSquares   = [];

function clearPlayTapSelection() {
  if (playSelectedSquare) {
    document.querySelector(`.square-${playSelectedSquare}`)?.classList.remove('sq-selected');
    playSelectedSquare = null;
  }
  playLegalSquares.forEach(sq => {
    const el = document.querySelector(`.square-${sq}`);
    if (el) el.classList.remove('sq-legal-dot', 'sq-legal-capture');
  });
  playLegalSquares = [];
}

// ── Square tap handler ────────────────────────────────────────

function handleSquareTap(square) {
  if (_currentTab === 'review') return;

  // Tactics puzzle mode — board taps go to the puzzle handler
  if (typeof pzState !== 'undefined' && pzState && pzState.active) {
    handlePuzzleSquareTap(square);
    return;
  }

  // 🌐 Lichess live game — board taps go to the lichess handler
  if (typeof lcIsActive === 'function' && lcIsActive()) {
    lcHandleSquareTap(square);
    return;
  }

  if (_currentTab === 'analysis' || _currentTab === 'pgn' || _currentTab === 'fen') {
    handleSquareTapAnalysis(square);
    return;
  }

  if (!playState.active || playState.status !== 'playing') return;
  if (playGame.turn() !== playState.playerColor) return;
  if (playBotThinking) return;

  if (playSelectedSquare) {
    if (square === playSelectedSquare) {
      clearPlayTapSelection();
      return;
    }

    const piece = playGame.get(playSelectedSquare);
    let promo = undefined;
    if (piece && piece.type === 'p') {
      if ((piece.color === 'w' && square[1] === '8') ||
          (piece.color === 'b' && square[1] === '1')) {
        promo = getPromotionPiece();
      }
    }

    const fenBeforePlayerMove = playGame.fen();
    const move = playGame.move({ from: playSelectedSquare, to: square, promotion: promo });
    if (move !== null) {
      clearPlayTapSelection();
      recordPlayMoveTime(move, playState.playerColor);
      board.position(playGame.fen());
      playState.fen = playGame.fen();
      updateCapturedDisplay();
      onPlayerMoveMade(fenBeforePlayerMove, move);
      return;
    }

    clearPlayTapSelection();
  }

  const piece = playGame.get(square);
  if (!piece || piece.color !== playState.playerColor) return;

  playSelectedSquare = square;
  document.querySelector(`.square-${square}`)?.classList.add('sq-selected');

  playGame.moves({ square, verbose: true }).forEach(m => {
    const el = document.querySelector(`.square-${m.to}`);
    if (!el) return;
    const isCapture = playGame.get(m.to) !== null || m.flags.includes('e');
    el.classList.add(isCapture ? 'sq-legal-capture' : 'sq-legal-dot');
    playLegalSquares.push(m.to);
  });
}

// ── After player move ─────────────────────────────────────────

async function onPlayerMoveMade(fenBeforePlayerMove, moveObj) {
  clearPlayArrows();
  updateFENDisplay();

  const hist = playGame.history({ verbose: true });
  if (hist.length > 0) {
    const last = hist[hist.length - 1];
    drawPlayArrow(last.from, last.to, 'last');
  }

  if (playState.features.threat) {
    setTimeout(() => drawThreatArrow(), 150);
  }

  if (playState.features.evalbar) {
    analyzePlayPosition();
  }

  const _pBot = personalityEngine.bot;
  pendingPlayerMoveQuality = (_pBot && _pBot.personality && fenBeforePlayerMove && moveObj)
    ? classifyPlayerMoveForPersonality(fenBeforePlayerMove, moveObj)
    : Promise.resolve(null);

  checkPlayGameOver();
  if (playState.status !== 'over') {
    setPlayStatus('Bot is thinking...');
    autoSavePlayState();
    setTimeout(() => triggerBotMove(), 300);
  }
}

// ── Move quality classification (for personality engine) ──────

function classifyPlayerMoveForPersonality(fenBefore, moveObj) {
  return fetch(`${FLASK_URL}/classify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fen_before: fenBefore,
      move_uci:   moveObj.from + moveObj.to + (moveObj.promotion || ''),
      depth:      12,
    })
  }).then(r => r.json()).then(data => (data.error ? null : (data.quality || null)))
    .catch(() => null);
}

// ── Bot move trigger ──────────────────────────────────────────

async function triggerBotMove() {
  if (!playState.active || playState.status !== 'playing') return;
  if (playGame.game_over()) return;

  playBotThinking = true;
  showBotThinking(true);
  setPlayStatus('Bot is thinking...');

  const timeMs = playState.timeControl ? playState.botMs : 0;

  const histVerbose = playGame.history({ verbose: true });
  const lastMoveObj = histVerbose.length > 0 ? histVerbose[histVerbose.length - 1] : null;

  try {
    const res = await fetch(`${FLASK_URL}/play/move`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fen:      playGame.fen(),
        bot_id:   playState.botId,
        time_ms:  timeMs,
        move_num: Math.ceil((playGame.history().length + 1) / 2),
        opening_locked: playState.openingLocked,
      })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    const evalCp = data.score !== undefined ? data.score : null;
    const phase  = data.phase || 'middlegame';
    const playerMoveQuality = await pendingPlayerMoveQuality;
    const override = personalityEngine.onAfterMove(playGame, lastMoveObj, evalCp, phase, playerMoveQuality);

    let finalData = data;
    if (override) {
      try {
        const overRes = await fetch(`${FLASK_URL}/play/move`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fen:               playGame.fen(),
            bot_id:            playState.botId,
            time_ms:           timeMs,
            move_num:          Math.ceil((playGame.history().length + 1) / 2),
            opening_locked:    playState.openingLocked,
            override_elo:      override.elo,
            override_depth:    override.depth,
            override_think_ms: override.think_ms,
          })
        });
        const overData = await overRes.json();
        if (!overData.error) finalData = overData;
      } catch(e) { /* fall back to original move */ }
    }

    const moveUci = finalData.move_uci;
    const from    = moveUci.slice(0, 2);
    const to      = moveUci.slice(2, 4);
    const promo   = moveUci.length === 5 ? moveUci[4] : undefined;

    const moveObj = playGame.move({ from, to, promotion: promo });
    if (!moveObj) throw new Error('Illegal bot move: ' + moveUci);
    recordPlayMoveTime(moveObj, playState.playerColor === 'w' ? 'b' : 'w');

    personalityEngine.onAfterMove(playGame, moveObj, finalData.score !== undefined ? finalData.score : null, phase);

    board.position(playGame.fen());
    clearPlayArrows();
    updateCapturedDisplay();

    drawPlayArrow(from, to, 'last');

    if (playState.features.suggestion) {
      setTimeout(() => drawSuggestionArrow(), 200);
    }
    if (playState.features.threat) {
      setTimeout(() => drawThreatArrow(), 200);
    }
    if (finalData.score !== undefined && playState.features.evalbar) {
      updateEvalBar(finalData.score, finalData.mate);
    }

    playState.fen = playGame.fen();
    updateFENDisplay();
    checkPlayGameOver();

    if (playState.status !== 'over') {
      setPlayStatus('Your turn');
      autoSavePlayState();
    }
  } catch(e) {
    setPlayStatus('Bot error: ' + e.message);
  } finally {
    playBotThinking = false;
    showBotThinking(false);
  }
}

// ── Game over check ───────────────────────────────────────────

function checkPlayGameOver() {
  if (!playGame.game_over()) return;
  stopClock();
  playState.active = false;
  playState.status = 'over';

  let title, reason;
  if (playGame.in_checkmate()) {
    const winnerIsPlayer = playGame.turn() !== playState.playerColor;
    const botName = playState.botName || 'Bot';
    title  = winnerIsPlayer ? '🎉 You win!' : `🏁 ${botName} wins!`;
    reason = 'Checkmate';
  } else if (playGame.in_stalemate()) {
    title = '½ Draw'; reason = 'Stalemate';
  } else if (playGame.in_threefold_repetition()) {
    title = '½ Draw'; reason = 'Threefold repetition';
  } else if (playGame.insufficient_material()) {
    title = '½ Draw'; reason = 'Insufficient material';
  } else if (playGame.in_draw && playGame.in_draw()) {
    const fenParts = playGame.fen().split(' ');
    const halfMoveClock = parseInt(fenParts[4] || '0');
    if (halfMoveClock >= 100) {
      title = '½ Draw'; reason = '50-move rule';
    } else {
      title = '½ Draw'; reason = 'Draw';
    }
  } else {
    title = 'Game over'; reason = '';
  }

  showGameOver(title, reason);
  personalityEngine.onGameEnd(playGame);
  autoSavePlayState();
  if (playGame.history().length > 0) {
    savePlayGameToHistory(title, reason);
    submitMatchResult(title);
  }

  // Tournament hook — Championship knockout continuation
  if (window.tourOnUserGameOver) { try { tourOnUserGameOver(title); } catch(e) {} }
}

function endGame(title, reason) {
  stopClock();
  playState.active = false;
  playState.status = 'over';
  showGameOver(title, reason);
  personalityEngine.onGameEnd(playGame);
  autoSavePlayState();
  if (playGame.history().length > 0) {
    savePlayGameToHistory(title, reason);
    submitMatchResult(title);
  }

  // Tournament hook — Championship knockout continuation
  if (window.tourOnUserGameOver) { try { tourOnUserGameOver(title); } catch(e) {} }
}

async function resignGame() {
  if (!playState.active) return;
  if (!confirm('Resign karna chahte ho?')) return;
  endGame('🏳 Resigned', 'You resigned the game');
  fetch(`${FLASK_URL}/play/game`, { method: 'DELETE' }).catch(() => {});
}

// ── Undo ──────────────────────────────────────────────────────

function undoPlayMove() {
  if (!playState.active || !playState.features.undo) return;
  if (playBotThinking) return;

  const hist = playGame.history();
  if (hist.length < 2) return;

  const log = playState.moveLog || [];
  const botMoveLog    = log.length >= 1 ? log[log.length - 1] : null;
  const playerMoveLog = log.length >= 2 ? log[log.length - 2] : null;

  playGame.undo();
  playGame.undo();

  if (playState.timeControl) {
    if (botMoveLog)    playState.botMs    = Math.min(playState.timeMinutes * 60000, playState.botMs    + (botMoveLog.time_ms    || 0));
    if (playerMoveLog) playState.playerMs = Math.min(playState.timeMinutes * 60000, playState.playerMs + (playerMoveLog.time_ms || 0));
    updateClocks();
  }

  if (log.length >= 2) {
    playState.moveLog = log.slice(0, log.length - 2);
  } else if (log.length === 1) {
    playState.moveLog = [];
  }

  playState._turnStartedAt = Date.now();

  board.position(playGame.fen());
  clearPlayArrows();

  const h2 = playGame.history({ verbose: true });
  if (h2.length > 0) {
    const last = h2[h2.length - 1];
    drawPlayArrow(last.from, last.to, 'last');
  }

  playState.fen = playGame.fen();
  updateFENDisplay();
  updateCapturedDisplay();
  setPlayStatus('Your turn');
  autoSavePlayState();
}

// ── Hint ──────────────────────────────────────────────────────

async function requestHint() {
  if (!playState.active || !playState.features.hint) return;
  if (playBotThinking) return;
  if (playGame.turn() !== playState.playerColor) return;

  try {
    const res = await fetch(`${FLASK_URL}/play/hint`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fen: playGame.fen(), depth: 10 })
    });
    const data = await res.json();
    if (data.best_move && data.best_move.length >= 4) {
      clearPlayArrows();
      drawPlayArrow(data.best_move.slice(0,2), data.best_move.slice(2,4), 'hint');

      const flash = document.getElementById('hint-flash');
      flash.classList.add('show');
      setTimeout(() => flash.classList.remove('show'), 2000);
    }
  } catch(e) { /* ignore */ }
}

// ── Per-move time tracking ────────────────────────────────────

function recordPlayMoveTime(moveObj, moverColor) {
  const now  = Date.now();
  const took = playState._turnStartedAt ? (now - playState._turnStartedAt) : 0;
  playState._turnStartedAt = now;

  // remaining clock us side ka jo abhi chala
  const remainingMs = playState.timeControl
    ? (moverColor === 'w' ? playState.playerMs : playState.botMs)   // default: player=w
    : undefined;
  // agar player black hai toh swap
  const clkMs = playState.timeControl
    ? (moverColor === playState.playerColor ? playState.playerMs : playState.botMs)
    : undefined;

  if (!playState.moveLog) playState.moveLog = [];
  const fullMoveNum = Math.ceil(playGame.history().length / 2);
  playState.moveLog.push({
    ply:      playGame.history().length,
    move_num: fullMoveNum,
    color:    moverColor === 'w' ? 'white' : 'black',
    san:      moveObj.san,
    uci:      moveObj.from + moveObj.to + (moveObj.promotion || ''),
    time_ms:  Math.max(0, Math.round(took)),
    clk_ms:   clkMs,   // PGN clock comment ke liye
  });
}

// ── PGN clock comment injector (play vs bot) ─────────────────

function _playInjectClkComments(pgn, moveLog) {
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

// ── Result helpers ────────────────────────────────────────────

function _resultFromGameOver(title) {
  if (/You win/i.test(title)) {
    return { result: playState.playerColor === 'w' ? '1-0' : '0-1', winner: playState.playerColor === 'w' ? 'white' : 'black' };
  }
  if (/wins!/i.test(title) || /wins on time/i.test(title)) {
    const botColor = playState.playerColor === 'w' ? 'b' : 'w';
    return { result: botColor === 'w' ? '1-0' : '0-1', winner: botColor === 'w' ? 'white' : 'black' };
  }
  if (/You win on time/i.test(title) || /time.*you/i.test(title)) {
    return { result: playState.playerColor === 'w' ? '1-0' : '0-1', winner: playState.playerColor === 'w' ? 'white' : 'black' };
  }
  if (/Draw/i.test(title)) {
    return { result: '1/2-1/2', winner: 'draw' };
  }
  if (/Resigned/i.test(title)) {
    const botColor = playState.playerColor === 'w' ? 'b' : 'w';
    return { result: botColor === 'w' ? '1-0' : '0-1', winner: botColor === 'w' ? 'white' : 'black' };
  }
  return { result: '*', winner: null };
}

// ── Save game to history ──────────────────────────────────────

async function savePlayGameToHistory(title, reason) {
  const { result, winner } = _resultFromGameOver(title);
  const isWhitePlayer = playState.playerColor === 'w';
  const playerName = (playerProfile && playerProfile.name) ? playerProfile.name : 'You';

  const payload = {
    mode:         'playbot',
    result,
    winner,
    reason:       reason || '',
    title:        title  || '',
    white_name:   isWhitePlayer ? playerName : (playState.botName || 'Bot'),
    black_name:   isWhitePlayer ? (playState.botName || 'Bot') : playerName,
    white_bot_id: isWhitePlayer ? null : playState.botId,
    black_bot_id: isWhitePlayer ? playState.botId : null,
    player_color: playState.playerColor,
    pgn:          _playInjectClkComments(playGame.pgn(), playState.moveLog),
    fen_final:    playGame.fen(),
    time_control: playState.timeControl ? { minutes: playState.timeMinutes } : null,
    white_time_left_ms: isWhitePlayer ? playState.playerMs : playState.botMs,
    black_time_left_ms: isWhitePlayer ? playState.botMs    : playState.playerMs,
    moves:        playState.moveLog || [],
  };

  try {
    await fetch(`${FLASK_URL}/play/history`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } catch(e) { /* ignore */ }
}

// ── ELO update ────────────────────────────────────────────────

function _playerScoreFromResult(winner) {
  if (winner === 'draw') return 0.5;
  const playerColorWord = playState.playerColor === 'w' ? 'white' : 'black';
  return winner === playerColorWord ? 1 : 0;
}

async function submitMatchResult(title) {
  const { winner } = _resultFromGameOver(title);
  if (winner === null) return;

  const score = _playerScoreFromResult(winner);

  try {
    const res = await fetch(`${FLASK_URL}/play/result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bot_id: playState.botId, score })
    });
    const data = await res.json();
    if (data.error) {
      const eloEl = document.getElementById('game-over-elo');
      eloEl.style.display = '';
      eloEl.style.color = 'var(--text3)';
      eloEl.textContent = 'ℹ️ Set this bot\'s Estimated ELO (Make Bot tab) to track your rating';
      return;
    }

    playerProfile.elo = data.new_elo;
    playerProfile.games_played = data.player.games_played;
    document.getElementById('player-elo').value = data.new_elo;
    document.getElementById('player-games-played').textContent = playerProfile.games_played;
    updateEloChip();

    const delta = data.delta;
    const eloEl = document.getElementById('game-over-elo');
    eloEl.style.display = '';
    eloEl.style.color = delta > 0 ? 'var(--accent2)' : (delta < 0 ? 'var(--danger)' : 'var(--text3)');
    const sign = delta > 0 ? '+' : '';
    eloEl.textContent = `📊 ELO: ${data.old_elo} → ${data.new_elo}  (${sign}${delta})`;
  } catch(e) { /* ignore */ }
}
