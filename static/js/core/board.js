// ============================================================
// board.js — Global state, board init, tap system, arrows,
//             eval bar, variation tree, FEN/PGN load helpers
// ============================================================

  const FLASK_URL = 'http://localhost:5050';

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
    pieceTheme: 'img/chesspieces/wikipedia/{piece}.png',
    moveSpeed: 'fast',
    snapbackSpeed: 300,
    snapSpeed: 80
  });


  
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

  // Chessboard.js re-renders the DOM on position change, so re-attach after each update
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
    const btn = document.getElementById('suggestion-toggle-btn');
    if (window._suggestionOn) {
      btn.textContent = '💡 Suggestion: ON';
      btn.style.borderColor = 'var(--accent2)';
      btn.style.color = 'var(--accent2)';
    } else {
      btn.textContent = '💡 Suggestion: OFF';
      btn.style.borderColor = 'var(--border)';
      btn.style.color = 'var(--text3)';
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

  // Analysis
