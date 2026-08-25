// ============================================================
// history.js — Play history tab: render list, detail view,
//               eval chart scrubber, save/delete, review panel
// ============================================================

// ============================================================
// analysis.js — analyzePosition, eval bar, history tab,
//                PGN import/render, eval chart scrubber
// ============================================================

  // Analysis
  async function analyzePosition() {
      if (window._isAnalyzing) return;
  window._isAnalyzing = true;
  clearHighlights();
const depth = parseInt(document.getElementById('depth-slider').value);
    const fen = game.fen();
    document.getElementById('analyzing-indicator').classList.add('show');
    document.getElementById('best-move').textContent = '...';
    document.getElementById('best-line').textContent = '';

    try {
      const res = await fetch(`${FLASK_URL}/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fen, depth })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      document.getElementById('best-move').textContent = data.best_move || '—';
      document.getElementById('best-line').textContent = data.pv ? data.pv.join(' ') : '';

      updateEvalBar(data.score, data.mate);
      document.getElementById('depth-status').textContent = `depth ${data.depth || depth}`;

      if (data.best_move && data.best_move.length >= 4) {
        window._arrowBest = { from: data.best_move.slice(0,2), to: data.best_move.slice(2,4) };
        // Clear only best/blue arrows, keep last-move arrow
        const svg = document.getElementById('arrow-svg');
        [...svg.children].forEach(el => { if (el.tagName !== 'defs') el.remove(); });
        if (window._arrowLast) drawArrowSVG(window._arrowLast.from, window._arrowLast.to, 'ah-last', 'rgba(128,128,128,0.9)');
        if (window._suggestionOn) {
          drawArrowSVG(data.best_move.slice(0,2), data.best_move.slice(2,4), 'ah-best', 'rgba(97,189,79,0.93)');
        } else {
          _drawBlueArrowIfCardVisible();
        }
      }
    } catch(e) {
      document.getElementById('best-move').textContent = 'Error';
      document.getElementById('best-line').textContent = e.message;
    } finally {
      window._isAnalyzing = false;
      document.getElementById('analyzing-indicator').classList.remove('show');
    }
  }

  function updateEvalBar(score, mate) {
    const evalText = document.getElementById('eval-text');
    const evalBar = document.getElementById('eval-bar');

    if (mate !== null && mate !== undefined) {
      const mateStr = `M${Math.abs(mate)}`;
      evalText.textContent = (mate > 0 ? '+' : '-') + mateStr;
      evalText.style.color = mate > 0 ? 'var(--accent2)' : 'var(--danger)';
      // White advantage = fill more. Always from white's POV regardless of board flip
      evalBar.style.width = mate > 0 ? '92%' : '8%';
      return;
    }

    if (score === null || score === undefined) return;
    const cp = score / 100;
    const formatted = (cp >= 0 ? '+' : '') + cp.toFixed(2);
    evalText.textContent = formatted;
    evalText.style.color = cp > 0 ? 'var(--accent2)' : cp < 0 ? 'var(--danger)' : 'var(--text2)';

    // chess.com Expected Points Model formula: WinP = 1 / (1 + 10^(-cp/400))
    // Same formula as backend win_prob_white() — always white's win probability
    const pct = 100 / (1 + Math.pow(10, -score / 400));
    evalBar.style.width = Math.max(4, Math.min(96, pct)) + '%';
  }

  function resetEval() {
    document.getElementById('eval-text').textContent = '0.00';
    document.getElementById('eval-text').style.color = 'var(--accent)';
    document.getElementById('eval-bar').style.width = '50%';
  }

  // FEN
  function updateFENDisplay() {
    const el = document.getElementById('current-fen');
    if (el) el.textContent = game.fen();
  }

  function loadFEN() {
    const fen = document.getElementById('fen-input').value.trim();
    if (!fen) return;
    const testGame = new Chess();
    if (!testGame.load(fen)) {
      alert('Invalid FEN!');
      return;
    }
    game.load(fen);
    board.position(fen);
    startFen = fen;
    moveHistory = [];
    currentMoveIdx = -1;
    _varIdCounter = 0;
    varTree = [_newVarNode(null, 0, [], 'Main Line')];
    activeVarId = varTree[0].id;
    clearHighlights();
    updateFENDisplay();
    updatePGNMoves();
    updateTurnLabel();
    analyzePosition();
    analysisPlayerInfo = null;
    document.getElementById('analysis-label-top').textContent    = '♟ Black';
    document.getElementById('analysis-label-bottom').textContent = '♙ White';
    document.getElementById('analysis-time-top').style.display    = 'none';
    document.getElementById('analysis-time-bottom').style.display = 'none';
    document.getElementById('analysis-top-row').classList.add('show');
    document.getElementById('analysis-bottom-row').classList.add('show');
    _updateAnalysisCaptured(game);
  }

  async function pasteAndLoad() {
    try {
      const text = await navigator.clipboard.readText();
      document.getElementById('fen-input').value = text;
    } catch(e) {
      const manual = prompt('Clipboard access denied. Please paste FEN manually:');
      if (manual) document.getElementById('fen-input').value = manual;
    }
  }

  function copyToClipboard(text, flashId) {
    const flash = flashId ? document.getElementById(flashId) : null;
    const showFlash = () => {
      if (flash) {
        flash.classList.add('show');
        setTimeout(() => flash.classList.remove('show'), 1500);
      }
    };
    navigator.clipboard.writeText(text).then(showFlash).catch(() => {
      const el = document.createElement('textarea');
      el.value = text;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      showFlash();
    });
  }

  function copySetupPGN() {
    // Build FEN from the current setup-tray board state (placement + chosen turn/castling)
    const placement = game.fen().split(' ')[0];
    let castling = '';
    if (document.getElementById('castling-wk').checked) castling += 'K';
    if (document.getElementById('castling-wq').checked) castling += 'Q';
    if (document.getElementById('castling-bk').checked) castling += 'k';
    if (document.getElementById('castling-bq').checked) castling += 'q';
    if (castling === '') castling = '-';
    const fen = `${placement} ${setupTurn} ${castling} - 0 1`;

    const pgn = `[Event "Setup Position"]\n[SetUp "1"]\n[FEN "${fen}"]\n\n*`;
    copyToClipboard(pgn, 'copied-flash');
    alert('PGN (set-up position) copied!');
  }

  function copyBvbPGN() {
    if (!bvbGame) { alert('No bot vs bot game in progress.'); return; }
    const pgn = bvbGame.pgn();
    copyToClipboard(pgn, 'copy-pgn-flash');
    const flash = document.getElementById('copy-pgn-flash');
    flash.classList.add('show');
    setTimeout(() => flash.classList.remove('show'), 1500);
  }

  function copyPlayPGN() {
    const pgn = playGame.pgn();
    const flash = document.getElementById('copy-pgn-flash');
    const btn = document.getElementById('copy-pgn-btn');
    btn.classList.remove('pulse'); // stop popping once user copies

    const showFlash = () => {
      flash.classList.add('show');
      setTimeout(() => flash.classList.remove('show'), 1500);
    };

    navigator.clipboard.writeText(pgn).then(showFlash).catch(() => {
      const el = document.createElement('textarea');
      el.value = pgn;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      showFlash();
    });
  }

  // ═══════════════════════════════════════════════════════════════
  //  GAME HISTORY — list, detail view, per-move times
  // ═══════════════════════════════════════════════════════════════

  let _historyGames = [];
  let _historyDetailGame = null;
  let _historySelectMode = false;
  let _historySelected = new Set();

  function formatHistTime(ms) {
    if (ms === null || ms === undefined) return '';
    const totalSec = Math.round(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    if (m > 0) return `${m}m ${s}s`;
    return `${(ms/1000).toFixed(1)}s`;
  }

  function formatHistDate(unixSec) {
    if (!unixSec) return '';
    const d = new Date(unixSec * 1000);
    const pad = n => String(n).padStart(2, '0');
    const day   = pad(d.getDate());
    const month = pad(d.getMonth() + 1);
    const year  = d.getFullYear();
    const rawH  = d.getHours();
    const ampm  = rawH >= 12 ? 'PM' : 'AM';
    const hour  = rawH % 12 || 12;
    const min   = pad(d.getMinutes());
    return `${day}/${month}/${year} ${hour}:${min} ${ampm}`;
  }

  async function renderHistoryList() {
    const body = document.getElementById('history-list-body');
    body.innerHTML = '<div style="font-size:11px;color:var(--text3);text-align:center;padding:10px 0">Loading...</div>';

    // Pre-load reviewed fingerprints so blue ticks show correctly
    await _refreshReviewedFingerprints();

    try {
      const res = await fetch(`${FLASK_URL}/play/history`);
      const data = await res.json();
      _historyGames = data.games || [];
    } catch(e) {
      body.innerHTML = '<div style="font-size:11px;color:var(--danger);text-align:center;padding:10px 0">Failed to load history</div>';
      return;
    }

    if (_historyGames.length === 0) {
      body.innerHTML = '<div style="font-size:11px;color:var(--text3);text-align:center;padding:10px 0">No games played yet</div>';
      return;
    }

    body.innerHTML = '';

    const playbotGames = _historyGames.filter(g => g.mode === 'playbot');
    const bvbGames     = _historyGames.filter(g => g.mode === 'botvsbot');
    const friendGames  = _historyGames.filter(g => g.mode === 'friend');

    function _makeGroup(icon, label, games, defaultOpen) {
      const grp = document.createElement('div');
      grp.className = 'hist-group';
      if (!defaultOpen) grp.classList.add('collapsed');

      const hdr = document.createElement('div');
      hdr.className = 'hist-group-header';
      hdr.onclick = () => grp.classList.toggle('collapsed');

      const titleRow = document.createElement('div');
      titleRow.className = 'hist-group-title';
      titleRow.innerHTML = `${icon} ${label} <span class="hist-group-count">${games.length}</span>`;

      const chevron = document.createElement('span');
      chevron.className = 'hist-group-chevron';
      chevron.textContent = '\u25BC';

      hdr.appendChild(titleRow);
      hdr.appendChild(chevron);

      const body = document.createElement('div');
      body.className = 'hist-group-body';
      games.forEach(g => body.appendChild(_makeHistoryItem(g)));

      grp.appendChild(hdr);
      grp.appendChild(body);
      return grp;
    }

    function _makeHistoryItem(g) {
      const item = document.createElement('div');
      item.className = 'history-item';

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.style.cssText = 'display:none;width:16px;height:16px;flex-shrink:0;accent-color:var(--danger);cursor:pointer;';
      cb.id = 'hist-cb-' + g.id;
      cb.checked = _historySelected.has(g.id);
      cb.onchange = () => {
        if (cb.checked) _historySelected.add(g.id);
        else _historySelected.delete(g.id);
        _updateHistorySelectCount();
      };
      item.appendChild(cb);

      if (_historySelectMode) {
        cb.style.display = '';
        item.onclick = (e) => {
          if (e.target === cb) return;
          cb.checked = !cb.checked;
          if (cb.checked) _historySelected.add(g.id);
          else _historySelected.delete(g.id);
          _updateHistorySelectCount();
        };
      } else {
        item.onclick = () => openHistoryDetail(g.id);
      }

      const left = document.createElement('div');
      left.className = 'history-item-left';

      const modeLabel = g.mode === 'botvsbot' ? '⚔ Bot vs Bot' : (g.mode === 'friend' ? '👥 Play Friend' : '♟ vs Bot');
      const titleEl = document.createElement('div');
      titleEl.className = 'history-item-title';
      titleEl.textContent = `${g.white_name || 'White'} vs ${g.black_name || 'Black'}`;

      const subEl = document.createElement('div');
      subEl.className = 'history-item-sub';
      const moveCount = (g.moves || []).length;
      subEl.textContent = `${modeLabel} · ${moveCount} moves · ${g.reason || ''} · ${formatHistDate(g.ended_at)}`;

      left.appendChild(titleEl);
      left.appendChild(subEl);

      const resultEl = document.createElement('div');
      let cls = 'draw', label = g.result || '*';
      if (g.winner === 'white') { label = '1-0'; }
      else if (g.winner === 'black') { label = '0-1'; }
      else if (g.winner === 'draw') { label = '½-½'; }

      if (g.mode === 'playbot') {
        const playerColor = g.player_color === 'w' ? 'white' : 'black';
        if (g.winner === 'draw') cls = 'draw';
        else if (g.winner === playerColor) cls = 'win';
        else cls = 'loss';
      } else {
        cls = g.winner === 'draw' ? 'draw' : 'win';
      }

      resultEl.className = 'history-item-result ' + cls;
      resultEl.textContent = label;

      // Right side: result + optional blue tick for reviewed games
      const rightCol = document.createElement('div');
      rightCol.style.cssText = 'display:flex;flex-direction:column;align-items:flex-end;gap:3px;flex-shrink:0';
      rightCol.appendChild(resultEl);
      const isReviewed = _reviewedFingerprints.size > 0 && g.pgn &&
                         _reviewedFingerprints.has(_pgnMoveBody(g.pgn));
      if (isReviewed) {
        const tick = document.createElement('span');
        tick.title = 'Reviewed';
        tick.style.cssText = 'font-size:10px;color:#4a9eff;font-weight:700;line-height:1';
        tick.textContent = '✔ Reviewed';
        rightCol.appendChild(tick);
      }
      item.appendChild(left);
      item.appendChild(rightCol);
      return item;
    }

    // ── Play with Friend group ──
    if (friendGames.length > 0) {
      body.appendChild(_makeGroup('\uD83D\uDC65', 'Play with Friend', friendGames, playbotGames.length === 0 && bvbGames.length === 0));
    }

    // ── Player vs Bot group ──
    if (playbotGames.length > 0) {
      body.appendChild(_makeGroup('\u265F', 'Player vs Bot', playbotGames, friendGames.length === 0));
    }

    // ── Bot vs Bot group ──
    if (bvbGames.length > 0) {
      body.appendChild(_makeGroup('\u2694\uFE0F', 'Bot vs Bot', bvbGames, playbotGames.length === 0 && friendGames.length === 0));
    }
  }

  function openHistoryDetail(gameId) {
    const g = _historyGames.find(x => x.id === gameId);
    if (!g) return;
    _historyDetailGame = g;

    document.getElementById('history-detail').style.display = 'flex';

    const modeLabel = g.mode === 'botvsbot' ? '⚔ Bot vs Bot' : (g.mode === 'friend' ? '👥 Play Friend' : '♟ Play vs Bot');
    document.getElementById('history-detail-title').textContent =
      `${g.white_name || 'White'} vs ${g.black_name || 'Black'}`;

    let resultLabel = g.result || '*';
    if (g.winner === 'white') resultLabel = '1 – 0  (White wins)';
    else if (g.winner === 'black') resultLabel = '0 – 1  (Black wins)';
    else if (g.winner === 'draw') resultLabel = '½ – ½  (Draw)';

    const tc = g.time_control ? `${g.time_control.minutes} min/side` : 'No time control';
    const wLeft = g.white_time_left_ms !== undefined && g.white_time_left_ms !== null ? formatHistTime(g.white_time_left_ms) : '—';
    const bLeft = g.black_time_left_ms !== undefined && g.black_time_left_ms !== null ? formatHistTime(g.black_time_left_ms) : '—';

    const meta = document.getElementById('history-detail-meta');
    meta.innerHTML = `
      <div><b>Mode:</b> ${modeLabel}</div>
      <div><b>Result:</b> ${resultLabel}</div>
      <div><b>Reason:</b> ${g.reason || '—'}</div>
      <div><b>Played:</b> ${formatHistDate(g.ended_at)}</div>
      <div><b>Time control:</b> ${tc}</div>
      <div><b>Time left — White:</b> ${wLeft} &nbsp;|&nbsp; <b>Black:</b> ${bLeft}</div>
    `;

    // Load review data if this game has been reviewed
    _loadHistoryReviewPanel(g);

    // Scroll detail into view
    document.getElementById('history-detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function closeHistoryDetail() {
    _historyDetailGame = null;
    document.getElementById('history-detail').style.display = 'none';
  }

  // ── Review data panel inside history detail ───────────────────────────
  // Match this game to a saved review by comparing PGN move bodies

  function _pgnMoveBody(pgn) {
    return (pgn || '').replace(/\[[^\]]*\]\s*/g, '').replace(/\{[^}]*\}/g, '').trim().slice(0, 300);
  }

  async function _loadHistoryReviewPanel(g) {
    const panel    = document.getElementById('history-review-panel');
    const noReview = document.getElementById('history-no-review');
    if (!panel || !noReview) return;
    panel.style.display    = 'none';
    noReview.style.display = 'none';

    // Load all review history entries
    let entries = [];
    try {
      const res = await fetch(`${FLASK_URL}/review/history`);
      const data = await res.json();
      entries = data.games || [];
    } catch(e) { noReview.style.display = ''; return; }

    // Find best matching review — same PGN, highest accuracy (deepest analysis wins)
    const myBody = _pgnMoveBody(g.pgn);
    const matches = entries.filter(r => _pgnMoveBody(r.pgn) === myBody);
    if (matches.length === 0) {
      noReview.style.display = '';
      return;
    }
    const review = matches.reduce((best, r) => {
      const bScore = (best.white_acc || 0) + (best.black_acc || 0);
      const rScore = (r.white_acc   || 0) + (r.black_acc   || 0);
      return rScore > bScore ? r : best;
    });

    // Show panel
    panel.style.display = 'flex';

    // Draw eval chart
    _drawHistoryEvalChart(review.moves || []);

    // Draw classification table
    _drawHistoryReviewTable(review);
  }

  async function _loadImportedReviewPanel(g) {
    const panel    = document.getElementById('imported-review-panel');
    const noReview = document.getElementById('imported-no-review');
    if (!panel || !noReview) return;
    panel.style.display    = 'none';
    noReview.style.display = 'none';

    // Load all review history entries
    let entries = [];
    try {
      const res = await fetch(`${FLASK_URL}/review/history`);
      const data = await res.json();
      entries = data.games || [];
    } catch(e) { noReview.style.display = ''; return; }

    // Find best matching review — same PGN, highest accuracy (deepest analysis wins)
    const myBody = _pgnMoveBody(g.pgn);
    const matches = entries.filter(r => _pgnMoveBody(r.pgn) === myBody);
    if (matches.length === 0) {
      noReview.style.display = '';
      return;
    }
    const review = matches.reduce((best, r) => {
      const bScore = (best.white_acc || 0) + (best.black_acc || 0);
      const rScore = (r.white_acc   || 0) + (r.black_acc   || 0);
      return rScore > bScore ? r : best;
    });

    // Show panel
    panel.style.display = 'flex';

    // Draw eval chart (reuse same drawing function with imported canvas)
    _drawImportedEvalChart(review.moves || []);

    // Draw classification table (reuse same drawing function with imported table el)
    _drawImportedReviewTable(review);
  }

  // ── Eval Chart Scrubber ─────────────────────────────────────────────────────
  // Generic scrubber: attaches touch/mouse drag to a canvas overlay div.
  // Draws a vertical line + move number label at hovered position.
  // _evalChartScrubIdx[canvasId] stores current scrub index (-1 = none).
  const _evalChartScrubIdx = {};

  function _evalChartBaseRedraw(canvasId, moves) {
    // Calls the right base-draw function for each canvas
    // skipScrubberSetup=true so we don't re-attach listeners on every redraw
    if (canvasId === 'imported-eval-chart') _drawImportedEvalChart(moves, true);
    else if (canvasId === 'history-eval-chart') _drawHistoryEvalChart(moves, true);
    else if (canvasId === 'rv-eval-chart') _drawEvalChart(true); // uses rvState.moves internally
  }

  function _drawEvalChartScrubLine(canvas, moves, idx) {
    if (!canvas || idx < 0 || idx >= moves.length) return;
    const W = canvas.width, H = canvas.height;
    const ctx = canvas.getContext('2d');
    const n = moves.length;
    const xStep = W / Math.max(n - 1, 1);
    const x = idx * xStep;

    // Vertical line
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
    ctx.setLineDash([]);

    // Move number label — e.g. "12." for white, "12..." for black
    const moveNum = Math.floor(idx / 2) + 1;
    const isBlack = idx % 2 === 1;
    const label = isBlack ? `${moveNum}...` : `${moveNum}.`;
    ctx.font = 'bold 10px JetBrains Mono, monospace';
    const tw = ctx.measureText(label).width;
    // Position: above midpoint, flip side if too close to right edge
    const lx = (x + tw + 8 > W) ? x - tw - 6 : x + 4;
    const ly = 12;
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(lx - 2, ly - 10, tw + 4, 13);
    ctx.fillStyle = '#e8e4d8';
    ctx.fillText(label, lx, ly);
    ctx.restore();
  }

  function _attachEvalChartScrubber(canvasId, getMoves) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    // Remove old overlay if any
    const oldOverlay = canvas.parentElement.querySelector(`.eval-scrub-overlay[data-for="${canvasId}"]`);
    if (oldOverlay) oldOverlay.remove();

    _evalChartScrubIdx[canvasId] = -1;

    const overlay = document.createElement('div');
    overlay.className = 'eval-scrub-overlay';
    overlay.setAttribute('data-for', canvasId);
    overlay.style.cssText = `position:absolute;top:0;left:0;width:100%;height:${canvas.height || 90}px;cursor:crosshair;z-index:5;touch-action:pan-y`;

    // Make canvas parent relative if not already
    const parent = canvas.parentElement;
    if (getComputedStyle(parent).position === 'static') parent.style.position = 'relative';

    parent.appendChild(overlay);

    const getIdx = clientX => {
      const rect = canvas.getBoundingClientRect();
      const moves = getMoves();
      if (!moves || moves.length === 0) return -1;
      const relX = clientX - rect.left;
      const W = canvas.width;
      const n = moves.length;
      const xStep = W / Math.max(n - 1, 1);
      return Math.max(0, Math.min(n - 1, Math.round(relX / xStep)));
    };

    const onScrub = clientX => {
      const moves = getMoves();
      if (!moves || moves.length === 0) return;
      const idx = getIdx(clientX);
      if (idx === _evalChartScrubIdx[canvasId]) return;
      _evalChartScrubIdx[canvasId] = idx;
      _evalChartBaseRedraw(canvasId, moves);
      _drawEvalChartScrubLine(document.getElementById(canvasId), moves, idx);
    };

    const onEnd = () => {
      _evalChartScrubIdx[canvasId] = -1;
      const moves = getMoves();
      if (moves) _evalChartBaseRedraw(canvasId, moves);
    };

    // Mouse events
    overlay.addEventListener('mousemove', e => onScrub(e.clientX));
    overlay.addEventListener('mouseleave', onEnd);

    // Touch events
    overlay.addEventListener('touchstart', e => { onScrub(e.touches[0].clientX); }, { passive: true });
    overlay.addEventListener('touchmove',  e => { onScrub(e.touches[0].clientX); }, { passive: true });
    overlay.addEventListener('touchend',   onEnd, { passive: true });
  }
  // ── End Eval Chart Scrubber ─────────────────────────────────────────────────

  function _drawImportedEvalChart(moves, skipScrubberSetup) {
    const canvas = document.getElementById('imported-eval-chart');
    if (!canvas || moves.length === 0) return;
    const W = canvas.parentElement ? (canvas.parentElement.clientWidth - 0) : 300;
    const H = 90;
    canvas.width  = Math.max(W, 200);
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, W, H);

    const evals = moves.map(m => Math.max(-600, Math.min(600, m.eval_after !== undefined ? m.eval_after : 0)));
    const n = evals.length;
    if (n === 0) return;
    const xStep = W / Math.max(n - 1, 1);
    const toY = v => H / 2 - (v / 600) * (H / 2 - 4);

    ctx.fillStyle = 'rgba(255,255,255,0.04)'; ctx.fillRect(0, 0, W, H / 2);
    ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.fillRect(0, H / 2, W, H / 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, H/2); ctx.lineTo(W, H/2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, H/2);
    evals.forEach((v, i) => ctx.lineTo(i * xStep, toY(v)));
    ctx.lineTo((n-1)*xStep, H/2); ctx.closePath();
    ctx.fillStyle = 'rgba(232,228,216,0.25)'; ctx.fill();
    ctx.beginPath(); ctx.moveTo(0, H/2);
    evals.forEach((v, i) => ctx.lineTo(i * xStep, toY(v)));
    ctx.lineTo((n-1)*xStep, H/2); ctx.closePath();
    ctx.fillStyle = 'rgba(26,26,28,0.5)'; ctx.fill();
    ctx.beginPath();
    evals.forEach((v, i) => { const x = i*xStep, y = toY(v); i===0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y); });
    ctx.strokeStyle = 'rgba(196,163,90,0.85)'; ctx.lineWidth = 1.5; ctx.stroke();
    const QCOL = { Blunder:'#d44', Mistake:'#d46060', Inaccuracy:'#f0a500' };
    moves.forEach((mv, i) => {
      if (QCOL[mv.classification]) {
        ctx.beginPath();
        ctx.arc(i*xStep, toY(evals[i]), mv.classification==='Blunder' ? 3.5 : 2.5, 0, Math.PI*2);
        ctx.fillStyle = QCOL[mv.classification]; ctx.fill();
      }
    });

    if (!skipScrubberSetup) {
      // Store moves reference for scrubber redraw
      window._importedEvalMoves = moves;
      _attachEvalChartScrubber('imported-eval-chart', () => window._importedEvalMoves);
    }
  }

  function _drawImportedReviewTable(review) {
    const el = document.getElementById('imported-review-table');
    if (!el) return;
    const ORDER = ['Brilliant','Best','Excellent','Good','Inaccuracy','Mistake','Blunder'];
    const SYMS  = { Brilliant:'!!', Best:'✓', Excellent:'★', Good:'✦', Inaccuracy:'?!', Mistake:'?', Blunder:'??' };
    const QCOL  = { Brilliant:'#61bd4f', Best:'#61bd4f', Excellent:'#8fb86e', Good:'#c4a35a',
                    Inaccuracy:'#f0a500', Mistake:'#d46060', Blunder:'#d44' };
    const accColor = v => v >= 90 ? '#61bd4f' : v >= 75 ? '#c4a35a' : v >= 60 ? '#e0a84a' : '#d46060';
    const wAcc = review.white_acc, bAcc = review.black_acc;
    const wElo = review.white_elo, bElo = review.black_elo;
    let html = `<div style="display:grid;grid-template-columns:1fr 1fr;border:1px solid var(--border);border-radius:6px;overflow:hidden;font-size:11px">`;
    html += `<div style="padding:6px 10px;background:rgba(255,255,255,0.06);border-right:1px solid var(--border);font-weight:600;color:var(--text)">♙ ${review.white_name||'White'}</div>`;
    html += `<div style="padding:6px 10px;background:rgba(0,0,0,0.2);font-weight:600;color:var(--text)">♟ ${review.black_name||'Black'}</div>`;
    // Accuracy row
    html += `<div style="padding:6px 10px;border-right:1px solid var(--border);border-top:1px solid var(--border)">`;
    html += `<div style="font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:1px">Accuracy</div>`;
    html += `<span style="font-size:16px;font-weight:700;color:${accColor(wAcc)}">${wAcc !== null && wAcc !== undefined ? wAcc+'%' : '—'}</span></div>`;
    html += `<div style="padding:6px 10px;border-top:1px solid var(--border)">`;
    html += `<div style="font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:1px">Accuracy</div>`;
    html += `<span style="font-size:16px;font-weight:700;color:${accColor(bAcc)}">${bAcc !== null && bAcc !== undefined ? bAcc+'%' : '—'}</span></div>`;

    // Est. ELO row
    html += `<div style="padding:6px 10px;border-right:1px solid var(--border);border-top:1px solid var(--border)">`;
    html += `<div style="font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:1px">Est. ELO</div>`;
    html += `<span style="font-size:16px;font-weight:600;color:var(--accent)">${wElo ? wElo : '—'}</span></div>`;
    html += `<div style="padding:6px 10px;border-top:1px solid var(--border)">`;
    html += `<div style="font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:1px">Est. ELO</div>`;
    html += `<span style="font-size:16px;font-weight:600;color:var(--accent)">${bElo ? bElo : '—'}</span></div>`;

    ORDER.forEach(k => {
      const wC = (review.white_counts && review.white_counts[k]) || 0;
      const bC = (review.black_counts && review.black_counts[k]) || 0;
      if (wC === 0 && bC === 0) return;
      const col = QCOL[k] || 'var(--text3)';
      const sym = SYMS[k] || '';
      html += `<div style="padding:5px 10px;border-top:1px solid var(--border);border-right:1px solid var(--border);display:flex;justify-content:space-between;align-items:center">`;
      html += `<span style="color:${col};font-size:10px">${k} ${sym}</span><span style="font-weight:700;color:${col}">${wC||'—'}</span></div>`;
      html += `<div style="padding:5px 10px;border-top:1px solid var(--border);display:flex;justify-content:space-between;align-items:center">`;
      html += `<span style="color:${col};font-size:10px">${k} ${sym}</span><span style="font-weight:700;color:${col}">${bC||'—'}</span></div>`;
    });
    html += `</div>`;
    el.innerHTML = html;
  }

  function _drawHistoryEvalChart(moves, skipScrubberSetup) {
    const canvas = document.getElementById('history-eval-chart');
    if (!canvas || moves.length === 0) return;
    const W = canvas.parentElement ? (canvas.parentElement.clientWidth - 0) : 300;
    const H = 90;
    canvas.width  = Math.max(W, 200);
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, W, H);

    const evals = moves.map(m => Math.max(-600, Math.min(600, m.eval_after !== undefined ? m.eval_after : 0)));
    const n = evals.length;
    if (n === 0) return;
    const xStep = W / Math.max(n - 1, 1);
    const toY = v => H / 2 - (v / 600) * (H / 2 - 4);

    // Backgrounds
    ctx.fillStyle = 'rgba(255,255,255,0.04)'; ctx.fillRect(0, 0, W, H / 2);
    ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.fillRect(0, H / 2, W, H / 2);

    // Zero line
    ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, H/2); ctx.lineTo(W, H/2); ctx.stroke();

    // White fill
    ctx.beginPath(); ctx.moveTo(0, H/2);
    evals.forEach((v, i) => ctx.lineTo(i * xStep, toY(v)));
    ctx.lineTo((n-1)*xStep, H/2); ctx.closePath();
    ctx.fillStyle = 'rgba(232,228,216,0.25)'; ctx.fill();

    // Black fill
    ctx.beginPath(); ctx.moveTo(0, H/2);
    evals.forEach((v, i) => ctx.lineTo(i * xStep, toY(v)));
    ctx.lineTo((n-1)*xStep, H/2); ctx.closePath();
    ctx.fillStyle = 'rgba(26,26,28,0.5)'; ctx.fill();

    // Line
    ctx.beginPath();
    evals.forEach((v, i) => { const x = i*xStep, y = toY(v); i===0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y); });
    ctx.strokeStyle = 'rgba(196,163,90,0.85)'; ctx.lineWidth = 1.5; ctx.stroke();

    // Blunder/Mistake/Inaccuracy dots
    const QCOL = { Blunder:'#d44', Mistake:'#d46060', Inaccuracy:'#f0a500' };
    moves.forEach((mv, i) => {
      if (QCOL[mv.classification]) {
        ctx.beginPath();
        ctx.arc(i*xStep, toY(evals[i]), mv.classification==='Blunder' ? 3.5 : 2.5, 0, Math.PI*2);
        ctx.fillStyle = QCOL[mv.classification]; ctx.fill();
      }
    });

    if (!skipScrubberSetup) {
      window._historyEvalMoves = moves;
      _attachEvalChartScrubber('history-eval-chart', () => window._historyEvalMoves);
    }
  }

  function _drawHistoryReviewTable(review) {
    const el = document.getElementById('history-review-table');
    if (!el) return;
    const ORDER = ['Brilliant','Best','Excellent','Good','Inaccuracy','Mistake','Blunder'];
    const SYMS  = { Brilliant:'!!', Best:'✓', Excellent:'★', Good:'✦', Inaccuracy:'?!', Mistake:'?', Blunder:'??' };
    const QCOL  = { Brilliant:'#61bd4f', Best:'#61bd4f', Excellent:'#8fb86e', Good:'#c4a35a',
                    Inaccuracy:'#f0a500', Mistake:'#d46060', Blunder:'#d44' };

    const accColor = v => v >= 90 ? '#61bd4f' : v >= 75 ? '#c4a35a' : v >= 60 ? '#e0a84a' : '#d46060';

    const wAcc = review.white_acc, bAcc = review.black_acc;
    const wElo = review.white_elo, bElo = review.black_elo;

    let html = `<div style="display:grid;grid-template-columns:1fr 1fr;border:1px solid var(--border);border-radius:6px;overflow:hidden;font-size:11px">`;

    // Header row
    html += `<div style="padding:6px 10px;background:rgba(255,255,255,0.06);border-right:1px solid var(--border);font-weight:600;color:var(--text)">♙ ${review.white_name||'White'}</div>`;
    html += `<div style="padding:6px 10px;background:rgba(0,0,0,0.2);font-weight:600;color:var(--text)">♟ ${review.black_name||'Black'}</div>`;

    // Accuracy row
    html += `<div style="padding:6px 10px;border-right:1px solid var(--border);border-top:1px solid var(--border)">`;
    html += `<div style="font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:1px">Accuracy</div>`;
    html += `<span style="font-size:16px;font-weight:700;color:${accColor(wAcc)}">${wAcc !== null && wAcc !== undefined ? wAcc+'%' : '—'}</span></div>`;
    html += `<div style="padding:6px 10px;border-top:1px solid var(--border)">`;
    html += `<div style="font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:1px">Accuracy</div>`;
    html += `<span style="font-size:16px;font-weight:700;color:${accColor(bAcc)}">${bAcc !== null && bAcc !== undefined ? bAcc+'%' : '—'}</span></div>`;

    // Est. ELO row
    html += `<div style="padding:6px 10px;border-right:1px solid var(--border);border-top:1px solid var(--border)">`;
    html += `<div style="font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:1px">Est. ELO</div>`;
    html += `<span style="font-size:16px;font-weight:600;color:var(--accent)">${wElo ? wElo : '—'}</span></div>`;
    html += `<div style="padding:6px 10px;border-top:1px solid var(--border)">`;
    html += `<div style="font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:1px">Est. ELO</div>`;
    html += `<span style="font-size:16px;font-weight:600;color:var(--accent)">${bElo ? bElo : '—'}</span></div>`;

    // Per-classification rows
    ORDER.forEach(k => {
      const wC = (review.white_counts && review.white_counts[k]) || 0;
      const bC = (review.black_counts && review.black_counts[k]) || 0;
      if (wC === 0 && bC === 0) return;
      const col = QCOL[k] || 'var(--text3)';
      const sym = SYMS[k] || '';
      html += `<div style="padding:5px 10px;border-top:1px solid var(--border);border-right:1px solid var(--border);display:flex;justify-content:space-between;align-items:center">`;
      html += `<span style="color:${col};font-size:10px">${k} ${sym}</span><span style="font-weight:700;color:${col}">${wC||'—'}</span></div>`;
      html += `<div style="padding:5px 10px;border-top:1px solid var(--border);display:flex;justify-content:space-between;align-items:center">`;
      html += `<span style="color:${col};font-size:10px">${k} ${sym}</span><span style="font-weight:700;color:${col}">${bC||'—'}</span></div>`;
    });
    html += `</div>`;
    el.innerHTML = html;
  }

  // Build a set of reviewed PGN fingerprints for quick lookup
  let _reviewedFingerprints = new Set();

  async function _refreshReviewedFingerprints() {
    try {
      const res = await fetch(`${FLASK_URL}/review/history`);
      const data = await res.json();
      _reviewedFingerprints = new Set((data.games || []).map(r => _pgnMoveBody(r.pgn)));
    } catch(e) { /* ignore */ }
  }

  function buildFullHistoryPGN(g) {
    const result = g.result || '*';
    let dateStr = '????.??.??', timeStr = '??:??:??';
    if (g.ended_at) {
      const d = new Date(g.ended_at * 1000);
      const pad = n => String(n).padStart(2, '0');
      dateStr = `${d.getFullYear()}.${pad(d.getMonth()+1)}.${pad(d.getDate())}`;
      timeStr = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    }
    let tcStr = '-';
    if (g.time_control && g.time_control.minutes) tcStr = String(g.time_control.minutes * 60);
    let termination = g.reason || '';
    if (g.winner === 'white') termination = (g.white_name || 'White') + ' won' + (g.reason ? ' — ' + g.reason : '');
    else if (g.winner === 'black') termination = (g.black_name || 'Black') + ' won' + (g.reason ? ' — ' + g.reason : '');
    else if (g.winner === 'draw') termination = 'Draw' + (g.reason ? ' — ' + g.reason : '');
    const headers = [
      `[Event "Chess Analyzer Game"]`,
      `[Site "Chess Analyzer"]`,
      `[Date "${dateStr}"]`,
      `[Round "-"]`,
      `[White "${g.white_name || 'White'}"]`,
      `[Black "${g.black_name || 'Black'}"]`,
      `[Result "${result}"]`,
    ];
    if (g.mode) headers.push(`[GameMode "${g.mode === 'botvsbot' ? 'Bot vs Bot' : (g.mode === 'friend' ? 'Play Friend' : 'Play vs Bot')}"]`);
    if (tcStr !== '-') headers.push(`[TimeControl "${tcStr}"]`);
    if (timeStr !== '??:??:??') headers.push(`[UTCTime "${timeStr}"]`);
    if (termination) headers.push(`[Termination "${termination}"]`);
    const moveLog = g.moves || [];
    const initMs = (g.time_control && g.time_control.minutes) ? g.time_control.minutes * 60000 : null;
    const clockByPly = {};
    if (initMs !== null) {
      let wMs = initMs, bMs = initMs;
      moveLog.forEach(m => {
        if (m.color === 'white') wMs = Math.max(0, wMs - (m.time_ms || 0));
        else bMs = Math.max(0, bMs - (m.time_ms || 0));
        clockByPly[m.ply] = m.color === 'white' ? wMs : bMs;
      });
    }
    function fmtClk(ms) {
      const s = Math.max(0, Math.floor(ms / 1000));
      return `${Math.floor(s/3600)}:${String(Math.floor((s%3600)/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
    }
    let movesText = '';
    try {
      const tmpGame = new Chess();
      const rawPgn = (g.pgn || '').replace(/\[[^\]]*\]\s*/g, '').replace(/\{[^}]*\}/g, '').trim();
      if (rawPgn && tmpGame.load_pgn(rawPgn)) {
        const hist = tmpGame.history({ verbose: true });
        const plyMs = {};
        moveLog.forEach(m => { if (m.ply) plyMs[m.ply - 1] = clockByPly[m.ply]; });
        const parts = [];
        hist.forEach((mv, i) => {
          if (i % 2 === 0) parts.push(`${Math.floor(i/2)+1}.`);
          const clkMs = plyMs[i];
          const clk = (clkMs !== undefined && initMs !== null) ? ` {[%clk ${fmtClk(clkMs)}]}` : '';
          parts.push(mv.san + clk);
        });
        movesText = parts.join(' ') + ' ' + result;
      }
    } catch(e) {}
    if (!movesText) movesText = ((g.pgn || '').replace(/\[[^\]]*\]\s*/g, '').trim()) || result;
    return headers.join('\n') + '\n\n' + movesText;
  }

  function copyHistoryPGN() {
    if (!_historyDetailGame) return;
    copyToClipboard(buildFullHistoryPGN(_historyDetailGame), 'copied-flash');
  }

  async function loadHistoryToAnalysis() {
    if (!_historyDetailGame || !_historyDetailGame.pgn) return;
    const tempGame = new Chess();
    if (!tempGame.load_pgn(_historyDetailGame.pgn)) {
      alert('Could not load this PGN into the analysis board.');
      return;
    }
    game.load_pgn(_historyDetailGame.pgn);
    const fenHeader = tempGame.header()['FEN'];
    startFen = fenHeader || 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    moveHistory = game.history({ verbose: true });
    currentMoveIdx = moveHistory.length - 1;
    _varIdCounter = 0;
    varTree = [_newVarNode(null, 0, moveHistory, 'Main Line')];
    activeVarId = varTree[0].id;
    board.position(game.fen());
    updateFENDisplay();

    // Try to load review data for this game (blue tick = reviewed)
    _analysisReviewMoves = null;
    try {
      const res = await fetch(`${FLASK_URL}/review/history`);
      const data = await res.json();
      const entries = data.games || [];
      const myBody = _pgnMoveBody(_historyDetailGame.pgn);
      const matches = entries.filter(r => _pgnMoveBody(r.pgn) === myBody);
      if (matches.length > 0) {
        const best = matches.reduce((b, r) =>
          ((r.white_acc||0)+(r.black_acc||0)) > ((b.white_acc||0)+(b.black_acc||0)) ? r : b);
        _analysisReviewMoves = best.moves || null;
      }
    } catch(e) { /* ignore — analysis works without review data */ }

    updatePGNMoves();
    updateTurnLabel();
    analyzePosition();

    // ── Fill analysis player rows ──
    const g = _historyDetailGame;
    const tl = _buildTimelineFromHistoryGame(g);
    analysisPlayerInfo = {
      topName:    '♟ ' + (g.black_name || 'Black'),
      bottomName: '♙ ' + (g.white_name || 'White'),
      hasClock:   !!tl,
      timeline:    tl ? tl.timeline     : [],
      startWhiteMs: tl ? tl.startWhiteMs : 0,
      startBlackMs: tl ? tl.startBlackMs : 0,
      _fromAnalysisLoad: true,
    };
    _restoreAnalysisPlayerRows();
    _saveAnalysisSnapshot();
    switchTab('pgn');
  }

  function loadHistoryToReview() {
    if (!_historyDetailGame || !_historyDetailGame.pgn) return;
    openInReview(_historyDetailGame.pgn, _historyDetailGame);
  }

  // Update captured pieces in analysis player rows
  function _updateAnalysisCaptured(chessInst) {
    const captured = getCapturedPieces(chessInst);
    // White captured pieces (white took black pieces → shown with loser = black at top when not flipped)
    // Convention: top row = black side, bottom row = white side (when not flipped)
    // When flipped: top = white side, bottom = black side
    const whiteCaptured = [], blackCaptured = [];
    ['Q','R','B','N','P'].forEach(t => {
      // white captured black's pieces
      for (let i = 0; i < (captured['b'+t]||0); i++) whiteCaptured.push(PIECE_SYMBOLS['b'+t]);
      // black captured white's pieces
      for (let i = 0; i < (captured['w'+t]||0); i++) blackCaptured.push(PIECE_SYMBOLS['w'+t]);
    });
    let wMat = 0, bMat = 0;
    ['Q','R','B','N','P'].forEach(t => {
      const v = PIECE_VALUES[t.toLowerCase()];
      wMat += (captured['b'+t]||0) * v;  // white advantage
      bMat += (captured['w'+t]||0) * v;  // black advantage
    });

    // When not flipped: black is top, white is bottom
    // When flipped:     white is top, black is bottom
    const topPieces  = boardFlipped ? whiteCaptured : blackCaptured;
    const botPieces  = boardFlipped ? blackCaptured : whiteCaptured;
    const topAdv     = boardFlipped ? (wMat > bMat ? `+${wMat-bMat}` : '') : (bMat > wMat ? `+${bMat-wMat}` : '');
    const botAdv     = boardFlipped ? (bMat > wMat ? `+${bMat-wMat}` : '') : (wMat > bMat ? `+${wMat-bMat}` : '');

    document.getElementById('analysis-cap-top-pieces').innerHTML =
      topPieces.map(s => `<span class="cap-piece">${s}</span>`).join('');
    document.getElementById('analysis-cap-bottom-pieces').innerHTML =
      botPieces.map(s => `<span class="cap-piece">${s}</span>`).join('');
    document.getElementById('analysis-cap-top-adv').textContent    = topAdv;
    document.getElementById('analysis-cap-bottom-adv').textContent = botAdv;
  }

  // Build a per-ply remaining-time timeline from a saved history game's
  // moveLog ('moves'), so that stepping through moves with prev/next shows
  // the correct remaining clock at that point instead of just the final time.
  function _buildTimelineFromHistoryGame(g) {
    if (!g || !g.time_control || !g.time_control.minutes) return null;
    const startMs = g.time_control.minutes * 60000;
    let whiteMs = startMs, blackMs = startMs;
    const timeline = [];
    (g.moves || []).forEach(m => {
      const took = m.time_ms || 0;
      if (m.color === 'white') whiteMs = Math.max(0, whiteMs - took);
      else                     blackMs = Math.max(0, blackMs - took);
      timeline.push({ whiteMs, blackMs });
    });
    return { startWhiteMs: startMs, startBlackMs: startMs, timeline };
  }

  

  // Apply the remaining-time clock display for the given ply index
  // (-1 = starting position, before any move) using analysisPlayerInfo.
  function _applyAnalysisClockForIdx(idx) {
    const info = analysisPlayerInfo;
    const tTop = document.getElementById('analysis-time-top');
    const tBot = document.getElementById('analysis-time-bottom');
    if (!info || !info.hasClock) {
      tTop.style.display = 'none';
      tBot.style.display = 'none';
      return;
    }
    let whiteMs, blackMs;
    if (idx < 0 || !info.timeline || info.timeline.length === 0) {
      whiteMs = info.startWhiteMs; blackMs = info.startBlackMs;
    } else {
      const entry = info.timeline[Math.min(idx, info.timeline.length - 1)];
      whiteMs = entry.whiteMs; blackMs = entry.blackMs;
    }
    // When not flipped: top = black clock, bottom = white clock
    // When flipped:     top = white clock, bottom = black clock
    tTop.textContent = formatClock(boardFlipped ? whiteMs : blackMs); tTop.style.display = '';
    tBot.textContent = formatClock(boardFlipped ? blackMs : whiteMs); tBot.style.display = '';
  }

  // Re-show the analysis player rows (names/clock/captured) — used when
  // returning to a non-Play tab after a game was loaded into analysis.
  function _restoreAnalysisPlayerRows() {
    if (!analysisPlayerInfo) return;
    // When not flipped: top = black (topName), bottom = white (bottomName)
    // When flipped:     top = white (bottomName), bottom = black (topName)
    document.getElementById('analysis-label-top').textContent    = boardFlipped ? analysisPlayerInfo.bottomName : analysisPlayerInfo.topName;
    document.getElementById('analysis-label-bottom').textContent = boardFlipped ? analysisPlayerInfo.topName   : analysisPlayerInfo.bottomName;
    _applyAnalysisClockForIdx(currentMoveIdx);
    _updateAnalysisCaptured(game);
    document.getElementById('analysis-top-row').classList.add('show');
    document.getElementById('analysis-bottom-row').classList.add('show');
  }

 

  async function deleteHistoryGame() {
    if (!_historyDetailGame) return;
    if (!confirm('Delete this game from history?')) return;
    try {
      await fetch(`${FLASK_URL}/play/history/${_historyDetailGame.id}`, { method: 'DELETE' });
    } catch(e) { /* ignore */ }
    closeHistoryDetail();
    renderHistoryList();
  }

  async function clearAllHistory() {
    if (!confirm('Clear ALL game history? This cannot be undone.')) return;
    try {
      await fetch(`${FLASK_URL}/play/history`, { method: 'DELETE' });
    } catch(e) { /* ignore */ }
    closeHistoryDetail();
    renderHistoryList();
  }

  function toggleHistorySelectMode() {
    _historySelectMode = true;
    _historySelected.clear();
    document.getElementById('history-header-btns').style.display = 'none';
    const sa = document.getElementById('history-select-actions');
    sa.style.display = 'flex';
    _updateHistorySelectCount();
    renderHistoryList();
  }

  function cancelHistorySelect() {
    _historySelectMode = false;
    _historySelected.clear();
    document.getElementById('history-header-btns').style.display = 'flex';
    document.getElementById('history-select-actions').style.display = 'none';
    renderHistoryList();
  }

  function _updateHistorySelectCount() {
    document.getElementById('history-select-count').textContent = _historySelected.size + ' selected';
  }

  async function deleteSelectedHistory() {
    if (_historySelected.size === 0) { alert('Koi game select nahi kiya!'); return; }
    if (!confirm(`${_historySelected.size} game(s) delete karna chahte ho?`)) return;
    for (const id of _historySelected) {
      try { await fetch(`${FLASK_URL}/play/history/${id}`, { method: 'DELETE' }); } catch(e) { /* ignore */ }
    }
    cancelHistorySelect();
    renderHistoryList();
  }

  // ═══════════════════════════════════════════════════════════════
  //  IMPORTED GAMES — PGN import, list, detail, delete
  // ═══════════════════════════════════════════════════════════════

  let _importedGames = [];
  let _importedDetailGame = null;
  let _importedSelectMode = false;
  let _importedSelected = new Set();

