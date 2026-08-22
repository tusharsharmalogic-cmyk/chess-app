# ♟️ Chess Analyzer & Play App (v7)

Ek full-featured chess web app — **analysis, engine play, bot building, puzzles aur game review** — sab ek jagah.
Backend **Python (Flask) + Stockfish** par chalta hai, frontend pure **vanilla JS** (jQuery + chess.js + chessboard.js) par bana hai.
App specially **Termux/Android** environment ke liye designed hai (`/sdcard/C` base dir), lekin kisi bhi Linux/Mac system par chal jayegi.

---

## ✨ Features

### 🔍 Position Analysis
- Stockfish engine se position analyze karo (depth 5–20 adjustable)
- Live **evaluation bar** (White vs Black advantage)
- Best move + best line arrows board par
- Board flip, reset, move navigation (⏮ ◀ ▶ ⏭)
- **Set Up Position** tool — custom positions with castling rights & turn control

### 📋 PGN / FEN Support
- PGN load/copy, FEN load/copy, move history render with navigation
- 🆕 **Variation tree support** — PGN variations inline render hoti hain, click karke switch karo (🔀 Var chips)
- Imported games manage karo (add, list, delete)

### 🤖 Play vs Bot
- Custom bots — har phase (Opening / Middlegame / Endgame) ke liye alag settings:
  - **ELO** (1320–3190), **Depth** (1–20), **Think time** (50–10000 ms)
  - Opening phase automatically detect hoti hai (Stockfish/Polyglot book se)
- 🧠 **Visual Bot & Personality Builder** (`bot-builder.js`) — bina JSON likhe rule-based bots banao:
  - Triggers: game start/end/win/loss, checkmate delivered, phase transitions, move number, checks, piece captures, castling events, pawn promotion...
  - Har rule mein conditions, duration, actions aur dialogue lines
  - Live JSON preview + copy
- Bot JSON import/export (single ya array, file upload + drag & drop)
- Bots board par **dialogue bubbles** mein baat karte hain (personality engine)
- Time control (1–180 min/side), color choice (White / Black / Random)
- Pre-match assists: Undo, Hint, Eval bar, Threat arrows (red), Suggestion arrows (green)
- Unfinished game auto-save → Resume/Discard banner

### ⚔ Bot vs Bot
- Do bots ko aapas mein khilao — alag-alag personalities ke saath
- Move delay slider (1–3000 ms), optional time control
- Pause/Resume, Stop, paused state mein move browsing, live PGN copy

### 🧩 Tactics Puzzle Mode (NEW)
- **Lichess puzzle API** se puzzles fetch karo ya **CSV puzzle DB import** karo (max 3000 stored)
- Main board par hi solve karo — tap-to-move system
- **Points system**: first solve par max **5 points**
  - −2 agar time ≥ 2 min, −2 per galat attempt (floor 0); re-solve/give-up = 0
- **Daily tracking** — per-day points & solves, plus **Best Day** stats
- Per-puzzle stats: solved status, attempts, best time
- In-game HUD: timer, Give Up, Next unsolved, Exit (tab switch par timer pause)

### 📊 Game Review
- SSE-based streaming game analysis (depth + think-time dono limits ke saath)
- **Lucas Chess classification** — Brilliant !!, Best ✓, Excellent ★, Good ✦, Inaccuracy ?!, Mistake ?, Blunder ??
- Extra labels: Great Move, Mate Blunder, Queen Donation, Free Gift
- Per-move accuracy + game accuracy (RMS method) + estimated Elo from accuracy
- Eval graph (canvas chart), review history save/load
- Analysis tab mein review badges PGN moves par superfix ke roop mein dikhte hain

### 👤 Player Profile & ELO
- Player name + ELO profile, games played counter
- Standard ELO formula (K-factor: <30 games = 40, uske baad 20) — bot ke estimated ELO se chess.com-style update

### 📜 History
- Saare games ka record — list, detail view, eval chart, review table
- Multi-select delete, clear all
- Kisi bhi game ko Analysis ya Review mein directly open karo
- Imported games ka alag section (PGN paste / .pgn/.txt file upload)

---

## 🛠 Tech Stack

| Layer | Tech |
|-------|------|
| Backend | Python 3, Flask, flask-cors |
| Chess logic | python-chess (`chess`, `chess.engine`, `chess.pgn`, `chess.polyglot`) |
| Engine | Stockfish (`STOCKFISH_PATH` env se override possible) |
| Frontend | Vanilla JS, jQuery, chess.js, chessboard.js |
| Styling | Custom dark-theme CSS (JetBrains Mono + Crimson Pro fonts) |
| Pieces | Wikipedia chesspiece sprites (`img/chesspieces/wikipedia/`) |
| Data | Atomic-write JSON files (`play_data/`) |

### Engine internals (v7 highlights)
- **Lucas Chess exact phase detection:**
  - *Opening* → Polyglot `book.bin` (gm2001.bin) hash match; fallback `move ≤ 18`
  - *Endgame* → material weight < 1500 pts **ya** total pieces ≤ 6 (Syzygy rule)
  - *Middlegame* → fallback
- **Classification formulas:** Lichess win% curve, Lucas thresholds, chess.com-style accuracy formula, RMS game accuracy, piecewise Elo-from-accuracy anchors (300–3000)
- **Atomic JSON writes** — Termux/Android par app kill hone par bhi data corrupt nahi hoga

