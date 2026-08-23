// ============================================================
// lichess.js — 🌐 Lichess Live Play
//
// - Token management (save/validate, localStorage cache)
// - Challenge a user / open seek + pending state with cancel
// - EventSource SSE → gameFull/gameState/opponentGone handling
// - Reuses play-vs-bot board machinery: board, clock rows,
//   player names, captured pieces display
// - Resign / Draw / Abort in-game controls
// - Game over: result banner + rating change + rematch +
//   auto history save (source: lichess)
// ============================================================

// ── State ─────────────────────────────────────────────────────

let lcState       = null;   // active live-game state
let lcEs          = null;   // game stream EventSource
let lcEsEvents    = null;   // event stream EventSource (seek acceptance)
let lcClockInt    = null;
let lcSelSq       = null;
let lcLegalSquares = [];
let lcChallengeId = null;
const LC_CACHE_KEY = 'lc_account_cache';

function lcIsActive() { return !!(lcState && lcState.active); }

function lcSetMsg(msg, isError) {
  document.querySelectorAll('.lc-status-msg').forEach(el => {
    el.textContent = msg || '';
    el.style.color = isError ? 'var(--danger)' : 'var(--text2)';
  });
}

function lcTimeCustomToggle() {
  const sel = document.getElementById('lc-time-select');
  const box = document.getElementById('lc-custom-time');
  if (box) box.style.display = sel.value === 'custom' ? 'flex' : 'none';
}

function lcClearSelection() {
  if (lcSelSq) {
    document.querySelector(`.square-${lcSelSq}`)?.classList.remove('sq-selected');
    lcSelSq = null;
  }
  lcLegalSquares.forEach(sq => {
    document.querySelector(`.square-${sq}`)?.classList.remove('sq-legal-dot', 'sq-legal-capture');
  });
  lcLegalSquares = [];
}

// ── A) Token management ───────────────────────────────────────

function _lcCacheGet() {
  try { return JSON.parse(localStorage.getItem(LC_CACHE_KEY) || 'null'); }
  catch(e) { return null; }
}
function _lcCacheSet(acc) {
  try { localStorage.setItem(LC_CACHE_KEY, JSON.stringify(acc)); } catch(e) {}
}

