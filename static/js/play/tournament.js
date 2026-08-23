// ============================================================
// tournament.js — 🏆 Championship (Knockout)
//
// - USER + bots, size 4/8/16 (4 × 2^n), random fixed pairing
// - Bot-vs-bot matches reuse the BvB engine (personality bubbles work)
// - USER matches reuse the Play-vs-Bot engine
// - Draw → rematch same pairing until decisive
// - User eliminated → Watch / Skip / New Tournament
// - State persisted via /play/tournament
// ============================================================

let T = null;                // tournament state (persisted)
let tourBots = [];           // cached full bot objects for current session
let _tourActiveBvb = null;   // {roundIdx, matchIdx, w: playerRef, b: playerRef} while a bot match runs
let _tourAutoTimer = null;

const TOUR_START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

function _userRef() {
  return {
    type: 'user',
    id: 'user',
    name: ((typeof playerProfile !== 'undefined' && playerProfile && playerProfile.name) ? playerProfile.name : 'You'),
    elo: (typeof playerProfile !== 'undefined' && playerProfile) ? (playerProfile.elo || 1200) : 1200,
  };
}

function _botElo(b) { return b.bot_elo || b.uci_elo || 1200; }

// ── Persistence ───────────────────────────────────────────────

async function _tourSave() {
  try {
    await fetch(`${FLASK_URL}/play/tournament`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tournament: T }),
    });
  } catch(e) { /* ignore */ }
}

async function tourInit() {
  try {
    const res = await fetch(`${FLASK_URL}/play/tournament`);
    const data = await res.json();
    T = data.tournament || null;
  } catch(e) { T = null; }
  renderTournaments();
}

// ── Helpers ───────────────────────────────────────────────────

function _roundLabel(roundIdx) {
  const matchesLeft = T.rounds.length - roundIdx; // rounds remaining incl. this one
  if (matchesLeft === 1) return '🏆 Final';
  if (matchesLeft === 2) return '⚔ Semifinal';
  return `Round ${roundIdx + 1}`;
}

function _pName(p) { return p ? p.name : '?'; }

function _currentMatch() {
  if (!T || T.status !== 'active') return null;
  const round = T.rounds[T.roundIdx];
  if (!round) return null;
  const idx = round.findIndex(m => !m.winner);
  if (idx === -1) return null;
  return { roundIdx: T.roundIdx, matchIdx: idx, match: round[idx] };
}

function _isUserMatch(m) { return m.p1.type === 'user' || m.p2.type === 'user'; }

function _simWinner(a, b) {
  // Elo logistic — no draws in simulation
  const ea = 1 / (1 + Math.pow(10, (b.elo - a.elo) / 400));
  return Math.random() < ea ? 'p1' : 'p2';
}

function _tourStopAuto() {
  if (_tourAutoTimer) { clearTimeout(_tourAutoTimer); _tourAutoTimer = null; }
}

// ── Setup panel actions ───────────────────────────────────────

async function renderTournaments() {
  const root = document.getElementById('tour-root');
  if (!root) return;

  // Clean up any lingering in-game UI when viewing the tournaments page
  document.getElementById('clock-top-row')?.classList.remove('show');
  document.getElementById('clock-bottom-row')?.classList.remove('show');
  document.getElementById('copy-pgn-btn')?.classList.remove('show', 'pulse');
  document.getElementById('game-over-banner')?.classList.remove('show');
  document.getElementById('bvb-ingame-controls').style.display = 'none';
  hideAllDialogueBubbles();

  if (!T) {
    await _renderSetup(root);
    return;
  }

  if (T.status === 'setup') { await _renderSetup(root); return; }
  if (T.status === 'complete') { _renderChampion(root); return; }
  _renderBracket(root);
}

async function _fetchTourData() {
  try {
    const [botsRes, plRes] = await Promise.all([
      fetch(`${FLASK_URL}/play/bots`),
      fetch(`${FLASK_URL}/play/player`),
    ]);
    const botsData = await botsRes.json();
    const plData   = await plRes.json().catch(() => ({ player: null }));
    if (plData.player) {
      if (typeof playerProfile !== 'undefined' && playerProfile) {
        playerProfile.name = plData.player.name;
        playerProfile.elo = plData.player.elo;
      }
    }
    return botsData.bots || [];
  } catch(e) { return []; }
}

