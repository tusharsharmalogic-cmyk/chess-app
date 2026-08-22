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
HISTORY_FILE = os.path.join(DATA_DIR, "game_history.json")
PLAYER_FILE  = os.path.join(DATA_DIR, "player.json")

STOCKFISH_PATH = os.environ.get("STOCKFISH_PATH", "stockfish")

DEFAULT_PLAYER = {"name": "Player", "elo": 1200, "games_played": 0}


# ── Persistence helpers ───────────────────────────────────────────────────────

def load_bots():
    data = load_json_file(BOTS_FILE)
    return data if isinstance(data, dict) else {}


def save_bots(bots):
    save_json_file(BOTS_FILE, bots)


def load_game():
    data = load_json_file(GAME_FILE)
    return data if isinstance(data, dict) else None


def save_game_state(state):
    save_json_file(GAME_FILE, state)


def delete_game_state():
    if os.path.exists(GAME_FILE):
        os.remove(GAME_FILE)


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
    state = load_game()
    return jsonify({"game": state})


@play_bp.route("/play/game", methods=["POST"])
def save_game():
    state = request.get_json()
    if not state:
        return jsonify({"error": "No state provided"}), 400
    state["saved_at"] = int(time.time())
    save_game_state(state)
    return jsonify({"ok": True})


@play_bp.route("/play/game", methods=["DELETE"])
def clear_game():
    delete_game_state()
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

    return jsonify({
        "ok": True,
        "old_elo": old_elo,
        "new_elo": new_elo,
        "delta":   delta,
        "bot_elo": bot_elo,
        "player":  player,
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
