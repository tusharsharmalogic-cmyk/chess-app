// ============================================================
// bot-builder.js — Visual Bot & Personality Builder
// Alag file: static/js/play/bot-builder.js
//
// Kya karta hai:
//   - Fully visual rule builder (koi manual JSON likhne ki zarurat nahi)
//   - Har rule mein: trigger, conditions, duration, actions, dialogues
//   - Live JSON preview
//   - Bot banao + personality attach — ek hi flow
// ============================================================

// ── State ───────────────────────────────────────────────────
const bbState = {
  rules: [],        // Array of rule objects (builder ke andar ka state)
  nextRuleId: 1,    // Auto-increment for rule IDs
  expanded: {},     // { ruleIdx: true/false } — collapsed/expanded
};

// ── Trigger catalog ─────────────────────────────────────────
const BB_TRIGGERS = [
  { group: '🎮 Game State', items: [
    { value: 'game_start',            label: 'Game Start' },
    { value: 'game_end',              label: 'Game End' },
    { value: 'win',                   label: 'Win' },
    { value: 'loss',                  label: 'Loss' },
    { value: 'draw',                  label: 'Draw' },
    { value: 'checkmate_delivered',   label: 'Checkmate Delivered' },
    { value: 'checkmated',            label: 'Checkmated' },
    { value: 'stalemate',             label: 'Stalemate' },
    { value: 'threefold_repetition',  label: 'Threefold Repetition' },
    { value: 'insufficient_material', label: 'Insufficient Material' },
  ]},
  { group: '🗺 Phase Transitions', items: [
    { value: 'opening_entered',    label: 'Opening Entered' },
    { value: 'middlegame_entered', label: 'Middlegame Entered' },
    { value: 'endgame_entered',    label: 'Endgame Entered' },
    { value: 'opening_left',       label: 'Opening Left' },
    { value: 'middlegame_left',    label: 'Middlegame Left' },
    { value: 'endgame_left',       label: 'Endgame Left' },
  ]},
  { group: '🔢 Move Based', items: [
    { value: 'move_number',    label: 'Move Number',        extra: 'move_value' },
    { value: 'check_given',    label: 'Check Given (N times)', extra: 'count' },
    { value: 'check_received', label: 'Check Received (N times)', extra: 'count' },
  ]},
  { group: '♟ Piece Events', items: [
    { value: 'own_piece_lost',          label: 'Own Piece Lost',          extra: 'pieces' },
    { value: 'opponent_piece_captured', label: 'Opponent Piece Captured', extra: 'pieces' },
    { value: 'material_delta',          label: 'Material Delta (exact)',  extra: 'delta_value' },
  ]},
  { group: '🏰 Castling', items: [
    { value: 'castled_kingside',              label: 'Bot Castled Kingside' },
    { value: 'castled_queenside',             label: 'Bot Castled Queenside' },
    { value: 'castling_rights_lost',          label: 'Bot Castling Rights Lost' },
    { value: 'opponent_castled_kingside',     label: 'Opponent Castled Kingside' },
    { value: 'opponent_castled_queenside',    label: 'Opponent Castled Queenside' },
    { value: 'opponent_castling_rights_lost', label: 'Opponent Castling Rights Lost' },
  ]},
  { group: '👑 Pawn Promotion', items: [
    { value: 'pawn_promoted',       label: 'Bot Pawn Promoted' },
    { value: 'promote_to_queen',    label: 'Promoted to Queen' },
    { value: 'promote_to_rook',     label: 'Promoted to Rook' },
    { value: 'promote_to_bishop',   label: 'Promoted to Bishop' },
    { value: 'promote_to_knight',   label: 'Promoted to Knight' },
    { value: 'opponent_promoted',   label: 'Opponent Promoted' },
  ]},
  { group: '📊 Evaluation', items: [
    { value: 'eval_threshold', label: 'Eval Threshold',  extra: 'eval_value' },
    { value: 'eval_improved',  label: 'Eval Improved (each move)' },
    { value: 'eval_dropped',   label: 'Eval Dropped (each move)' },
  ]},
  { group: '🎯 Player Move Quality', items: [
    { value: 'player_brilliant',  label: 'Player: Brilliant ✨' },
    { value: 'player_best',       label: 'Player: Best Move' },
    { value: 'player_excellent',  label: 'Player: Excellent' },
    { value: 'player_good',       label: 'Player: Good' },
    { value: 'player_inaccuracy', label: 'Player: Inaccuracy' },
    { value: 'player_mistake',    label: 'Player: Mistake' },
    { value: 'player_blunder',    label: 'Player: Blunder 🔴' },
  ]},
];

