/* Gesture-unlocked, local sound synthesis. No game clocks or ambient loops. */
(() => {
  "use strict";

  const AudioContextType = window.AudioContext || window.webkitAudioContext;
  const STORAGE_KEY = "pro-test-game-sfx-muted-v1";
  const MASTER_LEVEL = .22;
  const MAX_VOICES = 7;
  const MAX_CLIP_SECONDS = .60;
  const T = (wave, from, to, duration, level, delay = 0, attack = .002) => ({ wave, from, to, duration, level, delay, attack });
  const N = (filter, from, to, duration, level, delay = 0, q = .8) => ({ noise: true, filter, from, to, duration, level, delay, q, attack: .001 });
  const SOUNDS = Object.freeze({
    shot: [T("triangle", 210, 42, .18, .52, 0, .001), T("sine", 64, 33, .21, .36), N("highpass", 2100, 950, .055, .23), T("sawtooth", 880, 140, .035, .055)],
    hit: [N("bandpass", 2800, 1400, .08, .27, 0, 2.8), T("sine", 1480, 1300, .15, .15), T("triangle", 2380, 2150, .11, .085, .004), T("sine", 3750, 3200, .07, .055, .008), T("sine", 190, 85, .11, .18)],
    block: [N("bandpass", 1000, 550, .105, .21, 0, 1.5), T("sine", 310, 240, .24, .22), T("sine", 557, 480, .31, .12), T("triangle", 790, 630, .18, .07), T("sine", 72, 44, .28, .31)],
    perfect: [T("sine", 980, 1040, .12, .10), T("sine", 1470, 1600, .18, .12, .028), T("sine", 1960, 2200, .23, .105, .06), N("highpass", 4800, 3400, .035, .035)],
    miss: [T("triangle", 180, 62, .15, .25), N("lowpass", 430, 190, .065, .14), T("sine", 90, 57, .18, .20), T("square", 310, 270, .045, .025)],
    early: [T("triangle", 205, 75, .13, .23), N("lowpass", 560, 230, .055, .13), T("sine", 105, 65, .16, .19)],
    switch: [N("bandpass", 1700, 1100, .025, .25, 0, 2.2), N("highpass", 2800, 1900, .018, .14, .045), T("triangle", 360, 180, .085, .14, .01), T("sine", 70, 48, .10, .11, .045)],
    disarm: [T("sawtooth", 560, 65, .26, .085), N("lowpass", 1100, 100, .17, .075), T("sine", 880, 880, .12, .10, .21), T("sine", 1320, 1320, .15, .11, .29), T("sine", 1760, 1760, .18, .09, .35)],
    fail: [T("sawtooth", 145, 36, .28, .12), N("lowpass", 500, 140, .19, .12), T("sine", 56, 28, .40, .23), T("triangle", 118, 88, .16, .085, .10)],
    confirm: [T("triangle", 620, 880, .07, .065), N("bandpass", 2600, 2200, .018, .035, 0, 1.1)],
  });

  let context = null, compressor = null, master = null, noiseBuffer = null;
  let available = typeof AudioContextType === "function", unlocked = false, pendingUnlock = null, appSuspended = false;
  // Native cache preloading finishes before game boot calls restorePreference.
  let muted = window.MiniStorage ? false : readPreference(), sequence = 0, epoch = 0;
  let preferenceSaved = null, preferencePending = false, preferenceSequence = 0;
  const voices = new Map();
  const played = Object.create(null);
  const stats = { attempted: 0, playedTotal: 0, dropped: 0, stolen: 0, failures: 0, lastSound: "" };

  function readPreference() {
    if (window.MiniStorage && typeof window.MiniStorage.getItem === "function") {
      try {
        const value = window.MiniStorage.getItem(STORAGE_KEY, "local");
        return value === "1" || value === "true";
      } catch (_) { return false; }
    }
    for (const storageName of ["localStorage", "sessionStorage"]) {
      try {
        const value = window[storageName] && window[storageName].getItem(STORAGE_KEY);
        if (value !== null && value !== undefined) return value === "1" || value === "true";
      } catch (_) { /* Storage can be unavailable inside a private WebView. */ }
    }
    return false;
  }
  function writePreference() {
    const writeSequence = ++preferenceSequence;
    if (window.MiniStorage && typeof window.MiniStorage.setItem === "function") {
      preferencePending = true; preferenceSaved = null;
      let operation;
      try { operation = window.MiniStorage.setItem(STORAGE_KEY, muted ? "1" : "0", "local"); }
      catch (_) { preferencePending = false; preferenceSaved = false; return Promise.resolve(false); }
      return Promise.resolve(operation).then((saved) => {
        if (writeSequence === preferenceSequence) { preferencePending = false; preferenceSaved = saved === true; }
        return saved === true;
      }, () => {
        if (writeSequence === preferenceSequence) { preferencePending = false; preferenceSaved = false; }
        return false;
      });
    }
    preferencePending = false;
    for (const storageName of ["localStorage", "sessionStorage"]) {
      try {
        if (window[storageName]) { window[storageName].setItem(STORAGE_KEY, muted ? "1" : "0"); preferenceSaved = true; return Promise.resolve(true); }
      } catch (_) { /* Audio remains usable without preference persistence. */ }
    }
    preferenceSaved = false; return Promise.resolve(false);
  }
  function restorePreference() {
    const restored = readPreference();
    if (restored !== muted) {
      muted = restored; epoch += 1; pendingUnlock = null;
      if (muted) { masterLevel(0); unlocked = false; stop(); }
    }
    return muted;
  }
  function clamp(value, low, high) { return Math.max(low, Math.min(high, value)); }
  function disconnect(node) { try { node.disconnect(); } catch (_) { /* Already detached. */ } }
  function masterLevel(level) {
    if (!master || !context) return;
    try { master.gain.cancelScheduledValues(context.currentTime); master.gain.setValueAtTime(level, context.currentTime); }
    catch (_) { try { master.gain.value = level; } catch (_) { /* A closed context is silent. */ } }
  }
  function retire(voice, force = true) {
    if (!voice || voice.closed) return;
    voice.closed = true;
    if (voice.timer !== null) window.clearTimeout(voice.timer);
    voice.timer = null;
    try { voice.bus.gain.cancelScheduledValues(context ? context.currentTime : 0); voice.bus.gain.value = 0; } catch (_) { /* Disconnection also silences it. */ }
    voice.sources.forEach((source) => {
      source.onended = null;
      if (force) { try { source.stop(context ? context.currentTime : 0); } catch (_) { /* The source may have ended already. */ } }
    });
    voice.nodes.forEach((node) => {
      for (const name of ["gain", "frequency", "Q", "detune", "pan"]) {
        try { if (node[name] && node[name].cancelScheduledValues) node[name].cancelScheduledValues(context ? context.currentTime : 0); } catch (_) { /* Best effort after interruption. */ }
      }
      disconnect(node);
    });
    voice.sources.clear(); voice.nodes.clear(); voices.delete(voice.id);
  }
  function stop() {
    if (pendingUnlock) { epoch += 1; pendingUnlock = null; }
    Array.from(voices.values()).forEach((voice) => retire(voice));
  }
  function onStateChange() {
    if (context && context.state !== "running") { unlocked = false; stop(); }
  }
  function detachGraph() {
    stop();
    if (context) {
      if (typeof context.removeEventListener === "function") context.removeEventListener("statechange", onStateChange);
      else context.onstatechange = null;
    }
    if (compressor) disconnect(compressor);
    if (master) disconnect(master);
    compressor = null; master = null; noiseBuffer = null;
  }
  function createGraph() {
    const candidate = new AudioContextType();
    context = candidate;
    try {
      for (const method of ["createDynamicsCompressor", "createGain", "createBuffer", "createBufferSource", "createOscillator", "createBiquadFilter"]) {
        if (typeof context[method] !== "function") throw new Error("Audio synthesis is unavailable");
      }
      compressor = context.createDynamicsCompressor();
      compressor.threshold.value = -14; compressor.knee.value = 18; compressor.ratio.value = 6;
      compressor.attack.value = .003; compressor.release.value = .11;
      master = context.createGain(); master.gain.value = 0;
      compressor.connect(master); master.connect(context.destination);
      noiseBuffer = context.createBuffer(1, Math.ceil(context.sampleRate * MAX_CLIP_SECONDS), context.sampleRate);
      const samples = noiseBuffer.getChannelData(0);
      for (let i = 0; i < samples.length; i += 1) samples[i] = (Math.random() * 2 - 1) * .82;
      if (typeof context.addEventListener === "function") context.addEventListener("statechange", onStateChange);
      else context.onstatechange = onStateChange;
      available = true;
    } catch (error) {
      detachGraph(); context = null;
      try { if (typeof candidate.close === "function") Promise.resolve(candidate.close()).catch(() => {}); } catch (_) { /* Never block the game for audio. */ }
      throw error;
    }
  }

  // Called by the game's trusted pointer/keyboard handler, never by a timer.
  // Await the returned boolean before calling play when the browser must resume.
  function unlock() {
    if (muted || typeof AudioContextType !== "function") return Promise.resolve(false);
    appSuspended = false;
    const requestEpoch = epoch;
    if (context && context.state === "closed") { detachGraph(); context = null; }
    if (!context) {
      try { createGraph(); }
      catch (_) { available = false; unlocked = false; stats.failures += 1; return Promise.resolve(false); }
    }
    if (context.state === "running") { unlocked = true; masterLevel(MASTER_LEVEL); return Promise.resolve(true); }
    if (pendingUnlock && pendingUnlock.epoch === requestEpoch) return pendingUnlock.promise;
    const resumedContext = context;
    let operation;
    try { if (typeof context.resume !== "function") return Promise.resolve(false); operation = context.resume(); }
    catch (_) { unlocked = false; stats.failures += 1; return Promise.resolve(false); }
    const request = { epoch: requestEpoch, promise: null };
    request.promise = Promise.resolve(operation).then(() => {
      const currentRequest = requestEpoch === epoch && context === resumedContext;
      const ready = currentRequest && !muted && context.state === "running";
      if (currentRequest) unlocked = ready;
      if (ready) masterLevel(MASTER_LEVEL);
      else if (appSuspended && context === resumedContext && context.state === "running") {
        try { Promise.resolve(context.suspend()).catch(() => {}); } catch (_) { /* A stale resume must never restart background audio. */ }
      }
      return ready;
    }, () => { if (requestEpoch === epoch) unlocked = false; stats.failures += 1; return false; }).then((ready) => {
      if (pendingUnlock === request) pendingUnlock = null;
      return ready;
    });
    pendingUnlock = request;
    return request.promise;
  }
  function addNode(voice, node) { voice.nodes.add(node); return node; }
  function envelope(param, start, duration, level, attack) {
    param.setValueAtTime(0, start);
    param.linearRampToValueAtTime(level, start + attack);
    param.exponentialRampToValueAtTime(.0001, start + duration);
    param.setValueAtTime(0, start + duration + .003);
  }
  function layer(voice, part, pitch) {
    const start = voice.start + part.delay, duration = Math.min(part.duration, MAX_CLIP_SECONDS - part.delay - .008);
    const source = addNode(voice, part.noise ? context.createBufferSource() : context.createOscillator());
    const gain = addNode(voice, context.createGain());
    voice.sources.add(source);
    let output = source;
    if (part.noise) {
      source.buffer = noiseBuffer;
      const filter = addNode(voice, context.createBiquadFilter()); filter.type = part.filter;
      filter.frequency.setValueAtTime(part.from * pitch, start);
      filter.frequency.exponentialRampToValueAtTime(Math.max(20, part.to * pitch), start + duration);
      filter.Q.setValueAtTime(part.q, start);
      source.connect(filter); output = filter;
    } else {
      source.type = part.wave;
      source.frequency.setValueAtTime(part.from * pitch, start);
      source.frequency.exponentialRampToValueAtTime(Math.max(20, part.to * pitch), start + duration);
    }
    envelope(gain.gain, start, duration, part.level, part.attack);
    output.connect(gain); gain.connect(voice.bus);
    source.onended = () => {
      source.onended = null; voice.sources.delete(source); disconnect(source);
      if (!voice.closed && voice.sources.size === 0) retire(voice, false);
    };
    source.start(start); source.stop(start + duration + .006);
    return part.delay + duration + .006;
  }
  function play(name, options = {}) {
    stats.attempted += 1;
    if (!Object.prototype.hasOwnProperty.call(SOUNDS, name) || muted || !unlocked || !context || context.state !== "running") { stats.dropped += 1; return false; }
    const volume = Number.isFinite(Number(options && options.volume)) ? clamp(Number(options.volume), 0, 1) : .9;
    if (volume <= 0) { stats.dropped += 1; return false; }
    if (voices.size >= MAX_VOICES) { retire(voices.values().next().value); stats.stolen += 1; }
    let voice;
    try {
      const bus = context.createGain(); bus.gain.value = volume;
      voice = { id: ++sequence, bus, nodes: new Set([bus]), sources: new Set(), closed: false, timer: null, start: context.currentTime + .002 };
      voices.set(voice.id, voice);
      const pan = Number(options && options.pan);
      if (Number.isFinite(pan) && Math.abs(pan) > .001 && typeof context.createStereoPanner === "function") {
        const panner = addNode(voice, context.createStereoPanner()); panner.pan.value = clamp(pan, -1, 1); bus.connect(panner); panner.connect(compressor);
      } else bus.connect(compressor);
      const variation = Number.isFinite(Number(options && options.variation)) ? clamp(Number(options.variation), 0, .08) : .025;
      const pitch = 1 + (Math.random() * 2 - 1) * variation;
      let length = 0;
      SOUNDS[name].forEach((part) => { length = Math.max(length, layer(voice, part, pitch)); });
      voice.timer = window.setTimeout(() => retire(voice), Math.ceil((length + .035) * 1000));
      played[name] = (played[name] || 0) + 1; stats.playedTotal += 1; stats.lastSound = name;
      return true;
    } catch (_) { if (voice) retire(voice); stats.failures += 1; return false; }
  }
  function setMuted(value) {
    muted = Boolean(value); epoch += 1; pendingUnlock = null;
    if (muted) { masterLevel(0); unlocked = false; stop(); }
    writePreference(); return muted;
  }
  function suspend() {
    appSuspended = true; epoch += 1; pendingUnlock = null; unlocked = false; stop(); masterLevel(0);
    if (!context || context.state === "closed" || context.state === "suspended") return Promise.resolve(true);
    try { if (typeof context.suspend !== "function") return Promise.resolve(false); return Promise.resolve(context.suspend()).then(() => true, () => { stats.failures += 1; return false; }); }
    catch (_) { stats.failures += 1; return Promise.resolve(false); }
  }
  function getState() {
    return Object.freeze(Object.assign({
      muted, available, unlocked: Boolean(unlocked && context && context.state === "running"),
      state: context ? context.state : available ? "locked" : "unavailable",
      activeVoices: voices.size, maxVoices: MAX_VOICES,
      preferenceSaved, preferencePending,
    }, stats, { played: Object.freeze(Object.assign({}, played)) }));
  }
  window.GameSFX = Object.freeze({ unlock, play, stop, suspend, setMuted, restorePreference, isMuted: () => muted, isAvailable: () => available, getState });
})();
