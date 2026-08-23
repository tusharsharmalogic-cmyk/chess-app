// ============================================================
// puzzles.js — Tactics Puzzle Mode (same board, points system)
//   - Lichess se fetch / CSV DB import
//   - Solve on the main board via tap-to-move
//   - Points: max 5 → -2 slow(2min+) → -2/galat attempt, min 0
//   - Sirf first solve par points; re-solve/give-up = 0
//   - Daily tracking + Best Day stats
// ============================================================

let pzState = {
  active:     false,
  puzzle:     null,
  game:       null,
  solIdx:     0,        // next index in solution[] to verify/apply
  mistakes:   0,
  startTime:  0,
  timerIv:    null,
  done:       false,
  waitingOpp: false,
  revealIdx:  null,     // give-up solution navigator position
};

let pzSelSquare = null;
let pzLegalSquares = [];
let pzList = [];
let pzPausedAt = null;   // tab switch par timer pause timestamp
let pzLastEarned = null; // last /result response ka earned points

// ── HUD ────────────────────────────────────────────────────────

function pzEnsureHud() {
  if (document.getElementById('pz-hud')) return;
  const hud = document.createElement('div');
  hud.id = 'pz-hud';
  hud.style.cssText = 'display:none;position:fixed;left:10px;right:10px;bottom:56px;z-index:999;' +
    'background:var(--bg2,#1e1d1b);border:1px solid var(--border,#3a3733);border-radius:12px;' +
    'padding:10px 12px;box-shadow:0 4px 18px rgba(0,0,0,.45)';
  hud.innerHTML =
    '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px">' +
      '<span id="pz-hud-msg" style="font-size:12px;font-weight:600;color:var(--text,#e8e5e0);flex:1">Puzzle</span>' +
      '<span id="pz-hud-timer" style="font-size:12px;font-family:\'JetBrains Mono\',monospace;color:var(--accent,#c4a35a)">0:00</span>' +
    '</div>' +
    '<div id="pz-hud-sub" style="font-size:10px;color:var(--text3,#8a8680);margin-top:2px"></div>' +
    '<div class="btn-row" style="margin-top:8px">' +
      '<button class="btn sm primary" id="pz-btn-next" style="display:none" onclick="pzNextUnsolved()">▶ Next</button>' +
      '<button class="btn sm" onclick="pzGiveUp()">🏳 Give Up</button>' +
      '<button class="btn sm danger" onclick="pzExit()">✖ Exit</button>' +
    '</div>' +
    '<div class="btn-row" id="pz-reveal-nav" style="display:none;margin-top:6px">' +
      '<button class="btn sm" id="pz-btn-reveal-prev" onclick="pzRevealStep(-1)" style="flex:1">◀ Prev</button>' +
      '<button class="btn sm primary" id="pz-btn-reveal-next" onclick="pzRevealStep(1)" style="flex:1">Next Move ▶</button>' +
    '</div>';
  document.body.appendChild(hud);
}

function pzHudMsg(msg, color) {
  const el = document.getElementById('pz-hud-msg');
  if (el) { el.textContent = msg; el.style.color = color || ''; }
}