const BB_PIECES = ['pawn', 'knight', 'bishop', 'rook', 'queen', 'king'];

const BB_CONDITIONS_SIMPLE = [
  { value: 'first_time_only',       label: '⏱ First Time Only' },
  { value: 'not_triggered_before',  label: '⏱ Not Triggered Before (session)' },
  { value: 'from_starting_position',label: '⏱ From Starting Position' },
  { value: 'opening_only',          label: '🗺 Opening Phase Only' },
  { value: 'middlegame_only',        label: '🗺 Middlegame Phase Only' },
  { value: 'endgame_only',           label: '🗺 Endgame Phase Only' },
  { value: 'material_advantage',     label: '⚖ Material Advantage' },
  { value: 'material_disadvantage',  label: '⚖ Material Disadvantage' },
  { value: 'queen_alive',            label: '⚖ Queen Alive' },
  { value: 'queen_dead',             label: '⚖ Queen Dead' },
  { value: 'both_knights_alive',     label: '⚖ Both Knights Alive' },
  { value: 'both_knights_dead',      label: '⚖ Both Knights Dead' },
  { value: 'white_side',             label: '🎮 Bot is White' },
  { value: 'black_side',             label: '🎮 Bot is Black' },
];

const BB_DURATIONS = [
  { value: '',                   label: 'Instant (trigger move only)' },
  { value: 'moves',              label: 'N Moves', needsValue: true },
  { value: 'until_phase_change', label: 'Until Phase Changes' },
  { value: 'until_eval_positive',label: 'Until Eval Positive' },
  { value: 'until_eval_negative',label: 'Until Eval Negative' },
  { value: 'until_material_equal',label: 'Until Material Equal' },
  { value: 'until_game_end',     label: 'Until Game End' },
];

const BB_ACTION_TYPES = [
  { value: 'set_elo',           label: 'Set ELO (absolute)',     unit: 'ELO' },
  { value: 'add_elo',           label: 'Add/Sub ELO',            unit: 'ELO (negative = subtract)' },
  { value: 'set_depth',         label: 'Set Depth (absolute)',   unit: '1–20' },
  { value: 'add_depth',         label: 'Add/Sub Depth',          unit: '' },
  { value: 'set_think_ms',      label: 'Set Think Time (absolute)', unit: 'ms' },
  { value: 'multiply_think_ms', label: 'Multiply Think Time',    unit: 'x (e.g. 2 = double, 0.5 = half)' },
];

// ── Helpers ──────────────────────────────────────────────────

function _bbEsc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function _bbGet(id) { return document.getElementById(id); }

function _bbTriggerMeta(type) {
  for (const g of BB_TRIGGERS) {
    const found = g.items.find(i => i.value === type);
    if (found) return found;
  }
  return null;
}

// ── Main render ──────────────────────────────────────────────

function bbRender() {
  const container = _bbGet('bb-rules-container');
  if (!container) return;

  if (bbState.rules.length === 0) {
    container.innerHTML = `
      <div style="text-align:center;padding:18px 10px;color:var(--text3);font-size:11px">
        Koi rule nahi hai abhi.<br>
        <span style="color:var(--accent)">+ Add Rule</span> dabao neeche se.
      </div>`;
  } else {
    container.innerHTML = bbState.rules.map((r, idx) => _bbRuleCard(r, idx)).join('');
  }

  bbUpdatePreview();
}

