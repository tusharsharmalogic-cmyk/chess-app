// ============================================================
// board.js — Global state, board init, tap system, arrows,
//             eval bar, variation tree, FEN/PGN load helpers
// ============================================================

  const FLASK_URL = 'http://localhost:5050';

  // ── Settings: saved appearance prefs (localStorage fallback + backend fetch) ──
  let savedPieceSet = localStorage.getItem('pieceSet') || 'wikipedia';
  let savedLightSq  = localStorage.getItem('sqLight')  || '#f0e9d2';
  let savedDarkSq   = localStorage.getItem('sqDark')   || '#7c5c3e';
  const _initPieceSet = savedPieceSet; // board init mein jo use hua
  // Board colors ko load hote hi apply karo (CSS vars — base.css overrides)
  document.documentElement.style.setProperty('--sq-light', savedLightSq);
  document.documentElement.style.setProperty('--sq-dark',  savedDarkSq);
  // Backend se appearance fetch karo — localStorage ko sync karo taaki offline bhi chale
  (async () => {
    try {
      const res = await fetch('/api/appearance');
      const srv = await res.json();
      if (srv && srv.pieceSet) {
        localStorage.setItem('pieceSet', srv.pieceSet);
        savedPieceSet = srv.pieceSet;
      }
      if (srv && srv.sqLight) {
        localStorage.setItem('sqLight', srv.sqLight);
        document.documentElement.style.setProperty('--sq-light', srv.sqLight);
      }
      if (srv && srv.sqDark) {
        localStorage.setItem('sqDark', srv.sqDark);
        document.documentElement.style.setProperty('--sq-dark', srv.sqDark);
      }
      // Agar server ka pieceSet alag hai toh board re-init karo
      if (savedPieceSet !== _initPieceSet && typeof window.applyPieceSet === 'function') {
        setTimeout(() => window.applyPieceSet(savedPieceSet), 150);
      }
    } catch(e) { /* offline — localStorage fallback chalega */ }
  })();

  // ── Play state & constants — declared early to avoid TDZ errors ──
  const HASH_MAP = [16, 32, 64, 128, 256, 512, 1024];

  // Move classification colours and symbols — declared early (used by both
  // analysis/PGN tab functions and review tab functions)
  const QUALITY_COLORS = {
    'Brilliant':  '#61bd4f',
    'Best':       '#61bd4f',
    'Excellent':  '#8fb86e',
    'Good':       '#c4a35a',
    'Inaccuracy': '#f0a500',
    'Mistake':    '#d46060',
    'Blunder':    '#d44',
    'Unknown':    '#5a5650',
  };
  const QUALITY_SYMBOLS = {
    'Brilliant':  '!!',
    'Best':       '✓',
    'Excellent':  '★',
    'Good':       '✦',
    'Inaccuracy': '?!',
    'Mistake':    '?',
    'Blunder':    '??',
  };

  let playState = {
    active:       false,
    botId:        null,
    botName:      '',
    playerColor:  'w',
    timeControl:  false,
    timeMinutes:  10,
    playerMs:     0,
    botMs:        0,
    features: {
      undo: true, hint: true, evalbar: false,
      threat: false, suggestion: true
    },
    pgn:          '',
    fen:          'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    status:       'setup',
    result:       null,
  };
  // ─────────────────────────────────────────────────────────────────

  // Player profile (name + ELO) — chess.com style rating
  let playerProfile = { name: 'Player', elo: 1200, games_played: 0 };
  // ─────────────────────────────────────────────────────────────────

  let game = new Chess();
  let board = null;
  let moveHistory = [];      // always the FULL move list of the loaded game
  let currentMoveIdx = -1;  // -1 = starting position
  let highlightedSquares = [];
  let boardFlipped = false;
  let selectedSquare = null;   // tap-to-move: currently selected square

  // ── Variation Tree System ──────────────────────────────────────
  // startFen: the FEN from which the current session started
  let startFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

  // Tree node structure:
  //   { id, parentId, branchMoveIdx, moves:[...verbose], label }
  //   id            : unique number
  //   parentId      : id of parent node (null for root)
  //   branchMoveIdx : index in PARENT's moves where this branch starts
  //   moves         : full verbose move list from startFen for THIS line
  //   label         : display label
  let varTree = [];       // array of all nodes; varTree[0] = root (Main Line)
  let _varIdCounter = 0;
  let activeVarId = 0;   // id of currently active variation node

  // ── Analysis player rows (names/clocks/captured) persistence ────
  // Set whenever a game is loaded into the analysis board (from History
  // "Open in Analysis" or live Play "Open in Analysis"). Used to restore
  // the player-row UI (names, per-move remaining clock, captured pieces)
  // whenever the user navigates back to a non-Play tab, and to recompute
  // the correct remaining time at any move while stepping through history.
  let analysisPlayerInfo = null;
  // analysisPlayerInfo shape:
  // {
  //   topName, bottomName,         // display labels, e.g. '♟ Black', '♙ White'
  //   hasClock: bool,               // whether to show clock digits at all
  //   timeline: [{whiteMs, blackMs}, ...] // one entry per ply (index matches moveHistory), remaining time AFTER that move
  //   startWhiteMs, startBlackMs    // remaining time before any move (ply -1 / goToStart)
  // }

  // Stores rvState.moves classification data when a reviewed game is opened
  // in analysis — used to annotate PGN tokens + move cards with classifications.
  let _analysisReviewMoves = null;

  // ── FEN Cache — precomputed at load time so goToMove is O(1) ──
  // Indexed by ply: _fenCache[-1] = startFen, _fenCache[i] = FEN after move i
  // Rebuilt whenever a new game/variation is loaded.
  let _fenCache = [];   // _fenCache[i] = FEN after allHistory[i]

  function _newVarNode(parentId, branchMoveIdx, moves, label) {
    const id = _varIdCounter++;
    return { id, parentId, branchMoveIdx, moves: moves.slice(), label };
  }

  function _getNode(id) { return varTree.find(n => n.id === id) || null; }
  function _activeNode() { return _getNode(activeVarId); }
  function _childrenOf(id) { return varTree.filter(n => n.parentId === id); }

  // Get the "path" of nodes from root → activeVarId
  function _activePath() {
    const path = [];
    let node = _activeNode();
    while (node) { path.unshift(node); node = _getNode(node.parentId); }
    return path;
  }

  // Set Up Position state
  let setupMode = false;
  let setupSelectedPiece = null;  // 'wP','bQ', etc. or null = eraser
  let setupTurn = 'w';
  let setupSavedFen = null;       // analysis position before entering setup mode
  let legalMoveSquares = [];   // squares with legal move dots

  // Init board
  board = Chessboard('board', {
    draggable: true,
    position: 'start',
    onDragStart: onDragStart,
    onDrop: onDrop,
    onSnapEnd: onSnapEnd,
    pieceTheme: getPieceTheme(savedPieceSet),
    moveSpeed: 'fast',
    snapbackSpeed: 300,
    snapSpeed: 80
  });


  
  // ── Settings: piece set runtime switch (Settings tab se call hota hai) ──
  function getPieceTheme(setName) {
    const ext = (setName === 'wikipedia') ? 'png' : 'svg';
    return `img/chesspieces/${setName}/{piece}.${ext}`;
  }

  window.applyPieceSet = function(setName) {
    localStorage.setItem('pieceSet', setName);
    // Active tab ke hisaab se sahi position wapas lao
    let fen = game.fen();
    const activeTab = document.querySelector('.tab-content.active');
    if (activeTab && activeTab.id === 'tab-play') {
      if (typeof pzState !== 'undefined' && pzState && pzState.active && pzState.game) fen = pzState.game.fen();
      else if (typeof playGame !== 'undefined' && playGame) fen = playGame.fen();
    }
    board.destroy();
    board = Chessboard('board', {
      draggable: true,
      position: fen,
      onDragStart: onDragStart,
      onDrop: onDrop,
      onSnapEnd: onSnapEnd,
      pieceTheme: getPieceTheme(setName),
      moveSpeed: 'fast',
      snapbackSpeed: 300,
      snapSpeed: 80
    });
    // Flip state restore karo (raw flip — wrapper abhi nahi laga)
    if (boardFlipped) { const _of = board.flip.bind(board); _of(); }
    // Tap/position/flip hooks naye board instance par dobara lagao
    wrapBoardTapHooks();
    setTimeout(attachBoardTapHandlers, 100);
    // Arrows bhi redraw karo naye board par
    setTimeout(() => redrawArrows(), 60);
  };

  function getPromotionPiece() {
    const pieces = ['q', 'r', 'b', 'n'];
    let choice = prompt('Promote to: Queen (q), Rook (r), Bishop (b), Knight (n)', 'q');
    if (choice && pieces.includes(choice.toLowerCase())) return choice.toLowerCase();
    return 'q';
  }

  // --- Tap-to-move system ---

  function clearTapSelection() {
    if (selectedSquare) {
      document.querySelector(`.square-${selectedSquare}`)?.classList.remove('sq-selected');
      selectedSquare = null;
    }
    clearLegalDots();
  }

  function clearLegalDots() {
    legalMoveSquares.forEach(sq => {
      const el = document.querySelector(`.square-${sq}`);
      if (el) {
        el.classList.remove('sq-legal-dot', 'sq-legal-capture');
      }
    });
    legalMoveSquares = [];
  }

  function showLegalMoves(square) {
    const moves = game.moves({ square, verbose: true });
    moves.forEach(m => {
      const el = document.querySelector(`.square-${m.to}`);
      if (!el) return;
      // If there's a piece on target = capture ring, else dot
      const isCapture = game.get(m.to) !== null || m.flags.includes('e'); // e = en passant
      el.classList.add(isCapture ? 'sq-legal-capture' : 'sq-legal-dot');
      legalMoveSquares.push(m.to);
    });
  }

  function handleSquareTapAnalysis(square) {
    if (setupMode) { setupSquareTap(square); return; }
    if (game.game_over()) return;

    // If a square is already selected
    if (selectedSquare) {
      // Tapped same square → deselect
      if (square === selectedSquare) {
        clearTapSelection();
        return;
      }

      // Try to make a move
      const piece = game.get(selectedSquare);
      let promotionPiece = undefined;
      if (piece && piece.type === 'p') {
        if ((piece.color === 'w' && square[1] === '8') ||
            (piece.color === 'b' && square[1] === '1')) {
          promotionPiece = getPromotionPiece();
        }
      }

      const move = game.move({ from: selectedSquare, to: square, promotion: promotionPiece });
      if (move !== null) {
        // Valid move!
        if (window.SoundFX) SoundFX.playForMove(game, move);
        clearTapSelection();
        clearHighlights();
        board.position(game.fen());

        const activeNode = _activeNode();
        const isMidHistory = currentMoveIdx < moveHistory.length - 1;

        if (isMidHistory) {
          // ── Branch: create a child variation in the tree ──
          // shared moves = moves up to AND INCLUDING currentMoveIdx (the move we were on)
          // then the new diverging move at position currentMoveIdx+1
          const sharedMoves = moveHistory.slice(0, currentMoveIdx + 1);
          const branchGame = new Chess();
          branchGame.load(startFen);
          const newVerbose = [];
          for (const m of sharedMoves) {
            const r = branchGame.move(m.san);
            if (r) newVerbose.push(r);
          }
          const fullHistory = game.history({ verbose: true });
          const newMove = fullHistory[fullHistory.length - 1];
          if (newMove) newVerbose.push(newMove);

          // Count existing children at this branch point to label nicely
          const existingChildren = activeNode
            ? _childrenOf(activeNode.id).filter(c => c.branchMoveIdx === currentMoveIdx + 1).length
            : 0;
          const parentId = activeNode ? activeNode.id : null;
          const childLabel = `Var ${currentMoveIdx + 1}${existingChildren > 0 ? String.fromCharCode(97 + existingChildren) : ''}`;
          const newNode = _newVarNode(parentId, currentMoveIdx + 1, newVerbose, childLabel);
          varTree.push(newNode);
          activeVarId = newNode.id;

          moveHistory = newVerbose.slice();
          currentMoveIdx = moveHistory.length - 1;
          // Hide board badge for new variation (no review data)
          hideBoardBadge();
        } else {
          // ── Continue on same variation (extend it) ──
          moveHistory = game.history({ verbose: true });
          currentMoveIdx = moveHistory.length - 1;
          if (varTree.length === 0) {
            // No tree yet — create root node
            const root = _newVarNode(null, 0, moveHistory, 'Main Line');
            varTree.push(root);
            activeVarId = root.id;
          } else {
            // Update active node's moves
            const node = _activeNode();
            if (node) node.moves = moveHistory.slice();
          }
        }

        updateFENDisplay();
        updatePGNMoves();
        updateTurnLabel();
        clearArrows();
        // Draw last move arrow (blue)
        setTimeout(() => drawArrow(move.from, move.to, 'last'), 90);
        analyzePosition();
        _updateAnalysisCaptured(game);
        return;
      }

      // Not a valid move — maybe tapped another own piece
      clearTapSelection();
    }

    // Select the tapped square if it has a piece of the current turn's color
    const piece = game.get(square);
    if (!piece) return;
    if (piece.color !== game.turn()) return; // Only current turn's pieces are selectable

    selectedSquare = square;
    document.querySelector(`.square-${square}`)?.classList.add('sq-selected');
    showLegalMoves(square);
  }

  // Wire up tap on board squares (works for both touch and click)
  function attachBoardTapHandlers() {
    document.querySelectorAll('#board .square-55d63').forEach(el => {
      // Prevent duplicate listeners
      if (el.dataset.tapAttached) return;
      el.dataset.tapAttached = '1';
      el.addEventListener('click', function() {
        const sqClass = [...this.classList].find(c => c.startsWith('square-') && c !== 'square-55d63');
        if (!sqClass) return;
        const sq = sqClass.replace('square-', '');
        handleSquareTap(sq);
      });
    });
  }

  // Chessboard.js re-renders the DOM on position change, so re-attach after each update.
  // Function mein wrap kiya hai — applyPieceSet ke board re-init ke baad dobara lagana hota hai.
  function wrapBoardTapHooks() {
    const _origPosition = board.position.bind(board);
    board.position = function(...args) {
      const result = _origPosition(...args);
      setTimeout(attachBoardTapHandlers, 80);
      return result;
    };
    // Also re-attach after flip — override board.flip to re-attach handlers
    const _origFlip = board.flip.bind(board);
    board.flip = function() {
      _origFlip();
      setTimeout(attachBoardTapHandlers, 100);
    };
  }
  wrapBoardTapHooks();

  // Attach initially after board renders
  setTimeout(attachBoardTapHandlers, 200);

  // Keep onDragStart/onDrop/onSnapEnd as stubs (draggable=false so they won't fire, but kept for safety)
  
  function onDragStart(source, piece) {
  if (!setupMode) return false;
  return true;
}

