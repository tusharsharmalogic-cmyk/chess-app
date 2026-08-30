"""
routes/play.py — All /play/* routes
Bot management, game state, history, player profile, ELO, bot move, hint
"""

import os
import json
import uuid
import time

import chess
import chess.engine
from flask import Blueprint, request, jsonify

from helpers import (

    detect_game_phase, position_in_book,
    calc_elo_change, analyse_move,
    load_json_file, save_json_file,
)

play_bp = Blueprint("play", __name__)

# ── Config (imported from c.py via app context) ──────────────────────────────
# These are set by c.py after creating the blueprint
BASE_DIR = "/sdcard/C"
DATA_DIR = os.path.join(BASE_DIR, "play_data")

BOTS_FILE    = os.path.join(DATA_DIR, "bots.json")
GAME_FILE    = os.path.join(DATA_DIR, "current_game.json")
GAME_FILE_PLAYBOT = os.path.join(DATA_DIR, "current_game_playbot.json")
GAME_FILE_BVB     = os.path.join(DATA_DIR, "current_game_bvb.json")
GAME_FILE_TOURN   = os.path.join(DATA_DIR, "current_game_tournament.json")
HISTORY_FILE = os.path.join(DATA_DIR, "game_history.json")
PLAYER_FILE  = os.path.join(DATA_DIR, "player.json")
LEADERBOARD_FILE = os.path.join(DATA_DIR, "leaderboard.json")

STOCKFISH_PATH = os.environ.get("STOCKFISH_PATH", "stockfish")

DEFAULT_PLAYER = {"name": "Player", "elo": 1200, "games_played": 0}


# ── Persistence helpers ───────────────────────────────────────────────────────

def load_bots():
    data = load_json_file(BOTS_FILE)
    return data if isinstance(data, dict) else {}


def save_bots(bots):
    save_json_file(BOTS_FILE, bots)


def _game_file(mode=None):
    """Return the appropriate file path for the given mode."""
    if mode == 'playbot': return GAME_FILE_PLAYBOT
    if mode == 'bvb':     return GAME_FILE_BVB
    if mode == 'tournament': return GAME_FILE_TOURN
    return GAME_FILE


def load_game(mode=None):
    data = load_json_file(_game_file(mode))
    return data if isinstance(data, dict) else None


def save_game_state(state, mode=None):
    save_json_file(_game_file(mode), state)


def delete_game_state(mode=None):
    f = _game_file(mode)
    if os.path.exists(f):
        os.remove(f)


def load_history():
    data = load_json_file(HISTORY_FILE)
    return data if isinstance(data, list) else []


def save_history(history):
    save_json_file(HISTORY_FILE, history)


def load_player():
    data = load_json_file(PLAYER_FILE)
    merged = dict(DEFAULT_PLAYER)
    if isinstance(data, dict):
        merged.update(data)
    return merged


def save_player(player):
    save_json_file(PLAYER_FILE, player)


# ── Leaderboard helpers ──────────────────────────────────────────────────────
def load_leaderboard():
    data = load_json_file(LEADERBOARD_FILE)
    return data if isinstance(data, dict) else {}


def save_leaderboard(lb):
    save_json_file(LEADERBOARD_FILE, lb)


def _lb_key(entity_type, entity_id):
    return f"{entity_type}:{entity_id}"


def _lb_resolve_key(lb, key, name, entity_type):
    """If key already exists, return it. Otherwise check if name matches any
    existing entry (by profile name or other_names). If found, return that
    entry's key so points merge into the same entry."""
    if key in lb:
        return key
    name_lower = (name or '').strip().lower()
    if not name_lower:
        return key
    # Load player profile for other_names matching (only for user entries)
    other_names = []
    if entity_type == 'player':
        try:
            player = load_player()
            other_names = [n.strip().lower() for n in (player.get('other_names') or []) if n.strip()]
        except Exception:
            pass
    for existing_key, entry in lb.items():
        existing_name = (entry.get('name') or '').strip().lower()
        if existing_name == name_lower:
            return existing_key
        # Check other_names for user entries
        if entity_type == 'player' and name_lower in other_names:
            return existing_key
    return key


