"""
routes/chesscom_pull.py — Pull Chess.com games into imported_games.json
No token needed — uses public Chess.com API.
"""

import os, json, uuid, time, re
import urllib.request, urllib.parse, urllib.error
from datetime import datetime, timedelta
from flask import Blueprint, request, jsonify
from helpers import load_json_file, save_json_file

chesscom_pull_bp = Blueprint("chesscom_pull", __name__)

BASE_DIR = "/sdcard/C"
DATA_DIR = os.path.join(BASE_DIR, "play_data")
IMPORTED_FILE = os.path.join(DATA_DIR, "imported_games.json")
CHESSCOM_FILE = os.path.join(DATA_DIR, "chesscom_pull.json")


def load_imported():
    data = load_json_file(IMPORTED_FILE)
    return data if isinstance(data, list) else []


def save_imported(games):
    save_json_file(IMPORTED_FILE, games)


def load_state():
    data = load_json_file(CHESSCOM_FILE)
    return data if isinstance(data, dict) else {}


def save_state(state):
    save_json_file(CHESSCOM_FILE, state)


@chesscom_pull_bp.route("/chesscom/username", methods=["POST"])
def save_username():
    data = request.get_json(force=True, silent=True) or {}
    username = (data.get("username") or "").strip()
    if not username:
        return jsonify({"ok": False, "error": "Username required"}), 400
    state = load_state()
    state["username"] = username
    save_state(state)
    return jsonify({"ok": True, "username": username})


@chesscom_pull_bp.route("/chesscom/username", methods=["GET"])
def get_username():
    state = load_state()
    return jsonify({
        "username":    state.get("username", ""),
        "last_pulled": state.get("last_pulled", ""),
        "last_count":  state.get("last_count", 0),
    })


@chesscom_pull_bp.route("/chesscom/pull-games", methods=["POST"])
def pull_games():
    """
    Fetch last 3 months of games from Chess.com public API.
    Saves into imported_games.json with source="chess.com".
    Duplicate prevention via fingerprint (first 200 chars of PGN).
    """
    state    = load_state()
    body     = request.get_json(force=True, silent=True) or {}
    username = (body.get("username") or state.get("username") or "").strip()
    if not username:
        return jsonify({"ok": False, "error": "Username not set"}), 400

    state["username"] = username

    # Build list of (year, month) for last 3 months
    months_to_fetch = []
    now = datetime.utcnow()
    for i in range(3):
        d = now - timedelta(days=30 * i)
        months_to_fetch.append((d.year, d.month))

    headers = {
        "User-Agent": "ChessAnalyzerApp/1.0 contact@example.com",
        "Accept":     "application/json",
    }

    all_pgns = []
    for year, month in months_to_fetch:
        url = f"https://api.chess.com/pub/player/{urllib.parse.quote(username)}/games/{year}/{month:02d}"
        try:
            req  = urllib.request.Request(url, headers=headers)
            resp = urllib.request.urlopen(req, timeout=20)
            data = json.loads(resp.read().decode("utf-8", "ignore"))
            games = data.get("games") or []
            for g in games:
                pgn = (g.get("pgn") or "").strip()
                if pgn:
                    all_pgns.append(pgn)
        except urllib.error.HTTPError as e:
            if e.code == 404:
                continue   # No games that month — normal
            return jsonify({"ok": False, "error": f"Chess.com API error: {e.code}"}), 400
        except Exception as e:
            return jsonify({"ok": False, "error": f"Network error: {e}"}), 400

    if not all_pgns:
        return jsonify({"ok": True, "imported": 0, "skipped": 0,
                        "message": "No games found for this username"})

    existing     = load_imported()
    fingerprints = {g.get("fingerprint", "") for g in existing}

    def parse_header(pgn, tag):
        m = re.search(rf'\[{tag} "([^"]*)"\]', pgn)
        return m.group(1) if m else ""

    saved_count   = 0
    skipped_count = 0
    new_records   = []

    for pgn in all_pgns:
        fingerprint = pgn[:200]
        if fingerprint in fingerprints:
            skipped_count += 1
            continue

        white       = parse_header(pgn, "White")
        black       = parse_header(pgn, "Black")
        result      = parse_header(pgn, "Result")
        date_str    = parse_header(pgn, "UTCDate") or parse_header(pgn, "Date")
        time_ctrl   = parse_header(pgn, "TimeControl")
        event       = parse_header(pgn, "Event")
        site        = parse_header(pgn, "Site") or parse_header(pgn, "Link")
        white_elo   = parse_header(pgn, "WhiteElo")
        black_elo   = parse_header(pgn, "BlackElo")
        termination = parse_header(pgn, "Termination")

        # Count moves (approximate)
        moves_section = re.split(r'\n\n', pgn)[-1] if '\n\n' in pgn else ""
        move_count    = len(re.findall(r'\d+\.(?!\.\.)(?!\s*\.)', moves_section))

        record = {
            "id":                "cc_" + str(uuid.uuid4())[:8],
            "imported_at":       int(time.time()),
            "source":            "chess.com",
            "chesscom_username": username,
            "white_name":        white,
            "black_name":        black,
            "white_elo":         white_elo,
            "black_elo":         black_elo,
            "result":            result,
            "date_str":          date_str,
            "event":             event,
            "site":              site,
            "termination":       termination,
            "time_control":      time_ctrl,
            "move_count":        move_count,
            "pgn":               pgn,
            "fingerprint":       fingerprint,
        }
        new_records.append(record)
        fingerprints.add(fingerprint)
        saved_count += 1

    existing.extend(new_records)
    save_imported(existing)

    state["last_pulled"] = time.strftime("%Y-%m-%dT%H:%M:%S")
    state["last_count"]  = saved_count
    save_state(state)

    return jsonify({
        "ok":       True,
        "imported": saved_count,
        "skipped":  skipped_count,
        "message":  f"{saved_count} games imported, {skipped_count} already existed",
    })
