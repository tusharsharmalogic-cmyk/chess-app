// ============================================================
// ranking.js — Leaderboard / Ranking tab
// Shows sorted player & bot rankings by points
// Click on a player to see last 10 match history
// ============================================================

(function () {
  'use strict';

  const FLASK_URL = 'http://localhost:5050';

  const RESULT_COLORS = {
    win: 'var(--accent2)',
    loss: 'var(--danger)',
    draw: 'var(--accent)',
    tournament: 'var(--accent)',
  };

  // ── Render leaderboard ─────────────────────────────────────
  async function renderLeaderboard() {
    const container = document.getElementById('ranking-list');
    if (!container) return;
    container.innerHTML = '<div style="font-size:11px;color:var(--text3);text-align:center;padding:10px 0">Loading...</div>';

    // Hide detail panel when refreshing
    const detail = document.getElementById('ranking-detail');
    if (detail) detail.style.display = 'none';

    try {
      const res = await fetch(`${FLASK_URL}/play/leaderboard`);
      const data = await res.json();
      const entries = data.entries || [];

      if (entries.length === 0) {
        container.innerHTML = '<div style="font-size:11px;color:var(--text3);text-align:center;padding:16px 0">Abhi tak koi game nahi khela gaya.<br>Matches khelein aur ranking dekhein! 🏅</div>';
        return;
      }

      container.innerHTML = '';

      // Table header
      const hdr = document.createElement('div');
      hdr.style.cssText = 'display:grid;grid-template-columns:36px 1fr 50px 70px 80px;gap:4px;padding:4px 8px;font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid var(--border)';
      hdr.innerHTML = '<div>#</div><div>Name</div><div style="text-align:center">Wins</div><div style="text-align:right">ELO</div><div style="text-align:right">Points</div>';
      container.appendChild(hdr);

      entries.forEach((entry, idx) => {
        const row = document.createElement('div');
        row.style.cssText = `display:grid;grid-template-columns:36px 1fr 50px 70px 80px;gap:4px;padding:7px 8px;border-bottom:1px solid var(--border);cursor:pointer;transition:background .15s`;
        row.onmouseenter = () => row.style.background = 'rgba(255,255,255,0.04)';
        row.onmouseleave = () => row.style.background = '';
        row.onclick = () => showPlayerDetail(entry.key);

        const pts = entry.points;
        const ptsColor = pts > 0 ? 'var(--accent2)' : pts < 0 ? 'var(--danger)' : 'var(--text2)';
        const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : '';

        row.innerHTML = `
          <div style="font-weight:600;color:var(--text2)">${medal || (idx + 1)}</div>
          <div style="color:var(--text);font-weight:500">${_esc(entry.name)}</div>
          <div style="text-align:center;color:var(--text3)">${entry.wins != null ? entry.wins : '-'}</div>
          <div style="text-align:right;color:var(--text2)">${entry.elo}</div>
          <div style="text-align:right;font-weight:700;color:${ptsColor}">${pts >= 0 ? '+' : ''}${pts}</div>
        `;
        container.appendChild(row);
      });

    } catch (e) {
      container.innerHTML = '<div style="font-size:11px;color:var(--danger);text-align:center;padding:10px 0">Leaderboard load nahi ho paya</div>';
    }
  }

  // ── Player detail: last 10 matches ─────────────────────────
  async function showPlayerDetail(key) {
    const detail = document.getElementById('ranking-detail');
    const titleEl = document.getElementById('ranking-detail-title');
    const statsEl = document.getElementById('ranking-detail-stats');
    const histEl = document.getElementById('ranking-detail-history');
    if (!detail) return;

    detail.style.display = 'flex';
    titleEl.textContent = 'Loading...';
    statsEl.textContent = '';
    histEl.innerHTML = '';

    try {
      const res = await fetch(`${FLASK_URL}/play/leaderboard/history/${encodeURIComponent(key)}`);
      const data = await res.json();

      const ptsColor = data.points > 0 ? 'var(--accent2)' : data.points < 0 ? 'var(--danger)' : 'var(--text2)';
      titleEl.textContent = `${data.name}`;
      // Calculate tournament bonus from history
      const tourBonus = (data.history || []).reduce((s, h) => s + (h.context && h.context.startsWith('tournament_top') ? (h.points || 0) : 0), 0);
      const matchWins = (data.history || []).filter(h => h.result === 'win').length;
      statsEl.innerHTML = `
        <span style="margin-right:12px">ELO: <b>${data.elo}</b></span>
        <span style="margin-right:12px">Wins: <b style="color:var(--accent2)">${matchWins}</b></span>
        <span style="margin-right:12px">Points: <b style="color:${ptsColor}">${data.points >= 0 ? '+' : ''}${data.points}</b></span>
        ${tourBonus > 0 ? `<span>Tournament Bonus: <b style="color:var(--accent)">+${tourBonus}</b></span>` : ''}
      `;

      if (!data.history || data.history.length === 0) {
        histEl.innerHTML = '<div style="color:var(--text3);padding:8px 0;text-align:center">Koi match record nahi hai</div>';
        return;
      }

      histEl.innerHTML = '';
      const table = document.createElement('div');
      table.style.cssText = 'display:flex;flex-direction:column;gap:2px;margin-top:6px';

      data.history.forEach(h => {
        const ts = h.ts ? _fmtDate(h.ts) : '';
        const result = h.result || '?';
        const color = RESULT_COLORS[result] || 'var(--text3)';
        const pts = h.points || 0;
        const ptsStr = pts >= 0 ? `+${pts}` : `${pts}`;
        const ptsColor = pts > 0 ? 'var(--accent2)' : pts < 0 ? 'var(--danger)' : 'var(--text3)';
        const ctx = h.context === 'tournament_top1' ? ' 🥇' :
                    h.context === 'tournament_top2' ? ' 🥈' :
                    h.context === 'tournament_top3' ? ' 🥉' : '';

        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:6px;padding:4px 6px;border-radius:4px;font-size:11px;background:rgba(255,255,255,0.03)';
        row.innerHTML = `
          <span style="color:${color};font-weight:600;width:56px">${_resultLabel(result)}${ctx}</span>
          <span style="flex:1;color:var(--text2)">vs ${_esc(h.opponent || '?')}</span>
          <span style="color:var(--text3);font-size:10px;width:80px;text-align:right">${ts}</span>
          <span style="font-weight:700;color:${ptsColor};width:44px;text-align:right">${ptsStr}</span>
        `;
        table.appendChild(row);
      });

      histEl.appendChild(table);

      // Scroll detail into view
      detail.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    } catch (e) {
      titleEl.textContent = 'Error loading profile';
      histEl.innerHTML = `<div style="color:var(--danger);font-size:11px">${_esc(e.message)}</div>`;
    }
  }

  // ── Helpers ─────────────────────────────────────────────────
  function _esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

  function _fmtDate(unix) {
    const d = new Date(unix * 1000);
    const pad = n => String(n).padStart(2, '0');
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${d.getHours()}:${pad(d.getMinutes())}`;
  }

  function _resultLabel(r) {
    if (r === 'win') return 'WIN';
    if (r === 'loss') return 'LOSS';
    if (r === 'draw') return 'DRAW';
    if (r === 'tournament') return 'TOUR';
    return r;
  }

  // ── Expose globally ────────────────────────────────────────
  window.renderLeaderboard = renderLeaderboard;
  window.showPlayerDetail = showPlayerDetail;

})();
