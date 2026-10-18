(() => {
  "use strict";

  const app = document.querySelector("#app");
  document.body.classList.toggle("in-minitool", Boolean(window.xhs && window.xhs.miniTool));
  const APP_VERSION = "1.4.0";
  const STORAGE_KEY = `pro-test-game-progress-${APP_VERSION}`;
  const TOTAL_LEVELS = 6;
  const ACTION_TIMEOUT_MS = 5000;
  const LEVELS = [
    {
      id: "reaction",
      title: "神经反射",
      goal: "反应",
      color: "var(--green)",
      instruction: "盯住走廊尽头的闸门。绿色能量靶亮起时，立刻点击开火；亮起前开火算抢跑。",
      rule: "3 次有效测试 · 随机等待 · 绿色出现 5 秒未点击则本关超时",
      run: runReaction,
    },
    {
      id: "timing",
      title: "完美格挡",
      goal: "时机",
      color: "var(--yellow)",
      instruction: "能量刃会从远处迎面飞来。它撞上面前护盾的一瞬间，点击格挡。",
      rule: "3 次格挡 · 每次速度不同 · 越接近 0ms 越好",
      run: runTiming,
    },
    {
      id: "decision",
      title: "别急着点",
      goal: "判断",
      color: "var(--orange)",
      instruction: "机库里会出现两种无人机：红色尖翼是敌机，点击开火；蓝色带十字的是友机，忍住。",
      rule: "10 次敌我识别 · 红色敌机开火 / 蓝色友机停火",
      run: runDecision,
    },
    {
      id: "prediction",
      title: "预判射击",
      goal: "预判",
      color: "var(--blue)",
      textColor: "var(--white)",
      instruction: "观察运输机的速度。它进入蓝色机库后，预判它穿过右侧出口准星的时刻开火。",
      rule: "3 次预判 · 进入遮挡前不能点 · 速度随机",
      run: runPrediction,
    },
    {
      id: "attention",
      title: "多目标警戒",
      goal: "专注",
      color: "var(--pink)",
      instruction: "扫描不同纵深的哨塔。某座哨塔变红并展开武器时，直接点中它，阻止入侵。",
      rule: "4 轮 · 最多 12 座哨塔 · 点中入侵者 · 键盘方向键选中后空格开火",
      run: runAttention,
    },
    {
      id: "pressure",
      title: "黄金 6.66",
      goal: "抗压",
      color: "var(--orange)",
      instruction: "核心开始充能后，在最接近 6.66 秒时点击拆弹。装置上的数码屏会在 4 秒后熄灭。",
      rule: "只有 1 次机会 · 4 秒后隐藏计时 · 10 秒未点击则失败",
      run: runPressure,
    },
  ];

  const SCORE_ANCHORS = {
    reaction: [[100, 100], [200, 80], [300, 60], [400, 30], [500, 0]],
    decisionSpeed: [[180, 100], [220, 80], [260, 60], [340, 30], [450, 0]],
    timing: [[20, 100], [45, 80], [80, 60], [140, 30], [220, 0]],
    prediction: [[40, 100], [80, 80], [140, 60], [240, 30], [400, 0]],
    attentionSpeed: [[350, 100], [500, 80], [750, 60], [1000, 30], [1800, 0]],
    pressure: [[30, 100], [80, 85], [200, 60], [350, 30], [600, 0]],
  };
  const DECISION_ACCURACY_SCORES = [0, 0, 0, 0, 0, 0, 20, 40, 65, 85, 100];
  const ATTENTION_HIT_SCORES = [0, 0, 25, 60, 100];

  let levelIndex = 0;
  let cleanupTasks = [];
  let screenLocked = false;
  let inFinalResult = false;
  let currentScreen = "home";
  let lastLevelResult = null;
  let resumeNotice = "";
  let results = freshResults();
  let challengeScene = null;
  let impactFeedback = null;
  let activityGeneration = 0;
  let booted = false;
  const sound = window.GameSFX;

  function unlockSound() {
    if (sound && !document.hidden) return sound.unlock();
    return null;
  }

  function updateSoundButton() {
    const button = app.querySelector("[data-action='sound-toggle']");
    if (!button || !sound) return;
    const available = sound.isAvailable();
    const muted = sound.isMuted() || !available;
    button.dataset.muted = String(muted);
    button.disabled = !available;
    button.setAttribute("aria-pressed", String(!muted));
    button.setAttribute("aria-label", available ? `音效：${muted ? "关，点击开启" : "开，点击静音"}` : "当前环境音效不可用");
    button.title = available ? muted ? "开启音效" : "静音" : "当前环境音效不可用";
    const label = button.querySelector(".audio-label");
    if (label) label.textContent = muted ? "音效关" : "音效开";
  }

  function actionFeedback(kinds, options = {}) {
    // Every caller records its score/timestamp before reaching this function.
    const generation = activityGeneration;
    const play = () => {
      if (sound && generation === activityGeneration && !document.hidden) {
        const volume = options.power === null || options.power === undefined ? .7 : options.power;
        kinds.forEach(kind => sound.play(kind, Object.assign({}, options, { volume })));
      }
    };
    if (sound && options.gesture) {
      const pending = unlockSound();
      if (sound.getState().unlocked) play();
      else Promise.resolve(pending).then(ready => { if (ready) play(); updateSoundButton(); });
    } else play();
    // A block layers result sounds but uses one complete shield effect.
    const visualKinds = kinds.includes("block") ? ["block"] : kinds;
    visualKinds.forEach(kind => { if (impactFeedback) impactFeedback.trigger(kind, options); });
  }

  const ICON_PATHS = {
    reaction: '<path d="m14 2-9 12h6l-1 8 9-12h-6z"/>',
    timing: '<path d="m12 3 8 4v5c0 5-8 9-8 9s-8-4-8-9V7z"/><path d="m8 12 3 3 5-6"/>',
    decision: '<path d="M8 3v18M16 3v18M3 8h18M3 16h18"/><circle cx="8" cy="8" r="3"/><circle cx="16" cy="16" r="3"/>',
    prediction: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 1v5m0 12v5M1 12h5m12 0h5"/>',
    attention: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
    pressure: '<circle cx="12" cy="13" r="8"/><path d="M9 2h6m-3 3v-3m0 7v4l3 2M18 6l2-2"/>',
  };
  const LEVEL_ENGLISH = ["REACTION", "TIMING", "DECISION", "PREDICTION", "FOCUS", "PRESSURE"];
  const arena = window.ProArena3D;
  if (arena) {
    try { arena.mount(document.querySelector("#arena-world")); }
    catch (error) { console.warn("3D scene unavailable; continuing with the standard interface", error); }
  }

  function icon(id, className = "") {
    return `<svg class="${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[id] || ICON_PATHS.reaction}</svg>`;
  }

  function sceneSignal(state) {
    if (arena) arena.setSignal(state);
  }

  function updateScene() {
    if (!arena) return;
    const modeMap = { timing: "parry", decision: "stroop", attention: "focus", pressure: "timer" };
    const level = LEVELS[levelIndex];
    const mode = currentScreen === "play" ? (modeMap[level.id] || level.id)
      : currentScreen === "intro" ? "instruction"
      : currentScreen === "final" || currentScreen === "result" ? "result" : "home";
    arena.setMode(mode);
    if (arena.setPaused) arena.setPaused(currentScreen === "play");
    sceneSignal(currentScreen === "result" || currentScreen === "final" ? "success" : "idle");
  }

  function freshResults() {
    return {
      reaction: { times: [], falseStarts: 0, timedOut: false },
      decision: { times: [], falseTaps: 0, misses: 0, correctRed: 0, timedOut: false },
      timing: { errors: [], perfect: 0, timedOut: false },
      prediction: { errors: [], misses: 0, timedOut: false },
      attention: { times: [], misses: 0, early: 0, timedOut: false },
      pressure: { errors: [], stoppedAt: null, misses: 0, timedOut: false },
    };
  }

  function random(min, max) {
    return min + Math.random() * (max - min);
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function average(values) {
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  }

  function rounded(value) {
    return Math.round(value || 0);
  }

  function schedule(callback, delay) {
    const timer = window.setTimeout(callback, delay);
    cleanupTasks.push(() => window.clearTimeout(timer));
    return timer;
  }

  function animate(callback) {
    let frame = 0;
    const loop = (now) => {
      if (callback(now) !== false) frame = window.requestAnimationFrame(loop);
    };
    frame = window.requestAnimationFrame(loop);
    cleanupTasks.push(() => window.cancelAnimationFrame(frame));
  }

  function onNextFrame(callback) {
    const frame = window.requestAnimationFrame(callback);
    cleanupTasks.push(() => window.cancelAnimationFrame(frame));
  }

  function clearActivity() {
    activityGeneration += 1;
    cleanupTasks.forEach((cleanup) => cleanup());
    cleanupTasks = [];
    screenLocked = false;
    if (sound) sound.stop();
  }

  function bindPointer(selector, handler) {
    const element = typeof selector === "string" ? app.querySelector(selector) : selector;
    if (!element) return;
    const listener = (event) => {
      if (!event.isPrimary || event.button > 0) return;
      event.preventDefault();
      handler(event);
    };
    const keyListener = (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      handler(event);
    };
    element.addEventListener("pointerdown", listener, { passive: false });
    element.addEventListener("keydown", keyListener);
    cleanupTasks.push(() => {
      element.removeEventListener("pointerdown", listener);
      element.removeEventListener("keydown", keyListener);
    });
  }

  function bindClick(selector, handler) {
    const element = typeof selector === "string" ? app.querySelector(selector) : selector;
    if (!element) return;
    const listener = (event) => {
      event.preventDefault();
      unlockSound();
      handler(event);
    };
    const keyListener = (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      unlockSound();
      handler(event);
    };
    element.addEventListener("click", listener);
    element.addEventListener("keydown", keyListener);
    cleanupTasks.push(() => {
      element.removeEventListener("click", listener);
      element.removeEventListener("keydown", keyListener);
    });
  }

  function bindAction(selector, handler) {
    bindClick(selector, (event) => {
      if (screenLocked) return;
      screenLocked = true;
      if (sound) sound.play("confirm", { volume: .35 });
      event.currentTarget.classList.add("is-pressed");
      schedule(() => {
        clearActivity();
        handler();
      }, 90);
    });
  }

  function persistProgress() {
    if (currentScreen === "home") return;
    try {
      const value = JSON.stringify({
        version: APP_VERSION,
        levelIndex,
        levelId: LEVELS[levelIndex] ? LEVELS[levelIndex].id : null,
        currentScreen,
        lastLevelResult,
        resumeNotice,
        results,
      });
      if (window.MiniStorage && typeof window.MiniStorage.setItem === "function") {
        observeProgressWrite(window.MiniStorage.setItem(STORAGE_KEY, value, "session"), "Unable to save test progress");
      } else window.sessionStorage.setItem(STORAGE_KEY, value);
    } catch (error) {
      console.warn("Unable to save test progress", error);
    }
  }

  function observeProgressWrite(operation, message) {
    Promise.resolve(operation).then((saved) => { if (saved === false) console.warn(message); }, (error) => console.warn(message, error));
  }

  function clearSavedProgress() {
    try {
      if (window.MiniStorage && typeof window.MiniStorage.removeItem === "function") {
        observeProgressWrite(window.MiniStorage.removeItem(STORAGE_KEY, "session"), "Unable to clear test progress");
      } else window.sessionStorage.removeItem(STORAGE_KEY);
    } catch (error) {
      console.warn("Unable to clear test progress", error);
    }
  }

  function restoreProgress() {
    try {
      const raw = window.MiniStorage && typeof window.MiniStorage.getItem === "function"
        ? window.MiniStorage.getItem(STORAGE_KEY, "session") : window.sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      const saved = JSON.parse(raw);
      if (
        saved.version !== APP_VERSION ||
        !Number.isInteger(saved.levelIndex) ||
        saved.levelIndex < 0 ||
        saved.levelIndex >= TOTAL_LEVELS ||
        saved.levelId !== LEVELS[saved.levelIndex].id
      ) {
        clearSavedProgress();
        return false;
      }
      const restored = freshResults();
      Object.keys(restored).forEach((key) => {
        if (saved.results && saved.results[key]) Object.assign(restored[key], saved.results[key]);
      });
      levelIndex = saved.levelIndex;
      results = restored;
      currentScreen = ["intro", "play", "result", "final"].includes(saved.currentScreen) ? saved.currentScreen : "intro";
      lastLevelResult = saved.lastLevelResult || null;
      resumeNotice = typeof saved.resumeNotice === "string" ? saved.resumeNotice : "";
      return true;
    } catch (error) {
      console.warn("Unable to restore test progress", error);
      clearSavedProgress();
      return false;
    }
  }

  function resetCurrentLevelResult() {
    const level = LEVELS[levelIndex];
    if (!level) return;
    results[level.id] = freshResults()[level.id];
  }

  function timeoutCurrentLevel(reason) {
    const level = LEVELS[levelIndex];
    if (!level || currentScreen !== "play") return;
    clearActivity();
    results[level.id] = freshResults()[level.id];
    results[level.id].timedOut = true;
    showLevelResult({
      stamp: "超时",
      meta: `${reason} · 本关自动跳过并按最低成绩计入`,
      color: "var(--orange)",
    });
  }

  function shell(content, options = {}) {
    const {
      progress = 0,
      count = "6 关短测",
      note = "全程只需单指点击",
      brand = "PRO TEST",
      stageTitle = "",
      showProgress = true,
    } = options;
    const stage = LEVELS[levelIndex] || LEVELS[0];
    app.innerHTML = `
      <div class="app-shell" data-screen="${currentScreen}" data-level-id="${stage.id}" style="--stage-accent:${stage.color}">
        ${stageTitle ? `<div class="active-level-title" aria-label="当前关卡">${stageTitle}</div>` : ""}
        <header class="topbar">
          <span class="brand-mini" title="v${APP_VERSION}"><svg class="brand-symbol" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m16 2 12 7v14l-12 7-12-7V9zM4 9l12 7 12-7M16 16v14m-6-18 12-7"/></svg><span class="brand-wordmark">${brand}<small>电竞天赋实验室</small></span></span>
          ${showProgress ? `<div class="progress-track" role="progressbar" aria-label="测试进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${rounded(progress)}"><div class="progress-fill" style="--progress:${progress}%"></div></div>` : ""}
          <div class="topbar-right"><span class="online-indicator">${currentScreen === "home" ? "训练场就绪" : currentScreen === "final" || currentScreen === "result" ? "测试完成" : "测试进行中"}</span><button class="audio-toggle" type="button" data-action="sound-toggle" aria-pressed="true" aria-label="音效：开，点击静音"><svg class="audio-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z"/><path class="audio-waves" d="M16 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/><path class="audio-off" d="m17 10 5 5m0-5-5 5"/></svg><span class="audio-label">音效开</span></button><span class="stage-count">${count}</span></div>
        </header>
        <section class="screen screen-${currentScreen}">${content}</section>
        <footer class="bottom-note">${note}</footer>
      </div>`;
    document.body.dataset.screen = currentScreen;
    updateScene();
    updateSoundButton();
    bindClick("[data-action='sound-toggle']", event => {
      if (!sound || event.repeat) return;
      sound.setMuted(!sound.isMuted());
      if (!sound.isMuted()) {
        const generation = activityGeneration;
        Promise.resolve(unlockSound()).then(ready => {
          if (ready && generation === activityGeneration && !document.hidden) sound.play("confirm", { volume: .35 });
          updateSoundButton();
        });
      }
      updateSoundButton();
    });
  }

  function showHome() {
    clearActivity();
    inFinalResult = false;
    currentScreen = "home";
    lastLevelResult = null;
    resumeNotice = "";
    clearSavedProgress();
    shell(
      `<article class="hero">
        <div class="hero-copy">
          <span class="hero-sticker"><span class="eyebrow">PLAYER POTENTIAL / NEON ARENA</span></span>
          <h1><span class="title-main">能打职业</span><span class="title-line">吗<span class="title-accent">你？</span></span></h1>
          <p class="hero-sub">手速、预判，还是大心脏？<br>进入训练场，测测你的电竞天赋。</p>
          <div class="facts">
            <span class="fact"><strong>06</strong><small>能力挑战</small></span>
            <span class="fact"><strong>90<span>s</span></strong><small>发现你的潜能</small></span>
            <span class="fact"><strong>01</strong><small>根手指就够</small></span>
          </div>
          <div class="hero-actions">
            <button class="brutal-btn" type="button" data-action="start"><span>进入训练场</span><span aria-hidden="true">↗</span></button>
            <p class="tiny-disclaimer">无需下载 · 戴上你的自信，其他交给反应</p>
          </div>
        </div>
        <div class="arena-hud" aria-hidden="true"><span class="hud-crosshair"></span><span class="hud-orbit-label">CORE / ONLINE</span><span class="hud-readout">PLAYER POTENTIAL</span></div>
        <div class="arena-caption" aria-hidden="true"><span class="coordinate">SYS. 001 / POTENTIAL CORE</span><span class="arena-name">你的潜能，等待唤醒。</span><span class="arena-hint">移动光标，探索训练场</span></div>
        <div class="test-lineup" role="list" aria-label="六项能力挑战">${LEVELS.map((level, index) => `<div class="test-module" role="listitem"><span class="module-no">0${index + 1}</span>${icon(level.id, "module-icon")}<span class="module-name">${level.title}</span><span class="module-en">${LEVEL_ENGLISH[index]}</span></div>`).join("")}</div>
      </article>`,
      { progress: 0, count: "NEON ARENA", note: "仅供娱乐，不代表职业选拔结果 · 设备性能会影响毫秒数据", showProgress: false },
    );
    bindAction("[data-action='start']", () => {
      levelIndex = 0;
      results = freshResults();
      showLevelIntro();
    });
  }

  function showLevelIntro() {
    clearActivity();
    inFinalResult = false;
    currentScreen = "intro";
    const level = LEVELS[levelIndex];
    const notice = resumeNotice;
    resumeNotice = "";
    shell(
      `<article class="level-card" style="--level-color:${level.color};--level-text:${level.textColor || "var(--ink)"}">
        <div class="level-glyph">${icon(level.id)}</div>
        <span class="level-no">第 ${levelIndex + 1} / ${TOTAL_LEVELS} 关 · ${level.goal}</span>
        <h2>${level.title}</h2>
        <p class="goal">EXPERIMENT 0${levelIndex + 1} / ${LEVEL_ENGLISH[levelIndex]}</p>
        <p class="instruction">${level.instruction}</p>
        <div class="rule-box">${level.rule}</div>
        ${notice ? `<p class="resume-note" role="status">${notice}</p>` : ""}
        <button class="brutal-btn" type="button" data-action="play">我准备好了，开始 →</button>
      </article>`,
      {
        progress: (levelIndex / TOTAL_LEVELS) * 100,
        count: `${levelIndex + 1} / ${TOTAL_LEVELS}`,
        note: "点击开始后，测试区域任意位置都可操作",
      },
    );
    persistProgress();
    bindAction("[data-action='play']", level.run);
  }

  function showLevelResult({ stamp, meta, color = "var(--green)" }) {
    clearActivity();
    currentScreen = "result";
    lastLevelResult = { stamp, meta, color };
    const level = LEVELS[levelIndex];
    const isLast = levelIndex === TOTAL_LEVELS - 1;
    shell(
      `<article class="round-card" style="--result-color:${color}">
        <p class="goal">第 ${levelIndex + 1} 关完成</p>
        <h2 class="result-title">${level.title}</h2>
        <div class="result-stamp">${stamp}</div>
        <p class="result-meta">${meta}</p>
        <button class="brutal-btn ${isLast ? "" : "secondary"}" type="button" data-action="next">${isLast ? "查看职业报告" : "下一关 →"}</button>
      </article>`,
      {
        progress: ((levelIndex + 1) / TOTAL_LEVELS) * 100,
        count: `${levelIndex + 1} / ${TOTAL_LEVELS}`,
        note: isLast ? "数据已计算完成" : `下一关：${LEVELS[levelIndex + 1].title}`,
      },
    );
    persistProgress();
    bindAction("[data-action='next']", () => {
      if (isLast) showFinalResult();
      else {
        levelIndex += 1;
        showLevelIntro();
      }
    });
  }

  function setChallenge(patch, now = performance.now()) {
    if (!challengeScene) return;
    challengeScene.setState(patch);
    challengeScene.render(now);
  }

  function setStageStatus(text) {
    const node = app.querySelector("[data-status]");
    if (node && node.textContent !== text) node.textContent = text;
  }

  function setStageText(title, support) {
    const heading = app.querySelector("[data-scene-title]");
    const description = app.querySelector(".support-text");
    if (heading) heading.textContent = title;
    if (description && support !== undefined) description.textContent = support;
  }

  function setActionHint(text) {
    const node = app.querySelector("[data-action-hint]");
    if (node) node.textContent = text;
  }

  function playShell(inner, {
    round, total, status, className = "", note = "点击场景操作",
    sceneTitle = "准备", sceneTag = "LIVE SIMULATION", actionHint = "点击场景", actionDetail = "触屏 / 鼠标 / 空格", sceneState = {},
  }) {
    const level = LEVELS[levelIndex];
    currentScreen = "play";
    shell(
      `<div class="play-area challenge-stage stage-${level.id} ${className}" data-play-area role="button" tabindex="0" aria-label="${note}">
        <div class="play-head"><span class="round-pill">ROUND ${round} / ${total}</span><span class="status-pill" data-status>${status}</span></div>
        <div class="challenge-world" data-challenge-world aria-hidden="true"></div>
        <div class="challenge-caption"><span class="challenge-eyebrow">${sceneTag}</span><h3 class="challenge-title" data-scene-title>${sceneTitle}</h3><p class="support-text">${note}</p></div>
        <div class="challenge-feedback" data-metric-result role="status" aria-live="polite"></div>
        <div class="challenge-actionbar"><span class="action-icon" aria-hidden="true">⌖</span><strong data-action-hint>${actionHint}</strong><small data-action-detail>${actionDetail}</small></div>
        ${inner}
      </div>`,
      { progress: ((levelIndex + (round - 1) / total) / TOTAL_LEVELS) * 100, count: `${levelIndex + 1} / ${TOTAL_LEVELS}`, stageTitle: level.title, note: "3D 实战模拟 · 所有成绩仅供娱乐" },
    );
    const viewport = app.querySelector("[data-challenge-world]");
    const impact = window.GameImpact.create(app.querySelector("[data-play-area]"));
    impactFeedback = impact;
    cleanupTasks.push(() => { impact.destroy(); if (impactFeedback === impact) impactFeedback = null; });
    const instance = window.ChallengeScenes3D.create(viewport, level.id);
    challengeScene = instance;
    // Kept on this DOM node so accessibility/test tools can inspect projected targets.
    viewport.challengeScene = instance;
    instance.setState(sceneState);
    instance.render(performance.now());
    cleanupTasks.push(() => {
      instance.destroy();
      if (challengeScene === instance) challengeScene = null;
    });
    animate((now) => { instance.render(now); });
    persistProgress();
    onNextFrame(() => {
      const area = app.querySelector("[data-play-area]");
      if (area && typeof area.focus === "function") {
        try { area.focus({ preventScroll: true }); } catch (_) { area.focus(); }
      }
    });
  }

  function showMetricResult(message) {
    const overlay = app.querySelector("[data-metric-result]");
    if (overlay) { overlay.textContent = message; overlay.classList.add("is-visible"); }
    const area = app.querySelector("[data-play-area]");
    if (area) area.classList.add("state-resolved");
  }

  function runReaction() {
    const total = 3;
    let round = 0;
    const beginRound = () => {
      clearActivity();
      let live = false, cueTime = 0, completed = false;
      playShell("", {
        round: round + 1, total, status: "LOCKED", className: "reaction-waiting", sceneTag: "01 / REACTOR BREACH", sceneTitle: "等待绿色能量靶",
        note: "闸门解锁、绿灯亮起后立即开火", actionHint: "等待解锁 · 现在开火算抢跑", sceneState: { active: false, resolved: false },
      });
      schedule(() => {
        onNextFrame((now) => {
          if (completed) return;
          setChallenge({ active: true, appearedAt: now }, now);
          const area = app.querySelector("[data-play-area]");
          area.classList.replace("reaction-waiting", "reaction-live");
          setStageText("开火！", "绿色靶已启动，立即点击");
          setStageStatus("FIRE");
          setActionHint("绿色靶已启动 · 立即开火");
          // The cue is rendered synchronously in this frame before starting the clock.
          cueTime = performance.now(); live = true;
          schedule(() => { if (!completed) timeoutCurrentLevel("能量靶启动 5 秒仍未开火"); }, ACTION_TIMEOUT_MS);
        });
      }, random(1000, 2100));
      bindPointer("[data-play-area]", () => {
        if (completed) return;
        const reaction = live ? performance.now() - cueTime : 0;
        completed = true;
        const now = performance.now();
        if (!live) {
          results.reaction.falseStarts += 1;
          setStageStatus("EARLY"); setStageText("闸门还没解锁", "抢跑扣分，本轮重试");
          setActionHint("抢跑 · 等待闸门重新锁定");
          setChallenge({ resolved: true, outcome: "early", resolvedAt: now, shot: true, firedAt: now, impactKind: "miss" }, now);
          actionFeedback(["shot", "early"], { gesture: true, power: .55, outcome: "miss" });
          showMetricResult("抢跑 · -10 分");
          schedule(beginRound, 850); return;
        }
        results.reaction.times.push(reaction); round += 1;
        setStageStatus("HIT"); setStageText("命中反应靶", "弹道与命中反馈已记录");
        setActionHint("靶心已命中 · 等待下一轮");
        setChallenge({ resolved: true, outcome: "success", resolvedAt: now, shot: true, firedAt: now, impactKind: "hit" }, now);
        actionFeedback(["shot", "hit"], { gesture: true, power: .8, outcome: "success" });
        showMetricResult(`${rounded(reaction)} ms`);
        if (round < total) schedule(beginRound, 850);
        else schedule(() => {
          const avg = average(results.reaction.times), best = Math.min(...results.reaction.times);
          showLevelResult({ stamp: `${rounded(avg)}ms`, meta: `平均开火反应 · 最快 ${rounded(best)}ms${results.reaction.falseStarts ? ` · 抢跑 ${results.reaction.falseStarts} 次（每次 -10 分）` : ""}`, color: avg <= 200 ? "var(--green)" : avg <= 300 ? "var(--yellow)" : "var(--orange)" });
        }, 950);
      });
    };
    beginRound();
  }

  function buildSignalSequence() {
    const signals = ["go", "go", "go", "go", "go", "stop", "stop", "stop", "stop", "stop"];
    for (let i = signals.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [signals[i], signals[j]] = [signals[j], signals[i]];
    }
    return signals;
  }

  function runDecision() {
    const sequence = buildSignalSequence();
    let index = 0;
    const showSignal = () => {
      clearActivity();
      const signal = sequence[index];
      let completed = false, started = false, signalStart = 0;
      playShell('<span class="scene-a11y" data-decision-signal="pending">等待识别</span>', {
        round: index + 1, total: sequence.length, status: "SCANNING", sceneTag: "03 / FRIEND OR FOE", sceneTitle: "识别机库来客",
        note: "红色尖翼敌机开火 · 蓝色十字友机停火", actionHint: "红敌开火 / 蓝友停火", sceneState: { signal, visible: false, lane: index % 3 - 1 },
      });
      bindPointer("[data-play-area]", () => resolveSignal(true));
      schedule(() => onNextFrame((now) => {
        if (completed) return;
        setChallenge({ visible: true, appearedAt: now }, now);
        signalStart = performance.now(); started = true;
        app.querySelector("[data-decision-signal]").dataset.decisionSignal = signal;
        setStageStatus(signal === "go" ? "HOSTILE" : "FRIENDLY");
        setStageText(signal === "go" ? "敌机！开火" : "友机通过，停火", signal === "go" ? "红色尖翼 / 已确认敌对" : "蓝色医疗十字 / 不要误伤");
        schedule(() => resolveSignal(false), random(720, 1000));
      }), 280);
      function resolveSignal(tapped) {
        if (completed || !started) return;
        const elapsed = performance.now() - signalStart;
        completed = true;
        let success = false;
        if (signal === "go" && tapped) { results.decision.times.push(elapsed); success = true; }
        else if (signal === "go") results.decision.misses += 1;
        else if (tapped) results.decision.falseTaps += 1;
        else { results.decision.correctRed += 1; success = true; }
        const now = performance.now();
        setChallenge({ resolved: true, resolvedAt: now, outcome: success ? "success" : "miss", shot: tapped, firedAt: tapped ? now : null, impactKind: success ? "hit" : "miss" }, now);
        actionFeedback(tapped ? ["shot", success ? "hit" : "miss"] : [success ? "confirm" : "miss"], { gesture: tapped, power: tapped ? .75 : .4, outcome: success ? "success" : "miss" });
        showMetricResult(signal === "go" ? tapped ? `击落 · ${rounded(elapsed)}ms` : "漏过敌机" : tapped ? "误伤友机" : "正确停火");
        index += 1;
        if (index < sequence.length) schedule(showSignal, 430);
        else schedule(() => {
          const correct = results.decision.times.length + results.decision.correctRed;
          const avg = average(results.decision.times);
          showLevelResult({ stamp: `${rounded(correct / sequence.length * 100)}%`, meta: `敌我识别正确率 · 敌机平均 ${results.decision.times.length ? `${rounded(avg)}ms` : "未命中"} · 误伤 ${results.decision.falseTaps}`, color: correct >= 8 ? "var(--green)" : "var(--orange)" });
        }, 650);
      }
    };
    showSignal();
  }

  function runTiming() {
    const total = 3, impactProgress = .78;
    let round = 0;
    const beginRound = () => {
      clearActivity();
      const duration = random(1400, 1900);
      let startAt = performance.now() + 700;
      let completed = false;
      playShell("", {
        round: round + 1, total, status: "INCOMING", sceneTag: "02 / IMPACT PARRY", sceneTitle: "迎面拦截能量刃",
        note: "观察纵深距离，在能量刃接触前方护盾时格挡", actionHint: "接触护盾的瞬间 · 点击格挡", sceneState: { startAt, duration, impactProgress, resolved: false },
      });
      startAt = performance.now() + 750;
      setChallenge({ startAt });
      animate((now) => {
        if (completed) return false;
        if (now - startAt > duration + 250) { resolve(duration * (1 - impactProgress) + 250, true); return false; }
      });
      bindPointer("[data-play-area]", () => { if (!completed) resolve(performance.now() - startAt - duration * impactProgress); });
      function resolve(error, missed = false) {
        if (completed) return;
        const now = performance.now(); completed = true;
        const absError = Math.abs(error);
        results.timing.errors.push(absError);
        if (absError <= 20) results.timing.perfect += 1;
        const success = absError <= 80 && !missed;
        setChallenge({ resolved: true, resolvedAt: now, frozenProgress: clamp((now - startAt) / duration, 0, 1.3), outcome: success ? "success" : "miss", blockAttempt: !missed, impactKind: "block" }, now);
        actionFeedback(missed ? ["fail"] : success ? absError <= 20 ? ["block", "perfect"] : ["block"] : ["block", "miss"], { gesture: !missed, power: success ? .9 : .45, outcome: success ? "success" : "miss", perfect: absError <= 20 });
        setStageStatus(absError <= 20 ? "PERFECT" : absError <= 45 ? "GREAT" : absError <= 80 ? "BLOCK" : "MISS");
        showMetricResult(missed ? "未格挡 · 能量刃穿过防线" : `${error < 0 ? "提前" : "晚了"} ${rounded(absError)}ms`);
        round += 1;
        if (round < total) schedule(beginRound, 950);
        else schedule(() => {
          const avg = average(results.timing.errors);
          showLevelResult({ stamp: `±${rounded(avg)}ms`, meta: `护盾接触时机误差 · PERFECT ${results.timing.perfect} / ${total}`, color: avg <= 45 ? "var(--green)" : avg <= 80 ? "var(--yellow)" : "var(--orange)" });
        }, 1000);
      }
    };
    beginRound();
  }

  function runPrediction() {
    const total = 3;
    let round = 0;
    const beginRound = () => {
      clearActivity();
      const duration = random(2300, 2900), hideElapsed = duration * .5;
      let startAt = performance.now() + 700;
      let completed = false;
      playShell("", {
        round: round + 1, total, status: "TRACKING", sceneTag: "04 / BLIND SHOT", sceneTitle: "追踪运输机",
        note: "进入机库后失去视野，预判它穿过右侧准星的时刻", actionHint: "进入盲区后 · 预判出口开火", sceneState: { startAt, duration, resolved: false },
      });
      startAt = performance.now() + 750;
      setChallenge({ startAt });
      animate((now) => {
        if (completed) return false;
        const elapsed = now - startAt;
        const hidden = elapsed >= hideElapsed;
        const area = app.querySelector("[data-play-area]");
        area.dataset.occluded = String(hidden);
        setStageStatus(hidden ? "NO VISUAL" : "TRACKING");
        if (elapsed > duration + 650) { resolve(650, true, false, elapsed); return false; }
      });
      bindPointer("[data-play-area]", () => {
        if (completed) return;
        const elapsed = performance.now() - startAt;
        resolve(elapsed - duration, false, elapsed < hideElapsed, elapsed);
      });
      function resolve(error, missed, early, elapsed) {
        if (completed) return;
        completed = true;
        if (missed) results.prediction.misses += 1;
        const absError = early ? 800 : Math.abs(error);
        results.prediction.errors.push(absError);
        const now = performance.now(), success = !early && absError <= 140;
        setChallenge({ resolved: true, resolvedAt: now, frozenProgress: Math.max(0, elapsed / duration), outcome: success ? "success" : "miss", shot: !missed, firedAt: missed ? null : now, impactKind: success ? "hit" : "miss" }, now);
        actionFeedback(missed ? ["miss"] : ["shot", success ? "hit" : "miss"], { gesture: !missed, power: .8, outcome: success ? "success" : "miss" });
        setStageStatus(early ? "TOO EARLY" : absError <= 40 ? "PERFECT" : absError <= 80 ? "GREAT" : absError <= 140 ? "HIT" : "MISS");
        setStageText("机库轨迹已揭示", "开火时的位置与出口误差已记录");
        showMetricResult(early ? "目标还没进入盲区" : missed ? "错过出口时机" : `${error < 0 ? "提前" : "晚了"} ${rounded(Math.abs(error))}ms`);
        round += 1;
        if (round < total) schedule(beginRound, 1050);
        else schedule(() => {
          const avg = average(results.prediction.errors);
          showLevelResult({ stamp: `±${rounded(avg)}ms`, meta: `出口射击误差 · 最佳 ${rounded(Math.min(...results.prediction.errors))}ms · MISS ${results.prediction.misses}`, color: avg <= 80 ? "var(--green)" : avg <= 140 ? "var(--yellow)" : "var(--orange)" });
        }, 1100);
      }
    };
    beginRound();
  }

  function runAttention() {
    const counts = [4, 6, 9, 12];
    let round = 0;
    const beginRound = () => {
      clearActivity();
      const count = counts[round], changedIndex = Math.floor(Math.random() * count);
      let changed = false, completed = false, changedAt = 0, selectedIndex = -1;
      playShell("", {
        round: round + 1, total: counts.length, status: `${count} SENTRIES`, sceneTag: "05 / TOWER DEFENCE", sceneTitle: "扫描立体防线",
        note: "点中变红并展开武器的入侵哨塔", actionHint: "瞄准入侵哨塔 · 直接点击目标", actionDetail: "方向键选择 / 空格射击", sceneState: { count, changedIndex: -1, selectedIndex: -1, resolved: false },
      });
      const area = app.querySelector("[data-play-area]");
      const select = (event) => {
        if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key) || completed) return;
        event.preventDefault();
        const backwards = event.key === "ArrowLeft" || event.key === "ArrowUp";
        selectedIndex = selectedIndex < 0 ? backwards ? count - 1 : 0 : (selectedIndex + (backwards ? -1 : 1) + count) % count;
        setChallenge({ selectedIndex });
        const detail = app.querySelector("[data-action-detail]");
        if (detail) detail.textContent = `已选择 ${selectedIndex + 1} 号哨塔 · 空格射击`;
      };
      area.addEventListener("keydown", select);
      cleanupTasks.push(() => area.removeEventListener("keydown", select));
      schedule(() => onNextFrame((now) => {
        if (completed) return;
        setChallenge({ changedIndex }, now);
        changedAt = performance.now(); changed = true;
        area.dataset.changedTarget = String(changedIndex);
        setStageStatus("INTRUSION"); setStageText("发现入侵！", "点中红色武装哨塔");
        schedule(() => resolve(-1, false), 2200);
      }), random(900, 1600));
      bindPointer("[data-play-area]", (event) => {
        if (completed) return;
        if (event.type === "keydown" && selectedIndex < 0) { setActionHint("先用方向键选择哨塔，再按空格开火"); return; }
        const target = event.type === "keydown" ? selectedIndex : challengeScene.hitTest(event.clientX, event.clientY);
        resolve(target, true);
      });
      function resolve(target, tapped) {
        if (completed) return;
        const reaction = performance.now() - changedAt;
        completed = true;
        const success = changed && tapped && target === changedIndex;
        if (success) results.attention.times.push(reaction);
        else { results.attention.misses += 1; if (!changed) results.attention.early += 1; }
        const now = performance.now();
        setChallenge({ resolved: true, resolvedAt: now, outcome: success ? "success" : "miss", hitIndex: target, shot: tapped, firedAt: tapped ? now : null, impactKind: success ? "hit" : "miss" }, now);
        actionFeedback(tapped ? ["shot", success ? "hit" : "miss"] : ["miss"], { gesture: tapped, power: .75, outcome: success ? "success" : "miss" });
        setStageStatus(success ? "NEUTRALISED" : "MISS");
        showMetricResult(success ? `入侵解除 · ${rounded(reaction)}ms` : !changed ? "提前开火" : tapped ? "没有击中入侵者" : "入侵者突破防线");
        round += 1;
        if (round < counts.length) schedule(beginRound, 950);
        else schedule(() => {
          const avg = average(results.attention.times);
          const hitScore = ATTENTION_HIT_SCORES[results.attention.times.length] || 0;
          const speedScore = results.attention.times.length ? scoreByAnchors(avg, SCORE_ANCHORS.attentionSpeed) : 0;
          const preview = hitScore * .55 + speedScore * .45;
          showLevelResult({ stamp: results.attention.times.length ? `${rounded(avg)}ms` : "MISS", meta: `定位并击中入侵者 · 命中 ${results.attention.times.length} / ${counts.length}`, color: preview >= 75 ? "var(--green)" : preview >= 60 ? "var(--yellow)" : "var(--orange)" });
        }, 1000);
      }
    };
    beginRound();
  }

  function runPressure() {
    clearActivity();
    const targetMs = 6660, hideAtMs = 4000, limitMs = 10000;
    let startAt = performance.now() + 1000;
    let started = false, completed = false;
    playShell('<span class="scene-a11y" data-stopwatch-number>0.00</span>', {
      round: 1, total: 1, status: "ARMING", sceneTag: "06 / CORE DISARM", sceneTitle: "在 6.66 秒拆除核心",
      note: "装置数码屏将在 4 秒熄灭，之后凭时间感拆弹", actionHint: "点击拆弹开关 · 只有一次机会", actionDetail: "目标 6.66 秒 / 屏幕熄灭后继续心算", sceneState: { startAt, resolved: false },
    });
    startAt = performance.now() + 1000;
    setChallenge({ startAt });
    animate((now) => {
      if (completed) return false;
      if (now < startAt) return true;
      started = true;
      const elapsed = Math.min(now - startAt, limitMs);
      const number = app.querySelector("[data-stopwatch-number]");
      number.textContent = elapsed >= hideAtMs ? "计时已隐藏" : (elapsed / 1000).toFixed(2);
      number.setAttribute("aria-hidden", String(elapsed >= hideAtMs));
      setStageStatus(elapsed >= hideAtMs ? "TRUST YOURSELF" : "CHARGING");
      if (elapsed >= limitMs) { resolve(limitMs, true); return false; }
    });
    bindPointer("[data-play-area]", () => { if (started && !completed) resolve(Math.min(performance.now() - startAt, limitMs), false); });
    function resolve(stoppedAt, missed) {
      if (completed) return;
      completed = true;
      const error = Math.abs(stoppedAt - targetMs);
      results.pressure.errors.push(error); results.pressure.stoppedAt = stoppedAt;
      if (missed) { results.pressure.misses += 1; results.pressure.timedOut = true; }
      const outcome = !missed && error <= 200 ? "success" : "miss";
      const now = performance.now();
      setChallenge({ resolved: true, resolvedAt: now, frozenElapsed: stoppedAt, outcome, disarmPressed: !missed, impactKind: "disarm" }, now);
      actionFeedback(missed ? ["fail"] : ["switch", outcome === "success" ? "disarm" : "fail"], { gesture: !missed, power: outcome === "success" ? .8 : .6, outcome });
      setStageStatus(outcome === "success" ? "DISARMED" : "FAIL");
      const number = app.querySelector("[data-stopwatch-number]");
      number.textContent = (stoppedAt / 1000).toFixed(2); number.setAttribute("aria-hidden", "false");
      showMetricResult(`${(stoppedAt / 1000).toFixed(2)} 秒 · ${missed ? "超时" : stoppedAt < targetMs ? "提前" : "晚了"} ${(error / 1000).toFixed(2)}s`);
      schedule(() => showLevelResult({ stamp: `${(stoppedAt / 1000).toFixed(2)}s`, meta: missed ? "10 秒仍未拆弹 · 本关失败" : `核心拆除时机 · 目标 6.66 秒 · 误差 ${(error / 1000).toFixed(2)} 秒`, color: error <= 80 ? "var(--green)" : error <= 200 ? "var(--yellow)" : "var(--orange)" }), 1200);
    }
  }

  function scoreByAnchors(value, anchors) {
    if (!Number.isFinite(value) || !anchors.length) return 0;
    if (value <= anchors[0][0]) return anchors[0][1];
    for (let index = 1; index < anchors.length; index += 1) {
      const previous = anchors[index - 1];
      const current = anchors[index];
      if (value <= current[0]) {
        const progress = (value - previous[0]) / (current[0] - previous[0]);
        return clamp(previous[1] + (current[1] - previous[1]) * progress, 0, 100);
      }
    }
    return anchors[anchors.length - 1][1];
  }

  function calculateScores() {
    const reactionAvg = average(results.reaction.times);
    const decisionAvg = average(results.decision.times);
    const decisionCorrect = results.decision.times.length + results.decision.correctRed;
    const timingAvg = average(results.timing.errors);
    const predictionAvg = average(results.prediction.errors);
    const attentionAvg = average(results.attention.times);
    const pressureAvg = average(results.pressure.errors);

    const reactionBaseLevel = results.reaction.timedOut ? 0 : scoreByAnchors(reactionAvg, SCORE_ANCHORS.reaction);
    const reactionLevel = clamp(reactionBaseLevel - results.reaction.falseStarts * 10, 0, 100);
    const decisionAccuracyLevel = DECISION_ACCURACY_SCORES[decisionCorrect] || 0;
    const decisionSpeedLevel = results.decision.times.length ? scoreByAnchors(decisionAvg, SCORE_ANCHORS.decisionSpeed) : 0;
    const decisionLevel = results.decision.timedOut ? 0 : decisionAccuracyLevel * .65 + decisionSpeedLevel * .35;
    const timingLevel = results.timing.timedOut ? 0 : scoreByAnchors(timingAvg, SCORE_ANCHORS.timing);
    const predictionLevel = results.prediction.timedOut ? 0 : scoreByAnchors(predictionAvg, SCORE_ANCHORS.prediction);
    const attentionHitLevel = ATTENTION_HIT_SCORES[results.attention.times.length] || 0;
    const attentionSpeedLevel = results.attention.times.length ? scoreByAnchors(attentionAvg, SCORE_ANCHORS.attentionSpeed) : 0;
    const attentionLevel = results.attention.timedOut ? 0 : attentionHitLevel * .55 + attentionSpeedLevel * .45;
    const pressureLevel = results.pressure.timedOut
      ? 0
      : results.pressure.errors.length ? scoreByAnchors(pressureAvg, SCORE_ANCHORS.pressure) : 0;

    const scores = {
      reaction: rounded(reactionLevel),
      decision: rounded(decisionLevel * .65 + pressureLevel * .35),
      timing: rounded(timingLevel),
      prediction: rounded(predictionLevel),
      attention: rounded(attentionLevel),
    };
    scores.career = rounded(
      scores.reaction * .25 +
      scores.decision * .20 +
      scores.timing * .20 +
      scores.prediction * .15 +
      scores.attention * .20,
    );
    return scores;
  }

  function getRank(score) {
    if (score >= 95) return ["你是不是职业选手？", "这个测试本来不是给你玩的。"];
    if (score >= 85) return ["半只脚进职业", "反应已经不像普通玩家。"];
    if (score >= 75) return ["青训候选人", "教练开始看你的数据了。"];
    if (score >= 60) return ["排位高手", "已经开始有点东西了。"];
    if (score >= 40) return ["网吧战神", "打朋友还是够用的。"];
    return ["建议当观众", "职业选手也需要观众。"];
  }

  function getVerdict(scores) {
    const dimensions = [
      ["reaction", "反应"],
      ["decision", "判断"],
      ["timing", "时机"],
      ["prediction", "预判"],
      ["attention", "专注"],
    ];
    const best = dimensions.reduce((a, b) => (scores[a[0]] >= scores[b[0]] ? a : b));
    const worst = dimensions.reduce((a, b) => (scores[a[0]] <= scores[b[0]] ? a : b));
    if (scores.career >= 85) return "教练，这个人建议查一下段位。";
    const bestLines = {
      reaction: "手已经到了，脑子还在路上。",
      decision: "该出手时出手，不该点时真忍得住。",
      timing: "你的技能窗口，卡得比闹钟还准。",
      prediction: "目标看不见了，你心里还有轨迹。",
      attention: "团战再乱，也不容易漏掉关键变化。",
    };
    const worstLines = {
      reaction: "思路到位了，手还需要热身。",
      decision: "手速没有问题，主要是太喜欢交技能。",
      timing: "大招都放了，差一点才是最气的。",
      prediction: "看见了能反应，看不见就开始随缘。",
      attention: "盯一个人可以，团战可能有点忙。",
    };
    return `${bestLines[best[0]]} ${worstLines[worst[0]]}`;
  }

  function radarPoint(index, scale, radius = 72) {
    const angle = -Math.PI / 2 + index * ((Math.PI * 2) / 5);
    return {
      x: 140 + Math.cos(angle) * radius * scale,
      y: 116 + Math.sin(angle) * radius * scale,
    };
  }

  function radarPoints(values, radius = 72) {
    return values
      .map((value, index) => {
        const point = radarPoint(index, clamp(value / 100, 0, 1), radius);
        return `${point.x.toFixed(1)},${point.y.toFixed(1)}`;
      })
      .join(" ");
  }

  function buildRadarChart(scores) {
    const dimensions = [
      ["反应", scores.reaction],
      ["判断", scores.decision],
      ["时机", scores.timing],
      ["预判", scores.prediction],
      ["专注", scores.attention],
    ];
    const values = dimensions.map(([, value]) => value);
    const grids = [.25, .5, .75, 1]
      .map((scale) => `<polygon class="radar-grid" points="${radarPoints([scale * 100, scale * 100, scale * 100, scale * 100, scale * 100])}"></polygon>`)
      .join("");
    const axes = dimensions
      .map((_, index) => {
        const point = radarPoint(index, 1);
        return `<line class="radar-axis" x1="140" y1="116" x2="${point.x.toFixed(1)}" y2="${point.y.toFixed(1)}"></line>`;
      })
      .join("");
    const dots = values
      .map((value, index) => {
        const point = radarPoint(index, value / 100);
        return `<circle class="radar-dot" cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="4"></circle>`;
      })
      .join("");
    const labels = dimensions
      .map(([name, value], index) => {
        const point = radarPoint(index, 1, 103);
        const anchor = point.x < 135 ? "start" : point.x > 145 ? "end" : "middle";
        return `<text class="radar-label" x="${point.x.toFixed(1)}" y="${point.y.toFixed(1)}" text-anchor="${anchor}" dominant-baseline="middle">${name} ${value}</text>`;
      })
      .join("");
    const ariaLabel = dimensions.map(([name, value]) => `${name} ${value} 分`).join("，");

    return `<div class="radar-stage">
      <svg class="radar-chart" viewBox="0 0 280 232" role="img" aria-label="五维能力雷达图：${ariaLabel}">
        <title>五维能力雷达图</title>
        ${grids}${axes}
        <polygon class="radar-data" points="${radarPoints(values)}"></polygon>
        ${dots}${labels}
      </svg>
    </div>`;
  }

  function drawWrappedText(context, text, x, y, maxWidth, lineHeight, maxLines = 3) {
    const lines = [];
    let line = "";
    Array.from(text).forEach((character) => {
      const nextLine = line + character;
      if (line && context.measureText(nextLine).width > maxWidth) {
        lines.push(line);
        line = character;
      } else {
        line = nextLine;
      }
    });
    if (line) lines.push(line);
    lines.slice(0, maxLines).forEach((currentLine, index) => {
      context.fillText(currentLine, x, y + index * lineHeight);
    });
  }

  function renderShareCard({ scores, rank, verdict, fastest, timingAvg, sixError }) {
    const canvas = document.createElement("canvas");
    canvas.width = 1080;
    canvas.height = 1440;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D is unavailable");
    const colors = {
      background: "#050508",
      panel: "#0C0C16",
      ink: "#F4F8FF",
      muted: "#A3A9C3",
      line: "rgba(0, 255, 255, .24)",
      cyan: "#00FFFF",
      magenta: "#FF00FF",
      yellow: "#FFFF00",
      pink: "#FF1493",
      violet: "#7C5CFF",
    };
    const sans = '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';
    const mono = 'Menlo, Consolas, "Courier New", monospace';
    const abilities = [
      ["反应", scores.reaction, colors.cyan],
      ["判断", scores.decision, colors.magenta],
      ["时机", scores.timing, colors.yellow],
      ["预判", scores.prediction, colors.violet],
      ["专注", scores.attention, colors.pink],
    ];

    function polygon(points, fill, stroke = colors.line, glow = 0) {
      context.save();
      context.shadowColor = stroke;
      context.shadowBlur = glow;
      context.beginPath();
      points.forEach(([x, y], index) => {
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      });
      context.closePath();
      context.fillStyle = fill;
      context.fill();
      context.strokeStyle = stroke;
      context.lineWidth = 2;
      context.stroke();
      context.restore();
    }

    function fitLine(text, x, y, maxWidth, size, weight = 600, family = sans) {
      let fittedSize = size;
      context.font = `${weight} ${fittedSize}px ${family}`;
      while (context.measureText(text).width > maxWidth && fittedSize > 14) {
        fittedSize -= 1;
        context.font = `${weight} ${fittedSize}px ${family}`;
      }
      context.fillText(text, x, y);
    }

    function fitParagraph(text, x, y, maxWidth, maxHeight) {
      let fontSize = 29;
      let lines;
      let lineHeight;
      do {
        context.font = `500 ${fontSize}px ${sans}`;
        lineHeight = Math.ceil(fontSize * 1.45);
        lines = [];
        let line = "";
        Array.from(text).forEach((character) => {
          if (character === "\n") {
            lines.push(line);
            line = "";
          } else if (line && context.measureText(line + character).width > maxWidth) {
            lines.push(line);
            line = character;
          } else {
            line += character;
          }
        });
        if (line) lines.push(line);
        if (lines.length * lineHeight <= maxHeight) break;
        fontSize -= 1;
      } while (fontSize > 14);
      lines.forEach((line, index) => context.fillText(line, x, y + index * lineHeight));
    }

    const background = context.createLinearGradient(0, 0, 1080, 1440);
    background.addColorStop(0, "#131025");
    background.addColorStop(.44, colors.background);
    background.addColorStop(1, "#100919");
    context.fillStyle = background;
    context.fillRect(0, 0, canvas.width, canvas.height);
    const edgeGlow = context.createRadialGradient(1080, 770, 40, 1080, 770, 640);
    edgeGlow.addColorStop(0, "rgba(255, 0, 255, .1)");
    edgeGlow.addColorStop(1, "rgba(255, 0, 255, 0)");
    context.fillStyle = edgeGlow;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "rgba(190, 195, 255, .025)";
    for (let y = 56; y < 1390; y += 7) context.fillRect(50, y, 980, 1);
    context.strokeStyle = colors.line;
    context.lineWidth = 2;
    context.strokeRect(48, 48, 984, 1344);
    context.fillStyle = colors.cyan;
    context.fillRect(48, 48, 182, 5);
    context.fillRect(48, 48, 5, 77);
    context.fillStyle = colors.magenta;
    context.fillRect(846, 1387, 186, 5);
    context.fillRect(1027, 1315, 5, 77);
    polygon([[858, 48], [889, 48], [874, 66], [843, 66]], colors.yellow, colors.yellow);
    polygon([[900, 48], [931, 48], [916, 66], [885, 66]], colors.yellow, colors.yellow);

    context.textAlign = "left";
    context.fillStyle = colors.magenta;
    context.font = `italic 900 32px ${sans}`;
    context.fillText("能打职业吗你？", 99, 118);
    context.fillStyle = colors.ink;
    context.fillText("能打职业吗你？", 96, 116);
    context.textAlign = "right";
    context.fillStyle = colors.cyan;
    context.font = `700 20px ${mono}`;
    context.fillText("PRO TEST / NEON ARENA", 984, 113);
    context.strokeStyle = colors.line;
    context.beginPath();
    context.moveTo(96, 151);
    context.lineTo(984, 151);
    context.stroke();

    // The share image stays local: projected geometry is drawn directly on Canvas.
    const glow = context.createRadialGradient(802, 341, 12, 802, 341, 226);
    glow.addColorStop(0, "rgba(255, 0, 255, .28)");
    glow.addColorStop(.58, "rgba(0, 255, 255, .07)");
    glow.addColorStop(1, "rgba(0, 255, 255, 0)");
    context.fillStyle = glow;
    context.fillRect(586, 163, 410, 405);
    context.strokeStyle = "rgba(0, 255, 255, .17)";
    context.lineWidth = 1;
    for (let index = 0; index <= 6; index += 1) {
      context.beginPath();
      context.moveTo(795, 310);
      context.lineTo(610 + index * 64, 560);
      context.stroke();
    }
    [409, 438, 476, 521, 560].forEach((y) => {
      context.beginPath();
      context.moveTo(616, y);
      context.lineTo(984, y);
      context.stroke();
    });
    context.fillStyle = "rgba(0, 0, 0, .36)";
    context.beginPath();
    context.ellipse(796, 505, 162, 42, 0, 0, Math.PI * 2);
    context.fill();
    polygon([[644, 447], [802, 514], [802, 536], [644, 469]], "#063C49", colors.cyan, 12);
    polygon([[802, 514], [948, 445], [948, 467], [802, 536]], "#3A073D", colors.magenta, 12);
    polygon([[644, 447], [788, 383], [948, 445], [802, 514]], "#15112A", "#7751BE");
    polygon([[677, 446], [790, 397], [914, 445], [801, 497]], "#0B101D", colors.cyan, 10);
    context.save();
    context.shadowColor = colors.cyan;
    context.shadowBlur = 18;
    context.strokeStyle = colors.cyan;
    context.lineWidth = 4;
    context.beginPath();
    context.moveTo(644, 447);
    context.lineTo(802, 514);
    context.stroke();
    context.shadowColor = colors.magenta;
    context.strokeStyle = colors.magenta;
    context.beginPath();
    context.moveTo(802, 514);
    context.lineTo(948, 445);
    context.stroke();
    context.restore();
    context.fillStyle = "rgba(0, 0, 0, .34)";
    context.beginPath();
    context.ellipse(802, 438, 71, 19, 0, 0, Math.PI * 2);
    context.fill();
    const coreFace = context.createLinearGradient(738, 265, 807, 381);
    coreFace.addColorStop(0, "#04E4ED");
    coreFace.addColorStop(1, "#08537D");
    polygon([[738, 268], [805, 299], [805, 381], [738, 349]], coreFace, colors.cyan, 24);
    const coreSide = context.createLinearGradient(805, 299, 866, 350);
    coreSide.addColorStop(0, "#B31ED4");
    coreSide.addColorStop(1, "#3D096B");
    polygon([[805, 299], [866, 268], [866, 350], [805, 381]], coreSide, colors.magenta, 24);
    polygon([[738, 268], [799, 240], [866, 268], [805, 299]], "#E9FF2F", colors.yellow, 20);
    context.strokeStyle = "#CAFFFF";
    context.lineWidth = 3;
    context.beginPath();
    context.moveTo(758, 299);
    context.lineTo(785, 312);
    context.lineTo(785, 345);
    context.stroke();
    const satellite = context.createRadialGradient(910, 212, 1, 919, 221, 21);
    satellite.addColorStop(0, "#FFE2FA");
    satellite.addColorStop(.5, colors.pink);
    satellite.addColorStop(1, "#780F78");
    context.save();
    context.shadowColor = colors.pink;
    context.shadowBlur = 23;
    context.fillStyle = satellite;
    context.beginPath();
    context.arc(919, 221, 20, 0, Math.PI * 2);
    context.fill();
    context.restore();
    context.strokeStyle = colors.yellow;
    context.lineWidth = 2;
    context.beginPath();
    context.ellipse(802, 339, 137, 43, -.35, Math.PI * .9, Math.PI * 1.92);
    context.stroke();
    context.fillStyle = colors.cyan;
    context.textAlign = "center";
    context.font = `500 17px ${mono}`;
    context.fillText("POTENTIAL CORE / 06", 802, 577);

    context.textAlign = "left";
    context.fillStyle = colors.yellow;
    context.font = `800 26px ${sans}`;
    context.fillText("职业指数", 96, 223);
    context.font = `italic 900 184px ${mono}`;
    context.fillStyle = colors.magenta;
    context.fillText(String(scores.career), 90, 410);
    context.fillStyle = colors.cyan;
    context.fillText(String(scores.career), 81, 402);
    context.fillStyle = colors.ink;
    context.fillText(String(scores.career), 84, 405);
    context.fillStyle = colors.muted;
    context.font = `400 27px ${mono}`;
    context.fillText("/ 100", 439, 402);
    context.fillStyle = colors.ink;
    fitLine(rank, 96, 491, 510, 48, "italic 900");
    context.fillStyle = colors.muted;
    context.font = `400 25px ${sans}`;
    context.fillText("我的电竞天赋报告", 96, 542);
    context.fillStyle = colors.magenta;
    context.fillRect(96, 576, 130, 4);
    context.fillStyle = colors.cyan;
    context.fillRect(236, 576, 34, 4);

    context.fillStyle = colors.ink;
    context.font = `900 25px ${sans}`;
    context.fillText("五维能力", 96, 628);
    context.textAlign = "right";
    context.fillStyle = colors.muted;
    context.font = `500 18px ${mono}`;
    context.fillText("ABILITY PROFILE / 100", 984, 626);
    abilities.forEach(([name, score, color], index) => {
      const y = 690 + index * 70;
      context.textAlign = "left";
      context.fillStyle = colors.ink;
      context.font = `500 28px ${sans}`;
      context.fillText(name, 96, y);
      context.fillStyle = "#1D1B33";
      context.fillRect(240, y - 18, 640, 13);
      context.save();
      context.shadowColor = color;
      context.shadowBlur = 11;
      context.fillStyle = color;
      context.fillRect(240, y - 18, 640 * clamp(score / 100, 0, 1), 13);
      context.restore();
      context.fillStyle = colors.background;
      for (let segment = 1; segment < 20; segment += 1) {
        context.fillRect(240 + segment * 32, y - 18, 3, 13);
      }
      context.textAlign = "right";
      context.font = `italic 900 30px ${mono}`;
      context.fillStyle = color;
      context.fillText(String(score), 984, y + 1);
    });

    context.fillStyle = colors.panel;
    context.fillRect(96, 1021, 888, 151);
    context.strokeStyle = colors.line;
    context.lineWidth = 2;
    context.strokeRect(96, 1021, 888, 151);
    context.fillStyle = colors.magenta;
    context.fillRect(96, 1021, 3, 151);
    context.textAlign = "left";
    context.fillStyle = colors.cyan;
    context.font = `500 18px ${mono}`;
    context.fillText("训练场观察 / FIELD NOTES", 122, 1055);
    context.fillStyle = colors.ink;
    fitParagraph(verdict, 122, 1100, 836, 83);

    const metrics = [
      ["最快反应", `${fastest}ms`],
      ["时机误差", `${timingAvg}ms`],
      ["6.66误差", `${sixError}s`],
    ];
    metrics.forEach(([label, value], index) => {
      const x = 96 + index * 304;
      const metricColor = [colors.cyan, colors.magenta, colors.yellow][index];
      context.strokeStyle = colors.line;
      context.lineWidth = 2;
      context.strokeRect(x, 1200, 280, 105);
      context.fillStyle = metricColor;
      context.fillRect(x, 1200, 56, 3);
      context.textAlign = "left";
      context.fillStyle = colors.muted;
      context.font = `400 22px ${sans}`;
      context.fillText(label, x + 20, 1237);
      context.fillStyle = metricColor;
      fitLine(value, x + 20, 1280, 240, 30, "italic 900", mono);
    });

    context.textAlign = "left";
    context.fillStyle = colors.ink;
    context.font = `500 23px ${sans}`;
    context.fillText("你能打职业吗？来测测。", 96, 1353);
    context.textAlign = "right";
    context.fillStyle = colors.muted;
    context.font = `400 19px ${sans}`;
    context.fillText("娱乐测试 · 非职业电竞选拔依据", 984, 1353);
    return canvas.toDataURL("image/png");
  }

  function buildShareNote(scores, rank, verdict, metrics) {
    return {
      title: `我的职业指数是 ${scores.career} 分`,
      content: [
        "刚测完「能打职业吗你？」",
        "",
        `职业指数：${scores.career}/100 · ${rank}`,
        `反应 ${scores.reaction}｜判断 ${scores.decision}｜时机 ${scores.timing}｜预判 ${scores.prediction}｜专注 ${scores.attention}`,
        `最快反应 ${metrics.fastest}ms｜时机误差 ${metrics.timingAvg}ms｜6.66 秒误差 ${metrics.sixError}s`,
        "",
        verdict,
        "",
        "#电竞天赋 #反应力测试 #能打职业吗你",
      ].join("\n"),
    };
  }

  function setShareFeedback(button, message, state = "") {
    const status = app.querySelector("[data-share-status]");
    if (status) {
      status.textContent = message;
      status.dataset.state = state;
    }
    if (button) {
      button.disabled = false;
      button.classList.remove("is-pressed");
      button.textContent = state === "success" && button.dataset.successLabel
        ? button.dataset.successLabel
        : button.dataset.defaultLabel || button.textContent;
    }
    screenLocked = false;
  }

  function dataUrlToFile(dataUrl) {
    const [header, encoded] = dataUrl.split(",");
    const mimeType = (header.match(/data:([^;]+)/) || [])[1] || "image/png";
    const binary = window.atob(encoded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return new File([bytes], `能打职业吗你-${Date.now()}.png`, { type: mimeType });
  }

  async function saveShareCard(payload, button) {
    const miniTool = window.xhs && window.xhs.miniTool;
    if (!miniTool || typeof miniTool.saveImageToPhotosAlbum !== "function") {
      setShareFeedback(button, "请在小红书小工具中打开后再保存", "error");
      return;
    }

    button.disabled = true;
    button.textContent = "正在生成成绩卡…";
    const status = app.querySelector("[data-share-status]");
    if (status) {
      status.textContent = "正在保存到系统相册";
      status.dataset.state = "loading";
    }

    try {
      const image = renderShareCard(payload);
      let filePath = image;
      if (typeof miniTool.writeTempFile === "function") {
        const tempFile = await miniTool.writeTempFile({ data: image });
        if (!tempFile || typeof tempFile.filePath !== "string" || !tempFile.filePath) {
          throw new Error("writeTempFile did not return filePath");
        }
        filePath = tempFile.filePath;
      }
      await miniTool.saveImageToPhotosAlbum({ filePath });
      setShareFeedback(button, "成绩卡已保存到相册", "success");
    } catch (error) {
      console.warn("save card failed", error);
      setShareFeedback(button, "保存失败，请检查相册权限后重试", "error");
    }
  }

  async function shareToXiaohongshu(payload, button) {
    const miniTool = window.xhs && window.xhs.miniTool;
    if (!miniTool || typeof miniTool.postNote !== "function") {
      setShareFeedback(button, "请在小红书小工具中打开后再分享", "error");
      return;
    }

    button.disabled = true;
    button.textContent = "正在生成成绩卡…";
    const status = app.querySelector("[data-share-status]");
    if (status) {
      status.textContent = "正在准备笔记内容";
      status.dataset.state = "loading";
    }

    try {
      const image = renderShareCard(payload);
      let filePath = image;
      if (typeof miniTool.writeTempFile === "function") {
        const tempFile = await miniTool.writeTempFile({ data: image });
        if (!tempFile || typeof tempFile.filePath !== "string" || !tempFile.filePath) {
          throw new Error("writeTempFile did not return filePath");
        }
        filePath = tempFile.filePath;
      }
      const note = buildShareNote(payload.scores, payload.rank, payload.verdict, payload);
      button.textContent = "正在打开发布页…";
      await miniTool.postNote({
        title: note.title,
        content: note.content,
        pageType: "photo_publish",
        mediaInfo: {
          image_resources: [{ url: filePath }],
        },
      });
      setShareFeedback(button, "已创建笔记，可在发布页继续编辑", "success");
    } catch (error) {
      console.warn("postNote failed", error);
      setShareFeedback(button, "创建笔记失败，请稍后再试", "error");
    }
  }

  async function shareResult(payload, button) {
    const miniTool = window.xhs && window.xhs.miniTool;
    if (miniTool && typeof miniTool.postNote === "function") {
      await shareToXiaohongshu(payload, button);
      return;
    }

    if (typeof navigator.share !== "function") {
      setShareFeedback(button, "请在小红书小工具中打开后分享或保存", "error");
      return;
    }

    button.disabled = true;
    button.textContent = "正在准备分享…";
    const status = app.querySelector("[data-share-status]");
    if (status) {
      status.textContent = "正在生成成绩卡";
      status.dataset.state = "loading";
    }

    try {
      const note = buildShareNote(payload.scores, payload.rank, payload.verdict, payload);
      const imageFile = dataUrlToFile(renderShareCard(payload));
      const shareData = { title: note.title, text: note.content };
      if (typeof navigator.canShare === "function" && navigator.canShare({ files: [imageFile] })) {
        shareData.files = [imageFile];
      }
      await navigator.share(shareData);
      setShareFeedback(button, "系统分享已打开", "success");
    } catch (error) {
      if (error && error.name === "AbortError") {
        setShareFeedback(button, "已取消分享");
        return;
      }
      console.warn("native share failed", error);
      setShareFeedback(button, "系统分享不可用，请在小红书中重试", "error");
    }
  }

  function showFinalResult() {
    clearActivity();
    inFinalResult = true;
    currentScreen = "final";
    const scores = calculateScores();
    const [rank, rankDesc] = getRank(scores.career);
    const radarChart = buildRadarChart(scores);
    const fastest = results.reaction.times.length ? rounded(Math.min(...results.reaction.times)) : "--";
    const timingAvg = rounded(average(results.timing.errors));
    const sixError = results.pressure.errors.length ? (average(results.pressure.errors) / 1000).toFixed(2) : "--";
    const verdict = getVerdict(scores);
    const sharePayload = { scores, rank, verdict, fastest, timingAvg, sixError };
    const primaryShareLabel = "分享成绩";
    const primarySuccessLabel = "再次分享";

    shell(
      `<article class="final-card">
        <div class="final-brand"><span>能打职业吗你？</span><span>PRO TEST GAME</span></div>
        <div class="final-dashboard">
          <div class="final-summary">
            <div class="score-block">
              <div class="score-label">职业指数</div>
              <div class="score-number">${scores.career}</div>
            </div>
            <h2 class="rank-title">${rank}</h2>
            <p class="rank-desc">${rankDesc}</p>
          </div>
          ${radarChart}
        </div>
        <p class="verdict">${verdict}</p>
        <div class="key-data">
          <span>最快反应<br>${fastest}ms</span>
          <span>时机误差<br>${timingAvg}ms</span>
          <span>6.66误差<br>${sixError}s</span>
        </div>
        <div class="final-actions">
          <button class="brutal-btn share-btn" type="button" data-action="share" data-default-label="${primaryShareLabel}" data-success-label="${primarySuccessLabel}">${primaryShareLabel}</button>
          <button class="brutal-btn secondary restart-btn" type="button" data-action="restart">再测一次</button>
          <button class="brutal-btn save-btn" type="button" data-action="save" data-default-label="保存成绩卡" data-success-label="再次保存">保存成绩卡</button>
        </div>
        <p class="share-status" data-share-status role="status" aria-live="polite">可分享或保存你的成绩</p>
      </article>`,
      { progress: 100, count: "测试完成", note: "把成绩卡分享给朋友" },
    );
    persistProgress();
    bindClick("[data-action='share']", (event) => {
      if (screenLocked) return;
      screenLocked = true;
      event.currentTarget.classList.add("is-pressed");
      shareResult(sharePayload, event.currentTarget);
    });
    bindClick("[data-action='save']", (event) => {
      if (screenLocked) return;
      screenLocked = true;
      saveShareCard(sharePayload, event.currentTarget);
    });
    bindAction("[data-action='restart']", showHome);
  }

  function pauseForInterruption() {
    if (sound) sound.suspend();
    if (!booted) return;
    if (currentScreen === "play") {
      resetCurrentLevelResult();
      currentScreen = "intro";
      lastLevelResult = null;
      resumeNotice = "刚才的测试被中断，本关已重置；已完成关卡仍然保留。";
    }
    persistProgress();
    clearActivity();
  }

  window.addEventListener("pagehide", pauseForInterruption);
  let interrupted = false;
  document.addEventListener("visibilitychange", () => {
    if (!booted) { if (sound) sound.suspend(); return; }
    if (document.hidden) {
      interrupted = true;
      pauseForInterruption();
    } else if (interrupted) {
      interrupted = false;
      if (inFinalResult) showFinalResult();
      else if (currentScreen === "result" && lastLevelResult) showLevelResult(lastLevelResult);
      else if (currentScreen === "intro") showLevelIntro();
      else showHome();
    }
  });

  function boot() {
    if (booted) return;
    if (sound && typeof sound.restorePreference === "function") sound.restorePreference();
    const restored = restoreProgress();
    booted = true;
    if (restored) {
      if (currentScreen === "final") showFinalResult();
      else if (currentScreen === "result" && lastLevelResult) showLevelResult(lastLevelResult);
      else {
        if (currentScreen === "play") {
          resetCurrentLevelResult();
          resumeNotice = "检测到上次测试中断，本关已重置；已完成关卡仍然保留。";
        } else if (!resumeNotice) {
          resumeNotice = `已恢复到第 ${levelIndex + 1} 关。`;
        }
        currentScreen = "intro";
        showLevelIntro();
      }
    } else showHome();
  }
  if (window.MiniStorage && window.MiniStorage.ready) Promise.resolve(window.MiniStorage.ready).then(boot, boot);
  else boot();
})();