function onDrop(source, target) {
  if (!setupMode) return 'snapback';
  if (source === target) return 'snapback';
  const piece = game.get(source);
  if (!piece) return 'snapback';
  game.remove(source);
  game.put(piece, target);
  board.position(game.fen(), false);
  return 'snap';
}

function onSnapEnd() { }
  
  function flipBoard() {
    board.flip();
    boardFlipped = !boardFlipped;
    setTimeout(attachBoardTapHandlers, 80);

    // Redraw arrows with corrected orientation
    setTimeout(redrawArrows, 110);

    // Reposition board badge after flip
    if (_lastBadgeState) {
      const bs = _lastBadgeState;
      setTimeout(() => showBoardBadge(bs.toSquare, bs.classification, bs.moveData), 150);
    }

    // Re-render player rows using the updated boardFlipped flag.
    // All update functions (_updateAnalysisCaptured, _applyAnalysisClockForIdx,
    // _applyReviewClockForIdx, rvSetupPlayerRows, _restoreAnalysisPlayerRows)
    // are now flip-aware — they read boardFlipped directly, so a single
    // re-render here keeps everything in sync permanently.
    const topRow    = document.getElementById('analysis-top-row');
    const bottomRow = document.getElementById('analysis-bottom-row');
    if (topRow && topRow.classList.contains('show') && bottomRow && bottomRow.classList.contains('show')) {
      if (analysisPlayerInfo) {
        // Analysis tab (Play history loaded)
        _restoreAnalysisPlayerRows();
      } else if (rvState && rvState.moves && rvState.moves.length > 0) {
        // Review tab active
        rvSetupPlayerRows();
        _applyReviewClockForIdx(rvState.currentIdx);
        if (rvState.currentIdx >= 0) {
          _applyReviewCapturedForIdx(rvState.currentIdx);
        } else {
          // Start position — empty board, no captured pieces
          _updateAnalysisCaptured(game);
        }
      } else {
        // Plain analysis tab — just re-render captured from current game
        _updateAnalysisCaptured(game);
      }
    }
  }

  function resetBoard() {
    game.reset();
    board.start();
    startFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    moveHistory = [];
    currentMoveIdx = -1;
    _varIdCounter = 0;
    varTree = [];
    activeVarId = 0;
    clearHighlights();
    clearArrows();
    clearTapSelection();
    updateFENDisplay();
    updatePGNMoves();
    updateTurnLabel();
    document.getElementById('best-move').textContent = '—';
    document.getElementById('best-line').textContent = '';
    analyzePosition();
    analysisPlayerInfo = null;
    // Keep rows visible, reset to default labels, clear captured pieces
    // Labels respect current flip state
    document.getElementById('analysis-label-top').textContent    = boardFlipped ? '♙ White' : '♟ Black';
    document.getElementById('analysis-label-bottom').textContent = boardFlipped ? '♟ Black' : '♙ White';
    document.getElementById('analysis-time-top').style.display    = 'none';
    document.getElementById('analysis-time-bottom').style.display = 'none';
    document.getElementById('analysis-top-row').classList.add('show');
    document.getElementById('analysis-bottom-row').classList.add('show');
    _updateAnalysisCaptured(game);
  }

  const SETUP_PIECES_WHITE = ['wK','wQ','wR','wB','wN','wP'];
  const SETUP_PIECES_BLACK = ['bK','bQ','bR','bB','bN','bP'];
  const PIECE_GLYPH = {
    wK:'♔', wQ:'♕', wR:'♖', wB:'♗', wN:'♘', wP:'♙',
    bK:'♚', bQ:'♛', bR:'♜', bB:'♝', bN:'♞', bP:'♟'
  };

  function buildSetupTrays() {
    const wTray = document.getElementById('setup-tray-white');
    const bTray = document.getElementById('setup-tray-black');
    if (wTray.childElementCount) return; // already built
    SETUP_PIECES_WHITE.forEach(code => wTray.appendChild(makeSetupPieceEl(code)));
    SETUP_PIECES_BLACK.forEach(code => bTray.appendChild(makeSetupPieceEl(code)));
  }

  function makeSetupPieceEl(code) {
    const el = document.createElement('div');
    el.className = 'setup-piece';
    el.id = 'setup-piece-' + code;
    el.textContent = PIECE_GLYPH[code];
    el.onclick = () => setupSelectPiece(code);
    return el;
  }

  function openSetupPosition() {
    buildSetupTrays();
    setupSavedFen = game.fen();
    // Parse castling rights from current FEN
const fenParts = setupSavedFen.split(' ');
const castlingRights = fenParts.length > 2 ? fenParts[2] : 'KQkq';
document.getElementById('castling-wk').checked = castlingRights.includes('K');
document.getElementById('castling-wq').checked = castlingRights.includes('Q');
document.getElementById('castling-bk').checked = castlingRights.includes('k');
document.getElementById('castling-bq').checked = castlingRights.includes('q');
    setupMode = true;
    setupSelectedPiece = 'wP';
    setupTurn = game.turn();

    clearHighlights();
    clearArrows();
    clearTapSelection();

    document.getElementById('setup-panel').classList.add('show');
    refreshSetupSelectionUI();
  }

  function setupSelectPiece(code) {
    setupSelectedPiece = code; // null = eraser
    refreshSetupSelectionUI();
  }

  function refreshSetupSelectionUI() {
    document.querySelectorAll('.setup-piece').forEach(el => el.classList.remove('selected'));
    document.getElementById('setup-eraser-btn').classList.toggle('selected', setupSelectedPiece === null);
    if (setupSelectedPiece) {
      document.getElementById('setup-piece-' + setupSelectedPiece)?.classList.add('selected');
    }
    document.getElementById('setup-turn-w').classList.toggle('selected', setupTurn === 'w');
    document.getElementById('setup-turn-b').classList.toggle('selected', setupTurn === 'b');
  }

  function setupSetTurn(t) {
    setupTurn = t;
    refreshSetupSelectionUI();
  }

  function setupSquareTap(square) {
    if (setupSelectedPiece) {
      game.put({ type: setupSelectedPiece[1].toLowerCase(), color: setupSelectedPiece[0] }, square);
    } else {
      game.remove(square);
    }
    board.position(setupBoardFen(), false);
  }

  // Build a FEN for board display purposes during setup (placement only, fixed rest)
  function setupBoardFen() {
    const placement = game.fen().split(' ')[0];
    return placement + ' w - - 0 1';
  }

  function setupClearBoard() {
    game.clear();
    board.position(setupBoardFen(), false);
    // Clear board → no castling rights
document.getElementById('castling-wk').checked = false;
document.getElementById('castling-wq').checked = false;
document.getElementById('castling-bk').checked = false;
document.getElementById('castling-bq').checked = false;
  }

  function setupStartPosition() {
    game.reset();
    setupTurn = 'w';
    board.position(setupBoardFen(), false);
    // Reset castling rights to full
document.getElementById('castling-wk').checked = true;
document.getElementById('castling-wq').checked = true;
document.getElementById('castling-bk').checked = true;
document.getElementById('castling-bq').checked = true;
    refreshSetupSelectionUI();
  }

  function setupDone() {
    // Re-load current placement with chosen turn and default rights/clocks
    const placement = game.fen().split(' ')[0];
let castling = '';
if (document.getElementById('castling-wk').checked) castling += 'K';
if (document.getElementById('castling-wq').checked) castling += 'Q';
if (document.getElementById('castling-bk').checked) castling += 'k';
if (document.getElementById('castling-bq').checked) castling += 'q';
if (castling === '') castling = '-';
const fen = `${placement} ${setupTurn} ${castling} - 0 1`;

    if (!game.load(fen)) {
      alert('Invalid position — please check the board (e.g. both kings must be present).');
      return;
    }

    setupMode = false;
    document.getElementById('setup-panel').classList.remove('show');

    board.position(game.fen());
    startFen = game.fen();
    moveHistory = [];
    currentMoveIdx = -1;
    _varIdCounter = 0;
    varTree = [_newVarNode(null, 0, [], 'Main Line')];
    activeVarId = varTree[0].id;
    clearHighlights();
    clearArrows();
    clearTapSelection();
    updateFENDisplay();
    updatePGNMoves();
    updateTurnLabel();
    document.getElementById('best-move').textContent = '—';
    document.getElementById('best-line').textContent = '';
    analyzePosition();
    analysisPlayerInfo = null;
    document.getElementById('analysis-top-row').classList.remove('show');
    document.getElementById('analysis-bottom-row').classList.remove('show');
  }

 function setupCancel() {
  setupMode = false;
  document.getElementById('setup-panel').classList.remove('show');
  game.load(setupSavedFen);
  board.position(game.fen());
  clearTapSelection();
 }

  function clearHighlights() {
    highlightedSquares.forEach(sq => {
      document.querySelector(`.square-${sq}`)?.classList.remove('highlight-white', 'highlight-black');
    });
    highlightedSquares = [];
  }

  // Arrow state
  window._arrowBest = null;
  window._arrowLast = null;

  // Suggestion toggle state (default: ON)
  window._suggestionOn = true;

  function toggleSuggestion() {
    window._suggestionOn = !window._suggestionOn;
    // Update analysis tab button (if present)
    const btn = document.getElementById('suggestion-toggle-btn');
    if (btn) {
      if (window._suggestionOn) {
        btn.textContent = '\uD83D\uDCA1 Suggestion: ON';
        btn.style.borderColor = 'var(--accent2)';
        btn.style.color = 'var(--accent2)';
      } else {
        btn.textContent = '\uD83D\uDCA1 Suggestion: OFF';
        btn.style.borderColor = 'var(--border)';
        btn.style.color = 'var(--text3)';
      }
    }
    // Update PGN tab suggestion button
    const pgnBtn = document.getElementById('pgn-suggestion-btn');
    if (pgnBtn) {
      pgnBtn.style.color = window._suggestionOn ? 'var(--accent2)' : 'var(--text3)';
      pgnBtn.style.borderColor = window._suggestionOn ? 'var(--accent2)' : 'var(--border)';
    }
    _refreshSuggestionArrows();
  }

  function _refreshSuggestionArrows() {
    const svg = document.getElementById('arrow-svg');
    [...svg.children].forEach(el => { if (el.tagName !== 'defs') el.remove(); });
    if (window._arrowLast) {
      drawArrowSVG(window._arrowLast.from, window._arrowLast.to, 'ah-last', 'rgba(128,128,128,0.9)');
    }
    if (window._suggestionOn) {
      if (window._arrowBest) {
        drawArrowSVG(window._arrowBest.from, window._arrowBest.to, 'ah-best', 'rgba(97,189,79,0.93)');
      }
    } else {
      _drawBlueArrowIfCardVisible();
    }
  }

  function _drawBlueArrowIfCardVisible() {
    const cardsEl = document.getElementById('pgn-move-cards');
    if (!cardsEl || cardsEl.style.display === 'none') return;
    const mv = (_analysisReviewMoves && currentMoveIdx >= 0 && currentMoveIdx < _analysisReviewMoves.length)
      ? _analysisReviewMoves[currentMoveIdx] : null;
    if (!mv || !mv.best_san || mv.best_san === mv.played_san) return;
    try {
      const rootNode = varTree.length > 0 ? varTree[0] : null;
      const allHistory = rootNode ? rootNode.moves : [];
      const replayGame = new Chess(startFen);
      for (let k = 0; k < currentMoveIdx; k++) replayGame.move(allHistory[k].san);
      const parsed = replayGame.move(mv.best_san);
      if (parsed) {
        drawArrowSVG(parsed.from, parsed.to, 'ah-review', 'rgba(74,158,255,0.90)');
        const svg = document.getElementById('arrow-svg');
        if (svg) { const lines = svg.querySelectorAll('line'); if (lines.length) lines[lines.length-1].id = 'ah-review-line'; }
      }
    } catch(e) {}
  }

  function clearArrows(keepSaved) {
    if (!keepSaved) { window._arrowBest = null; window._arrowLast = null; }
    const svg = document.getElementById('arrow-svg');
    [...svg.children].forEach(el => { if (el.tagName !== 'defs') el.remove(); });
  }

  function squareToCoords(sq, flipped) {
    const file = sq.charCodeAt(0) - 'a'.charCodeAt(0);
    const rank = parseInt(sq[1]) - 1;
    let x, y;
    if (!flipped) {
      x = file + 0.5;
      y = 8 - rank - 0.5;
    } else {
      x = 7 - file + 0.5;
      y = rank + 0.5;
    }
    return { x, y };
  }

  // Thin sharp arrow: center-to-center, no score label
  // ← ← ← BAS YAHAN NUMBER CHANGE KAR → → →
