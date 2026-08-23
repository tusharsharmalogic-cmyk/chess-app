"""
routes/tournament.py — /play/tournament persistence

Tournament logic (pairing, elimination, matches) runs client-side;
this module only stores/restores the tournament state so it survives
page reloads.
"""

import os

from flask import Blueprint, request, jsonify

from helpers import load_json_file, save_json_file

tournament_bp = Blueprint("tournament", __name__)

# ── Config (same layout as routes/play.py) ──────────────────────────────────
BASE_DIR = "/sdcard/C"
DATA_DIR = os.path.join(BASE_DIR, "play_data")
TOURNAMENT_FILE = os.path.join(DATA_DIR, "tournament.json")
TOURNEY_HISTORY_FILE = os.path.join(DATA_DIR, "tournament_history.json")

MAX_HISTORY_ENTRIES = 50


# ==========================================================================
#  TOURNAMENT STATE
# ==========================================================================

@tournament_bp.route("/play/tournament", methods=["GET"])
def get_tournament():
    data = load_json_file(TOURNAMENT_FILE)
    return jsonify({"tournament": data if isinstance(data, dict) else None})


@tournament_bp.route("/play/tournament", methods=["POST"])
def save_tournament():
    data = request.get_json(silent=True) or {}
    t = data.get("tournament")
    if not isinstance(t, dict):
        return jsonify({"error": "tournament object required"}), 400
    save_json_file(TOURNAMENT_FILE, t)
    return jsonify({"ok": True})


@tournament_bp.route("/play/tournament", methods=["DELETE"])
def delete_tournament():
    try:
        if os.path.exists(TOURNAMENT_FILE):
            os.remove(TOURNAMENT_FILE)
    except OSError:
        pass
    return jsonify({"ok": True})


# ==========================================================================
#  TOURNAMENT HISTORY (archive of completed tournaments)
# ==========================================================================

def _load_tourney_history():
    data = load_json_file(TOURNEY_HISTORY_FILE)
    return data if isinstance(data, list) else []


@tournament_bp.route("/play/tournament/history", methods=["GET"])
def get_tournament_history():
    return jsonify({"history": _load_tourney_history()})


@tournament_bp.route("/play/tournament/history/delete", methods=["POST"])
def delete_tournament_history():
    data = request.get_json(silent=True) or {}
    ids = data.get("ids")
    if not isinstance(ids, list):
        return jsonify({"error": "ids list required"}), 400
    id_set = set(ids)
    hist = [h for h in _load_tourney_history() if h.get("id") not in id_set]
    save_json_file(TOURNEY_HISTORY_FILE, hist)
    return jsonify({"ok": True, "remaining": len(hist)})


@tournament_bp.route("/play/tournament/history", methods=["POST"])
def add_tournament_history():
    data = request.get_json(silent=True) or {}
    entry = data.get("entry")
    if not isinstance(entry, dict):
        return jsonify({"error": "entry object required"}), 400
    hist = _load_tourney_history()
    hist.append(entry)
    # Sirf recent tournaments rakho
    save_json_file(TOURNEY_HISTORY_FILE, hist[-MAX_HISTORY_ENTRIES:])
    return jsonify({"ok": True})