---

## 📁 Project Structure

```
│
├── c.py                  # Flask app init (v7), Stockfish engine, /ping /analyze /validate_fen,
│                         # static serving, blueprints register — port 5050
├── helpers.py            # Phase detection (book.bin/Syzygy), ELO calc, Lucas formulas,
│                         # tactical motifs, strategic tags, quality classification
├── index.html            # HTML skeleton (1291 lines) + saare CSS/JS links
│
├── routes/
│   ├── play.py           # Bot CRUD, personality, game state, history, player profile,
│   │                     # ELO update, bot move, hint, classify, check-opening
│   ├── review.py         # SSE game analysis stream, review history CRUD
│   ├── imported.py       # Imported PGN games — add, list, delete
│   └── puzzles.py        # Puzzle fetch (Lichess API), CSV import, solve/result,
│                         # points + daily tracking + global stats
│
├── img/
│   └── chesspieces/
│       └── wikipedia/    # wK wQ wR wB wN wP / bK bQ bR bB bN bP sprites
│
├── static/
│   ├── css/
│   │   ├── base.css      # CSS variables, reset, body, animations, scrollbar
│   │   ├── board.css     # Board wrapper, eval bar, arrows, tap highlights
│   │   ├── layout.css    # Nav, panel, tabs, status bar, header
│   │   ├── analysis.css  # Analysis card, FEN area, PGN tokens, btn-row
│   │   ├── play.css      # Play setup UI, bot cards, toggles, clocks, game-over
│   │   ├── panels.css    # History list, review tab, dialogue bubbles, ELO chip
│   │   └── chessboard-1.0.0.min.css
│   │
│   └── js/
│       ├── lib/          # jquery.min.js, chess.min.js, chessboard-1.0.0.min.js
│       │
│       ├── core/
│       │   ├── board.js  # Global state, board init, tap system, drag/drop, arrows
│       │   └── tabs.js   # Tab switching, keyboard shortcuts, bot management
│       │
│       ├── play/
│       │   ├── play-setup.js    # startMatch, initPlayBoard, showIngameUI, resume, auto-save
│       │   ├── play-moves.js    # Move handling, bot loop, undo, hint, ELO, history save
│       │   ├── play-ui.js       # Captured pieces, arrows, eval, flip, BvB UI helpers
│       │   ├── bvb.js           # Bot vs Bot — full game loop, clock, browse, pause/stop
│       │   ├── bot-builder.js   # Visual Bot & Personality Builder (rule triggers UI)
│       │   └── puzzles.js       # Tactics puzzle mode — solve HUD, timer, points
│       │
│       ├── analysis/
│       │   ├── pgn.js    # PGN import/parse/render, variation tree, move navigation
│       │   └── review.js # Review tab — analysis, move-by-move, eval chart
│       │
│       └── shared/
│           ├── history.js     # History tab — list, detail, eval chart, save/delete
│           └── personality.js # Bot personality engine + dialogue bubbles
│
└── play_data/            # Auto-generated runtime data (touch mat karna)
    ├── bots.json · profile.json · history.json
    ├── imported.json · review_history.json
    └── puzzles.json (+stats)
```

> **Note:** Production/Termux setup mein `BASE_DIR = /sdcard/C` hota hai — `play_data/` aur `book.bin` wahin rakhe jaate hain.

---

## 🚀 Setup & Run

### Requirements
- Python 3.x
- Flask + flask-cors + python-chess
- Stockfish binary

### Install

```bash
pip install flask flask-cors chess
```

Stockfish:
```bash
# Debian/Ubuntu
sudo apt install stockfish
# Termux (Android)
pkg install stockfish
```

### Run

```bash
python c.py
```

Phir browser mein kholo: **`http://localhost:5050`**

### Optional config
- `STOCKFISH_PATH` env var se custom engine path:
  ```bash
  STOCKFISH_PATH=/path/to/stockfish python c.py
  ```
- Opening book: Polyglot `book.bin` (e.g. gm2001.bin) ko base dir mein rakho — na ho to move-count fallback chalega.

---

## 🔌 API Endpoints

| Endpoint | Kaam |
|----------|------|
| `GET /ping` | Health check (engine status) |
| `POST /analyze` | Stockfish position analysis (best move, score/mate, PV) |
| `POST /validate_fen` | FEN validation |
| `POST /classify` | Single move quality classification |
| `/play/bots` | Bot CRUD (`GET` list, `POST` save) |
| `/play/bots/<id>/personality` | Personality attach/remove |
| `/play/bots/<id>/elo` | Bot estimated ELO update |
| `/play/game` | Current game state (get/save/delete) |
| `/play/history` | Game history CRUD |
| `/play/player` | Player profile get/save |
| `/play/move` | Bot move request |
| `/play/hint` | Hint for current position |
| `/play/result` | Match result → ELO update |
| `/play/check-opening` | One-time opening detection (PGN/FEN-loaded games) |
| `/review/analyze` | SSE streaming full-game review |
| `/review/history` | Review history CRUD |
| `/play/imported` | Imported PGN games CRUD |
| `/puzzles/list` · `/puzzles/stats` | Puzzle list + global/daily stats |
| `/puzzles/fetch` · `/puzzles/import` | Lichess fetch / CSV import |
| `/puzzles/result` | Solve result → points + daily tracking |

---

Made with ♟️ + ☕
