// ============================================================
// play-setup.js — Match setup, board init, in-game UI show,
//                 auto-save, resume saved game (Play vs Bot)
// ============================================================

async function startMatch() {
  const botId = document.getElementById('match-bot-select').value;
  if (!botId) { alert('Pehle ek bot choose karo!'); return; }

  const colorChoice = getSelectedColor();
  let playerColor;
  if (colorChoice === 'random') {
    playerColor = Math.random() < 0.5 ? 'w' : 'b';
  } else {
    playerColor = colorChoice === 'white' ? 'w' : 'b';
  }

  const timeOn   = document.getElementById('tog-timecontrol').checked;
  const timeMins = parseInt(document.getElementById('match-time-min').value) || 10;
  const timeMs   = timeOn ? Math.max(1, Math.min(180, timeMins)) * 60000 : 0;

  const sel     = document.getElementById('match-bot-select');
  const botName = sel.options[sel.selectedIndex]?.text || 'Bot';

  playState = {
    active:      true,
    botId,
    botName,
    playerColor,
    timeControl: timeOn,
    timeMinutes: timeMins,
    playerMs:    timeMs,
    botMs:       timeMs,
    features: {
      undo:       document.getElementById('feat-undo').checked,
      hint:       document.getElementById('feat-hint').checked,
      evalbar:    document.getElementById('feat-evalbar').checked,
      threat:     document.getElementById('feat-threat').checked,
      suggestion: document.getElementById('feat-suggestion').checked,
    },
    pgn:     '',
    fen:     'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    startFen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    status:  'playing',
    result:  null,
    moveLog: [],
    _turnStartedAt: Date.now(),
    openingLocked: null,
  };

  initPlayBoard();
  showIngameUI();

  // Optional starting PGN
  const startPgnRaw = document.getElementById('pb-start-pgn').value.trim();
  if (startPgnRaw) {
    if (!playGame.load_pgn(startPgnRaw)) {
      alert('Invalid starting PGN! Ignoring it, starting from normal position.');
    } else {
      const tmpG = new Chess();
      tmpG.load_pgn(startPgnRaw);
      const hist = tmpG.history({ verbose: true });
      for (let i = 0; i < hist.length; i++) tmpG.undo();
      playState.startFen = tmpG.fen();
      playState.fen = playGame.fen();
      board.position(playGame.fen());
      updateCapturedDisplay();
      updateFENDisplay();

      try {
        const obRes = await fetch(`${FLASK_URL}/play/check-opening`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fen: playGame.fen() })
        });
        const obData = await obRes.json();
        playState.openingLocked = !!obData.is_opening;
      } catch (e) {
        playState.openingLocked = false;
      }
    }
  }

  await autoSavePlayState();
  hideAllDialogueBubbles();

  try {
    const botsRes  = await fetch(`${FLASK_URL}/play/bots`);
    const botsData = await botsRes.json();
    const currentBot = (botsData.bots || []).find(b => b.id === botId);
    const startFen = playGame.fen();
    personalityEngine.reset(currentBot || null, startFen, { position: 'top', botLabel: playState.botName });
    if (currentBot && currentBot.personality) {
      personalityEngine.onGameStart(playGame, startFen);
    }
  } catch(e) {
    personalityEngine.reset(null, null, { position: 'top', botLabel: playState.botName });
  }

  if (playGame.turn() !== playerColor) {
    setTimeout(() => triggerBotMove(), 400);
  }
}

// ── Board initialisation ──────────────────────────────────────

function initPlayBoard() {
  playGame = new Chess();
  board.position('start');
  clearArrows();
  clearHighlights();
  clearTapSelection();
  clearPlayTapSelection();
  setTimeout(attachBoardTapHandlers, 100);

  if (playState.playerColor === 'b' && !boardFlipped) {
    board.flip();
    boardFlipped = true;
    setTimeout(attachBoardTapHandlers, 100);
  } else if (playState.playerColor === 'w' && boardFlipped) {
    board.flip();
    boardFlipped = false;
    setTimeout(attachBoardTapHandlers, 100);
  }

  document.getElementById('clock-player-label').textContent =
    (playState.playerColor === 'w') ? '♙ You (White)' : '♟ You (Black)';
}

// ── Show in-game UI (hide setup, show board + controls) ───────

