// ============================================================
// puzzles.js — Tactics Puzzle Mode (same board, timer, streak)
//   - Lichess se fetch / CSV DB import
//   - Solve on the main board via tap-to-move
//   - Per-puzzle ✅ ticks, solve time, global streak stats
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
};

let pzSelSquare = null;
let pzLegalSquares = [];
let pzList = [];

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

function pzStartTimer() {
  pzStopTimer();
  pzState.timerIv = setInterval(() => {
    document.getElementById('pz-hud-timer').textContent =
      pzFmtMs(Date.now() - pzState.startTime);
  }, 500);
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

  pzEnsureHud();
  pzState = {
    active: true, puzzle: p,
    game: new Chess(p.fen),
    solIdx: 1,           // solution[0] is the opponent's setup move
    mistakes: 0, startTime: Date.now(),
    timerIv: null, done: false, waitingOpp: false,
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
  const hud = document.getElementById('pz-hud');
  if (hud) hud.style.display = 'none';
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
    drawArrow(mv.from, mv.to, 'last');
  }
  return mv;
}

function pzCorrectMove(mv) {
  drawArrow(mv.from, mv.to, 'last');
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
  const timeMs = Date.now() - pzState.startTime;
  try {
    await fetch(`${FLASK_URL}/puzzles/result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: pzState.puzzle.id,
        solved: solved,
        time_ms: timeMs,
        mistakes: pzState.mistakes,
      }),
    });
  } catch (e) { /* offline — stats local skip */ }
  return timeMs;
}

async function pzFinish(solved) {
  pzState.done = true;
  pzStopTimer();
  const timeMs = await pzRecordResult(solved);

  const btnNext = document.getElementById('pz-btn-next');
  if (solved) {
    const clean = pzState.mistakes === 0;
    pzHudMsg(`✅ Solved in ${pzFmtMs(timeMs)}${clean ? ' — Flawless! 🎯' : ''}`, '#61bd4f');
    document.getElementById('pz-hud-sub').textContent =
      `Streak badh gaya 🔥 • Mistakes: ${pzState.mistakes}`;
  } else {
    pzHudMsg('❌ Puzzle fail — streak reset. Solution dekho:', '#d46060');
    // Reveal remaining solution moves one by one
    let i = pzState.solIdx;
    const reveal = () => {
      if (!pzState.active || i >= pzState.puzzle.solution.length) return;
      pzApplyUci(pzState.puzzle.solution[i]);
      i++;
      setTimeout(reveal, 600);
    };
    reveal();
  }
  btnNext.style.display = '';
  pzRefreshUI();
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

// ── List & stats UI ───────────────────────────────────────────

async function pzRefreshUI() {
  try {
    const res = await fetch(`${FLASK_URL}/puzzles/list`);
    const data = await res.json();
    pzList = data.puzzles || [];
    const st = data.stats || {};

    document.getElementById('pz-stat-solved').textContent = st.total_solved ?? 0;
    document.getElementById('pz-stat-streak').textContent = st.current_streak ?? 0;
    document.getElementById('pz-stat-best').textContent   = st.best_streak ?? 0;

    const avgEl = document.getElementById('pz-stat-avg');
    if ((st.total_solved ?? 0) > 0 && (st.total_time_ms ?? 0) > 0) {
      avgEl.textContent = `Avg solve time: ${pzFmtMs(st.total_time_ms / st.total_solved)} • Failed: ${st.total_failed ?? 0}`;
    } else {
      avgEl.textContent = '';
    }

    document.getElementById('pz-count-label').textContent = `${pzList.length} puzzles`;

    const body = document.getElementById('pz-list-body');
    if (pzList.length === 0) {
      body.innerHTML = '<div style="font-size:11px;color:var(--text3);text-align:center;padding:10px 0">Koi puzzle nahi — upar se fetch ya import karo</div>';
      return;
    }

    body.innerHTML = pzList.map(p => {
      const tick = p.solved === true ? '✅'
                 : p.solved === false ? '❌' : '⬜';
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
        <button class="btn primary sm" onclick='startPuzzleById("${p.id}")'>▶ Solve</button>
      </div>`;
    }).join('');
  } catch (e) {
    console.error('pzRefreshUI failed', e);
  }
}

function startPuzzleById(id) {
  const p = pzList.find(x => x.id === id);
  if (p) startPuzzle(JSON.parse(JSON.stringify(p)));   // deep copy — original stays untouched
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