const ARROW_SHIFT_X = -0.065;   // Negative = left, Positive = right (e.g. -0.1 ya 0.15)

function drawArrowSVG(fromSq, toSq, markerId, color) {
    const svg = document.getElementById('arrow-svg');
    const from = squareToCoords(fromSq, boardFlipped);
    const to   = squareToCoords(toSq,   boardFlipped);

    const dx = to.x - from.x, dy = to.y - from.y;
    const len = Math.sqrt(dx*dx + dy*dy);
    const ux = dx/len, uy = dy/len;

    let x1 = from.x;
    let y1 = from.y;
    let x2 = to.x;
    let y2 = to.y;

    // Apply horizontal shift
    x1 += ARROW_SHIFT_X;
    x2 += ARROW_SHIFT_X;

    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', x1); line.setAttribute('y1', y1);
    line.setAttribute('x2', x2); line.setAttribute('y2', y2);
    line.setAttribute('stroke', color);
    line.setAttribute('stroke-width', '0.10');
    line.setAttribute('stroke-opacity', '1');
    line.setAttribute('stroke-linecap', 'round');
    line.setAttribute('marker-end', `url(#${markerId})`);
    svg.appendChild(line);
}

  function drawArrow(fromSq, toSq, type) {
    // type: 'best' | 'last'
    if (type === 'best') {
      window._arrowBest = { from: fromSq, to: toSq };
      drawArrowSVG(fromSq, toSq, 'ah-best', 'rgba(97,189,79,0.93)');
    } else {
      window._arrowLast = { from: fromSq, to: toSq };
      drawArrowSVG(fromSq, toSq, 'ah-last', 'rgba(128,128,128,0.9)');
    }
  }

  function redrawArrows() {
    const svg = document.getElementById('arrow-svg');
    [...svg.children].forEach(el => { if (el.tagName !== 'defs') el.remove(); });
    if (window._arrowLast) drawArrowSVG(window._arrowLast.from, window._arrowLast.to, 'ah-last', 'rgba(128,128,128,0.9)');
    if (window._arrowBest) drawArrowSVG(window._arrowBest.from, window._arrowBest.to, 'ah-best', 'rgba(97,189,79,0.93)');
  }

  function highlightMove(from, to) {
    clearHighlights();
    // Light square highlight for last move
    const fromEl = document.querySelector(`.square-${from}`);
    const toEl = document.querySelector(`.square-${to}`);
    if (fromEl) { fromEl.classList.add('highlight-white'); highlightedSquares.push(from); }
    if (toEl) { toEl.classList.add('highlight-white'); highlightedSquares.push(to); }
  }

  // ── Board move-classification badge (chess.com style) ──────────────
  const BADGE_CLASS_MAP = {
    'Brilliant':  'badge-brilliant',
    'Great Move': 'badge-great',
    'Best':       'badge-best',
    'Excellent':  'badge-excellent',
    'Good':       'badge-good',
    'Inaccuracy': 'badge-inaccuracy',
    'Mistake':    'badge-mistake',
    'Blunder':    'badge-blunder',
    'Mate Blunder': 'badge-blunder',
    'Queen Donation': 'badge-special',
    'Free Gift':  'badge-special',
  };

  // ── Badge settings (persisted to localStorage) ──────────────────
  const BADGE_SIZE_MAP = [
    { fontSize: 8, height: 14, padH: 2 },   // Extra Small
    { fontSize: 10, height: 18, padH: 3 },  // Small
    { fontSize: 12, height: 22, padH: 4 },  // Medium
    { fontSize: 15, height: 26, padH: 5 },  // Large
  ];

  function _loadBadgeSettings() {
    try {
      return JSON.parse(localStorage.getItem('boardBadgeSettings')) || {};
    } catch(e) { return {}; }
  }
  function _saveBadgeSettings(s) {
    try { localStorage.setItem('boardBadgeSettings', JSON.stringify(s)); } catch(e) {}
  }

  // Store current badge move data for explanation panel
  let _badgeMoveData = null;
  // Store badge position state for repositioning on flip
  let _lastBadgeState = null;  // { toSquare, classification, moveData }

  function _genExplanation(cls, bestSan, playedSan, dif) {
    const parts = [];
    if (bestSan && bestSan !== playedSan) {
      parts.push('Better: <b>' + bestSan + '</b>');
    }
    if (dif > 0) {
      parts.push('Lost <b>' + dif + ' cp</b>');
    }
    switch(cls) {
      case 'Blunder':
        parts.push('A very bad move that changes the game outcome significantly.'); break;
      case 'Mistake':
        parts.push('An inaccurate move that worsens the position.'); break;
      case 'Inaccuracy':
        parts.push('A slightly inaccurate move, a better option was available.'); break;
      case 'Best':
        parts.push('The best move in this position.'); break;
      case 'Excellent':
        parts.push('A very strong move, nearly as good as the best.'); break;
      case 'Good':
        parts.push('A solid move maintaining the position.'); break;
      case 'Brilliant':
        parts.push('A brilliant sacrifice or deep tactical shot!'); break;
      case 'Great Move':
        parts.push('A great move, finding a strong resource.'); break;
    }
    return parts.join(' · ');
  }

  function _showExplanationPanel(badge) {
    let panel = document.getElementById('board-badge-panel');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'board-badge-panel';
      badge.parentNode.appendChild(panel);
    }
    const md = _badgeMoveData;
    if (!md) { panel.style.display = 'none'; return; }
    const cls = md.classification || 'Unknown';
    const col = QUALITY_COLORS[cls] || '#aaa';
    const sym = QUALITY_SYMBOLS[cls] || '';
    const bestLine = md.best_line || [];

    let html = '<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px"><span style="color:' + col + ';font-weight:700;font-size:13px">' + sym + ' ' + cls + '</span>';
    if (md.dif > 0) html += '<span style="font-size:10px;color:var(--text3)">-' + md.dif + ' cp</span>';
    html += '</div>';

    if (bestLine.length > 0) {
      html += '<div style="font-size:10px;color:var(--text3);margin-bottom:4px">Better line (tap to preview):</div>';
      html += '<div style="display:flex;flex-wrap:wrap;gap:3px">';
      bestLine.forEach(function(mv, i) {
        html += '<span class="badge-pv-move" data-fen="' + mv.fen + '" style="background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);border-radius:4px;padding:2px 5px;font-size:11px;color:var(--text);cursor:pointer;font-family:\'JetBrains Mono\',monospace;transition:background .1s" onmouseenter="this.style.background=\'rgba(255,255,255,0.18)\'" onmouseleave="this.style.background=\'rgba(255,255,255,0.08)\'">' + mv.san + '</span>';
      });
      html += '</div>';
    } else if (md.best_san && md.best_san !== md.played_san) {
      html += '<div style="font-size:11px;color:var(--text2)">Better: <b style="color:var(--accent2)">' + md.best_san + '</b></div>';
    }

    panel.innerHTML = html;
    panel.style.display = 'block';

    // Attach click handlers to PV moves
    panel.querySelectorAll('.badge-pv-move').forEach(function(el) {
      el.addEventListener('click', function(e) {
        e.stopPropagation();
        const fen = this.dataset.fen;
        if (fen && typeof board !== 'undefined') {
          board.position(fen, true);
          hideBoardBadge();
        }
      });
    });
  }

  function _hideExplanationPanel() {
    const panel = document.getElementById('board-badge-panel');
    if (panel) panel.style.display = 'none';
  }

  function showBoardBadge(toSquare, classification, moveData) {
    const badge = document.getElementById('board-badge');
    if (!badge) return;
    if (!toSquare || !classification) { badge.style.display = 'none'; _hideExplanationPanel(); return; }
    const sym = QUALITY_SYMBOLS[classification] || '';
    if (!sym) { badge.style.display = 'none'; _hideExplanationPanel(); return; }

    // Store move data for explanation + state for flip repositioning
    _badgeMoveData = moveData || null;
    _lastBadgeState = { toSquare, classification, moveData };
    _hideExplanationPanel();

    try {
      const sqEl = document.querySelector('#board .square-' + toSquare);
      if (!sqEl) { badge.style.display = 'none'; return; }
      const boardEl = document.getElementById('board');
      if (!boardEl) { badge.style.display = 'none'; return; }
      const boardRect = boardEl.getBoundingClientRect();
      const sqRect = sqEl.getBoundingClientRect();
      const relX = sqRect.left - boardRect.left;
      const relY = sqRect.top - boardRect.top;
      const sqW = sqRect.width;
      const sqH = sqRect.height;

      // Read user settings
      const cfg = _loadBadgeSettings();
      const pos = cfg.position || 'top-right';
      const sizeIdx = cfg.size != null ? cfg.size : 2;
      const margin = cfg.margin != null ? cfg.margin : 2;
      const sz = BADGE_SIZE_MAP[sizeIdx] || BADGE_SIZE_MAP[1];

      // Apply size via inline style
      badge.textContent = sym;
      badge.className = BADGE_CLASS_MAP[classification] || 'badge-good';
      badge.style.display = 'block';
      badge.style.fontSize = sz.fontSize + 'px';
      badge.style.height = sz.height + 'px';
      badge.style.lineHeight = sz.height + 'px';
      badge.style.paddingLeft = sz.padH + 'px';
      badge.style.paddingRight = sz.padH + 'px';
      badge.style.minWidth = '0';
      badge.style.cursor = 'default';

      // Calculate position based on user setting
      badge.style.left = '-999px';
      badge.style.top = '0px';
      badge.style.right = 'auto';
      badge.style.bottom = 'auto';

      requestAnimationFrame(() => {
        const badgeW = badge.offsetWidth;
        const badgeH = badge.offsetHeight;
        let left, top;

        switch(pos) {
          case 'top-left':
            left = relX + margin;
            top = relY + margin;
            break;
          case 'top-right':
            left = relX + sqW - badgeW - margin;
            top = relY + margin;
            break;
          case 'bottom-left':
            left = relX + margin;
            top = relY + sqH - badgeH - margin;
            break;
          case 'bottom-right':
          default:
            left = relX + sqW - badgeW - margin;
            top = relY + sqH - badgeH - margin;
            break;
        }
        badge.style.left = left + 'px';
        badge.style.top = top + 'px';
      });
    } catch(e) {
      badge.style.display = 'none';
    }
  }

  function hideBoardBadge() {
    const badge = document.getElementById('board-badge');
    if (badge) badge.style.display = 'none';
    _lastBadgeState = null;
    _hideExplanationPanel();
  }

  // Badge is display-only — no click handler. Explanation shown on PGN move tokens.

  // Global: show move explanation in a given container element
  function showMoveExplanation(container, moveData) {
    if (!container || !moveData) { if (container) container.style.display = 'none'; return; }
    const cls = moveData.classification || 'Unknown';
    const col = QUALITY_COLORS[cls] || '#aaa';
    const sym = QUALITY_SYMBOLS[cls] || '';
    const bestLine = moveData.best_line || [];

    let html = '<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px"><span style="color:' + col + ';font-weight:700;font-size:13px">' + sym + ' ' + cls + '</span>';
    if (moveData.dif > 0) html += '<span style="font-size:10px;color:var(--text3)">-' + moveData.dif + ' cp</span>';
    html += '</div>';

    if (bestLine.length > 0) {
      html += '<div style="font-size:10px;color:var(--text3);margin-bottom:4px">Better line (tap to preview):</div>';
      html += '<div style="display:flex;flex-wrap:wrap;gap:3px">';
      bestLine.forEach(function(mv) {
        html += '<span class="pv-move-token" data-fen="' + mv.fen + '" style="background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);border-radius:4px;padding:2px 5px;font-size:11px;color:var(--text);cursor:pointer;font-family:\'JetBrains Mono\',monospace;transition:background .1s" onmouseenter="this.style.background=\'rgba(255,255,255,0.18)\'" onmouseleave="this.style.background=\'rgba(255,255,255,0.08)\'">' + mv.san + '</span>';
      });
      html += '</div>';
    } else if (moveData.best_san && moveData.best_san !== moveData.played_san) {
      html += '<div style="font-size:11px;color:var(--text2)">Better: <b style="color:var(--accent2)">' + moveData.best_san + '</b></div>';
    }

    container.innerHTML = html;
    container.style.display = 'block';

    // Attach click handlers to PV moves — board position update
    container.querySelectorAll('.pv-move-token').forEach(function(el) {
      el.addEventListener('click', function(e) {
        e.stopPropagation();
        const fen = this.dataset.fen;
        if (fen && typeof board !== 'undefined') {
          board.position(fen, true);
        }
      });
    });
  }

  // Analysis
