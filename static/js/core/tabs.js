// ============================================================
// tabs.js — Tab switching, keyboard shortcuts, play globals,
//            bot management, player profile, file import
// ============================================================


  // Tabs
  // ── Analysis board snapshot — saved whenever we leave the Analysis tab
  // so that switching to Review (or Play) and back never corrupts the
  // Analysis position.
  let _analysisBoardSnapshot = null;
  const _flipMemory = {};   // tab name -> boardFlipped (per-tab board orientation)

  function _saveAnalysisSnapshot() {
    _analysisBoardSnapshot = {
      fen:          game.fen(),
      moveIdx:      currentMoveIdx,
      varTree:      JSON.parse(JSON.stringify(varTree)),
      activeVarId:  activeVarId,
      startFen:     startFen,
      moveHistory:  JSON.parse(JSON.stringify(moveHistory)),
      boardFlipped: boardFlipped,
      // Arrows bhi save karo taaki wapas aane par sahi jagah redraw ho sakein
      arrowBest:    window._arrowBest ? {...window._arrowBest} : null,
      arrowLast:    window._arrowLast ? {...window._arrowLast} : null,
    };
  }

  function _restoreAnalysisSnapshot() {
    if (!_analysisBoardSnapshot) {
      board.position(game.fen(), false);
      return;
    }
    const s = _analysisBoardSnapshot;
    // Physical board ki ACTUAL orientation yaad rakho. Upar wala per-tab
    // flip-memory block shayad board.flip() kar chuka hoga, lekin snapshot
    // ke arrows uss orientation ke liye save hain jis mein snapshot bana tha.
    // Variable + physical board match karna zaroori hai warna arrows mirror
    // ho jaati hain (white ka arrow black par draw hota tha).
    const physFlipped = boardFlipped;
    game.load(s.fen);
    currentMoveIdx = s.moveIdx;
    varTree        = s.varTree;
    activeVarId    = s.activeVarId;
    startFen       = s.startFen;
    moveHistory    = s.moveHistory;
    boardFlipped   = s.boardFlipped;
    // Arrows restore karo (board.position ke baad redraw karenge)
    window._arrowBest = s.arrowBest || null;
    window._arrowLast = s.arrowLast || null;
    // Physical board ko snapshot ki orientation par wapas lao agar mismatch hai
    if (boardFlipped !== physFlipped) {
      board.flip();
      setTimeout(attachBoardTapHandlers, 80);
    }
    board.position(s.fen, false);
    // Board rebuild hone do, phir arrows redraw karo sahi coordinates par
    setTimeout(() => redrawArrows(), 60);
  }

  // Track which tab is currently visible
  let _currentTab = 'analysis';
  let _settingsTabInited = false;   // Settings tab sirf ek baar init ho

  function switchTab(name) {
    if (setupMode && name !== 'analysis') setupCancel();

    // ── Per-tab board flip memory ──────────────────────────────
    // Ek tab ka flip dusre tab ke board ko affect na kare.
    if (_currentTab && typeof boardFlipped !== 'undefined') {
      _flipMemory[_currentTab] = boardFlipped;
    }

    // ── Tournament bot-match: tab switch par auto-pause ───────
    // Warna background mein moves chalte rehte hain aur personality
    // bubbles dusre tabs mein bhi dikhte hain.
    if (name !== 'play' && typeof bvbState !== 'undefined' &&
        bvbState && bvbState.active && !bvbState.paused && window._tourBvbCtx) {
      try { bvbPauseResume(); } catch(e) {}
    }
    const _wantFlip = _flipMemory[name] ?? false;
    // Settings tab par flip ka KOI effect nahi — board jis orientation mein
    // hai waisi hi rehti hai (Settings sirf starting position dikhata hai).
    // Pehle yahan forced flip ho raha tha jisse wapas aane par arrows galat
    // coordinates par redraw ho jaate the.
    if (name !== 'settings' && _wantFlip !== boardFlipped) {
      board.flip();
      boardFlipped = _wantFlip;
      setTimeout(attachBoardTapHandlers, 80);
    }

    // Save Analysis snapshot whenever we leave the Analysis/PGN/FEN tabs
    // (ye teeno ek hi Analysis board share karte hain)
    const ANALYSIS_TABS = ['analysis', 'pgn', 'fen'];
    if (ANALYSIS_TABS.includes(_currentTab) && !ANALYSIS_TABS.includes(name)) {
      _saveAnalysisSnapshot();
    }

    const names = ['analysis', 'pgn', 'fen', 'play', 'review', 'settings'];
    // Update bottom nav active state
    names.forEach(n => {
      const el = document.getElementById('nav-' + n);
      if (el) el.classList.toggle('active', n === name);
    });
    // Show/hide content panels
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.getElementById('tab-' + name).classList.add('active');

    // Keep Analysis and Play boards/state fully separate — switching tabs
    // must not leak the other tab's position, arrows, or highlights.
    hideAllDialogueBubbles();
    clearArrows();
    clearHighlights();
    clearTapSelection();
    if (typeof clearPlayTapSelection === 'function') clearPlayTapSelection();

    // Review classification badge — sirf review tab ke movebymove phase mein dikhna chahiye,
    // dusre tabs pe switch karne par hide karo.
    const _rvClassRow = document.getElementById('rv-classification-row');
    if (_rvClassRow) {
      if (name !== 'review') {
        _rvClassRow.style.display = 'none';
      } else if (rvState && rvState.phase === 'movebymove') {
        _rvClassRow.style.display = '';
      }
      // Agar review tab pe aaye aur movebymove phase nahi hai toh rvShowPhase handle karega
    }

    if (name === 'play') {
      document.body.classList.remove('review-readonly');
      document.body.classList.remove('review-board-hidden');
      document.getElementById('analysis-top-row').classList.remove('show');
      document.getElementById('analysis-bottom-row').classList.remove('show');
      // Puzzle session active hai to puzzle ki position wapas lao,
      // warna normal play game ki position dikhao
      if (typeof pzState !== 'undefined' && pzState && pzState.active) {
        board.position(pzState.game.fen());
        if (typeof pzOnPlayTabReturn === 'function') pzOnPlayTabReturn();
      } else {
        board.position(playGame.fen());
      }
      onPlayTabOpen();
      // Tournament bot-match wapas auto-resume
      if (typeof bvbState !== 'undefined' && bvbState && bvbState.active && bvbState.paused && window._tourBvbCtx) {
        try { bvbPauseResume(); } catch(e) {}
      }
      if (playState.active) document.getElementById('copy-pgn-btn').classList.add('show');
      // Active game (Play vs Bot / BvB / tournament) ka in-game UI restore karo —
      // tab switch par clock rows hide ho jaate the, wapas aane par wahi dikhein
      const _tourSubOpen = ['tournaments', 'history'].some(p => {
        const el = document.getElementById('play-page-' + p);
        return el && el.classList.contains('active');
      });
      const _pgActive = typeof playState !== 'undefined' && playState && playState.active && playState.status === 'playing';
      const _bvActive = typeof bvbState !== 'undefined' && bvbState && bvbState.active;
      const _frActive = typeof frState !== 'undefined' && frState && frState.active;
      if (!_tourSubOpen && (_pgActive || _bvActive || _frActive)) {
        document.getElementById('clock-top-row').classList.add('show');
        document.getElementById('clock-bottom-row').classList.add('show');
        const _tc = _frActive ? frState.timeControl : (_bvActive ? bvbState.timeControl : playState.timeControl);
        document.getElementById('clock-player-time').style.display = _tc ? '' : 'none';
        document.getElementById('clock-bot-time').style.display = _tc ? '' : 'none';
        if (_frActive) {
          if (typeof frUpdateCapturedDisplay === 'function') frUpdateCapturedDisplay();
          if (typeof frUpdateClocks === 'function') frUpdateClocks();
          if (typeof frUpdateLabelsAndClocks === 'function') frUpdateLabelsAndClocks();
        } else if (_bvActive) {
          if (typeof updateBvbCapturedDisplay === 'function') updateBvbCapturedDisplay();
          if (typeof updateBvbClocks === 'function') updateBvbClocks();
        } else {
          if (typeof updateCapturedDisplay === 'function') updateCapturedDisplay();
          if (typeof updateClocks === 'function') updateClocks();
        }
      }
      updatePlayBoardVisibility();
    } else if (name === 'review') {
      document.body.classList.add('review-readonly');
      document.getElementById('analysis-top-row').classList.remove('show');
      document.getElementById('analysis-bottom-row').classList.remove('show');
      document.getElementById('clock-top-row').classList.remove('show');
      document.getElementById('clock-bottom-row').classList.remove('show');
      document.getElementById('copy-pgn-btn').classList.remove('show', 'pulse');
      // Show review board position if in move-by-move mode; otherwise
      // keep the chessboard hidden until analysis is actually done.
      if (rvState.moves && rvState.moves.length > 0 && rvState.phase === 'movebymove') {
        document.body.classList.remove('review-board-hidden');
        document.body.classList.remove('play-board-hidden');
        rvSetupPlayerRows();
        rvShowCurrentMove(true);
      } else {
        document.body.classList.add('review-board-hidden');
      }
    } else if (name === 'settings') {
      // Settings tab — play/review UI states clean karo, analysis board ko touch mat karo
      document.body.classList.remove('review-board-hidden');
      document.body.classList.remove('play-board-hidden');
      document.getElementById('clock-top-row').classList.remove('show');
      document.getElementById('clock-bottom-row').classList.remove('show');
      document.getElementById('copy-pgn-btn').classList.remove('show', 'pulse');
      // Settings apni alag jagah hai — hamesha STARTING POSITION dikhao,
      // bilkul read-only (koi tap/drag nahi). Analysis/PGN/FEN ki position,
      // arrows ya highlights se koi matlab nahi — unka snapshot upar save
      // ho chuka hai, wapas jaate waqt _restoreAnalysisSnapshot() wapas
      // laa dega.
      document.body.classList.add('review-readonly');
      document.getElementById('analysis-top-row').classList.remove('show');
      document.getElementById('analysis-bottom-row').classList.remove('show');
      window._arrowLast = null;
      window._arrowBest = null;
      window._suggestionArrow = null;
      clearTapSelection();
      board.position('start');
      // Pehli baar khulne par init (dropdown + pickers wire)
      if (!_settingsTabInited && typeof initSettingsTab === 'function') {
        _settingsTabInited = true;
        try { initSettingsTab(); } catch(e) { console.error('initSettingsTab failed', e); }
      }
    } else {
      // Returning to Analysis / PGN / FEN
      document.body.classList.remove('review-readonly');
      document.body.classList.remove('play-board-hidden');
      document.body.classList.remove('review-board-hidden');
      document.getElementById('copy-pgn-btn').classList.remove('show', 'pulse');
      // Hide play-tab clock/name rows — ye sirf Play tab pe dikhne chahiye
      document.getElementById('clock-top-row').classList.remove('show');
      document.getElementById('clock-bottom-row').classList.remove('show');
      // Snapshot sirf tab restore karo jab Play/Review se aa rahe ho.
      // PGN ↔ Analysis ↔ FEN switch mein restore mat karo — yahi position reset ka bug tha.
      const ANALYSIS_TABS = ['analysis', 'pgn', 'fen'];
      if (!ANALYSIS_TABS.includes(_currentTab)) {
        _restoreAnalysisSnapshot();
      } else {
        // Sirf board ko current game state se sync karo (bina snapshot ke)
        board.position(game.fen(), false);
      }
      // PGN tab pe aane par moves list refresh karo
      if (name === 'pgn') {
        updatePGNMoves();
      }
      // Restore analysis names/clock/captured pieces ONLY if they were
      // explicitly loaded into analysis (e.g. via "Analyze" from history).
      // Never bleed play-tab player/bot names into analysis rows.
      if (analysisPlayerInfo && analysisPlayerInfo._fromAnalysisLoad) {
        _restoreAnalysisPlayerRows();
      } else {
        // Reset to default neutral labels and show rows
        document.getElementById('analysis-label-top').textContent     = '♟ Black';
        document.getElementById('analysis-label-bottom').textContent  = '♙ White';
        document.getElementById('analysis-time-top').style.display    = 'none';
        document.getElementById('analysis-time-bottom').style.display = 'none';
        document.getElementById('analysis-cap-top-pieces').innerHTML  = '';
        document.getElementById('analysis-cap-bottom-pieces').innerHTML = '';
        document.getElementById('analysis-cap-top-adv').textContent   = '';
        document.getElementById('analysis-cap-bottom-adv').textContent = '';
        document.getElementById('analysis-top-row').classList.add('show');
        document.getElementById('analysis-bottom-row').classList.add('show');
      }
    }

    _currentTab = name;
    // Puzzle HUD pause/show handle karo jab bhi tab switch ho
    if (typeof pzOnTabSwitch === 'function') pzOnTabSwitch(name);
    // Update move card visibility when switching tabs
    _renderMoveCards();
  }

  // Check backend connection
  async function checkConnection() {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);
      const res = await fetch(`${FLASK_URL}/ping`, { signal: controller.signal });
      clearTimeout(timeoutId);
      const data = await res.json();
      document.getElementById('status-dot').classList.add('connected');
      document.getElementById('status-text').textContent = 'Engine ready · ' + (data.engine || 'Stockfish');
    } catch(e) {
      document.getElementById('status-dot').classList.remove('connected');
      document.getElementById('status-text').textContent = 'Engine offline – start chess.py';
    }
  }

  // Keyboard navigation (arrow keys like chess.com)
  document.addEventListener('keydown', (e) => {
    // Don't intercept when typing in textarea/input
    if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;
    if (e.key === 'ArrowLeft')  { e.preventDefault(); prevMove(); }
    if (e.key === 'ArrowRight') { e.preventDefault(); nextMove(); }
    if (e.key === 'ArrowUp')    { e.preventDefault(); goToStart(); }
    if (e.key === 'ArrowDown')  { e.preventDefault(); goToEnd(); }
  });

  // Init
  updateFENDisplay();
  checkConnection();
  loadPlayerProfile();
  setInterval(checkConnection, 10000);

  // ============================================================
  //  SETTINGS TAB — piece style + board colors
  // ============================================================

  // Appearance backend save helper — fire-and-forget, localStorage bhi update
  function saveAppearance(pieceSet, sqLight, sqDark) {
    localStorage.setItem('pieceSet', pieceSet);
    localStorage.setItem('sqLight', sqLight);
    localStorage.setItem('sqDark', sqDark);
    try {
      fetch('/api/appearance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pieceSet, sqLight, sqDark })
      });
    } catch(e) { /* offline — localStorage bachega */ }
  }

  async function initSettingsTab() {
    // 1. Flask se piece set list fetch karo
    let sets = ['wikipedia'];
    try {
      const res = await fetch('/api/piece-sets');
      sets = await res.json();
      if (!Array.isArray(sets) || !sets.length) sets = ['wikipedia'];
    } catch(e) { /* offline — fallback */ }

    // 2. Dropdown populate karo
    const sel = document.getElementById('piece-set-select');
    sel.innerHTML = '';
    const saved = localStorage.getItem('pieceSet') || 'wikipedia';
    sets.forEach(name => {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      if (name === saved) opt.selected = true;
      sel.appendChild(opt);
    });
    // Saved set list mein nahi hai toh pehla option dikhao
    if (!sets.includes(saved)) {
      sel.value = sets[0];
      updatePiecePreview(sets[0]);
    }

    // 3. Preview images current selection ke liye
    updatePiecePreview(sel.value);

    // 4. Dropdown change -> preview + board dono update
    sel.addEventListener('change', () => {
      const chosen = sel.value;
      updatePiecePreview(chosen);
      if (typeof window.applyPieceSet === 'function') window.applyPieceSet(chosen);
      saveAppearance(chosen, lightPicker.value, darkPicker.value);
    });

    // 5. Board color pickers (+ hex paste support)
    const lightPicker = document.getElementById('sq-light-picker');
    const darkPicker  = document.getElementById('sq-dark-picker');
    const lightHex    = document.getElementById('sq-light-hex');
    const darkHex     = document.getElementById('sq-dark-hex');
    lightPicker.value = localStorage.getItem('sqLight') || '#f0e9d2';
    darkPicker.value  = localStorage.getItem('sqDark')  || '#7c5c3e';
    lightHex.value = lightPicker.value;
    darkHex.value  = darkPicker.value;

    // "#b8905f", "b8905f", full uppercase — sab accept karo
    const _parseHex = v => {
      v = (v || '').trim();
      if (!v) return null;
      if (!v.startsWith('#')) v = '#' + v;
      return /^[0-9a-fA-F]{6}$/.test(v.slice(1)) ? v.toLowerCase() : null;
    };
    const _setLight = hex => {
      document.documentElement.style.setProperty('--sq-light', hex);
      saveAppearance(sel.value, hex, darkPicker.value);
    };
    const _setDark = hex => {
      document.documentElement.style.setProperty('--sq-dark', hex);
      saveAppearance(sel.value, lightPicker.value, hex);
    };

    lightPicker.addEventListener('input', e => {
      lightHex.value = e.target.value;
      _setLight(e.target.value);
    });
    darkPicker.addEventListener('input', e => {
      darkHex.value = e.target.value;
      _setDark(e.target.value);
    });

    // Hex text field — paste/type karke color code apply
    lightHex.addEventListener('change', () => {
      const hex = _parseHex(lightHex.value);
      if (hex) { lightPicker.value = hex; _setLight(hex); }
      else lightHex.value = lightPicker.value;
    });
    darkHex.addEventListener('change', () => {
      const hex = _parseHex(darkHex.value);
      if (hex) { darkPicker.value = hex; _setDark(hex); }
      else darkHex.value = darkPicker.value;
    });

    // 6. Reset button — default colors
    document.getElementById('sq-reset-btn').addEventListener('click', () => {
      const dl = '#f0e9d2', dd = '#7c5c3e';
      lightPicker.value = dl;
      darkPicker.value  = dd;
      lightHex.value = dl;
      darkHex.value  = dd;
      document.documentElement.style.setProperty('--sq-light', dl);
      document.documentElement.style.setProperty('--sq-dark',  dd);
      saveAppearance(sel.value, dl, dd);
    });
  }

  function updatePiecePreview(setName) {
    const ext = (setName === 'wikipedia') ? 'png' : 'svg';
    ['wK','wQ','wR','wB','wN','wP'].forEach(p => {
      const img = document.getElementById('preview-' + p);
      if (img) img.src = `img/chesspieces/${setName}/${p}.${ext}`;
    });
  }


  // ═══════════════════════════════════════════════════════════════
  //  PLAY TAB — Full Implementation
  // ═══════════════════════════════════════════════════════════════

  // ── State ──────────────────────────────────────────────────────
  // (playState and HASH_MAP declared at top of script)

  let playGame = new Chess();  // separate game instance for play mode
  let playBotThinking = false;
  // Promise<string|null> for the in-flight classification of the player's
  // last move (Best/Excellent/Good/Inaccuracy/Mistake/Blunder/...), used to
  // feed the personality engine's player_* triggers.
  let pendingPlayerMoveQuality = Promise.resolve(null);
  let clockInterval   = null;

  // Arrow state for play mode (separate from analyzer)
  let _playArrowHint    = null;
  let _playArrowThreat  = null;
  let _playArrowLast    = null;

  // ── UI helpers ─────────────────────────────────────────────────

  function updateHashDisplay(v) {
    document.getElementById('sv-hash').textContent = HASH_MAP[parseInt(v)] || 16;
  }

  function toggleEloVisibility() {
    const on = document.getElementById('tog-limitstrength').checked;
    document.getElementById('elo-field').style.display = on ? '' : 'none';
  }

  function toggleTimeInput() {
    const on = document.getElementById('tog-timecontrol').checked;
    document.getElementById('time-input-field').style.display = on ? '' : 'none';
  }

  function selectColor(c) {
    ['white','black','random'].forEach(x => {
      document.getElementById('pill-' + x).classList.toggle('selected', x === c);
    });
  }

  function getSelectedColor() {
    if (document.getElementById('pill-white').classList.contains('selected')) return 'white';
    if (document.getElementById('pill-black').classList.contains('selected')) return 'black';
    return 'random';
  }

  function playSubSwitch(page) {
    ['makebot','playbot','botvsbot','friend','tournaments','history','puzzles','lichess','ranking'].forEach(p => {
      const sb = document.getElementById('sb-' + p);
      const pg = document.getElementById('play-page-' + p);
      if (sb) sb.classList.toggle('active', p === page);
      if (pg) pg.classList.toggle('active', p === page);
    });
    // Refresh tournaments view when opening that page
    if (page === 'tournaments' && typeof renderTournaments === 'function') {
      try { renderTournaments(); } catch(e) {}
    }
    // Hide bvb ingame controls when switching away
    document.getElementById('bvb-ingame-controls').style.display = 'none';
    // If switching back to setup pages, hide in-game controls (unless game active)
    if (!playState.active) {
      document.getElementById('ingame-controls').classList.remove('show');
      document.getElementById('play-subnav').style.display = 'flex';
      document.getElementById('copy-pgn-btn').classList.remove('show', 'pulse');
      document.getElementById('clock-top-row').classList.remove('show');
      document.getElementById('clock-bottom-row').classList.remove('show');
    }
    // Populate bot selects when switching to botvsbot
    if (page === 'botvsbot') populateBvbSelects();
    // Load leaderboard when switching to ranking
    if (page === 'ranking' && typeof renderLeaderboard === 'function') { try { renderLeaderboard(); } catch(e) {} }
    // Load history list when switching to history
    if (page === 'history') { closeHistoryDetail(); renderHistoryList(); renderImportedList(); }
    // Load puzzle list + stats when switching to puzzles
    if (page === 'puzzles' && typeof pzRefreshUI === 'function') pzRefreshUI();
    // Refresh Lichess profile link when switching to lichess hub
    if (page === 'lichess' && typeof lcRefreshProfileLink === 'function') lcRefreshProfileLink();

    updatePlayBoardVisibility();
  }

  function setPlayStatus(msg) {
    document.getElementById('play-status-msg').textContent = msg;
  }

  function showBotThinking(v) {
    document.getElementById('bot-thinking').classList.toggle('show', v);
  }

  function showGameOver(title, reason) {
    const b = document.getElementById('game-over-banner');
    document.getElementById('game-over-title').textContent   = title;
    document.getElementById('game-over-reason').textContent  = reason;
    b.classList.add('show');
    setPlayStatus(title);

    // Bug 5 fix: game over ke baad setup page overlap na ho
    // ingame-controls visible rehne chahiye (New Game button etc.), subnav dikhao
    document.getElementById('play-subnav').style.display = 'flex';

    // Pop the copy-PGN icon to draw attention now that the game is over
    const copyBtn = document.getElementById('copy-pgn-btn');
    copyBtn.classList.add('show', 'pulse');
  }

  function formatClock(ms) {
    const totalSec = Math.max(0, Math.floor(ms / 1000));
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return m + ':' + String(s).padStart(2, '0');
  }

  function updateClocks() {
    const pEl = document.getElementById('clock-player-time');
    const bEl = document.getElementById('clock-bot-time');
    pEl.textContent = formatClock(playState.playerMs);
    bEl.textContent = formatClock(playState.botMs);
    const pLow = playState.playerMs < 30000;
    const bLow = playState.botMs < 30000;
    pEl.classList.toggle('low', pLow);
    bEl.classList.toggle('low', bLow);
    document.getElementById('clock-player').classList.toggle('low', pLow);
    document.getElementById('clock-bot').classList.toggle('low', bLow);

    // Active clock highlight
    const isPlayerTurn = (playGame.turn() === playState.playerColor);
    document.getElementById('clock-player').classList.toggle('active', isPlayerTurn && !pLow);
    document.getElementById('clock-bot').classList.toggle('active',    !isPlayerTurn && !bLow);
  }

  function startClock() {
    if (!playState.timeControl) return;
    stopClock();
    let lastTick = Date.now();
    clockInterval = setInterval(() => {
      if (!playState.active) { lastTick = Date.now(); return; }
      const now  = Date.now();
      const diff = now - lastTick;
      lastTick = now;
      const isPlayerTurn = (playGame.turn() === playState.playerColor);
      if (isPlayerTurn && !playBotThinking) {
        playState.playerMs = Math.max(0, playState.playerMs - diff);
        if (playState.playerMs === 0) { endGame(`🏁 ${playState.botName || 'Bot'} wins!`, 'You ran out of time'); return; }
      } else if (!isPlayerTurn) {
        playState.botMs = Math.max(0, playState.botMs - diff);
        if (playState.botMs === 0) { endGame('🎉 You win!', 'Bot ran out of time'); return; }
      }
      updateClocks();
    }, 200);
  }

  function stopClock() {
    if (clockInterval) { clearInterval(clockInterval); clockInterval = null; }
  }

  // ── Bot management ─────────────────────────────────────────────

  async function fetchBots() {
    try {
      const res = await fetch(`${FLASK_URL}/play/bots`);
      const data = await res.json();
      return data.bots || [];
    } catch(e) { return []; }
  }

  // ── Player Profile (name + ELO) ─────────────────────────────────

  function updateEloChip() {
    document.getElementById('elo-chip-name').textContent   = playerProfile.name || 'Player';
    document.getElementById('elo-chip-rating').textContent = playerProfile.elo  ?? 1200;
  }

  async function loadPlayerProfile() {
    try {
      const res = await fetch(`${FLASK_URL}/play/player`);
      const data = await res.json();
      if (data.player) {
        playerProfile = data.player;
        document.getElementById('player-name').value = playerProfile.name || 'Player';
        document.getElementById('player-elo').value  = playerProfile.elo  ?? 1200;
        document.getElementById('player-other-names').value = (playerProfile.other_names || []).join(', ');
        document.getElementById('player-games-played').textContent = playerProfile.games_played ?? 0;
        updateEloChip();
      }
    } catch(e) { /* keep defaults */ }
  }

  async function savePlayerProfile() {
    const name = document.getElementById('player-name').value.trim();
    const eloVal = parseInt(document.getElementById('player-elo').value);

    const body = {};
    if (name) body.name = name;
    if (!isNaN(eloVal)) body.elo = eloVal;
    const otherRaw = document.getElementById('player-other-names');
    if (otherRaw) {
      body.other_names = otherRaw.value.split(',').map(s => s.trim()).filter(Boolean);
    }

    try {
      const res = await fetch(`${FLASK_URL}/play/player`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (data.player) {
        playerProfile = data.player;
        document.getElementById('player-name').value = playerProfile.name;
        document.getElementById('player-elo').value  = playerProfile.elo;
        document.getElementById('player-other-names').value = (playerProfile.other_names || []).join(', ');
        document.getElementById('player-games-played').textContent = playerProfile.games_played ?? 0;
        updateEloChip();
      }
      alert('Profile saved!');
    } catch(e) { alert('Failed to save profile: ' + e.message); }
  }

  async function renderBotsList() {
    const bots = await fetchBots();
    const list = document.getElementById('bots-list');
    const sel  = document.getElementById('match-bot-select');
    const pSel = document.getElementById('personality-bot-select');
    list.innerHTML = '';
    sel.innerHTML  = '<option value="">— Select a bot —</option>';
    pSel.innerHTML = '<option value="">— Choose a bot —</option>';

    if (bots.length === 0) {
      list.innerHTML = '<div style="font-size:11px;color:var(--text3);text-align:center;padding:8px 0">No bots saved yet</div>';
      return;
    }

    bots.forEach(bot => {
      // Card in makebot page
      const card = document.createElement('div');
      card.className = 'bot-card';
      // Phase info for display
      const op = bot.phase_opening   || { elo: bot.uci_elo, depth: 12, think_ms: 1000 };
      const mg = bot.phase_middlegame|| { elo: bot.uci_elo, depth: 12, think_ms: 1000 };
      const eg = bot.phase_endgame   || { elo: bot.uci_elo, depth: 12, think_ms: 1000 };

      // Personality tag HTML
      const pTagHtml = bot.personality
        ? `<div class="bot-personality-tag">
             <span>🎭 ${escHtml(bot.personality.name || 'Personality')}</span>
             <button class="bot-personality-remove" onclick="removePersonality('${bot.id}')" title="Remove personality">✕</button>
           </div>`
        : '';

      card.innerHTML = `
        <button class="bot-del-btn" onclick="deleteBot('${bot.id}')" title="Delete bot">✕</button>
        <div style="flex:1;min-width:0">
          <div class="bot-card-name">${escHtml(bot.name)}</div>
          <div class="bot-card-info" style="margin-top:3px;line-height:1.7">
            <span style="color:var(--accent)">♟ Op</span> ${op.elo} / d${op.depth} / ${op.think_ms ?? 1000}ms &nbsp;
            <span style="color:var(--accent2)">⚔ Mg</span> ${mg.elo} / d${mg.depth} / ${mg.think_ms ?? 1000}ms &nbsp;
            <span style="color:var(--danger)">🏁 Eg</span> ${eg.elo} / d${eg.depth} / ${eg.think_ms ?? 1000}ms
          </div>
          ${pTagHtml}
          <div class="bot-elo-row">
            <label>📊 Est. ELO (Lichess)</label>
            <input type="number" class="bot-elo-input" id="bot-elo-input-${bot.id}" min="100" max="4000"
              value="${bot.bot_elo ?? ''}" placeholder="e.g. 1800">
            <button class="bot-elo-save-btn" onclick="saveBotElo('${bot.id}')">Save</button>
            <span class="bot-elo-saved-flash" id="bot-elo-flash-${bot.id}">✓ Saved</span>
          </div>
        </div>`;
      list.appendChild(card);

      // Option in play page select
      const opt = document.createElement('option');
      opt.value = bot.id;
      opt.textContent = bot.name + (bot.bot_elo ? ` (~${bot.bot_elo})` : '') + (bot.personality ? ' 🎭' : '');
      sel.appendChild(opt);

      // Option in personality import select
      const pOpt = document.createElement('option');
      pOpt.value = bot.id;
      pOpt.textContent = bot.name + (bot.personality ? ' 🎭' : '');
      pSel.appendChild(pOpt);
    });
  }

  async function saveBot() {
    const name = document.getElementById('bot-name').value.trim();
    if (!name) { alert('Bot ka naam dalo!'); return; }

    const body = {
      name,
      uci_elo: parseInt(document.getElementById('sl-op-elo').value), // backward compat
      phase_opening: {
        elo:   parseInt(document.getElementById('sl-op-elo').value),
        depth: parseInt(document.getElementById('sl-op-depth').value),
        think_ms: parseInt(document.getElementById('sl-op-think').value),
      },
      phase_middlegame: {
        elo:   parseInt(document.getElementById('sl-mg-elo').value),
        depth: parseInt(document.getElementById('sl-mg-depth').value),
        think_ms: parseInt(document.getElementById('sl-mg-think').value),
      },
      phase_endgame: {
        elo:   parseInt(document.getElementById('sl-eg-elo').value),
        depth: parseInt(document.getElementById('sl-eg-depth').value),
        think_ms: parseInt(document.getElementById('sl-eg-think').value),
      },
    };

    try {
      const res  = await fetch(`${FLASK_URL}/play/bots`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      document.getElementById('bot-name').value = '';
      await renderBotsList();
      setPlayStatus('✓ Bot saved: ' + name);
    } catch(e) {
      alert('Save failed: ' + e.message);
    }
  }

  async function deleteBot(botId) {
    if (!confirm('Delete this bot?')) return;
    await fetch(`${FLASK_URL}/play/bots/${botId}`, { method: 'DELETE' });
    await renderBotsList();
  }

  async function saveBotElo(botId) {
    const input = document.getElementById(`bot-elo-input-${botId}`);
    const val = parseInt(input.value);
    if (!val || val < 100 || val > 4000) { alert('Valid ELO daalo (100–4000)!'); return; }

    try {
      const res = await fetch(`${FLASK_URL}/play/bots/${botId}/elo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bot_elo: val })
      });
      const data = await res.json();
      if (data.error) { alert(data.error); return; }

      const flash = document.getElementById(`bot-elo-flash-${botId}`);
      flash.classList.add('show');
      setTimeout(() => flash.classList.remove('show'), 1500);

      // Refresh select dropdown labels to show updated estimate
      await renderBotsList();
    } catch(e) { alert('Failed to save ELO: ' + e.message); }
  }

  async function importPersonality() {
    const botId = document.getElementById('personality-bot-select').value;
    if (!botId) { alert('Pehle ek bot choose karo!'); return; }

    const jsonRaw = document.getElementById('personality-json-input').value.trim();
    if (!jsonRaw) { alert('Personality JSON paste karo!'); return; }

    let personality;
    try {
      personality = JSON.parse(jsonRaw);
    } catch(e) {
      alert('Invalid JSON! Check karo:\n' + e.message);
      return;
    }

    if (!personality.name || !Array.isArray(personality.rules)) {
      alert('JSON mein "name" aur "rules" array hona chahiye!');
      return;
    }

    // Check if bot already has personality
    try {
      const res = await fetch(`${FLASK_URL}/play/bots`);
      const data = await res.json();
      const bot = (data.bots || []).find(b => b.id === botId);
      if (bot && bot.personality) {
        const ok = confirm(`"${bot.name}" mein pehle se personality hai: "${bot.personality.name}"\nOverwrite karna chahte ho?`);
        if (!ok) return;
      }
    } catch(e) { /* ignore, proceed */ }

    try {
      const res = await fetch(`${FLASK_URL}/play/bots/${botId}/personality`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ personality })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      document.getElementById('personality-json-input').value = '';
      document.getElementById('personality-bot-select').value = '';
      await renderBotsList();
      setPlayStatus('✓ Personality imported: ' + personality.name);
    } catch(e) {
      alert('Import failed: ' + e.message);
    }
  }

  // ── Multi-bot JSON import ──────────────────────────────────────

  function _parseBotImportJSON(raw) {
    const parsed = JSON.parse(raw);
    // Single bot object ya array dono handle karo
    const bots = Array.isArray(parsed) ? parsed : [parsed];
    return bots;
  }

  function _validateBotObj(b) {
    if (!b || typeof b !== 'object') return 'Object nahi hai';
    if (!b.name || typeof b.name !== 'string' || !b.name.trim()) return '"name" field missing';
    // Phase fields optional hain — agar nahi hain toh defaults use honge
    return null; // valid
  }

  function _botImportPreviewCard(b, idx) {
    const err = _validateBotObj(b);
    const hasPersonality = b.personality && b.personality.name;
    const op = b.phase_opening   || {};
    const mg = b.phase_middlegame || {};
    const eg = b.phase_endgame   || {};

    const phaseStr = (p, label) => {
      const parts = [];
      if (p.elo)      parts.push(`ELO ${p.elo}`);
      if (p.depth)    parts.push(`D${p.depth}`);
      if (p.think_ms) parts.push(`${p.think_ms}ms`);
      return parts.length ? `${label}: ${parts.join(' · ')}` : '';
    };

    const phases = [
      phaseStr(op, '♟ Op'),
      phaseStr(mg, '⚔ Mid'),
      phaseStr(eg, '🏁 End'),
    ].filter(Boolean);

    if (err) {
      return `<div style="padding:7px 10px;border-radius:6px;border:1px solid var(--danger);background:rgba(212,96,96,0.08);font-size:11px">
        <span style="color:var(--danger)">✕ Bot ${idx+1}: ${err}</span>
      </div>`;
    }

    return `<div style="padding:8px 10px;border-radius:6px;border:1px solid var(--border);background:var(--bg3);font-size:11px;display:flex;flex-direction:column;gap:3px">
      <div style="display:flex;align-items:center;gap:6px">
        <span style="font-weight:600;color:var(--text)">${b.name}</span>
        ${hasPersonality ? `<span style="font-size:9px;padding:1px 6px;border-radius:8px;background:rgba(196,163,90,0.15);color:var(--accent);border:1px solid rgba(196,163,90,0.3)">🎭 ${b.personality.name}</span>` : ''}
      </div>
      ${phases.map(p => `<div style="font-size:10px;color:var(--text3)">${p}</div>`).join('')}
    </div>`;
  }

  function previewBotImport() {
    const raw = document.getElementById('multi-bot-json-input').value.trim();
    const preview = document.getElementById('multi-bot-preview');
    const list    = document.getElementById('multi-bot-preview-list');
    const status  = document.getElementById('multi-bot-status');

    if (!raw) {
      status.style.display = '';
      status.style.color   = 'var(--danger)';
      status.textContent   = 'JSON paste karo pehle!';
      return;
    }

    let bots;
    try {
      bots = _parseBotImportJSON(raw);
    } catch(e) {
      status.style.display = '';
      status.style.color   = 'var(--danger)';
      status.textContent   = 'Invalid JSON: ' + e.message;
      preview.style.display = 'none';
      return;
    }

    list.innerHTML = bots.map((b, i) => _botImportPreviewCard(b, i)).join('');
    preview.style.display = 'flex';
    status.style.display  = '';
    status.style.color    = 'var(--text3)';
    status.textContent    = `${bots.length} bot${bots.length > 1 ? 's' : ''} detected — Import All dabao`;
  }

  async function importMultipleBots() {
    const raw    = document.getElementById('multi-bot-json-input').value.trim();
    const status = document.getElementById('multi-bot-status');

    if (!raw) {
      status.style.display = '';
      status.style.color   = 'var(--danger)';
      status.textContent   = 'JSON paste karo pehle!';
      return;
    }

    let bots;
    try {
      bots = _parseBotImportJSON(raw);
    } catch(e) {
      status.style.display = '';
      status.style.color   = 'var(--danger)';
      status.textContent   = 'Invalid JSON: ' + e.message;
      return;
    }

    // Validate all first
    const errors = bots.map((b, i) => _validateBotObj(b) ? `Bot ${i+1}: ${_validateBotObj(b)}` : null).filter(Boolean);
    if (errors.length) {
      status.style.display = '';
      status.style.color   = 'var(--danger)';
      status.textContent   = 'Errors: ' + errors.join(', ');
      return;
    }

    status.style.display = '';
    status.style.color   = 'var(--accent)';
    status.textContent   = `Importing ${bots.length} bot(s)...`;

    let saved = 0, failed = 0;
    for (const b of bots) {
      try {
        const body = {
          name: b.name.trim(),
          uci_elo: b.phase_opening?.elo || b.uci_elo || 1500,
          phase_opening:    b.phase_opening    || { elo: 1500, depth: 12, think_ms: 1000 },
          phase_middlegame: b.phase_middlegame || { elo: 1500, depth: 12, think_ms: 1000 },
          phase_endgame:    b.phase_endgame    || { elo: 1500, depth: 12, think_ms: 1000 },
        };

        // Save bot
        const res  = await fetch(`${FLASK_URL}/play/bots`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        const newBotId = data.id || data.bot?.id;

        // Attach personality if present
        if (b.personality && b.personality.name && newBotId) {
          try {
            await fetch(`${FLASK_URL}/play/bots/${newBotId}/personality`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ personality: b.personality })
            });
          } catch(pe) { /* personality attach fail — bot is still saved */ }
        }

        saved++;
      } catch(e) {
        failed++;
      }
    }

    await renderBotsList();

    status.style.color = saved > 0 ? 'var(--accent2)' : 'var(--danger)';
    status.textContent = `✓ ${saved} bot${saved !== 1 ? 's' : ''} saved${failed > 0 ? `, ${failed} failed` : ''}!`;

    if (saved > 0) {
      document.getElementById('multi-bot-json-input').value = '';
      document.getElementById('multi-bot-preview').style.display = 'none';
    }
  }

  // ── File-based bot import ──────────────────────────────────────

  // Loaded file data: array of { fileName, bots[] }
  let _botFileData = [];

  function handleBotFileImport(event) {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    _loadBotFiles(files);
    // Reset input so same file can be re-selected
    event.target.value = '';
  }

  function handleBotFileDrop(event) {
    event.preventDefault();
    document.getElementById('bot-file-dropzone').style.borderColor = 'rgba(196,163,90,0.3)';
    const files = Array.from(event.dataTransfer.files || []).filter(f => f.name.endsWith('.json') || f.type === 'application/json');
    if (!files.length) {
      _setBotFileStatus('Sirf .json files drop karo!', 'var(--danger)');
      return;
    }
    _loadBotFiles(files);
  }

  function _loadBotFiles(files) {
    _botFileData = [];
    const listEl = document.getElementById('bot-files-list-inner');
    listEl.innerHTML = '<div style="font-size:10px;color:var(--text3)">Loading...</div>';
    document.getElementById('bot-files-list').style.display = 'flex';

    let loaded = 0;
    const results = [];

    files.forEach((file, idx) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        let bots = [], error = null;
        try {
          const parsed = JSON.parse(e.target.result);
          bots = Array.isArray(parsed) ? parsed : [parsed];
        } catch(err) {
          error = err.message;
        }
        results[idx] = { fileName: file.name, bots, error };
        loaded++;
        if (loaded === files.length) {
          _botFileData = results;
          _renderBotFileList();
        }
      };
      reader.onerror = () => {
        results[idx] = { fileName: file.name, bots: [], error: 'File read failed' };
        loaded++;
        if (loaded === files.length) {
          _botFileData = results;
          _renderBotFileList();
        }
      };
      reader.readAsText(file);
    });
  }

  function _renderBotFileList() {
    const listEl = document.getElementById('bot-files-list-inner');
    listEl.innerHTML = '';

    let totalBots = 0;
    _botFileData.forEach(fd => {
      const hasError = !!fd.error;
      const count = fd.bots.length;
      totalBots += count;

      const card = document.createElement('div');
      card.style.cssText = `display:flex;align-items:center;justify-content:space-between;padding:7px 10px;border-radius:6px;border:1px solid ${hasError ? 'var(--danger)' : 'var(--border)'};background:var(--bg3);gap:8px`;
      card.innerHTML = `
        <div style="display:flex;align-items:center;gap:7px;min-width:0">
          <span style="font-size:14px">${hasError ? '❌' : '📄'}</span>
          <div style="min-width:0">
            <div style="font-size:11px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${fd.fileName}</div>
            <div style="font-size:10px;color:${hasError ? 'var(--danger)' : 'var(--text3)'}">${hasError ? fd.error : `${count} bot${count !== 1 ? 's' : ''} detected`}</div>
          </div>
        </div>
        ${!hasError ? `<span style="font-size:11px;font-weight:600;color:var(--accent);flex-shrink:0">${count}</span>` : ''}
      `;
      listEl.appendChild(card);
    });

    const validFiles = _botFileData.filter(f => !f.error);
    if (validFiles.length > 0) {
      const summary = document.createElement('div');
      summary.style.cssText = 'font-size:10px;color:var(--text3);text-align:center;padding:2px 0';
      summary.textContent = `${validFiles.length} file${validFiles.length > 1 ? 's' : ''} · ${totalBots} total bot${totalBots !== 1 ? 's' : ''} ready to import`;
      listEl.appendChild(summary);
    }
  }

  function previewFileImport() {
    if (!_botFileData.length) {
      _setBotFileStatus('Pehle files select karo!', 'var(--danger)');
      return;
    }
    // Collect all bots from all valid files
    const allBots = _botFileData.filter(f => !f.error).flatMap(f => f.bots);
    if (!allBots.length) {
      _setBotFileStatus('Koi valid bot nahi mila!', 'var(--danger)');
      return;
    }

    // Reuse existing preview UI
    const preview = document.getElementById('multi-bot-preview');
    const list    = document.getElementById('multi-bot-preview-list');
    list.innerHTML = allBots.map((b, i) => _botImportPreviewCard(b, i)).join('');
    preview.style.display = 'flex';

    const status = document.getElementById('multi-bot-status');
    status.style.display = '';
    status.style.color   = 'var(--text3)';
    status.textContent   = `${allBots.length} bot${allBots.length > 1 ? 's' : ''} detected across ${_botFileData.filter(f=>!f.error).length} file(s) — Import All Files dabao`;
  }

  async function importBotsFromFiles() {
    if (!_botFileData.length) {
      _setBotFileStatus('Pehle files select karo!', 'var(--danger)');
      return;
    }

    const allBots = _botFileData.filter(f => !f.error).flatMap(f => f.bots);
    if (!allBots.length) {
      _setBotFileStatus('Koi valid bot nahi mila!', 'var(--danger)');
      return;
    }

    // Validate all
    const errors = allBots.map((b, i) => _validateBotObj(b) ? `Bot ${i+1}: ${_validateBotObj(b)}` : null).filter(Boolean);
    if (errors.length) {
      _setBotFileStatus('Errors: ' + errors.slice(0,3).join(', ') + (errors.length > 3 ? '...' : ''), 'var(--danger)');
      return;
    }

    const status = document.getElementById('multi-bot-status');
    status.style.display = '';
    status.style.color   = 'var(--accent)';
    status.textContent   = `Importing ${allBots.length} bot(s) from ${_botFileData.filter(f=>!f.error).length} file(s)...`;

    let saved = 0, failed = 0;
    for (const b of allBots) {
      try {
        const body = {
          name: b.name.trim(),
          uci_elo: b.phase_opening?.elo || b.uci_elo || 1500,
          phase_opening:    b.phase_opening    || { elo: 1500, depth: 12, think_ms: 1000 },
          phase_middlegame: b.phase_middlegame || { elo: 1500, depth: 12, think_ms: 1000 },
          phase_endgame:    b.phase_endgame    || { elo: 1500, depth: 12, think_ms: 1000 },
        };

        const res  = await fetch(`${FLASK_URL}/play/bots`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        const newBotId = data.id || data.bot?.id;

        if (b.personality && b.personality.name && newBotId) {
          try {
            await fetch(`${FLASK_URL}/play/bots/${newBotId}/personality`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ personality: b.personality })
            });
          } catch(pe) { /* personality fail — bot still saved */ }
        }

        saved++;
      } catch(e) {
        failed++;
      }
    }

    await renderBotsList();

    status.style.color = saved > 0 ? 'var(--accent2)' : 'var(--danger)';
    status.textContent = `✓ ${saved} bot${saved !== 1 ? 's' : ''} saved from files${failed > 0 ? `, ${failed} failed` : ''}!`;

    if (saved > 0) {
      clearBotFiles();
      document.getElementById('multi-bot-preview').style.display = 'none';
    }
  }

  function clearBotFiles() {
    _botFileData = [];
    document.getElementById('bot-files-list').style.display = 'none';
    document.getElementById('bot-files-list-inner').innerHTML = '';
  }

  function _setBotFileStatus(msg, color) {
    const status = document.getElementById('multi-bot-status');
    status.style.display = '';
    status.style.color   = color;
    status.textContent   = msg;
  }

  async function removePersonality(botId) {
    const ok = confirm('Is bot ki personality remove karna chahte ho?');
    if (!ok) return;
    try {
      const res = await fetch(`${FLASK_URL}/play/bots/${botId}/personality`, { method: 'DELETE' });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      await renderBotsList();
      setPlayStatus('Personality removed.');
    } catch(e) {
      alert('Remove failed: ' + e.message);
    }
  }

  function escHtml(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ── Load puzzles.js dynamically (tactics trainer) ──
  (function () {
    const s = document.createElement('script');
    s.src = 'static/js/play/puzzles.js';
    document.head.appendChild(s);
  })();

