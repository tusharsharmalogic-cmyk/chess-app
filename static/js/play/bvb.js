// ============================================================
// bvb.js — Bot vs Bot: full game loop, clock, browse nav,
//           pause/resume, game over, history save
// ============================================================

// ── BvB state ─────────────────────────────────────────────────

let bvbState = {
  active:        false,
  paused:        false,
  whiteBotId:    null,
  blackBotId:    null,
  whiteMs:       0,
  blackMs:       0,
  timeControl:   false,
  delay:         500,
  clockInterval: null,
};
let bvbGame        = null;
let bvbLoopTimeout = null;
let bvbBrowseIdx   = -1;   // -1 = live position

// ── UI helpers ────────────────────────────────────────────────

function _formatClk(ms) {
  ms = Math.max(0, ms);
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function _bvbInjectClkComments(pgn, moveLog) {
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

function toggleBvbTimeInput() {
  const on = document.getElementById('bvb-timecontrol').checked;
  document.getElementById('bvb-time-field').style.display = on ? 'block' : 'none';
}

async function populateBvbSelects() {
  const bots = await fetchBots();
  const wSel = document.getElementById('bvb-white-select');
  const bSel = document.getElementById('bvb-black-select');
  wSel.innerHTML = '<option value="">— Select White Bot —</option>';
  bSel.innerHTML = '<option value="">— Select Black Bot —</option>';
  bots.forEach(bot => {
    const label = bot.name + (bot.bot_elo ? ` (~${bot.bot_elo})` : '') + (bot.personality ? ' 🎭' : '');
    wSel.appendChild(new Option(label, bot.id));
    bSel.appendChild(new Option(label, bot.id));
  });
}

// ── Start match ───────────────────────────────────────────────

async function startBvbMatch() {
  const wId = document.getElementById('bvb-white-select').value;
  const bId = document.getElementById('bvb-black-select').value;
  if (!wId) { alert('White ke liye bot choose karo!'); return; }
  if (!bId) { alert('Black ke liye bot choose karo!'); return; }

  const timeOn   = document.getElementById('bvb-timecontrol').checked;
  const timeMins = parseInt(document.getElementById('bvb-time-min').value) || 5;
  const timeMs   = timeOn ? timeMins * 60000 : 0;
  const delay    = parseInt(document.getElementById('bvb-delay-slider').value) || 500;

  bvbGame = new Chess();
  clearArrows();
  board.position('start');
  if (boardFlipped) { board.flip(); boardFlipped = false; }

  // Optional starting PGN
  let bvbOpeningLocked = null;
  const bvbStartPgnRaw = document.getElementById('bvb-start-pgn').value.trim();
  if (bvbStartPgnRaw) {
    if (!bvbGame.load_pgn(bvbStartPgnRaw)) {
      alert('Invalid starting PGN! Ignoring it, starting from normal position.');
      bvbGame = new Chess();
    } else {
      board.position(bvbGame.fen());
      try {
        const obRes = await fetch(`${FLASK_URL}/play/check-opening`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fen: bvbGame.fen() })
        });
        const obData = await obRes.json();
        bvbOpeningLocked = !!obData.is_opening;
      } catch (e) {
        bvbOpeningLocked = false;
      }
    }
  }

  bvbState = {
    active:         true,
    paused:         false,
    whiteBotId:     wId,
    blackBotId:     bId,
    whiteMs:        timeMs,
    blackMs:        timeMs,
    timeControl:    timeOn,
    delay,
    clockInterval:  null,
    moveLog:        [],
    _turnStartedAt: Date.now(),
    _pausedAccum:   0,
    openingLocked:  bvbOpeningLocked,
  };

  // Show in-game controls
  document.body.classList.remove('play-board-hidden');
  document.getElementById('play-subnav').style.display = 'none';
  document.getElementById('play-page-makebot').classList.remove('active');
  document.getElementById('play-page-playbot').classList.remove('active');
  document.getElementById('play-page-botvsbot').classList.remove('active');
  document.getElementById('bvb-ingame-controls').style.display = 'flex';
  document.getElementById('bvb-game-over-banner').style.display = 'none';
  document.getElementById('bvb-pause-btn').textContent = '⏸ Pause';
  setBvbStatus('');
  bvbBrowseIdx = -1;
  document.getElementById('bvb-nav-row').classList.add('disabled');
  document.getElementById('bvb-browse-label').textContent = '';

  // Clock rows + labels
  const wName = document.getElementById('bvb-white-select').options[document.getElementById('bvb-white-select').selectedIndex].text.split(' (')[0];
  const bName = document.getElementById('bvb-black-select').options[document.getElementById('bvb-black-select').selectedIndex].text.split(' (')[0];
  document.getElementById('clock-player-label').textContent = '♙ ' + wName;
  document.getElementById('clock-bot-label').textContent    = '♟ ' + bName;
  document.getElementById('clock-top-row').classList.add('show');
  document.getElementById('clock-bottom-row').classList.add('show');
  document.getElementById('clock-bot').style.display    = '';
  document.getElementById('clock-player').style.display = '';
  document.getElementById('clock-bot-time').style.display    = timeOn ? '' : 'none';
  document.getElementById('clock-player-time').style.display = timeOn ? '' : 'none';
  document.getElementById('bot-dialogue-bubble-bottom').style.display = 'none';
  updateBvbClocks();
  updateBvbCapturedDisplay();
  updateBvbTurnDot(bvbGame.turn());

  if (timeOn) startBvbClock();

  hideAllDialogueBubbles();

  // Init personality engines for both bots
  try {
    const botsRes  = await fetch(`${FLASK_URL}/play/bots`);
    const botsData = await botsRes.json();
    const allBots  = botsData.bots || [];
    const whiteBot = allBots.find(b => b.id === wId) || null;
    const blackBot = allBots.find(b => b.id === bId) || null;
    const startFen = bvbGame.fen();
    bvbWhiteEngine.reset(whiteBot, startFen, { position: 'bottom', fixedColor: 'w', botLabel: wName });
    bvbBlackEngine.reset(blackBot, startFen, { position: 'top',    fixedColor: 'b', botLabel: bName });
    if (whiteBot && whiteBot.personality) bvbWhiteEngine.onGameStart(bvbGame, startFen);
    if (blackBot && blackBot.personality) bvbBlackEngine.onGameStart(bvbGame, startFen);
  } catch(e) {
    bvbWhiteEngine.reset(null, null, { position: 'bottom', fixedColor: 'w', botLabel: wName });
    bvbBlackEngine.reset(null, null, { position: 'top',    fixedColor: 'b', botLabel: bName });
  }

  bvbNextMove();
}

