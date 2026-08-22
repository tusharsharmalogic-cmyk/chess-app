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
