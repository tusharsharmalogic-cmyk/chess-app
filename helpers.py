"""
helpers.py — Pure utility functions (no Flask)
Phase detection, ELO calc, tactical/strategic detection, move classification, Lucas Chess functions
"""

import math
import os
import json
import chess
import chess.polyglot

BASE_DIR = "/sdcard/C"

# ── Safe JSON persistence (atomic write + corrupt-file backup) ──────────────

def load_json_file(path):
    """
    Load a JSON file safely.
    Returns None if file missing or unreadable.
    If the file is corrupted (partial write, app kill mid-save), it is moved
    to <path>.corrupt as a backup instead of being silently destroyed.
    """
    if not os.path.exists(path):
        return None
    try:
        with open(path, "r") as f:
            return json.load(f)
    except Exception:
        try:
            backup = path + ".corrupt"
            os.replace(path, backup)
            print(f"[json] Corrupt file backed up: {path} -> {backup}")
        except Exception:
            pass
        return None


def save_json_file(path, data):
    """
    Atomic JSON write: write to a temp file first, fsync, then os.replace().
    Ensures the target file is never left half-written even if the app is
    killed mid-save (common on Termux/Android).
    """
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(data, f, indent=2)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


# ── Lucas Chess material weights ─────────────────────────────────────────────

LUCAS_PIECE_WEIGHTS = {
    chess.PAWN:   100,
    chess.KNIGHT: 325,
    chess.BISHOP: 325,
    chess.ROOK:   500,
    chess.QUEEN:  975,
    chess.KING:   0,
}

OPENING_BOOK_PATH = os.path.join(BASE_DIR, "book.bin")
OPENING_MOVE_LIMIT = 18

_opening_book = None
_opening_book_checked = False


def get_opening_book():
    global _opening_book, _opening_book_checked
    if _opening_book is not None:
        return _opening_book
    if _opening_book_checked:
        return None
    _opening_book_checked = True
    if os.path.exists(OPENING_BOOK_PATH):
        try:
            _opening_book = chess.polyglot.open_reader(OPENING_BOOK_PATH)
            print(f"[opening book] Loaded successfully: {OPENING_BOOK_PATH}")
        except Exception as e:
            _opening_book = None
            print(f"[opening book] Failed to load {OPENING_BOOK_PATH}: {e}")
    else:
        print(f"[opening book] File not found at {OPENING_BOOK_PATH} — using move-count fallback")
    return _opening_book


def position_in_book(board):
    """
    Raw Polyglot book lookup — used ONLY by /play/check-opening for the
    one-time decision when a game is started from a loaded PGN/FEN.
    Starting position always counts as opening even if book.bin is missing.
    """
    if board.fullmove_number <= 1 and board.fen() == chess.Board().fen():
        return True
    book = get_opening_book()
    if book is None:
        return False
    try:
        return book.get(board) is not None
    except Exception:
        return False


def is_opening_phase(move_num, opening_locked):
    """
    - Fresh game (opening_locked not explicitly False) → opening while move_num <= OPENING_MOVE_LIMIT.
    - PGN-loaded game → opening_locked was decided ONCE at load time via /play/check-opening.
      If that was False, opening phase never triggers for this game.
    """
    if opening_locked is False:
        return False
    return move_num <= OPENING_MOVE_LIMIT


def is_endgame_phase(board):
    """
    Lucas Chess exact logic:
      - Syzygy rule: total pieces <= 6  → absolute endgame
      - Weight rule: total material < 1500 points → endgame
    """
    pieces = board.piece_map()
    if len(pieces) <= 6:
        return True
    total_weight = sum(
        LUCAS_PIECE_WEIGHTS.get(p.piece_type, 0)
        for p in pieces.values()
    )
    return total_weight < 1500


def detect_game_phase(board, move_num=1, opening_locked=None):
    """
    Opening    → move_num <= 18 AND not excluded by opening_locked
    Endgame    → material < 1500 OR pieces <= 6
    Middlegame → fallback
    """
    if is_opening_phase(move_num, opening_locked):
        return 'opening'
    if is_endgame_phase(board):
        return 'endgame'
    return 'middlegame'


# ── ELO helpers ──────────────────────────────────────────────────────────────

def elo_k_factor(games_played):
    if games_played < 30:
        return 40
    return 20