def _lb_entry(lb, key, name, entity_type, elo):
    # Resolve key by name matching to avoid duplicates
    resolved = _lb_resolve_key(lb, key, name, entity_type)
    if resolved != key and resolved in lb:
        # Merge into existing entry — update name/type to latest
        lb[resolved]['name'] = name
        lb[resolved]['type'] = entity_type
        lb[resolved]['elo'] = elo
        return lb[resolved]
    if key not in lb:
        lb[key] = {
            "name": name,
            "type": entity_type,
            "elo": elo,
            "points": 0,
            "history": [],  # [{ts, opponent, result, elo_delta, points, context}]
        }
    return lb[key]


def _lb_record_match(lb, winner_key, loser_key, w_name, w_type, w_elo,
                      l_name, l_type, l_elo, elo_delta):
    """Record a match result in the leaderboard.
    Winner gets: +5 + abs(elo_delta) points.
    Loser gets:  -3 - abs(elo_delta) points.
    """
    ts = int(time.time())
    abs_delta = abs(elo_delta)

    w_entry = _lb_entry(lb, winner_key, w_name, w_type, w_elo)
    w_entry["elo"] = w_elo
    w_pts = 5 + abs_delta
    w_entry["points"] += w_pts
    w_entry["history"].insert(0, {
        "ts": ts, "opponent": l_name, "result": "win",
        "elo_delta": abs_delta, "points": w_pts, "context": "match",
    })
    w_entry["history"] = w_entry["history"][:50]

    l_entry = _lb_entry(lb, loser_key, l_name, l_type, l_elo)
    l_entry["elo"] = l_elo
    l_pts = -(3 + abs_delta)
    l_entry["points"] += l_pts
    l_entry["history"].insert(0, {
        "ts": ts, "opponent": w_name, "result": "loss",
        "elo_delta": -abs_delta, "points": l_pts, "context": "match",
    })
    l_entry["history"] = l_entry["history"][:50]


def _lb_record_draw(lb, key1, key2, n1, t1, e1, n2, t2, e2, delta):
    """Record a draw — no points change, just track the game."""
    ts = int(time.time())
    entry1 = _lb_entry(lb, key1, n1, t1, e1)
    entry1["elo"] = e1
    entry1["history"].insert(0, {
        "ts": ts, "opponent": n2, "result": "draw",
        "elo_delta": delta, "points": 0, "context": "match",
    })
    entry1["history"] = entry1["history"][:50]
    entry2 = _lb_entry(lb, key2, n2, t2, e2)
    entry2["elo"] = e2
    entry2["history"].insert(0, {
        "ts": ts, "opponent": n1, "result": "draw",
        "elo_delta": -delta, "points": 0, "context": "match",
    })
    entry2["history"] = entry2["history"][:50]


def _lb_record_tournament(lb, key, name, etype, elo, place):
    """Record tournament bonus. place: 1, 2, or 3."""
    bonus = {1: 200, 2: 100, 3: 50}.get(place, 0)
    if bonus <= 0:
        return
    entry = _lb_entry(lb, key, name, etype, elo)
    entry["elo"] = elo
    entry["points"] += bonus
    entry["history"].insert(0, {
        "ts": int(time.time()),
        "opponent": f"Tournament #{place}",
        "result": "tournament",
        "elo_delta": 0,
        "points": bonus,
        "context": f"tournament_top{place}",
    })
    entry["history"] = entry["history"][:50]


# ── Engine helper (shared global from c.py) ──────────────────────────────────
# get_engine() is defined in c.py and injected via app context;
# play_bp uses a fresh engine per bot move (intentional — see /play/move).


# ==========================================================================
#  BOT MANAGEMENT
# ==========================================================================

@play_bp.route("/play/bots", methods=["GET"])
def get_bots():
    bots = load_bots()
    return jsonify({"bots": list(bots.values())})