function pzFmtMs(ms) {
  const s = Math.floor(ms / 1000);
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

function pzElapsedMs() {
  let e = Date.now() - pzState.startTime;
  if (pzPausedAt) e -= (Date.now() - pzPausedAt);
  return Math.max(0, e);
}

function pzStartTimer() {
  pzStopTimer();
  pzState.timerIv = setInterval(() => {
    document.getElementById('pz-hud-timer').textContent =
      pzFmtMs(pzElapsedMs());
  }, 500);
}

function pzPauseTimer() {
  if (!pzState.active || pzState.done) return;
  if (pzState.timerIv) { clearInterval(pzState.timerIv); pzState.timerIv = null; }
  if (!pzPausedAt) pzPausedAt = Date.now();
}

function pzResumeTimer() {
  if (!pzState.active || pzState.done) return;
  if (pzPausedAt) {
    pzState.startTime += (Date.now() - pzPausedAt);
    pzPausedAt = null;
  }
  if (!pzState.timerIv) pzStartTimer();
}

function pzStopTimer() {
  if (pzState.timerIv) { clearInterval(pzState.timerIv); pzState.timerIv = null; }
}

// ── Start / exit a puzzle ─────────────────────────────────────

function startPuzzle(p) {
  if (!p || !p.solution || p.solution.length < 2) return;

  // Exit any active play/bvb session visuals
  document.getElementById('play-subnav').style.display = 'none';
  document.getElementById('ingame-controls').classList.remove('show');
  document.getElementById('bvb-ingame-controls').style.display = 'none';
  document.getElementById('game-over-banner').classList.remove('show');

  // Give-up reveal navigator reset karo
  const nav = document.getElementById('pz-reveal-nav');
  if (nav) nav.style.display = 'none';

  pzEnsureHud();
  pzPausedAt = null;
  pzState = {
    active: true, puzzle: p,
    game: new Chess(p.fen),
    solIdx: 1,           // solution[0] is the opponent's setup move
    mistakes: 0, startTime: Date.now(),
    timerIv: null, done: false, waitingOpp: false,
    revealIdx: null,
  };

  // Apply the setup (blunder) move
  const setupUci = p.solution[0];
  const setupMove = pzState.game.move({
    from: setupUci.slice(0, 2), to: setupUci.slice(2, 4),
    promotion: setupUci.slice(4) || undefined,
  });
  board.position(pzState.game.fen());

  // Orient the board so the solver plays from the bottom
  const solverColor = pzState.game.turn();          // 'w' | 'b'
  const wantFlipped = (solverColor === 'b');
  if (wantFlipped !== boardFlipped) flipBoard();

  clearArrows();
  clearPlayTapSelection();
  pzClearTapSelection();

  const sideName = solverColor === 'w' ? 'White' : 'Black';
  const ratingTxt = p.rating ? ` • Rating ${p.rating}` : '';
  document.getElementById('pz-hud-sub').textContent =
    (p.themes ? p.themes.split(',').slice(0, 3).join(', ') + ratingTxt : ratingTxt.trim() || 'Tactics');
  pzHudMsg(`🔍 ${sideName} ki best move dhundo`);
  document.getElementById('pz-btn-next').style.display = 'none';
  document.getElementById('pz-hud').style.display = 'block';

  pzStartTimer();
  updatePlayBoardVisibility();
}

function pzExit() {
  pzState.active = false;
  pzStopTimer();
  pzPausedAt = null;
  const hud = document.getElementById('pz-hud');
  if (hud) hud.style.display = 'none';
  const nav = document.getElementById('pz-reveal-nav');
  if (nav) nav.style.display = 'none';
  pzClearTapSelection();
  clearArrows();
  updatePlayBoardVisibility();
  switchTab('play');
  playSubSwitch('puzzles');
  pzRefreshUI();
}

// ── Tap-to-move solving ───────────────────────────────────────

function handlePuzzleSquareTap(square) {
  if (!pzState.active || !pzState.game || pzState.done) return;
  const g = pzState.game;
  if (pzState.waitingOpp) return;

  if (pzSelSquare) {
    if (square === pzSelSquare) { pzClearTapSelection(); return; }

    const piece = g.get(pzSelSquare);
    let promo;
    if (piece && piece.type === 'p') {
      if ((piece.color === 'w' && square[1] === '8') ||
          (piece.color === 'b' && square[1] === '1')) {
        promo = getPromotionPiece();
      }
    }

    const mv = g.move({ from: pzSelSquare, to: square, promotion: promo });
    if (mv !== null) {
      const uci = mv.from + mv.to + (mv.promotion || '');
      pzClearTapSelection();

      if (uci === pzState.puzzle.solution[pzState.solIdx]) {
        pzCorrectMove(mv);
      } else {
        g.undo();                       // revert wrong move
        board.position(g.fen());
        pzState.mistakes++;
        pzHudMsg('❌ Galat move — dubara try karo', '#d46060');
        setTimeout(() => {
          if (!pzState.done && pzState.active)
            pzHudMsg('🔍 Best move dhundo...');
        }, 1400);
      }
      return;
    }
    pzClearTapSelection();
  }

  const piece = g.get(square);
  if (!piece || piece.color !== g.turn()) return;

  pzSelSquare = square;
  document.querySelector(`.square-${square}`)?.classList.add('sq-selected');
  g.moves({ square, verbose: true }).forEach(m => {
    const el = document.querySelector(`.square-${m.to}`);
    if (!el) return;
    const isCap = g.get(m.to) !== null || m.flags.includes('e');
    el.classList.add(isCap ? 'sq-legal-capture' : 'sq-legal-dot');
    pzLegalSquares.push(m.to);
  });
}

function pzClearTapSelection() {
  if (pzSelSquare) {
    document.querySelector(`.square-${pzSelSquare}`)?.classList.remove('sq-selected');
    pzSelSquare = null;
  }
  pzLegalSquares.forEach(sq => {
    document.querySelector(`.square-${sq}`)?.classList.remove('sq-legal-dot', 'sq-legal-capture');
  });
  pzLegalSquares = [];
}

function pzApplyUci(uciStr) {
  const g = pzState.game;
  const mv = g.move({
    from: uciStr.slice(0, 2),
    to:   uciStr.slice(2, 4),
    promotion: uciStr.slice(4) || undefined,
  });
  if (mv) {
    board.position(g.fen());
    pzDrawLastMove(mv);
  }
  return mv;
}

// Sirf LAST move ka arrow dikhe — purane arrows pehle clear karo
function pzDrawLastMove(mv) {
  clearArrows();
  drawArrow(mv.from, mv.to, 'last');
}

function pzCorrectMove(mv) {
  pzDrawLastMove(mv);
  pzState.solIdx++;

  if (pzState.solIdx >= pzState.puzzle.solution.length) {
    pzFinish(true);
    return;
  }
  // Opponent's reply — apply after short delay so the move is visible
  pzState.waitingOpp = true;
  pzHudMsg('✓ Sahi! ...');
  setTimeout(() => {
    if (!pzState.active) return;
    pzApplyUci(pzState.puzzle.solution[pzState.solIdx]);
    pzState.solIdx++;
    pzState.waitingOpp = false;
    if (pzState.solIdx >= pzState.puzzle.solution.length) {
      pzFinish(true);
    } else {
      pzHudMsg('🔍 Aur continue karo — best move dhundo...');
    }
  }, 450);
}

async function pzRecordResult(solved) {
  const timeMs = pzElapsedMs();
  pzLastEarned = null;
  try {
    const res = await fetch(`${FLASK_URL}/puzzles/result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: pzState.puzzle.id,
        solved: solved,
        time_ms: timeMs,
        mistakes: pzState.mistakes,
      }),
    });
    const data = await res.json();
    if (typeof data.earned === 'number') pzLastEarned = data.earned;
  } catch (e) { /* offline — stats local skip */ }
  return timeMs;
}

async function pzFinish(solved) {
  pzState.done = true;
  pzStopTimer();
  // Result backend me save karo — points/ticks/stats update hote hain
  const timeMs = await pzRecordResult(solved);

  const btnNext = document.getElementById('pz-btn-next');
  const nav = document.getElementById('pz-reveal-nav');
  if (solved) {
    const earned = pzLastEarned ?? 0;
    if (earned > 0) {
      pzHudMsg(`✅ Solved in ${pzFmtMs(timeMs)} — +${earned} points 🎯`, '#61bd4f');
      document.getElementById('pz-hud-sub').textContent =
        `Points mile! Mistakes: ${pzState.mistakes}`;
    } else {
      pzHudMsg(`✅ Solved in ${pzFmtMs(timeMs)} — +0 points`, '#61bd4f');
      document.getElementById('pz-hud-sub').textContent =
        `Pehli baar solve par hi points milte hain • Mistakes: ${pzState.mistakes}`;
    }
  } else {
    pzHudMsg('❌ Puzzle fail — +0 points. ◀ ▶ se solution moves dekho:', '#d46060');
    // Solution navigator — user Prev/Next se ek-ek move aage/peeche dekh sakta hai
    pzState.revealIdx = pzState.solIdx - 1;   // abhi ki board position tak ke moves lage hue hain
    if (nav) nav.style.display = '';
    pzUpdateRevealMsg();
  }
  btnNext.style.display = '';
  pzRefreshUI();
}

// Give-up ke baad solution navigate karo — dir=+1 next move, -1 previous move
function pzRevealStep(dir) {
  if (!pzState.active || !pzState.done || pzState.revealIdx == null) return;
  const sol = pzState.puzzle.solution;
  const next = pzState.revealIdx + dir;
  if (next < pzState.solIdx - 1 || next >= sol.length) return;   // range lock
  pzState.revealIdx = next;

  // Board ko FEN + solution[0..revealIdx] se rebuild karo — robust prev/next
  const g = new Chess(pzState.puzzle.fen);
  for (let i = 0; i <= pzState.revealIdx; i++) {
    const uci = sol[i];
    g.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4) || undefined });
  }
  pzState.game = g;
  pzClearTapSelection();
  board.position(g.fen());

  if (pzState.revealIdx >= pzState.solIdx) {
    const hist = g.history({ verbose: true });
    const last = hist[hist.length - 1];
    clearArrows();
    drawArrow(last.from, last.to, 'last');
  } else {
    clearArrows();   // starting position — koi reveal move nahi
  }
  pzUpdateRevealMsg();
}

function pzUpdateRevealMsg() {
  const total = pzState.puzzle.solution.length - pzState.solIdx;
  const step = Math.max(0, pzState.revealIdx - pzState.solIdx + 1);
  if (pzState.revealIdx >= pzState.puzzle.solution.length - 1) {
    pzHudMsg('🏁 Solution complete — ▶ Next se naya puzzle try karo');
  } else {
    pzHudMsg(`👀 Solution move ${step} / ${total} — ◀ ▶ se navigate karo`);
  }
}

function pzGiveUp() {
  if (!pzState.active || pzState.done) return;
  pzFinish(false);
}

function pzNextUnsolved() {
  const unsolved = pzList.filter(p => p.solved !== true && p.id !== pzState.puzzle.id);
  if (unsolved.length > 0) {
    startPuzzle(unsolved[Math.floor(Math.random() * unsolved.length)]);
  } else {
    pzExit();
  }
}

// ── Tab switch handling ──────────────────────────────────────
// switchTab() se call hota hai — HUD hide/pause aur restore yahin hota hai

function pzOnTabSwitch(name) {
  const hud = document.getElementById('pz-hud');
  if (!pzState || !pzState.active) {
    if (hud) hud.style.display = 'none';
    return;
  }
  if (name === 'play') {
    if (hud && !pzState.done) hud.style.display = 'block';
    pzResumeTimer();
  } else {
    // Doosre tab pe gaye — HUD chupao, timer pause (time barbaad na ho)
    pzPauseTimer();
    if (hud) hud.style.display = 'none';
  }
}

// Play tab pe wapas aane par puzzle position + HUD restore karo
function pzOnPlayTabReturn() {
  if (!pzState.active) return;
  board.position(pzState.game.fen());
  updatePlayBoardVisibility();
  const hud = document.getElementById('pz-hud');
  if (hud && !pzState.done) hud.style.display = 'block';
  pzResumeTimer();
}

// ── List & stats UI ───────────────────────────────────────────

// Random unsolved puzzle start karo (🎲 Solve Puzzle button)
async function pzSolveRandom() {
  if (!pzList.length) await pzRefreshUI();
  const unsolved = pzList.filter(p => p.solved !== true);
  if (!unsolved.length) {
    alert('Koi unsolved puzzle nahi — pehle 📥 Get Puzzles se fetch ya import karo!');
    return;
  }
  startPuzzle(JSON.parse(JSON.stringify(unsolved[Math.floor(Math.random() * unsolved.length)])));
}

// Puzzle list collapsible — by default hidden, header tap par open/close
function pzToggleList(open) {
  const body  = document.getElementById('pz-list-body');
  const arrow = document.getElementById('pz-list-arrow');
  if (!body) return;
  const willShow = (typeof open === 'boolean') ? open : body.style.display === 'none';
  body.style.display = willShow ? '' : 'none';
  if (arrow) arrow.textContent = willShow ? '▾' : '▸';
}

// Daily history collapsible — last 30 days, hidden by default
let pzDailyStats = {};   // cache from pzRefreshUI

function pzToggleDaily(open) {
  const body  = document.getElementById('pz-daily-body');
  const arrow = document.getElementById('pz-daily-arrow');
  if (!body) return;
  const willShow = (typeof open === 'boolean') ? open : body.style.display === 'none';
  body.style.display = willShow ? '' : 'none';
  if (arrow) arrow.textContent = willShow ? '▾' : '▸';
  if (willShow) pzRenderDaily();
}

function pzRenderDaily() {
  const list  = document.getElementById('pz-daily-list');
  const summ  = document.getElementById('pz-daily-summary');
  if (!list) return;

  // Last 30 days me se sirf woh dikhao jisme data hai
  const today = new Date();
  const days = [];
  for (let i = 0; i < 30; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const info = pzDailyStats[key];
    const dayName = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    const isToday = i === 0;
    days.push({ key, dayName, isToday, pts: info?.points ?? 0, solved: info?.solved ?? 0 });
  }

  // Summary line
  const activeDays = days.filter(d => d.pts > 0 || d.solved > 0).length;
  const totalPts   = days.reduce((s, d) => s + d.pts, 0);
  if (summ) summ.textContent = activeDays > 0 ? `${activeDays} days active · ${totalPts} pts` : '';

  // Rows
  list.innerHTML = days.map(d => {
    const bg    = d.isToday ? 'background:rgba(196,163,90,0.08);border-color:rgba(196,163,90,0.3)' : '';
    const label = d.isToday ? d.dayName + ' (Today)' : d.dayName;
    const has   = d.pts > 0 || d.solved > 0;
    return `<div style="display:flex;align-items:center;gap:8px;padding:6px 10px;background:var(--bg3);border:1px solid var(--border);border-radius:6px;font-size:11px;${bg}">
      <span style="flex:1;color:${has ? 'var(--text)' : 'var(--text3)'}">${label}</span>
      <span style="color:var(--text3)">${d.solved > 0 ? d.solved + ' solve' + (d.solved > 1 ? 's' : '') : '—'}</span>
      <span style="color:${d.pts > 0 ? 'var(--accent2)' : 'var(--text3)'};font-weight:600;min-width:36px;text-align:right">${d.pts > 0 ? d.pts + ' pts' : '0'}</span>
    </div>`;
  }).join('');
}


function pzRowHtml(p) {
  const tick = p.solved === true ? '✅'
             : p.solved === false ? '❌' : '⬜';
  const ptsBadge = (p.solved === true)
    ? `<span style="font-size:10px;font-weight:700;color:${(p.points_earned??0)>0?'var(--accent2)':'var(--text3)'};white-space:nowrap">+${p.points_earned??0} pts</span>`
    : '';
  const meta = [
    p.rating ? `⭐ ${p.rating}` : '',
    p.best_time_ms ? `⏱ ${pzFmtMs(p.best_time_ms)}` : '',
    (p.themes || '').split(',').slice(0, 2).join(', '),
  ].filter(Boolean).join(' • ');
  return `<div style="background:var(--bg3);border:1px solid var(--border);border-radius:7px;padding:8px 10px;display:flex;align-items:center;gap:8px">
        <span style="font-size:14px">${tick}</span>
        <span style="flex:1;min-width:0">
          <span style="font-size:11px;font-weight:600;color:var(--text)">${escHtml(meta)}</span>
        </span>
        ${ptsBadge}
        <button class="btn sm" title="Copy FEN" onclick='pzCopyFen("${p.id}")'>📋 FEN</button>
        <button class="btn primary sm" onclick='startPuzzleById("${p.id}")'>▶ Solve</button>
      </div>`;
}

async function pzRefreshUI() {
  try {
    const res = await fetch(`${FLASK_URL}/puzzles/list`);
    const data = await res.json();
    pzList = data.puzzles || [];
    const st = data.stats || {};

    document.getElementById('pz-stat-points').textContent = st.total_points ?? 0;
    pzDailyStats = st.daily || {};

    const todayEl = document.getElementById('pz-stat-today');
    if (todayEl) {
      todayEl.textContent = st.today?.points ?? 0;
    }
    const bdEl = document.getElementById('pz-stat-bestday');
    if (bdEl) {
      bdEl.textContent = st.best_day?.points ?? 0;
      const dateLbl = document.getElementById('pz-stat-bestday-date');
      if (dateLbl && st.best_day?.date) dateLbl.textContent = st.best_day.date;
    }

    const avgEl = document.getElementById('pz-stat-avg');
    if ((st.total_solved ?? 0) > 0 && (st.total_time_ms ?? 0) > 0) {
      avgEl.textContent = `Avg solve time: ${pzFmtMs(st.total_time_ms / st.total_solved)} • Failed: ${st.total_failed ?? 0}`;
    } else {
      avgEl.textContent = '';
    }

    const solvedCount = pzList.filter(p => p.solved === true).length;
    document.getElementById('pz-count-label').textContent = `${solvedCount}/${pzList.length} solved`;

    const body   = document.getElementById('pz-list-body');
    const empty  = document.getElementById('pz-list-empty');
    const groups = document.getElementById('pz-list-groups');
    if (!body) return;

    if (pzList.length === 0) {
      if (empty) empty.style.display = '';
      if (groups) groups.style.display = 'none';
      return;
    }
    if (empty) empty.style.display = 'none';
    if (groups) groups.style.display = 'flex';

    const unsolved = pzList.filter(p => p.solved !== true);
    const solved   = pzList.filter(p => p.solved === true);
    document.getElementById('pz-count-unsolved').textContent = unsolved.length;
    document.getElementById('pz-count-solved').textContent = solved.length;
    document.getElementById('pz-list-unsolved').innerHTML =
      unsolved.map(pzRowHtml).join('') || '<div style="font-size:11px;color:var(--text3);text-align:center;padding:6px 0">Sab solved! 🎉</div>';
    document.getElementById('pz-list-solved').innerHTML =
      solved.map(pzRowHtml).join('') || '<div style="font-size:11px;color:var(--text3);text-align:center;padding:6px 0">Abhi koi solved nahi</div>';
  } catch (e) {
    console.error('pzRefreshUI failed', e);
  }
}

function startPuzzleById(id) {
  const p = pzList.find(x => x.id === id);
  if (p) startPuzzle(JSON.parse(JSON.stringify(p)));   // deep copy — original stays untouched
}

// Puzzle ki FEN copy karo — Analysis tab me paste karke khud analyse karo
function pzCopyFen(id) {
  const p = pzList.find(x => x.id === id);
  if (!p || !p.fen) return;
  const done = () => {
    const stat = document.getElementById('pz-fetch-status');
    if (stat) {
      stat.style.display = 'block';
      stat.textContent = '✅ FEN copied! Analysis tab me FEN box me paste karo.';
      setTimeout(() => { stat.style.display = 'none'; }, 2500);
    }
  };
  // Modern clipboard API (https/localhost) — warna fallback
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(p.fen).then(done).catch(() => _pzCopyFallback(p.fen, done));
  } else {
    _pzCopyFallback(p.fen, done);
  }
}

function _pzCopyFallback(text, cb) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;left:-9999px;top:0';
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  try { document.execCommand('copy'); cb && cb(); }
  catch (e) { alert('Copy fail — FEN: ' + text); }
  document.body.removeChild(ta);
}

// ── Fetch / Import / Clear ────────────────────────────────────

async function pzFetch(count) {
  const btn  = document.getElementById('pz-fetch-btn');
  const stat = document.getElementById('pz-fetch-status');
  btn.disabled = true;
  btn.textContent = '⏳ Fetching...';
  stat.style.display = 'block';
  stat.textContent = 'Lichess se puzzles aa rahe hain...';
  try {
    const res = await fetch(`${FLASK_URL}/puzzles/fetch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ count: count }),
    });
    const data = await res.json();
    if (data.ok) {
      stat.textContent = `✅ ${data.saved} naye puzzles mile! Total: ${data.total}`;
    } else {
      stat.textContent = `❌ ${data.error || 'Fetch fail — internet check karo'}`;
    }
  } catch (e) {
    stat.textContent = '❌ Server error — Flask chal raha hai?';
  }
  btn.disabled = false;
  btn.textContent = '⬇ Lichess se Fetch (5)';
  pzRefreshUI();
}