async function _renderSetup(root) {
  tourBots = await _fetchTourData();
  const userElo = (typeof playerProfile !== 'undefined' && playerProfile) ? (playerProfile.elo || 1200) : 1200;
  const s = T ? (T.settings || {}) : {};
  const size = s.size || 8;
  const customOn = !!s.customSelect;
  const eloRangeOn = !!s.eloRangeOn;
  const eloTarget = s.eloTarget || userElo;

  const botChecks = tourBots.map(b => `
    <label style="display:flex;align-items:center;gap:6px;font-size:11px;padding:3px 0;color:var(--text1)">
      <input type="checkbox" class="tour-bot-check" value="${b.id}"
        ${(s.chosenBotIds || []).includes(b.id) ? 'checked' : ''}>
      ${escHtmlHtml(b.name)} <span style="color:var(--text3)">(~${_botElo(b)})</span>${b.personality ? ' 🎭' : ''}
    </label>`).join('');

  root.innerHTML = `
    <div class="play-section">
      <div class="play-section-header">🏆 Championship
        <span style="float:right;font-size:10px;font-weight:400;color:var(--text3)">Knockout · Draw = Rematch</span>
      </div>
      <div class="play-section-body" style="gap:12px">

        <div>
          <div style="font-size:11px;color:var(--text2);margin-bottom:4px">Tournament Size — <b id="tour-size-label">${size}</b> players</div>
          <input type="range" min="0" max="2" step="1" value="${[4,8,16].indexOf(size)}" id="tour-size-slider"
            oninput="tourSetSize(this.value)" style="width:100%">
          <div style="display:flex;justify-content:space-between;font-size:9px;color:var(--text3)">
            <span>4</span><span>8</span><span>16</span>
          </div>
          <div style="font-size:10px;color:var(--text3);margin-top:2px">You are always a participant · Max <b>${size - 1}</b> bots needed</div>
        </div>

        <label style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text1)">
          <input type="checkbox" id="tour-custom-toggle" ${customOn ? 'checked' : ''} onchange="tourToggleCustom(this.checked)">
          🎯 Particular bot selection (choose bots yourself)
        </label>
        <div id="tour-custom-box" style="display:${customOn ? 'block' : 'none'};max-height:150px;overflow-y:auto;border:1px solid var(--border,#333);border-radius:6px;padding:6px 10px">
          ${botChecks || '<div style="font-size:11px;color:var(--text3)">Koi bot nahi — pehle Make Bot se banao!</div>'}
        </div>

        <label style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text1)">
          <input type="checkbox" id="tour-elorange-toggle" ${eloRangeOn ? 'checked' : ''} onchange="tourToggleEloRange(this.checked)">
          📊 Custom Elo target (default: tumhari Elo ke aas-paas)
        </label>
        <div id="tour-elorange-box" style="display:${eloRangeOn ? 'flex' : 'none'};align-items:center;gap:8px;font-size:11px;color:var(--text2)">
          Target Elo:
          <input type="number" id="tour-elo-target" value="${eloTarget}" min="100" max="4000"
            style="width:80px;background:var(--bg2,#222);border:1px solid var(--border,#444);border-radius:6px;padding:4px 8px;color:var(--text1)">
        </div>

        <div style="border-top:1px solid var(--border,#333);padding-top:10px">
          <div style="font-size:11px;font-weight:700;color:var(--accent);margin-bottom:8px">♟ YOUR MATCH SETTINGS</div>
          <label style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text1)">
            <input type="checkbox" id="tour-user-time-on" ${s.userTimeOn ? 'checked' : ''}>
            ⏱ Time control — <input type="number" id="tour-user-time-min" value="${s.userMinutes || 10}" min="1" max="180" style="width:60px;background:var(--bg2,#222);border:1px solid var(--border,#444);border-radius:6px;padding:3px 6px;color:var(--text1)"> min
          </label>
          <div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:8px;font-size:11px;color:var(--text1)">
            <label style="display:flex;align-items:center;gap:4px"><input type="checkbox" id="tour-feat-undo" ${s.featUndo !== false ? 'checked' : ''}>↩ Undo</label>
            <label style="display:flex;align-items:center;gap:4px"><input type="checkbox" id="tour-feat-hint" ${s.featHint !== false ? 'checked' : ''}>💡 Hint</label>
            <label style="display:flex;align-items:center;gap:4px"><input type="checkbox" id="tour-feat-evalbar" ${s.featEvalbar ? 'checked' : ''}>📊 Eval</label>
            <label style="display:flex;align-items:center;gap:4px"><input type="checkbox" id="tour-feat-threat" ${s.featThreat ? 'checked' : ''}>⚠ Threat</label>
            <label style="display:flex;align-items:center;gap:4px"><input type="checkbox" id="tour-feat-suggestion" ${s.featSuggestion !== false ? 'checked' : ''}>➡ Suggestion</label>
          </div>
          <textarea class="play-input" id="tour-user-start-pgn" placeholder="Your matches starting PGN (empty = normal start)" style="min-height:44px;resize:vertical;margin-top:8px;font-size:11px">${s.userStartPgn || ''}</textarea>
        </div>

        <div style="border-top:1px solid var(--border,#333);padding-top:10px">
          <div style="font-size:11px;font-weight:700;color:var(--accent);margin-bottom:8px">⚔ BOT MATCH SETTINGS</div>
          <label style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text1)">
            <input type="checkbox" id="tour-bvb-time-on" ${s.bvbTimeOn ? 'checked' : ''}>
            ⏱ Time control — <input type="number" id="tour-bvb-time-min" value="${s.bvbMinutes || 5}" min="1" max="180" style="width:60px;background:var(--bg2,#222);border:1px solid var(--border,#444);border-radius:6px;padding:3px 6px;color:var(--text1)"> min
          </label>
          <div style="font-size:11px;color:var(--text2);margin-top:8px">Move delay: <b id="tour-bvb-delay-label">${s.bvbDelay ?? 500}</b>ms</div>
          <input type="range" min="100" max="3000" step="50" value="${s.bvbDelay ?? 500}" id="tour-bvb-delay"
            oninput="document.getElementById('tour-bvb-delay-label').textContent=this.value" style="width:100%">
          <textarea class="play-input" id="tour-bvb-start-pgn" placeholder="Bot matches starting PGN (empty = normal start)" style="min-height:44px;resize:vertical;margin-top:8px;font-size:11px">${s.bvbStartPgn || ''}</textarea>
        </div>

        <button class="btn primary" onclick="startTournament()">🚀 Generate Tournament</button>
      </div>
    </div>

    <div class="play-section">
      <div class="play-section-header">⚔ Duo Fight</div>
      <div class="play-section-body" style="text-align:center;padding:18px 10px">
        <div style="font-size:11px;color:var(--text3)">2v2 team battles — coming soon 🚧</div>
      </div>
    </div>

    <div style="text-align:center;margin-top:4px">
      <span style="font-size:10px;color:var(--accent);cursor:pointer" onclick="renderTourHistoryView()">📜 Tournament History</span>
    </div>
  `;
}

