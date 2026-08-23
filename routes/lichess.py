"""
routes/lichess.py — 🌐 Lichess Live Play Bridge
Token management, challenges (user + open seek), SSE stream bridges
(game + events), move/resign/draw/abort proxies, game-end history
save + Lichess rating sync.

Uses only stdlib urllib — no extra dependencies.
"""

import os
import json
import uuid
import time
import urllib.request
import urllib.parse
import urllib.error

from flask import Blueprint, request, jsonify, Response

from helpers import load_json_file, save_json_file

lichess_bp = Blueprint("lichess", __name__)

# ── Config ────────────────────────────────────────────────────────────────────

BASE_DIR = "/sdcard/C"
DATA_DIR = os.path.join(BASE_DIR, "play_data")
HISTORY_FILE = os.path.join(DATA_DIR, "game_history.json")
LICHESS_FILE = os.path.join(DATA_DIR, "lichess.json")

API = "https://lichess.org"

DEFAULT_STATE = {
    "token": "",
    "current_game_id": "",
    "lichess_rating": 0,
    "username": "",
}


# ── Persistence ───────────────────────────────────────────────────────────────

def load_lichess():
    data = load_json_file(LICHESS_FILE)
    if not isinstance(data, dict):
        data = {}
    merged = dict(DEFAULT_STATE)
    merged.update(data)
    return merged


def save_lichess(state):
    save_json_file(LICHESS_FILE, state)


def load_history():
    data = load_json_file(HISTORY_FILE)
    return data if isinstance(data, list) else []


# ── Lichess API helpers (stdlib only) ────────────────────────────────────────

class LichessError(Exception):
    pass


def _api(path, token=None, method="GET", data=None, timeout=15):
    """Call Lichess REST API. Returns parsed JSON (dict/list)."""
    url = API + path
    headers = {"Accept": "application/json"}
    if token:
        headers["Authorization"] = "Bearer " + token
    body = None
    if data is not None:
        body = urllib.parse.urlencode(data).encode("utf-8")
        headers["Content-Type"] = "application/x-www-form-urlencoded"
    req = urllib.request.Request(url, data=body, method=method, headers=headers)
    try:
        resp = urllib.request.urlopen(req, timeout=timeout)
        raw = resp.read().decode("utf-8", "ignore")
        return json.loads(raw) if raw.strip() else {}
    except urllib.error.HTTPError as e:
        detail = ""
        try:
            detail = e.read().decode("utf-8", "ignore")[:300]
        except Exception:
            pass
        raise LichessError(f"Lichess API {e.code}: {detail}") from e
    except Exception as e:
        raise LichessError(f"Network error: {e}") from e


def _require_token():
    state = load_lichess()
    if not state.get("token"):
        raise LichessError("No Lichess token saved — pehle token add karo")
    return state["token"]


def _extract_rating(account):
    """Best rating from account perfs (highest games count among common TCs)."""
    perfs = account.get("perfs") or {}
    best, best_games = 0, -1
    for tc in ("classical", "rapid", "blitz", "bullet"):
        p = perfs.get(tc)
        if isinstance(p, dict) and p.get("rating"):
            games = p.get("games", 0)
            if games > best_games:
                best, best_games = p["rating"], games
    return best


# ── Token management ──────────────────────────────────────────────────────────

@lichess_bp.route("/lichess/token", methods=["POST"])
def save_token():
    data = request.get_json(force=True, silent=True) or {}
    token = (data.get("token") or "").strip()
    if not token:
        return jsonify({"ok": False, "error": "Token required"}), 400

    try:
        account = _api("/api/account", token=token)
    except LichessError as e:
        return jsonify({"ok": False, "error": str(e)}), 401

    state = load_lichess()
    state["token"] = token
    state["username"] = account.get("username", "")
    state["lichess_rating"] = _extract_rating(account)
    save_lichess(state)

    return jsonify({
        "ok": True,
        "username": state["username"],
        "rating": state["lichess_rating"],
    })


@lichess_bp.route("/lichess/token/check", methods=["GET"])
def check_token():
    state = load_lichess()
    if not state.get("token"):
        return jsonify({"ok": False, "valid": False, "error": "no token"})
    try:
        account = _api("/api/account", token=state["token"])
    except LichessError as e:
        return jsonify({"ok": True, "valid": False, "error": str(e)})
    state["username"] = account.get("username", state.get("username", ""))
    state["lichess_rating"] = _extract_rating(account)
    save_lichess(state)
    return jsonify({
        "ok": True,
        "valid": True,
        "username": state["username"],
        "rating": state["lichess_rating"],
    })


@lichess_bp.route("/lichess/account", methods=["GET"])
def get_account():
    """Cached account info (no network call)."""
    state = load_lichess()
    return jsonify({
        "connected": bool(state.get("token")),
        "username": state.get("username", ""),
        "rating": state.get("lichess_rating", 0),
    })


# ── Challenges ────────────────────────────────────────────────────────────────