// ── Current bot helper ────────────────────────────────────────

function bvbCurrentBotId() {
  return bvbGame.turn() === 'w' ? bvbState.whiteBotId : bvbState.blackBotId;
}

// ── Move loop ─────────────────────────────────────────────────

async function bvbNextMove() {
  if (!bvbState.active) return;
  if (bvbState.paused)  return;
  if (bvbGame.game_over()) { bvbHandleGameOver(); return; }

  const turn   = bvbGame.turn();
  const botId  = bvbCurrentBotId();
  const timeMs = bvbState.timeControl
    ? (turn === 'w' ? bvbState.whiteMs : bvbState.blackMs)
    : 0;

  const moverEngine = turn === 'w' ? bvbWhiteEngine : bvbBlackEngine;

  const bvbHistVerbose = bvbGame.history({ verbose: true });
  const bvbLastMoveObj = bvbHistVerbose.length > 0 ? bvbHistVerbose[bvbHistVerbose.length - 1] : null;

  updateBvbTurnDot(turn);

  try {
    const res = await fetch(`${FLASK_URL}/play/move`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fen:            bvbGame.fen(),
        bot_id:         botId,
        time_ms:        timeMs,
        move_num:       Math.ceil((bvbGame.history().length + 1) / 2),
        opening_locked: bvbState.openingLocked,
      })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    const bvbEvalCpPre = data.score !== undefined ? data.score : null;
    const bvbPhasePre  = data.phase || 'middlegame';
    const moverOverride = moverEngine.onAfterMove(bvbGame, bvbLastMoveObj, bvbEvalCpPre, bvbPhasePre);

    let finalData = data;
    if (moverOverride) {
      try {
        const overRes = await fetch(`${FLASK_URL}/play/move`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fen:               bvbGame.fen(),
            bot_id:            botId,
            time_ms:           timeMs,
            move_num:          Math.ceil((bvbGame.history().length + 1) / 2),
            opening_locked:    bvbState.openingLocked,
            override_elo:      moverOverride.elo,
            override_depth:    moverOverride.depth,
            override_think_ms: moverOverride.think_ms,
          })
        });
        const overData = await overRes.json();
        if (!overData.error) finalData = overData;
      } catch(e) { /* fall back */ }
    }

    const uci   = finalData.move_uci;
    const from  = uci.slice(0, 2);
    const to    = uci.slice(2, 4);
    const promo = uci.length === 5 ? uci[4] : undefined;

    const moveObj = bvbGame.move({ from, to, promotion: promo });
    if (!moveObj) throw new Error('Illegal move: ' + uci);

    // Per-move time tracking
    const remainingMs = turn === 'w' ? bvbState.whiteMs : bvbState.blackMs;
    {
      const nowT    = Date.now();
      const elapsed = (nowT - bvbState._turnStartedAt) - (bvbState._pausedAccum || 0);
      bvbState._turnStartedAt = nowT;
      bvbState._pausedAccum   = 0;
      if (!bvbState.moveLog) bvbState.moveLog = [];
      const fullMoveNum = Math.ceil(bvbGame.history().length / 2);
      bvbState.moveLog.push({
        ply:      bvbGame.history().length,
        move_num: fullMoveNum,
        color:    turn === 'w' ? 'white' : 'black',
        san:      moveObj.san,
        uci,
        time_ms:  Math.max(0, Math.round(elapsed)),
        clk_ms:   remainingMs,   // PGN clock comment ke liye
      });
    }

    // Opponent engine reacts (dialogue only)
    const bvbEvalCp    = finalData.score !== undefined ? finalData.score : null;
    const bvbPhase     = finalData.phase || 'middlegame';
    const opponentEngine = turn === 'w' ? bvbBlackEngine : bvbWhiteEngine;
    opponentEngine.onAfterMove(bvbGame, moveObj, bvbEvalCp, bvbPhase);

    board.position(bvbGame.fen());
    clearArrows();
    const svg = document.getElementById('arrow-svg');
    [...svg.children].forEach(el => { if (el.tagName !== 'defs') el.remove(); });
    drawArrowSVG(from, to, 'ah-last', 'rgba(128,128,128,0.9)');
    updateBvbCapturedDisplay();
    if (finalData.score !== undefined) updateEvalBar(finalData.score, finalData.mate);

    document.getElementById('bvb-thinking').classList.remove('show');

    if (bvbGame.game_over()) { bvbHandleGameOver(); return; }

    updateBvbTurnDot(bvbGame.turn());
    bvbLoopTimeout = setTimeout(() => bvbNextMove(), bvbState.delay);

  } catch(e) {
    document.getElementById('bvb-thinking').classList.remove('show');
    setBvbStatus('⚠ ' + e.message + ' — retrying…');
    // network hiccup par loop permanently mat roko, 2s baad retry
    if (bvbState.active && !bvbState.paused) {
      bvbLoopTimeout = setTimeout(() => bvbNextMove(), 2000);
    }
  }
}

