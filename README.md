# ♟️ Chess Analyzer & Play App (v7)

Ek full-featured chess web app — **analysis, engine play, bot building, puzzles, game review aur tournament** — sab ek jagah.
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

### 🎨 Appearance — Piece Styles & Board Colors (NEW)
- **30+ Lichess open-source piece sets** built-in (`img/chesspieces/`) — cburnett, merida, alpha, anarcandy, california, cardinal, celtic, chess7, chessnut, companion, cooke, disguised, dubrovny, fantasy, firi, fresca, gioco, governor, horsey, icpieces, kiwen-suwi, kosal, leipzig, letter, maestro, monarchy, mono, mpchess, papercut, pirouetti, pixel, reillycraig, rhosgfx, riohacha, shahi-ivory-brown, shapes, spatial, staunty, tatiana, totoy, wikipedia, xkcd...
- **Customizable board colors** — light/dark square color pickers (Settings tab se)
- Piece set + board colors backend par save hote hain (`play_data/appearance.json`) — reload par yaad rehte hain
- `/api/piece-sets` endpoint automatically saare available sets list karta hai

### 🤖 Play vs Bot
- Custom bots — har phase (Opening / Middlegame / Endgame) ke liye alag settings:
  - **ELO** (1320–3190), **Depth** (1–20), **Think time** (50–10000 ms)
  - Opening phase automatically detect hoti hai (Stockfish/Polyglot book se)
  - Bot ka estimated ELO match results se same ELO formula se update hota hai
- 🧠 **Visual Bot & Personality Builder** (`bot-builder.js`) — bina JSON likhe rule-based bots banao:
  - Triggers: game start/end/win/loss, checkmate delivered, phase transitions, move number, checks, piece captures, castling events, pawn promotion...
  - Har rule mein conditions, duration, actions aur dialogue lines
  - Live JSON preview + copy
- Bot JSON import/export (single ya array, file upload + drag & drop)
- Bots board par **dialogue bubbles** mein baat karte hain (personality engine)
- Time control (1–180 min/side), color choice (White / Black / Random)
- Pre-match assists: Undo, Hint, Eval bar, Threat arrows (red), Suggestion arrows (green)
- Unfinished game auto-save → Resume/Discard banner
- Make Bot page ke sections ab **collapsible** hain (cleaner UI)

### ⚔ Bot vs Bot
- Do bots ko aapas mein khilao — alag-alag personalities ke saath
- Move delay slider (1–3000 ms), optional time control
- Pause/Resume, Stop, paused state mein move browsing, live PGN copy

### 🏆 Tournament Mode
- Multiple bots ka **round-robin / elimination (Championship knockout)** tournament client-side run hota hai
- Tournament state server par persist hota hai — page reload par bhi resume hoti hai
- Completed tournaments ka **history** (max 50 entries) save hota hai — detail dekho ya multi-select delete
- 🥊 **Duo Fight mode (NEW)** — Bot vs User **score battle**: multiple bots ke against khelo, score-battle history cards ke saath
  - Fair duo tie-break — dono ko extra round milta hai
  - Mid-match resume after restart, tab return par in-game UI restore
  - Duo state server par persist hota hai (`play_data/duo.json`)
- Tournament setup panels cleaner UI + select-mode checkboxes ke saath
- Tournament settings auto-save hoti hain (checkbox/slider change par event delegation)

### 🧩 Tactics Puzzle Mode
- **Lichess puzzle API** se puzzles fetch karo ya **CSV puzzle DB import** karo (max 3000 stored)
- Main board par hi solve karo — tap-to-move system
- **Points system**: first solve par max **5 points**
  - −2 agar time ≥ 2 min, −2 per galat attempt (floor 0); re-solve/give-up = 0 (re-award fix ho chuka hai)
- **Daily tracking** — per-day points & solves, plus **Best Day** stats aur collapsible daily history (last 30 days)
- Per-puzzle stats: solved status, attempts, best time, Copy PGN button
- In-game HUD: timer, Give Up, Next unsolved, Exit (tab switch par timer pause + session restore)
- Collapsible solved/unsolved list, random solve, solution navigator