def _challenge_params(data):
    try:
        minutes = max(1, min(int(data.get("minutes", 5)), 180))
    except (TypeError, ValueError):
        minutes = 5
    try:
        increment = max(0, min(int(data.get("increment", 3)), 60))
    except (TypeError, ValueError):
        increment = 3
    color = data.get("color", "random")
    if color not in ("white", "black", "random"):
        color = "random"
    rated = bool(data.get("rated", False))
    params = {
        "rated": "true" if rated else "false",
        "clock.limit": str(minutes * 60),
        "clock.increment": str(increment),
        "color": color,
    }
    variant = data.get("variant", "standard")
    if variant:
        params["variant"] = variant
    fen = (data.get("fen") or "").strip()
    if fen:
        params["fen"] = fen
    return params


@lichess_bp.route("/lichess/challenge", methods=["POST"])
def create_challenge():
    data = request.get_json(force=True, silent=True) or {}
    username = (data.get("username") or "").strip()
    if not username:
        return jsonify({"ok": False, "error": "Username required"}), 400
    try:
        token = _require_token()
        result = _api(f"/api/challenge/{username}", token=token, method="POST",
                      data=_challenge_params(data))
    except LichessError as e:
        return jsonify({"ok": False, "error": str(e)}), 400

    ch = result.get("challenge") or {}
    if result.get("error"):
        return jsonify({"ok": False, "error": result["error"]}), 400
    return jsonify({
        "ok": True,
        "challenge_id": ch.get("id"),
        "status": ch.get("status"),
    })


@lichess_bp.route("/lichess/challenge/open", methods=["POST"])
def create_open_seek():
    data = request.get_json(force=True, silent=True) or {}
    try:
        token = _require_token()
        result = _api("/api/challenge/open", token=token, method="POST",
                      data=_challenge_params(data))
    except LichessError as e:
        return jsonify({"ok": False, "error": str(e)}), 400

    ch = result.get("challenge") or {}
    if result.get("error"):
        return jsonify({"ok": False, "error": result["error"]}), 400
    return jsonify({
        "ok": True,
        "challenge_id": ch.get("id"),
        "status": ch.get("status"),
        "url_full": (result.get("url") or "") + "/" + (ch.get("id") or ""),
        "url": result.get("url"),
    })


@lichess_bp.route("/lichess/challenge/<challenge_id>", methods=["DELETE"])
def cancel_challenge(challenge_id):
    try:
        token = _require_token()
        _api(f"/api/challenge/{challenge_id}/cancel", token=token, method="POST")
    except LichessError as e:
        return jsonify({"ok": False, "error": str(e)}), 400
    return jsonify({"ok": True})


# ── SSE stream bridges ────────────────────────────────────────────────────────