@play_bp.route("/play/bots", methods=["POST"])
def create_bot():
    data = request.get_json()
    name = data.get("name", "").strip()
    if not name:
        return jsonify({"error": "Bot name required"}), 400

    bot_id = str(uuid.uuid4())[:8]

    def parse_phase(key, default_elo=1500, default_depth=12, default_think=1000):
        ph = data.get(key, {})
        return {
            "elo":      max(1320, min(3190, int(ph.get("elo",      default_elo)))),
            "depth":    max(1,    min(20,   int(ph.get("depth",    default_depth)))),
            "think_ms": max(50,   min(10000,int(ph.get("think_ms", default_think)))),
        }

    uci_elo = int(data.get("uci_elo", 1500))

    bot = {
        "id":               bot_id,
        "name":             name,
        "uci_elo":          uci_elo,
        "phase_opening":    parse_phase("phase_opening",    uci_elo, 12),
        "phase_middlegame": parse_phase("phase_middlegame", uci_elo, 12),
        "phase_endgame":    parse_phase("phase_endgame",    uci_elo, 12),
        "created_at":       int(time.time()),
    }

    bots = load_bots()
    bots[bot_id] = bot
    save_bots(bots)
    return jsonify({"ok": True, "bot": bot})


@play_bp.route("/play/bots/<bot_id>", methods=["DELETE"])
def delete_bot(bot_id):
    bots = load_bots()
    if bot_id not in bots:
        return jsonify({"error": "Bot not found"}), 404
    del bots[bot_id]
    save_bots(bots)
    return jsonify({"ok": True})


# ==========================================================================
#  PERSONALITY
# ==========================================================================

@play_bp.route("/play/bots/<bot_id>/personality", methods=["POST"])
def set_personality(bot_id):
    bots = load_bots()
    if bot_id not in bots:
        return jsonify({"error": "Bot not found"}), 404

    data = request.get_json()
    personality = data.get("personality")
    if not personality:
        return jsonify({"error": "personality field required"}), 400
    if not isinstance(personality.get("rules"), list):
        return jsonify({"error": "personality.rules must be an array"}), 400
    if not personality.get("name"):
        return jsonify({"error": "personality.name required"}), 400

    bots[bot_id]["personality"] = personality
    bots[bot_id]["has_personality"] = True
    save_bots(bots)
    return jsonify({"ok": True, "bot": bots[bot_id]})


@play_bp.route("/play/bots/<bot_id>/personality", methods=["DELETE"])
def remove_personality(bot_id):
    bots = load_bots()
    if bot_id not in bots:
        return jsonify({"error": "Bot not found"}), 404
    bots[bot_id].pop("personality", None)
    bots[bot_id]["has_personality"] = False
    save_bots(bots)
    return jsonify({"ok": True})


# ==========================================================================
#  GAME STATE (AUTO SAVE / RESUME)
# ==========================================================================

@play_bp.route("/play/game", methods=["GET"])
def get_game():
    mode = request.args.get("mode")
    state = load_game(mode)
    return jsonify({"game": state})


@play_bp.route("/play/game", methods=["POST"])
def save_game():
    state = request.get_json()
    if not state:
        return jsonify({"error": "No state provided"}), 400
    state["saved_at"] = int(time.time())
    mode = state.pop("resume_mode", None) or request.args.get("mode")
    save_game_state(state, mode)
    return jsonify({"ok": True})


@play_bp.route("/play/game", methods=["DELETE"])
def clear_game():
    mode = request.args.get("mode")
    delete_game_state(mode)
    return jsonify({"ok": True})


# ==========================================================================
#  GAME HISTORY
# ==========================================================================

@play_bp.route("/play/history", methods=["GET"])
def get_history():
    history = load_history()
    ordered = list(reversed(history))
    try:
        limit = int(request.args.get("limit", 0))
    except (ValueError, TypeError):
        limit = 0
    if limit > 0:
        ordered = ordered[:limit]
    return jsonify({"games": ordered, "total": len(history)})