function _bbRuleCard(rule, idx) {
  const isExpanded = bbState.expanded[idx] !== false; // default expanded
  const trigMeta   = _bbTriggerMeta(rule.trigger.type);
  const trigLabel  = trigMeta ? trigMeta.label : (rule.trigger.type || '— trigger select karo —');

  const condCount = (rule.conditions || []).length;
  const actCount  = (rule.actions    || []).length;
  const dlgCount  = (rule.dialogues  || []).length;

  const chipStyle = 'display:inline-block;padding:1px 6px;border-radius:10px;font-size:9px;margin-right:3px;';

  return `
  <div class="bb-rule-card" id="bb-rule-${idx}" style="border:1px solid var(--border);border-radius:8px;overflow:hidden;background:var(--bg2)">
    <!-- Header -->
    <div onclick="bbToggleRule(${idx})" style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;cursor:pointer;user-select:none;background:var(--bg3)">
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
          <span style="font-size:10px;color:var(--text3);font-family:'JetBrains Mono',monospace">#${idx+1}</span>
          <span style="font-size:11px;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:160px">${_bbEsc(rule.label || trigLabel)}</span>
        </div>
        <div style="margin-top:3px">
          <span style="${chipStyle}background:rgba(196,163,90,0.15);color:var(--accent)">⚡ ${_bbEsc(trigLabel)}</span>
          ${condCount ? `<span style="${chipStyle}background:rgba(100,160,220,0.12);color:#7ab4e0">${condCount} cond</span>` : ''}
          ${actCount  ? `<span style="${chipStyle}background:rgba(143,184,110,0.12);color:var(--accent2)">${actCount} action</span>` : ''}
          ${dlgCount  ? `<span style="${chipStyle}background:rgba(180,140,200,0.12);color:#c8a0e0">${dlgCount} line</span>` : ''}
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:6px;flex-shrink:0">
        <button onclick="event.stopPropagation();bbMoveRule(${idx},-1)" title="Move Up"
          style="background:none;border:none;color:var(--text3);cursor:pointer;font-size:12px;padding:2px 4px" ${idx===0?'disabled':''}>▲</button>
        <button onclick="event.stopPropagation();bbMoveRule(${idx},1)" title="Move Down"
          style="background:none;border:none;color:var(--text3);cursor:pointer;font-size:12px;padding:2px 4px" ${idx===bbState.rules.length-1?'disabled':''}>▼</button>
        <button onclick="event.stopPropagation();bbDeleteRule(${idx})"
          style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:13px;padding:2px 4px" title="Delete Rule">✕</button>
        <span style="color:var(--text3);font-size:11px">${isExpanded ? '▾' : '▸'}</span>
      </div>
    </div>

    <!-- Body -->
    ${isExpanded ? _bbRuleBody(rule, idx) : ''}
  </div>`;
}

