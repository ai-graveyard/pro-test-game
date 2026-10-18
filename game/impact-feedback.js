(() => {
  "use strict";

  const instances = new WeakMap();
  const KINDS = new Set(["shot", "hit", "block", "perfect", "miss", "early", "switch", "disarm", "fail", "confirm"]);
  const BAD_OUTCOMES = new Set(["fail", "failure", "miss", "early", "timeout"]);
  const COLORS = { cyan: "#55F5FF", white: "#F1FCFF", green: "#79FFB1", red: "#FF4B65", amber: "#FFBA59" };

  function create(area) {
    if (!area || typeof area.appendChild !== "function") throw new TypeError("GameImpact.create requires a stage element.");
    if (instances.has(area)) return instances.get(area);
    const doc = area.ownerDocument || document;
    const layer = doc.createElement("div");
    const viewport = doc.createElement("div");
    layer.className = "impact-layer";
    layer.setAttribute("aria-hidden", "true");
    viewport.className = "impact-viewport";
    layer.appendChild(viewport);
    area.appendChild(layer);

    const media = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
    const animations = new Set();
    const timers = new Set();
    const nodes = new Set();
    const particles = new Set();
    let destroyed = false;
    let worldAnimation = null;
    let kickedWorld = null;

    const reduced = () => Boolean(media && media.matches);

    function removeNode(node) {
      nodes.delete(node);
      particles.delete(node);
      node.remove();
    }

    function animate(target, frames, duration, finish) {
      let animation;
      try {
        if (typeof target.animate !== "function") return false;
        animation = target.animate(frames, { duration, easing: "cubic-bezier(.18,.72,.3,1)", fill: "none" });
        if (!animation || typeof animation.cancel !== "function") return false;
      } catch (_) { return false; }
      animations.add(animation);
      let completed = false;
      const done = () => {
        if (completed) return;
        completed = true;
        animations.delete(animation);
        if (finish) finish();
      };
      animation.onfinish = done;
      animation.oncancel = done;
      return animation;
    }

    function spawn(className, color, frames, duration, setup) {
      if (destroyed) return null;
      const node = doc.createElement("span");
      node.className = `impact-effect ${className}`;
      if (color) node.style.setProperty("--impact-color", color);
      if (setup) setup(node);
      nodes.add(node);
      viewport.appendChild(node);
      if (!animate(node, frames, duration, () => removeNode(node))) {
        // Older WebViews still get the short colored marker, without motion.
        const peak = frames.reduce((value, frame) => Math.max(value, Number(frame.opacity) || 0), 0);
        node.style.opacity = String(peak);
        const timer = window.setTimeout(() => {
          timers.delete(timer);
          removeNode(node);
        }, Math.min(duration, 220));
        timers.add(timer);
      }
      return node;
    }

    function pulse(className, color, power, duration = 180) {
      return spawn(className, color, [
        { opacity: 0, offset: 0 },
        { opacity: .30 + power * .44, offset: .12 },
        { opacity: 0, offset: 1 },
      ], duration);
    }

    function ring(className, color, power, duration = 300) {
      const still = reduced();
      return spawn(`impact-ring ${className}`, color, still ? [
        { opacity: 0, offset: 0 },
        { opacity: .40 + power * .35, offset: .12 },
        { opacity: 0, offset: 1 },
      ] : [
        { opacity: .25 + power * .35, transform: "translate(-50%, -50%) scale(.48)", offset: 0 },
        { opacity: .55 + power * .30, transform: "translate(-50%, -50%) scale(.76)", offset: .2 },
        { opacity: 0, transform: "translate(-50%, -50%) scale(1.22)", offset: 1 },
      ], still ? Math.min(duration, 180) : duration);
    }

    function marker(color, power, perfect = false) {
      const still = reduced();
      spawn(`impact-cross${perfect ? " impact-cross-perfect" : ""}`, color, still ? [
        { opacity: 0, offset: 0 },
        { opacity: .65 + power * .30, offset: .08 },
        { opacity: .65 + power * .30, offset: .45 },
        { opacity: 0, offset: 1 },
      ] : [
        { opacity: 0, transform: "translate(-50%, -50%) scale(1.3)", offset: 0 },
        { opacity: .65 + power * .30, transform: "translate(-50%, -50%) scale(1)", offset: .12 },
        { opacity: .65 + power * .30, transform: "translate(-50%, -50%) scale(.96)", offset: .50 },
        { opacity: 0, transform: "translate(-50%, -50%) scale(.86)", offset: 1 },
      ], still ? 170 : 240);
    }

    function sparks(color, power, requestedCount = 8) {
      if (reduced()) return;
      const count = Math.min(requestedCount, Math.max(0, 12 - particles.size));
      for (let index = 0; index < count; index += 1) {
        const angle = index * 360 / count + 22.5;
        const distance = 25 + power * 25 + (index % 3) * 6;
        const particle = spawn("impact-spark impact-motion", color, [
          { opacity: 0, transform: `rotate(${angle}deg) translateX(6px) scaleX(.5)`, offset: 0 },
          { opacity: .60 + power * .35, transform: `rotate(${angle}deg) translateX(16px) scaleX(1)`, offset: .12 },
          { opacity: 0, transform: `rotate(${angle}deg) translateX(${distance}px) scaleX(.18)`, offset: 1 },
        ], 240 + (index % 3) * 35);
        if (particle) particles.add(particle);
      }
    }

    function kick(power, shake = false) {
      if (reduced() || destroyed) return;
      const world = area.querySelector(".challenge-world");
      if (!world || typeof world.animate !== "function") return;
      if (worldAnimation) worldAnimation.cancel();
      const amplitude = 2 + power * (shake ? 2.8 : 2);
      const frames = shake ? [
        { transform: "translate3d(0,0,0)", offset: 0 },
        { transform: `translate3d(${-amplitude}px,1px,0)`, offset: .18 },
        { transform: `translate3d(${amplitude * .7}px,-1px,0)`, offset: .43 },
        { transform: `translate3d(${-amplitude * .35}px,0,0)`, offset: .68 },
        { transform: "translate3d(0,0,0)", offset: 1 },
      ] : [
        { transform: "translate3d(0,0,0)", offset: 0 },
        { transform: `translate3d(-.6px,${amplitude}px,0)`, offset: .15 },
        { transform: "translate3d(.3px,-1px,0)", offset: .47 },
        { transform: "translate3d(0,0,0)", offset: 1 },
      ];
      world.classList.add("impact-recoiling");
      kickedWorld = world;
      const animation = animate(world, frames, shake ? 150 : 115, () => {
        if (worldAnimation !== animation) return;
        worldAnimation = null;
        world.classList.remove("impact-recoiling");
        if (kickedWorld === world) kickedWorld = null;
      });
      worldAnimation = animation || null;
      if (!animation) { world.classList.remove("impact-recoiling"); kickedWorld = null; }
    }

    function shot(power) {
      pulse("impact-flash impact-flash-shot", COLORS.amber, power * .30, reduced() ? 85 : 105);
      kick(power);
    }

    function hit(power, perfect) {
      marker(perfect ? COLORS.white : COLORS.cyan, power, perfect);
      sparks(perfect ? COLORS.white : COLORS.cyan, power);
    }

    function block(power, perfect) {
      const color = perfect ? COLORS.white : COLORS.cyan;
      ring(`impact-block-ring${perfect ? " impact-ring-perfect" : ""}`, color, power, perfect ? 340 : 280);
      pulse("impact-edge impact-edge-block", COLORS.cyan, power * .65, reduced() ? 130 : 210);
      if (perfect) {
        marker(COLORS.white, power, true);
        sparks(COLORS.cyan, power);
      } else sparks(COLORS.cyan, power * .65);
    }

    function fail(power) {
      pulse("impact-edge impact-edge-fail", COLORS.red, power * .70, reduced() ? 150 : 300);
      marker(COLORS.red, power * .75);
      kick(power, true);
    }

    function disarm(power) {
      ring("impact-complete-ring", COLORS.green, power, reduced() ? 170 : 400);
      if (reduced()) {
        pulse("impact-edge impact-edge-success", COLORS.green, power * .45, 150);
      } else {
        spawn("impact-success-sweep impact-motion", COLORS.green, [
          { opacity: 0, transform: "translateX(-140%) skewX(-18deg)", offset: 0 },
          { opacity: .28 + power * .13, transform: "translateX(-55%) skewX(-18deg)", offset: .24 },
          { opacity: .16, transform: "translateX(55%) skewX(-18deg)", offset: .64 },
          { opacity: 0, transform: "translateX(150%) skewX(-18deg)", offset: 1 },
        ], 480);
      }
    }

    function trigger(kind, options = {}) {
      if (destroyed || !KINDS.has(kind)) return false;
      const settings = options && typeof options === "object" ? options : {};
      const requestedPower = Number(settings.power);
      const power = Number.isFinite(requestedPower) ? Math.max(0, Math.min(1, requestedPower)) : .65;
      if (power === 0) return true;
      const perfect = kind === "perfect" || Boolean(settings.perfect);
      const bad = BAD_OUTCOMES.has(settings.outcome);
      if (kind === "shot") shot(power);
      else if (kind === "hit") hit(power, perfect);
      else if (kind === "block" || kind === "perfect") {
        if (bad) { pulse("impact-edge impact-edge-fail", COLORS.red, power * .4, 160); marker(COLORS.red, power * .6); }
        else block(power, perfect);
      } else if (kind === "miss") {
        pulse("impact-edge impact-edge-miss", COLORS.red, power * .40, 170);
        marker(COLORS.red, power * .55);
      } else if (kind === "early") {
        pulse("impact-edge impact-edge-early", COLORS.amber, power * .40, 160);
        ring("impact-early-ring", COLORS.amber, power * .55, 170);
      } else if (kind === "switch") ring("impact-switch-ring", COLORS.amber, power * .7, 170);
      else if (kind === "disarm") { if (bad) fail(power); else disarm(power); }
      else if (kind === "fail") fail(power);
      else if (kind === "confirm") ring("impact-confirm-ring", COLORS.cyan, power * .5, 180);
      return true;
    }

    function clear() {
      for (const animation of [...animations]) animation.cancel();
      animations.clear();
      for (const timer of timers) window.clearTimeout(timer);
      timers.clear();
      for (const node of [...nodes]) removeNode(node);
      while (viewport.firstChild) viewport.removeChild(viewport.firstChild);
      if (kickedWorld) kickedWorld.classList.remove("impact-recoiling");
      const world = area.querySelector(".challenge-world");
      if (world) world.classList.remove("impact-recoiling");
      worldAnimation = null;
      kickedWorld = null;
    }

    const onMotionChange = () => { if (reduced()) clear(); };
    if (media && typeof media.addEventListener === "function") media.addEventListener("change", onMotionChange);
    else if (media && typeof media.addListener === "function") media.addListener(onMotionChange);

    function destroy() {
      if (destroyed) return;
      clear();
      destroyed = true;
      if (media && typeof media.removeEventListener === "function") media.removeEventListener("change", onMotionChange);
      else if (media && typeof media.removeListener === "function") media.removeListener(onMotionChange);
      layer.remove();
      instances.delete(area);
    }

    const api = Object.freeze({ trigger, clear, destroy });
    instances.set(area, api);
    return api;
  }

  window.GameImpact = Object.freeze({ create });
})();