// ── Game over ─────────────────────────────────────────────────

function bvbHandleGameOver() {
  stopBvbClock();
  bvbState.active = false;
  hideBvbTurnDots();
  document.getElementById('bvb-nav-row').classList.remove('disabled');

  const blackBotName = document.getElementById('clock-bot-label').textContent.replace('♟ ', '').trim();
  const whiteBotName = document.getElementById('clock-player-label').textContent.replace('♙ ', '').trim();

  let title, reason;
  if (bvbGame.in_checkmate()) {
    const winnerName = bvbGame.turn() === 'w' ? blackBotName : whiteBotName;
    title  = '🏁 ' + winnerName + ' wins!';
    reason = 'Checkmate';
  } else if (bvbGame.in_stalemate()) {
    title = '½ Draw'; reason = 'Stalemate';
  } else if (bvbGame.in_threefold_repetition()) {
    title = '½ Draw'; reason = 'Threefold repetition';
  } else if (bvbGame.insufficient_material()) {
    title = '½ Draw'; reason = 'Insufficient material';
  } else {
    title = 'Game Over'; reason = '';
  }

  setBvbStatus(title);
  const banner = document.getElementById('bvb-game-over-banner');
  document.getElementById('bvb-game-over-title').textContent  = title;
  document.getElementById('bvb-game-over-reason').textContent = reason;
  banner.style.display = 'flex';

  bvbWhiteEngine.onGameEnd(bvbGame);
  bvbBlackEngine.onGameEnd(bvbGame);
  document.getElementById('copy-pgn-btn').classList.add('show', 'pulse');

  if (bvbGame.history().length > 0) saveBvbGameToHistory(title, reason, whiteBotName, blackBotName);

  // Dono bots ki estimated ELO update karo (same formula as player)
  {
    let _res = '*';
    if (bvbGame.in_checkmate()) _res = bvbGame.turn() === 'w' ? '0-1' : '1-0';
    else if (bvbGame.in_draw && bvbGame.in_draw()) _res = '1/2-1/2';
    if (_res !== '*') { try { _reportBvbResult(_res); } catch(e) {} }
  }

  // Tournament hook — Championship knockout continuation
  if (window.tourOnBvbGameOver) { try { tourOnBvbGameOver(); } catch(e) {} }
  // Duo Fight hook
  if (window.duoOnBvbGameOver) { try { duoOnBvbGameOver(); } catch(e) {} }
}