function _bbRuleBody(rule, idx) {
  return `
  <div style="padding:12px;display:flex;flex-direction:column;gap:10px">

    <!-- Rule Label -->
    <div>
      <div class="play-label">Rule Label (UI display ke liye)</div>
      <input type="text" class="play-input" placeholder="e.g. Aggressive Opening"
        value="${_bbEsc(rule.label || '')}"
        oninput="bbState.rules[${idx}].label=this.value;bbUpdatePreview()"
        style="font-size:11px">
    </div>

    <!-- Priority + Enabled -->
    <div style="display:flex;gap:8px;align-items:center">
      <div style="flex:1">
        <div class="play-label">Priority (0–100, higher = pehle)</div>
        <input type="number" class="play-input" min="0" max="100" value="${rule.priority ?? 10}"
          oninput="bbState.rules[${idx}].priority=parseInt(this.value)||0;bbUpdatePreview()"
          style="font-size:11px">
      </div>
      <div style="display:flex;flex-direction:column;align-items:center;gap:3px;padding-top:14px">
        <div class="play-label" style="white-space:nowrap">Enabled</div>
        <label class="toggle-switch" style="margin:0">
          <input type="checkbox" ${rule.enabled !== false ? 'checked' : ''}
            onchange="bbState.rules[${idx}].enabled=this.checked;bbUpdatePreview()">
          <span class="toggle-slider"></span>
        </label>
      </div>
    </div>

    <!-- Trigger -->
    <div>
      <div class="play-label">⚡ Trigger</div>
      <select class="play-input" style="font-size:11px" onchange="bbOnTriggerChange(${idx},this.value)">
        <option value="">— Trigger select karo —</option>
        ${BB_TRIGGERS.map(g => `
          <optgroup label="${_bbEsc(g.group)}">
            ${g.items.map(it => `<option value="${it.value}" ${rule.trigger.type===it.value?'selected':''}>${_bbEsc(it.label)}</option>`).join('')}
          </optgroup>`).join('')}
      </select>

      ${_bbTriggerExtras(rule, idx)}
    </div>

    <!-- Conditions -->
    <div>
      <div class="play-label" style="margin-bottom:4px">🔒 Conditions <span style="color:var(--text3);font-size:9px">(sab true ho tabhi fire)</span></div>
      <div id="bb-conds-${idx}" style="display:flex;flex-direction:column;gap:4px">
        ${(rule.conditions||[]).map((c,ci) => _bbCondRow(c,idx,ci)).join('')}
      </div>
      <div style="margin-top:5px;display:flex;gap:6px;flex-wrap:wrap">
        <button class="btn sm" onclick="bbAddSimpleCond(${idx})" style="font-size:10px">+ Simple</button>
        <button class="btn sm" onclick="bbAddMoveGtCond(${idx})" style="font-size:10px">+ Move &gt; N</button>
        <button class="btn sm" onclick="bbAddMoveLtCond(${idx})" style="font-size:10px">+ Move &lt; N</button>
        <button class="btn sm" onclick="bbAddEvalCond(${idx},'eval_gt')" style="font-size:10px">+ Eval &gt;</button>
        <button class="btn sm" onclick="bbAddEvalCond(${idx},'eval_lt')" style="font-size:10px">+ Eval &lt;</button>
      </div>
    </div>

    <!-- Duration -->
    <div>
      <div class="play-label">⏳ Duration</div>
      <select class="play-input" style="font-size:11px" onchange="bbOnDurationChange(${idx},this.value)">
        ${BB_DURATIONS.map(d => `<option value="${d.value}" ${((rule.duration?.type ?? '') === d.value) || (rule.duration === undefined && d.value === '') ? 'selected' : ''}>${_bbEsc(d.label)}</option>`).join('')}
      </select>
      ${rule.duration && rule.duration.type === 'moves' ? `
        <div style="margin-top:4px">
          <div class="play-label">N (number of moves)</div>
          <input type="number" class="play-input" min="1" max="200" value="${rule.duration.value||3}"
            oninput="bbState.rules[${idx}].duration.value=parseInt(this.value)||1;bbUpdatePreview()"
            style="font-size:11px">
        </div>` : ''}
    </div>

    <!-- Actions -->
    <div>
      <div class="play-label" style="margin-bottom:4px">⚙ Actions <span style="color:var(--text3);font-size:9px">(optional)</span></div>
      <div id="bb-actions-${idx}" style="display:flex;flex-direction:column;gap:4px">
        ${(rule.actions||[]).map((a,ai) => _bbActionRow(a,idx,ai)).join('')}
      </div>
      <button class="btn sm" onclick="bbAddAction(${idx})" style="font-size:10px;margin-top:5px">+ Add Action</button>
    </div>

    <!-- Dialogues -->
    <div>
      <div class="play-label" style="margin-bottom:4px">💬 Dialogues <span style="color:var(--text3);font-size:9px">(random ek dikhega)</span></div>
      <div id="bb-dlgs-${idx}" style="display:flex;flex-direction:column;gap:4px">
        ${(rule.dialogues||[]).map((d,di) => _bbDlgRow(d,idx,di)).join('')}
      </div>
      <button class="btn sm" onclick="bbAddDialogue(${idx})" style="font-size:10px;margin-top:5px">+ Add Line</button>
    </div>

  </div>`;
}

// ── Trigger extra fields ─────────────────────────────────────