@play_bp.route("/play/history", methods=["POST"])
def add_history():
    data = request.get_json()
    if not data:
        return jsonify({"error": "No game data provided"}), 400

    record = {
        "id":               str(uuid.uuid4())[:8],
        "ended_at":         int(time.time()),
        "mode":             data.get("mode", "playbot"),
        "result":           data.get("result"),
        "winner":           data.get("winner"),
        "reason":           data.get("reason", ""),
        "title":            data.get("title", ""),
        "white_name":       data.get("white_name", "White"),
        "black_name":       data.get("black_name", "Black"),
        "white_bot_id":     data.get("white_bot_id"),
        "black_bot_id":     data.get("black_bot_id"),
        "player_color":     data.get("player_color"),
        "pgn":              data.get("pgn", ""),
        "fen_final":        data.get("fen_final", ""),
        "time_control":     data.get("time_control"),
        "white_time_left_ms": data.get("white_time_left_ms"),
        "black_time_left_ms": data.get("black_time_left_ms"),
        "moves":            data.get("moves", []),
    }

    history = load_history()
    history.append(record)
    if len(history) > 500:
        history = history[-500:]
    save_history(history)
    return jsonify({"ok": True, "game": record})


@play_bp.route("/play/history/<game_id>", methods=["DELETE"])
def delete_history_game(game_id):
    history = load_history()
    new_history = [g for g in history if g.get("id") != game_id]
    if len(new_history) == len(history):
        return jsonify({"error": "Game not found"}), 404
    save_history(new_history)
    return jsonify({"ok": True})


@play_bp.route("/play/history", methods=["DELETE"])
def clear_history():
    save_history([])
    return jsonify({"ok": True})


# ==========================================================================
#  PLAYER PROFILE
# ==========================================================================

@play_bp.route("/play/player", methods=["GET"])
def get_player():
    return jsonify({"player": load_player()})


@play_bp.route("/play/player", methods=["POST"])
def set_player():
    data = request.get_json() or {}
    player = load_player()

    if "name" in data:
        name = str(data.get("name", "")).strip()
        if name:
            player["name"] = name[:40]

    if "elo" in data:
        try:
            elo = int(data.get("elo"))
            player["elo"] = max(100, min(4000, elo))
        except (ValueError, TypeError):
            pass

    if "other_names" in data:
        raw = data.get("other_names")
        if isinstance(raw, str):
            raw = raw.split(",")
        if isinstance(raw, list):
            names = []
            for n in raw:
                n = str(n).strip()[:40]
                if n and n not in names:
                    names.append(n)
            player["other_names"] = names[:20]

    if "games_played" in data:
        try:
            player["games_played"] = max(0, int(data.get("games_played")))
        except (ValueError, TypeError):
            pass

    save_player(player)
    return jsonify({"ok": True, "player": player})


# ==========================================================================
#  BOT ELO
# ==========================================================================

@play_bp.route("/play/bots/<bot_id>/elo", methods=["POST"])
def set_bot_elo(bot_id):
    bots = load_bots()
    if bot_id not in bots:
        return jsonify({"error": "Bot not found"}), 404

    data = request.get_json() or {}
    try:
        bot_elo = int(data.get("bot_elo"))
    except (ValueError, TypeError):
        return jsonify({"error": "bot_elo must be an integer"}), 400

    bot_elo = max(100, min(4000, bot_elo))
    bots[bot_id]["bot_elo"] = bot_elo
    save_bots(bots)
    return jsonify({"ok": True, "bot": bots[bot_id]})


# ==========================================================================
#  MATCH RESULT — update player ELO
# ==========================================================================

