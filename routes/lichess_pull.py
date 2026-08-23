"""
routes/lichess_pull.py — Pull Lichess games into imported_games.json
No token needed — uses public Lichess API.
"""

import os, json, uuid, time, re
import urllib.request, urllib.parse, urllib.error
from flask import Blueprint, request, jsonify
from helpers import load_json_file, save_json_file

lichess_pull_bp = Blueprint("lichess_pull", __name__)

BASE_DIR = "/sdcard/C"
DATA_DIR = os.path.join(BASE_DIR, "play_data")
IMPORTED_FILE = os.path.join(DATA_DIR, "imported_games.json")
LICHESS_PULL_FILE = os.path.join(DATA_DIR, "lichess_pull.json")


def load_imported():
    data = load_json_file(IMPORTED_FILE)
    return data if isinstance(data, list) else []


def save_imported(games):
    save_json_file(IMPORTED_FILE, games)


def load_pull_state():
    data = load_json_file(LICHESS_PULL_FILE)
    return data if isinstance(data, dict) else {}


def save_pull_state(state):
    save_json_file(LICHESS_PULL_FILE, state)


@lichess_pull_bp.route("/lichess/username", methods=["POST"])
def save_username():
    data = request.get_json(force=True, silent=True) or {}
    username = (data.get("username") or "").strip()
    if not username:
        return jsonify({"ok": False, "error": "Username required"}), 400
    state = load_pull_state()
    state["username"] = username
    save_pull_state(state)
    return jsonify({"ok": True, "username": username})


@lichess_pull_bp.route("/lichess/username", methods=["GET"])
def get_username():
    state = load_pull_state()
    return jsonify({
        "username":    state.get("username", ""),
        "last_pulled": state.get("last_pulled", ""),
        "last_count":  state.get("last_count", 0),
    })


@lichess_pull_bp.route("/lichess/pull-games", methods=["POST"])
def pull_games():
    """
    Fetch recent games from Lichess public API for saved username.
    Saves into imported_games.json with source="lichess".
    Duplicate check via fingerprint (first 200 chars of PGN).
    """
    state = load_pull_state()
    username = (request.get_json(force=True, silent=True) or {}).get("username") or state.get("username", "")
    if not username:
        return jsonify({"ok": False, "error": "Username not set"}), 400

    # Update username in state
    state["username"] = username

    # Fetch from Lichess — plain PGN format, max 50 games
    url = f"https://lichess.org/api/games/user/{urllib.parse.quote(username)}?max=50&clocks=true&opening=true&perfType=bullet,blitz,rapid,classical"
    try:
        req = urllib.request.Request(url, headers={
            "Accept": "application/x-chess-pgn",
            "User-Agent": "ChessAnalyzerApp/1.0"
        })
        resp = urllib.request.urlopen(req, timeout=30)
        raw_pgn = resp.read().decode("utf-8", "ignore")
    except urllib.error.HTTPError as e:
        return jsonify({"ok": False, "error": f"Lichess API error: {e.code}"}), 400
    except Exception as e:
        return jsonify({"ok": False, "error": f"Network error: {e}"}), 400

    if not raw_pgn.strip():
        return jsonify({"ok": True, "imported": 0, "skipped": 0,
                        "message": "No games found for this username"})

    # Split multiple PGNs — each game starts with [Event
    pgn_chunks = re.split(r'\n(?=\[Event )', raw_pgn.strip())

    existing = load_imported()
    existing_fingerprints = {g.get("fingerprint", "") for g in existing}

    def parse_header(pgn, tag):
        m = re.search(rf'\[{tag} "([^"]*)"\]', pgn)
        return m.group(1) if m else ""

    saved_count = 0
    skipped_count = 0
    new_records = []

    for chunk in pgn_chunks:
        chunk = chunk.strip()
        if not chunk or not chunk.startswith("["):
            continue

        fingerprint = chunk[:200]
        if fingerprint in existing_fingerprints:
            skipped_count += 1
            continue

        white        = parse_header(chunk, "White")
        black        = parse_header(chunk, "Black")
        result       = parse_header(chunk, "Result")
        date_str     = parse_header(chunk, "UTCDate") or parse_header(chunk, "Date")
        time_control = parse_header(chunk, "TimeControl")
        event        = parse_header(chunk, "Event")
        site         = parse_header(chunk, "Site")
        white_elo    = parse_header(chunk, "WhiteElo")
        black_elo    = parse_header(chunk, "BlackElo")

        # Count moves
        moves_section = re.split(r'\n\n', chunk)[-1] if '\n\n' in chunk else ""
        move_count = len(re.findall(r'\d+\.(?!\.\.)(?!\s*\.)', moves_section))

        record = {
            "id":                "lc_" + str(uuid.uuid4())[:8],
            "imported_at":       int(time.time()),
            "source":            "lichess",
            "lichess_username":  username,
            "white_name":        white,
            "black_name":        black,
            "white_elo":         white_elo,
            "black_elo":         black_elo,
            "result":            result,
            "date_str":          date_str,
            "event":             event,
            "site":              site,
            "time_control":      time_control,
            "move_count":        move_count,
            "pgn":               chunk,
            "fingerprint":       fingerprint,
        }
        new_records.append(record)
        existing_fingerprints.add(fingerprint)
        saved_count += 1

    existing.extend(new_records)
    save_imported(existing)

    state["last_pulled"] = time.strftime("%Y-%m-%dT%H:%M:%S")
    state["last_count"] = saved_count
    save_pull_state(state)

    return jsonify({
        "ok":       True,
        "imported": saved_count,
        "skipped":  skipped_count,
        "message":  f"{saved_count} games imported, {skipped_count} already existed"
    })