function _bbTriggerExtras(rule, idx) {
  const t = rule.trigger || {};
  const type = t.type || '';

  if (type === 'move_number') return `
    <div style="margin-top:4px">
      <div class="play-label">Move Number</div>
      <input type="number" class="play-input" min="1" max="200" value="${t.value||1}"
        oninput="bbState.rules[${idx}].trigger.value=parseInt(this.value)||1;bbUpdatePreview()"
        style="font-size:11px">
    </div>`;

  if (type === 'check_given' || type === 'check_received') return `
    <div style="margin-top:4px">
      <div class="play-label">After N checks</div>
      <input type="number" class="play-input" min="1" max="50" value="${t.count||1}"
        oninput="bbState.rules[${idx}].trigger.count=parseInt(this.value)||1;bbUpdatePreview()"
        style="font-size:11px">
    </div>`;

  if (type === 'own_piece_lost' || type === 'opponent_piece_captured') return `
    <div style="margin-top:4px">
      <div class="play-label">Pieces (ek piece multiple baar bhi select kar sakte ho)</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:5px">
        ${BB_PIECES.map(p => {
          const count = (t.pieces||[]).filter(x => x === p).length;
          return `<div style="display:flex;flex-direction:column;align-items:center;gap:2px">
            <span style="font-size:9px;color:var(--text2)">${p}</span>
            <div style="display:flex;align-items:center;gap:3px">
              <button onclick="bbChangePieceCount(${idx},'${p}',-1)"
                style="width:18px;height:18px;border-radius:50%;border:1px solid var(--border);background:var(--bg2);color:var(--text);cursor:pointer;font-size:12px;line-height:1;display:flex;align-items:center;justify-content:center;padding:0">−</button>
              <span style="min-width:14px;text-align:center;font-size:10px;color:${count>0?'var(--accent)':'var(--text3)'};font-weight:${count>0?'700':'400'}">${count}</span>
              <button onclick="bbChangePieceCount(${idx},'${p}',1)"
                style="width:18px;height:18px;border-radius:50%;border:1px solid var(--border);background:var(--bg2);color:var(--text);cursor:pointer;font-size:12px;line-height:1;display:flex;align-items:center;justify-content:center;padding:0">+</button>
            </div>
          </div>`;
        }).join('')}
      </div>
      <div style="margin-top:4px;font-size:9px;color:var(--text3)">
        Selected: ${(() => { const pieces = t.pieces||[]; if(!pieces.length) return 'koi nahi'; const counts={}; pieces.forEach(p=>{counts[p]=(counts[p]||0)+1;}); return Object.entries(counts).map(([p,c])=>c>1?`${p}×${c}`:p).join(', '); })()}
      </div>
    </div>`;

  if (type === 'material_delta') return `
    <div style="margin-top:4px">
      <div class="play-label">Material Difference (exact, in pawns)</div>
      <input type="number" class="play-input" min="-39" max="39" value="${t.value??5}"
        oninput="bbState.rules[${idx}].trigger.value=parseFloat(this.value)||0;bbUpdatePreview()"
        style="font-size:11px">
    </div>`;

  if (type === 'eval_threshold') return `
    <div style="margin-top:4px">
      <div class="play-label">Eval Value (e.g. 2.0, -1.5)</div>
      <input type="number" class="play-input" min="-50" max="50" step="0.1" value="${t.value??2.0}"
        oninput="bbState.rules[${idx}].trigger.value=parseFloat(this.value)||0;bbUpdatePreview()"
        style="font-size:11px">
    </div>`;

  return '';
}

// ── Condition rows ───────────────────────────────────────────

function _bbCondRow(cond, idx, ci) {
  if (typeof cond === 'string') {
    const meta = BB_CONDITIONS_SIMPLE.find(c => c.value === cond);
    return `
      <div style="display:flex;align-items:center;gap:6px;background:var(--bg3);border-radius:5px;padding:5px 8px;border:1px solid var(--border)">
        <span style="flex:1;font-size:10px;color:var(--text2)">${meta ? _bbEsc(meta.label) : _bbEsc(cond)}</span>
        <button onclick="bbDeleteCond(${idx},${ci})" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:11px;padding:0 2px">✕</button>
      </div>`;
  }
  // Object condition (move_gt, move_lt, eval_gt, eval_lt)
  const typeLabel = { move_gt:'Move > N', move_lt:'Move < N', eval_gt:'Eval >', eval_lt:'Eval <' }[cond.type] || cond.type;
  return `
    <div style="display:flex;align-items:center;gap:6px;background:var(--bg3);border-radius:5px;padding:5px 8px;border:1px solid var(--border)">
      <span style="font-size:10px;color:var(--text3);white-space:nowrap">${_bbEsc(typeLabel)}</span>
      <input type="number" value="${cond.value??0}" step="${cond.type.startsWith('eval')?'0.1':'1'}"
        oninput="bbState.rules[${idx}].conditions[${ci}].value=parseFloat(this.value)||0;bbUpdatePreview()"
        style="width:60px;font-size:10px;padding:2px 5px;background:var(--bg2);border:1px solid var(--border);border-radius:4px;color:var(--text)">
      <button onclick="bbDeleteCond(${idx},${ci})" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:11px;padding:0 2px">✕</button>
    </div>`;
}

