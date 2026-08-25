// ============================================================
// pgn.js — PGN tab: import, parse, render moves list,
//           variation tree rendering, navigation, FEN copy
// ============================================================

  // ── PGN parsing helpers ──────────────────────────────────────

  function _extractPGNHeader(pgn, tag) {
    const m = pgn.match(new RegExp(`\\[${tag}\\s+"([^"]*)"\\]`));
    return m ? m[1].trim() : '';
  }

  function _splitMultiGamePGN(text) {
    // Split on blank line(s) between games — a new game always starts with [
    const games = [];
    const blocks = text.split(/\n\s*\n(?=\[)/);
    for (const block of blocks) {
      const trimmed = block.trim();
      if (!trimmed) continue;
      // Must have at least one PGN header tag
      if (!trimmed.includes('[')) continue;
      // Must have some moves (non-header content after tags)
      const afterHeaders = trimmed.replace(/\[[^\]]*\]\s*/g, '').trim();
      if (!afterHeaders || afterHeaders === '*') continue;
      games.push(trimmed);
    }
    return games;
  }

  function _parsePGNMeta(pgn) {
    const white      = _extractPGNHeader(pgn, 'White')       || 'White';
    const black      = _extractPGNHeader(pgn, 'Black')       || 'Black';
    const result     = _extractPGNHeader(pgn, 'Result')      || '*';
    const dateStr    = _extractPGNHeader(pgn, 'Date')        || _extractPGNHeader(pgn, 'UTCDate') || '';
    const event      = _extractPGNHeader(pgn, 'Event')       || '';
    const site       = _extractPGNHeader(pgn, 'Site')        || '';
    const tc         = _extractPGNHeader(pgn, 'TimeControl') || '';
    // Count moves by finding move numbers in the moves section
    const body = pgn.replace(/\[[^\]]*\]\s*/g, '').replace(/\{[^}]*\}/g, '').trim();
    const lastNum = (body.match(/(\d+)\./g) || []);
    const moveCount = lastNum.length ? parseInt(lastNum[lastNum.length - 1]) * 2 : 0;
    return { white_name: white, black_name: black, result, date_str: dateStr,
             event, site, time_control: tc, move_count: moveCount, pgn };
  }

  function _formatImportedDate(dateStr) {
    // PGN date format: YYYY.MM.DD
    if (!dateStr || dateStr === '????.??.??') return '';
    const parts = dateStr.split('.');
    if (parts.length === 3 && parts[0] !== '????') {
      return `${parts[2]}/${parts[1]}/${parts[0]}`;
    }
    return dateStr;
  }

  function _formatTCLabel(tc) {
    if (!tc || tc === '-' || tc === '?') return '';
    // e.g. "600", "600+0", "300+5"
    const m = tc.match(/^(\d+)(?:\+(\d+))?/);
    if (!m) return tc;
    const base = parseInt(m[1]);
    const inc  = m[2] ? parseInt(m[2]) : 0;
    const mins = Math.floor(base / 60);
    const secs = base % 60;
    let label = mins > 0 ? `${mins}m` : '';
    if (secs > 0) label += `${secs}s`;
    if (inc > 0) label += `+${inc}s`;
    return label;
  }

  // ── Import actions ───────────────────────────────────────────

  async function importPGNFromText() {
    const text = document.getElementById('import-pgn-input').value.trim();
    if (!text) { _setImportStatus('⚠ PGN paste karo pehle'); return; }
    await _doImport(text);
    document.getElementById('import-pgn-input').value = '';
  }

  function importFromFile(input) {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
      await _doImport(e.target.result || '');
      input.value = '';
    };
    reader.readAsText(file);
  }

  async function _doImport(text) {
    _setImportStatus('⏳ Parsing...');
    const pgns = _splitMultiGamePGN(text);
    if (pgns.length === 0) { _setImportStatus('⚠ Koi valid game nahi mila'); return; }
    const parsed = pgns.map(_parsePGNMeta);
    try {
      const res = await fetch(`${FLASK_URL}/play/imported`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ games: parsed }),
      });
      const data = await res.json();
      if (data.ok) {
        const n = data.saved;
        _setImportStatus(n > 0 ? `✓ ${n} game${n>1?'s':''} imported` : '⚠ Sab duplicate the');
        await renderImportedList();
      } else {
        _setImportStatus('⚠ Import failed');
      }
    } catch(e) {
      _setImportStatus('⚠ Server error');
    }
    setTimeout(() => _setImportStatus(''), 3000);
  }

  function _setImportStatus(msg) {
    const el = document.getElementById('import-status');
    if (el) el.textContent = msg;
  }

  // ── Imported list filter ('all' | 'online') ──────────────────

  let _importedFilter  = 'all';
  let _onlineSubFilter = 'all'; // 'all' | 'lichess' | 'chess.com'

  function impSetFilter(f) {
    _importedFilter = f;
    const allBtn = document.getElementById('imp-filter-all');
    const onlBtn = document.getElementById('imp-filter-online');
    if (allBtn) allBtn.classList.toggle('active', f === 'all');
    if (onlBtn) onlBtn.classList.toggle('active', f === 'online');
    // Show sub-filter row only when 'Online Played' is active
    const subfilter = document.getElementById('imp-online-subfilter');
    if (subfilter) subfilter.style.display = f === 'online' ? 'flex' : 'none';
    renderImportedList();
  }

  function impSetOnlineSubFilter(val) {
    _onlineSubFilter = val;
    ['all', 'lichess', 'chesscom'].forEach(id => {
      const btn = document.getElementById('imp-sf-' + id);
      if (btn) btn.classList.remove('active');
    });
    const activeId = val === 'chess.com' ? 'imp-sf-chesscom'
                   : val === 'lichess'   ? 'imp-sf-lichess'
                   :                       'imp-sf-all';
    const activeBtn = document.getElementById(activeId);
    if (activeBtn) activeBtn.classList.add('active');
    renderImportedList();
  }

  // ── Render list ──────────────────────────────────────────────

  async function renderImportedList() {
    const body = document.getElementById('imported-list-body');
    // Pre-load reviewed fingerprints so blue ticks show correctly
    await _refreshReviewedFingerprints();
    try {
      const res = await fetch(`${FLASK_URL}/play/imported`);
      const data = await res.json();
      _importedGames = data.games || [];
    } catch(e) {
      body.innerHTML = '<div style="font-size:11px;color:var(--danger);text-align:center;padding:8px 0">Failed to load</div>';
      return;
    }

    let shown = _importedGames;
    if (_importedFilter === 'online') {
      shown = shown.filter(g => g.source === 'lichess' || g.source === 'chess.com');
      if (_onlineSubFilter === 'lichess')
        shown = shown.filter(g => g.source === 'lichess');
      else if (_onlineSubFilter === 'chess.com')
        shown = shown.filter(g => g.source === 'chess.com');
    }

    if (shown.length === 0) {
      const msg = _importedFilter === 'online'
        ? 'No online games pulled yet \u2014 Pull Lichess Games se Player Profile mein username daalo'
        : 'No imported games yet';
      body.innerHTML = '<div style="font-size:11px;color:var(--text3);text-align:center;padding:8px 0">' + msg + '</div>';
      return;
    }

    body.innerHTML = '';
    shown.forEach(g => body.appendChild(_makeImportedItem(g)));
  }

  function _makeImportedItem(g) {
    const item = document.createElement('div');
    item.className = 'history-item';

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.style.cssText = 'display:none;width:16px;height:16px;flex-shrink:0;accent-color:var(--danger);cursor:pointer;';
    cb.id = 'imp-cb-' + g.id;
    cb.checked = _importedSelected.has(g.id);
    cb.onchange = () => {
      if (cb.checked) _importedSelected.add(g.id);
      else _importedSelected.delete(g.id);
      _updateImportedSelectCount();
    };
    item.appendChild(cb);

    if (_importedSelectMode) {
      cb.style.display = '';
      item.onclick = (e) => {
        if (e.target === cb) return;
        cb.checked = !cb.checked;
        if (cb.checked) _importedSelected.add(g.id);
        else _importedSelected.delete(g.id);
        _updateImportedSelectCount();
      };
    } else {
      item.onclick = () => openImportedDetail(g.id);
    }

    const left = document.createElement('div');
    left.className = 'history-item-left';

    const titleEl = document.createElement('div');
    titleEl.className = 'history-item-title';
    const wElo = g.white_elo ? ` (${g.white_elo})` : '';
    const bElo = g.black_elo ? ` (${g.black_elo})` : '';
    titleEl.textContent = `${g.white_name || 'White'}${wElo} vs ${g.black_name || 'Black'}${bElo}`;

    const subEl = document.createElement('div');
    subEl.className = 'history-item-sub';
    let sourceLabel = '📥 Imported';
    if (g.source === 'lichess')   sourceLabel = '🌐 Lichess';
    if (g.source === 'chess.com') sourceLabel = '♟ Chess.com';
    const parts = [sourceLabel];
    if (g.event && g.event !== '?' && g.event !== 'Casual Game') parts.push(g.event);
    if (g.date_str) parts.push(_formatImportedDate(g.date_str));
    const tc = _formatTCLabel(g.time_control);
    if (tc) parts.push('⏱ ' + tc);
    if (g.move_count) parts.push(Math.ceil(g.move_count/2) + ' moves');
    subEl.textContent = parts.join(' · ');

    left.appendChild(titleEl);
    left.appendChild(subEl);

    const resultEl = document.createElement('div');
    // Match against main name + all "Other Names" (Lichess/Chess.com usernames)
    const _myNames = new Set();
    if (playerProfile && playerProfile.name && playerProfile.name.trim())
      _myNames.add(playerProfile.name.trim().toLowerCase());
    (playerProfile && playerProfile.other_names || []).forEach(n => {
      if (n && n.trim()) _myNames.add(n.trim().toLowerCase());
    });
    const wName  = (g.white_name || '').trim().toLowerCase();
    const bName  = (g.black_name || '').trim().toLowerCase();
    const iAmWhite = wName && _myNames.has(wName);
    const iAmBlack = bName && _myNames.has(bName);
    const iAmPlaying = iAmWhite || iAmBlack;
    let cls = 'draw', label = g.result || '*';
    if (g.result === '1/2-1/2') { cls = 'draw'; label = '½-½'; }
    else if (g.result === '1-0') {
      label = '1-0';
      cls = iAmPlaying ? (iAmWhite ? 'win' : 'loss') : 'draw';
    } else if (g.result === '0-1') {
      label = '0-1';
      cls = iAmPlaying ? (iAmBlack ? 'win' : 'loss') : 'draw';
    }
    resultEl.className = 'history-item-result ' + cls;
    resultEl.textContent = label;

    // Right side: result + optional blue tick for reviewed imported games
    const rightCol = document.createElement('div');
    rightCol.style.cssText = 'display:flex;flex-direction:column;align-items:flex-end;gap:3px;flex-shrink:0';
    rightCol.appendChild(resultEl);
    if (g.source === 'lichess' && g.site && g.site.indexOf('http') === 0) {
      const lcLink = document.createElement('a');
      lcLink.href = g.site;
      lcLink.target = '_blank';
      lcLink.rel = 'noopener';
      lcLink.textContent = g.source === 'chess.com' ? 'View on Chess.com \u2192' : 'View on Lichess \u2192';
      lcLink.style.cssText = 'font-size:9px;color:#4a9eff;text-decoration:none';
      lcLink.onclick = (e) => e.stopPropagation();
      rightCol.appendChild(lcLink);
    }
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

  // ── Detail view ──────────────────────────────────────────────

  function openImportedDetail(gameId) {
    const g = _importedGames.find(x => x.id === gameId);
    if (!g) return;
    _importedDetailGame = g;

    document.getElementById('imported-detail').style.display = 'flex';
    document.getElementById('imported-detail-title').textContent =
      `${g.white_name || 'White'} vs ${g.black_name || 'Black'}`;

    let resultLabel = g.result || '*';
    if (g.result === '1-0') resultLabel = '1 – 0  (White wins)';
    else if (g.result === '0-1') resultLabel = '0 – 1  (Black wins)';
    else if (g.result === '1/2-1/2') resultLabel = '½ – ½  (Draw)';

    const tc = _formatTCLabel(g.time_control) || g.time_control || '—';
    const dateDisp = _formatImportedDate(g.date_str) || g.date_str || '—';
    const importedOn = formatHistDate(g.imported_at);

    const meta = document.getElementById('imported-detail-meta');
    meta.innerHTML = `
      <div><b>White:</b> ${g.white_name || '—'}</div>
      <div><b>Black:</b> ${g.black_name || '—'}</div>
      <div><b>Result:</b> ${resultLabel}</div>
      ${(g.white_elo || g.black_elo) ? `<div><b>ELO:</b> ${g.white_elo || '\u2014'} vs ${g.black_elo || '\u2014'}</div>` : ''}
      ${g.event && g.event !== '?' ? `<div><b>Event:</b> ${g.event}</div>` : ''}
      ${g.site && g.site !== '?' ? `<div><b>Site:</b> ${g.site.indexOf('http') === 0 ? `<a href="${g.site}" target="_blank" rel="noopener" style="color:var(--accent)">${g.source === 'chess.com' ? 'View on Chess.com \u2192' : 'View on Lichess \u2192'}</a>` : g.site}</div>` : ''}
      <div><b>Date played:</b> ${dateDisp}</div>
      <div><b>Time control:</b> ${tc}</div>
      <div><b>Moves:</b> ${g.move_count ? Math.ceil(g.move_count/2) : '—'}</div>
      <div><b>Imported on:</b> ${importedOn}</div>
    `;

    // Load review data if this imported game has been reviewed
    _loadImportedReviewPanel(g);

    document.getElementById('imported-detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function closeImportedDetail() {
    _importedDetailGame = null;
    document.getElementById('imported-detail').style.display = 'none';
  }

  function copyImportedPGN() {
    if (!_importedDetailGame) return;
    copyToClipboard(_importedDetailGame.pgn, 'copied-flash');
  }

  async function loadImportedToAnalysis() {
    const g = _importedDetailGame;
    if (!g || !g.pgn) return;
    // Load into PGN tab
    switchTab('pgn');
    document.getElementById('pgn-input').value = g.pgn;
    loadPGN();

    // Try to attach review data if this imported game has been reviewed
    _analysisReviewMoves = null;
    try {
      const res = await fetch(`${FLASK_URL}/review/history`);
      const data = await res.json();
      const entries = data.games || [];
      const myBody = _pgnMoveBody(g.pgn);
      const matches = entries.filter(r => _pgnMoveBody(r.pgn) === myBody);
      if (matches.length > 0) {
        const best = matches.reduce((b, r) =>
          ((r.white_acc||0)+(r.black_acc||0)) > ((b.white_acc||0)+(b.black_acc||0)) ? r : b);
        _analysisReviewMoves = best.moves || null;
      }
    } catch(e) { /* ignore */ }

    if (_analysisReviewMoves) updatePGNMoves();
  }

  function loadImportedToReview() {
    if (!_importedDetailGame || !_importedDetailGame.pgn) return;
    openInReview(_importedDetailGame.pgn, null);
  }

  async function deleteImportedGame() {
    if (!_importedDetailGame) return;
    if (!confirm('Delete this imported game?')) return;
    try {
      await fetch(`${FLASK_URL}/play/imported/${_importedDetailGame.id}`, { method: 'DELETE' });
    } catch(e) { /* ignore */ }
    closeImportedDetail();
    renderImportedList();
  }

  async function clearAllImported() {
    if (!confirm('Clear ALL imported games? This cannot be undone.')) return;
    try { await fetch(`${FLASK_URL}/play/imported`, { method: 'DELETE' }); } catch(e) {}
    closeImportedDetail();
    renderImportedList();
  }

  function toggleImportedSelectMode() {
    _importedSelectMode = true;
    _importedSelected.clear();
    document.getElementById('imported-header-btns').style.display = 'none';
    document.getElementById('imported-select-actions').style.display = 'flex';
    _updateImportedSelectCount();
    renderImportedList();
  }

  function cancelImportedSelect() {
    _importedSelectMode = false;
    _importedSelected.clear();
    document.getElementById('imported-header-btns').style.display = 'flex';
    document.getElementById('imported-select-actions').style.display = 'none';
    renderImportedList();
  }

  function _updateImportedSelectCount() {
    const el = document.getElementById('imported-select-count');
    if (el) el.textContent = _importedSelected.size + ' selected';
  }

  async function deleteSelectedImported() {
    if (_importedSelected.size === 0) { alert('Koi game select nahi kiya!'); return; }
    if (!confirm(`${_importedSelected.size} game(s) delete karna chahte ho?`)) return;
    try {
      await fetch(`${FLASK_URL}/play/imported`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [..._importedSelected] }),
      });
    } catch(e) {}
    cancelImportedSelect();
    renderImportedList();
  }

  function copyFEN() {
    const fen = game.fen();
    navigator.clipboard.writeText(fen).then(() => {
      const flash = document.getElementById('copied-flash');
      flash.classList.add('show');
      setTimeout(() => flash.classList.remove('show'), 1500);
    }).catch(() => {
      const el = document.createElement('textarea');
      el.value = fen;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
    });
  }

  // PGN
  function loadPGN() {
    _analysisReviewMoves = null;   // fresh load — no review classification
    const pgn = document.getElementById('pgn-input').value.trim();
    if (!pgn) return;
    const testGame = new Chess();
    // Pehle directly try karo (most PGNs ka yahi path hoga)
    let _pgnForLoad = pgn;
    if (!testGame.load_pgn(pgn)) {
      // Agar fail ho — shayad chess.js emoji headers handle nahi kar pa raha.
      // Headers manually extract karke strip karo, phir moves-only PGN try karo.
      const _extractedHeaders = {};
      pgn.replace(/\[(\w+)\s+"([^"]*)"\]/g, (_, key, val) => { _extractedHeaders[key] = val; });
      const _movesOnly = pgn.replace(/\[[^\]]*\]\s*/g, '').trim();
      if (!testGame.load_pgn(_movesOnly)) {
        alert('Invalid PGN!');
        return;
      }
      // Manually headers set karo
      Object.entries(_extractedHeaders).forEach(([k,v]) => testGame.header(k, v));
      _pgnForLoad = _movesOnly;
    }
    game.load_pgn(_pgnForLoad);
    const headers = testGame.header();
    const fenHeader = headers['FEN'];
    startFen = fenHeader || 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    moveHistory = game.history({ verbose: true });
    currentMoveIdx = moveHistory.length - 1;
    _varIdCounter = 0;
    varTree = [_newVarNode(null, 0, moveHistory, 'Main Line')];
    activeVarId = varTree[0].id;
    board.position(game.fen());
    updateFENDisplay();
    updatePGNMoves();
    updateTurnLabel();
    clearArrows();
    analyzePosition();
    _updateAnalysisCaptured(game);

    // ── Player names + clock from PGN headers / %clk comments ──
    // chess.js ka header() emoji/special-char names mein kabhi kabhi fail karta hai,
    // isliye regex fallback bhi rakhte hain.
    const isGeneric = n => !n || n === '?' || !n.trim();
    const _hdrWhite = headers['White'] || (pgn.match(/\[White "([^"]*)"\]/) || [])[1] || '';
    const _hdrBlack = headers['Black'] || (pgn.match(/\[Black "([^"]*)"\]/) || [])[1] || '';
    const rawWhite = _hdrWhite;
    const rawBlack = _hdrBlack;
    const whiteName = isGeneric(rawWhite) ? 'White' : rawWhite.trim();
    const blackName = isGeneric(rawBlack) ? 'Black' : rawBlack.trim();

    // WhiteElo / BlackElo
    const whiteElo = headers['WhiteElo'] && headers['WhiteElo'] !== '?' ? headers['WhiteElo'] : null;
    const blackElo = headers['BlackElo'] && headers['BlackElo'] !== '?' ? headers['BlackElo'] : null;

    const topLabel    = '♟ ' + blackName + (blackElo ? '  (' + blackElo + ')' : '');
    const bottomLabel = '♙ ' + whiteName + (whiteElo ? '  (' + whiteElo + ')' : '');

    // %clk clock timeline
    const clkData = _buildReviewClockTimeline(pgn);

    analysisPlayerInfo = {
      topName:      topLabel,
      bottomName:   bottomLabel,
      hasClock:     !!clkData,
      timeline:     clkData ? clkData.timeline     : [],
      startWhiteMs: clkData ? clkData.startWhiteMs : 0,
      startBlackMs: clkData ? clkData.startBlackMs : 0,
      _fromAnalysisLoad: true,
    };
    _restoreAnalysisPlayerRows();
    _applyAnalysisClockForIdx(currentMoveIdx);
  }

  function exportPGN() {
    const pgn = game.pgn();
    const blob = new Blob([pgn], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'game.pgn';
    a.click();
  }




  // Build PGN string from a node's moves + startFen
  function buildVariationPGN(moves) {
    const g = new Chess();
    g.load(startFen);
    const stdFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    if (startFen !== stdFen) {
      g.header('SetUp', '1', 'FEN', startFen);
    }
    for (const m of moves) {
      try { g.move(m.san); } catch(e) { break; }
    }
    return g.pgn();
  }

  function copyActiveVariationPGN() {
    const node = _activeNode();
    const moves = node ? node.moves : moveHistory;
    const pgn = buildVariationPGN(moves);
    copyToClipboard(pgn, 'pgn-copied-flash');
    const flash = document.getElementById('pgn-copied-flash');
    if (flash) {
      flash.textContent = '✓ Copied!';
      flash.classList.add('show');
      setTimeout(() => { flash.classList.remove('show'); flash.textContent = '✓ Copied!'; }, 1500);
    }
  }

  function copyMainPGN() {
    // Copy root node (Main Line) always
    const root = varTree.length > 0 ? varTree[0] : null;
    const pgn = buildVariationPGN(root ? root.moves : moveHistory);
    copyToClipboard(pgn, 'pgn-copied-flash');
    const flash = document.getElementById('pgn-copied-flash');
    if (flash) {
      flash.textContent = '✓ Main Line Copied!';
      flash.classList.add('show');
      setTimeout(() => { flash.classList.remove('show'); flash.textContent = '✓ Copied!'; }, 1800);
    }
  }

  // ── Core PGN Renderer ────────────────────────────────────────
  // Renders a node's moves into `container` starting at move index `fromIdx`.
  // After each move that has children (variations), inserts indented variation blocks.
  // Recursively renders children.
  // `depth` controls indentation level (0 = main, 1 = variation, 2 = nested, ...)
  function _renderNodeMoves(node, container, depth) {
    const moves = node.moves;
    const isActiveNode = node.id === activeVarId;

    // For child nodes: only render moves from branchMoveIdx onward
    // (moves before branchMoveIdx are already shown by parent)
    const startIdx = (node.parentId === null) ? 0 : node.branchMoveIdx;

    // Children that branch right at the very start of this node's range
    // (e.g. a variation that diverges from the starting position itself,
    // before any move of this node has been played) — these were never
    // checked by the in-loop "children after move i" logic below, since
    // that only ever looks for branchMoveIdx === i+1 starting at i=startIdx.
    const leadingChildren = _childrenOf(node.id).filter(c => c.branchMoveIdx === startIdx);
    if (leadingChildren.length > 0) {
      _renderVarBlocks(leadingChildren, container, depth);
    }

    for (let i = startIdx; i < moves.length; i++) {
      const move = moves[i];

      // Move number label (every white move, and first move of a variation if black)
      if (i % 2 === 0) {
        const num = document.createElement('span');
        num.className = 'pgn-token move-num';
        num.textContent = (Math.floor(i / 2) + 1) + '.';
        container.appendChild(num);
      } else if (i === startIdx && node.parentId !== null) {
        // First move of a variation that starts on black's turn → show "N..."
        const num = document.createElement('span');
        num.className = 'pgn-token move-num';
        num.textContent = (Math.floor(i / 2) + 1) + '...';
        container.appendChild(num);
      }

      const btn = document.createElement('span');
      const isCurrent = isActiveNode && (i === currentMoveIdx);
      btn.className = 'pgn-token move' + (isCurrent ? ' current' : '');
      if (!isActiveNode) btn.style.opacity = '0.75';
      btn.textContent = move.san;
      // Annotate with classification badge if review data is present (main line only)
      if (node.parentId === null && _analysisReviewMoves && i < _analysisReviewMoves.length) {
        const rv = _analysisReviewMoves[i];
        if (rv && rv.classification) {
          const sym = QUALITY_SYMBOLS[rv.classification];
          const col = QUALITY_COLORS[rv.classification];
          if (sym) {
            const badge = document.createElement('sup');
            badge.textContent = sym;
            badge.style.cssText = `font-size:9px;color:${col};margin-left:1px;font-weight:700;`;
            btn.appendChild(badge);
            btn.title = rv.classification + (rv.best_san && rv.best_san !== rv.played_san ? ' — best: ' + rv.best_san : '');
          }
        }
      }
      btn.onclick = () => { switchToVariation(node.id); goToMove(i); };
      container.appendChild(btn);

      // After this move, check if any child nodes branch HERE (branchMoveIdx === i+1)
      const children = _childrenOf(node.id).filter(c => c.branchMoveIdx === i + 1);
      if (children.length > 0) {
        _renderVarBlocks(children, container, depth);
      }
    }
  }

  // Renders one or more sibling variation blocks (each with a "🔀 Var" label
  // chip followed by that variation's moves) into `container`. Shared by both
  // the leading-branch case (diverges before any move of the parent node) and
  // the normal in-loop case (diverges right after a specific move).
  function _renderVarBlocks(children, container, depth) {
    children.forEach(child => {
      const varBlock = document.createElement('div');
      varBlock.style.cssText = [
        'display:flex',
        'flex-wrap:wrap',
        'align-items:baseline',
        'gap:3px',
        'margin:4px 0 4px ' + ((depth + 1) * 14) + 'px',
        'padding:4px 6px',
        'border-left:2px solid ' + (child.id === activeVarId ? 'var(--accent)' : 'var(--border)'),
        'border-radius:0 4px 4px 0',
        'background:' + (depth === 0 ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.01)'),
        'width:100%'
      ].join(';');

      // Variation label chip
      const chip = document.createElement('span');
      chip.style.cssText = 'font-size:9px;color:' + (child.id === activeVarId ? 'var(--accent)' : 'var(--text3)') + ';letter-spacing:0.05em;text-transform:uppercase;font-weight:600;cursor:pointer;white-space:nowrap;';
      chip.textContent = '🔀 ' + child.label;
      chip.onclick = () => { switchToVariation(child.id); };
      varBlock.appendChild(chip);

      // Render this child's moves inline (starting from its branch point)
      _renderNodeMoves(child, varBlock, depth + 1);
      container.appendChild(varBlock);
    });
  }

  function updatePGNMoves() {
    const container = document.getElementById('pgn-moves');
    container.innerHTML = '';

    // Helper: attach classification sym+color to a move token
    function _annotateToken(btn, plyIdx) {
      if (!_analysisReviewMoves || plyIdx < 0 || plyIdx >= _analysisReviewMoves.length) return;
      const mv = _analysisReviewMoves[plyIdx];
      if (!mv || !mv.classification) return;
      const sym = QUALITY_SYMBOLS[mv.classification];
      const col = QUALITY_COLORS[mv.classification];
      if (!sym) return;
      // Append small superscript badge
      const badge = document.createElement('sup');
      badge.textContent = sym;
      badge.style.cssText = `font-size:9px;color:${col};margin-left:1px;font-weight:700;`;
      btn.appendChild(badge);
      btn.title = mv.classification + (mv.best_san && mv.best_san !== mv.played_san ? ' — best: ' + mv.best_san : '');
    }

    if (varTree.length === 0) {
      // No tree yet — show plain moveHistory
      moveHistory.forEach((move, i) => {
        if (i % 2 === 0) {
          const num = document.createElement('span');
          num.className = 'pgn-token move-num';
          num.textContent = (i/2 + 1) + '.';
          container.appendChild(num);
        }
        const btn = document.createElement('span');
        btn.className = 'pgn-token move' + (i === currentMoveIdx ? ' current' : '');
        btn.textContent = move.san;
        _annotateToken(btn, i);
        btn.onclick = () => goToMove(i);
        container.appendChild(btn);
      });
      _renderMoveCards();
      return;
    }

    // Render root node (Main Line) — all its variations appear inline after the diverging move
    const root = varTree[0];
    _renderNodeMoves(root, container, 0);
    _renderMoveCards();

    // Scroll current move into view within the pgn-moves container only
    const currentMoveEl = container.querySelector('.pgn-token.move.current');
    if (currentMoveEl) {
      const containerRect = container.getBoundingClientRect();
      const elRect = currentMoveEl.getBoundingClientRect();
      if (elRect.top < containerRect.top || elRect.bottom > containerRect.bottom) {
        currentMoveEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  }

  // Render single current-move classification card (below nav buttons, PGN tab + main line only)
  function _renderMoveCards() {
    const cardsEl = document.getElementById('pgn-move-cards');
    if (!cardsEl) return;

    // Hide and clear best-move arrow if conditions not met
    const onPgnTab = _currentTab === 'pgn';
    const rootId = varTree.length > 0 ? varTree[0].id : 0;
    const onMainLine = (activeVarId === rootId);
    const idx = currentMoveIdx;
    const mv = (_analysisReviewMoves && idx >= 0 && idx < _analysisReviewMoves.length)
      ? _analysisReviewMoves[idx] : null;

    // Clear blue best-move arrow whenever card is not shown
    function _clearBestArrow() {
      window._arrowBest = null;
      const svg = document.getElementById('arrow-svg');
      if (svg) {
        const old = svg.querySelector('#ah-review-line');
        if (old) old.remove();
      }
    }

    if (!onPgnTab || !onMainLine || !mv || !mv.played_san) {
      cardsEl.style.display = 'none';
      cardsEl.innerHTML = '';
      _clearBestArrow();
      return;
    }

    const cls = mv.classification || 'Unknown';
    const sym = QUALITY_SYMBOLS[cls] || '';
    const col = QUALITY_COLORS[cls] || 'var(--text3)';
    const moveNum = Math.floor(idx / 2) + 1;
    const side = idx % 2 === 0 ? '♙' : '♟';

    const hasBest = mv.best_san && mv.best_san !== mv.played_san;
    const bestPart = hasBest
      ? `<span style="font-size:10px;color:#4a9eff;margin-left:6px;font-weight:600">→ ${mv.best_san}</span>` : '';

    cardsEl.style.display = 'block';
    cardsEl.innerHTML = `
      <div style="display:flex;align-items:center;gap:6px;padding:5px 10px;border-radius:6px;background:${col}18;border-left:3px solid ${col};font-size:11px;">
        <span style="color:var(--text3);font-size:10px;min-width:28px">${moveNum}.${idx%2===0?'':'..'}</span>
        <span style="color:var(--text);font-weight:600">${side} ${mv.played_san}</span>
        <span style="color:${col};font-weight:700;font-size:13px">${sym}</span>
        <span style="color:${col};font-size:10px;flex:1">${cls}</span>
        ${bestPart}
      </div>
    `;

    // Suggestion ON  → green arrow (analyzePosition draws it, blue nahi chahiye)
    // Suggestion OFF → blue arrow (best move dikhao)
    if (hasBest) {
      if (!window._suggestionOn) {
        const _idx = idx;
        const _bestSan = mv.best_san;
        setTimeout(() => {
          if (currentMoveIdx !== _idx || _currentTab !== 'pgn') return;
          try {
            const rootNode = varTree.length > 0 ? varTree[0] : null;
            const allHistory = rootNode ? rootNode.moves : [];
            const replayGame = new Chess(startFen);
            for (let k = 0; k < _idx; k++) replayGame.move(allHistory[k].san);
            const parsed = replayGame.move(_bestSan);
            if (parsed) {
              const svg = document.getElementById('arrow-svg');
              if (svg) { const old = svg.querySelector('#ah-review-line'); if (old) old.remove(); }
              drawArrowSVG(parsed.from, parsed.to, 'ah-review', 'rgba(74,158,255,0.90)');
              if (svg) { const lines = svg.querySelectorAll('line'); if (lines.length) lines[lines.length-1].id = 'ah-review-line'; }
            }
          } catch(e) {}
        }, 200);
      } else {
        _clearBestArrow();
      }
    } else {
      _clearBestArrow();
    }
  }

  function switchToVariation(nodeId) {
    const node = _getNode(nodeId);
    if (!node) return;
    activeVarId = nodeId;
    moveHistory = node.moves.slice();
    // Don't auto-navigate — just switch active; caller handles goToMove
  }

  // Debounce timer for analyzePosition during rapid navigation
  let _analyzeDebounceTimer = null;

  function goToMove(idx) {
    // Use moveHistory (full game) — do NOT call game.history() after reset
    const allHistory = moveHistory.slice();   // save before any mutation
    if (allHistory.length === 0) return;
    if (idx < 0) { goToStart(); return; }
    idx = Math.min(idx, allHistory.length - 1);

    // Replay from the real start FEN (not necessarily standard start)
    game.load(startFen);
    for (let i = 0; i <= idx; i++) {
      game.move(allHistory[i].san);
    }
    currentMoveIdx = idx;
    clearTapSelection();
    board.position(game.fen());
    updateFENDisplay();
    updateTurnLabel();
    updatePGNMovesHighlight(idx);
    clearArrows();
    // Sound for the move we navigated to (capture/check/gameend aware)
    if (window.SoundFX) {
      const navMove = allHistory[idx];
      if (navMove) SoundFX.playForMove(game, navMove);
    }
    // Show last played move as blue arrow
    const lastMove = allHistory[idx];
    if (lastMove) setTimeout(() => drawArrow(lastMove.from, lastMove.to, 'last'), 90);

    // Debounce analyzePosition — rapid navigation pe baar baar engine call na ho
    if (_analyzeDebounceTimer) clearTimeout(_analyzeDebounceTimer);
    _analyzeDebounceTimer = setTimeout(() => {
      analyzePosition();
    }, 180);

    _updateAnalysisCaptured(game);
    if (analysisPlayerInfo) {
      _applyAnalysisClockForIdx(idx);
    }
  }

  function updatePGNMovesHighlight(idx) {
    // Fast path: just swap the 'current' class without full DOM rebuild.
    // Full rebuild is only needed when the move list itself changes.
    const container = document.getElementById('pgn-moves');
    if (!container) { updatePGNMoves(); return; }

    // Check if the rendered list matches the current move count (simple guard).
    // If not (e.g. new game loaded, variation switched) fall back to full render.
    const moveBtns = container.querySelectorAll('.pgn-token.move');
    if (moveBtns.length !== moveHistory.length) {
      updatePGNMoves();
      return;
    }

    // Fast path — only toggle the 'current' class
    moveBtns.forEach((btn, i) => {
      if (i === idx) btn.classList.add('current');
      else           btn.classList.remove('current');
    });

    // Scroll the highlighted token into view
    const currentEl = container.querySelector('.pgn-token.move.current');
    if (currentEl) {
      const cRect = container.getBoundingClientRect();
      const eRect = currentEl.getBoundingClientRect();
      if (eRect.top < cRect.top || eRect.bottom > cRect.bottom) {
        currentEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }

    // Still update the move classification card (lightweight)
    _renderMoveCards();
  }

  function prevMove() {
    if (currentMoveIdx <= 0) { goToStart(); return; }
    goToMove(currentMoveIdx - 1);
  }

  function nextMove() {
    if (currentMoveIdx < moveHistory.length - 1) goToMove(currentMoveIdx + 1);
  }

  function goToStart() {
    // Go back to the real start position (FEN-loaded or standard start)
    game.load(startFen);
    currentMoveIdx = -1;
    clearTapSelection();
    board.position(game.fen());
    updateFENDisplay();
    updateTurnLabel();
    updatePGNMovesHighlight(-1);
    clearArrows();
    resetEval();
    _updateAnalysisCaptured(game);
    if (analysisPlayerInfo) {
      _applyAnalysisClockForIdx(-1);
    }
  }

  function goToEnd() {
    if (moveHistory.length > 0) goToMove(moveHistory.length - 1);
  }

  function updateTurnLabel() {
    // turn-label removed from UI
  }

  // Show the chessboard only once a Play-vs-Bot or Bot-vs-Bot game is
  // actually active; otherwise hide it so the Play tab's setup panel
  // takes the full screen (mobile-friendly).
  function updatePlayBoardVisibility() {
    const pzActive = (typeof pzState !== 'undefined' && pzState && pzState.active);
    const gameActive = playState.active || (typeof bvbState !== 'undefined' && bvbState && bvbState.active) || (typeof frState !== 'undefined' && frState && frState.active) || pzActive;
    document.body.classList.toggle('play-board-hidden', !gameActive);
  }