// escHtml lives inside tabs.js scope? No — it's global there; but be safe:
function escHtmlHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function tourSetSize(v) {
  const size = [4, 8, 16][parseInt(v)] || 8;
  const lbl = document.getElementById('tour-size-label');
  if (lbl) lbl.textContent = size;
}

function tourToggleCustom(on) {
  const box = document.getElementById('tour-custom-box');
  if (box) box.style.display = on ? 'block' : 'none';
}

function tourToggleEloRange(on) {
  const box = document.getElementById('tour-elorange-box');
  if (box) box.style.display = on ? 'flex' : 'none';
}

// ── Create tournament ────────────────────────────────────────

async function startTournament() {
  if (T && T.status === 'active' && !confirm('Current tournament abandon karke naya start karein?')) return;

  tourBots = await _fetchTourData();

  const slider = document.getElementById('tour-size-slider');
  const size = [4, 8, 16][parseInt(slider?.value ?? 1)] || 8;
  const customOn = document.getElementById('tour-custom-toggle')?.checked;
  const eloRangeOn = document.getElementById('tour-elorange-toggle')?.checked;
  const eloTarget = parseInt(document.getElementById('tour-elo-target')?.value) ||
    ((typeof playerProfile !== 'undefined' && playerProfile) ? playerProfile.elo : 1200);

  const matchSettings = {
    userTimeOn:   !!document.getElementById('tour-user-time-on')?.checked,
    userMinutes:  Math.max(1, Math.min(180, parseInt(document.getElementById('tour-user-time-min')?.value) || 10)),
    userStartPgn: (document.getElementById('tour-user-start-pgn')?.value || '').trim(),
    featUndo:       !!document.getElementById('tour-feat-undo')?.checked,
    featHint:       !!document.getElementById('tour-feat-hint')?.checked,
    featEvalbar:    !!document.getElementById('tour-feat-evalbar')?.checked,
    featThreat:     !!document.getElementById('tour-feat-threat')?.checked,
    featSuggestion: !!document.getElementById('tour-feat-suggestion')?.checked,
    bvbTimeOn:   !!document.getElementById('tour-bvb-time-on')?.checked,
    bvbMinutes:  Math.max(1, Math.min(180, parseInt(document.getElementById('tour-bvb-time-min')?.value) || 5)),
    bvbDelay:    Math.max(100, parseInt(document.getElementById('tour-bvb-delay')?.value) || 500),
    bvbStartPgn: (document.getElementById('tour-bvb-start-pgn')?.value || '').trim(),
  };

  let chosenBots;
  if (customOn) {
    const ids = [...document.querySelectorAll('.tour-bot-check:checked')].map(el => el.value);
    if (ids.length !== size - 1) {
      alert(`Custom selection mein exactly ${size - 1} bots select karo (abhi ${ids.length} selected).`);
      return;
    }
    chosenBots = ids.map(id => tourBots.find(b => b.id === id)).filter(Boolean);
  } else {
    const sorted = [...tourBots].sort((a, b) =>
      Math.abs(_botElo(a) - eloTarget) - Math.abs(_botElo(b) - eloTarget));
    chosenBots = sorted.slice(0, size - 1);
    if (chosenBots.length < size - 1) {
      alert(`Sirf ${chosenBots.length} bots available hain — is tournament ke liye ${size - 1} chahiye. Pehle aur bots banao!`);
      return;
    }
  }

  // Build participants & shuffle pairing order
  const participants = [_userRef(),
    ...chosenBots.map(b => ({ type: 'bot', id: b.id, name: b.name, elo: _botElo(b) }))];
  for (let i = participants.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [participants[i], participants[j]] = [participants[j], participants[i]];
  }

  const firstRound = [];
  for (let i = 0; i < participants.length; i += 2) {
    firstRound.push({ p1: participants[i], p2: participants[i + 1], winner: null, games: 0 });
  }

  T = {
    status: 'active',
    size,
    settings: { size, customSelect: !!customOn, chosenBotIds: customOn ? chosenBots.map(b => b.id) : [], eloRangeOn: !!eloRangeOn, eloTarget, ...matchSettings },
    rounds: [firstRound],
    roundIdx: 0,
    watching: false,
    userEliminated: false,
    champion: null,
    created: Date.now(),
  };

  await _tourSave();
  renderTournaments();
}

// ── Bracket rendering ─────────────────────────────────────────

function _matchRowHtml(m, roundIdx, matchIdx, cur) {
  const isCur = cur && cur.roundIdx === roundIdx && cur.matchIdx === matchIdx;
  const done = !!m.winner;
  const wName = done ? _pName(m.winner === 'p1' ? m.p1 : m.p2) : null;
  const lName = done ? _pName(m.winner === 'p1' ? m.p2 : m.p1) : null;

  let resultLine;
  if (done) {
    resultLine = `<span style="color:var(--accent2)">✅ ${escHtmlHtml(wName)}</span> def. <span style="color:var(--text3);text-decoration:line-through">${escHtmlHtml(lName)}</span>`;
  } else {
    resultLine = `${escHtmlHtml(_pName(m.p1))} <span style="color:var(--text3)">vs</span> ${escHtmlHtml(_pName(m.p2))}`;
  }

  const badge = m.games > 1 ? `<span style="font-size:9px;color:var(--danger)">↻${m.games}</span>` : '';
  const bg = isCur ? 'var(--accent)' : done ? 'transparent' : 'var(--bg2,#1c1c1c)';
  const fg = isCur ? '#000' : '';
  const border = isCur ? '1px solid var(--accent)' : '1px solid var(--border,#333)';

  return `<div style="padding:5px 10px;border-radius:6px;border:${border};background:${bg};color:${fg};font-size:11px;display:flex;justify-content:space-between;gap:6px">
    <span>${resultLine}</span><span>${badge}</span></div>`;
}