// ── Action rows ──────────────────────────────────────────────

function _bbActionRow(action, idx, ai) {
  const meta = BB_ACTION_TYPES.find(a => a.value === action.type);
  return `
    <div style="display:flex;align-items:center;gap:6px;background:var(--bg3);border-radius:5px;padding:5px 8px;border:1px solid var(--border);flex-wrap:wrap">
      <select style="font-size:10px;padding:2px 4px;background:var(--bg2);border:1px solid var(--border);border-radius:4px;color:var(--text);flex:1;min-width:100px"
        onchange="bbState.rules[${idx}].actions[${ai}].type=this.value;bbUpdatePreview()">
        ${BB_ACTION_TYPES.map(a => `<option value="${a.value}" ${action.type===a.value?'selected':''}>${_bbEsc(a.label)}</option>`).join('')}
      </select>
      <input type="number" value="${action.value??0}" step="${action.type==='multiply_think_ms'?'0.1':'1'}"
        placeholder="${meta?meta.unit:''}"
        oninput="bbState.rules[${idx}].actions[${ai}].value=parseFloat(this.value)||0;bbUpdatePreview()"
        style="width:70px;font-size:10px;padding:2px 5px;background:var(--bg2);border:1px solid var(--border);border-radius:4px;color:var(--text)">
      <button onclick="bbDeleteAction(${idx},${ai})" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:11px;padding:0 2px">✕</button>
    </div>`;
}

// ── Dialogue rows ────────────────────────────────────────────

function _bbDlgRow(text, idx, di) {
  return `
    <div style="display:flex;align-items:center;gap:6px">
      <input type="text" class="play-input" value="${_bbEsc(text)}" placeholder="Bot kya bolega..."
        oninput="bbState.rules[${idx}].dialogues[${di}]=this.value;bbUpdatePreview()"
        style="font-size:10px;flex:1">
      <button onclick="bbDeleteDialogue(${idx},${di})" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:13px;padding:0 4px;flex-shrink:0">✕</button>
    </div>`;
}

// ── Event handlers ───────────────────────────────────────────

function bbToggleRule(idx) {
  bbState.expanded[idx] = bbState.expanded[idx] === false ? true : false;
  bbRender();
}

function bbMoveRule(idx, dir) {
  const newIdx = idx + dir;
  if (newIdx < 0 || newIdx >= bbState.rules.length) return;
  const tmp = bbState.rules[idx];
  bbState.rules[idx] = bbState.rules[newIdx];
  bbState.rules[newIdx] = tmp;
  bbRender();
}

function bbDeleteRule(idx) {
  if (!confirm(`Rule #${idx+1} delete karna hai?`)) return;
  bbState.rules.splice(idx, 1);
  bbRender();
}

function bbOnTriggerChange(idx, val) {
  bbState.rules[idx].trigger = { type: val };
  bbRender(); // re-render to show/hide extras
}

function bbOnDurationChange(idx, val) {
  if (!val) {
    delete bbState.rules[idx].duration;
  } else if (val === 'moves') {
    bbState.rules[idx].duration = { type: 'moves', value: 3 };
  } else {
    bbState.rules[idx].duration = { type: val };
  }
  bbRender();
}

function bbChangePieceCount(idx, piece, delta) {
  const t = bbState.rules[idx].trigger;
  if (!t.pieces) t.pieces = [];
  if (delta > 0) {
    t.pieces.push(piece);
  } else {
    const i = t.pieces.lastIndexOf(piece);
    if (i !== -1) t.pieces.splice(i, 1);
  }
  bbRender();
}