def calc_elo_change(player_elo, opp_elo, score, games_played=0):
    """
    Standard ELO formula.
    score: 1 for win, 0.5 for draw, 0 for loss (from player's perspective).
    Returns (new_player_elo, delta).
    """
    k = elo_k_factor(games_played)
    expected = 1.0 / (1.0 + math.pow(10, (opp_elo - player_elo) / 400.0))
    delta = k * (score - expected)
    delta_rounded = int(round(delta))
    if delta_rounded == 0 and delta != 0:
        delta_rounded = 1 if delta > 0 else -1
    new_elo = player_elo + delta_rounded
    return new_elo, delta_rounded


# ── Review / Lucas Chess analysis helpers ────────────────────────────────────

def lucas_lv(cp):
    """Lichess win% formula: centipawns → win% (0-100)"""
    return 50.0 + 50.0 * (2.0 / (1.0 + math.exp(-0.00368208 * cp)) - 1.0)


def lucas_lv_dif(cp_best, cp_played):
    return lucas_lv(cp_best) - lucas_lv(cp_played)


def lucas_classify(dif):
    """Lucas Chess thresholds from Configuration.py defaults"""
    if dif >= 15.5:  return "Blunder",    "??"
    if dif >= 7.5:   return "Mistake",    "?"
    if dif >= 3.3:   return "Inaccuracy", "?!"
    return "Good", ""


def move_accuracy_from_dif(dif):
    """Per-move accuracy (0-100) using chess.com-style formula."""
    acc = 103.1668 * math.exp(-0.04354 * dif) - 3.1668
    return max(0.0, min(100.0, acc))


def game_accuracy_from_move_accs(move_accs):
    """
    Aggregate per-move accuracies → game accuracy.
    RMS-of-errors method: punishes blunders harder than simple average.
    game_acc = 100 - sqrt(mean((100 - acc_i)^2))
    """
    if not move_accs:
        return 0.0
    mse = sum((100 - a) ** 2 for a in move_accs) / len(move_accs)
    return round(max(0.0, min(100.0, 100 - math.sqrt(mse))), 1)


def game_elo_from_accuracy(accuracy_pct):
    """
    Piecewise-linear Elo estimate from game accuracy.
    Same formula used everywhere so accuracy and Elo always agree.
    """
    anchors = [
        (0,   300),
        (40,  600),
        (60,  1000),
        (70,  1200),
        (80,  1500),
        (85,  1800),
        (90,  2100),
        (95,  2400),
        (98,  2700),
        (100, 3000),
    ]
    acc = max(0.0, min(100.0, accuracy_pct))
    for (a_lo, e_lo), (a_hi, e_hi) in zip(anchors, anchors[1:]):
        if a_lo <= acc <= a_hi:
            t = (acc - a_lo) / (a_hi - a_lo) if a_hi > a_lo else 0
            return int(round(e_lo + t * (e_hi - e_lo)))
    return 3000 if acc >= 100 else 300


def cp_from_info(info, board_is_white_turn):
    """Get centipawns from engine info, from the perspective of the side to move."""
    score_obj = info.get("score")
    if score_obj is None:
        return 0
    w = score_obj.white()
    if w.is_mate():
        raw = 30000 if w.mate() > 0 else -30000
    else:
        raw = w.score() or 0
    return raw if board_is_white_turn else -raw


# ── Move analysis helpers ────────────────────────────────────────────────────

def eval_to_cp(score_obj):
    w = score_obj.white()
    if w.is_mate():
        return 10000 if w.mate() > 0 else -10000
    return w.score()


def win_prob_white(cp):
    return 1.0 / (1.0 + 10.0 ** (-cp / 400.0))


def get_material(board):
    vals = {chess.PAWN: 1, chess.KNIGHT: 3, chess.BISHOP: 3,
            chess.ROOK: 5, chess.QUEEN: 9, chess.KING: 0}
    return sum(vals.get(p.piece_type, 0) for p in board.piece_map().values())


def analyse_multipv(engine, board, depth, num_pv=5):
    try:
        results = engine.analyse(board, chess.engine.Limit(depth=depth), multipv=num_pv)
    except Exception:
        return []

    lines = []
    for info in (results if isinstance(results, list) else [results]):
        score_obj = info.get("score")
        pv        = info.get("pv", [])
        if score_obj and pv:
            cp      = eval_to_cp(score_obj)
            is_mate = score_obj.white().is_mate()
            lines.append({
                "cp":      cp,
                "is_mate": is_mate,
                "move":    pv[0],
                "pv":      [str(m) for m in pv[:6]],
            })
    return lines