function _renderBracket(root) {
  const cur = _currentMatch();
  let html = '';

  // Round sections
  T.rounds.forEach((round, ri) => {
    const anyDone = round.some(m => m.winner);
    const isFuture = ri > T.roundIdx;
    html += `<div class="play-section">
      <div class="play-section-header">${_roundLabel(ri)}
        ${isFuture ? '<span style="float:right;font-size:10px;font-weight:400;color:var(--text3)">pending</span>' :
          (cur && cur.roundIdx === ri ? `<span style="float:right;font-size:10px;font-weight:400;color:var(--accent)">in progress</span>` : '')}
      </div>
      <div class="play-section-body" style="gap:5px;opacity:${isFuture ? 0.45 : 1}">
        ${round.map((m, mi) => _matchRowHtml(m, ri, mi, cur)).join('')}
      </div>
    </div>`;
  });

  // Controls
  if (!T.userEliminated && cur) {
    if (_isUserMatch(cur.match)) {
      html += `<div class="play-section"><div class="play-section-body" style="gap:8px">
        <div style="font-size:12px;color:var(--accent);font-weight:600">🎯 Tumhari match hai! ${escHtmlHtml(cur.match.p1.name)} vs ${escHtmlHtml(cur.match.p2.name)}</div>
        <button class="btn primary" onclick="tourPlayUserMatch()">▶ Play Match</button>
      </div></div>`;
    } else {
      html += `<div class="play-section"><div class="play-section-body" style="gap:8px">
        <div style="font-size:11px;color:var(--text3)">Next up: ${escHtmlHtml(cur.match.p1.name)} vs ${escHtmlHtml(cur.match.p2.name)}</div>
        <div class="btn-row">
          <button class="btn primary" onclick="tourWatch()">👀 Watch Next Match</button>
          <button class="btn" onclick="tourSkip()">⏭ Skip to Result</button>
        </div>
      </div></div>`;
    }
  } else if (T.userEliminated && cur) {
    html += `<div class="play-section"><div class="play-section-body" style="gap:8px">
      <div style="font-size:12px;color:var(--danger);font-weight:600">❌ Tum eliminate ho gaye!</div>
      <div class="btn-row">
        <button class="btn primary" onclick="tourWatch()">👀 Watch Tournament</button>
        <button class="btn" onclick="tourSkip()">⏭ Skip Tournament</button>
        <button class="btn danger" onclick="abandonTournament(true)">🆕 New Tournament</button>
      </div>
    </div></div>`;
  } else if (cur) {
    // Draw rematch pending (user match)
    html += `<div class="play-section"><div class="play-section-body" style="gap:8px">
      <div style="font-size:12px;color:var(--text2)">🔁 Draw hua — rematch zaroori hai! (${cur.match.games} games played)</div>
      <button class="btn primary" onclick="tourPlayUserMatch()">🔁 Rematch</button>
    </div></div>`;
  }

  // Abandon link during active play
  html += `<div style="text-align:center;margin-top:6px">
    <span style="font-size:10px;color:var(--danger);cursor:pointer" onclick="abandonTournament(false)">🗑 Abandon tournament</span>
    <span style="font-size:10px;color:var(--text3)"> · </span>
    <span style="font-size:10px;color:var(--accent);cursor:pointer" onclick="renderTourHistoryView()">📜 Tournament History</span>
  </div>`;

  root.innerHTML = html;
}

function _renderChampion(root) {
  const champ = T.champion;
  const isUserChampion = champ && champ.type === 'user';
  root.innerHTML = `
    <div class="play-section" style="text-align:center;padding:40px 20px">
      <div style="font-size:64px;margin-bottom:12px">🏆</div>
      <div style="font-size:22px;font-weight:800;color:var(--accent)">${escHtmlHtml(champ ? champ.name : '?')}</div>
      <div style="font-size:12px;color:var(--text2);margin:6px 0 20px">
        ${isUserChampion ? '🎉 Tum Tournament CHAMPION ho!' : 'Tournament Champion'}
        ${champ && champ.type === 'bot' ? ` (~${champ.elo})` : ''}
      </div>
      <div class="btn-row" style="justify-content:center">
        <button class="btn primary" onclick="abandonTournament(false)">🆕 New Tournament</button>
        <button class="btn" onclick="tourViewBracket()">📋 View Bracket</button>
        <button class="btn" onclick="renderTourHistoryView()">📜 History</button>
      </div>
    </div>
    <div class="play-section">
      ${T.rounds.map((round, ri) => `<div class="play-section-header" style="margin-top:-1px">${_roundLabel(ri)}</div>
      <div class="play-section-body" style="gap:5px">
        ${round.map((m, mi) => _matchRowHtml(m, ri, mi, null)).join('')}
      </div>`).join('')}
    </div>`;
}

// Champion view se poora bracket dekhne ke liye (back button ke saath)
function tourViewBracket() {
  const root = document.getElementById('tour-root');
  if (!root || !T) return;
  root.innerHTML = `
    <div class="play-section" style="text-align:center;padding:14px">
      <div style="font-size:14px;font-weight:700;color:var(--accent)">🏆 ${T.champion ? escHtmlHtml(T.champion.name) : ''} — Champion</div>
      <button class="btn sm" style="margin-top:8px" onclick="renderTournaments()">↩ Back</button>
    </div>
    ${T.rounds.map((round, ri) => `<div class="play-section">
      <div class="play-section-header">${_roundLabel(ri)}</div>
      <div class="play-section-body" style="gap:5px">
        ${round.map((m, mi) => _matchRowHtml(m, ri, mi, null)).join('')}
      </div>
    </div>`).join('')}`;
}