async function lcSaveToken() {
  const input = document.getElementById('lc-token-input');
  const token = (input.value || '').trim();
  if (!token) { lcSetMsg('Token daalo pehle', true); return; }
  lcSetMsg('Validating token...');
  try {
    const res  = await fetch(`${FLASK_URL}/lichess/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token })
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Invalid token');
    input.value = '';
    _lcCacheSet({ username: data.username, rating: data.rating });
    lcRenderAccount(data.username, data.rating);
    lcSetMsg(`✅ Connected as ${data.username}`);
  } catch(e) {
    lcSetMsg('❌ ' + e.message, true);
  }
}

async function lcCheckToken(showOk) {
  // Fast path — localStorage cache
  const cached = _lcCacheGet();
  if (cached) lcRenderAccount(cached.username, cached.rating);
  try {
    const res  = await fetch(`${FLASK_URL}/lichess/token/check`);
    const data = await res.json();
    if (data.valid) {
      _lcCacheSet({ username: data.username, rating: data.rating });
      lcRenderAccount(data.username, data.rating);
      if (showOk) lcSetMsg(`✅ Connected as ${data.username} (~${data.rating})`);
    } else if (cached) {
      // cache stale — token invalid/removed
      localStorage.removeItem(LC_CACHE_KEY);
      lcRenderAccount('', 0);
      if (showOk) lcSetMsg('Token invalid/expired — naya token add karo', true);
    }
  } catch(e) { /* offline */ }
}

function lcRenderAccount(username, rating) {
  const box   = document.getElementById('lc-account-box');
  const nameEl  = document.getElementById('lc-account-name');
  const ratingEl = document.getElementById('lc-account-rating');
  const formWrap = document.getElementById('lc-token-form');
  const chalWrap = document.getElementById('lc-challenge-wrap');
  const connected = !!username;
  if (box) box.style.display = connected ? 'flex' : 'none';
  if (nameEl) nameEl.textContent = username || '';
  if (ratingEl) ratingEl.textContent = rating ? `(~${rating})` : '';
  if (formWrap) formWrap.style.display = connected ? 'none' : 'flex';
  if (chalWrap) chalWrap.style.display = connected ? 'flex' : 'none';
  lcUpdateHeaderRatings(rating);
}

// Header ratings strip: "Bot ELO: x | Lichess: y"
function lcUpdateHeaderRatings(lichessRating) {
  const el = document.getElementById('lc-header-ratings');
  if (!el) return;
  let botElo = (typeof playerProfile !== 'undefined' && playerProfile && playerProfile.elo) ? playerProfile.elo : null;
  const parts = [];
  if (botElo != null) parts.push(`Bot ELO: ${botElo}`);
  if (lichessRating) parts.push(`Lichess: ${lichessRating}`);
  el.textContent = parts.join(' | ');
  el.style.display = parts.length ? '' : 'none';
}

// ── B) Challenges ─────────────────────────────────────────────

function lcTimeParams() {
  const sel = document.getElementById('lc-time-select');
  let minutes = 5, increment = 3;
  if (sel.value === 'custom') {
    minutes   = Math.max(1, Math.min(parseInt(document.getElementById('lc-minutes').value, 10) || 5, 180));
    increment = Math.max(0, Math.min(parseInt(document.getElementById('lc-increment').value, 10) || 0, 60));
  } else {
    const [m, i] = sel.value.split('+').map(Number);
    minutes = m; increment = i;
  }
  const colorSel = document.getElementById('lc-color-select');
  return { minutes, increment, color: colorSel.value };
}

async function lcChallengeUser() {
  const username = (document.getElementById('lc-username')?.value || '').trim();
  if (!username) { lcSetMsg('Username daalo', true); return; }
  const params = lcTimeParams();
  lcSetMsg(`Challenging ${username}...`);
  try {
    const res  = await fetch(`${FLASK_URL}/lichess/challenge`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, ...params })
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Challenge failed');
    lcChallengeId = data.challenge_id;
    lcShowPending(`⏳ Waiting for ${username} to accept... (${params.minutes}+${params.increment})`);
    lcWatchEvents();
  } catch(e) {
    lcSetMsg('❌ ' + e.message, true);
  }
}

async function lcOpenSeek() {
  const params = lcTimeParams();
  lcSetMsg('Creating open seek...');
  try {
    const res  = await fetch(`${FLASK_URL}/lichess/challenge/open`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params)
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Seek failed');
    lcChallengeId = data.challenge_id;
    const urlEl = document.getElementById('lc-seek-url');
    if (urlEl && data.url_full) {
      urlEl.innerHTML = `<span style="color:var(--text3)">Share link:</span> <a href="${data.url}" target="_blank" style="color:var(--accent);word-break:break-all">${data.url_full}</a>`;
      urlEl.style.display = '';
    }
    lcShowPending(`⏳ Open seek live — koi bhi accept kar sakta hai (${params.minutes}+${params.increment})`);
    lcWatchEvents();
  } catch(e) {
    lcSetMsg('❌ ' + e.message, true);
  }
}

function lcShowPending(text) {
  const pend = document.getElementById('lc-pending');
  const label = document.getElementById('lc-pending-label');
  if (label) label.textContent = text;
  if (pend) pend.style.display = 'flex';
  document.getElementById('lc-challenge-form').style.display = 'none';
}

function lcHidePending() {
  const pend = document.getElementById('lc-pending');
  if (pend) pend.style.display = 'none';
  document.getElementById('lc-challenge-form').style.display = 'flex';
  const urlEl = document.getElementById('lc-seek-url');
  if (urlEl) urlEl.style.display = 'none';
}

async function lcCancelPending() {
  lcCloseEventStream();
  if (lcChallengeId) {
    try {
      await fetch(`${FLASK_URL}/lichess/challenge/${lcChallengeId}`, { method: 'DELETE' });
    } catch(e) { /* ignore */ }
  }
  lcChallengeId = null;
  lcHidePending();
  lcSetMsg('');
}

// Watch the Lichess event stream for seek acceptance / challenge result
function lcWatchEvents() {
  lcCloseEventStream();
  lcEsEvents = new EventSource(`${FLASK_URL}/lichess/event/stream`);
  lcEsEvents.onmessage = (e) => {
    let d = null;
    try { d = JSON.parse(e.data); } catch(err) { return; }
    if (d.type === 'gameStart' && d.game && d.game.id) {
      lcCloseEventStream();
      lcHidePending();
      lcLaunchGame(d.game.id);
    } else if (d.type === 'challenge' && d.challenge) {
      const st = d.challenge.status;
      if (st === 'declined') {
        lcCloseEventStream(); lcHidePending();
        lcSetMsg(`❌ ${(d.challenge.destUser && d.challenge.destUser.name) || 'Opponent'} ne decline kar diya`, true);
        lcChallengeId = null;
      } else if (st === 'canceled') {
        lcCloseEventStream(); lcHidePending();
        lcSetMsg('Challenge cancel ho gaya');
        lcChallengeId = null;
      }
    }
  };
  lcEsEvents.addEventListener('stream_error', () => {
    lcCloseEventStream(); lcHidePending();
    lcSetMsg('❌ Stream error — dobara try karo', true);
  });
  lcEsEvents.addEventListener('stream_end', () => lcCloseEventStream());
}

function lcCloseEventStream() {
  if (lcEsEvents) { try { lcEsEvents.close(); } catch(e) {} lcEsEvents = null; }
}
function lcCloseGameStream() {
  if (lcEs) { try { lcEs.close(); } catch(e) {} lcEs = null; }
}

// ── C) In-game setup & streaming ──────────────────────────────

async function lcLaunchGame(gameId) {
  lcSetMsg('Connecting to game...');
  try {
    await fetch(`${FLASK_URL}/lichess/game/start`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ game_id: gameId })
    });
  } catch(e) { /* stream will still work */ }
  lcOpenGameStream(gameId);
}

function lcOpenGameStream(gameId) {
  lcCloseGameStream();
  lcEs = new EventSource(`${FLASK_URL}/lichess/game/stream?game_id=${encodeURIComponent(gameId)}`);
  lcEs.onmessage = (e) => {
    let d = null;
    try { d = JSON.parse(e.data); } catch(err) { return; }
    if (d.type === 'gameFull')       lcSetupFromGameFull(d);
    else if (d.type === 'gameState') lcOnGameState(d);
    else if (d.type === 'opponentGone') {
      if (!lcState || !lcState.over) {
        lcSetMsg(d.gone ? '😴 Opponent disconnected...' : '');
      }
    }
    // chatLine ignored for now
  };
  lcEs.addEventListener('stream_error', () => {
    if (lcState && !lcState.over) lcSetMsg('❌ Stream error', true);
  });
  lcEs.addEventListener('stream_end', () => {
    lcCloseGameStream();
    // If the game never started (challenge expired etc.), go back
    if (!lcState || !lcState.active) {
      lcBackToLobby('Game stream ended');
    }
  });
}

function lcOpponentName(gf, myColor) {
  const oppSide = myColor === 'w' ? gf.black : gf.white;
  return (oppSide && oppSide.user && oppSide.user.name) || 'Anonymous';
}
function lcMyNameIn(gf, myColor) {
  const side = myColor === 'w' ? gf.white : gf.black;
  return (side && side.user && side.user.name) || 'You';
}
function lcOpponentRating(gf, myColor) {
  const oppSide = myColor === 'w' ? gf.black : gf.white;
  return (oppSide && oppSide.rating) || 0;
}

function lcDetectColor(gf) {
  // My color = whichever side matches my Lichess username
  const cached = _lcCacheGet();
  const uname  = (cached && cached.username || '').toLowerCase();
  const wName  = (gf.white  && gf.white.user && gf.white.user.name  || '').toLowerCase();
  const bName  = (gf.black  && gf.black.user && gf.black.user.name  || '').toLowerCase();
  if (uname && bName === uname) return 'b';
  return 'w';
}

function lcSetupFromGameFull(gf) {
  lcTeardownClockOnly();

  const myColor = lcDetectColor(gf);
  const initialFen = gf.initialFen && gf.initialFen !== 'startpos'
    ? gf.initialFen : chess_START_FEN();

  const st = gf.state || {};
  lcState = {
    active:     true,
    over:       false,
    gameId:     gf.id,
    myColor,
    opponent:   lcOpponentName(gf, myColor),
    oppRating:  lcOpponentRating(gf, myColor),
    whiteName:  lcMyNameIn(gf, 'w'),
    blackName:  lcMyNameIn(gf, 'b'),
    chess:      new Chess(initialFen),
    initialFen,
    movesSeen:  0,
    wtime:      st.wtime ?? 0,
    btime:      st.btime ?? 0,
    syncAt:     Date.now(),
    status:     st.status || 'started',
    minutes:    gf.clock ? Math.round(gf.clock.initial / 60) : 0,
    increment:  gf.clock ? gf.clock.increment : 0,
    hasClock:   !!gf.clock,
  };

  // Apply any moves already played
  (st.moves || '').trim().split(/\s+/).filter(Boolean).forEach(u => _lcApplyUci(u));

  // Mirror into shared playState so clock rows/captured renderers work
  _lcMirrorToPlayState();

  // Show board UI (same machinery as Play vs Bot)
  showIngameUI();
  stopClock();                                   // our own ticker runs instead
  document.getElementById('ingame-controls').classList.remove('show');
  document.getElementById('bot-thinking').style.display = 'none';
  document.getElementById('copy-pgn-btn').classList.remove('show');
  const lcCtl = document.getElementById('lichess-controls');
  lcCtl.classList.add('show');
  document.getElementById('lc-over-banner').style.display = 'none';
  lcUpdateControlButtons();

  // Board orientation + labels
  if (myColor === 'b' && !boardFlipped) { board.flip(); boardFlipped = true; }
  else if (myColor === 'w' && boardFlipped) { board.flip(); boardFlipped = false; }
  setTimeout(() => typeof attachBoardTapHandlers === 'function' && attachBoardTapHandlers(), 100);

  document.getElementById('clock-player-label').textContent =
    myColor === 'w' ? `♙ ${lcState.whiteName} (White)` : `♟ ${lcState.blackName} (Black)`;
  document.getElementById('clock-bot-label').textContent =
    myColor === 'w' ? `♟ ${lcState.blackName} (Black)` : `♙ ${lcState.whiteName} (White)`;
  const showClk = lcState.hasClock;
  document.getElementById('clock-bot-time').style.display    = showClk ? '' : 'none';
  document.getElementById('clock-player-time').style.display = showClk ? '' : 'none';

  board.position(lcState.chess.fen());
  updateCapturedDisplay();
  updateClocks();
  lcStartClockTicker();

  lcSetMsg(myColor === 'w' ? '⚪ You play White' : '⚫ You play Black');
  // Hide lobby page while playing
  document.getElementById('play-page-lichess').classList.remove('active');
  document.body.classList.remove('play-board-hidden');
}

function _lcApplyUci(uci) {
  if (!uci || uci.length < 4 || !lcState) return;
  const mv = {
    from: uci.slice(0, 2),
    to:   uci.slice(2, 4),
    promotion: uci.length > 4 ? uci[4] : undefined,
  };
  const move = lcState.chess.move(mv);
  if (!move) {
    // Desync — rebuild from full move list is handled by caller
    return;
  }
  lcState.movesSeen++;
  lcLastMove = { from: mv.from, to: mv.to };
}

function _lcMirrorToPlayState() {
  const myMs = lcState.myColor === 'w' ? lcState.wtime : lcState.btime;
  const opMs = lcState.myColor === 'w' ? lcState.btime : lcState.wtime;
  playState.active      = true;
  playState.botName     = `${lcState.opponent}${lcState.oppRating ? ` (~${lcState.oppRating})` : ''}`;
  playState.playerColor = lcState.myColor;
  playState.timeControl = lcState.hasClock;
  playState.timeMinutes = lcState.minutes;
  playState.playerMs    = myMs;
  playState.botMs       = opMs;
  playState.features    = { undo:false, hint:false, evalbar:false, threat:false, suggestion:false };
  playState.startFen    = lcState.initialFen;
  playState.status      = 'playing';
  playState.result      = null;
}

function chess_START_FEN() {
  return 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
}

let lcLastMove = null;

// gameState events: moves diff + clocks + status
function lcOnGameState(st) {
  if (!lcIsActive()) return;

  lcState.wtime  = st.wtime ?? lcState.wtime;
  lcState.btime  = st.btime ?? lcState.btime;
  lcState.syncAt = Date.now();
  lcState.status = st.status || lcState.status;

  const moves = (st.moves || '').trim().split(/\s+/).filter(Boolean);
  let lastFrom = null, lastTo = null;
  while (lcState.movesSeen < moves.length) {
    const before = lcState.movesSeen;
    _lcApplyUci(moves[lcState.movesSeen]);
    if (lcState.movesSeen === before) break;   // illegal/unparseable — bail out
    lastFrom = lcLastMove.from; lastTo = lcLastMove.to;
  }

  board.position(lcState.chess.fen());
  updateCapturedDisplay();

  if (lastFrom) {
    clearArrows();
    drawArrowSVG(lastFrom, lastTo, 'ah-last', 'rgba(128,128,128,0.9)');
  }

  _lcMirrorToPlayState();
  updateClocks();

  if (st.status && st.status !== 'started') {
    lcGameOver(st);
  } else {
    const myTurn = lcState.chess.turn() === lcState.myColor;
    lcSetMsg(myTurn ? 'Your turn' : "Opponent's turn...");
    lcUpdateControlButtons();
  }
}

// Own clock ticker between server events
function lcStartClockTicker() {
  lcTeardownClockOnly();
  if (!lcState.hasClock) return;
  lcClockInt = setInterval(() => {
    if (!lcIsActive() || lcState.over) { lcTeardownClockOnly(); return; }
    const elapsed = Date.now() - (lcState.syncAt || Date.now());
    const turn = lcState.chess.turn();
    let w = Math.max(0, lcState.wtime - (turn === 'w' ? elapsed : 0));
    let b = Math.max(0, lcState.btime - (turn === 'b' ? elapsed : 0));
    playState.playerMs = lcState.myColor === 'w' ? w : b;
    playState.botMs    = lcState.myColor === 'w' ? b : w;
    updateClocks();
  }, 250);
}
function lcTeardownClockOnly() {
  if (lcClockInt) { clearInterval(lcClockInt); lcClockInt = null; }
}

// ── Tap-to-move (mirrors play-moves logic) ────────────────────

function lcHandleSquareTap(square) {
  if (!lcIsActive() || lcState.over) return;
  if (lcState.chess.turn() !== lcState.myColor) return;

  if (lcSelSq) {
    if (square === lcSelSq) { lcClearSelection(); return; }

    const piece = lcState.chess.get(lcSelSq);
    let promo = undefined;
    if (piece && piece.type === 'p') {
      if ((piece.color === 'w' && square[1] === '8') ||
          (piece.color === 'b' && square[1] === '1')) {
        promo = getPromotionPiece();
      }
    }

    const move = lcState.chess.move({ from: lcSelSq, to: square, promotion: promo });
    if (move) {
      lcClearSelection();
      lcAfterOwnMove(move);
      return;
    }
    lcClearSelection();
  }

  const piece = lcState.chess.get(square);
  if (!piece || piece.color !== lcState.myColor) return;

  lcSelSq = square;
  document.querySelector(`.square-${square}`)?.classList.add('sq-selected');

  lcState.chess.moves({ square, verbose: true }).forEach(m => {
    const el = document.querySelector(`.square-${m.to}`);
    if (!el) return;
    const isCapture = lcState.chess.get(m.to) !== null || m.flags.includes('e');
    el.classList.add(isCapture ? 'sq-legal-capture' : 'sq-legal-dot');
    lcLegalSquares.push(m.to);
  });
}

async function lcAfterOwnMove(move) {
  board.position(lcState.chess.fen());
  updateCapturedDisplay();
  clearArrows();
  drawArrowSVG(move.from, move.to, 'ah-last', 'rgba(128,128,128,0.9)');
  lcLastMove = { from: move.from, to: move.to };
  lcSetMsg("Opponent's turn...");
  lcState.movesSeen++;   // we applied locally; server list will match

  const uci = move.from + move.to + (move.promotion || '');
  try {
    const res  = await fetch(`${FLASK_URL}/lichess/game/move`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ move: uci })
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Move rejected');
  } catch(e) {
    lcSetMsg('⚠ ' + e.message, true);
    // Re-sync from local truth; next gameState fixes everything anyway
  }
}

function lcUpdateControlButtons() {
  const ply = lcState.chess.history().length;
  document.getElementById('lc-abort-btn').style.display = ply < 2 ? '' : 'none';
  document.getElementById('lc-draw-btn').style.display  = ply < 2 ? 'none' : '';
}

// ── Controls ──────────────────────────────────────────────────

async function lcResign() {
  if (!lcIsActive()) return;
  try {
    await fetch(`${FLASK_URL}/lichess/game/resign`, { method: 'POST' });
    lcSetMsg('Resigned');
  } catch(e) { lcSetMsg('❌ Resign failed', true); }
}

async function lcOfferDraw() {
  if (!lcIsActive()) return;
  try {
    await fetch(`${FLASK_URL}/lichess/game/draw`, { method: 'POST' });
    lcSetMsg('🤝 Draw offer sent');
  } catch(e) { lcSetMsg('❌ Draw offer failed', true); }
}

async function lcAbort() {
  if (!lcIsActive()) return;
  try {
    await fetch(`${FLASK_URL}/lichess/game/abort`, { method: 'POST' });
    lcBackToLobby('Game aborted');
  } catch(e) { lcSetMsg('❌ Abort failed', true); }
}

// ── D) Game over ──────────────────────────────────────────────

function _lcResultForMe(status, winner) {
  if (winner) return (winner === lcState.myColor) ? 'win' : 'loss';
  if (status === 'draw' || status === 'stalemate' || status === 'insufficient_material' ||
      status === 'threefold_repetition' || status === 'agreement') return 'draw';
  return 'draw';
}

function _lcReasonText(status, winner) {
  const map = {
    mate: 'Checkmate', resign: 'Resignation', outoftime: 'Time out',
    draw: 'Draw agreed', stalemate: 'Stalemate', timeout: 'Timeout',
    insufficient_material: 'Insufficient material',
    threefold_repetition: 'Threefold repetition', aborted: 'Aborted',
    variantEnd: 'Variant end',
  };
  let base = map[status] || status || 'Game over';
  if ((status === 'outoftime' || status === 'timeout')) {
    base += winner ? ` — ${winner === 'w' ? 'White' : 'Black'} wins on time` : '';
  }
  return base;
}

async function lcGameOver(st) {
  if (!lcIsActive() || lcState.over) return;
  lcState.over  = true;
  lcState.winner = st.winner || '';
  lcTeardownClockOnly();

  const myResult = _lcResultForMe(st.status, st.winner);
  const reason   = _lcReasonText(st.status, st.winner);

  const titleMap = { win: '🎉 You win!', loss: '😔 You lost', draw: '🤝 Draw' };
  const banner = document.getElementById('lc-over-banner');
  document.getElementById('lc-over-title').textContent = titleMap[myResult];
  document.getElementById('lc-over-reason').textContent = reason;
  document.getElementById('lc-over-rating').style.display = 'none';
  banner.style.display = 'flex';

  // Rematch button only when there's a real opponent
  const reBtn = document.getElementById('lc-rematch-btn');
  reBtn.style.display = (lcState.opponent && lcState.opponent !== 'Anonymous') ? '' : 'none';

  lcSetMsg('');

  // Auto history save + rating sync via backend
  try {
    const pgn = lcBuildPgn(st.status, st.winner);
    const cached = _lcCacheGet();
    const res  = await fetch(`${FLASK_URL}/lichess/game/end`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lichess_game_id: lcState.gameId,
        opponent:        lcState.opponent,
        opponent_rating: lcState.oppRating,
        result:          myResult,
        winner:          st.winner || (myResult === 'draw' ? 'draw' : ''),
        reason,
        my_color:        lcState.myColor,
        white_name:      lcState.whiteName,
        black_name:      lcState.blackName,
        pgn,
        fen_final:       lcState.chess.fen(),
        time_control:    lcState.hasClock ? `${lcState.minutes}+${lcState.increment}` : '∞',
      })
    });
    const data = await res.json();
    if (data.rating_new != null && data.rating_old != null) {
      const delta = data.rating_new - data.rating_old;
      const chip = document.getElementById('lc-over-rating');
      if (delta !== 0) {
        chip.textContent = `Lichess rating: ${data.rating_old} → ${data.rating_new} (${delta > 0 ? '+' : ''}${delta})`;
        chip.style.color = delta > 0 ? 'var(--success)' : 'var(--danger)';
        chip.style.display = '';
      } else {
        chip.textContent = `Lichess rating: ${data.rating_new}`;
        chip.style.color = 'var(--text2)';
        chip.style.display = '';
      }
      const acc = _lcCacheGet() || {};
      acc.rating = data.rating_new;
      _lcCacheSet(acc);
      lcRenderAccount(data.rating_new ? (cached && cached.username) || acc.username || '' : '', data.rating_new);
    }
  } catch(e) { /* history save best-effort */ }
}

function lcBuildPgn(status, winner) {
  let resultStr = '*';
  if (winner === 'white') resultStr = '1-0';
  else if (winner === 'black') resultStr = '0-1';
  else if (winner || status === 'draw' || status === 'stalemate') resultStr = '1/2-1/2';

  const tc = lcState.hasClock ? `${60 * lcState.minutes}+${lcState.increment}` : '-';
  const movesHist = lcState.chess.history();
  let body = '';
  for (let i = 0; i < movesHist.length; i += 2) {
    body += `${(i / 2) + 1}. ${movesHist[i]} `;
    if (movesHist[i + 1]) body += movesHist[i + 1] + ' ';
  }
  body += resultStr;

  return [
    `[White "${lcState.whiteName}"]`,
    `[Black "${lcState.blackName}"]`,
    `[Result "${resultStr}"]`,
    `[TimeControl "${tc}"]`,
    lcState.initialFen !== chess_START_FEN()
      ? `[FEN "${lcState.initialFen}"]\n[SetUp "1"]` : '',
    '',
    body,
  ].filter(Boolean).join('\n');
}

function lcRematch() {
  if (!lcState) return;
  const opp = lcState.opponent;
  lcCleanupGame();
  document.getElementById('lc-username').value = opp;
  lcChallengeUser();
}

function lcReviewGame() {
  switchTab('play');
  playSubSwitch('history');
}

// ── Lobby / cleanup ───────────────────────────────────────────

function lcBackToLobby(msg) {
  lcTeardownClockOnly();
  lcCloseGameStream();
  lcState = null;
  lcClearSelection();
  document.getElementById('lichess-controls').classList.remove('show');
  // Restore sub-nav + lichess page via the normal switcher
  if (typeof playSubSwitch === 'function') {
    playSubSwitch('lichess');
  } else {
    document.getElementById('play-page-lichess').classList.add('active');
  }
  if (msg) lcSetMsg(msg);
}

function lcCleanupGame() {
  lcTeardownClockOnly();
  lcCloseGameStream();
  lcCloseEventStream();
  lcState = null;
  lcChallengeId = null;
  lcClearSelection();
  document.getElementById('lichess-controls').classList.remove('show');
}

// Page refresh (called on sub-nav switch)
async function renderLichessPage() {
  await lcCheckToken(true);
  lcSetMsg('');
  lcHidePendingSafe();
}
function lcHidePendingSafe() {
  const pend = document.getElementById('lc-pending');
  if (pend && pend.style.display === 'flex' && !lcEsEvents) lcHidePending();
}

// ── Boot ──────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => setTimeout(lcCheckToken, 400));