@play_bp.route("/play/result", methods=["POST"])
def submit_result():
    data = request.get_json() or {}
    bot_id = data.get("bot_id")

    try:
        score = float(data.get("score"))
    except (ValueError, TypeError):
        return jsonify({"error": "score must be 0, 0.5, or 1"}), 400

    if score not in (0, 0.5, 1):
        return jsonify({"error": "score must be 0, 0.5, or 1"}), 400

    bots = load_bots()
    bot = bots.get(bot_id)
    if not bot:
        return jsonify({"error": "Bot not found"}), 404

    bot_elo = bot.get("bot_elo")
    if bot_elo is None:
        return jsonify({"error": "This bot has no estimated ELO set. Set it in Play > Make Bot."}), 400

    player = load_player()
    old_elo = player.get("elo", 1200)
    games_played = player.get("games_played", 0)

    new_elo, delta = calc_elo_change(old_elo, bot_elo, score, games_played)
    player["elo"] = new_elo
    player["games_played"] = games_played + 1
    save_player(player)

    # Bot ki estimated ELO bhi same formula se update karo (opposite score)
    bot_old_elo = bot_elo
    bot_new_elo, bot_delta = calc_elo_change(bot_elo, new_elo, 1.0 - score, bot.get("games_played", 0))
    bot["bot_elo"] = bot_new_elo
    bot["games_played"] = bot.get("games_played", 0) + 1
    save_bots(bots)

    # ── Leaderboard record ──
    lb = load_leaderboard()
    if score == 0.5:
        _lb_record_draw(
            lb,
            _lb_key("player", "user"), _lb_key("bot", bot_id),
            player.get("name", "Player"), "player", new_elo,
            bot.get("name", bot_id), "bot", bot_new_elo, delta,
        )
    else:
        # Winner/loser determined by score: 1=player won, 0=bot won
        if score == 1:
            _lb_record_match(
                lb,
                _lb_key("player", "user"), _lb_key("bot", bot_id),
                player.get("name", "Player"), "player", new_elo,
                bot.get("name", bot_id), "bot", bot_new_elo, delta,
            )
        else:
            _lb_record_match(
                lb,
                _lb_key("bot", bot_id), _lb_key("player", "user"),
                bot.get("name", bot_id), "bot", bot_new_elo,
                player.get("name", "Player"), "player", new_elo, -delta,
            )
    save_leaderboard(lb)

    return jsonify({
        "ok": True,
        "old_elo": old_elo,
        "new_elo": new_elo,
        "delta":   delta,
        "bot_elo": bot_old_elo,
        "player":  player,
        "bot_elo_update": {
            "old":     bot_old_elo,
            "new":     bot_new_elo,
            "delta":   bot_delta,
        },
    })


# ==========================================================================
#  BOT vs BOT MATCH RESULT — update BOTH bots' ELO
# ==========================================================================

@play_bp.route("/play/bvb-result", methods=["POST"])
def bvb_match_result():
    data = request.get_json() or {}
    white_id = data.get("white_id")
    black_id = data.get("black_id")
    result = data.get("result")          # '1-0' | '0-1' | '1/2-1/2'

    if not white_id or not black_id:
        return jsonify({"error": "white_id and black_id required"}), 400
    if result not in ("1-0", "0-1", "1/2-1/2"):
        return jsonify({"error": "result must be 1-0, 0-1 or 1/2-1/2"}), 400
    if white_id == black_id:
        return jsonify({"error": "A bot cannot play itself"}), 400

    bots = load_bots()
    w_bot = bots.get(white_id)
    b_bot = bots.get(black_id)
    if not w_bot or not b_bot:
        return jsonify({"error": "Bot not found"}), 404

    w_elo = w_bot.get("bot_elo")
    b_elo = b_bot.get("bot_elo")
    if w_elo is None or b_elo is None:
        return jsonify({"error": "Both bots need estimated ELO set"}), 400

    w_score = {"1-0": 1.0, "0-1": 0.0, "1/2-1/2": 0.5}[result]

    w_new, w_delta = calc_elo_change(w_elo, b_elo, w_score, w_bot.get("games_played", 0))
    b_new, b_delta = calc_elo_change(b_elo, w_elo, 1.0 - w_score, b_bot.get("games_played", 0))

    w_bot["bot_elo"] = w_new
    w_bot["games_played"] = w_bot.get("games_played", 0) + 1
    b_bot["bot_elo"] = b_new
    b_bot["games_played"] = b_bot.get("games_played", 0) + 1
    save_bots(bots)

    # ── Leaderboard record ──
    lb = load_leaderboard()
    wk = _lb_key("bot", white_id)
    bk = _lb_key("bot", black_id)
    wn = w_bot.get("name", white_id)
    bn = b_bot.get("name", black_id)
    if w_score == 0.5:
        _lb_record_draw(lb, wk, bk, wn, "bot", w_new, bn, "bot", b_new, w_delta)
    elif w_score == 1.0:
        _lb_record_match(lb, wk, bk, wn, "bot", w_new, bn, "bot", b_new, w_delta)
    else:
        _lb_record_match(lb, bk, wk, bn, "bot", b_new, wn, "bot", w_new, -w_delta)
    save_leaderboard(lb)

    return jsonify({
        "ok": True,
        "white": {"id": white_id, "old": w_elo, "new": w_new, "delta": w_delta},
        "black": {"id": black_id, "old": b_elo, "new": b_new, "delta": b_delta},
    })