// ── Match progression core ────────────────────────────────────

function _recordWinner(roundIdx, matchIdx, side) {
  const m = T.rounds[roundIdx][matchIdx];
  m.winner = side;

  // Round complete?
  const round = T.rounds[roundIdx];
  if (round.every(x => x.winner)) {
    const winners = round.map(x => x.winner === 'p1' ? x.p1 : x.p2);
    if (winners.length === 1) {
      T.status = 'complete';
      T.champion = winners[0];
      if (winners[0].type === 'bot') T.userEliminated = true;
      if (!T.archived) { T.archived = true; _archiveTournament(); }
    } else {
      const next = [];
      for (let i = 0; i < winners.length; i += 2) {
        next.push({ p1: winners[i], p2: winners[i + 1], winner: null, games: 0 });
      }
      T.rounds.push(next);
      T.roundIdx = roundIdx + 1;
    }
  }

  // Track user elimination
  if (side && !_isUserIn(T)) T.userEliminated = true;
}

// ── Archive completed tournament → history ────────────────────

function _computeTop5(tState) {
  const st = {};
  const key = p => p.type + ':' + p.id;
  tState.rounds.forEach((round, ri) => {
    round.forEach(m => {
      [m.p1, m.p2].forEach(p => {
        if (!st[key(p)]) st[key(p)] = { name: p.name, elo: p.elo, type: p.type, wins: 0, out: ri };
      });
      if (m.winner) {
        const w = m.winner === 'p1' ? m.p1 : m.p2;
        const l = m.winner === 'p1' ? m.p2 : m.p1;
        if (st[key(w)]) st[key(w)].wins++;
        if (st[key(l)]) st[key(l)].out = ri;
      }
    });
  });
  // Champion sabse door tak pahuncha
  if (tState.champion && st[tState.champion.type + ':' + tState.champion.id]) {
    st[tState.champion.type + ':' + tState.champion.id].out = tState.rounds.length;
  }
  return Object.values(st)
    .sort((a, b) => (b.out - a.out) || (b.wins - a.wins))
    .slice(0, 5);
}

async function _archiveTournament() {
  if (!T || T.status !== 'complete') return;

  const matches = [];
  T.rounds.forEach((round, ri) => {
    round.forEach(m => {
      matches.push({
        round: _roundLabel(ri),
        p1: m.p1.name,
        p2: m.p2.name,
        winner: m.winner ? (m.winner === 'p1' ? m.p1.name : m.p2.name) : null,
      });
    });
  });

  const entry = {
    id: Date.now(),
    finishedAt: Date.now(),
    size: T.size,
    champion: T.champion ? { name: T.champion.name, type: T.champion.type, elo: T.champion.elo } : null,
    userWon: !!(T.champion && T.champion.type === 'user'),
    matches,
    top5: _computeTop5(T),
  };

  try {
    await fetch(`${FLASK_URL}/play/tournament/history`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entry }),
    });
  } catch(e) { /* ignore */ }
}

function _isUserIn(tState) {
  if (!tState) return false;
  if (tState.champion && tState.champion.type === 'user') return true;
  for (const round of tState.rounds) {
    for (const m of round) {
      if (!m.winner && (m.p1.type === 'user' || m.p2.type === 'user')) return true;
    }
  }
  return false;
}

async function _afterMatchResolved() {
  await _tourSave();
  const nxt = _currentMatch();

  if (T.status === 'complete' || !nxt) {
    tourReturnToBracket();
    renderTournaments();
    return;
  }

  if (_isUserMatch(nxt.match)) {
    // User ka turn — bracket par le aao, prompt dikhega
    tourReturnToBracket();
    renderTournaments();
    setPlayStatus('🏆 Your tournament match is ready!');
    return;
  }

  if (T.watching) {
    // Auto-play next bot match thodi der baad
    tourReturnToBracket();
    renderTournaments();
    _tourAutoTimer = setTimeout(() => tourStartBotMatch(nxt), 2200);
    return;
  }

  renderTournaments();
}

// ── UI transitions ────────────────────────────────────────────

function _showBoardForPlay() {
  document.body.classList.remove('play-board-hidden');
  document.getElementById('play-subnav').style.display = 'none';
  ['makebot','playbot','botvsbot','tournaments','history'].forEach(p => {
    const el = document.getElementById('play-page-' + p);
    if (el) el.classList.remove('active');
  });
}

function tourReturnToBracket() {
  _tourStopAuto();
  document.getElementById('bvb-ingame-controls').style.display = 'none';
  document.getElementById('ingame-controls').classList.remove('show');
  document.getElementById('clock-top-row').classList.remove('show');
  document.getElementById('clock-bottom-row').classList.remove('show');
  document.getElementById('copy-pgn-btn').classList.remove('show', 'pulse');
  document.getElementById('bvb-game-over-banner').style.display = 'none';
  document.getElementById('game-over-banner')?.classList.remove('show');
  ['cap-top-pieces','cap-bottom-pieces'].forEach(id => {
    const el = document.getElementById(id); if (el) el.innerHTML = '';
  });
  hideAllDialogueBubbles();
  hideBvbTurnDots();
  playSubSwitch('tournaments');
  updatePlayBoardVisibility?.();
}

// ── Bot vs Bot match (reuses BvB machinery + personality bubbles) ──