// Conditions
function bbAddSimpleCond(idx) {
  // Show a select dropdown inline — we'll use a temp modal-style approach
  const val = _bbSimpleCondPicker();
  if (!val) return;
  if (!bbState.rules[idx].conditions) bbState.rules[idx].conditions = [];
  bbState.rules[idx].conditions.push(val);
  bbRender();
}

function _bbSimpleCondPicker() {
  // Build options string for prompt-style selection
  const opts = BB_CONDITIONS_SIMPLE.map((c, i) => `${i+1}. ${c.label}`).join('\n');
  const raw = prompt(`Condition choose karo (number type karo):\n\n${opts}`);
  if (!raw) return null;
  const n = parseInt(raw.trim()) - 1;
  if (isNaN(n) || n < 0 || n >= BB_CONDITIONS_SIMPLE.length) return null;
  return BB_CONDITIONS_SIMPLE[n].value;
}

function bbAddMoveGtCond(idx) {
  const n = parseInt(prompt('Move number > ?  (e.g. 10)') || '');
  if (isNaN(n)) return;
  if (!bbState.rules[idx].conditions) bbState.rules[idx].conditions = [];
  bbState.rules[idx].conditions.push({ type: 'move_gt', value: n });
  bbRender();
}

function bbAddMoveLtCond(idx) {
  const n = parseInt(prompt('Move number < ?  (e.g. 20)') || '');
  if (isNaN(n)) return;
  if (!bbState.rules[idx].conditions) bbState.rules[idx].conditions = [];
  bbState.rules[idx].conditions.push({ type: 'move_lt', value: n });
  bbRender();
}

function bbAddEvalCond(idx, type) {
  const label = type === 'eval_gt' ? 'Eval > ?' : 'Eval < ?';
  const raw = prompt(`${label}  (e.g. 1.5 ya -1.0)`) || '';
  const v = parseFloat(raw);
  if (isNaN(v)) return;
  if (!bbState.rules[idx].conditions) bbState.rules[idx].conditions = [];
  bbState.rules[idx].conditions.push({ type, value: v });
  bbRender();
}

function bbDeleteCond(idx, ci) {
  bbState.rules[idx].conditions.splice(ci, 1);
  bbRender();
}

// Actions
function bbAddAction(idx) {
  if (!bbState.rules[idx].actions) bbState.rules[idx].actions = [];
  bbState.rules[idx].actions.push({ type: 'add_elo', value: 200 });
  bbRender();
}

function bbDeleteAction(idx, ai) {
  bbState.rules[idx].actions.splice(ai, 1);
  bbRender();
}

// Dialogues
function bbAddDialogue(idx) {
  if (!bbState.rules[idx].dialogues) bbState.rules[idx].dialogues = [];
  bbState.rules[idx].dialogues.push('');
  bbRender();
}

function bbDeleteDialogue(idx, di) {
  bbState.rules[idx].dialogues.splice(di, 1);
  bbRender();
}

// ── Add new rule ─────────────────────────────────────────────

