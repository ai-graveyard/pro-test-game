(() => {
  "use strict";

  const app = document.querySelector("#app");
  const APP_VERSION = "1.2.0";
  const STORAGE_KEY = `pro-test-game-progress-${APP_VERSION}`;
  const TOTAL_LEVELS = 6;
  const ACTION_TIMEOUT_MS = 5000;
  const LEVELS = [
    {
      id: "reaction",
      title: "神经反射",
      goal: "反应",
      color: "var(--green)",
      instruction: "屏幕变绿后立刻点击。绿之前点，算抢跑。",
      rule: "3 次有效测试 · 随机等待 · 绿色出现 5 秒未点击则本关超时",
      run: runReaction,
    },
    {
      id: "timing",
      title: "完美格挡",
      goal: "时机",
      color: "var(--yellow)",
      instruction: "粉色圆点与黄色靶心重合的一瞬间点击。",
      rule: "3 次格挡 · 每次速度不同 · 越接近 0ms 越好",
      run: runTiming,
    },
    {
      id: "decision",
      title: "别急着点",
      goal: "判断",
      color: "var(--orange)",
      instruction: "绿色就点，红色忍住。看到变化不等于该出手。",
      rule: "10 个信号 · 绿点 / 红不点 · 误触扣分",
      run: runDecision,
    },
    {
      id: "prediction",
      title: "预判射击",
      goal: "预判",
      color: "var(--blue)",
      textColor: "var(--white)",
      instruction: "目标进入蓝色遮挡后，预判它到达终点的瞬间点击。",
      rule: "3 次预判 · 进入遮挡前不能点 · 速度随机",
      run: runPrediction,
    },
    {
      id: "attention",
      title: "多目标警戒",
      goal: "专注",
      color: "var(--pink)",
      instruction: "盯住全部目标，任意一个发生变化就点击屏幕。",
      rule: "4 轮警戒 · 目标逐渐增多 · 不必点中目标",
      run: runAttention,
    },
    {
      id: "pressure",
      title: "黄金 6.66",
      goal: "抗压",
      color: "var(--orange)",
      instruction: "计时器启动后，在最接近 6.66 秒的一刻点击停止。",
      rule: "只有 1 次机会 · 4 秒后隐藏计时 · 10 秒未点击则失败",
      run: runPressure,
    },
  ];

  const SCORE_ANCHORS = {
    reaction: [[100, 100], [200, 80], [300, 60], [400, 30], [500, 0]],
    decisionSpeed: [[180, 100], [220, 80], [260, 60], [340, 30], [450, 0]],
    timing: [[20, 100], [45, 80], [80, 60], [140, 30], [220, 0]],
    prediction: [[40, 100], [80, 80], [140, 60], [240, 30], [400, 0]],
    attentionSpeed: [[200, 100], [260, 80], [340, 60], [500, 30], [700, 0]],
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
    cleanupTasks.forEach((cleanup) => cleanup());
    cleanupTasks = [];
    screenLocked = false;
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
      handler(event);
    };
    const keyListener = (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
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
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
        version: APP_VERSION,
        levelIndex,
        levelId: LEVELS[levelIndex] ? LEVELS[levelIndex].id : null,
        currentScreen,
        lastLevelResult,
        resumeNotice,
        results,
      }));
    } catch (error) {
      console.warn("Unable to save test progress", error);
    }
  }

  function clearSavedProgress() {
    try {
      window.sessionStorage.removeItem(STORAGE_KEY);
    } catch (error) {
      console.warn("Unable to clear test progress", error);
    }
  }

  function restoreProgress() {
    try {
      const raw = window.sessionStorage.getItem(STORAGE_KEY);
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
      brand = APP_VERSION,
      stageTitle = "",
      showProgress = true,
    } = options;
    app.innerHTML = `
      <div class="app-shell">
        ${stageTitle ? `<div class="active-level-title" aria-label="当前关卡">${stageTitle}</div>` : ""}
        <header class="topbar">
          <span class="brand-mini">${brand}</span>
          ${showProgress ? `<div class="progress-track" role="progressbar" aria-label="测试进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${rounded(progress)}"><div class="progress-fill" style="--progress:${progress}%"></div></div>` : ""}
          <span class="stage-count">${count}</span>
        </header>
        <section class="screen">${content}</section>
        <footer class="bottom-note">${note}</footer>
      </div>`;
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
        <span class="hero-sticker">90 秒 · 电竞天赋短测</span>
        <h1>能打职业吗<br><span>你？</span></h1>
        <p class="hero-sub">六关挑战，一根手指。看看你离职业到底差多少。</p>
        <div class="facts">
          <span class="fact">6 关测试</span>
          <span class="fact">约 90 秒</span>
          <span class="fact">建议用惯用手</span>
        </div>
        <button class="brutal-btn" type="button" data-action="start">开始测试 →</button>
        <p class="tiny-disclaimer">娱乐测试，不代表真实职业选拔结果。设备刷新率与浏览器性能会影响毫秒数据。</p>
      </article>`,
      { progress: 0, count: "准备开测", note: "建议竖屏 · 关闭省电模式效果更稳", showProgress: false },
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
        <span class="level-no">第 ${levelIndex + 1} / ${TOTAL_LEVELS} 关 · ${level.goal}</span>
        <h2>${level.title}</h2>
        <p class="goal">TEST / ${level.goal.toUpperCase()}</p>
        <p class="instruction">${level.instruction}</p>
        <div class="rule-box">${level.rule}</div>
        ${notice ? `<p class="resume-note" role="status">${notice}</p>` : ""}
        <button class="brutal-btn" type="button" data-action="play">我懂了，开测</button>
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

  function playShell(inner, { round, total, status, className = "", note = "看到目标后，点击测试区域任意位置" }) {
    const level = LEVELS[levelIndex];
    currentScreen = "play";
    shell(
      `<div class="play-area ${className}" data-play-area role="button" tabindex="0" aria-label="${note}">
        <div class="play-head">
          <span class="round-pill">ROUND ${round} / ${total}</span>
          <span class="status-pill" data-status>${status}</span>
        </div>
        ${inner}
      </div>`,
      {
        progress: ((levelIndex + (round - 1) / total) / TOTAL_LEVELS) * 100,
        count: `${levelIndex + 1} / ${TOTAL_LEVELS}`,
        stageTitle: level.title,
        note,
      },
    );
    persistProgress();
    onNextFrame(() => {
      const area = app.querySelector("[data-play-area]");
      if (area) area.focus({ preventScroll: true });
    });
  }

  function showMetricResult(message) {
    const support = app.querySelector(".support-text");
    const overlay = app.querySelector("[data-metric-result]");
    if (support) support.style.visibility = "hidden";
    if (overlay) {
      overlay.textContent = message;
      overlay.classList.add("is-visible");
    }
  }

  function runReaction() {
    clearActivity();
    const total = 3;
    let round = 0;

    const beginRound = () => {
      clearActivity();
      let live = false;
      let cueTime = 0;
      playShell(
        `<div class="center-content">
          <div class="giant-text">等绿色</div>
          <p class="support-text">现在点会抢跑。稳住。</p>
        </div>`,
        { round: round + 1, total, status: "WAIT", className: "reaction-waiting", note: "绿之前别点 · 变绿立刻点" },
      );

      schedule(() => {
        onNextFrame((now) => {
          const area = app.querySelector("[data-play-area]");
          if (!area) return;
          cueTime = now;
          live = true;
          area.classList.remove("reaction-waiting");
          area.classList.add("reaction-live");
          area.querySelector(".giant-text").textContent = "点！";
          area.querySelector(".support-text").textContent = "NOW / NOW / NOW";
          area.querySelector("[data-status]").textContent = "GO";
          schedule(() => timeoutCurrentLevel("绿色出现 5 秒仍未点击"), ACTION_TIMEOUT_MS);
        });
      }, random(900, 1900));

      bindPointer("[data-play-area]", () => {
        if (screenLocked) return;
        const area = app.querySelector("[data-play-area]");
        clearActivity();
        screenLocked = true;
        if (!live) {
          results.reaction.falseStarts += 1;
          area.classList.remove("reaction-waiting");
          area.classList.add("reaction-false");
          area.querySelector(".giant-text").textContent = "抢跑！";
          area.querySelector(".support-text").textContent = "这轮不算，重新来。";
          area.querySelector("[data-status]").textContent = "FALSE";
          schedule(beginRound, 650);
          return;
        }

        const reaction = performance.now() - cueTime;
        results.reaction.times.push(reaction);
        round += 1;
        area.querySelector(".giant-text").textContent = `${rounded(reaction)}ms`;
        area.querySelector(".support-text").textContent = reaction < 230 ? "手比脑子快。" : "收到，下一轮。";
        area.querySelector("[data-status]").textContent = "HIT";
        if (round < total) schedule(beginRound, 600);
        else {
          schedule(() => {
            const avg = average(results.reaction.times);
            const best = Math.min(...results.reaction.times);
            showLevelResult({
              stamp: `${rounded(avg)}ms`,
              meta: `平均反应 · 最快 ${rounded(best)}ms${results.reaction.falseStarts ? ` · 抢跑 ${results.reaction.falseStarts} 次（每次 -10 分）` : ""}`,
              color: avg <= 200 ? "var(--green)" : avg <= 300 ? "var(--yellow)" : "var(--orange)",
            });
          }, 700);
        }
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
    clearActivity();
    const sequence = buildSignalSequence();
    let index = 0;
    let signalStart = 0;
    let resolved = false;
    let started = false;

    const showSignal = () => {
      clearActivity();
      const signal = sequence[index];
      resolved = false;
      started = false;
      playShell(
        `<div class="center-content">
          <div class="signal-card ${signal} is-pending">${signal === "go" ? "点" : "忍"}</div>
          <p class="support-text">${signal === "go" ? "绿色 / 立刻点击" : "红色 / 不要点击"}</p>
        </div>`,
        { round: index + 1, total: sequence.length, status: "READY", note: "绿色点 · 红色忍住" },
      );

      const duration = random(580, 850);
      bindPointer("[data-play-area]", () => resolveSignal(true));
      onNextFrame((now) => {
        const card = app.querySelector(".signal-card");
        const status = app.querySelector("[data-status]");
        if (!card || resolved) return;
        signalStart = now;
        started = true;
        card.classList.remove("is-pending");
        if (status) status.textContent = signal === "go" ? "GO" : "STOP";
        schedule(() => resolveSignal(false), duration);
      });

      function resolveSignal(tapped) {
        if (resolved || !started) return;
        resolved = true;
        const elapsed = performance.now() - signalStart;
        const card = app.querySelector(".signal-card");
        if (signal === "go" && tapped) {
          results.decision.times.push(elapsed);
          card.textContent = `${rounded(elapsed)}`;
        } else if (signal === "go" && !tapped) {
          results.decision.misses += 1;
          card.textContent = "慢";
        } else if (signal === "stop" && tapped) {
          results.decision.falseTaps += 1;
          card.textContent = "急";
        } else {
          results.decision.correctRed += 1;
          card.textContent = "稳";
        }
        index += 1;
        if (index < sequence.length) schedule(showSignal, 210);
        else schedule(finish, 500);
      }
    };

    const finish = () => {
      const correct = results.decision.times.length + results.decision.correctRed;
      const accuracy = (correct / sequence.length) * 100;
      const avg = average(results.decision.times);
      const avgLabel = results.decision.times.length ? `${rounded(avg)}ms` : "未命中";
      const accuracyScore = DECISION_ACCURACY_SCORES[correct] || 0;
      const speedScore = results.decision.times.length ? scoreByAnchors(avg, SCORE_ANCHORS.decisionSpeed) : 0;
      const previewScore = accuracyScore * .65 + speedScore * .35;
      showLevelResult({
        stamp: `${rounded(accuracy)}%`,
        meta: `判断正确率 · 绿色平均 ${avgLabel} · 误触 ${results.decision.falseTaps}`,
        color: previewScore >= 75 ? "var(--green)" : previewScore >= 60 ? "var(--yellow)" : "var(--orange)",
      });
    };

    showSignal();
  }

  function runTiming() {
    clearActivity();
    const total = 3;
    let round = 0;

    const beginRound = () => {
      clearActivity();
      const duration = random(1250, 1750);
      const startTime = performance.now() + random(250, 550);
      const idealElapsed = duration * ((76 - 10) / (94 - 10));
      let completed = false;
      playShell(
        `<div class="center-content">
          <div class="metric-result-overlay" data-metric-result role="status" aria-live="polite"></div>
          <p class="support-text">圆点与靶心重合时点击</p>
          <div class="track-zone">
            <div class="track-line"></div>
            <div class="target-ring"></div>
            <div class="moving-dot" data-moving-dot></div>
          </div>
        </div>`,
        { round: round + 1, total, status: "READY", note: "重合的一瞬间点击" },
      );

      animate((now) => {
        if (completed || now < startTime) return !completed;
        const elapsed = now - startTime;
        const progress = clamp(elapsed / duration, 0, 1);
        const left = 10 + progress * 84;
        const dot = app.querySelector("[data-moving-dot]");
        if (dot) dot.style.left = `${left}%`;
        const status = app.querySelector("[data-status]");
        if (status) status.textContent = "BLOCK";
        if (progress >= 1) resolve(duration - idealElapsed + 350);
        return progress < 1;
      });

      bindPointer("[data-play-area]", () => {
        if (completed) return;
        const error = performance.now() - startTime - idealElapsed;
        resolve(error);
      });

      function resolve(error) {
        if (completed) return;
        completed = true;
        const absError = Math.abs(error);
        results.timing.errors.push(absError);
        if (absError <= 20) results.timing.perfect += 1;
        round += 1;
        const status = absError <= 20 ? "PERFECT" : absError <= 45 ? "GREAT" : absError <= 80 ? "GOOD" : "MISS";
        const statusEl = app.querySelector("[data-status]");
        if (statusEl) statusEl.textContent = status;
        showMetricResult(`${error < 0 ? "早" : "晚"}了 ${rounded(absError)}ms`);
        if (round < total) schedule(beginRound, 650);
        else schedule(finish, 700);
      }
    };

    const finish = () => {
      const avg = average(results.timing.errors);
      showLevelResult({
        stamp: `±${rounded(avg)}ms`,
        meta: `平均时机误差 · PERFECT ${results.timing.perfect} / ${total}`,
        color: avg <= 45 ? "var(--green)" : avg <= 80 ? "var(--yellow)" : "var(--orange)",
      });
    };

    beginRound();
  }

  function runPrediction() {
    clearActivity();
    const total = 3;
    let round = 0;

    const beginRound = () => {
      clearActivity();
      const duration = random(1750, 2350);
      const startTime = performance.now() + random(280, 560);
      const hideElapsed = duration * ((50 - 5) / (90 - 5));
      let completed = false;
      let hidden = false;
      playShell(
        `<div class="center-content">
          <p class="support-text">进入蓝区后，猜它何时到终点</p>
          <div class="track-zone prediction-zone" data-prediction-track>
            <div class="track-line"></div>
            <div class="target-ring"></div>
            <div class="moving-dot" data-moving-dot></div>
            <div class="cover-zone" data-cover-zone>NO VISION</div>
            <div class="prediction-position-label" data-position-label>点击时位置</div>
          </div>
        </div>`,
        { round: round + 1, total, status: "WATCH", note: "目标消失后，预判到达时间" },
      );

      animate((now) => {
        if (completed || now < startTime) return !completed;
        const elapsed = now - startTime;
        const progress = clamp(elapsed / duration, 0, 1);
        const left = 5 + progress * 85;
        const dot = app.querySelector("[data-moving-dot]");
        if (dot) {
          dot.style.left = `${left}%`;
          if (elapsed >= hideElapsed) {
            hidden = true;
            dot.style.visibility = "hidden";
          }
        }
        const status = app.querySelector("[data-status]");
        if (status) status.textContent = hidden ? "PREDICT" : "WATCH";
        if (elapsed > duration + 650) resolve(650, true, false, duration + 650);
        return elapsed <= duration + 650;
      });

      bindPointer("[data-play-area]", () => {
        if (completed) return;
        const elapsed = performance.now() - startTime;
        if (elapsed < hideElapsed) {
          resolve(elapsed - duration, false, true, elapsed);
          return;
        }
        resolve(elapsed - duration, false, false, elapsed);
      });

      function resolve(error, missed = false, early = false, actualElapsed = duration + error) {
        if (completed) return;
        completed = true;
        if (missed) results.prediction.misses += 1;
        results.prediction.errors.push(early ? 800 : Math.abs(error));
        revealFinalPosition(actualElapsed);
        round += 1;
        const status = app.querySelector("[data-status]");
        const absError = Math.abs(error);
        if (status) status.textContent = early ? "TOO EARLY" : missed ? "MISS" : absError <= 40 ? "PERFECT" : absError <= 80 ? "GREAT" : absError <= 140 ? "GOOD" : "MISS";
        const support = app.querySelector(".support-text");
        if (support) support.textContent = early ? "目标还没消失，不能开枪" : missed ? "晚了，目标已经到达" : `${error < 0 ? "提前" : "晚了"} ${rounded(Math.abs(error))}ms`;
        if (round < total) schedule(beginRound, 700);
        else schedule(finish, 700);
      }

      function revealFinalPosition(actualElapsed) {
        const track = app.querySelector("[data-prediction-track]");
        const cover = app.querySelector("[data-cover-zone]");
        const dot = app.querySelector("[data-moving-dot]");
        const label = app.querySelector("[data-position-label]");
        const beforeTarget = actualElapsed <= duration;
        const finalLeft = beforeTarget
          ? 5 + clamp(actualElapsed / duration, 0, 1) * 85
          : 90 + clamp((actualElapsed - duration) / 650, 0, 1) * 6;

        if (track) track.classList.add("is-revealed");
        if (cover) {
          cover.classList.add("is-revealed");
          cover.textContent = "轨迹已揭示";
        }
        if (dot) {
          dot.style.left = `${finalLeft}%`;
          dot.style.visibility = "visible";
          dot.classList.add("prediction-final-dot");
        }
        if (label) {
          label.style.left = `${clamp(finalLeft, 18, 82)}%`;
          label.textContent = beforeTarget ? "点击时位置" : "点击时已过终点";
          label.classList.add("is-visible");
        }
      }
    };

    const finish = () => {
      const avg = average(results.prediction.errors);
      const best = Math.min(...results.prediction.errors);
      showLevelResult({
        stamp: `±${rounded(avg)}ms`,
        meta: `平均预判误差 · 最佳 ${rounded(best)}ms · MISS ${results.prediction.misses}`,
        color: avg <= 80 ? "var(--green)" : avg <= 140 ? "var(--yellow)" : "var(--orange)",
      });
    };

    beginRound();
  }

  function runAttention() {
    clearActivity();
    const counts = [4, 6, 9, 12];
    let round = 0;

    const beginRound = () => {
      clearActivity();
      const count = counts[round];
      const cols = count === 4 ? 2 : count === 12 ? 4 : 3;
      const changedIndex = Math.floor(Math.random() * count);
      let changed = false;
      let completed = false;
      let changedAt = 0;
      const dots = Array.from({ length: count }, (_, index) => `<div class="attention-dot" data-dot="${index}"></div>`).join("");
      playShell(
        `<div class="center-content">
          <div class="metric-result-overlay" data-metric-result role="status" aria-live="polite"></div>
          <p class="support-text">变化出现就点屏幕</p>
          <div class="attention-grid" style="--cols:${cols}">${dots}</div>
        </div>`,
        { round: round + 1, total: counts.length, status: `${count} TARGETS`, note: "看全局 · 发现变化就点" },
      );

      schedule(() => {
        onNextFrame((now) => {
          const dot = app.querySelector(`[data-dot="${changedIndex}"]`);
          if (!dot || completed) return;
          changedAt = now;
          changed = true;
          dot.classList.add("changed");
          const status = app.querySelector("[data-status]");
          if (status) status.textContent = "CHANGED";
          schedule(() => resolve(false), 1350);
        });
      }, random(700, 1450));

      bindPointer("[data-play-area]", () => resolve(true));

      function resolve(tapped) {
        if (completed) return;
        if (!changed && tapped) {
          completed = true;
          results.attention.early += 1;
          results.attention.misses += 1;
          const status = app.querySelector("[data-status]");
          if (status) status.textContent = "TOO EARLY";
          showMetricResult("提前点击");
        } else if (changed && tapped) {
          completed = true;
          const reaction = performance.now() - changedAt;
          results.attention.times.push(reaction);
          const status = app.querySelector("[data-status]");
          if (status) status.textContent = `${rounded(reaction)}MS`;
          showMetricResult(`发现用了 ${rounded(reaction)}ms`);
        } else if (changed && !tapped) {
          completed = true;
          results.attention.misses += 1;
          const status = app.querySelector("[data-status]");
          if (status) status.textContent = "MISS";
          showMetricResult("MISS · 没看到");
        } else return;

        round += 1;
        if (round < counts.length) schedule(beginRound, 600);
        else schedule(finish, 650);
      }
    };

    const finish = () => {
      const avg = average(results.attention.times);
      const hitScore = ATTENTION_HIT_SCORES[results.attention.times.length] || 0;
      const speedScore = results.attention.times.length ? scoreByAnchors(avg, SCORE_ANCHORS.attentionSpeed) : 0;
      const previewScore = hitScore * .55 + speedScore * .45;
      showLevelResult({
        stamp: results.attention.times.length ? `${rounded(avg)}ms` : "MISS",
        meta: `变化平均发现速度 · MISS ${results.attention.misses} / ${counts.length}`,
        color: previewScore >= 75 ? "var(--green)" : previewScore >= 60 ? "var(--yellow)" : "var(--orange)",
      });
    };

    beginRound();
  }

  function runPressure() {
    clearActivity();
    const targetMs = 6660;
    const hideAtMs = 4000;
    const limitMs = 10000;
    const startDelay = 650;
    const startAt = performance.now() + startDelay;
    let started = false;
    let completed = false;

    playShell(
      `<div class="center-content">
        <span class="stopwatch-label">目标 / 6.66 秒</span>
        <div class="stopwatch-number" data-stopwatch-number>0.00</div>
        <p class="support-text">点击屏幕停表 · 只有一次机会</p>
      </div>`,
      { round: 1, total: 1, status: "READY", note: "尽量停在 6.66 秒" },
    );

    animate((now) => {
      if (completed) return false;
      if (now < startAt) return true;
      started = true;
      const elapsed = Math.min(now - startAt, limitMs);
      updateStopwatch(elapsed);
      if (elapsed >= limitMs) {
        resolve(limitMs, true);
        return false;
      }
      return true;
    });

    bindPointer("[data-play-area]", () => {
      if (!started || completed) return;
      resolve(Math.min(performance.now() - startAt, limitMs), false);
    });

    function updateStopwatch(elapsed, reveal = false) {
      const number = app.querySelector("[data-stopwatch-number]");
      const status = app.querySelector("[data-status]");
      if (number) {
        const concealed = !reveal && elapsed >= hideAtMs;
        number.textContent = (elapsed / 1000).toFixed(2);
        number.classList.toggle("is-concealed", concealed);
        number.setAttribute("aria-hidden", concealed ? "true" : "false");
      }
      if (status) status.textContent = elapsed < targetMs ? "HOLD" : "LATE";
    }

    function resolve(stoppedAt, missed) {
      if (completed) return;
      completed = true;
      updateStopwatch(stoppedAt, true);
      const error = Math.abs(stoppedAt - targetMs);
      results.pressure.errors.push(error);
      results.pressure.stoppedAt = stoppedAt;
      if (missed) {
        results.pressure.misses += 1;
        results.pressure.timedOut = true;
      }

      const status = app.querySelector("[data-status]");
      const support = app.querySelector(".support-text");
      const rating = error <= 30 ? "PERFECT" : error <= 80 ? "GREAT" : error <= 200 ? "GOOD" : "MISS";
      if (status) status.textContent = missed ? "FAIL" : rating;
      if (support) {
        if (missed) support.textContent = "失败了 · 10.00 秒仍未点击";
        else support.textContent = `${stoppedAt < targetMs ? "提前" : "晚了"} ${(error / 1000).toFixed(2)} 秒`;
      }

      schedule(() => {
        const stoppedLabel = (stoppedAt / 1000).toFixed(2);
        const direction = stoppedAt < targetMs ? "提前" : stoppedAt > targetMs ? "晚了" : "正中目标";
        showLevelResult({
          stamp: `${stoppedLabel}s`,
          meta: missed
            ? "10.00 秒仍未点击 · 本关失败"
            : `目标 6.66 秒 · ${direction}${error ? ` ${(error / 1000).toFixed(2)} 秒` : ""}`,
          color: error <= 80 ? "var(--green)" : error <= 200 ? "var(--yellow)" : "var(--orange)",
        });
      }, 800);
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
    const colors = {
      paper: "#FFF6EA",
      ink: "#000000",
      white: "#FFFFFF",
      orange: "#FF6B35",
      blue: "#004E89",
      yellow: "#F7C548",
      pink: "#FF8FD4",
      green: "#3ECF8E",
    };
    const abilities = [
      ["反应", scores.reaction, colors.green],
      ["判断", scores.decision, colors.orange],
      ["时机", scores.timing, colors.yellow],
      ["预判", scores.prediction, colors.blue],
      ["专注", scores.attention, colors.pink],
    ];

    context.fillStyle = colors.paper;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = colors.pink;
    context.fillRect(890, 80, 190, 190);
    context.fillStyle = colors.yellow;
    context.beginPath();
    context.arc(30, 1190, 145, 0, Math.PI * 2);
    context.fill();

    context.fillStyle = colors.white;
    context.strokeStyle = colors.ink;
    context.lineWidth = 12;
    context.fillRect(58, 62, 964, 1316);
    context.strokeRect(58, 62, 964, 1316);

    context.fillStyle = colors.ink;
    context.font = "900 32px ui-monospace, monospace";
    context.textAlign = "left";
    context.fillText("能打职业吗你？", 105, 130);
    context.textAlign = "right";
    context.fillText("PRO TEST GAME", 975, 130);

    context.fillStyle = colors.yellow;
    context.fillRect(105, 180, 370, 350);
    context.strokeRect(105, 180, 370, 350);
    context.fillStyle = colors.ink;
    context.textAlign = "center";
    context.font = "900 34px ui-monospace, monospace";
    context.fillText("职业指数", 290, 245);
    context.font = "1000 190px ui-monospace, monospace";
    context.fillText(String(scores.career), 290, 435);
    context.font = "900 30px ui-monospace, monospace";
    context.fillText("/ 100", 290, 488);

    context.fillStyle = colors.ink;
    context.textAlign = "left";
    context.font = "1000 62px sans-serif";
    drawWrappedText(context, rank, 530, 285, 400, 72, 2);
    context.font = "800 28px sans-serif";
    context.fillText("我的电竞天赋报告", 530, 410);
    context.fillStyle = colors.green;
    context.fillRect(530, 446, 360, 18);
    context.strokeRect(530, 446, 360, 18);

    context.fillStyle = colors.ink;
    context.font = "900 30px ui-monospace, monospace";
    abilities.forEach(([name, score, color], index) => {
      const y = 610 + index * 95;
      context.textAlign = "left";
      context.fillStyle = colors.ink;
      context.fillText(name, 108, y + 28);
      context.fillStyle = colors.white;
      context.fillRect(238, y, 620, 42);
      context.strokeRect(238, y, 620, 42);
      context.fillStyle = color;
      context.fillRect(244, y + 6, Math.max(0, 608 * score / 100), 30);
      context.fillStyle = colors.ink;
      context.textAlign = "right";
      context.fillText(String(score), 972, y + 30);
    });

    context.fillStyle = colors.pink;
    context.fillRect(105, 1080, 870, 112);
    context.strokeRect(105, 1080, 870, 112);
    context.fillStyle = colors.ink;
    context.textAlign = "left";
    context.font = "900 29px sans-serif";
    drawWrappedText(context, verdict, 135, 1128, 810, 38, 2);

    const metrics = [
      ["最快反应", `${fastest}ms`],
      ["时机误差", `${timingAvg}ms`],
      ["6.66误差", `${sixError}s`],
    ];
    metrics.forEach(([label, value], index) => {
      const x = 105 + index * 295;
      context.fillStyle = colors.white;
      context.fillRect(x, 1230, 275, 92);
      context.strokeRect(x, 1230, 275, 92);
      context.fillStyle = colors.ink;
      context.textAlign = "center";
      context.font = "800 23px ui-monospace, monospace";
      context.fillText(label, x + 137, 1265);
      context.font = "1000 29px ui-monospace, monospace";
      context.fillText(value, x + 137, 1304);
    });

    context.textAlign = "center";
    context.font = "900 24px sans-serif";
    context.fillText("你能打职业吗？来测测。", 540, 1355);
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
      const note = buildShareNote(payload.scores, payload.rank, payload.verdict, payload);
      button.textContent = "正在打开发布页…";
      await miniTool.postNote({
        title: note.title,
        content: note.content,
        pageType: "photo_publish",
        mediaInfo: {
          image_resources: [{ url: image }],
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

  if (restoreProgress()) {
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
})();
