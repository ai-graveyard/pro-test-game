(() => {
  "use strict";

  // Prefabs use full dimensions, radians and the same X -> Y -> Z Euler order
  // as Stage3DEngine. +Y is up; a drone faces +Z and a player's gun fires -Z.
  // These models contain no timers. In particular the device never derives an
  // indicator, glow or mechanical position from elapsed/now while unresolved.
  const C = Object.freeze({
    dark: "#07101C", rubber: "#101923", gunmetal: "#233548",
    armor: "#344B61", bevel: "#567087", steel: "#8FA9BA",
    pale: "#D3DFE7", white: "#F1FAFF", recess: "#030A11",
    cyan: "#00E7F3", blue: "#427DFF", red: "#FF443A",
    orange: "#FF9B30", yellow: "#F6E74A", violet: "#9C54ED",
    magenta: "#F53BD7", green: "#65FFA0",
  });
  const PI = Math.PI;
  const ZERO = Object.freeze([0, 0, 0]);
  const CYL_Z = Object.freeze([PI / 2, 0, 0]);
  const CYL_X = Object.freeze([0, 0, PI / 2]);
  const RING_XZ = Object.freeze([PI / 2, 0, 0]);
  const RING_YZ = Object.freeze([0, PI / 2, 0]);
  const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
  const ease = (value) => 1 - Math.pow(1 - clamp(value, 0, 1), 3);
  const lowDetail = (engine) => typeof engine.getQuality === "function" && engine.getQuality() !== "default";

  function reduced(options) {
    if (typeof options.reducedMotion === "boolean") return options.reducedMotion;
    return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function resolvedAge(options) {
    if (!options.resolved) return Infinity;
    const now = Number.isFinite(options.now) ? options.now : 0;
    const at = Number.isFinite(options.resolvedAt) ? options.resolvedAt : now;
    return Math.max(0, now - at);
  }

  function rotate(point, rotation) {
    const [rx, ry, rz] = rotation;
    const cx = Math.cos(rx), sx = Math.sin(rx), cy = Math.cos(ry), sy = Math.sin(ry), cz = Math.cos(rz), sz = Math.sin(rz);
    const y = point[1] * cx - point[2] * sx;
    const z = point[1] * sx + point[2] * cx;
    const x = point[0] * cy + z * sy;
    const depth = -point[0] * sy + z * cy;
    return [x * cz - y * sz, x * sz + y * cz, depth];
  }

  function compose(outer, inner) {
    if (outer.every((angle) => angle === 0)) return inner;
    const x = rotate(rotate([1, 0, 0], inner), outer);
    const y = rotate(rotate([0, 1, 0], inner), outer);
    const z = rotate(rotate([0, 0, 1], inner), outer);
    const pitch = Math.asin(Math.max(-1, Math.min(1, -x[2])));
    if (Math.abs(Math.cos(pitch)) < .00001) return [0, pitch, Math.atan2(-y[0], y[1])];
    return [Math.atan2(y[2], z[2]), pitch, Math.atan2(x[1], x[0])];
  }

  function rig(engine, origin = ZERO, scale = 1, rotation = ZERO) {
    const at = (point) => rotate(point.map((value) => value * scale), rotation).map((value, axis) => value + origin[axis]);
    const size = (dimensions) => dimensions.map((value) => value * scale);
    const partRotation = (value) => compose(rotation, value);
    return {
      at,
      box(point, dimensions, color, turn = ZERO, emission = 0, alpha = 1) {
        engine.box(at(point), size(dimensions), color, partRotation(turn), emission, alpha);
      },
      cylinder(point, radius, height, color, turn = ZERO, emission = 0, alpha = 1) {
        engine.cylinder(at(point), radius * scale, height * scale, color, partRotation(turn), emission, alpha);
      },
      ring(point, radius, color, turn = ZERO, tube = .035, alpha = 1) {
        engine.ring(at(point), radius * scale, color, partRotation(turn), tube * scale, alpha);
      },
      line(from, to, color, width = .025, alpha = 1) {
        engine.line(at(from), at(to), color, width * scale, alpha);
      },
      label(text, point, dimensions, color = C.pale, turn = ZERO) {
        if (typeof engine.label === "function") engine.label(text, at(point), size(dimensions), color, partRotation(turn));
      },
      shadow(point, dimensions, alpha = .25) {
        if (typeof engine.shadow === "function") engine.shadow(at(point), size(dimensions), alpha);
      },
    };
  }

  // A six-part octagonal extrusion has real clipped corners in its silhouette;
  // the four sloping faces are separate material strips, rather than a decal.
  function armor(r, point, dimensions, body = C.armor, bevel = C.bevel, cut = .06, turn = ZERO) {
    const [width, height, depth] = dimensions;
    const b = Math.min(cut, width * .22, height * .22);
    const offset = (p) => rotate(p, turn).map((value, axis) => value + point[axis]);
    r.box(point, [width - b * 2, height, depth], body, turn);
    r.box(point, [width, height - b * 2, depth], body, turn);
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      r.box(offset([sx * (width / 2 - b), sy * (height / 2 - b), 0]), [b * Math.SQRT2, b * Math.SQRT2, depth], bevel, [turn[0], turn[1], turn[2] + PI / 4]);
    }
  }

  function cable(r, points, color, width = .045, broken = false) {
    for (let index = 0; index < points.length - 1; index += 1) {
      if (broken && index === 1) continue;
      r.line(points[index], points[index + 1], color, width);
    }
  }

  /** First-person rail rifle. pos is receiver center, not the grip or muzzle.
   * Gun bounds: x ~ +/- .35, y [-.58,.59], z [-1.27,1.15].
   * Holding hands and short armored forearms extend down to local y ~ -1.1.
   * Return the fully rotated/scaled world muzzle for shot effects. */
  function weapon(engine, pos, scale = 1, options = {}) {
    const accent = options.accent || C.cyan;
    const shot = typeof options.shot === "boolean" ? options.shot : Boolean(options.firing);
    const now = Number.isFinite(options.now) ? options.now : 0;
    const firedAt = Number.isFinite(options.firedAt) ? options.firedAt : Number.isFinite(options.resolvedAt) ? options.resolvedAt : now;
    const age = shot ? now - firedAt : Infinity;
    const phase = clamp(age / 150, 0, 1);
    const recoil = !reduced(options) && age >= 0 && age < 150 ? (phase < .2 ? phase / .2 : (1 - phase) / .8) : 0;
    const rotation = (options.rotation || ZERO).map((angle, axis) => angle + (axis === 0 ? .065 * recoil : 0));
    const origin = pos.map((value, axis) => value + (axis === 1 ? .025 * recoil * scale : axis === 2 ? .18 * recoil * scale : 0));
    const r = rig(engine, origin, scale, rotation);
    if (lowDetail(engine)) {
      r.box([0, .02, .08], [.5, .42, 1.28], C.gunmetal);
      r.cylinder([0, .3, -.77], .105, .88, C.steel, CYL_Z);
      r.box([0, .03, 1.08], [.39, .39, .14], C.rubber);
      r.box([0, -.34, .26], [.21, .43, .28], C.rubber, [-.26, 0, 0]);
      r.box([.18, -.52, .43], [.32, .52, .36], C.armor);
      r.box([-.2, -.4, -.45], [.34, .35, .34], C.rubber);
      r.box([0, .35, .11], [.19, .2, .4], accent, ZERO, .3);
      const flash = shot && age >= 0 && age < 80;
      if (flash) r.box([0, .3, -1.3], [.19, .28, .12], C.yellow, ZERO, 1, 1 - age / 80);
      return { muzzle: r.at([0, .3, -1.27]), flash, recoil };
    }
    armor(r, [0, .02, .08], [.51, .43, 1.28], C.gunmetal, C.bevel, .07);
    r.box([0, .25, -.03], [.32, .08, 1.3], C.dark);
    r.box([0, -.19, -.47], [.42, .15, .54], C.rubber, [.07, 0, 0]);
    // Open stock and angled pistol grip keep the outline readable in first person.
    r.box([0, .02, .85], [.29, .23, .42], C.gunmetal);
    r.box([0, .03, 1.08], [.39, .39, .14], C.rubber, [.06, 0, 0]);
    r.line([0, -.15, .49], [0, -.13, .98], C.steel, .065);
    r.box([0, -.34, .26], [.21, .43, .28], C.rubber, [-.26, 0, 0]);
    r.box([0, -.55, .2], [.26, .07, .27], C.gunmetal, [-.26, 0, 0]);
    r.line([0, -.23, .07], [0, -.39, -.04], C.bevel, .045);
    r.line([0, -.39, -.04], [0, -.37, -.25], C.bevel, .045);
    r.line([0, -.37, -.25], [0, -.17, -.25], C.bevel, .045);
    // Concentric barrel, a separate cooling sleeve and an inset bore.
    r.cylinder([0, .30, -.77], .105, .88, C.steel, CYL_Z);
    r.cylinder([0, .30, -.68], .158, .48, C.gunmetal, CYL_Z);
    r.cylinder([0, .30, -1.18], .135, .14, C.bevel, CYL_Z);
    r.cylinder([0, .30, -1.255], .079, .012, C.recess, CYL_Z);
    r.ring([0, .30, -1.265], .091, accent, ZERO, .017);
    for (let index = 0; index < 5; index += 1) {
      r.box([0, .13, -.35 - index * .115], [.45, .14, .033], C.dark);
    }
    // An actual tube sight, mounted above the receiver.
    r.box([0, .33, .14], [.20, .15, .21], C.bevel);
    r.cylinder([0, .47, .11], .118, .47, C.gunmetal, CYL_Z);
    r.ring([0, .47, -.135], .098, C.steel, ZERO, .02);
    r.cylinder([0, .47, -.14], .077, .009, accent, CYL_Z, .35, .48);
    r.box([-.27, .01, .15], [.06, .22, .43], C.dark);
    r.box([-.305, .02, .15], [.012, .09, .28], accent, ZERO, .65);
    r.box([.26, .11, -.12], [.015, .035, .56], accent, ZERO, .65);
    r.box([0, .299, .16], [.05, .014, .70], C.steel);
    for (const z of [-.40, .48]) for (const x of [-.21, .21]) {
      r.cylinder([x, .19, z], .024, .02, C.steel);
    }
    cable(r, [[.25, -.04, .5], [.32, -.18, .24], [.32, -.18, -.3], [.19, -.09, -.48]], C.orange, .035);
    r.label("R-07", [.272, .075, .33], [.24, .075], C.pale, [0, PI / 2, 0]);
    // Dominant hand encloses the angled pistol grip. Three separate rounded
    // fingers leave real seams; the wrist continues into a short armored arm.
    r.box([.12, -.37, .34], [.27, .29, .31], C.rubber, [-.26, 0, .08]);
    for (let finger = 0; finger < 3; finger += 1) {
      r.cylinder([.035, -.28 - finger * .065, .12], .039, .29, C.dark, CYL_X);
    }
    r.box([-.12, -.24, .30], [.085, .16, .20], C.rubber, [-.32, 0, -.18]);
    r.cylinder([.18, -.56, .44], .15, .16, C.dark, [.12, 0, -.22]);
    r.box([.28, -.79, .64], [.34, .50, .39], C.armor, [-.23, 0, .24]);
    r.box([.34, -.73, .82], [.32, .31, .10], C.bevel, [-.23, 0, .24]);
    // The support glove cups the lower handguard; everything stays below the
    // receiver so the sight, barrel and returned muzzle remain unobstructed.
    r.box([-.12, -.32, -.51], [.38, .19, .32], C.rubber, [.10, 0, -.10]);
    r.box([-.23, -.20, -.43], [.10, .22, .15], C.dark, [.12, 0, -.20]);
    r.box([-.27, -.60, -.31], [.34, .50, .38], C.armor, [.28, 0, -.28]);
    const muzzle = r.at([0, .30, -1.27]);
    const flash = shot && age >= 0 && age < 80;
    if (flash) {
      const strength = 1 - age / 80;
      r.cylinder([0, .30, -1.34], .12 + strength * .04, .14, C.yellow, CYL_Z, 1.2, .35 + strength * .4);
      r.box([0, .30, -1.39], [.065, .25 + strength * .22, .025], C.white, [0, 0, .35], 1, strength);
    }
    return { muzzle, flash, recoil };
  }

  /** Drone center remains pos. Hostile swept blades and twin guns contrast with
   * a friendly circular guard and physical white medical cross. */
  function drone(engine, pos, hostile, scale = 1, damaged = false, options = {}) {
    const hit = Boolean(options.resolved && options.hit);
    const fall = hit && !reduced(options) ? ease(resolvedAge(options) / 280) : 0;
    const r = rig(engine, [pos[0], pos[1] - .08 * fall, pos[2] - .22 * fall], scale, [.24 * fall, 0, -.1 * fall]);
    const accent = hostile ? C.red : C.blue;
    const lamp = damaged || hit ? C.recess : accent;
    if (lowDetail(engine)) {
      r.box([0, 0, 0], [.86, .5, .7], C.gunmetal);
      for (const side of [-1, 1]) {
        r.box([side * .8, .02, -.1], [.9, .12, .5], accent, [0, 0, hostile ? side * -.28 : 0]);
        if (hostile) r.cylinder([side * .31, -.25, .5], .08, .6, C.steel, CYL_Z);
      }
      r.box([0, .1, .4], [.42, .1, .04], lamp, ZERO, .8);
      if (!hostile) {
        r.box([0, -.025, .58], [.41, .12, .035], C.white);
        r.box([0, -.025, .61], [.12, .41, .035], C.white);
      }
      return;
    }
    r.shadow([0, -.8, 0], [2.5, 1.4], .18);
    armor(r, [0, 0, -.02], [.92, .54, .76], C.gunmetal, C.bevel, .11);
    armor(r, [0, .24, -.10], [.62, .18, .56], C.armor, C.steel, .04);
    r.box([0, .025, .40], [.55, .30, .15], C.dark, [.13, 0, 0]);
    r.box([0, .11, .49], [.42, .075, .035], lamp, ZERO, .8);
    r.box([0, .35, -.13], [.05, .025, .42], accent, ZERO, .5);
    r.cylinder([0, -.06, -.49], .22, .12, C.dark, CYL_Z);
    for (const side of [-1, 1]) {
      const x = side * .93;
      r.box([side * .55, -.04, -.09], [.46, .11, .29], C.steel, [0, 0, side * -.12]);
      r.cylinder([x, .02, -.1], .22, .68, C.gunmetal, CYL_Z);
      r.cylinder([x, .02, -.455], .17, .045, C.recess, CYL_Z);
      r.ring([x, .02, -.48], .175, C.bevel, ZERO, .035);
      r.cylinder([x, .02, -.49], .105, .012, lamp, CYL_Z, .7);
      r.ring([x, .02, .255], .21, C.steel, ZERO, .025);
      r.box([x, .24, -.12], [.29, .05, .51], C.armor);
      r.box([x, -.20, -.12], [.19, .04, .44], C.dark);
      r.cylinder([side * .34, .34, -.25], .025, .025, C.steel);
      r.cylinder([side * .34, .34, .10], .025, .025, C.steel);
      if (hostile) {
        r.box([side * .75, .10, -.15], [1.08, .09, .48], accent, [0, side * -.26, side * -.29]);
        r.box([side * 1.21, -.02, -.23], [.25, .07, .73], C.dark, [0, side * -.52, side * -.28]);
        r.box([side * 1.12, .11, -.08], [.045, .12, .57], C.orange, [0, side * -.35, side * -.29], .5);
        r.box([side * .31, -.28, .27], [.22, .19, .30], C.armor);
        r.cylinder([side * .31, -.28, .56], .073, .43, C.steel, CYL_Z);
        r.cylinder([side * .31, -.28, .79], .085, .075, C.dark, CYL_Z);
        r.ring([side * .31, -.28, .835], .061, C.orange, ZERO, .016);
        cable(r, [[side * .40, -.05, .05], [side * .53, -.24, .18], [side * .35, -.28, .40]], C.orange, .025);
      } else {
        r.box([side * .78, .04, -.10], [.67, .11, .55], C.blue, [0, side * -.12, 0]);
        r.box([side * 1.12, .04, -.10], [.08, .28, .48], C.pale, [0, 0, side * -.15]);
        r.cylinder([side * .60, -.25, .04], .135, .40, C.pale, CYL_Z);
        r.cylinder([side * .60, -.25, .255], .11, .025, C.blue, CYL_Z, .4);
        r.box([side * .61, -.18, .1], [.04, .04, .22], C.cyan, ZERO, .5);
        r.box([side * .79, .12, .20], [.32, .018, .07], C.white);
      }
    }
    r.line([.12, .33, -.26], [.16, .64, -.34], C.steel, .025);
    r.box([.16, .65, -.34], [.055, .055, .055], damaged ? C.dark : C.yellow, ZERO, .5);
    r.label(hostile ? "HX-9" : "MED-4", [0, -.08, .482], [.29, .075], C.pale);
    if (!hostile) {
      r.ring([0, -.025, .53], .68, C.steel, ZERO, .075);
      r.ring([0, -.025, .55], .57, C.cyan, ZERO, .018);
      r.cylinder([0, -.025, .55], .33, .035, C.blue, CYL_Z);
      r.box([0, -.025, .579], [.41, .12, .035], C.white, ZERO, .5);
      r.box([0, -.025, .60], [.12, .41, .035], C.white, ZERO, .5);
    }
  }

  /** pos is the original pick center [x,.38,z], not a floor anchor.
   * Relative bottom is -1.63, top .52. The front optics face +Z. */
  function turret(engine, pos, intrusion = false, selected = false, options = {}) {
    const base = rig(engine, pos);
    const hit = Boolean(options.resolved && options.hit);
    const fall = hit && !reduced(options) ? ease(resolvedAge(options) / 240) : 0;
    const r = rig(engine, [pos[0], pos[1] - .045 * fall, pos[2] - .12 * fall], 1, [.17 * fall, 0, .065 * fall]);
    const accent = intrusion ? C.red : C.cyan;
    if (lowDetail(engine)) {
      base.box([0, -1.05, 0], [.55, 1.15, .5], C.armor);
      r.box([0, -.3, 0], [.75, .65, .65], C.gunmetal);
      r.box([0, -.33, .4], [.32, .17, .08], hit ? C.recess : accent, ZERO, hit ? 0 : .8);
      if (intrusion) for (const side of [-1, 1]) r.box([side * .55, -.3, .25], [.2, .2, .7], C.red);
      if (selected) base.ring([0, -1.61, 0], .67, C.yellow, RING_XZ, .035);
      return;
    }
    base.shadow([0, -1.62, 0], [1.25, 1.15], .28);
    base.cylinder([0, -1.49, 0], .48, .24, C.gunmetal);
    base.cylinder([0, -1.32, 0], .37, .10, C.bevel);
    base.box([0, -1.53, 0], [1.02, .16, .30], C.armor);
    base.box([0, -1.53, 0], [.30, .16, .98], C.armor);
    base.cylinder([0, -.96, 0], .19, .62, C.steel);
    armor(r, [0, -.42, 0], [.76, .69, .65], C.gunmetal, C.bevel, .09);
    r.box([0, -.045, -.04], [.69, .08, .61], C.armor);
    for (const side of [-1, 1]) {
      r.box([side * .40, -.41, -.06], [.10, .43, .52], C.armor, [0, 0, side * -.07]);
      r.cylinder([side * .29, -.035, .18], .025, .018, C.steel);
    }
    r.cylinder([0, -.33, .36], .18, .12, C.dark, CYL_Z);
    r.cylinder([0, -.33, .428], .115, .025, hit ? C.recess : accent, CYL_Z, hit ? 0 : .8);
    r.box([0, -.12, .342], [.36, .035, .025], accent, ZERO, .6);
    r.line([.19, -.01, -.20], [.19, .45, -.20], C.steel, .025);
    r.box([.19, .48, -.20], [.08, .08, .08], intrusion ? C.orange : C.cyan, ZERO, .7);
    cable(r, [[-.21, -.72, -.30], [-.29, -.97, -.27], [-.18, -1.25, -.16]], C.dark, .065);
    if (intrusion) for (const side of [-1, 1]) {
      r.box([side * .49, -.37, .01], [.33, .16, .20], C.red, [0, 0, side * -.20]);
      r.cylinder([side * .64, -.38, .28], .077, .62, C.steel, CYL_Z);
      const flash = options.firing && resolvedAge(options) < 80;
      r.ring([side * .64, -.38, .606], .079, flash ? C.yellow : C.orange, ZERO, .022);
    }
    if (selected) base.ring([0, -1.61, 0], .67, C.yellow, RING_XZ, .036);
  }

  /** Mechanical shield lies in XY at [0,.05,0], radius 1.58.
   * Clear membrane has low alpha and never masks the incoming blade. */
  function shield(engine, options = {}) {
    const age = resolvedAge(options);
    const attempt = options.resolved && options.blockAttempt !== false;
    const impulse = attempt && age < 240 ? Math.sin(PI * clamp(age / 240, 0, 1)) : 0;
    const displacement = reduced(options) ? 0 : impulse;
    const r = rig(engine, [0, .05, .13 * displacement], 1, [.045 * displacement, 0, 0]);
    const accent = options.outcome === "success" ? C.cyan : options.outcome && options.outcome !== "idle" ? C.red : C.blue;
    if (lowDetail(engine)) {
      r.ring([0, 0, 0], 1.58, C.gunmetal, ZERO, .12);
      r.ring([0, 0, .07], 1.42, accent, ZERO, .04);
      for (const side of [-1, 1]) r.box([side * 1.46, -1.28, .7], [.43, .4, 1.05], C.armor);
      if (options.resolved && age < 180) r.ring([0, 0, .14], 1.5, accent, ZERO, .06, 1 - age / 180);
      return;
    }
    r.ring([0, 0, 0], 1.58, C.gunmetal, ZERO, .12);
    r.ring([0, 0, .07], 1.42, accent, ZERO, .038);
    for (let index = 0; index < 8; index += 1) {
      const angle = index * PI / 4;
      const x = Math.cos(angle) * 1.58, y = Math.sin(angle) * 1.58;
      r.box([x, y, .035], [.55, .21, .25], index % 2 ? C.armor : C.bevel, [0, 0, angle + PI / 2]);
      if (index % 2 === 0) {
        r.cylinder([x, y, .18], .055, .025, C.steel, CYL_Z);
        r.cylinder([x * .9, y * .9, .09], .105, .07, C.dark, CYL_Z);
        r.ring([x * .9, y * .9, .135], .073, accent, ZERO, .022);
      }
    }
    r.cylinder([0, 0, .025], 1.35, .018, accent, CYL_Z, .05, .045);
    for (const side of [-1, 1]) {
      r.box([side * 1.46, -1.28, .70], [.43, .40, 1.05], C.dark, [-.27, 0, side * .22]);
      r.box([side * 1.48, -1.13, .61], [.49, .17, .69], C.armor, [-.27, 0, side * .22]);
      r.box([side * 1.50, -1.04, .52], [.29, .045, .39], accent, [-.27, 0, side * .22], .3);
      r.cylinder([side * 1.28, -1.04, .25], .17, .34, C.rubber, [0, 0, side * .25]);
      r.line([side * 1.30, -1.03, .18], [side * 1.05, -.88, .07], C.steel, .10);
      cable(r, [[side * 1.52, -1.40, .91], [side * 1.72, -1.24, .45], [side * 1.45, -.86, .1]], accent, .035);
    }
    armor(r, [0, -1.46, .11], [.68, .23, .36], C.gunmetal, C.bevel, .04);
    r.box([0, -1.44, .302], [.30, .065, .025], accent, ZERO, .8);
    if (options.resolved && age < (reduced(options) ? 140 : 330)) {
      const progress = age / (reduced(options) ? 140 : 330);
      r.ring([0, 0, .14], 1.3 + (reduced(options) ? 0 : progress * .8), accent, ZERO, .045, 1 - progress);
      if (attempt) r.cylinder([0, 0, .09], 1.34, .012, accent, CYL_Z, .45, .16 * (1 - progress));
    }
  }

  /** The energy blade itself spans 2.7 units along local Y. The grip extends
   * below it; all parts share the original -0.38 rad Z lean around pos. */
  function blade(engine, pos, options = {}) {
    const r = rig(engine, pos, 1, [0, 0, -.38]);
    const accent = options.outcome === "miss" ? C.red : C.magenta;
    if (options.resolved && options.shattered) {
      const age = resolvedAge(options), still = reduced(options);
      const duration = still ? 180 : 430;
      if (age >= duration) return;
      const progress = age / duration;
      for (let index = 0; index < (lowDetail(engine) ? 2 : still ? 3 : 7); index += 1) {
        const side = index % 2 ? -1 : 1;
        const spread = still ? .04 : progress * (.15 + index * .07);
        r.box([side * spread, -.95 + index * (still ? .65 : .33) - (still ? 0 : progress * progress * .5), index % 3 * spread * .25],
          [.15, still ? .55 : .3, .17], index % 2 ? C.white : C.magenta,
          [still ? 0 : progress * side, 0, still ? 0 : progress * side * .8], .7, 1 - progress);
      }
      return;
    }
    if (lowDetail(engine)) {
      r.box([0, 0, 0], [.16, 2.7, .17], C.steel);
      r.box([0, 0, .1], [.08, 2.5, .04], accent, ZERO, .8);
      r.box([0, -1.14, 0], [.85, .16, .28], C.gunmetal);
      r.cylinder([0, -1.57, 0], .125, .7, C.rubber);
      return;
    }
    r.box([0, 0, 0], [.16, 2.70, .17], C.steel);
    r.box([0, -.15, .10], [.075, 2.27, .035], C.dark);
    for (const side of [-1, 1]) {
      r.box([side * .12, -.10, .015], [.073, 2.29, .19], accent, ZERO, .7);
      r.box([side * .095, 1.20, .01], [.075, .30, .18], C.white, [0, 0, side * -.20], .85);
      r.box([side * .285, -1.13, 0], [.55, .16, .28], C.gunmetal, [0, 0, side * -.18]);
      r.cylinder([side * .50, -1.08, .03], .065, .055, C.orange, CYL_Z, .3);
    }
    r.cylinder([0, -1.57, 0], .125, .70, C.rubber);
    for (let index = 0; index < 4; index += 1) r.ring([0, -1.36 - index * .13, 0], .127, C.bevel, RING_XZ, .018);
    r.cylinder([0, -1.96, 0], .155, .12, C.gunmetal);
    r.box([0, -1.12, .16], [.15, .105, .045], accent, ZERO, .7);
  }

  /** Industrial disarm console centered on the original table [0,0,0].
   * Bounds stay within x +/-2.8, z +/-2.4. LED text is drawn by the scene:
   * y=.63; x [-1.4,1.4], z [-1,.3] is deliberately unobstructed.
   * Until resolved, elapsed/now/concealed never drive a lamp or moving part.
   * The short post-result sequence reads only now minus resolvedAt. */
  function device(engine, options = {}) {
    const r = rig(engine);
    const resolved = Boolean(options.resolved);
    const success = resolved && options.outcome === "success";
    const still = reduced(options);
    const age = resolvedAge(options);
    const operated = resolved && options.disarmPressed !== false;
    const lever = operated ? still ? 1 : ease(age / 180) : 0;
    const unlock = success ? still ? 1 : ease(age / 260) : 0;
    const lamp = resolved ? .1 + .4 * (1 - clamp(age / 320, 0, 1)) : .45;
    const accent = resolved ? success ? C.green : C.red : C.cyan;
    if (lowDetail(engine)) {
      r.box([0, -.84, 0], [5.56, .43, 4.7], C.gunmetal);
      r.box([0, -.13, -.22], [3.84, 1, 2.94], C.armor);
      r.box([0, .535, -.35], [2.84, .1, 1.35], C.recess);
      r.box([1.05, -.38, 1.84], [1.38, .36, .83], C.dark);
      const handle = [1.05, .77 - .74 * lever, 1.84 + .33 * lever];
      r.line([1.05, -.06, 1.83], handle, C.steel, .12);
      r.cylinder(handle, .13, .94, resolved ? accent : C.red, CYL_X);
      for (const side of [-1, 1]) r.box([side * (1.66 + unlock * .16), .46, -1.55], [.48, .17, .3], accent, ZERO, lamp);
      if (!operated || lever < .65) r.line([1.9, -.08, -.6], [2.45, -.1, 1.5], C.yellow, .07);
      r.line([2.45, -.1, 1.5], [1.4, -.1, 1.9], C.yellow, .07);
      return;
    }
    r.shadow([0, -1.24, 0], [5.6, 4.7], .32);
    armor(r, [0, -.84, 0], [5.56, .43, 4.70], C.gunmetal, C.bevel, .10);
    armor(r, [0, -.13, -.22], [3.84, 1.0, 2.94], C.armor, C.bevel, .12);
    r.box([0, .42, -.22], [4.02, .12, 3.10], C.gunmetal);
    for (const side of [-1, 1]) {
      for (const end of [-1, 1]) {
        const x = side * 2.35, z = end * 1.88;
        r.box([x, -.46, z], [.44, .50, .43], C.dark, [0, side * end * .15, 0]);
        r.cylinder([x, -.13, z], .16, .20, C.bevel);
        r.cylinder([x, -.018, z], .067, .028, C.steel);
      }
      r.box([side * 2.04, -.02, -.24], [.33, .90, 2.50], C.dark);
      r.box([side * 2.04, .46, -.24], [.35, .08, 2.57], C.bevel);
      r.box([side * 2.04, .509, -.45], [.12, .016, .46], accent, ZERO, lamp);
      r.cylinder([side * 2.05, -.42, 1.35], .18, .23, C.armor);
      for (let index = 0; index < 4; index += 1) {
        r.box([side * 1.937, -.15, -.95 + index * .45], [.028, .51, .22], C.recess);
      }
      r.box([side * (1.66 + unlock * .16), .36 + unlock * .07, -1.55], [.48, .17, .30], C.bevel, [0, 0, side * (-.24 - unlock * .3)]);
      r.box([side * (1.66 + unlock * .16), .36 + unlock * .07, 1.08], [.48, .17, .30], C.bevel, [0, 0, side * (.24 + unlock * .3)]);
    }
    // A recessed display and four raised bezel rails surround, never cover,
    // the reserved LED area. Their front/back edges lie outside z [-1,.3].
    r.box([0, .535, -.35], [2.84, .10, 1.35], C.recess);
    r.box([-1.51, .57, -.35], [.15, .12, 1.65], C.bevel);
    r.box([1.51, .57, -.35], [.15, .12, 1.65], C.bevel);
    r.box([0, .57, -1.125], [3.16, .12, .15], C.bevel);
    r.box([0, .57, .425], [3.16, .12, .15], C.bevel);
    r.cylinder([0, .58, -1.63], .13, 1.80, C.dark, CYL_X);
    r.ring([-.92, .58, -1.63], .14, C.orange, RING_YZ, .033);
    r.ring([.92, .58, -1.63], .14, C.orange, RING_YZ, .033);
    r.box([-.40, .53, .84], [2.08, .12, .46], C.dark);
    for (let index = 0; index < 3; index += 1) {
      r.cylinder([-.98 + index * .56, .615, .84], .105, .07, index === 1 ? C.yellow : accent, ZERO, resolved ? lamp : .3);
    }
    // Hard-routed round cables, with actual supports and connectors.
    const wires = [
      [[1.91, -.08, -.61], [2.47, -.17, -.48], [2.55, -.17, 1.52], [1.71, -.12, 1.91], [1.43, -.12, 1.91]],
      [[1.91, -.15, .02], [2.20, -.28, .29], [2.25, -.28, 1.36], [1.53, -.22, 1.64], [.86, -.22, 1.84]],
    ];
    wires.forEach((points, index) => {
      const settled = points.map((point, pointIndex) => [point[0], point[1] - (pointIndex > 1 ? lever * .09 : 0), point[2]]);
      cable(r, settled, index ? C.magenta : C.yellow, .065, operated && lever > .65);
    });
    r.box([2.53, -.13, .41], [.18, .15, .16], C.steel);
    r.box([2.23, -.24, .83], [.17, .13, .17], C.steel);
    for (const z of [-.60, .02]) r.cylinder([1.95, -.115, z], .095, .12, C.dark, CYL_X);
    r.cylinder([1.43, -.12, 1.91], .105, .18, C.dark, CYL_X);
    r.cylinder([.86, -.22, 1.84], .105, .18, C.dark, CYL_X);
    // Hinged lever: the bearing axis is X; both rods lead to the same handle.
    r.box([1.05, -.38, 1.84], [1.38, .36, .83], C.dark);
    for (const side of [-1, 1]) r.cylinder([1.05 + side * .47, -.10, 1.83], .20, .18, C.bevel, CYL_X);
    r.cylinder([1.05, -.16, 1.83], .24, .13, C.rubber);
    const handle = [1.05, .77 - .74 * lever, 1.84 + .33 * lever];
    for (const side of [-1, 1]) r.line([1.05 + side * .12, -.06, 1.83], [handle[0] + side * .12, handle[1], handle[2]], C.steel, .09);
    r.cylinder(handle, .13, .94, resolved ? accent : C.red, CYL_X);
    for (const side of [-1, 0, 1]) r.ring([handle[0] + side * .24, handle[1], handle[2]], .133, C.dark, RING_YZ, .025);
    // Labels face the same plane as the console top, outside the number field.
    r.label("CORE / 06", [-.30, .50, -1.52], [1.25, .16], C.pale, [-PI / 2, 0, 0]);
    r.label(resolved ? success ? "SAFE" : "FAULT" : "ARMED", [-.53, .605, 1.13], [.62, .13], resolved ? accent : C.orange, [-PI / 2, 0, 0]);
    r.label("LOCK", [1.05, -.187, 2.268], [.45, .12], C.pale);
    if (success && age < (still ? 140 : 380)) {
      const progress = age / (still ? 140 : 380);
      r.ring([0, .66, -.35], 1.62 + (still ? 0 : progress * .7), C.green, RING_XZ, .045, 1 - progress);
    } else if (resolved && !success && age < (still ? 100 : 190)) {
      const progress = age / (still ? 100 : 190), length = still ? .12 : .12 + progress * .35;
      for (let index = 0; index < 4; index += 1) {
        const x = 1.9 + index * .13;
        r.line([x, .05, .55], [x + (index % 2 ? -length : length), .05 + length, .55 + length * .5], C.red, .035, 1 - progress);
      }
    }
  }

  window.StageModels3D = Object.freeze({ palette: C, weapon, drone, turret, device, shield, blade });
})();
