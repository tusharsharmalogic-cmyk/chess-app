"""
routes/puzzles.py — /puzzles/* routes
Tactics puzzle mode: Lichess fetch, CSV DB import, per-puzzle + global stats.

Puzzle internal format (matches Lichess puzzle DB CSV semantics):
  {
    id:       str   (lichess puzzle id or generated)
    fen:      str   — position BEFORE the opponent's setup move
    solution: [uci] — moves[0] = opponent's setup (blunder) move,
                      rest = solver's winning line (+ opponent replies)
    rating:   int
    themes:   str
    solved:   bool / null
    attempts: int
    best_time_ms: int / null
  }
"""

import os
import json
import time
import uuid
import io
import urllib.request

import chess
import chess.pgn

from flask import Blueprint, request, jsonify

from helpers import load_json_file, save_json_file

puzzles_bp = Blueprint("puzzles", __name__)

BASE_DIR = "/sdcard/C"
DATA_DIR = os.path.join(BASE_DIR, "play_data")
PUZZLES_FILE = os.path.join(DATA_DIR, "puzzles.json")
PUZZLES_MAX = 3000

LICHESS_API = "https://lichess.org/api/puzzle"


# ── Persistence ───────────────────────────────────────────────────────────────

def _default_stats():
    return {
        "total_solved": 0, "total_failed": 0, "total_time_ms": 0,
        "total_points": 0,
        # daily: { "YYYY-MM-DD": { "points": int, "solved": int } }
        "daily": {},
        # best_day: { "date": "YYYY-MM-DD", "points": int } — derived
        "best_day": None,
    }


def load_puzzles():
    data = load_json_file(PUZZLES_FILE)
    if isinstance(data, dict) and isinstance(data.get("puzzles"), list):
        stats = data.setdefault("stats", _default_stats())
        for k, v in _default_stats().items():
            stats.setdefault(k, v)
        return data
    return {"puzzles": [], "stats": _default_stats()}


def _today_str():
    import datetime
    return datetime.date.today().isoformat()   # YYYY-MM-DD (device local time)


def calc_points(time_ms, mistakes):
    """
    First-time solve scoring:
      base 5  → -2 if time >= 2 min  → -2 per wrong attempt, floor at 0.
    """
    pts = 5
    if time_ms >= 120_000:
        pts -= 2
    pts -= mistakes * 2
    return max(0, pts)


def _compute_best_day(stats):
    daily = stats.get("daily") or {}
    best_date, best_pts = None, -1
    for d, info in daily.items():
        pts = int(info.get("points") or 0)
        if pts > best_pts:
            best_pts, best_date = pts, d
    stats["best_day"] = ({"date": best_date, "points": best_pts}
                         if best_date else None)


def _stats_with_today(stats):
    """Return a copy of stats with a computed 'today' block for display."""
    today = _today_str()
    day = (stats.get("daily") or {}).get(today) or {"points": 0, "solved": 0}
    out = dict(stats)
    out["today"] = {
        "date":   today,
        "points": int(day.get("points") or 0),
        "solved": int(day.get("solved") or 0),
    }
    # best_day purane data ke liye bhi fresh rakho
    if not out.get("best_day"):
        _compute_best_day(out)
    return out


def save_puzzles(data):
    save_json_file(PUZZLES_FILE, data)


def find_puzzle(data, pz_id):
    for p in data["puzzles"]:
        if p.get("id") == pz_id:
            return p
    return None


def make_record(pz_id, fen, solution, rating=0, themes=""):
    return {
        "id":           pz_id,
        "fen":          fen,
        "solution":     solution,
        "rating":       int(rating) if rating else 0,
        "themes":       themes or "",
        "solved":       None,
        "attempts":     0,
        "mistakes":     None,
        "best_time_ms": None,
        "points_earned": 0,      # first-solve points; re-solve/give-up = 0
        "added_at":     int(time.time()),
    }


# ── List & stats ──────────────────────────────────────────────────────────────

@puzzles_bp.route("/puzzles/list", methods=["GET"])
def list_puzzles():
    data = load_puzzles()
    puzzles = list(reversed(data["puzzles"]))   # newest first
    return jsonify({"puzzles": puzzles,
                    "stats": _stats_with_today(data["stats"]),
                    "total": len(puzzles)})


@puzzles_bp.route("/puzzles/stats", methods=["GET"])
def get_stats():
    data = load_puzzles()
    return jsonify({"stats": _stats_with_today(data["stats"])})


