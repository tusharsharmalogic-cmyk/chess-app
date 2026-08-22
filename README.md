# ♟️ Chess Analyzer & Play App

Ek full-featured chess web app — **analysis, engine play, bot building aur game review** — sab ek jagah.
Backend **Python (Flask)** + **Stockfish** engine par chalta hai, frontend pure **vanilla JS** (jQuery + chess.js + chessboard.js) par bana hai.

---

## ✨ Features

### 🔍 Position Analysis
- Stockfish engine se position analyze karo (depth 5–20 adjustable)
- Live **evaluation bar** (White vs Black advantage)
- Best move + best line arrows board par
- Board flip, reset, move navigation (⏮ ◀ ▶ ⏭)
- **Set Up Position** tool — custom positions banao with castling rights & turn control

### 📋 PGN / FEN Support
- PGN load/copy, FEN load/copy
- Move history render with navigation
- Imported games manage karo (add, list, delete)

### 🤖 Play vs Bot
- Apne custom bots banao — har phase (Opening / Middlegame / Endgame) ke liye alag:
  - **ELO** (1320–3190)
  - **Depth** (1–20)
  - **Think time** (50–10000 ms)
- Bot JSON import/export (single ya multiple bots, file upload + drag & drop)
- 🎭 **Bot Personalities** — visual personality builder se rules define karo, bots board par dialogue bubbles mein baat karte hain!
- Time control (1–180 min/side), color choice (White / Black / Random)
- Pre-match assists: Undo, Hint, Eval bar, Threat arrows (red), Suggestion arrows (green)
- Unfinished game auto-save → Resume/Discard banner

### ⚔ Bot vs Bot
- Do bots ko aapas mein khilao
- Move delay slider (1–3000 ms), time control optional
- Pause/Resume, Stop, move browsing while paused, live PGN copy

### 📊 Game Review
- SSE-based streaming game analysis
- Move-by-move classification badges (Brilliant, Blunder, etc.)
- Eval graph (canvas chart) per game
- Review history save/load

### 👤 Player Profile & ELO
- Player name + ELO profile
- Match khatam hone par ELO automatically update hoti hai bot ke estimated ELO se compare karke (chess.com-style)

### 📜 History
- Saare games ka record — list, detail view, eval chart, review table
- Multi-select delete, clear all
- Kisi bhi game ko Analysis ya Review mein directly open karo

---

## 🛠 Tech Stack

| Layer | Tech |
|-------|------|
| Backend | Python, Flask |
| Engine | Stockfish |
| Frontend | Vanilla JS, jQuery, chess.js, chessboard.js |
| Styling | Custom CSS (dark themed, JetBrains Mono + Crimson Pro fonts) |
| Data | JSON files (`play_data/`) |

---

## 📁 Project Structure

```
│
├── c.py                  # Flask app init, Stockfish, /ping /analyze /validate_fen
├── helpers.py            # Phase detection, ELO calc, move classification
├── index.html            # HTML skeleton + saare CSS/JS links
│
├── routes/
│   ├── play.py           # Bot CRUD, game state, history, ELO, hints
│   ├── review.py         # SSE game analysis stream, review CRUD
│   └── imported.py       # Imported PGN games
│
├── static/
│   ├── css/
│   │   ├── base.css      # Variables, reset, animations
│   │   ├── board.css     # Board wrapper, eval bar, arrows
│   │   ├── layout.css    # Nav, panel, tabs
│   │   ├── analysis.css  # Analysis card, FEN area, PGN tokens
│   │   ├── play.css      # Play setup UI, toggles, clocks
│   │   ├── panels.css    # History, review tab, dialogue bubbles
│   │   └── chessboard-1.0.0.min.css
│   │
│   └── js/
│       ├── lib/          # jquery.min.js, chess.min.js, chessboard-1.0.0.min.js
│       ├── core/         # board.js, tabs.js
│       ├── play/         # play-setup.js, play-moves.js, play-ui.js, bvb.js
│       ├── analysis/     # pgn.js, review.js
│       └── shared/       # history.js, personality.js
│
└── play_data/            # Auto-generated JSON data (touch mat karna)
```

---

## 🚀 Setup & Run

### Requirements
- Python 3.x
- Flask
- Stockfish engine installed aur PATH mein available

### Install

```bash
pip install flask
```

### Run

```bash
python c.py
```

Phir browser mein kholo: `http://localhost:5000`

> **Note:** Stockfish binary system par installed hona chahiye. Agar nahi hai to [stockfishchess.org](https://stockfishchess.org/download/) se download karo aur PATH mein add karo.

---

## 🔌 API Endpoints (Overview)

| Endpoint | Kaam |
|----------|------|
| `GET /ping` | Health check |
| `POST /analyze` | Stockfish position analysis |
| `POST /validate_fen` | FEN validation |
| `/api/play/*` | Bots, matches, history, ELO, hints |
| `/api/review/*` | SSE review stream + review history |
| `/api/imported/*` | Imported PGN games |

---

Made with ♟️ + ☕
