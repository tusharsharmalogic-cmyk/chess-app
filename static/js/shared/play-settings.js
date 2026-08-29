// ============================================================
// play-settings.js — Persist collapsible groups, toggles, sliders
//                     to backend (/api/play-settings)
// ============================================================

(function() {
  'use strict';

  const FLASK_URL = 'http://localhost:5050';
  let _playSettings = {};
  let _saveTimer = null;

  // ── Collect all current UI states ────────────────────────────
  function _collectStates() {
    const s = {};

    // Collapsible sections (psToggle / bbToggleSection)
    // Body is hidden when display='none', visible when display=''
    const collapses = {
      ppBody:        'pp-body',
      bsBody:        'bs-body',
      ibBody:        'ib-body',
      bbSectionBody: 'bb-section-body',
      sbBotsBody:    'sb-bots-body',
    };
    for (const [key, id] of Object.entries(collapses)) {
      const el = document.getElementById(id);
      if (el) s[key] = el.style.display !== 'none'; // true = open
    }

    // Play vs Bot toggles
    s.togTimecontrol = _getChecked('tog-timecontrol');
    s.togLimitstrength = _getChecked('tog-limitstrength');
    s.featUndo      = _getChecked('feat-undo');
    s.featHint      = _getChecked('feat-hint');
    s.featEvalbar   = _getChecked('feat-evalbar');
    s.featThreat    = _getChecked('feat-threat');
    s.featSuggestion = _getChecked('feat-suggestion');

    // Phase sliders (make bot)
    s.slOpElo   = _getVal('sl-op-elo');
    s.slOpDepth = _getVal('sl-op-depth');
    s.slOpThink = _getVal('sl-op-think');
    s.slMgElo   = _getVal('sl-mg-elo');
    s.slMgDepth = _getVal('sl-mg-depth');
    s.slMgThink = _getVal('sl-mg-think');
    s.slEgElo   = _getVal('sl-eg-elo');
    s.slEgDepth = _getVal('sl-eg-depth');
    s.slEgThink = _getVal('sl-eg-think');

    // Hash slider
    s.hashSlider = _getVal('play-hash-slider');
    if (!s.hashSlider && s.hashSlider !== 0) {
      // Try alternative ID
      const hashEl = document.querySelector('input[type="range"][oninput*="updateHashDisplay"]');
      if (hashEl) s.hashSlider = parseInt(hashEl.value);
    }

    // Bot vs Bot toggles
    s.bvbTimecontrol = _getChecked('bvb-timecontrol');

    // Suggestion toggle state (global)
    if (typeof window._suggestionOn !== 'undefined') {
      s.suggestionOn = window._suggestionOn;
    }

    return s;
  }

  function _getChecked(id) {
    const el = document.getElementById(id);
    return el ? el.checked : undefined;
  }

  function _getVal(id) {
    const el = document.getElementById(id);
    return el ? parseInt(el.value) : undefined;
  }

  // ── Apply saved states to UI ────────────────────────────────
  function _applyStates(s) {
    if (!s || typeof s !== 'object') return;

    // Collapsible sections
    const collapses = {
      ppBody:        'pp-body',
      bsBody:        'bs-body',
      ibBody:        'ib-body',
      bbSectionBody: 'bb-section-body',
      sbBotsBody:    'sb-bots-body',
    };
    for (const [key, id] of Object.entries(collapses)) {
      if (s[key] === false) { // was closed
        const body = document.getElementById(id);
        if (body) body.style.display = 'none';
        // Update arrow icons
        if (key === 'bbSectionBody') {
          const arrow = document.getElementById('bb-section-arrow');
          if (arrow) arrow.textContent = '\u25B8'; // ▸
        } else {
          // psToggle arrows — find sibling arrow element
          // pp-body -> pp-arrow, bs-body -> bs-arrow, ib-body -> ib-arrow
          const arrowId = id.replace('-body', '-arrow');
          const arrow = document.getElementById(arrowId);
          if (arrow) arrow.textContent = '\u25B8'; // ▸
        }
      }
    }

    // Play vs Bot toggles
    _setChecked('tog-timecontrol', s.togTimecontrol);
    _setChecked('tog-limitstrength', s.togLimitstrength);
    _setChecked('feat-undo', s.featUndo);
    _setChecked('feat-hint', s.featHint);
    _setChecked('feat-evalbar', s.featEvalbar);
    _setChecked('feat-threat', s.featThreat);
    _setChecked('feat-suggestion', s.featSuggestion);

    // Phase sliders
    _setVal('sl-op-elo', s.slOpElo);
    _setVal('sl-op-depth', s.slOpDepth);
    _setVal('sl-op-think', s.slOpThink);
    _setVal('sl-mg-elo', s.slMgElo);
    _setVal('sl-mg-depth', s.slMgDepth);
    _setVal('sl-mg-think', s.slMgThink);
    _setVal('sl-eg-elo', s.slEgElo);
    _setVal('sl-eg-depth', s.slEgDepth);
    _setVal('sl-eg-think', s.slEgThink);

    // Hash slider
    if (s.hashSlider !== undefined) {
      const hashEl = document.querySelector('input[type="range"][oninput*="updateHashDisplay"]');
      if (hashEl) { hashEl.value = s.hashSlider; hashEl.dispatchEvent(new Event('input')); }
    }

    // Bot vs Bot
    _setChecked('bvb-timecontrol', s.bvbTimecontrol);
  }

  function _setChecked(id, val) {
    if (val === undefined) return;
    const el = document.getElementById(id);
    if (el) el.checked = val;
  }

  function _setVal(id, val) {
    if (val === undefined) return;
    const el = document.getElementById(id);
    if (el) el.value = val;
  }

  // ── Debounced save to backend ────────────────────────────────
  function _debouncedSave() {
    if (_saveTimer) clearTimeout(_saveTimer);
    _saveTimer = setTimeout(() => {
      const states = _collectStates();
      try {
        fetch(FLASK_URL + '/api/play-settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(states)
        });
      } catch(e) { /* offline */ }
    }, 300); // 300ms debounce
  }

  // ── Hook into psToggle and bbToggleSection ───────────────────
  const _origPsToggle = window.psToggle;
  window.psToggle = function(bodyId, arrowId) {
    if (_origPsToggle) _origPsToggle(bodyId, arrowId);
    _debouncedSave();
  };

  const _origBbToggle = window.bbToggleSection;
  window.bbToggleSection = function() {
    if (_origBbToggle) _origBbToggle();
    _debouncedSave();
  };

  // ── Attach change/input listeners to all toggles & sliders ──
  function _attachListeners() {
    // Checkboxes (toggle switches)
    const checkIds = [
      'tog-timecontrol', 'tog-limitstrength',
      'feat-undo', 'feat-hint', 'feat-evalbar', 'feat-threat', 'feat-suggestion',
      'bvb-timecontrol'
    ];
    checkIds.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('change', _debouncedSave);
    });

    // Sliders
    const sliderIds = [
      'sl-op-elo', 'sl-op-depth', 'sl-op-think',
      'sl-mg-elo', 'sl-mg-depth', 'sl-mg-think',
      'sl-eg-elo', 'sl-eg-depth', 'sl-eg-think'
    ];
    sliderIds.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('input', _debouncedSave);
    });

    // Hash slider (various possible IDs)
    const hashEl = document.querySelector('input[type="range"][oninput*="updateHashDisplay"]');
    if (hashEl) hashEl.addEventListener('input', _debouncedSave);

    // Suggestion toggle (global button)
    document.addEventListener('click', (e) => {
      if (e.target.id === 'suggestion-toggle-btn' || e.target.closest('#suggestion-toggle-btn')) {
        setTimeout(_debouncedSave, 50);
      }
    });
  }

  // ── Init: load from backend + attach listeners ───────────────
  async function initPlaySettings() {
    try {
      const res = await fetch(FLASK_URL + '/api/play-settings');
      const data = await res.json();
      _playSettings = data || {};
      _applyStates(_playSettings);
    } catch(e) { /* offline — defaults stay */ }

    // Attach listeners after a short delay to ensure all elements exist
    setTimeout(_attachListeners, 200);
  }

  // Export globally
  window.initPlaySettings = initPlaySettings;

  // Auto-init on DOMContentLoaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPlaySettings);
  } else {
    // DOM already ready — init after a short delay for other scripts
    setTimeout(initPlaySettings, 100);
  }
})();