# ==========================================================================
#  CHECK OPENING (one-time book lookup at game start)
# ==========================================================================

@play_bp.route("/play/check-opening", methods=["POST"])
def check_opening():
    data = request.get_json()
    fen  = data.get("fen", chess.STARTING_FEN)
    try:
        board = chess.Board(fen)
    except Exception:
        return jsonify({"error": "Invalid FEN"}), 400
    return jsonify({"is_opening": position_in_book(board)})


# ==========================================================================
#  BOT MOVE
# ==========================================================================

@play_bp.route("/play/move", methods=["POST"])
def play_move():
    data     = request.get_json()
    fen      = data.get("fen", chess.STARTING_FEN)
    bot_id   = data.get("bot_id")
    time_ms  = int(data.get("time_ms", 0))
    move_num = int(data.get("move_num", 1))
    opening_locked = data.get("opening_locked", None)

    bots = load_bots()
    if bot_id not in bots:
        return jsonify({"error": "Bot not found"}), 404

    bot = bots[bot_id]

    try:
        board = chess.Board(fen)
    except Exception:
        return jsonify({"error": "Invalid FEN"}), 400

    if board.is_game_over():
        return jsonify({"error": "Game is already over"}), 400

    phase = detect_game_phase(board, move_num=move_num, opening_locked=opening_locked)

    default_elo   = bot.get("uci_elo", 1500)
    default_depth = 12

    if phase == 'opening':
        ph = bot.get("phase_opening",    {"elo": default_elo, "depth": default_depth})
    elif phase == 'middlegame':
        ph = bot.get("phase_middlegame", {"elo": default_elo, "depth": default_depth})
    else:
        ph = bot.get("phase_endgame",    {"elo": default_elo, "depth": default_depth})

    phase_elo      = int(ph.get("elo",      default_elo))
    phase_depth    = int(ph.get("depth",    default_depth))
    phase_think_ms = int(ph.get("think_ms", 1000))

    override_elo      = data.get("override_elo")
    override_depth    = data.get("override_depth")
    override_think_ms = data.get("override_think_ms")

    if override_elo      is not None: phase_elo      = max(1320, min(3190, int(override_elo)))
    if override_depth    is not None: phase_depth    = max(1,    min(20,   int(override_depth)))
    if override_think_ms is not None: phase_think_ms = max(50,   min(30000,int(override_think_ms)))

    try:
        eng = chess.engine.SimpleEngine.popen_uci(STOCKFISH_PATH)
    except Exception as e:
        return jsonify({"error": f"Cannot start engine: {e}"}), 500

    try:
        eng.configure({
            "UCI_LimitStrength": True,
            "UCI_Elo":           phase_elo,
        })
        max_think_sec = phase_think_ms / 1000.0
        limit  = chess.engine.Limit(time=max_think_sec, depth=phase_depth)
        result = eng.play(board, limit, info=chess.engine.INFO_SCORE)
        move   = result.move

        score_obj = result.info.get("score")
        if score_obj is not None:
            score_obj = score_obj.white()
            if score_obj.is_mate():
                score_cp = None
                mate_in  = score_obj.mate()
            else:
                score_cp = score_obj.score()
                mate_in  = None
        else:
            score_cp = None
            mate_in  = None

    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        try:
            eng.quit()
        except Exception:
            pass

    return jsonify({
        "move_uci": str(move),
        "score":    score_cp,
        "mate":     mate_in,
        "phase":    phase,
    })


