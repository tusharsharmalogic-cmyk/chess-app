// ============================================================
// personality.js — Bot personality engine: move triggers,
//                   dialogue bubbles, reaction system
// ============================================================

  // ═══════════════════════════════════════════════════════════════

  function createPersonalityEngine() {
    return {

    bot: null,
    activeRule: null,
    triggeredRuleIds: new Set(),
    gamePieceCounts: null,
    prevPhase: null,
    prevEval: null,
    checksGiven: 0,
    checksReceived: 0,
    gameFromStartingPos: true,
    // 'top' = bubble shows near clock-top-row, 'bottom' = near clock-bottom-row
    position: 'top',
    // Fixed color override for this engine (used in bot vs bot mode).
    // null = derive from playState (play vs bot mode).
    fixedColor: null,
    botLabel: 'Bot',

    reset(bot, startFen, opts) {
      this.bot = bot;
      this.activeRule = null;
      this.triggeredRuleIds = new Set();
      this.checksGiven = 0;
      this.checksReceived = 0;
      this.prevPhase = null;
      this.prevEval = null;
      // Apply opts first so fixedColor is up-to-date before we use it
      if (opts) {
        if (opts.position   !== undefined) this.position   = opts.position;
        if (opts.fixedColor !== undefined) this.fixedColor = opts.fixedColor;
        if (opts.botLabel   !== undefined) this.botLabel   = opts.botLabel;
      }
      // Clear log UI
      const isBvb = (this.fixedColor !== null && this.fixedColor !== undefined);
      const logId = isBvb ? 'bvb-dialogue-log' : 'pvb-dialogue-log';
      const logItemsId = isBvb ? 'bvb-dialogue-log-items' : 'pvb-dialogue-log-items';
      const logSection = document.getElementById(logId);
      const logItems = document.getElementById(logItemsId);
      if (logSection) logSection.style.display = 'none';
      if (logItems) logItems.innerHTML = '';
      const stdFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
      this.gameFromStartingPos = !startFen || startFen === stdFen;
      const tempGame = new Chess(startFen || stdFen);
      this.gamePieceCounts = this._countPieces(tempGame);
    },

    _countPieces(chessInst) {
      const counts = { wP:0,wN:0,wB:0,wR:0,wQ:0,bP:0,bN:0,bB:0,bR:0,bQ:0 };
      const b = chessInst.board();
      for (let r=0; r<8; r++) for (let c=0; c<8; c++) {
        const sq = b[r][c];
        if (sq && sq.type !== 'k') {
          const key = sq.color + sq.type.toUpperCase();
          if (key in counts) counts[key]++;
        }
      }
      return counts;
    },

    _botColor() {
      if (this.fixedColor) return this.fixedColor;
      return playState.playerColor === 'w' ? 'b' : 'w';
    },

    _materialDelta(chessInst) {
      const VALS = { P:1, N:3, B:3, R:5, Q:9 };
      let botMat=0, playerMat=0;
      const bc = this._botColor();
      const b = chessInst.board();
      for (let r=0; r<8; r++) for (let c=0; c<8; c++) {
        const sq = b[r][c];
        if (!sq || sq.type === 'k') continue;
        const v = VALS[sq.type.toUpperCase()] || 0;
        if (sq.color === bc) botMat += v;
        else playerMat += v;
      }
      return botMat - playerMat;
    },

    _ownPieceLostMatch(chessInst, pieces) {
      const bc = this._botColor();
      const keyMap = { pawn:'P', knight:'N', bishop:'B', rook:'R', queen:'Q' };
      const required = {};
      for (const p of pieces) {
        const k = bc + (keyMap[p] || p.toUpperCase());
        required[k] = (required[k] || 0) + 1;
      }
      const current = this._countPieces(chessInst);
      for (const [key, count] of Object.entries(required)) {
        const start = this.gamePieceCounts[key] || 0;
        if (Math.max(0, start - (current[key]||0)) < count) return false;
      }
      return true;
    },

    _opponentPieceCapturedMatch(chessInst, pieces) {
      const pc = this._botColor() === 'w' ? 'b' : 'w';
      const keyMap = { pawn:'P', knight:'N', bishop:'B', rook:'R', queen:'Q' };
      const STANDARD = { wP:8,wN:2,wB:2,wR:2,wQ:1,bP:8,bN:2,bB:2,bR:2,bQ:1 };
      const required = {};
      for (const p of pieces) {
        const k = pc + (keyMap[p] || p.toUpperCase());
        required[k] = (required[k] || 0) + 1;
      }
      const current = this._countPieces(chessInst);
      for (const [key, count] of Object.entries(required)) {
        const start = STANDARD[key] || 0;
        if (Math.max(0, start - (current[key]||0)) < count) return false;
      }
      return true;
    },

    _checkConditions(conditions, chessInst, evalCp, phase) {
      if (!conditions || conditions.length === 0) return true;
      const bc = this._botColor();
      const mat = this._materialDelta(chessInst);
      const fullMove = chessInst.history().length;
      const counts = this._countPieces(chessInst);

      for (const cond of conditions) {
        const type = typeof cond === 'string' ? cond : cond.type;
        switch(type) {
          case 'white_side':   if (bc !== 'w') return false; break;
          case 'black_side':   if (bc !== 'b') return false; break;
          case 'opening_only':    if (phase !== 'opening')    return false; break;
          case 'middlegame_only': if (phase !== 'middlegame') return false; break;
          case 'endgame_only':    if (phase !== 'endgame')    return false; break;
          case 'material_advantage':    if (mat <= 0) return false; break;
          case 'material_disadvantage': if (mat >= 0) return false; break;
          case 'both_knights_alive': if ((counts[bc+'N']||0) < 2) return false; break;
          case 'both_knights_dead':  if ((counts[bc+'N']||0) > 0) return false; break;
          case 'queen_alive': if ((counts[bc+'Q']||0) === 0) return false; break;
          case 'queen_dead':  if ((counts[bc+'Q']||0) > 0) return false; break;
          case 'first_time_only':
          case 'not_triggered_before': break;
          case 'move_gt': if (fullMove <= (cond.value||0)) return false; break;
          case 'move_lt': if (fullMove >= (cond.value||0)) return false; break;
          case 'eval_gt': {
            const v = evalCp !== null ? evalCp/100 : 0;
            const botV = bc === 'w' ? v : -v;
            if (botV <= (cond.value||0)) return false; break;
          }
          case 'eval_lt': {
            const v = evalCp !== null ? evalCp/100 : 0;
            const botV = bc === 'w' ? v : -v;
            if (botV >= (cond.value||0)) return false; break;
          }
          case 'from_starting_position': if (!this.gameFromStartingPos) return false; break;
        }
      }
      return true;
    },

    _durationExpired(rule, chessInst, evalCp, phase) {
      const dur = rule.duration;
      if (!dur) return true;
      const mat = this._materialDelta(chessInst);
      const bc = this._botColor();
      switch(dur.type) {
        case 'moves': return this.activeRule.movesLeft <= 0;
        case 'until_phase_change': return phase !== this.activeRule.startPhase;
        case 'until_eval_positive': {
          const v = evalCp !== null ? evalCp/100 : 0;
          return bc === 'w' ? v > 0 : -v > 0;
        }
        case 'until_eval_negative': {
          const v = evalCp !== null ? evalCp/100 : 0;
          return bc === 'w' ? v < 0 : -v < 0;
        }
        case 'until_material_equal': return mat === 0;
        case 'until_game_end': return false;
        default: return false;
      }
    },

    _checkTrigger(trigger, chessInst, moveObj, phase, evalCp, moveQuality) {
      const type = trigger.type;
      const bc = this._botColor();
      const hist = chessInst.history({ verbose: true });
      const fullMove = Math.ceil(hist.length / 2);

      switch(type) {
        case 'game_start': return false;
        case 'game_end':   return chessInst.game_over();
        case 'win':        return chessInst.in_checkmate() && chessInst.turn() !== bc;
        case 'loss':       return chessInst.in_checkmate() && chessInst.turn() === bc;
        case 'draw':       return chessInst.in_draw && chessInst.in_draw();
        case 'checkmate_delivered': return chessInst.in_checkmate() && chessInst.turn() !== bc;
        case 'checkmated':          return chessInst.in_checkmate() && chessInst.turn() === bc;
        case 'stalemate':           return chessInst.in_stalemate();
        case 'threefold_repetition': return chessInst.in_threefold_repetition();
        case 'insufficient_material': return chessInst.insufficient_material();

        case 'opening_entered':    return phase === 'opening'    && this.prevPhase !== 'opening';
        case 'middlegame_entered': return phase === 'middlegame' && this.prevPhase !== 'middlegame';
        case 'endgame_entered':    return phase === 'endgame'    && this.prevPhase !== 'endgame';
        case 'opening_left':       return phase !== 'opening'    && this.prevPhase === 'opening';
        case 'middlegame_left':    return phase !== 'middlegame' && this.prevPhase === 'middlegame';
        case 'endgame_left':       return phase !== 'endgame'    && this.prevPhase === 'endgame';

        case 'move_number': return fullMove === (trigger.value || 0);

        case 'own_piece_lost':
          return this._ownPieceLostMatch(chessInst, trigger.pieces || []);
        case 'opponent_piece_captured':
          return this._opponentPieceCapturedMatch(chessInst, trigger.pieces || []);

        case 'material_delta':
          return this._materialDelta(chessInst) === (trigger.value || 0);

        case 'check_given':    return this.checksGiven    >= (trigger.count || 1);
        case 'check_received': return this.checksReceived >= (trigger.count || 1);

        case 'castled_kingside':
          return !!(moveObj && moveObj.flags && moveObj.flags.includes('k') && moveObj.color === bc);
        case 'castled_queenside':
          return !!(moveObj && moveObj.flags && moveObj.flags.includes('q') && moveObj.color === bc);
        case 'opponent_castled_kingside':
          return !!(moveObj && moveObj.flags && moveObj.flags.includes('k') && moveObj.color !== bc);
        case 'opponent_castled_queenside':
          return !!(moveObj && moveObj.flags && moveObj.flags.includes('q') && moveObj.color !== bc);
        case 'castling_rights_lost': {
          const castling = chessInst.fen().split(' ')[2];
          return bc === 'w' ? !castling.includes('K') && !castling.includes('Q')
                            : !castling.includes('k') && !castling.includes('q');
        }
        case 'opponent_castling_rights_lost': {
          const castling = chessInst.fen().split(' ')[2];
          const opp = bc === 'w' ? 'b' : 'w';
          return opp === 'w' ? !castling.includes('K') && !castling.includes('Q')
                             : !castling.includes('k') && !castling.includes('q');
        }

        case 'pawn_promoted':     return !!(moveObj && moveObj.promotion && moveObj.color === bc);
        case 'promote_to_queen':  return !!(moveObj && moveObj.promotion === 'q' && moveObj.color === bc);
        case 'promote_to_rook':   return !!(moveObj && moveObj.promotion === 'r' && moveObj.color === bc);
        case 'promote_to_bishop': return !!(moveObj && moveObj.promotion === 'b' && moveObj.color === bc);
        case 'promote_to_knight': return !!(moveObj && moveObj.promotion === 'n' && moveObj.color === bc);
        case 'opponent_promoted': return !!(moveObj && moveObj.promotion && moveObj.color !== bc);

        case 'eval_threshold': {
          if (evalCp === null) return false;
          const botV = bc === 'w' ? evalCp/100 : -evalCp/100;
          const threshold = trigger.value || 0;
          return threshold >= 0 ? botV >= threshold : botV <= threshold;
        }
        case 'eval_improved':
          if (this.prevEval === null || evalCp === null) return false;
          return bc === 'w' ? evalCp > this.prevEval : evalCp < this.prevEval;
        case 'eval_dropped':
          if (this.prevEval === null || evalCp === null) return false;
          return bc === 'w' ? evalCp < this.prevEval : evalCp > this.prevEval;

        // ── Player move-quality triggers (opponent's last move, as
        // classified by the /classify endpoint's quality labels) ──
        case 'player_blunder':    return moveQuality === 'Blunder' || moveQuality === 'Mate Blunder' || moveQuality === 'Queen Donation' || moveQuality === 'Free Gift';
        case 'player_mistake':    return moveQuality === 'Mistake';
        case 'player_inaccuracy': return moveQuality === 'Inaccuracy';
        case 'player_good':       return moveQuality === 'Good';
        case 'player_excellent':  return moveQuality === 'Excellent';
        case 'player_best':       return moveQuality === 'Best';
        case 'player_brilliant':  return moveQuality === 'Brilliant' || moveQuality === 'Great Move';
        case 'player_move_quality': return !!moveQuality && moveQuality === trigger.value;

        default: return false;
      }
    },

    _buildOverride(rule, baseElo, baseDepth, baseThinkMs) {
      let elo = baseElo, depth = baseDepth, thinkMs = baseThinkMs;
      for (const action of (rule.actions || [])) {
        switch(action.type) {
          case 'set_elo':           elo     = action.value; break;
          case 'add_elo':           elo    += action.value; break;
          case 'set_depth':         depth   = action.value; break;
          case 'add_depth':         depth  += action.value; break;
          case 'set_think_ms':      thinkMs = action.value; break;
          case 'multiply_think_ms': thinkMs = Math.round(thinkMs * action.value); break;
        }
      }
      return {
        elo:      Math.max(1320, Math.min(3190, elo)),
        depth:    Math.max(1,    Math.min(20,   depth)),
        think_ms: Math.max(50,   Math.min(30000, thinkMs)),
      };
    },

    _showDialogue(rule) {
      const dialogues = rule.dialogues || [];
      if (!dialogues.length) return;
      const text = dialogues[Math.floor(Math.random() * dialogues.length)];
      this.activeRule.dialogue = text;
      const bubble = document.getElementById('bot-dialogue-bubble-' + this.position);
      const textEl = document.getElementById('bot-dialogue-text-' + this.position);
      const nameEl = document.getElementById('bot-dialogue-name-' + this.position);
      if (bubble && textEl) {
        textEl.textContent = text;
        if (nameEl) nameEl.textContent = this.botLabel || (this.bot && this.bot.name) || 'Bot';
        bubble.style.display = 'block';
      }
      // Push to dialogue log (panel mein neeche)
      this._pushToLog(text, rule);
    },

    _pushToLog(text, rule) {
      const label = this.botLabel || (this.bot && this.bot.name) || 'Bot';
      const triggerType = rule.trigger ? rule.trigger.type : 'unknown';
      // Determine which log section to use
      // position 'top' in PvB = personalityEngine (pvb-dialogue-log)
      // position 'top' in BvB = bvbBlackEngine, 'bottom' = bvbWhiteEngine (both -> bvb-dialogue-log)
      const isBvb = (this.fixedColor !== null && this.fixedColor !== undefined);
      const logId = isBvb ? 'bvb-dialogue-log' : 'pvb-dialogue-log';
      const logItemsId = isBvb ? 'bvb-dialogue-log-items' : 'pvb-dialogue-log-items';
      const logSection = document.getElementById(logId);
      const logItems = document.getElementById(logItemsId);
      if (!logSection || !logItems) return;

      logSection.style.display = 'block';
      const entry = document.createElement('div');
      entry.style.cssText = 'background:var(--bg3);border:1px solid var(--border);border-radius:6px;padding:8px 10px;display:flex;flex-direction:column;gap:3px;';

      // Header row: bot name + trigger
      const header = document.createElement('div');
      header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;';
      const nameSpan = document.createElement('span');
      nameSpan.style.cssText = 'font-size:10px;color:var(--accent);font-weight:600;';
      nameSpan.textContent = '🎭 ' + label;
      const trigSpan = document.createElement('span');
      trigSpan.style.cssText = 'font-size:9px;color:var(--text3);background:rgba(255,255,255,0.05);padding:1px 5px;border-radius:4px;';
      trigSpan.textContent = triggerType.replace(/_/g,' ');
      header.appendChild(nameSpan);
      header.appendChild(trigSpan);

      // Dialogue text
      const textDiv = document.createElement('div');
      textDiv.style.cssText = 'font-size:11px;color:var(--text);line-height:1.5;';
      textDiv.textContent = '"' + text + '"';

      entry.appendChild(header);
      entry.appendChild(textDiv);
      logItems.prepend(entry); // newest on top
    },

    _hideDialogue() {
      const bubble = document.getElementById('bot-dialogue-bubble-' + this.position);
      if (bubble) bubble.style.display = 'none';
    },

    _refreshDialogue() {
      if (!this.activeRule || !this.activeRule.dialogue) return;
      const bubble = document.getElementById('bot-dialogue-bubble-' + this.position);
      const textEl = document.getElementById('bot-dialogue-text-' + this.position);
      const nameEl = document.getElementById('bot-dialogue-name-' + this.position);
      if (bubble && textEl) {
        textEl.textContent = this.activeRule.dialogue;
        if (nameEl) nameEl.textContent = this.botLabel || (this.bot && this.bot.name) || 'Bot';
        bubble.style.display = 'block';
      }
    },

    _activateRule(rule, phase) {
      let movesLeft = 0;
      const dur = rule.duration || {};
      if (dur.type === 'moves') movesLeft = dur.value || 1;
      this.activeRule = { rule, movesLeft, startPhase: phase, dialogue: null };
      this.triggeredRuleIds.add(rule.id);
      this._showDialogue(rule);
    },

    _sortedRules() {
      const rules = (this.bot && this.bot.personality && this.bot.personality.rules) || [];
      return [...rules].filter(r => r.enabled !== false)
                       .sort((a,b) => (b.priority||0) - (a.priority||0));
    },

    _hasFirstTimeCond(rule) {
      return (rule.conditions||[]).some(c => {
        const t = typeof c === 'string' ? c : c.type;
        return t === 'first_time_only' || t === 'not_triggered_before';
      });
    },

    onGameStart(chessInst, startFen) {
      if (!this.bot || !this.bot.personality) return;
      const phase = 'opening';
      for (const rule of this._sortedRules()) {
        const ttype = rule.trigger?.type;
        let fires = ttype === 'game_start' ||
                    (ttype === 'own_piece_lost' && this._ownPieceLostMatch(chessInst, rule.trigger.pieces||[]));
        if (!fires) continue;
        if (!this._checkConditions(rule.conditions, chessInst, 0, phase)) continue;
        if (this._hasFirstTimeCond(rule) && this.triggeredRuleIds.has(rule.id)) continue;
        this._activateRule(rule, phase);
        break;
      }
    },

    onAfterMove(chessInst, moveObj, evalCp, phase, moveQuality) {
      if (!this.bot || !this.bot.personality) return null;

      // Update check counters
      if (moveObj && moveObj.san && moveObj.san.includes('+')) {
        if (moveObj.color === this._botColor()) this.checksGiven++;
        else this.checksReceived++;
      }

      // Tick active rule duration
      if (this.activeRule) {
        if (this.activeRule.rule.duration?.type === 'moves') {
          this.activeRule.movesLeft--;
        }
        if (this._durationExpired(this.activeRule.rule, chessInst, evalCp, phase)) {
          this.activeRule = null;
          this._hideDialogue();
        }
      }

      // Try to fire a new rule if none active
      if (!this.activeRule) {
        for (const rule of this._sortedRules()) {
          if (!this._checkTrigger(rule.trigger || {}, chessInst, moveObj, phase, evalCp, moveQuality)) continue;
          if (!this._checkConditions(rule.conditions, chessInst, evalCp, phase)) continue;
          if (this._hasFirstTimeCond(rule) && this.triggeredRuleIds.has(rule.id)) continue;
          this._activateRule(rule, phase);
          break;
        }
      } else {
        this._refreshDialogue();
      }

      this.prevPhase = phase;
      this.prevEval  = evalCp;

      if (this.activeRule) {
        const rule = this.activeRule.rule;
        let basePh;
        if (phase === 'opening')         basePh = this.bot.phase_opening    || {};
        else if (phase === 'middlegame') basePh = this.bot.phase_middlegame || {};
        else                             basePh = this.bot.phase_endgame    || {};
        return this._buildOverride(rule,
          basePh.elo      || this.bot.uci_elo || 1500,
          basePh.depth    || 12,
          basePh.think_ms || 1000
        );
      }
      return null;
    },

    onGameEnd(chessInst) {
      // Fire game-end triggers (win/loss/draw/stalemate etc.) if chessInst provided
      if (chessInst && this.bot && this.bot.personality) {
        // Clear active rule so a new one can fire
        this.activeRule = null;
        for (const rule of this._sortedRules()) {
          if (!this._checkTrigger(rule.trigger || {}, chessInst, null, this.prevPhase || 'middlegame', this.prevEval)) continue;
          if (!this._checkConditions(rule.conditions, chessInst, this.prevEval, this.prevPhase || 'middlegame')) continue;
          if (this._hasFirstTimeCond(rule) && this.triggeredRuleIds.has(rule.id)) continue;
          this._activateRule(rule, this.prevPhase || 'middlegame');
          break;
        }
        // Hide dialogue after a delay so the player can read it
        const bubble = document.getElementById('bot-dialogue-bubble-' + this.position);
        if (bubble && bubble.style.display !== 'none') {
          setTimeout(() => { this.activeRule = null; this._hideDialogue(); }, 6000);
        } else {
          this.activeRule = null;
          this._hideDialogue();
        }
      } else {
        this.activeRule = null;
        this._hideDialogue();
      }
    },
    };
  }

  // Play vs Bot: the bot is always shown in the top clock row.
  const personalityEngine = createPersonalityEngine();
  personalityEngine.reset(null, null, { position: 'top', fixedColor: null });

  // Bot vs Bot: White bot sits in the bottom clock row (clock-player),
  // Black bot sits in the top clock row (clock-bot).
  const bvbWhiteEngine = createPersonalityEngine();
  bvbWhiteEngine.reset(null, null, { position: 'bottom', fixedColor: 'w', botLabel: 'White' });
  const bvbBlackEngine = createPersonalityEngine();
  bvbBlackEngine.reset(null, null, { position: 'top', fixedColor: 'b', botLabel: 'Black' });

  function hideAllDialogueBubbles() {
    const top = document.getElementById('bot-dialogue-bubble-top');
    const bot = document.getElementById('bot-dialogue-bubble-bottom');
    if (top) top.style.display = 'none';
    if (bot) bot.style.display = 'none';
  }


  async function onPlayTabOpen() {
    await renderBotsList();
    // Only check resume if no active game
    if (!playState.active) {
      await checkResumeGame();
    }
  }

  // ═══════════════════════════════════════════════════
  //  REVIEW TAB
  // ═══════════════════════════════════════════════════