def difficulty_score(lines):
    if len(lines) < 3:
        return "easy", 0.0
    diff = abs(lines[0]["cp"] - lines[2]["cp"])
    if diff < 30:    label = "easy"
    elif diff < 100: label = "moderate"
    elif diff < 250: label = "hard"
    else:            label = "critical"
    return label, diff


# ── Tactical / Strategic detection ──────────────────────────────────────────

_PIECE_VAL = {chess.KING: 100, chess.QUEEN: 9, chess.ROOK: 5,
              chess.BISHOP: 3, chess.KNIGHT: 3, chess.PAWN: 1}


def detect_tactical_motifs(board_before, move, board_after):
    motifs      = []
    piece_moved = board_before.piece_at(move.from_square)
    if piece_moved is None:
        return motifs

    if board_after.is_checkmate():
        return ["Checkmate"]

    if board_after.is_check():
        motifs.append("Check")

    captured = board_before.piece_at(move.to_square)
    if captured:
        mv = _PIECE_VAL.get(piece_moved.piece_type, 0)
        cv = _PIECE_VAL.get(captured.piece_type, 0)
        if cv > mv:
            motifs.append("Winning Capture")
        elif cv == mv:
            motifs.append("Equal Trade")
        else:
            motifs.append("Sacrifice")

    if move.promotion:
        motifs.append("Promotion")

    tmp = board_before.copy()
    tmp.push(move)
    for sq in chess.SQUARES:
        p = tmp.piece_at(sq)
        if p and p.color == board_before.turn:
            attackers = tmp.attackers(not board_before.turn, sq)
            defenders = tmp.attackers(board_before.turn, sq)
            if attackers and len(defenders) == 0:
                motifs.append("Hanging Piece")
                break

    if not motifs and board_after.is_check():
        motifs.append("Check")

    return list(dict.fromkeys(motifs))


def detect_strategic_tags(board_before, move, board_after, best_cp, played_cp, side):
    tags = []
    piece = board_before.piece_at(move.from_square)
    if not piece:
        return tags

    if piece.piece_type == chess.PAWN:
        file_idx = chess.square_file(move.to_square)
        pawns_same_file = sum(
            1 for sq in chess.SQUARES
            if board_after.piece_at(sq) == chess.Piece(chess.PAWN, piece.color)
            and chess.square_file(sq) == file_idx
        )
        if pawns_same_file > 1:
            tags.append("Doubled Pawns")

        center = [chess.D4, chess.D5, chess.E4, chess.E5]
        if move.to_square in center:
            tags.append("Center Control")

    if piece.piece_type == chess.KING:
        if abs(chess.square_file(move.from_square) - chess.square_file(move.to_square)) == 2:
            tags.append("Castling")

    cp_gain = played_cp - best_cp if side == chess.WHITE else best_cp - played_cp
    if cp_gain >= 150:
        tags.append("Positional Gain")

    return tags


def classify_quality(cp_loss, wp_drop, rank, diff_label, is_sacrifice,
                     move, board_before, board_after, lines_before):
    ep_loss = wp_drop

    if ep_loss < 0 and rank == 0 and is_sacrifice:
        return "Brilliant", "Brilliant", True

    if ep_loss < 0 and rank == 0:
        return "Best", "Best", False

    if rank == 0 and ep_loss == 0:
        return "Best", "Best", False

    if rank <= 1 and ep_loss < 0.02 and is_sacrifice:
        return "Great Move", "Great Move", True

    is_capture = board_before.piece_at(move.to_square) is not None
    piece = board_before.piece_at(move.from_square)

    if ep_loss >= 0.20:
        allows_mate = False
        for m in list(board_after.copy().legal_moves)[:5]:
            tmp = board_after.copy()
            tmp.push(m)
            if tmp.is_checkmate():
                allows_mate = True
                break
        if allows_mate:
            return "Mate Blunder", "Mate Blunder", False
        if piece and piece.piece_type == chess.QUEEN and not is_capture:
            return "Queen Donation", "Queen Donation", False
        if piece and not is_capture and cp_loss > 300:
            return "Free Gift", "Free Gift", False
        return "Blunder", "Blunder", False

    if ep_loss >= 0.10:
        return "Mistake", "Mistake", False
    if ep_loss >= 0.05:
        return "Inaccuracy", "Inaccuracy", False
    if ep_loss >= 0.02:
        return "Good", "Good", False
    if rank == 0:
        return "Best", "Best", False
    return "Excellent", "Excellent", False