async function tourStartBotMatch(nxt) {
  const match = nxt.match;
  const roundIdx = nxt.roundIdx, matchIdx = nxt.matchIdx;

  // Random colours each game
  const wP = Math.random() < 0.5 ? match.p1 : match.p2;
  const bP = wP === match.p1 ? match.p2 : match.p1;

  // Full bot objects for personality engines
  try {
    const res = await fetch(`${FLASK_URL}/play/bots`);
    tourBots = (await res.json()).bots || [];
  } catch(e) { /* keep cache */ }
  const wBot = tourBots.find(b => b.id === wP.id) || null;
  const bBot = tourBots.find(b => b.id === bP.id) || null;

  // Tournament bot-match settings (setup panel se)
  const BS = T.settings || {};
  const bvbTimeOn = !!BS.bvbTimeOn;
  const bvbMins   = Math.max(1, Math.min(180, parseInt(BS.bvbMinutes) || 5));
  const bvbTimeMs = bvbTimeOn ? bvbMins * 60000 : 0;
  const bvbDelay  = Math.max(100, parseInt(BS.bvbDelay) || 500);

  bvbGame = new Chess();
  let tOpeningLocked = null;
  const tStartPgn = (BS.bvbStartPgn || '').trim();
  if (tStartPgn) {
    if (bvbGame.load_pgn(tStartPgn)) {
      try {
        const obRes = await fetch(`${FLASK_URL}/play/check-opening`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fen: bvbGame.fen() })
        });
        tOpeningLocked = !!(await obRes.json()).is_opening;
      } catch(e) { tOpeningLocked = false; }
    } else {
      alert('Invalid starting PGN! Normal start se khel rahe hain.');
      bvbGame = new Chess();
    }
  }

  clearArrows();
  board.position(bvbGame.fen());
  if (boardFlipped) { board.flip(); boardFlipped = false; }

  bvbState = {
    active: true, paused: false,
    whiteBotId: wP.id, blackBotId: bP.id,
    whiteMs: bvbTimeMs, blackMs: bvbTimeMs,
    timeControl: bvbTimeOn, delay: bvbDelay,
    clockInterval: null,
    moveLog: [], _turnStartedAt: Date.now(), _pausedAccum: 0,
    openingLocked: tOpeningLocked,
  };
  window._tourBvbCtx = { roundIdx, matchIdx, w: wP, b: bP };

  _showBoardForPlay();
  document.getElementById('bvb-ingame-controls').style.display = 'flex';
  document.getElementById('bvb-game-over-banner').style.display = 'none';
  document.getElementById('bvb-nav-row').classList.add('disabled');
  document.getElementById('bvb-browse-label').textContent = '';
  setBvbStatus('');

  document.getElementById('clock-player-label').textContent = '♙ ' + wP.name;
  document.getElementById('clock-bot-label').textContent    = '♟ ' + bP.name;
  document.getElementById('clock-top-row').classList.add('show');
  document.getElementById('clock-bottom-row').classList.add('show');
  document.getElementById('clock-bot-time').style.display    = bvbTimeOn ? '' : 'none';
  document.getElementById('clock-player-time').style.display = bvbTimeOn ? '' : 'none';
  document.getElementById('bot-dialogue-bubble-bottom').style.display = 'none';
  updateBvbCapturedDisplay();
  updateBvbTurnDot('w');
  if (bvbTimeOn) { updateBvbClocks(); startBvbClock(); }

  hideAllDialogueBubbles();
  bvbWhiteEngine.reset(wBot, bvbGame.fen(), { position: 'bottom', fixedColor: 'w', botLabel: wP.name });
  bvbBlackEngine.reset(bBot, bvbGame.fen(), { position: 'top',    fixedColor: 'b', botLabel: bP.name });
  if (wBot && wBot.personality) bvbWhiteEngine.onGameStart(bvbGame, bvbGame.fen());
  if (bBot && bBot.personality) bvbBlackEngine.onGameStart(bvbGame, bvbGame.fen());

  bvbNextMove();
}

// Hook called from bvbHandleGameOver()
async function tourOnBvbGameOver() {
  const ctx = window._tourBvbCtx;
  if (!ctx) return;
  window._tourBvbCtx = null;

  const m = T.rounds[ctx.roundIdx][ctx.matchIdx];

  let winnerSide = null; // 'p1' | 'p2'
  if (bvbGame.in_checkmate()) {
    const loserColorIsWhite = bvbGame.turn() === 'w';
    winnerSide = loserColorIsWhite
      ? (ctx.w === m.p1 ? 'p2' : 'p1')
      : (ctx.b === m.p1 ? 'p2' : 'p1');
  }

  if (!winnerSide) {
    // Draw → rematch (same pairing). Safety cap: after 6 draws, higher Elo advances.
    m.games++;
    if (m.games >= 6) {
      winnerSide = m.p1.elo >= m.p2.elo ? 'p1' : 'p2';
    } else {
      setTimeout(() => {
        const nxt = { roundIdx: ctx.roundIdx, matchIdx: ctx.matchIdx, match: m };
        tourReturnToBracket();
        _tourAutoTimer = setTimeout(() => tourStartBotMatch(nxt), 1800);
      }, 50);
      return;
    }
  }

  _recordWinner(ctx.roundIdx, ctx.matchIdx, winnerSide);
  await _afterMatchResolved();
}

// ── User match (reuses Play-vs-Bot machinery) ────────────────

