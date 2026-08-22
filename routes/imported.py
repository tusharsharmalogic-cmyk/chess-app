"""
routes/imported.py — Imported games CRUD
PGN paste / file import (stored locally, not played)
"""

import os
import json
import uuid
import time

from flask import Blueprint, request, jsonify

imported_bp = Blueprint("imported", __name__)

BASE_DIR = "/sdcard/C"
DATA_DIR = os.path.join(BASE_DIR, "play_data")
IMPORTED_GAMES_FILE = os.path.join(DATA_DIR, "imported_games.json")
IMPORTED_MAX = 500


# ── Persistence ───────────────────────────────────────────────────────────────

def load_imported_games():
    if not os.path.exists(IMPORTED_GAMES_FILE):
        return []
    try:
        with open(IMPORTED_GAMES_FILE, "r") as f:
            data = json.load(f)
            return data if isinstance(data, list) else []
    except Exception:
        return []


def save_imported_games(games):
    with open(IMPORTED_GAMES_FILE, "w") as f:
        json.dump(games, f, indent=2)


# ==========================================================================
#  IMPORTED GAMES CRUD
# ==========================================================================

@imported_bp.route("/play/imported", methods=["GET"])
def get_imported_games():
    games   = load_imported_games()
    ordered = list(reversed(games))
    return jsonify({"games": ordered, "total": len(games)})


@imported_bp.route("/play/imported", methods=["POST"])
def add_imported_games():
    """
    Accept a list of parsed game objects from the frontend.
    Each object should have: white_name, black_name, result, date_str,
    time_control, pgn, move_count, event, site.
    Returns list of saved records with assigned IDs.
    """
    data = request.get_json()
    if not data or not isinstance(data.get("games"), list):
        return jsonify({"error": "games array required"}), 400

    games = load_imported_games()
    saved = []

    for g in data["games"]:
        if not g.get("pgn"):
            continue
        pgn_body    = g["pgn"].strip()
        fingerprint = pgn_body[:200]
        if any(x.get("fingerprint") == fingerprint for x in games):
            continue

        record = {
            "id":           "imp_" + str(uuid.uuid4())[:8],
            "imported_at":  int(time.time()),
            "white_name":   g.get("white_name", "White"),
            "black_name":   g.get("black_name", "Black"),
            "result":       g.get("result", "*"),
            "date_str":     g.get("date_str", ""),
            "event":        g.get("event", ""),
            "site":         g.get("site", ""),
            "time_control": g.get("time_control", ""),
            "move_count":   g.get("move_count", 0),
            "pgn":          pgn_body,
            "fingerprint":  fingerprint,
        }
        games.append(record)
        saved.append(record)

    if len(games) > IMPORTED_MAX:
        games = games[-IMPORTED_MAX:]

    save_imported_games(games)
    return jsonify({"ok": True, "saved": len(saved), "games": saved})


@imported_bp.route("/play/imported/<imp_id>", methods=["DELETE"])
def delete_imported_game(imp_id):
    games     = load_imported_games()
    new_games = [g for g in games if g.get("id") != imp_id]
    if len(new_games) == len(games):
        return jsonify({"error": "Game not found"}), 404
    save_imported_games(new_games)
    return jsonify({"ok": True})


@imported_bp.route("/play/imported", methods=["DELETE"])
def clear_imported_games():
    body = request.get_json(silent=True) or {}
    ids  = body.get("ids")
    if ids and isinstance(ids, list):
        games     = load_imported_games()
        new_games = [g for g in games if g.get("id") not in ids]
        save_imported_games(new_games)
        return jsonify({"ok": True, "deleted": len(games) - len(new_games)})
    save_imported_games([])
    return jsonify({"ok": True})