// ── Badge Settings UI (position, size, margin) ────────────────────
(function() {
  'use strict';
  const SIZE_LABELS = ['Extra Small', 'Small', 'Medium', 'Large'];

  function _loadBadgeCfg() {
    try { return JSON.parse(localStorage.getItem('boardBadgeSettings')) || {}; } catch(e) { return {}; }
  }
  function _saveBadgeCfg(s) {
    try { localStorage.setItem('boardBadgeSettings', JSON.stringify(s)); } catch(e) {}
  }

  function _initBadgeSettings() {
    const cfg = _loadBadgeCfg();
    const pos = cfg.position || 'top-right';
    const sizeIdx = cfg.size != null ? cfg.size : 2;
    const margin = cfg.margin != null ? cfg.margin : 2;

    // Highlight active position button
    document.querySelectorAll('.badge-pos-btn').forEach(btn => {
      if (btn.dataset.pos === pos) {
        btn.style.borderColor = 'var(--accent)';
        btn.style.background = 'rgba(196,163,90,0.15)';
        btn.style.color = 'var(--accent)';
        btn.classList.add('active');
      } else {
        btn.style.borderColor = 'var(--border)';
        btn.style.background = 'var(--bg3)';
        btn.style.color = 'var(--text)';
        btn.classList.remove('active');
      }
    });

    // Size slider
    const sizeSlider = document.getElementById('badge-size-slider');
    const sizeVal = document.getElementById('badge-size-val');
    if (sizeSlider) {
      sizeSlider.value = sizeIdx;
      if (sizeVal) sizeVal.textContent = SIZE_LABELS[sizeIdx] || 'Medium';
      sizeSlider.oninput = function() {
        const v = parseInt(this.value);
        const c = _loadBadgeCfg();
        c.size = v;
        _saveBadgeCfg(c);
        if (sizeVal) sizeVal.textContent = SIZE_LABELS[v] || 'Medium';
      };
    }

    // Margin slider
    const marginSlider = document.getElementById('badge-margin-slider');
    const marginVal = document.getElementById('badge-margin-val');
    if (marginSlider) {
      marginSlider.value = margin;
      if (marginVal) marginVal.textContent = margin + 'px';
      marginSlider.oninput = function() {
        const v = parseInt(this.value);
        const c = _loadBadgeCfg();
        c.margin = v;
        _saveBadgeCfg(c);
        if (marginVal) marginVal.textContent = v + 'px';
      };
    }

    // Position buttons
    document.querySelectorAll('.badge-pos-btn').forEach(btn => {
      btn.onclick = function() {
        const newPos = this.dataset.pos;
        const c = _loadBadgeCfg();
        c.position = newPos;
        _saveBadgeCfg(c);
        // Update UI
        document.querySelectorAll('.badge-pos-btn').forEach(b => {
          b.style.borderColor = 'var(--border)';
          b.style.background = 'var(--bg3)';
          b.style.color = 'var(--text)';
          b.classList.remove('active');
        });
        this.style.borderColor = 'var(--accent)';
        this.style.background = 'rgba(196,163,90,0.15)';
        this.style.color = 'var(--accent)';
        this.classList.add('active');
      };
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _initBadgeSettings);
  } else {
    setTimeout(_initBadgeSettings, 150);
  }
})();
