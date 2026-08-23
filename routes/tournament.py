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
