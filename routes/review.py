"""
routes/review.py — /review/* routes
Review analyze (SSE stream), review history CRUD
"""

import os
import json
import uuid
import time
import math
import io
import re

import chess
import chess.engine
import chess.pgn
from flask import Blueprint, request, jsonify, Response, stream_with_context

from helpers import (
    lucas_lv_dif, lucas_classify, move_accuracy_from_dif,
    game_accuracy_from_move_accs, game_elo_from_accuracy, cp_from_info,
    load_json_file, save_json_file,
)

review_bp = Blueprint("review", __name__)

BASE_DIR = "/sdcard/C"
DATA_DIR = os.path.join(BASE_DIR, "play_data")
REVIEW_HISTORY_FILE = os.path.join(DATA_DIR, "review_history.json")
RVH_MAX_ENTRIES = 100


# ── Persistence ───────────────────────────────────────────────────────────────

def load_review_history():
    data = load_json_file(REVIEW_HISTORY_FILE)
    return data if isinstance(data, list) else []


def save_review_history(history):
    save_json_file(REVIEW_HISTORY_FILE, history)


# ==========================================================================
#  REVIEW HISTORY CRUD
# ==========================================================================

@review_bp.route("/review/history", methods=["GET"])
def get_review_history():
    history = load_review_history()
    ordered = sorted(history, key=lambda g: g.get("saved_at", 0), reverse=True)
    return jsonify({"games": ordered, "total": len(ordered)})


@review_bp.route("/review/history", methods=["POST"])
def add_review_history():
    data = request.get_json()
    if not data:
        return jsonify({"error": "No review data provided"}), 400

    entry = {
        "id":            "rvh_" + str(uuid.uuid4())[:8],
        "saved_at":       data.get("saved_at") or int(time.time()),
        "white_name":     data.get("white_name", "White"),
        "black_name":     data.get("black_name", "Black"),
        "white_acc":      data.get("white_acc"),
        "black_acc":      data.get("black_acc"),
        "white_elo":      data.get("white_elo"),
        "black_elo":      data.get("black_elo"),
        "white_counts":   data.get("white_counts", {}),
        "black_counts":   data.get("black_counts", {}),
        "move_count":     data.get("move_count", 0),
        "pgn":            data.get("pgn", ""),
        "moves":          data.get("moves", []),
        "summary":        data.get("summary", {}),
        "clockTimeline":  data.get("clockTimeline"),
    }

    history = load_review_history()
    # Avoid back-to-back duplicate saves — but preserve original saved_at & id
    existing = next((g for g in history
                      if g.get("pgn") == entry["pgn"] and g.get("move_count") == entry["move_count"]), None)
    if existing:
        entry["saved_at"] = existing.get("saved_at", entry["saved_at"])
        entry["id"]       = existing.get("id", entry["id"])
    history = [g for g in history
               if not (g.get("pgn") == entry["pgn"] and g.get("move_count") == entry["move_count"])]

    history.insert(0, entry)
    if len(history) > RVH_MAX_ENTRIES:
        history = history[:RVH_MAX_ENTRIES]
    save_review_history(history)
    return jsonify({"ok": True, "game": entry})


@review_bp.route("/review/history/<rvh_id>", methods=["DELETE"])
def delete_review_history_game(rvh_id):
    history = load_review_history()
    new_history = [g for g in history if g.get("id") != rvh_id]
    if len(new_history) == len(history):
        return jsonify({"error": "Review not found"}), 404
    save_review_history(new_history)
    return jsonify({"ok": True})


@review_bp.route("/review/history", methods=["DELETE"])
def clear_review_history():
    save_review_history([])
    return jsonify({"ok": True})


# ==========================================================================
#  REVIEW ANALYZE — SSE stream
# ==========================================================================