// ── Bot vs Bot ELO report ─────────────────────────────────────

function _reportBvbResult(result) {
  if (!result) return;
  const wId = bvbState.whiteBotId, bId = bvbState.blackBotId;
  if (!wId || !bId || wId === bId) return;
  fetch(`${FLASK_URL}/play/bvb-result`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ white_id: wId, black_id: bId, result }),
  }).catch(() => {});
}

// ── Save to history ───────────────────────────────────────────

async function saveBvbGameToHistory(title, reason, whiteName, blackName, forceResult) {
  let result = '*', winner = null;
  if (forceResult) {
    // time-out ya koi aur forced result (caller ne explicitly diya)
    result = forceResult;
    winner = forceResult === '1-0' ? 'white' : forceResult === '0-1' ? 'black' : 'draw';
  } else if (bvbGame.in_checkmate()) {
    const winnerColor = bvbGame.turn() === 'w' ? 'black' : 'white';
    winner = winnerColor;
    result = winnerColor === 'white' ? '1-0' : '0-1';
  } else if (bvbGame.in_draw && bvbGame.in_draw()) {
    result = '1/2-1/2'; winner = 'draw';
  } else if (/Draw/i.test(title)) {
    result = '1/2-1/2'; winner = 'draw';
  } else if (/wins/i.test(title)) {
    winner = title.includes(whiteName) ? 'white' : 'black';
    result = winner === 'white' ? '1-0' : '0-1';
  }

  const payload = {
    mode:         'botvsbot',
    result,
    winner,
    reason:       reason || '',
    title:        title  || '',
    white_name:   whiteName,
    black_name:   blackName,
    white_bot_id: bvbState.whiteBotId,
    black_bot_id: bvbState.blackBotId,
    player_color: null,
    pgn:          _bvbInjectClkComments(bvbGame.pgn({ result: result }), bvbState.moveLog),   // ✅ clock comments + result
    fen_final:    bvbGame.fen(),
    time_control: bvbState.timeControl
      ? { minutes: Math.round((bvbState.whiteMs + bvbState.blackMs) > 0 ? (bvbState.whiteMs || bvbState.blackMs) / 60000 : 0) }
      : null,
    white_time_left_ms: bvbState.whiteMs,
    black_time_left_ms: bvbState.blackMs,
    moves: bvbState.moveLog || [],
  };

  try {
    await fetch(`${FLASK_URL}/play/history`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } catch(e) { /* ignore */ }
}

// ── Pause / Resume ────────────────────────────────────────────

function bvbPauseResume() {
  if (!bvbState.active) return;
  bvbState.paused = !bvbState.paused;
  const btn = document.getElementById('bvb-pause-btn');
  if (bvbState.paused) {
    btn.textContent = '▶ Resume';
    if (bvbLoopTimeout) { clearTimeout(bvbLoopTimeout); bvbLoopTimeout = null; }
    stopBvbClock();
    setBvbStatus('⏸ Paused');
    bvbState._pauseStartedAt = Date.now();
    document.getElementById('bvb-nav-row').classList.remove('disabled');
  } else {
    btn.textContent = '⏸ Pause';
    if (bvbState._pauseStartedAt) {
      bvbState._pausedAccum = (bvbState._pausedAccum || 0) + (Date.now() - bvbState._pauseStartedAt);
      bvbState._pauseStartedAt = null;
    }
    setBvbStatus('');
    bvbBrowseLive();
    document.getElementById('bvb-nav-row').classList.add('disabled');
    if (bvbState.timeControl) startBvbClock();
    bvbNextMove();
  }
}

// ── Stop match ────────────────────────────────────────────────

function bvbStopMatch() {
  if (!confirm('Match rok dein?')) return;
  bvbState.active = false;
  bvbState.paused = false;
  if (bvbLoopTimeout) { clearTimeout(bvbLoopTimeout); bvbLoopTimeout = null; }
  stopBvbClock();
  document.getElementById('bvb-ingame-controls').style.display = 'none';
  document.getElementById('play-subnav').style.display = 'flex';
  document.getElementById('play-page-botvsbot').classList.add('active');
  document.getElementById('sb-botvsbot').classList.add('active');
  document.getElementById('sb-makebot').classList.remove('active');
  document.getElementById('sb-playbot').classList.remove('active');
  document.getElementById('clock-top-row').classList.remove('show');
  document.getElementById('clock-bottom-row').classList.remove('show');
  document.getElementById('copy-pgn-btn').classList.remove('show', 'pulse');
  document.getElementById('cap-top-pieces').innerHTML = '';
  document.getElementById('cap-bottom-pieces').innerHTML = '';
  document.getElementById('cap-top-adv').textContent = '';
  document.getElementById('cap-bottom-adv').textContent = '';
  hideAllDialogueBubbles();
  hideBvbTurnDots();
  bvbBrowseIdx = -1;
  updatePlayBoardVisibility();
}

// ── Move browse (while paused / after game over) ──────────────

function _bvbCanBrowse() {
  return bvbState.paused || !bvbState.active;
}

function _bvbHistory() {
  return bvbGame ? bvbGame.history({ verbose: true }) : [];
}

function _bvbApplyBrowseIdx(idx) {
  const hist  = _bvbHistory();
  const label = document.getElementById('bvb-browse-label');
  if (idx < 0 || hist.length === 0) {
    const tmp = new Chess();
    board.position(tmp.fen());
    updateBvbCapturedDisplay(tmp);
    clearArrows();
    label.textContent = hist.length ? `Start position (${hist.length} moves played)` : '';
    return;
  }
  idx = Math.min(idx, hist.length - 1);
  const tmp = new Chess();
  for (let i = 0; i <= idx; i++) tmp.move(hist[i].san);
  board.position(tmp.fen());
  updateBvbCapturedDisplay(tmp);
  clearArrows();
  const last = hist[idx];
  if (last) drawArrowSVG(last.from, last.to, 'ah-last', 'rgba(128,128,128,0.9)');
  const viewingLive = (idx === hist.length - 1);
  label.textContent = viewingLive ? 'Live position' : `Move ${idx + 1} of ${hist.length}`;
}

function bvbBrowseStart() {
  if (!_bvbCanBrowse()) return;
  bvbBrowseIdx = -1;
  _bvbApplyBrowseIdx(bvbBrowseIdx);
}

function bvbBrowsePrev() {
  if (!_bvbCanBrowse()) return;
  const hist = _bvbHistory();
  if (hist.length === 0) return;
  if (bvbBrowseIdx === -1) bvbBrowseIdx = hist.length - 1;
  bvbBrowseIdx = Math.max(-1, bvbBrowseIdx - 1);
  _bvbApplyBrowseIdx(bvbBrowseIdx);
}

function bvbBrowseNext() {
  if (!_bvbCanBrowse()) return;
  const hist = _bvbHistory();
  if (hist.length === 0) return;
  if (bvbBrowseIdx >= hist.length - 1) return;
  bvbBrowseIdx = bvbBrowseIdx + 1;
  _bvbApplyBrowseIdx(bvbBrowseIdx);
}

function bvbBrowseLive() {
  bvbBrowseIdx = -1;
  if (bvbGame) {
    board.position(bvbGame.fen());
    updateBvbCapturedDisplay();
    clearArrows();
    const hist = _bvbHistory();
    const last = hist.length ? hist[hist.length - 1] : null;
    if (last) {
      const svg = document.getElementById('arrow-svg');
      [...svg.children].forEach(el => { if (el.tagName !== 'defs') el.remove(); });
      drawArrowSVG(last.from, last.to, 'ah-last', 'rgba(128,128,128,0.9)');
    }
  }
  const label = document.getElementById('bvb-browse-label');
  if (label) label.textContent = '';
}

// ── BvB Clock ─────────────────────────────────────────────────

function startBvbClock() {
  stopBvbClock();
  let lastTick = Date.now();
  bvbState.clockInterval = setInterval(() => {
    if (!bvbState.active || bvbState.paused) { lastTick = Date.now(); return; }
    const now  = Date.now();
    const diff = now - lastTick;
    lastTick   = now;
    const turn = bvbGame ? bvbGame.turn() : 'w';

    if (turn === 'w') {
      bvbState.whiteMs = Math.max(0, bvbState.whiteMs - diff);
      if (bvbState.whiteMs === 0) {
        bvbState.active = false; stopBvbClock(); hideBvbTurnDots();
        document.getElementById('bvb-nav-row').classList.remove('disabled');
        const blackBotName = document.getElementById('clock-bot-label').textContent.replace('♟ ', '').trim();
        const whiteBotName = document.getElementById('clock-player-label').textContent.replace('♙ ', '').trim();
        const timeTitle = '🏁 ' + blackBotName + ' wins';
        setBvbStatus(timeTitle + ' on time');
        document.getElementById('bvb-game-over-title').textContent  = timeTitle;
        document.getElementById('bvb-game-over-reason').textContent = whiteBotName + ' ran out of time';
        document.getElementById('bvb-game-over-banner').style.display = 'flex';
        if (bvbGame.history().length > 0) saveBvbGameToHistory(timeTitle, whiteBotName + ' ran out of time', whiteBotName, blackBotName, '0-1');
        try { _reportBvbResult('0-1'); } catch(e) {}
        // Tournament hook
        if (window.tourOnBvbGameOver) { try { tourOnBvbGameOver(); } catch(e) {} }
        // Duo Fight hook
        if (window.duoOnBvbGameOver) { try { duoOnBvbGameOver(); } catch(e) {} }
        return;
      }
    } else {
      bvbState.blackMs = Math.max(0, bvbState.blackMs - diff);
      if (bvbState.blackMs === 0) {
        bvbState.active = false; stopBvbClock(); hideBvbTurnDots();
        document.getElementById('bvb-nav-row').classList.remove('disabled');
        const blackBotName = document.getElementById('clock-bot-label').textContent.replace('♟ ', '').trim();
        const whiteBotName = document.getElementById('clock-player-label').textContent.replace('♙ ', '').trim();
        const timeTitle = '🏁 ' + whiteBotName + ' wins';
        setBvbStatus(timeTitle + ' on time');
        document.getElementById('bvb-game-over-title').textContent  = timeTitle;
        document.getElementById('bvb-game-over-reason').textContent = blackBotName + ' ran out of time';
        document.getElementById('bvb-game-over-banner').style.display = 'flex';
        if (bvbGame.history().length > 0) saveBvbGameToHistory(timeTitle, blackBotName + ' ran out of time', whiteBotName, blackBotName, '1-0');
        try { _reportBvbResult('1-0'); } catch(e) {}
        // Tournament hook
        if (window.tourOnBvbGameOver) { try { tourOnBvbGameOver(); } catch(e) {} }
        // Duo Fight hook
        if (window.duoOnBvbGameOver) { try { duoOnBvbGameOver(); } catch(e) {} }
        return;
      }
    }
    updateBvbClocks();
  }, 200);
}

function stopBvbClock() {
  if (bvbState.clockInterval) {
    clearInterval(bvbState.clockInterval);
    bvbState.clockInterval = null;
  }
}