def generate_explanation(cp_loss, tactical, strategic, board_before, board_after,
                         move, best_move, best_san, side, lines_before):
    parts = []
    best_idea = None

    if tactical:
        parts.append(f"Tactical: {', '.join(tactical[:2])}.")

    if strategic:
        parts.append(f"Strategic: {', '.join(strategic[:2])}.")

    if cp_loss > 50 and best_move != move:
        best_idea = f"Better was {best_san}."
        parts.append(best_idea)

    if board_after.is_check():
        parts.append("Puts the king in check.")

    if not parts:
        parts.append("Solid move maintaining the position.")

    return " ".join(parts), best_idea


def analyse_move(engine, board_before, move, depth):
    side = board_before.turn

    lines_before = analyse_multipv(engine, board_before, depth, num_pv=5)
    if not lines_before:
        raise RuntimeError("Engine analysis failed for position before move")

    best_cp    = lines_before[0]["cp"]
    best_move  = lines_before[0]["move"]
    rank       = next((i for i, l in enumerate(lines_before) if l["move"] == move),
                      len(lines_before))
    diff_label, _ = difficulty_score(lines_before)

    played_line = next((l for l in lines_before if l["move"] == move), None)
    if played_line is not None:
        played_cp = played_line["cp"]
    else:
        board_tmp = board_before.copy()
        board_tmp.push(move)
        lines_played = analyse_multipv(engine, board_tmp, depth, num_pv=1)
        played_cp = lines_played[0]["cp"] if lines_played else best_cp

    cp_loss = best_cp - played_cp

    if side == chess.WHITE:
        wp_before = win_prob_white(best_cp)
        wp_after  = win_prob_white(played_cp)
    else:
        wp_before = 1.0 - win_prob_white(best_cp)
        wp_after  = 1.0 - win_prob_white(played_cp)
    wp_drop = wp_before - wp_after

    board_after  = board_before.copy()
    board_after.push(move)

    mat_before   = get_material(board_before)
    mat_after    = get_material(board_after)
    is_capture   = board_before.piece_at(move.to_square) is not None
    is_sacrifice = (mat_after < mat_before - 1) and not is_capture

    tactical  = detect_tactical_motifs(board_before, move, board_after)
    strategic = detect_strategic_tags(board_before, move, board_after,
                                      best_cp, played_cp, side)

    quality_label, quality_key, is_special = classify_quality(
        cp_loss, wp_drop, rank, diff_label, is_sacrifice,
        move, board_before, board_after, lines_before
    )

    temp = board_before.copy()
    try:
        best_san = temp.san(best_move)
    except Exception:
        best_san = str(best_move)

    explanation, best_idea = generate_explanation(
        cp_loss, tactical, strategic,
        board_before, board_after,
        move, best_move, best_san, side, lines_before
    )

    EMOJIS = {
        "Brilliant":        "!!",
        "Great Move":       "!",
        "Best":             "✓",
        "Excellent":        "★",
        "Good":             "✦",
        "Inaccuracy":       "?!",
        "Mistake":          "?",
        "Blunder":          "??",
        "Checkmate":        "#",
        "Missed Win":       "⊘",
        "Mate Blunder":     "✗",
        "Queen Donation":   "✗",
        "Free Gift":        "✗",
    }
    emoji = EMOJIS.get(quality_label, "?")

    return {
        "quality":      quality_label,
        "emoji":        emoji,
        "is_special":   is_special,
        "cp_loss":      round(cp_loss),
        "cp_before":    round(best_cp),
        "cp_after":     round(played_cp),
        "wp_before":    round(wp_before * 100, 1),
        "wp_after":     round(wp_after  * 100, 1),
        "wp_drop":      round(wp_drop   * 100, 1),
        "rank":         rank + 1,
        "difficulty":   diff_label,
        "is_sacrifice": is_sacrifice,
        "best_move":    str(best_move),
        "best_san":     best_san,
        "tactical":     tactical,
        "strategic":    strategic,
        "explanation":  explanation,
        "best_idea":    best_idea,
    }