function showIngameUI() {
  document.body.classList.remove('play-board-hidden');
  document.getElementById('play-page-makebot').classList.remove('active');
  document.getElementById('play-page-playbot').classList.remove('active');
  document.getElementById('play-subnav').style.display = 'none';
  document.getElementById('ingame-controls').classList.add('show');
  document.getElementById('game-over-banner').classList.remove('show');
  document.getElementById('game-over-elo').style.display = 'none';
  document.getElementById('game-over-elo').textContent = '';
  document.getElementById('copy-pgn-btn').classList.add('show');
  document.getElementById('copy-pgn-btn').classList.remove('pulse');

  document.getElementById('cap-top-pieces').innerHTML = '';
  document.getElementById('cap-bottom-pieces').innerHTML = '';
  document.getElementById('cap-top-adv').textContent = '';
  document.getElementById('cap-bottom-adv').textContent = '';

  document.getElementById('clock-top-row').classList.add('show');
  document.getElementById('clock-bottom-row').classList.add('show');
  document.getElementById('clock-bot').style.display    = '';
  document.getElementById('clock-player').style.display = '';

  const showClocks = playState.timeControl;
  document.getElementById('clock-bot-time').style.display    = showClocks ? '' : 'none';
  document.getElementById('clock-player-time').style.display = showClocks ? '' : 'none';
  document.getElementById('clock-bot-label').textContent = '🤖 ' + (playState.botName || 'Bot');
  document.getElementById('bot-dialogue-bubble-bottom').style.display = 'none';
  if (showClocks) { updateClocks(); startClock(); }

  document.getElementById('ingame-hint-btn').style.display = playState.features.hint ? '' : 'none';
  document.getElementById('ingame-undo-btn').style.display = playState.features.undo ? '' : 'none';

  const evalCont = document.querySelector('.eval-container');
  evalCont.style.display = playState.features.evalbar ? '' : 'none';

  setPlayStatus('Your turn');
  showBotThinking(false);
}

// ── Auto-save play state ──────────────────────────────────────

async function autoSavePlayState() {
  if (playState.status === 'setup') return;
  const hist = playGame.history({ verbose: true });
  const payload = {
    botId:         playState.botId,
    botName:       playState.botName,
    playerColor:   playState.playerColor,
    timeControl:   playState.timeControl,
    timeMinutes:   playState.timeMinutes,
    playerMs:      playState.playerMs,
    botMs:         playState.botMs,
    features:      playState.features,
    fen:           playGame.fen(),
    pgn:           playGame.pgn(),
    startFen:      playState.startFen || 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    moves:         hist.map(m => m.from + m.to + (m.promotion || '')),
    status:        playState.status,
    result:        playState.result,
    moveLog:       playState.moveLog       || [],
    openingLocked: playState.openingLocked !== undefined ? playState.openingLocked : null,
  };
  try {
    await fetch(`${FLASK_URL}/play/game`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } catch(e) { /* ignore */ }
}

// ── Check & resume saved game ─────────────────────────────────

async function checkResumeGame() {
  try {
    const res  = await fetch(`${FLASK_URL}/play/game`);
    const data = await res.json();
    if (!data.game || data.game.status === 'over') return;

    const g = data.game;
    const moves = g.moves || [];
    if (moves.length === 0) return;

    const banner = document.getElementById('resume-banner');
    const info   = document.getElementById('resume-info');
    info.textContent = `vs ${g.botName || 'Bot'} · ${moves.length} moves played`;
    banner.classList.add('show');
    banner._savedGame = g;
  } catch(e) { /* ignore */ }
}

async function resumeSavedGame() {
  const banner = document.getElementById('resume-banner');
  const g = banner._savedGame;
  if (!g) return;
  banner.classList.remove('show');

  playState = {
    active:         true,
    botId:          g.botId,
    botName:        g.botName,
    playerColor:    g.playerColor,
    timeControl:    g.timeControl,
    timeMinutes:    g.timeMinutes,
    playerMs:       g.playerMs   || 0,
    botMs:          g.botMs      || 0,
    features:       g.features   || { undo:true, hint:true, evalbar:false, threat:false, suggestion:true },
    pgn:            g.pgn        || '',
    fen:            g.fen,
    startFen:       g.startFen   || 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    status:         'playing',
    result:         null,
    moveLog:        g.moveLog    || [],
    _turnStartedAt: Date.now(),
    openingLocked:  g.openingLocked !== undefined ? g.openingLocked : null,
  };

  playGame = new Chess();
  (g.moves || []).forEach(uci => {
    const from = uci.slice(0,2), to = uci.slice(2,4), promo = uci[4];
    playGame.move({ from, to, promotion: promo });
  });

  board.position(playGame.fen());
  clearArrows();
  clearHighlights();

  const needFlip = (g.playerColor === 'b');
  if (needFlip !== boardFlipped) { board.flip(); boardFlipped = needFlip; }
  setTimeout(attachBoardTapHandlers, 100);

  showIngameUI();
  updateCapturedDisplay();
  hideAllDialogueBubbles();

  try {
    const botsRes  = await fetch(`${FLASK_URL}/play/bots`);
    const botsData = await botsRes.json();
    const currentBot = (botsData.bots || []).find(b => b.id === playState.botId);
    personalityEngine.reset(currentBot || null, playGame.fen(), { position: 'top', botLabel: playState.botName });
  } catch(e) {
    personalityEngine.reset(null, null, { position: 'top', botLabel: playState.botName });
  }

  if (playGame.turn() !== playState.playerColor) {
    setPlayStatus('Bot is thinking...');
    setTimeout(() => triggerBotMove(), 400);
  } else {
    setPlayStatus('Your turn');
  }
}

async function discardSavedGame() {
  document.getElementById('resume-banner').classList.remove('show');
  try {
    await fetch(`${FLASK_URL}/play/game`, { method: 'DELETE' });
  } catch(e) { /* ignore */ }
}