# ==========================================================================
#  HINT
# ==========================================================================

@play_bp.route("/play/hint", methods=["POST"])
def play_hint():
    from c import get_engine
    data  = request.get_json()
    fen   = data.get("fen", chess.STARTING_FEN)
    depth = min(int(data.get("depth", 12)), 18)

    engine, err = get_engine()
    if engine is None:
        return jsonify({"error": f"Engine unavailable: {err}"}), 500

    try:
        board = chess.Board(fen)
    except Exception:
        return jsonify({"error": "Invalid FEN"}), 400

    try:
        result = engine.analyse(board, chess.engine.Limit(depth=depth), multipv=1)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

    info      = result[0] if isinstance(result, list) else result
    best_move = str(info.get("pv", [None])[0]) if info.get("pv") else None
    return jsonify({"best_move": best_move})


# ==========================================================================
#  CLASSIFY (single move analysis for Play tab)
# ==========================================================================

@play_bp.route("/classify", methods=["POST"])
def classify():
    from c import get_engine
    data       = request.get_json()
    fen_before = data.get("fen_before")
    move_uci   = data.get("move_uci")
    depth      = min(int(data.get("depth", 14)), 20)

    engine, err = get_engine()
    if engine is None:
        return jsonify({"error": f"Engine unavailable: {err}"}), 500

    try:
        board_before = chess.Board(fen_before)
    except Exception:
        return jsonify({"error": "Invalid FEN"}), 400

    try:
        move = chess.Move.from_uci(move_uci)
    except Exception:
        return jsonify({"error": "Invalid move UCI"}), 400

    if move not in board_before.legal_moves:
        return jsonify({"error": "Illegal move"}), 400

    try:
        return jsonify(analyse_move(engine, board_before, move, depth))
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ==========================================================================
#  LEADERBOARD
# ==========================================================================

@play_bp.route("/play/leaderboard", methods=["GET"])
def get_leaderboard():
    lb = load_leaderboard()
    # Sort by points descending, then by elo descending
    entries = []
    for key, entry in lb.items():
        entries.append({
            "key": key,
            "name": entry.get("name", "?"),
            "type": entry.get("type", "bot"),
            "elo": entry.get("elo", 1200),
            "points": entry.get("points", 0),
        })
    entries.sort(key=lambda e: (-e["points"], -e["elo"]))
    return jsonify({"entries": entries})


@play_bp.route("/play/leaderboard/history/<key>", methods=["GET"])
def get_leaderboard_history(key):
    lb = load_leaderboard()
    entry = lb.get(key)
    if not entry:
        return jsonify({"error": "Player not found"}), 404
    return jsonify({
        "name": entry.get("name", "?"),
        "type": entry.get("type", "bot"),
        "elo": entry.get("elo", 1200),
        "points": entry.get("points", 0),
        "history": entry.get("history", [])[:10],
    })


@play_bp.route("/play/leaderboard/tournament-top", methods=["POST"])
def leaderboard_tournament_top():
    """Award tournament bonus points to top 3. Called after tournament completes."""
    data = request.get_json() or {}
    top3 = data.get("top3", [])  # [{key, name, type, elo, place}]
    if not top3:
        return jsonify({"ok": True})

    lb = load_leaderboard()
    for entry in top3:
        key = entry.get("key", "")
        name = entry.get("name", "?")
        etype = entry.get("type", "bot")
        elo = entry.get("elo", 1200)
        place = entry.get("place", 0)
        if key and place in (1, 2, 3):
            _lb_record_tournament(lb, key, name, etype, elo, place)
    save_leaderboard(lb)
    return jsonify({"ok": True})