def _ndjson_sse_response(url_path, token):
    """
    Consume a Lichess ndjson stream and re-emit it as Server-Sent Events.
    Ends with an `stream_end` event so the frontend closes its EventSource.
    """
    full_url = API + url_path

    def generate():
        try:
            req = urllib.request.Request(full_url, headers={
                "Authorization": "Bearer " + token,
                "Accept": "application/x-ndjson",
                "User-Agent": "ChessAnalyzerApp/1.0",
            })
            resp = urllib.request.urlopen(req, timeout=30)
            while True:
                line = resp.readline()
                if not line:
                    break
                text = line.decode("utf-8", "ignore").strip()
                if not text:
                    continue
                yield f"data: {text}\n\n"
        except GeneratorExit:
            return
        except Exception as e:
            try:
                yield "event: stream_error\n" + \
                      f"data: {json.dumps({'error': str(e)})}\n\n"
            except Exception:
                pass
        finally:
            try:
                yield "event: stream_end\ndata: {}\n\n"
            except Exception:
                pass

    return Response(
        generate(),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


@lichess_bp.route("/lichess/game/stream")
def game_stream():
    """Bridge: https://lichess.org/api/stream/game/{id} → frontend SSE."""
    state = load_lichess()
    gid = request.args.get("game_id") or state.get("current_game_id")
    if not gid:
        return jsonify({"ok": False, "error": "No current game"}), 404
    if not state.get("token"):
        return jsonify({"ok": False, "error": "No token"}), 401
    return _ndjson_sse_response(f"/api/stream/game/{gid}", state["token"])


@lichess_bp.route("/lichess/event/stream")
def event_stream():
    """
    Bridge: https://lichess.org/api/stream/event → frontend SSE.
    Used to detect open-seek acceptance (gameStart event) and
    incoming/outgoing challenge lifecycle.
    """
    state = load_lichess()
    if not state.get("token"):
        return jsonify({"ok": False, "error": "No token"}), 401
    return _ndjson_sse_response("/api/stream/event", state["token"])


# ── Game actions ──────────────────────────────────────────────────────────────

@lichess_bp.route("/lichess/game/start", methods=["POST"])
def game_start():
    data = request.get_json(force=True, silent=True) or {}
    gid = (data.get("game_id") or "").strip()
    if not gid:
        return jsonify({"ok": False, "error": "game_id required"}), 400
    state = load_lichess()
    state["current_game_id"] = gid
    save_lichess(state)
    return jsonify({"ok": True})


@lichess_bp.route("/lichess/game/status")
def game_status():
    state = load_lichess()
    return jsonify({
        "ok": True,
        "current_game_id": state.get("current_game_id", ""),
        "username": state.get("username", ""),
        "rating": state.get("lichess_rating", 0),
        "connected": bool(state.get("token")),
    })


@lichess_bp.route("/lichess/game/move", methods=["POST"])
def submit_move():
    data = request.get_json(force=True, silent=True) or {}
    move = (data.get("move") or "").strip().lower()   # e.g. "e2e4" / "e7e8q"
    offering_draw = bool(data.get("offeringDraw"))
    if not move:
        return jsonify({"ok": False, "error": "Move required"}), 400
    state = load_lichess()
    gid = state.get("current_game_id")
    if not gid:
        return jsonify({"ok": False, "error": "No current game"}), 404
    path = f"/api/board/game/{gid}/move/{move}"
    if offering_draw:
        path += "?offeringDraw=true"
    try:
        result = _api(path, token=state["token"], method="POST")
    except LichessError as e:
        return jsonify({"ok": False, "error": str(e)}), 400
    return jsonify({"ok": bool(result.get("ok"))})


@lichess_bp.route("/lichess/game/resign", methods=["POST"])
def resign_game():
    state = load_lichess()
    gid = state.get("current_game_id")
    if not gid:
        return jsonify({"ok": False, "error": "No current game"}), 404
    try:
        _api(f"/api/board/game/{gid}/resign", token=state["token"], method="POST")
    except LichessError as e:
        return jsonify({"ok": False, "error": str(e)}), 400
    return jsonify({"ok": True})


@lichess_bp.route("/lichess/game/draw", methods=["POST"])
def offer_draw():
    state = load_lichess()
    gid = state.get("current_game_id")
    if not gid:
        return jsonify({"ok": False, "error": "No current game"}), 404
    try:
        _api(f"/api/board/game/{gid}/draw", token=state["token"], method="POST")
    except LichessError as e:
        return jsonify({"ok": False, "error": str(e)}), 400
    return jsonify({"ok": True})


@lichess_bp.route("/lichess/game/abort", methods=["POST"])
def abort_game():
    state = load_lichess()
    gid = state.get("current_game_id")
    if not gid:
        return jsonify({"ok": False, "error": "No current game"}), 404
    try:
        _api(f"/api/board/game/{gid}/abort", token=state["token"], method="POST")
    except LichessError as e:
        return jsonify({"ok": False, "error": str(e)}), 400
    return jsonify({"ok": True})


# ── Game end: history save + rating sync ─────────────────────────────────────

@lichess_bp.route("/lichess/game/end", methods=["POST"])
def game_end():
    """
    Frontend calls this once when the stream reports game over.
    Saves a history entry (same format as existing history) and syncs
    the Lichess rating into lichess.json.
    """
    data = request.get_json(force=True, silent=True) or {}

    entry = {
        "id":               str(uuid.uuid4()),
        "mode":             "lichess",
        "source":           "lichess",
        "lichess_game_id":  data.get("lichess_game_id") or "",
        "opponent":         data.get("opponent") or "",
        "opponent_rating":  data.get("opponent_rating") or 0,
        "result":           data.get("result") or "*",
        "winner":           data.get("winner") or "",
        "reason":           data.get("reason") or "",
        "player_color":     data.get("my_color") or "w",
        "white_name":       data.get("white_name") or "White",
        "black_name":       data.get("black_name") or "Black",
        "pgn":              data.get("pgn") or "",
        "fen_final":        data.get("fen_final") or "",
        "time_control":     data.get("time_control") or None,
        "moves":            [],
        "ended_at":         time.strftime("%Y-%m-%dT%H:%M:%S"),
    }
    if isinstance(entry["result"], str) and entry["result"] in ("win", "loss", "draw"):
        pass

    history = load_history()
    history.append(entry)
    if len(history) > 500:
        history = history[-500:]
    save_json_file(HISTORY_FILE, history)

    # Rating sync (best-effort)
    rating_new, rating_old = None, None
    state = load_lichess()
    if state.get("token"):
        rating_old = state.get("lichess_rating", 0)
        try:
            account = _api("/api/account", token=state["token"])
            state["lichess_rating"] = _extract_rating(account)
            state["username"] = account.get("username", state.get("username", ""))
            save_lichess(state)
            rating_new = state["lichess_rating"]
        except Exception:
            pass

    return jsonify({
        "ok": True,
        "game_id": entry["id"],
        "rating_old": rating_old,
        "rating_new": rating_new,
    })


@lichess_bp.route("/lichess/game/clear", methods=["POST"])
def clear_current_game():
    state = load_lichess()
    state["current_game_id"] = ""
    save_lichess(state)
    return jsonify({"ok": True})