@puzzles_bp.route("/puzzles", methods=["DELETE"])
def clear_or_delete_puzzles():
    body = request.get_json(silent=True) or {}
    ids  = body.get("ids")
    data = load_puzzles()
    if ids and isinstance(ids, list):
        before = len(data["puzzles"])
        data["puzzles"] = [p for p in data["puzzles"] if p.get("id") not in ids]
        save_puzzles(data)
        return jsonify({"ok": True, "deleted": before - len(data["puzzles"])})
    data["puzzles"] = []
    save_puzzles(data)
    return jsonify({"ok": True})


# ── Result recording ──────────────────────────────────────────────────────────

@puzzles_bp.route("/puzzles/result", methods=["POST"])
def record_result():
    """
    Body: { id, solved: bool, time_ms: int, mistakes: int }

    Points (sirf FIRST solve par):
      max 5  → -2 agar time >= 2 min → -2 per galat attempt, min 0.
    Re-solve / give up = 0 points.
    Daily tracking replaces streak: har date ke points jude rehte hain.
    """
    body    = request.get_json(silent=True)
    if not body:
        return jsonify({"error": "No data provided"}), 400

    pz_id   = body.get("id")
    solved  = bool(body.get("solved"))
    try:
        time_ms = max(0, int(body.get("time_ms", 0)))
    except (ValueError, TypeError):
        time_ms = 0
    try:
        mistakes = max(0, int(body.get("mistakes", 0)))
    except (ValueError, TypeError):
        mistakes = 0

    data    = load_puzzles()
    puzzle  = find_puzzle(data, pz_id)
    if puzzle is None:
        return jsonify({"error": "Puzzle not found"}), 404

    stats      = data["stats"]
    first_solve = solved and puzzle.get("solved") is not True
    earned     = 0

    puzzle["attempts"] = int(puzzle.get("attempts") or 0) + 1

    if solved:
        # Points sirf pehli baar solve karne par
        if first_solve:
            earned = calc_points(time_ms, mistakes)
            puzzle["points_earned"] = earned
            puzzle["mistakes"] = mistakes
            if puzzle.get("best_time_ms") is None or time_ms < puzzle["best_time_ms"]:
                puzzle["best_time_ms"] = time_ms

            stats["total_points"] = int(stats.get("total_points") or 0) + earned
            today = _today_str()
            daily = stats.setdefault("daily", {})
            day   = daily.setdefault(today, {"points": 0, "solved": 0})
            day["points"] = int(day.get("points") or 0) + earned
            day["solved"] = int(day.get("solved") or 0) + 1
            _compute_best_day(stats)

            stats["total_solved"] = int(stats.get("total_solved") or 0) + 1
            stats["total_time_ms"] = int(stats.get("total_time_ms") or 0) + time_ms
        puzzle["solved"] = True
    else:
        # Fail/give-up — 0 points, streak ka concept nahi hai ab
        if puzzle.get("solved") is not True:
            puzzle["solved"] = False
        stats["total_failed"] = int(stats.get("total_failed") or 0) + 1

    save_puzzles(data)

    today = _today_str()
    return jsonify({
        "ok":   True,
        "earned": earned,
        "today": {
            "date":   today,
            "points": int((stats.get("daily") or {}).get(today, {}).get("points") or 0),
            "solved": int((stats.get("daily") or {}).get(today, {}).get("solved") or 0),
        },
        "puzzle": {k: puzzle[k] for k in ("id", "solved", "attempts",
                                          "best_time_ms", "mistakes",
                                          "points_earned")},
        "stats": stats,
    })


# ── CSV DB import ─────────────────────────────────────────────────────────────

def _parse_csv_line(line):
    """Parse one row of lichess_db_puzzle.csv → record or None."""
    parts = line.split(",")
    # PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,...
    if len(parts) < 7:
        return None
    pz_id, fen, moves, rating = parts[0].strip(), parts[1].strip(), parts[2], parts[3]
    themes = parts[7].strip() if len(parts) > 7 else ""
    sol = [m.strip() for m in moves.split() if m.strip()]
    if len(sol) < 2:
        return None
    try:
        board = chess.Board(fen)
    except Exception:
        return None
    g = chess.Board(fen)
    for uci in sol:
        try:
            mv = chess.Move.from_uci(uci)
        except Exception:
            return None
        if mv not in g.legal_moves:
            return None
        g.push(mv)
    return make_record(pz_id, fen, sol, rating, themes)