function pzToggleImport() {
  const panel = document.getElementById('pz-import-panel');
  panel.style.display = panel.style.display === 'none' ? 'flex' : 'none';
}

async function pzImportCsv() {
  const text = document.getElementById('pz-import-text').value.trim();
  const btn  = document.getElementById('pz-import-btn');
  if (!text) { alert('Pehle CSV rows paste karo!'); return; }
  btn.disabled = true;
  btn.textContent = '⏳ Importing...';
  try {
    const res = await fetch(`${FLASK_URL}/puzzles/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    const data = await res.json();
    if (data.error) {
      alert('Import fail: ' + data.error);
    } else {
      document.getElementById('pz-fetch-status').style.display = 'block';
      document.getElementById('pz-fetch-status').textContent =
        `✅ ${data.saved} imported, ${data.skipped} skipped/duplicate. Total: ${data.total}`;
      document.getElementById('pz-import-text').value = '';
    }
  } catch (e) {
    alert('Server error — Flask chal raha hai?');
  }
  btn.disabled = false;
  btn.textContent = '📥 Import Pasted Rows';
  pzRefreshUI();
}

async function pzClearAll() {
  if (!confirm('Saare puzzles delete kar dein? Stats bhi reset ho jayenge.')) return;
  try {
    await fetch(`${FLASK_URL}/puzzles`, { method: 'DELETE' });
    pzRefreshUI();
  } catch (e) { /* ignore */ }
}