@review_bp.route("/review/analyze", methods=["POST"])
def review_analyze():
    data       = request.get_json()
    pgn        = data.get("pgn", "").strip()
    depth      = min(int(data.get("depth", 12)), 20)
    think_time = float(data.get("think_time", 2.0))   # seconds — jo pehle ho
    think_time = max(0.5, min(think_time, 10.0))       # clamp 0.5s – 10s
    white_name = data.get("white_name", "White")
    black_name = data.get("black_name", "Black")

    if not pgn:
        return jsonify({"error": "PGN required"}), 400

    from c import get_engine
    engine, err = get_engine()
    if engine is None:
        return jsonify({"error": f"Engine unavailable: {err}"}), 500

    try:
        game = chess.pgn.read_game(io.StringIO(pgn))
        if game is None:
            return jsonify({"error": "Invalid PGN"}), 400
    except Exception as e:
        return jsonify({"error": f"PGN parse error: {e}"}), 400

    def clean_pgn_name(raw, fallback):
        return raw.strip() if raw and raw.strip() and raw.strip() != '?' else fallback

    if white_name == "White":
        white_name = clean_pgn_name(game.headers.get("White", ""), "White")
    if black_name == "Black":
        black_name = clean_pgn_name(game.headers.get("Black", ""), "Black")

    board  = game.board()
    moves  = list(game.mainline_moves())
    total  = len(moves)

    EMOJIS = {
        "Brilliant": "!!", "Best": "✓", "Excellent": "★",
        "Good": "✦", "Inaccuracy": "?!", "Mistake": "?", "Blunder": "??",
    }

    def generate():
        results       = []
        accuracy_list = {True: [], False: []}
        counts        = {
            True:  {"Brilliant":0,"Best":0,"Excellent":0,"Good":0,"Inaccuracy":0,"Mistake":0,"Blunder":0},
            False: {"Brilliant":0,"Best":0,"Excellent":0,"Good":0,"Inaccuracy":0,"Mistake":0,"Blunder":0},
        }

        for idx, move in enumerate(moves):
            is_white = board.turn

            try:
                # Jo pehle complete ho — depth ya think_time — engine ruk jaata hai
                pre_limit = chess.engine.Limit(depth=depth, time=think_time)
                pre_results = engine.analyse(board, pre_limit, multipv=3)
                pre_list = pre_results if isinstance(pre_results, list) else [pre_results]

                cp_best_stm = cp_from_info(pre_list[0], is_white)

                played_in_pv = None
                for info in pre_list:
                    pv = info.get("pv", [])
                    if pv and pv[0] == move:
                        played_in_pv = info
                        break

                if played_in_pv is not None:
                    cp_played_stm = cp_from_info(played_in_pv, is_white)
                else:
                    # Post-analysis: thoda kam time do (move top-3 mein nahi tha)
                    post_limit = chess.engine.Limit(depth=depth, time=think_time * 0.6)
                    board_copy = board.copy()
                    board_copy.push(move)
                    post_results = engine.analyse(board_copy, post_limit, multipv=1)
                    post_info    = (post_results[0] if isinstance(post_results, list) else post_results)
                    cp_played_stm = -cp_from_info(post_info, not is_white)

                dif = max(0, lucas_lv_dif(cp_best_stm, cp_played_stm))
                classification, symbol = lucas_classify(dif)

                if dif == 0:
                    classification, symbol = "Best", "✓"
                elif dif < 1.0 and classification == "Good":
                    classification, symbol = "Excellent", "★"

                best_move_obj = pre_list[0].get("pv", [None])[0]
                try:
                    best_san = board.san(best_move_obj) if best_move_obj else "?"
                except Exception:
                    best_san = str(best_move_obj) if best_move_obj else "?"

                # Extract best line PV (up to 6 moves)
                pv_moves = pre_list[0].get("pv", [])[:6]
                best_line = []
                pv_board = board.copy()
                for pv_move in pv_moves:
                    try:
                        pv_san = pv_board.san(pv_move)
                        pv_board.push(pv_move)
                        pv_fen = pv_board.fen()
                        best_line.append({"san": pv_san, "fen": pv_fen})
                    except Exception:
                        break

                try:
                    played_san = board.san(move)
                except Exception:
                    played_san = str(move)

                fen_before = board.fen()
                board.push(move)
                fen_after = board.fen()

                accuracy = move_accuracy_from_dif(dif)
                accuracy_list[is_white].append(accuracy)

                cat = classification if classification in counts[is_white] else "Good"
                counts[is_white][cat] = counts[is_white].get(cat, 0) + 1

                eval_after_white = round(cp_played_stm if is_white else -cp_played_stm)

                results.append({
                    "move_num":       (idx // 2) + 1,
                    "is_white":       is_white,
                    "played_san":     played_san,
                    "played_uci":     move.uci(),
                    "best_san":       best_san,
                    "best_uci":       str(best_move_obj) if best_move_obj else "",
                    "classification": classification,
                    "symbol":         EMOJIS.get(classification, ""),
                    "dif":            round(dif, 2),
                    "cp_best":        round(cp_best_stm),
                    "cp_played":      round(cp_played_stm),
                    "eval_after":     eval_after_white,
                    "accuracy":       round(accuracy, 1),
                    "fen_before":     fen_before,
                    "fen_after":      fen_after,
                    "best_line":      best_line,
                })

            except Exception as e:
                try:
                    board.push(move)
                except Exception:
                    pass
                results.append({
                    "move_num":       (idx // 2) + 1,
                    "is_white":       is_white,
                    "played_san":     str(move),
                    "classification": "Unknown",
                    "symbol":         "",
                    "error":          str(e),
                    "fen_before":     board.fen(),
                    "fen_after":      board.fen(),
                })

            yield f"data: {json.dumps({'type': 'progress', 'done': idx + 1, 'total': total})}\n\n"

        white_accuracy = game_accuracy_from_move_accs(accuracy_list[True])
        black_accuracy = game_accuracy_from_move_accs(accuracy_list[False])

        summary = {
            "white": {
                "name":     white_name,
                "accuracy": white_accuracy,
                "elo":      game_elo_from_accuracy(white_accuracy),
                "counts":   counts[True],
            },
            "black": {
                "name":     black_name,
                "accuracy": black_accuracy,
                "elo":      game_elo_from_accuracy(black_accuracy),
                "counts":   counts[False],
            },
            "total_moves": total,
            "depth_used":  depth,
        }

        yield f"data: {json.dumps({'type': 'done', 'summary': summary, 'moves': results})}\n\n"

    return Response(
        stream_with_context(generate()),
        mimetype="text/event-stream",
        headers={
            "Cache-Control":    "no-cache",
            "X-Accel-Buffering": "no",
        }
    )


# ==========================================================================
#  OPENING BOOK — loaded from openings.json (22k+ openings)
# ============================================================================

_OPENINGS_JSON = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "openings.json",
)


def _load_openings_book():
    """Load openings.json and build a SAN-based lookup dict.

    Each PGN entry like '1. e4 e5 2. Nf3 Nc6 3. Bb5' is stripped to
    'e4 e5 Nf3 Nc6 Bb5' and used as the lookup key.
    Falls back to a small built-in book when the JSON file is missing.
    """
    book = {}

    # ── Try openings.json first ────────────────────────────────────
    try:
        with open(_OPENINGS_JSON, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        for entry in data:
            pgn = (entry.get("pgn") or "").strip()
            if not pgn:
                continue
            # Strip move numbers:  "1. e4 e5 2. Nf3" → "e4 e5 Nf3"
            san = re.sub(r"\d+\.\s*", "", pgn).strip()
            san = re.sub(r"\s+", " ", san)  # normalise whitespace
            if san:
                book[san] = {
                    "name": entry.get("name", ""),
                    "eco": entry.get("eco", ""),
                }
        if book:
            return book
    except Exception:
        pass

    # ── Fallback: hardcoded essentials ─────────────────────────────
    fallback = {
        "e4": "King\u2019s Pawn Opening", "e4 e5": "King\u2019s Pawn Game",
        "e4 e5 Nf3 Nc6 Bb5": "Ruy Lopez", "e4 e5 Nf3 Nc6 Bb5 a6": "Ruy Lopez, Morphy Defence",
        "e4 e5 Nf3 Nc6 Bc4": "Italian Game",
        "e4 e5 Nf3 Nc6 Bc4 Bc5": "Italian Game, Giuoco Piano",
        "e4 e5 Nf3 Nc6 d4": "Scotch Game",
        "e4 e5 Nf3 Nf6": "Petrov Defence",
        "e4 e5 Nf3 d6": "Philidor Defence",
        "e4 c5": "Sicilian Defence",
        "e4 c5 Nf3 Nc6": "Sicilian Defence, Open",
        "e4 c5 Nf3 d6": "Sicilian Defence, Modern",
        "e4 e6": "French Defence",
        "e4 e6 d4 d5": "French Defence, Main Line",
        "e4 c6": "Caro-Kann Defence",
        "e4 c6 d4 d5": "Caro-Kann Defence, Main Line",
        "e4 d5": "Scandinavian Defence",
        "e4 d6": "Pirc Defence",
        "e4 g6": "Modern Defence",
        "e4 Nf6": "Alekhine Defence",
        "e4 Nc6": "Nimzowitsch Defence",
        "d4": "Queen\u2019s Pawn Opening", "d4 d5": "Queen\u2019s Pawn Game",
        "d4 d5 c4": "Queen\u2019s Gambit",
        "d4 d5 c4 e6": "Queen\u2019s Gambit Declined",
        "d4 d5 c4 c6": "Slav Defence",
        "d4 Nf6": "Indian Defence",
        "d4 Nf6 c4 g6": "King\u2019s Indian Defence",
        "d4 Nf6 c4 e6": "Nimzo-Indian / Queen\u2019s Indian",
        "d4 Nf6 c4 e6 Nc3": "Nimzo-Indian Defence",
        "d4 Nf6 c4 g6 Nc3 d5": "Grunfeld Defence",
        "d4 f5": "Dutch Defence",
        "c4": "English Opening", "c4 e5": "English, Reversed Sicilian",
        "Nf3": "Reti Opening",
        "f4": "Bird\u2019s Opening",
        "b4": "Sokolsky Opening",
    }
    return fallback


OPENING_BOOK = _load_openings_book()
print(f"[review] Opening book loaded: {len(OPENING_BOOK)} entries from {_OPENINGS_JSON}")

# Sort by number of moves descending so longest match wins
_OPENING_BOOK_SORTED = sorted(
    OPENING_BOOK.items(),
    key=lambda kv: len(kv[0].split()),
    reverse=True,
)


def detect_opening(pgn_text):
    """Detect the chess opening from a PGN string.

    Returns dict with 'name', 'eco', 'moves_played', 'move_text',
    'total_moves' — or None when nothing matches.
    """
    try:
        game = chess.pgn.read_game(io.StringIO(pgn_text))
        if game is None:
            return None
    except Exception:
        return None

    board = game.board()
    moves_san = []
    for move in game.mainline_moves():
        try:
            san = board.san(move)
            moves_san.append(san)
            board.push(move)
        except Exception:
            break

    if not moves_san:
        return None

    # Build incremental move strings and find the longest book match.
    best_name = None
    best_eco = None
    best_len = 0
    best_key = None

    for i in range(1, len(moves_san) + 1):
        prefix = " ".join(moves_san[:i])
        hit = OPENING_BOOK.get(prefix)
        if hit and i > best_len:
            best_name = hit["name"]
            best_eco = hit.get("eco", "")
            best_len = i
            best_key = prefix

    if best_name:
        return {
            "name": best_name,
            "eco": best_eco,
            "moves_played": best_len,
            "move_text": best_key,
            "total_moves": len(moves_san),
        }

    return None


@review_bp.route("/review/opening", methods=["POST"])
def review_detect_opening():
    """Detect the chess opening from a PGN.
    POST body: { pgn: "..." }
    Returns: { ok: true, opening: {...} } or { ok: false, error: "..." }
    """
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "No data provided"}), 400

    pgn = data.get("pgn", "").strip()
    if not pgn:
        return jsonify({"ok": False, "error": "PGN required"}), 400

    result = detect_opening(pgn)
    if result:
        print(f"[review/opening] Detected: {result['name']} ({result.get('eco', '')})")
        return jsonify({"ok": True, "opening": result})
    print(f"[review/opening] No match for PGN ({len(pgn)} chars)")
    return jsonify({"ok": False, "error": "Opening not recognized"})