@puzzles_bp.route("/puzzles/import", methods=["POST"])
def import_puzzles():
    """
    Accept pasted lines from the free Lichess puzzle database CSV
    (https://database.lichess.org/#puzzles).
    Body: { text: "..." }
    """
    body = request.get_json(silent=True)
    if not body or not isinstance(body.get("text"), str):
        return jsonify({"error": "text field required"}), 400

    data = load_puzzles()
    existing_ids = {p.get("id") for p in data["puzzles"]}
    saved, skipped = 0, 0

    for line in body["text"].splitlines():
        line = line.strip()
        if not line or line.lower().startswith("puzzleid"):
            continue
        rec = _parse_csv_line(line)
        if rec is None:
            skipped += 1
            continue
        if rec["id"] in existing_ids:
            skipped += 1
            continue
        data["puzzles"].append(rec)
        existing_ids.add(rec["id"])
        saved += 1
        if len(data["puzzles"]) >= PUZZLES_MAX:
            break

    save_puzzles(data)
    return jsonify({"ok": True, "saved": saved, "skipped": skipped,
                    "total": len(data["puzzles"])})


# ── Fetch from Lichess API ────────────────────────────────────────────────────

def _fetch_lichess_puzzle(url):
    req = urllib.request.Request(url, headers={
        "User-Agent": "ChessAnalyzerApp/1.0",
        "Accept": "application/json",
    })
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.load(resp)


def _extract_from_api(payload):
    """
    Convert a Lichess /api/puzzle response into our internal format.
    The API gives game PGN + initialPly; we derive FEN + full solution line.
    We self-verify by replaying: whichever hypothesis makes the whole
    solution legal is used.
    """
    game = chess.pgn.read_game(io.StringIO(payload.get("game", {}).get("pgn", "")))
    if game is None:
        return None
    node = game
    mainline = []
    while node.variations:
        node = node.variations[0]
        mainline.append(node.move)
    initial_ply = int(payload.get("puzzle", {}).get("initialPly", 0))
    solution_api = payload.get("puzzle", {}).get("solution", [])
    if not mainline or not solution_api:
        return None

    # Hypothesis A: setup move = mainline[initialPly] (position at initialPly plies played)
    # Hypothesis B: setup move = mainline[initialPly + 1]
    for setup_idx in (initial_ply, initial_ply + 1):
        if setup_idx >= len(mainline):
            continue
        board = game.board()
        for mv in mainline[:setup_idx]:
            board.push(mv)
        setup_move = mainline[setup_idx]
        if setup_move not in board.legal_moves:
            continue
        fen_before_setup = board.fen()
        test = board.copy()
        test.push(setup_move)
        ok = True
        line = [setup_move.uci()]
        for uci in solution_api:
            try:
                mv = chess.Move.from_uci(uci)
            except Exception:
                ok = False
                break
            if mv not in test.legal_moves:
                ok = False
                break
            test.push(mv)
            line.append(uci)
        if ok:
            pz = payload.get("puzzle", {})
            return make_record(pz.get("id") or ("api_" + uuid.uuid4().hex[:8]),
                               fen_before_setup, line,
                               pz.get("rating", 0),
                               ",".join(pz.get("themes", [])))
    return None


@puzzles_bp.route("/puzzles/fetch", methods=["POST"])
def fetch_puzzles():
    """
    Fetch fresh puzzles from Lichess (free API, no key needed).
    Body (optional): { count: 1-10 }
    Requires internet on the device.
    """
    body  = request.get_json(silent=True) or {}
    try:
        count = max(1, min(10, int(body.get("count", 1))))
    except (ValueError, TypeError):
        count = 1

    data = load_puzzles()
    existing_ids = {p.get("id") for p in data["puzzles"]}
    saved, failed = 0, 0

    for _ in range(count):
        try:
            payload = _fetch_lichess_puzzle(LICHESS_API + "/next")
            rec = _extract_from_api(payload)
            if rec is None:
                failed += 1
                continue
            if rec["id"] in existing_ids:
                continue
            data["puzzles"].append(rec)
            existing_ids.add(rec["id"])
            saved += 1
        except Exception as e:
            failed += 1
            last_err = str(e)

    save_puzzles(data)
    result = {"ok": saved > 0, "saved": saved, "failed": failed,
              "total": len(data["puzzles"])}
    if saved == 0 and failed > 0:
        result["error"] = ("Lichess se puzzle nahi mila — internet check karo"
                           if "last_err" not in dir() else "Fetch failed")
    return jsonify(result)