### 📥 Game Import — Lichess & Chess.com Pull
- **Lichess**: username save karo → public Lichess API se games directly pull karo (no token needed), max games limit configurable
- **Chess.com**: username save karo → public Chess.com API se games pull karo (no token needed)
  - **Month/Year picker** — specific month se games pull karo (blank = last 3 months auto)
- Koi silent cap nahi — purane imported games delete nahi honge
- Pulled games History tab mein available hote hain — Analysis ya Review mein open karo
- 🌐 **Lichess hub page** — official site deep links ke saath quick access

### 👤 Player Profile & ELO
- Player name + ELO profile, games played counter
- **Other Names field** — comma-separated Lichess/Chess.com usernames; pulled games ko aapke naam se match karke win/loss track karta hai
- Standard ELO formula (K-factor: <30 games = 40, uske baad 20) — bot ke estimated ELO se chess.com-style update

### 💾 UI State Persistence (NEW)
- Saare UI states backend par persist hote hain (`/api/play-settings` → `play_data/play_settings.json`):
  - Collapsible sections (Make Bot / Import Bots / Bot Builder / Saved Bots)
  - Play vs Bot toggles (Undo/Hint/Eval bar/Threat/Suggestion)
  - Phase sliders (ELO/Depth/Think time) aur hash slider
  - Suggestion toggle state
- Debounced auto-save (300ms) — har change turant save

### 📊 Game Review
- SSE-based streaming game analysis (depth + think-time dono limits ke saath)
- **Lucas Chess classification** — Brilliant !!, Best ✓, Excellent ★, Good ✦, Inaccuracy ?!, Mistake ?, Blunder ??
- Extra labels: Great Move, Mate Blunder, Queen Donation, Free Gift
- Per-move accuracy + game accuracy (RMS method) + estimated Elo from accuracy
- Eval graph (canvas chart), review history save/load
- Analysis tab mein review badges PGN moves par superfix ke roop mein dikhte hain

### 📜 History
- Saare games ka record — **structured collapsible groups** (Player vs Bot / Bot vs Bot alag-alag sections)
- Multi-select delete, clear all
- Kisi bhi game ko Analysis ya Review mein directly open karo
- Imported games ka alag section (PGN paste / .pgn/.txt file upload)
- **Per-tab board flip memory** — har tab apni flip position yaad rakhta hai

---

## 🛠 Tech Stack

