// ============================================================
// review.js — Review tab: PGN analysis, move-by-move nav,
//              eval chart, summary, review history panel
// ============================================================


  const rvState = {
    pgn: '',
    moves: [],       // array of move objects from backend
    summary: null,
    currentIdx: -1,
    phase: 'setup',  // 'setup' | 'progress' | 'summary' | 'movebymove'
    whiteName: 'White',
    blackName: 'Black',
    clockTimeline: null, // { startWhiteMs, startBlackMs, timeline: [{whiteMs,blackMs}, ...] } or null
    historyGame: null,   // optional richer game-history object (from Play tab)
  };

  function rvShowPhase(phase) {
    rvState.phase = phase;
    document.getElementById('review-setup-phase').style.display      = (phase === 'setup') ? '' : 'none';
    document.getElementById('review-progress-phase').style.display   = (phase === 'progress') ? '' : 'none';
    document.getElementById('review-summary-phase').style.display    = (phase === 'summary') ? '' : 'none';
    const mbp = document.getElementById('review-movebymove-phase');
    if (phase === 'movebymove') {
      mbp.style.display = 'flex';
    } else {
      mbp.style.display = 'none';
    }
  }

  function reviewLoadPGN() {
    const pgn = document.getElementById('review-pgn-input').value.trim();
    if (!pgn) { alert('Pehle PGN paste karo'); return; }
    rvState.pgn = pgn;

    // Try to extract headers for game info
    const whiteMatch = pgn.match(/\[White "([^"]*)"\]/);
    const blackMatch = pgn.match(/\[Black "([^"]*)"\]/);
    const eventMatch = pgn.match(/\[Event "([^"]*)"\]/);
    const dateMatch  = pgn.match(/\[Date "([^"]*)"\]/);

    // Filter out "?" placeholder names that chess.com / lichess export
    const rawWhite = whiteMatch ? whiteMatch[1] : '';
    const rawBlack = blackMatch ? blackMatch[1] : '';
    const isGenericName = n => !n || n === '?' || !n.trim();
    const whiteName = isGenericName(rawWhite) ? 'White' : rawWhite.trim();
    const blackName = isGenericName(rawBlack) ? 'Black' : rawBlack.trim();
    rvState.whiteName = whiteName;
    rvState.blackName = blackName;

    // Count moves roughly
    const moveLine = pgn.replace(/\[.*?\]\s*/g, '').trim();
    const moveCount = (moveLine.match(/\d+\./g) || []).length;

    let info = `♙ ${whiteName} vs ♟ ${blackName}`;
    if (eventMatch) info += `\n📍 ${eventMatch[1]}`;
    if (dateMatch)  info += `  📅 ${dateMatch[1]}`;
    info += `\n♟ ~${moveCount} moves`;

    document.getElementById('review-game-info').textContent = info;
    document.getElementById('review-depth-section').style.display = '';
    document.getElementById('review-depth-section').scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    // Board stays hidden until the game has actually been analysed.
    document.body.classList.add('review-board-hidden');
  }


  async function reviewPasteClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      document.getElementById('review-pgn-input').value = text;
      reviewLoadPGN();
    } catch(e) {
      alert('Clipboard access nahi mili. Manually paste karo.');
    }
  }

  // Called from Play tab "Open in Review". historyGame (optional) is the
  // richer game-history object (white_name/black_name/time_control/moves)
  // saved by the Play tab — used as a fallback when the PGN text itself
  // doesn't carry proper header tags or [%clk] comments.
  function openInReview(pgn, historyGame) {
    // Pehle purana review state reset karo — agar koi purana game
    // analysis/summary loaded hai toh wo naye game ki galat info overwrite na kare
    rvState.moves = [];
    rvState.summary = null;
    rvState.currentIdx = -1;
    const cr = document.getElementById('rv-classification-row');
    if (cr) cr.style.display = 'none';
    rvShowPhase('setup');

    switchTab('review');

    // If historyGame has explicit names, inject them as PGN headers so
    // reviewLoadPGN reliably picks them up (Play vs Bot PGNs often lack
    // [White]/[Black] header tags, causing names to show as "White"/"Black").
    let pgnToLoad = pgn;
    if (historyGame && (historyGame.white_name || historyGame.black_name)) {
      const wn = historyGame.white_name || 'White';
      const bn = historyGame.black_name || 'Black';
      // Strip any existing White/Black headers, then prepend correct ones
      const stripped = pgnToLoad
        .replace(/\[White "[^"]*"\]\s*/g, '')
        .replace(/\[Black "[^"]*"\]\s*/g, '');
      pgnToLoad = `[White "${wn}"]\n[Black "${bn}"]\n` + stripped;
    }

    document.getElementById('review-pgn-input').value = pgnToLoad;
    reviewLoadPGN();
    if (historyGame) {
      if (historyGame.white_name) rvState.whiteName = historyGame.white_name;
      if (historyGame.black_name) rvState.blackName = historyGame.black_name;
      rvState.historyGame = historyGame;
    } else {
      rvState.historyGame = null;
    }
  }

  // Parse [%clk h:mm:ss] comments embedded in a PGN (chess.com / lichess
  // style exports) into a per-ply remaining-time timeline. Returns null
  // if the PGN has no embedded clock data at all.
 function _parseClkFromPGN(pgn) {
    if (!pgn || pgn.indexOf('%clk') === -1) return null;
    // moveText wali line hata di gayi hai
    const re = /\[%clk\s+(\d+):(\d+):(\d+(?:\.\d+)?)\]/g;
    const timeline = [];
    let m;
    while ((m = re.exec(pgn)) !== null) {  // ← ab seedha pgn string pe search ho raha hai
        const ms = (parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseFloat(m[3])) * 1000;
        timeline.push(ms);
    }
    if (timeline.length === 0) return null;
    return timeline;
}

  // Build { whiteMs, blackMs } per ply index from the raw %clk timeline,
  // matching the shape _applyAnalysisClockForIdx expects.
  function _buildReviewClockTimeline(pgn) {
    const raw = _parseClkFromPGN(pgn);
    if (!raw) return null;
    const timeline = [];
    let lastWhiteMs = raw[0] !== undefined ? raw[0] : 0;
    let lastBlackMs = raw[1] !== undefined ? raw[1] : 0;
    for (let i = 0; i < raw.length; i++) {
      if (i % 2 === 0) lastWhiteMs = raw[i]; else lastBlackMs = raw[i];
      timeline.push({ whiteMs: lastWhiteMs, blackMs: lastBlackMs });
    }
    return {
      startWhiteMs: raw[0] !== undefined ? raw[0] : 0,
      startBlackMs: raw[1] !== undefined ? raw[1] : 0,
      timeline,
    };
  }

  async function startReviewAnalysis() {
    if (!rvState.pgn) { alert('Pehle PGN load karo'); return; }
    const depth = parseInt(document.getElementById('review-depth-slider').value);
    const thinkTime = parseInt(document.getElementById('review-time-slider').value) / 2; // 0.5–10.0

    rvShowPhase('progress');
    document.getElementById('review-progress-bar').style.width = '0%';
    document.getElementById('review-progress-text').textContent = 'Analysis shuru ho rahi hai...';

    try {
      // SSE streaming: backend sends progress after each move
      const res = await fetch(`${FLASK_URL}/review/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pgn: rvState.pgn,
          depth,
          think_time: thinkTime,
          white_name: rvState.whiteName,
          black_name: rvState.blackName,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Analysis failed');
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop(); // keep incomplete last line

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          let evt;
          try { evt = JSON.parse(line.slice(6)); } catch(e) { continue; }

          if (evt.type === 'progress') {
            const pct = Math.round((evt.done / evt.total) * 100);
            document.getElementById('review-progress-bar').style.width = pct + '%';
            document.getElementById('review-progress-text').textContent =
              `Move ${evt.done} / ${evt.total} analyse ho gaya`;

          } else if (evt.type === 'done') {
            document.getElementById('review-progress-bar').style.width = '100%';
            rvState.moves   = evt.moves;
            rvState.summary = evt.summary;
            rvState.clockTimeline = rvState.historyGame
              ? _buildTimelineFromHistoryGame(rvState.historyGame)
              : _buildReviewClockTimeline(rvState.pgn);
            rvShowSummary();
          }
        }
      }

    } catch(e) {
      rvShowPhase('setup');
      alert('Analysis error: ' + e.message);
    }
  }

  function rvShowSummary() {
    rvShowPhase('summary');
    const s = rvState.summary;

    // Name resolution
    const isGeneric = n => !n || n === '?' || n === 'White' || n === 'Black' || !n.trim();
    if (s.white && s.white.name && !isGeneric(s.white.name)) rvState.whiteName = s.white.name.trim();
    if (s.black && s.black.name && !isGeneric(s.black.name)) rvState.blackName = s.black.name.trim();
    if (isGeneric(rvState.whiteName)) rvState.whiteName = 'White';
    if (isGeneric(rvState.blackName)) rvState.blackName = 'Black';

    document.getElementById('rv-white-name').textContent = rvState.whiteName;
    document.getElementById('rv-black-name').textContent = rvState.blackName;
    document.getElementById('rv-white-acc').textContent  = s.white.accuracy + '%';
    document.getElementById('rv-black-acc').textContent  = s.black.accuracy + '%';
    document.getElementById('rv-white-elo').textContent  = s.white.elo;
    document.getElementById('rv-black-elo').textContent  = s.black.elo;

    // Color accuracy by value
    const accColor = v => v >= 90 ? 'var(--accent2)' : v >= 75 ? 'var(--accent)' : v >= 60 ? '#e0a84a' : 'var(--danger)';
    document.getElementById('rv-white-acc').style.color = accColor(parseFloat(s.white.accuracy));
    document.getElementById('rv-black-acc').style.color = accColor(parseFloat(s.black.accuracy));

    // Per-classification rows
    const ORDER = ['Best','Excellent','Good','Inaccuracy','Mistake','Blunder'];
    const SYMS  = { Brilliant:'!!', Best:'✓', Excellent:'★', Good:'✦', Inaccuracy:'?!', Mistake:'?', Blunder:'??' };
    const rowsEl = document.getElementById('rv-classification-rows');
    rowsEl.innerHTML = '';
    ORDER.forEach((k, i) => {
      const wCount = (s.white.counts && s.white.counts[k]) || 0;
      const bCount = (s.black.counts && s.black.counts[k]) || 0;
      if (wCount === 0 && bCount === 0) return;
      const color = QUALITY_COLORS[k] || 'var(--text3)';
      const sym   = SYMS[k] || '';
      const isLast = i === ORDER.length - 1;
      const row = document.createElement('div');
      row.style.cssText = `display:grid;grid-template-columns:1fr 1fr;${!isLast ? 'border-bottom:1px solid var(--border)' : ''}`;
      row.innerHTML = `
        <div style="padding:6px 12px;border-right:1px solid var(--border);display:flex;align-items:center;justify-content:space-between">
          <span style="font-size:10px;color:${color}">${k} ${sym}</span>
          <span style="font-size:14px;font-weight:600;color:${color}">${wCount || '—'}</span>
        </div>
        <div style="padding:6px 12px;display:flex;align-items:center;justify-content:space-between">
          <span style="font-size:10px;color:${color}">${k} ${sym}</span>
          <span style="font-size:14px;font-weight:600;color:${color}">${bCount || '—'}</span>
        </div>`;
      rowsEl.appendChild(row);
    });

    // Eval chart
    _drawEvalChart();

    // Auto-save this completed review to History (skip exact duplicates,
    // e.g. re-opening the same game from Play tab and re-analysing).
    saveReviewToHistory().then(() => {
      // Refresh fingerprints so blue ticks appear immediately in Play history
      _refreshReviewedFingerprints();
    });
  }

  function _drawEvalChart(skipScrubberSetup) {
    const canvas = document.getElementById('rv-eval-chart');
    if (!canvas || !rvState.moves || rvState.moves.length === 0) return;

    // Set canvas pixel size
    const W = canvas.parentElement.clientWidth - 24;
    const H = 100;
    canvas.width  = W || 300;
    canvas.height = H;

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, W, H);

    const moves = rvState.moves;
    const evals = moves.map(m => Math.max(-600, Math.min(600, m.eval_after !== undefined ? m.eval_after : 0)));

    // Background: top half = white side, bottom = black side
    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    ctx.fillRect(0, 0, W, H / 2);
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.fillRect(0, H / 2, W, H / 2);

    // Zero line
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, H / 2);
    ctx.lineTo(W, H / 2);
    ctx.stroke();

    // Eval fill area
    const n = evals.length;
    const xStep = W / Math.max(n - 1, 1);
    const toY = v => H / 2 - (v / 600) * (H / 2 - 4);

    // Fill white advantage (above 0 line)
    ctx.beginPath();
    ctx.moveTo(0, H / 2);
    evals.forEach((v, i) => ctx.lineTo(i * xStep, toY(v)));
    ctx.lineTo((n - 1) * xStep, H / 2);
    ctx.closePath();
    ctx.fillStyle = 'rgba(232,228,216,0.25)';
    ctx.fill();

    // Fill black advantage (below 0 line)
    ctx.beginPath();
    ctx.moveTo(0, H / 2);
    evals.forEach((v, i) => ctx.lineTo(i * xStep, toY(v)));
    ctx.lineTo((n - 1) * xStep, H / 2);
    ctx.closePath();
    ctx.fillStyle = 'rgba(26,26,28,0.5)';
    ctx.fill();

    // Line
    ctx.beginPath();
    evals.forEach((v, i) => {
      const x = i * xStep, y = toY(v);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.strokeStyle = 'rgba(196,163,90,0.85)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Dots for blunders/mistakes
    moves.forEach((mv, i) => {
      const c = mv.classification;
      if (c === 'Blunder' || c === 'Mistake' || c === 'Inaccuracy') {
        const x = i * xStep;
        const y = toY(evals[i]);
        ctx.beginPath();
        ctx.arc(x, y, c === 'Blunder' ? 3.5 : 2.5, 0, Math.PI * 2);
        ctx.fillStyle = QUALITY_COLORS[c] || '#d46060';
        ctx.fill();
      }
    });

    if (!skipScrubberSetup) {
      _attachEvalChartScrubber('rv-eval-chart', () => rvState.moves || []);
    }
  }

  function startMoveByMove() {
    if (!rvState.moves || rvState.moves.length === 0) return;
    rvState.currentIdx = 0;
    rvShowPhase('movebymove');
    rvBuildMoveList();
    rvSetupPlayerRows();
    // Reveal chessboard only now — once the game has actually been
    // analysed and the user is starting the move-by-move walkthrough.
    document.body.classList.remove('review-board-hidden');
    document.body.classList.remove('play-board-hidden');
    // Snap to the starting position first (no animation), then let the
    // first move glide in like the analysis tab does.
    const fenMatch = (rvState.pgn || '').match(/\[FEN "([^"]+)"\]/);
    const startPos = fenMatch ? fenMatch[1] : 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    try { board.position(startPos, false); } catch(e) {}
    hideBoardBadge();
    resetEval();
    _applyReviewClockForIdx(-1);
    rvShowCurrentMove(true);
    // Detect opening from PGN
    rvDetectOpening();
  }

  // ── Opening Detection ──────────────────────────────────────────
  async function rvDetectOpening() {
    if (!rvState.pgn) return;
    const box = document.getElementById('rv-opening-box');
    const nameEl = document.getElementById('rv-opening-name');
    const infoEl = document.getElementById('rv-opening-info');
    if (!box || !nameEl || !infoEl) return;

    // Show loading state
    box.style.display = '';
    nameEl.textContent = 'Detecting opening...';
    nameEl.style.color = 'var(--text3)';
    infoEl.textContent = '';

    try {
      const res = await fetch(`${FLASK_URL}/review/opening`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pgn: rvState.pgn }),
      });
      const data = await res.json();

      if (data.ok && data.opening) {
        const op = data.opening;
        nameEl.textContent = op.eco ? `${op.name} (${op.eco})` : op.name;
        nameEl.style.color = 'var(--accent)';
        const halfMoves = op.moves_played || 0;
        const fullMoves = Math.ceil(halfMoves / 2);
        const totalMoves = op.total_moves || 0;
        let info = `${halfMoves} half-moves in book`;
        if (op.move_text) info += ` \u2022 ${op.move_text}`;
        infoEl.textContent = info;
        box.style.display = '';
      } else {
        // No opening found
        box.style.display = '';
        nameEl.textContent = 'Opening not recognized';
        nameEl.style.color = 'var(--text3)';
        infoEl.textContent = 'Custom or unbooked opening sequence';
      }
    } catch(e) {
      console.error('[rvDetectOpening] fetch error:', e);
      // Show error state instead of hiding the box
      box.style.display = '';
      nameEl.textContent = 'Opening not recognized';
      nameEl.style.color = 'var(--text3)';
      infoEl.textContent = 'Could not detect opening';
    }
  }

  // Fill the player-row name/clock/captured-piece UI (reusing the same
  // rows the Analysis tab uses) from the loaded review game.
  function rvSetupPlayerRows() {
    // When not flipped: top = black, bottom = white
    // When flipped:     top = white, bottom = black
    document.getElementById('analysis-label-top').textContent    = boardFlipped
      ? '♙ ' + (rvState.whiteName || 'White')
      : '♟ ' + (rvState.blackName || 'Black');
    document.getElementById('analysis-label-bottom').textContent = boardFlipped
      ? '♟ ' + (rvState.blackName || 'Black')
      : '♙ ' + (rvState.whiteName || 'White');
    document.getElementById('analysis-top-row').classList.add('show');
    document.getElementById('analysis-bottom-row').classList.add('show');
  }

  // Apply remaining-clock display for a given review move index (-1 = start)
  function _applyReviewClockForIdx(idx) {
    const tTop = document.getElementById('analysis-time-top');
    const tBot = document.getElementById('analysis-time-bottom');
    const ct = rvState.clockTimeline;
    if (!ct) {
      tTop.style.display = 'none';
      tBot.style.display = 'none';
      return;
    }
    let whiteMs, blackMs;
    if (idx < 0 || !ct.timeline || ct.timeline.length === 0) {
      whiteMs = ct.startWhiteMs; blackMs = ct.startBlackMs;
    } else {
      const entry = ct.timeline[Math.min(idx, ct.timeline.length - 1)];
      whiteMs = entry.whiteMs; blackMs = entry.blackMs;
    }
    // When not flipped: top = black clock, bottom = white clock
    // When flipped:     top = white clock, bottom = black clock
    tTop.textContent = formatClock(boardFlipped ? whiteMs : blackMs); tTop.style.display = '';
    tBot.textContent = formatClock(boardFlipped ? blackMs : whiteMs); tBot.style.display = '';
  }

  // Update captured pieces in the player rows for the position after
  // review move idx (using the move's fen_after).
  function _applyReviewCapturedForIdx(idx) {
    const mv = rvState.moves[idx];
    if (!mv || !mv.fen_after) return;
    try {
      const tmp = new Chess();
      tmp.load(mv.fen_after);
      _updateAnalysisCaptured(tmp);
    } catch(e) {}
  }

  function rvBuildMoveList() {
    const container = document.getElementById('rv-move-list');
    container.innerHTML = '';
    rvState.moves.forEach((mv, i) => {
      const color = QUALITY_COLORS[mv.classification] || '#5a5650';
      const sym   = QUALITY_SYMBOLS[mv.classification] || '';
      const label = mv.is_white
        ? `${mv.move_num}. ${mv.played_san}`
        : `${mv.move_num}... ${mv.played_san}`;

      const el = document.createElement('span');
      el.style.cssText = `font-size:11px;padding:2px 6px;border-radius:4px;cursor:pointer;border:1px solid transparent;color:${color};background:var(--bg2);white-space:nowrap;flex-shrink:0`;
      el.textContent = label + (sym ? ' ' + sym : '');
      el.id = 'rv-token-' + i;
      el.onclick = () => { rvState.currentIdx = i; rvShowCurrentMove(); };
      container.appendChild(el);
    });
  }

  // Build a human-readable reason for bad moves using cp values.
  // Format: "lose bishop in 3, queen in 5" style — based on centipawn drop.
  function _buildMoveReason(mv) {
    const cpDrop = (mv.cp_best !== undefined && mv.cp_played !== undefined)
      ? Math.abs(mv.cp_best - mv.cp_played)
      : null;
    if (cpDrop === null) {
      return mv.best_san ? `Better: ${mv.best_san}` : 'Suboptimal move';
    }

    // Approximate piece losses from cp drop
    const PIECE_CP = [ [900,'queen'], [500,'rook'], [330,'bishop'], [320,'knight'], [100,'pawn'] ];
    const parts = [];
    let remaining = cpDrop;
    for (const [val, name] of PIECE_CP) {
      if (remaining >= val * 0.75) {
        const count = Math.floor(remaining / val);
        if (count > 0) {
          parts.push(`lose ${count > 1 ? count + ' ' : ''}${name}${count > 1 ? 's' : ''}`);
          remaining -= count * val;
        }
      }
      if (remaining < 75) break;
    }

    let reason = parts.length ? parts.join(', ') : `eval drops by ${(cpDrop/100).toFixed(1)}`;
    if (mv.best_san && mv.best_san !== mv.played_san) {
      reason += ` — better: ${mv.best_san}`;
    }
    return reason;
  }

  function rvShowCurrentMove(skipAnimation) {
    const idx = rvState.currentIdx;
    const mv  = rvState.moves[idx];
    if (!mv) return;

    // Board — animate the glide (like Analysis tab) unless explicitly
    // told to snap (e.g. first entry, where we already snapped to the
    // pre-move position in startMoveByMove).
    try {
      board.position(mv.fen_after, !skipAnimation);
    } catch(e) {}

    // Board badge — show on destination square (chess.com style)
    setTimeout(() => {
      if (mv.played_uci && mv.played_uci.length >= 4) {
        const toSq = mv.played_uci.slice(2, 4);
        showBoardBadge(toSq, mv.classification, {
          best_san: mv.best_san, played_san: mv.played_san,
          dif: (mv.cp_best != null && mv.cp_played != null) ? Math.abs(mv.cp_best - mv.cp_played) : 0
        });
      }
    }, 120);

    // ── Row 6: Classification badge (board-area) ──
    const badge = document.getElementById('rv-classification-badge');
    const classRow = document.getElementById('rv-classification-row');
    const c = mv.classification || 'Unknown';
    const sym = QUALITY_SYMBOLS[c] || '';
    badge.textContent = c + (sym ? '  ' + sym : '');
    badge.style.background = (QUALITY_COLORS[c] || '#333') + '22';
    badge.style.color = QUALITY_COLORS[c] || '#aaa';
    badge.style.border = `1px solid ${(QUALITY_COLORS[c] || '#333')}55`;
    if (classRow) classRow.style.display = '';

    // Eval bar — update from pre-computed eval_after (white perspective cp)
    if (mv.eval_after !== undefined && mv.eval_after !== null) {
      updateEvalBar(mv.eval_after, null);
    } else {
      resetEval();
    }

    // Player rows: clock + captured pieces for this position
    _applyReviewClockForIdx(idx);
    _applyReviewCapturedForIdx(idx);

    // Highlight in move list (horizontal scroll tokens)
    document.querySelectorAll('#rv-move-list span').forEach((el, i) => {
      el.style.border = i === idx
        ? `1px solid ${QUALITY_COLORS[mv.classification] || 'var(--accent)'}88`
        : '1px solid transparent';
      el.style.background = i === idx ? 'var(--bg3)' : 'var(--bg2)';
    });

    // Scroll active token into view (horizontal)
    const token = document.getElementById('rv-token-' + idx);
    if (token) token.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });

    // Arrows: clear first, then draw after the move glide has had a
    // moment to start
    clearArrows();
    const lastFrom = mv.played_uci ? mv.played_uci.slice(0,2) : null;
    const lastTo   = mv.played_uci ? mv.played_uci.slice(2,4) : null;
    const showBestArrow = mv.best_uci && mv.best_uci !== mv.played_uci;
    setTimeout(() => {
      if (lastFrom && lastTo) drawArrow(lastFrom, lastTo, 'last');
      if (showBestArrow) {
        const from = mv.best_uci.slice(0,2);
        const to   = mv.best_uci.slice(2,4);
        drawArrow(from, to, 'best');
      }
    }, 90);
  }

  function rvNext() {
    if (rvState.currentIdx < rvState.moves.length - 1) {
      rvState.currentIdx++;
      rvShowCurrentMove();
    }
  }
  function rvPrev() {
    if (rvState.currentIdx > 0) {
      rvState.currentIdx--;
      rvShowCurrentMove();
    }
  }
  function rvGoFirst() {
    rvState.currentIdx = 0;
    rvShowCurrentMove();
  }
  function rvGoLast() {
    rvState.currentIdx = rvState.moves.length - 1;
    rvShowCurrentMove();
  }

  function rvBackToSummary() {
    clearArrows();
    document.body.classList.add('review-board-hidden');
    document.getElementById('analysis-top-row').classList.remove('show');
    document.getElementById('analysis-bottom-row').classList.remove('show');
    const cr = document.getElementById('rv-classification-row');
    if (cr) cr.style.display = 'none';
    // Hide opening box when going back to summary
    const ob = document.getElementById('rv-opening-box');
    if (ob) ob.style.display = 'none';
    hideBoardBadge();
    rvShowSummary();
  }

  function rvOpenInAnalysis() {
    if (!rvState.pgn) return;
    // Clear snapshot so switchTab does not restore old Analysis position
    // over the fresh PGN we are about to load.
    _analysisBoardSnapshot = null;
    _currentTab = 'analysis';
    document.getElementById('pgn-input').value = rvState.pgn;
    loadPGN();
    switchTab('analysis');
  }

  function rvOpenInAnalysisPgnOnly() {
    if (!rvState.pgn) return;
    // Ab PGN ko as-is pass karo — headers aur %clk comments sab rahenge
    _analysisBoardSnapshot = null;
    _currentTab = 'analysis';
    document.getElementById('pgn-input').value = rvState.pgn;
    loadPGN();
    switchTab('analysis');
}

  // Copy only the move-text PGN (no headers, no comments)
  function rvCopyCurrentPGN() {
    if (!rvState.pgn) return;

    // chess.js se clean moves rebuild karo — raw PGN mein { %clk ... } ya
    // { } empty comments hote hain jo strip karne ke baad garbled output dete hain.
    let pgnClean = '';
    try {
      const tempGame = new Chess();
      if (tempGame.load_pgn(rvState.pgn)) {
        // chess.js ka .pgn() clean output deta hai — phir headers + comments strip karo
        pgnClean = tempGame.pgn()
          .replace(/\[[^\]]*\]\s*/g, '')
          .replace(/\{[^}]*\}/g, '')
          .replace(/\s+/g, ' ')
          .trim();
      }
    } catch(e) { /* fallback below */ }

    // Fallback: raw PGN se headers + curly comments strip karo
    if (!pgnClean) {
      pgnClean = rvState.pgn
        .replace(/\[[^\]]*\]\s*/g, '')
        .replace(/\{[^}]*\}/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    }

    copyToClipboard(pgnClean, null);
    const flash = document.getElementById('rv-copy-flash');
    if (flash) {
      flash.style.display = 'block';
      setTimeout(() => { flash.style.display = 'none'; }, 1500);
    }
  }

  // ════════════════════════════════════════════════════════════════
  // REVIEW HISTORY — auto-saved past "Start Review" results, stored
  // on the Flask backend (FLASK_URL /review/history routes), same as
  // Play tab's history. Mirrors the Play > History UX:
  // list of cards (names / accuracy / Est ELO / View in detail),
  // a detail view with full classification breakdown + Start Review,
  // and multi-select delete.
  // ════════════════════════════════════════════════════════════════

  let _rvhEntries = [];
  let _rvhDetail  = null;
  let _rvhSelectMode = false;
  let _rvhSelected = new Set();

  // Loads all saved reviews from the Flask backend
  async function _rvhLoadAll() {
    try {
      const res = await fetch(`${FLASK_URL}/review/history`);
      const data = await res.json();
      _rvhEntries = data.games || [];
    } catch(e) {
      _rvhEntries = [];
    }
    return _rvhEntries;
  }

  // Called automatically right after a review's analysis finishes.
  async function saveReviewToHistory() {
    if (!rvState.summary || !rvState.moves || rvState.moves.length === 0) return;

    const s = rvState.summary;

    const entry = {
      saved_at:   Math.floor(Date.now() / 1000),
      white_name: rvState.whiteName || 'White',
      black_name: rvState.blackName || 'Black',
      white_acc:  s.white ? s.white.accuracy : null,
      black_acc:  s.black ? s.black.accuracy : null,
      white_elo:  s.white ? s.white.elo : null,
      black_elo:  s.black ? s.black.elo : null,
      white_counts: s.white ? s.white.counts : {},
      black_counts: s.black ? s.black.counts : {},
      move_count: rvState.moves.length,
      pgn:        rvState.pgn,
      moves:      rvState.moves,
      summary:    rvState.summary,
      clockTimeline: rvState.clockTimeline || null,
    };

    try {
      await fetch(`${FLASK_URL}/review/history`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry)
      });
    } catch(e) { /* backend unreachable — review just won't be saved this time */ }
  }

  function toggleReviewHistoryPanel() {
    const sec = document.getElementById('review-history-section');
    const opening = sec.style.display === 'none';
    sec.style.display = opening ? '' : 'none';
    if (!opening) {
      closeReviewHistoryDetail();
      cancelReviewHistorySelect();
    } else {
      closeReviewHistoryDetail();
      renderReviewHistoryList();
      sec.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  async function renderReviewHistoryList() {
    const body = document.getElementById('rvh-list-body');
    body.innerHTML = '<div style="font-size:11px;color:var(--text3);text-align:center;padding:10px 0">Loading...</div>';

    let entries;
    try {
      entries = await _rvhLoadAll();
    } catch(e) {
      body.innerHTML = '<div style="font-size:11px;color:var(--danger);text-align:center;padding:10px 0">Failed to load review history</div>';
      return;
    }

    if (entries.length === 0) {
      body.innerHTML = '<div style="font-size:11px;color:var(--text3);text-align:center;padding:10px 0">Abhi tak koi review save nahi hua</div>';
      return;
    }

    body.innerHTML = '';
    entries.forEach(g => {
      const item = document.createElement('div');
      item.className = 'history-item';

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.style.cssText = 'display:none;width:16px;height:16px;flex-shrink:0;accent-color:var(--danger);cursor:pointer;';
      cb.id = 'rvh-cb-' + g.id;
      cb.checked = _rvhSelected.has(g.id);
      cb.onchange = () => {
        if (cb.checked) _rvhSelected.add(g.id);
        else _rvhSelected.delete(g.id);
        _updateRvhSelectCount();
      };
      item.appendChild(cb);

      if (_rvhSelectMode) {
        cb.style.display = '';
        item.onclick = (e) => {
          if (e.target === cb) return;
          cb.checked = !cb.checked;
          if (cb.checked) _rvhSelected.add(g.id);
          else _rvhSelected.delete(g.id);
          _updateRvhSelectCount();
        };
      } else {
        item.onclick = () => openReviewHistoryDetail(g.id);
      }

      const left = document.createElement('div');
      left.className = 'history-item-left';

      const titleEl = document.createElement('div');
      titleEl.className = 'history-item-title';
      titleEl.textContent = `${g.white_name || 'White'} vs ${g.black_name || 'Black'}`;

      const subEl = document.createElement('div');
      subEl.className = 'history-item-sub';
      const wAcc = g.white_acc !== null && g.white_acc !== undefined ? g.white_acc + '%' : '—';
      const bAcc = g.black_acc !== null && g.black_acc !== undefined ? g.black_acc + '%' : '—';
      subEl.textContent = `${g.move_count || 0} moves · Acc ${wAcc} / ${bAcc} · ${formatHistDate(g.saved_at)}`;

      left.appendChild(titleEl);
      left.appendChild(subEl);

      // Right side: Est ELO + "View in detail" affordance
      const right = document.createElement('div');
      right.style.cssText = 'display:flex;flex-direction:column;align-items:flex-end;gap:2px;flex-shrink:0';
      const eloEl = document.createElement('div');
      eloEl.style.cssText = 'font-size:10px;color:var(--accent);font-weight:600;white-space:nowrap';
      const wElo = g.white_elo || '—';
      const bElo = g.black_elo || '—';
      eloEl.textContent = `📊 ${wElo} / ${bElo}`;
      const viewEl = document.createElement('div');
      viewEl.style.cssText = 'font-size:9px;color:var(--text3)';
      viewEl.textContent = _rvhSelectMode ? '' : 'View in detail ▸';
      right.appendChild(eloEl);
      right.appendChild(viewEl);

      item.appendChild(left);
      item.appendChild(right);
      body.appendChild(item);
    });
  }

  async function openReviewHistoryDetail(id) {
    const entries = await _rvhLoadAll();
    const g = entries.find(x => x.id === id);
    if (!g) return;
    _rvhDetail = g;

    document.getElementById('rvh-detail').style.display = 'flex';
    document.getElementById('rvh-detail-title').textContent =
      `${g.white_name || 'White'} vs ${g.black_name || 'Black'}`;

    document.getElementById('rvh-d-white-name').textContent = g.white_name || 'White';
    document.getElementById('rvh-d-black-name').textContent = g.black_name || 'Black';

    const accColor = v => v >= 90 ? 'var(--accent2)' : v >= 75 ? 'var(--accent)' : v >= 60 ? '#e0a84a' : 'var(--danger)';
    const wAccEl = document.getElementById('rvh-d-white-acc');
    const bAccEl = document.getElementById('rvh-d-black-acc');
    wAccEl.textContent = (g.white_acc !== null && g.white_acc !== undefined) ? g.white_acc + '%' : '—';
    bAccEl.textContent = (g.black_acc !== null && g.black_acc !== undefined) ? g.black_acc + '%' : '—';
    wAccEl.style.color = g.white_acc !== null ? accColor(parseFloat(g.white_acc)) : 'var(--text3)';
    bAccEl.style.color = g.black_acc !== null ? accColor(parseFloat(g.black_acc)) : 'var(--text3)';

    document.getElementById('rvh-d-white-elo').textContent = g.white_elo || '—';
    document.getElementById('rvh-d-black-elo').textContent = g.black_elo || '—';

    // Per-classification breakdown — kitni Best/Excellent/Good/Inaccuracy/Mistake/Blunder chalein
    const ORDER = ['Best','Excellent','Good','Inaccuracy','Mistake','Blunder'];
    const SYMS  = { Brilliant:'!!', Best:'✓', Excellent:'★', Good:'✦', Inaccuracy:'?!', Mistake:'?', Blunder:'??' };
    const rowsEl = document.getElementById('rvh-d-classification-rows');
    rowsEl.innerHTML = '';
    ORDER.forEach((k, i) => {
      const wCount = (g.white_counts && g.white_counts[k]) || 0;
      const bCount = (g.black_counts && g.black_counts[k]) || 0;
      if (wCount === 0 && bCount === 0) return;
      const color = QUALITY_COLORS[k] || 'var(--text3)';
      const sym   = SYMS[k] || '';
      const isLast = i === ORDER.length - 1;
      const row = document.createElement('div');
      row.style.cssText = `display:grid;grid-template-columns:1fr 1fr;${!isLast ? 'border-bottom:1px solid var(--border)' : ''}`;
      row.innerHTML = `
        <div style="padding:6px 12px;border-right:1px solid var(--border);display:flex;align-items:center;justify-content:space-between">
          <span style="font-size:10px;color:${color}">${k} ${sym}</span>
          <span style="font-size:14px;font-weight:600;color:${color}">${wCount || '—'}</span>
        </div>
        <div style="padding:6px 12px;display:flex;align-items:center;justify-content:space-between">
          <span style="font-size:10px;color:${color}">${k} ${sym}</span>
          <span style="font-size:14px;font-weight:600;color:${color}">${bCount || '—'}</span>
        </div>`;
      rowsEl.appendChild(row);
    });

    document.getElementById('rvh-d-meta').innerHTML =
      `<div><b>Moves:</b> ${g.move_count || 0}</div><div><b>Saved:</b> ${formatHistDate(g.saved_at)}</div>`;

    document.getElementById('rvh-detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function closeReviewHistoryDetail() {
    _rvhDetail = null;
    const el = document.getElementById('rvh-detail');
    if (el) el.style.display = 'none';
  }

  function copyReviewHistoryPGN() {
    if (!_rvhDetail) return;
    copyToClipboard(_rvhDetail.pgn || '', null);
  }

  // "Start Review" from a saved history entry — restores the full
  // move-by-move state instantly without re-running engine analysis.
  function resumeReviewFromHistory() {
    if (!_rvhDetail) return;
    const g = _rvhDetail;

    rvState.pgn = g.pgn;
    rvState.whiteName = g.white_name || 'White';
    rvState.blackName = g.black_name || 'Black';
    rvState.moves = g.moves || [];
    rvState.summary = g.summary || null;
    rvState.clockTimeline = g.clockTimeline || null;
    rvState.historyGame = null;

    document.getElementById('review-pgn-input').value = g.pgn || '';
    document.getElementById('review-depth-section').style.display = '';

    toggleReviewHistoryPanel(); // close the history panel
    startMoveByMove();
  }

  async function deleteReviewHistoryGame() {
    if (!_rvhDetail) return;
    if (!confirm('Yeh saved review delete karna chahte ho?')) return;
    try {
      await fetch(`${FLASK_URL}/review/history/${_rvhDetail.id}`, { method: 'DELETE' });
    } catch(e) { /* ignore — list refresh below will reflect actual backend state */ }
    closeReviewHistoryDetail();
    renderReviewHistoryList();
  }

  async function clearAllReviewHistory() {
    if (!confirm('SAARI saved reviews delete karna chahte ho? Yeh wapas nahi hoga.')) return;
    try {
      await fetch(`${FLASK_URL}/review/history`, { method: 'DELETE' });
    } catch(e) { /* ignore */ }
    closeReviewHistoryDetail();
    cancelReviewHistorySelect();
    renderReviewHistoryList();
  }

  function toggleReviewHistorySelectMode() {
    _rvhSelectMode = true;
    _rvhSelected.clear();
    document.getElementById('rvh-header-btns').style.display = 'none';
    document.getElementById('rvh-select-actions').style.display = 'flex';
    _updateRvhSelectCount();
    renderReviewHistoryList();
  }

  function cancelReviewHistorySelect() {
    _rvhSelectMode = false;
    _rvhSelected.clear();
    const hb = document.getElementById('rvh-header-btns');
    const sa = document.getElementById('rvh-select-actions');
    if (hb) hb.style.display = 'flex';
    if (sa) sa.style.display = 'none';
    renderReviewHistoryList();
  }

  function _updateRvhSelectCount() {
    const el = document.getElementById('rvh-select-count');
    if (el) el.textContent = _rvhSelected.size + ' selected';
  }

  async function deleteSelectedReviewHistory() {
    if (_rvhSelected.size === 0) { alert('Koi review select nahi kiya!'); return; }
    if (!confirm(`${_rvhSelected.size} review(s) delete karna chahte ho?`)) return;
    for (const id of _rvhSelected) {
      try { await fetch(`${FLASK_URL}/review/history/${id}`, { method: 'DELETE' }); } catch(e) { /* ignore */ }
    }
    cancelReviewHistorySelect();
    renderReviewHistoryList();
  }

  function resetReview() {
    closeReviewHistoryDetail();
    const histSec = document.getElementById('review-history-section');
    if (histSec) histSec.style.display = 'none';
    cancelReviewHistorySelect();
    rvState.pgn = '';
    rvState.moves = [];
    rvState.summary = null;
    rvState.currentIdx = -1;
    rvState.whiteName = 'White';
    rvState.blackName = 'Black';
    rvState.clockTimeline = null;
    rvState.historyGame = null;
    document.getElementById('review-pgn-input').value = '';
    document.getElementById('review-depth-section').style.display = 'none';
    clearArrows();
    document.body.classList.add('review-board-hidden');
    document.getElementById('analysis-top-row').classList.remove('show');
    document.getElementById('analysis-bottom-row').classList.remove('show');
    const cr = document.getElementById('rv-classification-row');
    if (cr) cr.style.display = 'none';
    const ob = document.getElementById('rv-opening-box');
    if (ob) ob.style.display = 'none';
    rvShowPhase('setup');
  }