async function tourPlayUserMatch() {
  const cur = _currentMatch();
  if (!cur || !_isUserMatch(cur.match)) return;
  const match = cur.match;

  const opp = match.p1.type === 'user' ? match.p2 : match.p1;
  const playerColor = Math.random() < 0.5 ? 'w' : 'b';

  // Tournament match settings (setup panel se)
  const US = T.settings || {};
  const userTimeOn = !!US.userTimeOn;
  const userMins   = Math.max(1, Math.min(180, parseInt(US.userMinutes) || 10));
  const timeMs     = userTimeOn ? userMins * 60000 : 0;

  playState = {
    active: true,
    botId: opp.id,
    botName: opp.name,
    playerColor,
    timeControl: userTimeOn,
    timeMinutes: userMins,
    playerMs: timeMs, botMs: timeMs,
    features: {
      undo:       US.featUndo !== false,
      hint:       US.featHint !== false,
      evalbar:    !!US.featEvalbar,
      threat:     !!US.featThreat,
      suggestion: US.featSuggestion !== false,
    },
    pgn: '', fen: TOUR_START_FEN, startFen: TOUR_START_FEN,
    status: 'playing', result: null,
    moveLog: [],
    _turnStartedAt: Date.now(),
    openingLocked: null,
  };
  window.TOURNAMENT_CTX = { roundIdx: cur.roundIdx, matchIdx: cur.matchIdx };

  // Tournaments page ka bracket board ke niche na dikhe
  _showBoardForPlay();

  initPlayBoard();
  showIngameUI();

  hideAllDialogueBubbles();
  try {
    const res = await fetch(`${FLASK_URL}/play/bots`);
    tourBots = (await res.json()).bots || [];
  } catch(e) { /* keep cache */ }
  const oppBot = tourBots.find(b => b.id === opp.id) || null;

  // Optional starting PGN (same logic as Play vs Bot)
  const userPgn = (US.userStartPgn || '').trim();
  if (userPgn) {
    if (playGame.load_pgn(userPgn)) {
      const tmpG = new Chess();
      tmpG.load_pgn(userPgn);
      const phist = tmpG.history({ verbose: true });
      for (let i = 0; i < phist.length; i++) tmpG.undo();
      playState.startFen = tmpG.fen();
      playState.fen = playGame.fen();
      board.position(playGame.fen());
      updateCapturedDisplay();
      updateFENDisplay();
      try {
        const obRes = await fetch(`${FLASK_URL}/play/check-opening`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fen: playGame.fen() })
        });
        playState.openingLocked = !!(await obRes.json()).is_opening;
      } catch(e) { playState.openingLocked = false; }
    } else {
      alert('Invalid starting PGN! Normal start se khel rahe ho.');
    }
  }

  personalityEngine.reset(oppBot, playGame.fen(), { position: 'top', botLabel: opp.name });
  if (oppBot && oppBot.personality) personalityEngine.onGameStart(playGame, playGame.fen());

  if (playGame.turn() !== playerColor) {
    setPlayStatus('Opponent is thinking...');
    setTimeout(() => triggerBotMove(), 400);
  } else {
    setPlayStatus('Your turn — tournament match!');
  }
}

// Hook called from checkPlayGameOver()/endGame() in play-moves.js
async function tourOnUserGameOver(title) {
  const ctx = window.TOURNAMENT_CTX;
  if (!ctx) return;
  window.TOURNAMENT_CTX = null;

  // Tournament games ko normal resume system mein mat daalo
  fetch(`${FLASK_URL}/play/game`, { method: 'DELETE' }).catch(() => {});

  const m = T.rounds[ctx.roundIdx][ctx.matchIdx];
  const playerColorWord = playState.playerColor === 'w' ? 'white' : 'black';

  let outcome; // 'win' | 'loss' | 'draw'
  if (/resign/i.test(title)) outcome = 'loss';
  else if (playGame.in_checkmate()) {
    const winnerColor = playGame.turn() === 'w' ? 'black' : 'white';
    outcome = winnerColor === playerColorWord ? 'win' : 'loss';
  }
  else if (playGame.in_draw && playGame.in_draw()) outcome = 'draw';
  else if (/you win/i.test(title)) outcome = 'win';
  else if (/draw/i.test(title)) outcome = 'draw';
  else outcome = 'loss';

  let userWon;
  if (outcome === 'draw') {
    // Draw → no elimination, rematch same pairing. Safety cap like bots.
    m.games++;
    await _tourSave();
    setTimeout(async () => {
      if (m.games >= 6) {
        // Decide by Elo (higher advances)
        const userP = m.p1.type === 'user' ? m.p1 : m.p2;
        const oppP  = m.p1.type === 'user' ? m.p2 : m.p1;
        _recordWinner(ctx.roundIdx, ctx.matchIdx, userP.elo >= oppP.elo
          ? (m.p1.type === 'user' ? 'p1' : 'p2')
          : (m.p1.type === 'user' ? 'p2' : 'p1'));
        await _afterMatchResolved();
      } else {
        tourReturnToBracket();
        renderTournaments();
      }
    }, 50);
    return;
  }

  userWon = outcome === 'win';
  const userSide = m.p1.type === 'user' ? 'p1' : 'p2';
  _recordWinner(ctx.roundIdx, ctx.matchIdx, userWon ? userSide : (userSide === 'p1' ? 'p2' : 'p1'));
  await _afterMatchResolved();
}

// ── Watch / Skip / Abandon ────────────────────────────────────

function tourWatch() {
  if (!T || T.status !== 'active') return;
  T.watching = true;
  const nxt = _currentMatch();
  if (nxt && !_isUserMatch(nxt.match)) {
    tourStartBotMatch(nxt);
  } else {
    renderTournaments();
  }
}

async function tourSkip() {
  if (!T || T.status !== 'active') return;
  if (!confirm('Remaining matches simulate karke result dekhna hai?')) return;
  _tourStopAuto();

  let guard = 200;
  while (T.status === 'active' && guard-- > 0) {
    const cur = _currentMatch();
    if (!cur) break;
    _recordWinner(cur.roundIdx, cur.matchIdx, _simWinner(cur.match.p1, cur.match.p2));
  }
  await _tourSave();
  tourReturnToBracket();
  renderTournaments();
}