| Layer | Tech |
|-------|------|
| Backend | Python 3, Flask, flask-cors |
| Chess logic | python-chess (`chess`, `chess.engine`, `chess.pgn`, `chess.polyglot`) |
| Engine | Stockfish (`STOCKFISH_PATH` env se override possible) |
| Frontend | Vanilla JS, jQuery, chess.js, chessboard.js |
| Styling | Custom dark-theme CSS (JetBrains Mono + Crimson Pro fonts) |
| Pieces | 30+ Lichess open-source SVG/PNG piece sets (`img/chesspieces/<set>/`) |
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
│                         # /api/appearance /api/play-settings /api/piece-sets,
│                         # static serving, blueprints register — port 5050
├── helpers.py            # Phase detection (book.bin/Syzygy), ELO calc, Lucas formulas,
│                         # tactical motifs, strategic tags, quality classification
├── index.html            # HTML skeleton + saare CSS/JS links
│
├── routes/
│   ├── play.py           # Bot CRUD, personality, game state, history, player profile,
│   │                     # ELO update, bot move, hint, classify, check-opening, bvb-result
│   ├── review.py         # SSE game analysis stream, review history CRUD
│   ├── imported.py       # Imported PGN games — add, list, delete
│   ├── puzzles.py        # Puzzle fetch (Lichess API), CSV import, solve/result,
│   │                     # points + daily tracking + global stats
│   ├── tournament.py     # Tournament state persist/restore, Duo Fight state,
│   │                     # completed tournament history (+delete)
│   ├── lichess_pull.py   # Lichess username save + public API se games pull
│   └── chesscom_pull.py  # Chess.com username save + public API se games pull
│
├── img/
│   └── chesspieces/
│       └── <set>/        # 40+ piece sets (wikipedia, cburnett, merida, fantasy...)
│                         # har set mein wK wQ wR wB wN wP / bK bQ bR bB bN bP
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
│       │   ├── puzzles.js       # Tactics puzzle mode — solve HUD, timer, points
│       │   ├── tournament.js    # Tournament + Duo Fight — pairing, rounds, score battle
│       │   └── lichess.js       # Lichess hub page + games pull UI
│       │
│       ├── analysis/
│       │   ├── pgn.js    # PGN import/parse/render, variation tree, move navigation
│       │   └── review.js # Review tab — analysis, move-by-move, eval chart
│       │
│       └── shared/
│           ├── history.js       # History tab — grouped list, detail, eval chart, save/delete
│           ├── personality.js   # Bot personality engine + dialogue bubbles
│           └── play-settings.js # UI state persistence → /api/play-settings
│
└── play_data/            # Auto-generated runtime data (touch mat karna)
    ├── bots.json · profile.json · history.json
    ├── imported.json · imported_games.json · review_history.json
    ├── puzzles.json (+stats)
    ├── tournament.json · duo.json · tournament_history.json
    ├── lichess_pull.json · chesscom_pull.json
    ├── appearance.json · play_settings.json
    └── *.corrupt         # Atomic-write backup (app kill mid-save par)
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
- Opening book: Polyglot `book.bin` (e.g. gm2001.bin) ko base dir (`/sdcard/C/`) mein rakho — na ho to move-count fallback chalega.

---

## 🔌 API Endpoints

| Endpoint | Kaam |
|----------|------|
| `GET /ping` | Health check (engine status) |
| `POST /analyze` | Stockfish position analysis (best move, score/mate, PV) |
| `POST /validate_fen` | FEN validation |
| `POST /classify` | Single move quality classification |
| `GET/POST /api/appearance` | Piece set + board colors get/save |
| `GET /api/piece-sets` | Available piece sets ki list |
| `GET/POST /api/play-settings` | UI states persist/restore |
| `/play/bots` | Bot CRUD (`GET` list, `POST` save) |
| `/play/bots/<id>` | `DELETE` single bot |
| `/play/bots/<id>/personality` | Personality attach/remove |
| `/play/bots/<id>/elo` | Bot estimated ELO update |
| `/play/game` | Current game state (get/save/delete) |
| `/play/history` | Game history CRUD |
| `/play/player` | Player profile get/save |
| `/play/move` | Bot move request |
| `/play/hint` | Hint for current position |
| `/play/result` | Match result → ELO update |
| `/play/bvb-result` | Bot vs Bot result save |
| `/play/check-opening` | One-time opening detection (PGN/FEN-loaded games) |
| `/review/analyze` | SSE streaming full-game review |
| `/review/history` | Review history CRUD |
| `/play/imported` | Imported PGN games CRUD |
| `/puzzles/list` · `/puzzles/stats` | Puzzle list + global/daily stats |
| `/puzzles/fetch` · `/puzzles/import` | Lichess fetch / CSV import |
| `/puzzles/result` | Solve result → points + daily tracking |
| `/play/tournament` | Tournament state get/save/delete |
| `/play/duo` | Duo Fight state get/save/delete |
| `/play/tournament/history` | Completed tournament history (get/add) |
| `/play/tournament/history/delete` | Tournament history entries delete (ids list) |
| `/lichess/username` | Lichess username save/get |
| `/lichess/pull-games` | Lichess se games pull karo |
| `/chesscom/username` | Chess.com username save/get |
| `/chesscom/pull-games` | Chess.com se games pull karo |

---

Made with ♟️ + ☕
