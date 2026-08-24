"""
c.py — Chess Analyzer Backend  (v7 — Lucas Chess Phase Detection)
Run: python c.py
Requires: pip install flask flask-cors chess
Termux: pkg install stockfish

New in v7:
  - Lucas Chess exact phase detection logic:
    * Opening   → Polyglot book.bin hash match (gm2001.bin)
    * Endgame   → material weight < 1500 pts OR total pieces <= 6 (Syzygy rule)
    * Middlegame→ fallback (not opening, not endgame)
  - book.bin must be at /sdcard/C/book.bin
  - Fallback to move_count <= 18 if book.bin not found
"""

import os
import chess
import chess.engine
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS

from routes.play     import play_bp
from routes.review   import review_bp
from routes.imported import imported_bp
from routes.puzzles  import puzzles_bp
from routes.lichess_pull import lichess_pull_bp
from routes.chesscom_pull import chesscom_pull_bp

# ── Config ────────────────────────────────────────────────────────────────────

BASE_DIR = "/sdcard/C"
DATA_DIR = os.path.join(BASE_DIR, "play_data")
os.makedirs(DATA_DIR, exist_ok=True)

STOCKFISH_PATH = os.environ.get("STOCKFISH_PATH", "stockfish")

# ── App init ──────────────────────────────────────────────────────────────────

app = Flask(__name__)
CORS(app)

# ── Engine (shared, lazy init) ────────────────────────────────────────────────

_engine = None


def get_engine():
    global _engine
    if _engine is None:
        try:
            _engine = chess.engine.SimpleEngine.popen_uci(STOCKFISH_PATH)
        except Exception as e:
            return None, str(e)
    return _engine, None


# ── Register blueprints ───────────────────────────────────────────────────────

app.register_blueprint(play_bp)
app.register_blueprint(review_bp)
app.register_blueprint(imported_bp)
app.register_blueprint(puzzles_bp)
app.register_blueprint(lichess_pull_bp)
app.register_blueprint(chesscom_pull_bp)

from routes.tournament import tournament_bp
app.register_blueprint(tournament_bp)

# ── Static file serving ───────────────────────────────────────────────────────

@app.route("/")
def index():
    return send_from_directory(BASE_DIR, "index.html")


@app.route("/static/<path:filename>")
def static_files(filename):
    return send_from_directory(os.path.join(BASE_DIR, "static"), filename)


@app.route("/<path:filename>")
def root_files(filename):
    # Fallback for any root-level files (e.g. favicon)
    return send_from_directory(BASE_DIR, filename)


# ── Core API routes ───────────────────────────────────────────────────────────

@app.route("/api/piece-sets")
def piece_sets():
    # img/chesspieces/ ke saare subfolders (piece style sets), alphabetically sorted
    base = os.path.join(BASE_DIR, "img", "chesspieces")
    try:
        sets = sorted(
            d for d in os.listdir(base)
            if os.path.isdir(os.path.join(base, d))
        )
    except Exception:
        sets = ["wikipedia"]
    return jsonify(sets)


@app.route("/ping")
def ping():
    engine, err = get_engine()
    if engine is None:
        return jsonify({"ok": False, "error": err}), 500
    return jsonify({"ok": True, "engine": "Stockfish"})


@app.route("/analyze", methods=["POST"])
def analyze():
    data = request.get_json()
    fen  = data.get("fen", chess.STARTING_FEN)
    try:
        depth = min(int(data.get("depth", 12)), 20)
    except (ValueError, TypeError):
        depth = 12

    engine, err = get_engine()
    if engine is None:
        return jsonify({"error": f"Engine not available: {err}"}), 500

    try:
        board = chess.Board(fen)
    except Exception:
        return jsonify({"error": "Invalid FEN"}), 400

    try:
        result = engine.analyse(board, chess.engine.Limit(depth=depth), multipv=1)
    except Exception as e:
        global _engine
        if _engine:
            try:
                _engine.quit()
            except Exception:
                pass
        _engine = None
        return jsonify({"error": str(e)}), 500

    info      = result[0] if isinstance(result, list) else result
    score_obj = info["score"].white()

    if score_obj.is_mate():
        mate_in  = score_obj.mate()
        score_cp = None
    else:
        mate_in  = None
        score_cp = score_obj.score()

    best_move = str(info.get("pv", [None])[0]) if info.get("pv") else None
    pv_moves  = [str(m) for m in info.get("pv", [])[:6]]

    return jsonify({
        "best_move": best_move,
        "score":     score_cp,
        "mate":      mate_in,
        "pv":        pv_moves,
        "depth":     info.get("depth", depth),
    })


@app.route("/validate_fen", methods=["POST"])
def validate_fen():
    data = request.get_json()
    fen  = data.get("fen", "")
    try:
        chess.Board(fen)
        return jsonify({"valid": True})
    except Exception as e:
        return jsonify({"valid": False, "error": str(e)})


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("Chess Analyzer backend -- v7 (Lucas Chess Phase Detection)")
    print("Termux -> pkg install stockfish")
    print("Open  -> http://localhost:5050")
    app.run(host="0.0.0.0", port=5050, debug=False)
