// ============================================================
// lichess.js — Lichess Games pull (Player Profile section)
//              Fetch recent games via Flask backend into
//              imported_games.json (source: "lichess")
// ============================================================

  // ── Load saved username + last pull info on page load ────────

  async function lcPullInit() {
    try {
      const res  = await fetch(`${FLASK_URL}/lichess/username`);
      const data = await res.json();
      if (data.username) {
        const inp = document.getElementById('lc-pull-username');
        if (inp) inp.value = data.username;
        const st = document.getElementById('lc-pull-status');
        if (st && data.last_pulled) {
          st.textContent = `Last pulled: ${data.last_pulled.replace('T',' ')} — ${data.last_count} games`;
          st.style.color = 'var(--text3)';
        }
      }
    } catch(e) { /* backend not up yet — ignore */ }
  }

  // ── Pull games button handler ────────────────────────────────

  async function lcPullGames() {
    const inp      = document.getElementById('lc-pull-username');
    const username = (inp ? inp.value : '').trim();
    const statusEl = document.getElementById('lc-pull-status');

    if (!username) {
      if (statusEl) { statusEl.textContent = 'Username daalo pehle'; statusEl.style.color = 'var(--danger)'; }
      return;
    }

    if (statusEl) { statusEl.textContent = 'Fetching games from Lichess...'; statusEl.style.color = 'var(--text3)'; }

    try {
      const res  = await fetch(`${FLASK_URL}/lichess/pull-games`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username })
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Pull failed');
      if (statusEl) {
        statusEl.textContent = data.message || `${data.imported} imported`;
        statusEl.style.color = data.imported > 0 ? 'var(--success)' : 'var(--text3)';
      }
      // Refresh imported games list if its renderer exists
      if (typeof renderImportedList === 'function') renderImportedList();
    } catch(e) {
      if (statusEl) { statusEl.textContent = '❌ ' + e.message; statusEl.style.color = 'var(--danger)'; }
    }
  }

  // ── Chess.com Pull ────────────────────────────────────────────

  async function ccPullInit() {
    try {
      const res  = await fetch(`${FLASK_URL}/chesscom/username`);
      const data = await res.json();
      if (data.username) {
        const inp = document.getElementById('cc-pull-username');
        if (inp) inp.value = data.username;
        const st = document.getElementById('cc-pull-status');
        if (st && data.last_pulled) {
          st.textContent = `Last pulled: ${data.last_pulled.replace('T',' ')} — ${data.last_count} games`;
          st.style.color = 'var(--text3)';
        }
      }
    } catch(e) { /* backend not up yet — ignore */ }
  }

  async function ccPullGames() {
    const inp      = document.getElementById('cc-pull-username');
    const username = (inp ? inp.value : '').trim();
    const statusEl = document.getElementById('cc-pull-status');

    if (!username) {
      if (statusEl) { statusEl.textContent = 'Username daalo pehle'; statusEl.style.color = 'var(--danger)'; }
      return;
    }

    if (statusEl) { statusEl.textContent = 'Fetching games from Chess.com...'; statusEl.style.color = 'var(--text3)'; }

    try {
      const res  = await fetch(`${FLASK_URL}/chesscom/pull-games`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ username }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Pull failed');
      if (statusEl) {
        statusEl.textContent = data.message || `${data.imported} imported`;
        statusEl.style.color = data.imported > 0 ? 'var(--success)' : 'var(--text3)';
      }
      // Refresh imported games list if its renderer exists
      if (typeof renderImportedList === 'function') renderImportedList();
    } catch(e) {
      if (statusEl) { statusEl.textContent = '❌ ' + e.message; statusEl.style.color = 'var(--danger)'; }
    }
  }

  // Call inits shortly after page load
  document.addEventListener('DOMContentLoaded', () => setTimeout(lcPullInit, 500));
  document.addEventListener('DOMContentLoaded', () => setTimeout(ccPullInit, 600));