function bbAddRule() {
  const newIdx = bbState.rules.length;
  bbState.rules.push({
    id:         `rule_${bbState.nextRuleId++}`,
    label:      '',
    priority:   10,
    enabled:    true,
    trigger:    { type: '' },
    conditions: [],
    actions:    [],
    dialogues:  [],
  });
  bbState.expanded[newIdx] = true;
  bbRender();
  // Scroll to new rule
  setTimeout(() => {
    const el = _bbGet(`bb-rule-${newIdx}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 100);
}

// ── JSON build ───────────────────────────────────────────────

function bbBuildPersonalityJSON() {
  const name = (_bbGet('bb-personality-name')?.value || '').trim();
  if (!name) return null;

  const rules = bbState.rules
    .filter(r => r.enabled !== false)
    .map(r => {
      const rule = {
        id:       r.id,
        label:    r.label || r.trigger.type || 'rule',
        priority: r.priority ?? 10,
        enabled:  true,
        trigger:  { ...r.trigger },
      };
      if (r.conditions && r.conditions.length) rule.conditions = r.conditions;
      if (r.duration) rule.duration = r.duration;
      if (r.actions && r.actions.length) rule.actions = r.actions;
      if (r.dialogues && r.dialogues.filter(Boolean).length)
        rule.dialogues = r.dialogues.filter(Boolean);
      return rule;
    });

  return { name, rules };
}

function bbUpdatePreview() {
  const pre = _bbGet('bb-json-preview');
  if (!pre) return;
  const personality = bbBuildPersonalityJSON();
  if (!personality) {
    pre.textContent = '// Personality naam dalo upar se...';
    return;
  }
  pre.textContent = JSON.stringify({ personality }, null, 2);
}

// ── Save / Attach ────────────────────────────────────────────

async function bbSaveNewBot() {
  const name = (_bbGet('bb-new-bot-name')?.value || '').trim();
  if (!name) { alert('Bot ka naam dalo!'); return; }

  const opElo    = parseInt(_bbGet('bb-op-elo')?.value)   || 1500;
  const opDepth  = parseInt(_bbGet('bb-op-depth')?.value) || 12;
  const opThink  = parseInt(_bbGet('bb-op-think')?.value) || 1000;
  const mgElo    = parseInt(_bbGet('bb-mg-elo')?.value)   || 1500;
  const mgDepth  = parseInt(_bbGet('bb-mg-depth')?.value) || 12;
  const mgThink  = parseInt(_bbGet('bb-mg-think')?.value) || 1000;
  const egElo    = parseInt(_bbGet('bb-eg-elo')?.value)   || 1500;
  const egDepth  = parseInt(_bbGet('bb-eg-depth')?.value) || 12;
  const egThink  = parseInt(_bbGet('bb-eg-think')?.value) || 1000;

  const body = {
    name,
    uci_elo:          opElo,
    phase_opening:    { elo: opElo,   depth: opDepth,  think_ms: opThink  },
    phase_middlegame: { elo: mgElo,   depth: mgDepth,  think_ms: mgThink  },
    phase_endgame:    { elo: egElo,   depth: egDepth,  think_ms: egThink  },
  };

  bbSetStatus('Saving bot...', 'var(--text3)');

  try {
    const res  = await fetch(`${FLASK_URL}/play/bots`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    const newBotId = data.bot?.id;

    // Attach personality if rules exist
    let personalityAttached = false;
    if (newBotId && bbState.rules.length > 0) {
      const pNameEl = _bbGet('bb-personality-name');
      if (pNameEl && !pNameEl.value.trim()) pNameEl.value = name;
      const personality = bbBuildPersonalityJSON();
      if (personality && personality.rules.length) {
        const pRes = await fetch(`${FLASK_URL}/play/bots/${newBotId}/personality`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ personality }),
        });
        const pData = await pRes.json();
        if (!pData.error) personalityAttached = true;
      }
    }

    bbSetStatus(`✓ Bot "${name}" saved!${personalityAttached ? ' Personality bhi attach ho gayi.' : ''}`, 'var(--accent2)');
    await renderBotsList();

    // Reset builder
    if (confirm('Bot saved! Builder reset karna hai?')) {
      bbResetBuilder();
    }

  } catch(e) {
    bbSetStatus('Error: ' + e.message, 'var(--danger)');
  }
}

function bbSetStatus(msg, color) {
  const el = _bbGet('bb-status');
  if (!el) return;
  el.style.display = '';
  el.style.color   = color;
  el.textContent   = msg;
}

function bbResetBuilder() {
  bbState.rules    = [];
  bbState.expanded = {};
  bbState.nextRuleId = 1;
  if (_bbGet('bb-personality-name')) _bbGet('bb-personality-name').value = '';
  if (_bbGet('bb-new-bot-name'))     _bbGet('bb-new-bot-name').value     = '';
  bbRender();
}

function bbCopyJSON() {
  const pre = _bbGet('bb-json-preview');
  if (!pre || !pre.textContent || pre.textContent.startsWith('//')) return;
  navigator.clipboard.writeText(pre.textContent).then(() => {
    const btn = _bbGet('bb-copy-btn');
    if (btn) { const orig = btn.textContent; btn.textContent = '✓ Copied!'; setTimeout(() => btn.textContent = orig, 1500); }
  });
}

// ── Init: called when Make Bot tab opens ─────────────────────
function bbInit() {
  bbRender();
}
