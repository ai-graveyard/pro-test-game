(() => {
  "use strict";

  const C = {
    floor: "#090E1B", wall: "#111B30", metal: "#263A53", edge: "#4B6885",
    black: "#050508", cyan: "#00FFFF", magenta: "#FF00FF", yellow: "#FFFF00",
    pink: "#FF1493", green: "#63FF8B", red: "#FF3D32", orange: "#FF9A28",
    white: "#E9F6FF", blue: "#477CFF", violet: "#8255FF",
  };
  const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
  const add = (a, b) => a.map((value, index) => value + b[index]);
  const DIGITS = {
    "0": "abcedf", "1": "bc", "2": "abged", "3": "abgcd", "4": "fgbc",
    "5": "afgcd", "6": "afgecd", "7": "abc", "8": "abcdefg", "9": "abfgcd", "-": "g",
  };

  function create(container, mode) {
    const engine = window.Stage3DEngine.create(container);
    if (!engine) throw new Error("Unable to create the 3D challenge renderer.");
    const state = {
      startAt: 0, duration: 1000, active: false, appearedAt: 0, visible: false,
      signal: "go", outcome: "idle", resolved: false, resolvedAt: 0,
      count: 4, changedIndex: -1, selectedIndex: -1,
    };
    let targets = [];
    let spawnSerial = -1;
    let destroyed = false, dirty = true;
    const motionQuery = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;

    function reducedMotion() {
      return typeof state.reducedMotion === "boolean" ? state.reducedMotion : Boolean(motionQuery && motionQuery.matches);
    }
    function lowDetail() { return typeof engine.getQuality === "function" && engine.getQuality() !== "default"; }
    function resolvedAge(now) {
      return state.resolved ? Math.max(0, now - state.resolvedAt) : Infinity;
    }
    function hasShot(fallback = false) {
      return typeof state.shot === "boolean" ? state.shot : fallback;
    }
    function shotAge(now, fallback = false) {
      if (!hasShot(fallback)) return Infinity;
      const at = Number.isFinite(state.firedAt) ? state.firedAt : state.resolvedAt;
      return now - at;
    }
    function weaponOptions(now, fallback, extra = {}) {
      return Object.assign({}, extra, { shot: hasShot(fallback), firedAt: Number.isFinite(state.firedAt) ? state.firedAt : state.resolvedAt,
        resolvedAt: state.resolvedAt, now, reducedMotion: reducedMotion() });
    }
    function beam(from, to, color, now, fallback) {
      const age = shotAge(now, fallback);
      if (age >= 0 && age < 85) line(from, to, color, .045, 1 - age / 85);
    }

    function setState(patch) {
      if (patch.visible === true && (!state.visible || (patch.signal && patch.signal !== state.signal))) {
        spawnSerial += 1;
      }
      Object.assign(state, patch);
      dirty = true;
      if (typeof engine.invalidate === "function") engine.invalidate();
      return api;
    }

    function timeline(now) {
      if (state.resolved && Number.isFinite(state.frozenProgress)) return state.frozenProgress;
      return (now - (state.startAt || 0)) / Math.max(1, state.duration || 1000);
    }

    function camera(eye, target, fov, now, bounds = null) {
      const rect = container.getBoundingClientRect();
      const aspect = Math.max(.3, rect.width / Math.max(1, rect.height));
      let fittedEye = eye;
      if (bounds && bounds.length) {
        const unit = (v) => { const length = Math.hypot(...v) || 1; return v.map(n => n / length); };
        const dot = (a, b) => a.reduce((n, value, i) => n + value * b[i], 0);
        const back = unit(eye.map((value, i) => value - target[i]));
        const right = unit([back[2], 0, -back[0]]);
        const up = [back[1] * right[2] - back[2] * right[1], back[2] * right[0] - back[0] * right[2], back[0] * right[1] - back[1] * right[0]];
        const distance = Math.hypot(...eye.map((value, i) => value - target[i]));
        const focal = 1 / Math.tan(fov * Math.PI / 360);
        const safeVertical = Math.max(.28, Math.min(.76, 1 - 240 / Math.max(1, rect.height)));
        let zoom = .65;
        bounds.forEach(point => {
          const relative = point.map((value, i) => value - target[i]);
          const depth = dot(relative, back);
          zoom = Math.max(zoom, (Math.abs(dot(relative, right)) * focal / (aspect * .84) + depth) / distance);
          zoom = Math.max(zoom, (Math.abs(dot(relative, up)) * focal / safeVertical + depth) / distance);
        });
        fittedEye = eye.map((value, i) => target[i] + (value - target[i]) * zoom);
      }
      engine.begin({ eye: fittedEye, target, fov }, now);
      return fittedEye;
    }

    function environment(options = {}) {
      if (typeof engine.setLayer === "function") engine.setLayer("environment");
      if (typeof engine.drawStatic === "function") {
        const key = mode + ":" + (options.count || 0) + ":" + (options.columns || 0) + ":" + (options.rows || 0);
        engine.drawStatic(key, () => window.StageArt3D.draw(engine, mode, options));
      } else window.StageArt3D.draw(engine, mode, options);
      if (typeof engine.setLayer === "function") engine.setLayer("scene");
    }

    function box(pos, size, color = C.metal, rotation = [0, 0, 0], emission = 0, alpha = 1) {
      engine.box(pos, size, color, rotation, emission, alpha);
    }
    function line(a, b, color = C.edge, width = .03, alpha = 1) {
      engine.line(a, b, color, width, alpha);
    }
    function ring(pos, radius, color, rotation = [0, 0, 0], tube = .035, alpha = 1) {
      engine.ring(pos, radius, color, rotation, tube, alpha);
    }
    function floor(width, depth, y = -1.5, accent = C.cyan, z = 0) {
      box([0, y - .14, z], [width, .28, depth], C.floor);
      line([-width / 2, y + .01, z - depth / 2], [-width / 2, y + .01, z + depth / 2], accent, .035);
      line([width / 2, y + .01, z - depth / 2], [width / 2, y + .01, z + depth / 2], accent, .035);
      for (let index = 1; index <= 4; index += 1) {
        const gz = z - depth / 2 + depth * index / 5;
        line([-width / 2, y + .01, gz], [width / 2, y + .01, gz], C.metal, .018);
      }
    }
    function wireBox(pos, size, color) {
      const corners = [];
      for (let x = -1; x <= 1; x += 2) {
        for (let y = -1; y <= 1; y += 2) {
          for (let z = -1; z <= 1; z += 2) {
            corners.push([pos[0] + x * size[0] / 2, pos[1] + y * size[1] / 2, pos[2] + z * size[2] / 2]);
          }
        }
      }
      corners.forEach((corner, index) => {
        [1, 2, 4].forEach((bit) => {
          if ((index & bit) === 0) line(corner, corners[index | bit], color, .025, .65);
        });
      });
    }
    function fragments(center, color, now, size = .2) {
      const still = reducedMotion();
      if (lowDetail()) return;
      const age = resolvedAge(now), duration = still ? 140 : 430;
      if (age >= duration) return;
      const burst = clamp(age / duration, 0, 1);
      for (let index = 0; index < (still ? 4 : 8); index += 1) {
        const angle = index * Math.PI / 4;
        const radius = still ? .16 : .08 + burst * .95;
        const shrink = Math.max(.2, 1 - burst);
        box(add(center, [Math.cos(angle) * radius, Math.sin(angle) * radius - (still ? 0 : burst * burst * .45), (index % 3 - 1) * radius * .32]),
          [size * shrink, size * 1.8 * shrink, size * .65 * shrink], color,
          [index * .3 + (still ? 0 : burst * 1.4), .4, angle], 1, 1 - burst);
      }
    }
    function impact(center, color, now, size = .14) {
      const age = resolvedAge(now), duration = reducedMotion() ? 140 : 340;
      if (age >= duration) return;
      fragments(center, color, now, size);
      const progress = age / duration;
      ring(center, .18 + (reducedMotion() ? 0 : progress * .85), color, [0, 0, 0], .035, 1 - progress);
    }

    function reaction(now) {
      camera([0, .72, 5.8], [0, .05, -3], 55, now);
      environment();
      const active = Boolean(state.active);
      const open = active ? reducedMotion() ? 1 : clamp((now - state.appearedAt) / 180, 0, 1) : 0;
      box([0, .25, -3.75], [3.7, 3.9, .36], C.black);
      box([-1.95, .25, -3.35], [.38, 3.9, .5], C.metal);
      box([1.95, .25, -3.35], [.38, 3.9, .5], C.metal);
      box([0, 2.08, -3.35], [4.15, .32, .5], C.metal);
      const doorColor = active ? C.green : C.orange;
      [-1, 1].forEach((side) => {
        const x = side * (.78 + open * 1.13);
        box([x, .2, -3.25], [1.5, 3.55, .32], C.wall);
        box([x, .2, -3.04], [1.22, 3.1, .08], C.metal);
        line([x - side * .58, -1.2, -2.97], [x - side * .58, 1.6, -2.97], doorColor, .055);
        box([side * 1.96, 1.5, -3.02], [.22, .3, .12], doorColor, [0, 0, 0], .9);
        if (!lowDetail()) {
          [-.98, -.72, -.46].forEach(y => box([x, y, -2.98], [.9, .075, .055], C.black));
          [-.47, .47].forEach(dx => {
          box([x + dx, .65, -2.96], [.075, .9, .07], C.edge);
          engine.cylinder([x + dx, 1.3, -2.93], .045, .055, C.edge, [Math.PI / 2, 0, 0]);
          });
        }
        engine.cylinder([side * 2.12, -.1, -3.02], .09, 1.65, C.edge);
        engine.cylinder([side * 2.12, -.14 + open * .38, -3.02], .045, 1.9, C.metal);
      });
      engine.label("RG-01 / REACTOR ACCESS", [0, 2.36, -3.05], [2.45, .18], C.edge);
      if (active) {
        const color = state.outcome === "miss" ? C.red : C.green;
        engine.cylinder([0, .05, -3.18], .91, .22, C.metal, [Math.PI / 2, 0, 0]);
        ring([0, .05, -3.0], .82, color, [0, 0, Math.PI / 8], .075);
        box([0, .05, -3.1], [1.02, 1.02, .15], C.metal, [0, 0, Math.PI / 4]);
        box([0, .05, -2.98], [.43, .43, .08], color, [0, 0, Math.PI / 4], 1);
        line([-.64, .05, -2.87], [.64, .05, -2.87], color, .035);
        line([0, -.59, -2.87], [0, .69, -2.87], color, .035);
      }
      const legacyShot = state.resolved && (state.outcome === "success" || state.outcome === "early");
      const gun = window.StageModels3D.weapon(engine, [.5, -.65, 3.0], .75, weaponOptions(now, legacyShot, { accent: C.cyan }));
      if (hasShot(legacyShot)) {
        const hit = active && state.outcome === "success";
        const point = hit ? [0, .05, -2.87] : [.04, .2, -2.87];
        beam(gun.muzzle, point, hit ? C.green : C.orange, now, legacyShot);
        impact(point, hit ? C.green : C.orange, now, .14);
      }
      if (state.outcome === "early") {
        line([-1.2, -1.6, -.8], [1.2, -1.6, -.8], C.red, .13);
      }
    }

    function timing(now) {
      camera([.12, .9, 6.8], [0, .05, -1.8], 52, now);
      environment();
      const progress = timeline(now);
      const z = -10 + progress * (10 / .78);
      const feedback = { outcome: state.outcome, resolved: state.resolved, resolvedAt: state.resolvedAt,
        blockAttempt: state.blockAttempt, now, reducedMotion: reducedMotion() };
      window.StageModels3D.shield(engine, feedback);
      if (state.outcome === "success") {
        window.StageModels3D.blade(engine, [0, .25, z], Object.assign({}, feedback, { shattered: true }));
        impact([0, .25, Math.min(.1, z)], C.magenta, now, .16);
      } else {
        window.StageModels3D.blade(engine, [0, .25, z], feedback);
        if (state.resolved && state.blockAttempt !== false) impact([0, .05, .14], C.red, now, .1);
      }
    }

    function drone(pos, hostile, scale = 1, damaged = false, options = {}) {
      window.StageModels3D.drone(engine, pos, hostile, scale, damaged, Object.assign({}, options, { reducedMotion: reducedMotion() }));
    }

    function decision(now) {
      const lane = Number.isFinite(state.lane) ? clamp(state.lane, -1, 1) : (Math.max(0, spawnSerial) % 3) - 1;
      const x = lane * 2.65;
      camera([lane * 2.25 + .35, 1.35, 5.5], [x, .05, -2.15], 51, now);
      environment({ lane });
      const legacyShot = state.resolved && (state.signal === "go" ? state.outcome === "success" : state.outcome === "miss");
      const gun = window.StageModels3D.weapon(engine, [lane * 2.25 + .72, -.3, 3.0], .62,
        weaponOptions(now, legacyShot, { accent: C.magenta, rotation: [0, lane * -.035, 0] }));
      if (state.visible || state.resolved) {
        const hostile = state.signal === "go";
        const frozenTime = state.resolved ? state.resolvedAt : now;
        const y = .12 + Math.sin(frozenTime / 700) * .07;
        const pos = [x, y, -2.15];
        const hit = state.resolved && hasShot(legacyShot);
        drone(pos, hostile, 1.05, hit, { hit, resolved: state.resolved, resolvedAt: state.resolvedAt, now });
        if (hit) {
          const point = [x, y, -1.57];
          beam(gun.muzzle, point, state.outcome === "success" ? C.yellow : C.orange, now, legacyShot);
          impact(point, hostile ? C.orange : C.blue, now, .17);
        } else if (state.resolved && resolvedAge(now) < 220) {
          ring([x, y, -1.47], .9, state.outcome === "success" ? C.cyan : C.red, [0, 0, 0], .06, 1 - resolvedAge(now) / 220);
        }
      }
    }

    function prediction(now) {
      const bounds = [[-6.05, .05, -.15], [4.85, .05, -.15], [-.5, 2, .87], [3.2, -1.7, .87]];
      if (state.resolved) bounds.push([Math.max(4.9, -5 + timeline(now) * 9 + .7), .05, -.15]);
      const eye = camera([8.2, 7.4, 12.8], [0, -.1, -.2], 43, now, bounds);
      environment({ resolved: state.resolved });
      const progress = timeline(now);
      const x = -5 + progress * 9;
      const hidden = progress >= .5 && !state.resolved;
      // Keep the last visible centre just outside the physical cover from this
      // camera, so an oblique view cannot hide the drone before its timed cue.
      const left = -.5 + (eye[0] + .5) * (1.195 + .15) / (eye[2] + .15);
      const wallWidth = 3.2 - left;
      const wallCenter = (left + 3.2) / 2;
      const wallPos = [wallCenter, -.05, .87];
      const wallSize = [wallWidth, 3.1, .65];
      if (state.resolved) wireBox(wallPos, wallSize, C.blue);
      else {
        box(wallPos, wallSize, "#153D80");
        box([wallCenter, 1.48, 1.25], [wallWidth + .14, .14, .16], C.blue, [0, 0, 0], .5);
        [left + .08, wallCenter, 3.13].forEach((beamX) => box([beamX, -.05, 1.24], [.11, 3.05, .12], C.metal));
        for (let index = 0; index < (lowDetail() ? 0 : 7); index += 1) {
          box([wallCenter, -1.25 + index * .38, 1.226], [wallWidth - .15, .025, .035], C.edge);
        }
        engine.label("CARGO / NO VISUAL", [wallCenter, .72, 1.256], [wallWidth * .76, .25], C.white);
        [left + .2, 2.95].forEach(x => {
          engine.cylinder([x, -.1, 1.31], .045, 2.25, C.edge);
          box([x, -1.3, 1.31], [.25, .12, .12], C.yellow);
        });
      }
      // Submit no target, moving shadow, trail or light while the drone is concealed.
      if (!hidden) {
        const legacyShot = state.resolved && state.outcome === "success";
        const hit = state.resolved && hasShot(legacyShot) && state.outcome === "success";
        drone([x, .05, -.15], false, .7, hit, { hit, resolved: state.resolved, resolvedAt: state.resolvedAt, now });
        if (state.resolved && hasShot(legacyShot)) {
          const point = [x, .05, -.15], color = state.outcome === "success" ? C.green : C.orange;
          beam([4, .05, 3.2], point, color, now, legacyShot);
          impact(point, color, now, .12);
        }
      }
      box([4, 0, -.32], [1.15, 2.55, .2], C.black);
      ring([4, .05, -.15], .72, C.yellow, [0, 0, 0], .045);
      line([3.55, .05, -.11], [4.45, .05, -.11], C.yellow, .025);
      line([4, -.4, -.11], [4, .5, -.11], C.yellow, .025);
    }

    function attention(now) {
      const count = clamp(Math.round(state.count || 4), 1, 12);
      const portrait = container.clientWidth / Math.max(1, container.clientHeight) < 1.15;
      const columns = count <= 4 ? 2 : portrait ? (count <= 6 ? 2 : 3) : Math.min(4, Math.ceil(count / 3));
      const rows = Math.ceil(count / columns);
      const positions = Array.from({ length: count }, (_, index) => ({
        index,
        x: (index % columns - (columns - 1) / 2) * 2.25,
        z: (Math.floor(index / columns) - (rows - 1) / 2) * 2.35,
      }));
      const bounds = positions.reduce((points, p) => points.concat([[p.x - .72, -.9, p.z], [p.x + .72, 1.0, p.z]]), []);
      camera([0, 9.8, 7.6], [0, -.25, 0], 47, now, bounds);
      environment({ positions, columns, rows, count });
      const hitIndex = Number.isInteger(state.hitIndex) ? state.hitIndex : state.outcome === "success" ? state.changedIndex : -1;
      const legacyShot = state.resolved && hitIndex >= 0;
      positions.forEach(({ index, x, z }) => {
        const intrusion = index === state.changedIndex;
        const hit = state.resolved && hasShot(legacyShot) && index === hitIndex;
        window.StageModels3D.turret(engine, [x, .38, z], intrusion, index === state.selectedIndex,
          { hit, resolved: state.resolved, resolvedAt: state.resolvedAt, now, reducedMotion: reducedMotion() });
      });
      if (state.resolved && hasShot(legacyShot)) {
        const selected = positions.find(({ index }) => index === hitIndex);
        const point = selected ? [selected.x, .05, selected.z + .45] : [0, -1.2, 0];
        const color = state.outcome === "success" ? C.yellow : C.orange;
        beam([0, -1.1, 6], point, color, now, legacyShot);
        impact(point, color, now, .12);
      }
      engine.end();
      const rect = container.getBoundingClientRect();
      targets = positions.map(({ index, x, z }) => {
        const position = [x, -.1, z];
        const point = engine.project(position);
        const side = engine.project(add(position, [.76, 0, 0]));
        return {
          id: index, index,
          x: rect.left + point.x, y: rect.top + point.y,
          radius: Math.max(24, Math.hypot(side.x - point.x, side.y - point.y)),
          visible: point.visible !== false,
        };
      }).filter((target) => target.visible);
    }

    function digit(character, x, y, z, color) {
      const segments = DIGITS[character] || DIGITS["-"];
      const layout = {
        a: [0, -.36, .29, .055], g: [0, 0, .29, .055], d: [0, .36, .29, .055],
        f: [-.17, -.18, .055, .27], b: [.17, -.18, .055, .27],
        e: [-.17, .18, .055, .27], c: [.17, .18, .055, .27],
      };
      for (const segment of segments) {
        const [dx, dz, width, depth] = layout[segment];
        box([x + dx, y, z + dz], [width, .035, depth], color, [0, 0, 0], .9);
      }
    }

    function pressure(now) {
      camera([4.6, 6.7, 8.2], [.3, -.05, .25], 40, now, [[-2.9, -.9, -2.4], [2.9, -.9, -2.4], [-2.9, .85, 2.5], [2.9, 1.05, 2.5]]);
      environment();
      const elapsed = Number.isFinite(state.frozenElapsed) ? state.frozenElapsed : Math.max(0, now - state.startAt);
      const concealed = elapsed >= 4000 && !state.resolved;
      window.StageModels3D.device(engine, { resolved: state.resolved, resolvedAt: state.resolvedAt, outcome: state.outcome,
        disarmPressed: state.disarmPressed, elapsed, concealed, now, reducedMotion: reducedMotion() });
      const accent = state.outcome === "success" ? C.green : state.resolved ? C.orange : C.cyan;
      const display = concealed ? "----" : (Math.min(99.99, elapsed / 1000)).toFixed(2).replace(".", "").padStart(4, "0");
      [-.98, -.45, .35, .88].forEach((x, index) => digit(display[index], x, .63, -.35, accent));
      box([-.05, .63, -.01], [.075, .04, .075], accent, [0, 0, 0], .9);
    }

    function render(now) {
      if (destroyed || typeof document !== "undefined" && document.hidden) return;
      if (typeof engine.shouldRender === "function" && !engine.shouldRender(now, dirty)) return;
      targets = [];
      if (mode === "reaction") reaction(now);
      else if (mode === "timing") timing(now);
      else if (mode === "decision") decision(now);
      else if (mode === "prediction") prediction(now);
      else if (mode === "attention") attention(now);
      else pressure(now);
      if (mode !== "attention") engine.end();
      dirty = false;
    }

    function hitTest(clientX, clientY) {
      let closest = -1;
      let distance = Infinity;
      targets.forEach((target) => {
        const normalized = Math.hypot(clientX - target.x, clientY - target.y) / target.radius;
        if (normalized <= 1 && normalized < distance) {
          closest = target.index;
          distance = normalized;
        }
      });
      return closest;
    }
    function getTargets() { return targets.map((target) => Object.assign({}, target)); }
    function destroy() {
      if (destroyed) return;
      destroyed = true;
      targets = [];
      engine.destroy();
    }
    const api = { setState, render, hitTest, getTargets, destroy, engine };
    return api;
  }

  window.ChallengeScenes3D = { create };
})();