async function abandonTournament(confirmFirst) {
  if (confirmFirst && !confirm('Ye tournament abandon karke naya banayein?')) return;
  _tourStopAuto();
  window._tourBvbCtx = null;
  window.TOURNAMENT_CTX = null;
  try { await fetch(`${FLASK_URL}/play/tournament`, { method: 'DELETE' }); } catch(e) {}
  T = null;
  tourReturnToBracket();
  renderTournaments();
}

// ── Boot ──────────────────────────────────────────────────────

// ── Tournament History view ───────────────────────────────────

async function renderTourHistoryView() {
  const root = document.getElementById('tour-root');
  if (!root) return;
  root.innerHTML = '<div class="play-section"><div class="play-section-body" style="text-align:center;padding:30px;color:var(--text3);font-size:12px">Loading…</div></div>';

  let hist = [];
  try {
    const res  = await fetch(`${FLASK_URL}/play/tournament/history`);
    const data = await res.json();
    hist = data.history || [];
  } catch(e) { /* empty */ }

  hist = [...hist].reverse(); // newest first

  let listHtml;
  if (hist.length === 0) {
    listHtml = `<div class="play-section"><div class="play-section-body" style="text-align:center;padding:30px;color:var(--text3);font-size:12px">
      Abhi tak koi tournament complete nahi hua 🏁
    </div></div>`;
  } else {
    listHtml = hist.map(h => {
      const d = new Date(h.finishedAt);
      const dateStr = isNaN(d) ? '' : d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const champName = h.champion ? h.champion.name : '?';
      const champIcon = h.userWon ? '👑' : '🏆';

      const top5Rows = (h.top5 || []).map((p, i) => `
        <div style="display:flex;justify-content:space-between;font-size:11px;padding:3px 8px;border-radius:4px;${i === 0 ? 'background:var(--bg2,#222)' : ''}">
          <span>${['🥇','🥈','🥉','4️⃣','5️⃣'][i] || ''} ${escHtmlHtml(p.name)}${p.type === 'user' ? ' <span style="color:var(--accent)">(You)</span>' : ''}</span>
          <span style="color:var(--text3)">${p.wins} wins${p.elo ? ` · ~${p.elo}` : ''}</span>
        </div>`).join('');

      const matchRows = (h.matches || []).map(m => `
        <div style="display:flex;justify-content:space-between;gap:6px;font-size:10px;padding:2px 0;color:var(--text2)">
          <span>${escHtmlHtml(m.round)}</span>
          <span style="flex:1;text-align:right">${escHtmlHtml(m.p1)} vs ${escHtmlHtml(m.p2)} — <b style="color:var(--accent2)">${escHtmlHtml(m.winner || '?')}</b></span>
        </div>`).join('');

      return `<details class="play-section" style="padding:0">
        <summary style="padding:10px 14px;cursor:pointer;list-style:none;display:flex;justify-content:space-between;align-items:center">
          <span style="font-size:12px;font-weight:600;display:flex;align-items:center;gap:8px">
            <input type="checkbox" class="tour-hist-check" value="${h.id}" onclick="event.stopPropagation()">
            ${champIcon} ${escHtmlHtml(champName)}${h.userWon ? ' — Tum jeete! 🎉' : ''}
          </span>
          <span style="font-size:10px;color:var(--text3)">${h.size}P · ${dateStr} ▾</span>
        </summary>
        <div style="padding:0 14px 12px;display:flex;flex-direction:column;gap:10px">
          <div>
            <div style="font-size:10px;color:var(--accent);font-weight:700;margin-bottom:4px">TOP 5 PLAYERS</div>
            ${top5Rows || '<div style="font-size:10px;color:var(--text3)">—</div>'}
          </div>
          <div>
            <div style="font-size:10px;color:var(--accent);font-weight:700;margin-bottom:4px">MATCHES (${(h.matches || []).length})</div>
            ${matchRows || '<div style="font-size:10px;color:var(--text3)">—</div>'}
          </div>
        </div>
      </details>`;
    }).join('');
  }

  root.innerHTML = `
    <div class="play-section" style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px">
      <span style="font-size:13px;font-weight:700">📜 Tournament History</span>
      <button class="btn sm" onclick="renderTournaments()">↩ Back</button>
    </div>
    <div class="btn-row" style="margin-top:10px;justify-content:flex-end">
      <span id="tour-hist-sel-count" style="font-size:10px;color:var(--text3);align-self:center">0 selected</span>
      <button class="btn danger sm" onclick="tourDeleteHistory()">🗑 Delete Selected</button>
    </div>
    <div style="display:flex;flex-direction:column;gap:10px;margin-top:6px">${listHtml}</div>
  `;

  // Selection count updater
  root.querySelectorAll('.tour-hist-check').forEach(cb => {
    cb.addEventListener('change', () => {
      const n = root.querySelectorAll('.tour-hist-check:checked').length;
      const el = document.getElementById('tour-hist-sel-count');
      if (el) el.textContent = `${n} selected`;
    });
  });
}

async function tourDeleteHistory() {
  const root = document.getElementById('tour-root');
  if (!root) return;
  const ids = [...root.querySelectorAll('.tour-hist-check:checked')].map(cb => Number(cb.value));
  if (ids.length === 0) { alert('Pehle delete karne ke liye tournaments select karo!'); return; }
  if (!confirm(`${ids.length} tournament${ids.length > 1 ? 's' : ''} history se delete karein?`)) return;
  try {
    await fetch(`${FLASK_URL}/play/tournament/history/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    });
  } catch(e) { /* ignore */ }
  renderTourHistoryView();
}

document.addEventListener('DOMContentLoaded', () => setTimeout(tourInit, 300));
