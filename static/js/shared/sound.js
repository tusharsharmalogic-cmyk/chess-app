// sound.js — Chess sound effects
// Files expected at static/sounds/: Move.ogg, Capture.ogg, Check.ogg, GameEnd.ogg
//
// Usage:
//   SoundFX.play('move')                    — play a specific sound
//   SoundFX.playForMove(game, moveObj)      — auto-pick sound from chess.js state
//   SoundFX.setEnabled(false)               — mute/unmute
(function () {
  const SOUND_FILES = {
    move:    'static/sounds/Move.ogg',
    capture: 'static/sounds/Capture.ogg',
    check:   'static/sounds/Check.ogg',
    gameend: 'static/sounds/GameEnd.ogg'
  };

  const _audio = {};
  let _enabled = true;
  let _lastPlayedAt = 0;

  function _get(name) {
    if (!_audio[name]) {
      try {
        _audio[name] = new Audio(SOUND_FILES[name]);
        _audio[name].preload = 'auto';
      } catch (e) { return null; }
    }
    return _audio[name];
  }

  // Play a named sound. Debounced ~60ms so rapid navigation doesn't stack audio.
  function play(name) {
    if (!_enabled || !SOUND_FILES[name]) return;
    try {
      const now = Date.now();
      if (now - _lastPlayedAt < 60) return;
      _lastPlayedAt = now;

      const a = _get(name);
      if (!a) return;
      a.currentTime = 0;
      const p = a.play();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch (e) { /* never break the game over sound */ }
  }

  // Decide which sound fits the position right AFTER `moveObj` was applied to `game`.
  // Priority: game end > check > capture > normal move.
  function playForMove(game, moveObj) {
    if (!game || !moveObj) return;
    try {
      const over = typeof game.game_over === 'function' && game.game_over();
      if (over) { play('gameend'); return; }          // checkmate / stalemate / draw
      if (typeof game.in_check === 'function' && game.in_check()) { play('check'); return; }
    } catch (e) { /* fall through to move sound */ }
    if (moveObj.captured || (moveObj.flags && moveObj.flags.indexOf('e') !== -1)) {
      play('capture');
      return;
    }
    play('move');
  }

  function setEnabled(v) { _enabled = !!v; }

  window.SoundFX = {
    play,
    playForMove,
    setEnabled,
    get enabled() { return _enabled; }
  };
})();
