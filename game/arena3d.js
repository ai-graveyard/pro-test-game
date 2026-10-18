/* Offline, dependency-free WebGL scenery. Gameplay owns all clocks and input. */
(() => {
  "use strict";

  const PALETTE = {
    cyan: [0, 1, 1],
    magenta: [1, 0, 1],
    yellow: [1, 1, 0],
    pink: [1, 20 / 255, 147 / 255],
    blue: [0.09, 0.28, 1],
    violet: [0.42, 0.08, 1],
    ice: [0.72, 0.98, 1],
    red: [1, 0.11, 0.25],
    dim: [0.08, 0.06, 0.22],
  };
  const MODES = {
    home: { scale: 1, dim: 1, color: "cyan" },
    instruction: { scale: 0.86, dim: 0.8, color: "cyan" },
    reaction: { scale: 0.53, dim: 0.58, color: "cyan" },
    parry: { scale: 0.53, dim: 0.58, color: "yellow" },
    stroop: { scale: 0.53, dim: 0.58, color: "pink" },
    prediction: { scale: 0.53, dim: 0.58, color: "blue" },
    focus: { scale: 0.53, dim: 0.58, color: "pink" },
    timer: { scale: 0.53, dim: 0.58, color: "yellow" },
    result: { scale: 0.84, dim: 0.8, color: "cyan" },
  };
  const MODE_ALIASES = { timing: "parry", decision: "stroop", attention: "focus", pressure: "timer", round: "instruction" };
  const PROFILES = {
    default: { dpr: 1.5, pixels: 2000000, draws: 100, triangles: 100000 },
    low: { dpr: 1, pixels: 1000000, draws: 50, triangles: 50000 },
  };
  const clockNow = () => typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
  let instance = null;

  function identity() { return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]); }
  function multiply(a, b) {
    const out = new Float32Array(16);
    for (let col = 0; col < 4; col += 1) {
      for (let row = 0; row < 4; row += 1) {
        out[col * 4 + row] = a[row] * b[col * 4] + a[4 + row] * b[col * 4 + 1] + a[8 + row] * b[col * 4 + 2] + a[12 + row] * b[col * 4 + 3];
      }
    }
    return out;
  }
  function model(x = 0, y = 0, z = 0, sx = 1, sy = sx, sz = sx, rx = 0, ry = 0, rz = 0) {
    const cx = Math.cos(rx), tx = Math.sin(rx), cy = Math.cos(ry), ty = Math.sin(ry), cz = Math.cos(rz), tz = Math.sin(rz);
    const rotation = new Float32Array([
      cz * cy, tz * cy, -ty, 0,
      cz * ty * tx - tz * cx, tz * ty * tx + cz * cx, cy * tx, 0,
      cz * ty * cx + tz * tx, tz * ty * cx - cz * tx, cy * cx, 0,
      x, y, z, 1,
    ]);
    for (let i = 0; i < 3; i += 1) { rotation[i] *= sx; rotation[i + 4] *= sy; rotation[i + 8] *= sz; }
    return rotation;
  }
  function normalize(v) { const length = Math.hypot(...v) || 1; return v.map((part) => part / length); }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function subtract(a, b) { return a.map((part, i) => part - b[i]); }
  function view(eye, target) {
    const z = normalize(subtract(eye, target)), x = normalize(cross([0, 1, 0], z)), y = cross(z, x);
    return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -x.reduce((n, v, i) => n + v * eye[i], 0), -y.reduce((n, v, i) => n + v * eye[i], 0), -z.reduce((n, v, i) => n + v * eye[i], 0), 1]);
  }
  function perspective(aspect) {
    const f = 1 / Math.tan(Math.PI / 7), near = 0.1, far = 55;
    return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, 2 * far * near / (near - far), 0]);
  }
  function mix(a, b, amount) { return a.map((part, index) => part + (b[index] - part) * amount); }

  function triangles(faces) {
    const positions = [], normals = [];
    faces.forEach((face) => {
      const normal = normalize(cross(subtract(face[1], face[0]), subtract(face[2], face[0])));
      face.forEach((point) => { positions.push(...point); normals.push(...normal); });
    });
    return { positions, normals };
  }
  function cubeGeometry() {
    const p = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]];
    const faces = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 4, 7, 3], [1, 2, 6, 5], [3, 7, 6, 2], [0, 1, 5, 4]];
    return triangles(faces.reduce((all, face) => all.concat([[p[face[0]], p[face[1]], p[face[2]]], [p[face[0]], p[face[2]], p[face[3]]]]), []));
  }
  function coreGeometry() {
    const top = [0, 1.48, 0], bottom = [0, -1.48, 0];
    const upper = [], lower = [], faces = [];
    for (let i = 0; i < 4; i += 1) {
      const angle = Math.PI / 4 + i * Math.PI / 2;
      upper.push([Math.cos(angle), 0.25, Math.sin(angle)]);
      lower.push([Math.cos(angle), -0.25, Math.sin(angle)]);
    }
    for (let i = 0; i < 4; i += 1) {
      const next = (i + 1) % 4;
      faces.push([top, upper[next], upper[i]], [upper[i], upper[next], lower[next]], [upper[i], lower[next], lower[i]], [bottom, lower[i], lower[next]]);
    }
    return triangles(faces);
  }
  function torusGeometry(radius = 1, tube = 0.018, segments = 96, sides = 5) {
    const positions = [], normals = [];
    const sample = (u, v) => {
      const a = u * Math.PI * 2 / segments, b = v * Math.PI * 2 / sides;
      return { p: [(radius + tube * Math.cos(b)) * Math.cos(a), tube * Math.sin(b), (radius + tube * Math.cos(b)) * Math.sin(a)], n: [Math.cos(b) * Math.cos(a), Math.sin(b), Math.cos(b) * Math.sin(a)] };
    };
    for (let i = 0; i < segments; i += 1) {
      for (let j = 0; j < sides; j += 1) {
        const a = sample(i, j), b = sample(i + 1, j), c = sample(i + 1, j + 1), d = sample(i, j + 1);
        [a, b, c, a, c, d].forEach(({ p, n }) => { positions.push(...p); normals.push(...n); });
      }
    }
    return { positions, normals };
  }
  function gridGeometry() {
    const positions = [], normals = [];
    for (let i = -15; i <= 15; i += 1) {
      positions.push(i * 0.8, 0, -18, i * 0.8, 0, 8, -12, 0, i * 0.8, 12, 0, i * 0.8);
      for (let j = 0; j < 4; j += 1) normals.push(0, 1, 0);
    }
    return { positions, normals, lines: true };
  }
  function frameGeometry() {
    const positions = [], normals = [];
    const p = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]];
    [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]].forEach(([a, b]) => { positions.push(...p[a], ...p[b]); normals.push(0, 1, 0, 0, 1, 0); });
    return { positions, normals, lines: true };
  }
  function glowGeometry() {
    return triangles([[[-1, -1, 0], [1, -1, 0], [1, 1, 0]], [[-1, -1, 0], [1, 1, 0], [-1, 1, 0]]]);
  }
  function sparkGeometry() {
    const positions = [], normals = [];
    for (let i = 0; i < 24; i += 1) {
      const angle = i * 2.39996;
      const radius = 1.5 + (i % 5) * 0.21;
      positions.push(Math.cos(angle) * radius, Math.sin(angle * 1.7) * 1.65, Math.sin(angle) * 1.6 - 0.6);
      normals.push(0, 0, 1);
    }
    return { positions, normals, points: true };
  }

  const VERTEX_SHADER = `
    attribute vec3 aPosition;
    attribute vec3 aNormal;
    uniform mat4 uModel;
    uniform mat4 uViewProjection;
    uniform float uPointSize;
    varying vec3 vNormal;
    varying vec3 vWorld;
    varying vec2 vSurface;
    void main() {
      vec4 world = uModel * vec4(aPosition, 1.0);
      vWorld = world.xyz;
      vNormal = normalize(mat3(uModel) * aNormal);
      vSurface = aPosition.xy;
      gl_Position = uViewProjection * world;
      gl_PointSize = uPointSize;
    }
  `;
  const FRAGMENT_SHADER = `
    precision mediump float;
    uniform vec3 uColor;
    uniform float uEmission;
    uniform float uAlpha;
    uniform float uMaterial;
    uniform vec3 uEye;
    varying vec3 vNormal;
    varying vec3 vWorld;
    varying vec2 vSurface;
    void main() {
      if (uMaterial > 1.5) {
        vec2 coordinate = uMaterial > 2.5 ? vSurface : gl_PointCoord * 2.0 - 1.0;
        float radius = dot(coordinate, coordinate);
        if (radius > 1.0) discard;
        float falloff = pow(1.0 - radius, 2.7);
        gl_FragColor = vec4(uColor * (0.8 + falloff * 0.4), uAlpha * falloff);
        return;
      }
      vec3 normal = normalize(vNormal);
      vec3 eye = normalize(uEye - vWorld);
      vec3 keyDirection = normalize(vec3(-0.6, 1.0, 0.8));
      float key = max(dot(normal, keyDirection), 0.0);
      float fill = max(dot(normal, normalize(vec3(0.8, 0.3, -0.7))), 0.0);
      float rim = pow(1.0 - abs(dot(normal, eye)), 3.0);
      vec3 lit = uColor * (0.22 + key * 0.72 + fill * 0.18 + uEmission);
      lit += uColor * rim * 0.22;
      if (uMaterial > 0.5) {
        // Metallic facets catch independent cyan, magenta, and ultraviolet lights.
        float specular = pow(max(dot(reflect(-keyDirection, normal), eye), 0.0), 36.0);
        float etching = smoothstep(0.975, 1.0, fract(vWorld.y * 12.0 + vWorld.z * 1.4));
        lit = uColor * (0.26 + key * 0.42 + uEmission);
        lit += vec3(0.02, 0.82, 1.0) * key * 0.68;
        lit += vec3(1.0, 0.01, 0.8) * fill * 0.54;
        lit += vec3(0.23, 0.03, 0.7) * (1.0 - key) * 0.38;
        lit += vec3(0.62, 1.0, 1.0) * (specular * 0.9 + rim * 0.65 + etching * 0.12);
        lit *= 0.38 + uColor.b * 0.62;
      }
      float fog = smoothstep(8.0, 26.0, distance(vWorld, uEye));
      gl_FragColor = vec4(mix(lit, vec3(0.0196, 0.0196, 0.0314), fog), uAlpha * (1.0 - fog * 0.8));
    }
  `;

  function createFallback(container) {
    const fallback = document.createElement("div");
    fallback.className = "pro-arena-fallback";
    fallback.setAttribute("aria-hidden", "true");
    fallback.style.cssText = "position:absolute;top:0;right:0;bottom:0;left:0;overflow:hidden;pointer-events:none;background:radial-gradient(ellipse at 78% 46%,#280b3b 0%,#09091a 35%,#050508 74%);";
    const stage = document.createElement("div");
    stage.style.cssText = "position:absolute;left:66%;top:22%;width:19%;height:42%;isolation:isolate;";
    const crystal = document.createElement("div");
    crystal.style.cssText = "position:absolute;top:4%;right:15%;bottom:4%;left:15%;background:#124574;background:linear-gradient(135deg,#00b5bb,#173776 50%,#8e137f);background:conic-gradient(from 25deg,#00ffff,#123a9a 19%,#780cd5 47%,#192e8f 67%,#a5ffff 91%,#00ffff);clip-path:polygon(50% 0,100% 36%,100% 64%,50% 100%,0 64%,0 36%);filter:drop-shadow(0 0 22px rgba(0,255,255,0.502));transform:rotate(12deg);";
    const facet = document.createElement("div");
    facet.style.cssText = "position:absolute;top:4%;right:15%;bottom:4%;left:15%;background:linear-gradient(150deg,rgba(186,255,255,0.6),rgba(0,255,255,0.0196) 45%,rgba(255,0,255,0.4));clip-path:polygon(50% 0,50% 100%,0 64%,0 36%);transform:rotate(12deg);";
    const orbit = document.createElement("div");
    orbit.style.cssText = "position:absolute;top:32%;left:-36%;width:172%;height:35%;border:2px solid #ff00ff;border-radius:50%;transform:rotate(-24deg);box-shadow:0 0 12px rgba(255,0,255,0.5333),inset 0 0 10px rgba(255,0,255,0.2667);";
    const secondOrbit = document.createElement("div");
    secondOrbit.style.cssText = "position:absolute;top:25%;left:-22%;width:144%;height:49%;border:1px solid #00ffff;border-radius:50%;transform:rotate(41deg);box-shadow:0 0 10px rgba(0,255,255,0.4667);";
    const node = document.createElement("div");
    node.style.cssText = "position:absolute;top:27%;right:-16%;width:9px;height:9px;background:#ffff00;transform:rotate(45deg);box-shadow:0 0 15px #ffff00;";
    stage.append(orbit, crystal, facet, secondOrbit, node);
    const grid = document.createElement("div");
    grid.style.cssText = "position:absolute;left:-60%;right:-60%;top:56%;height:90%;border-top:1px solid rgba(255,0,255,0.3333);background:linear-gradient(rgba(255,0,255,0.1373) 1px,transparent 1px),linear-gradient(90deg,rgba(0,255,255,0.1373) 1px,transparent 1px);background-size:58px 58px;transform:perspective(330px) rotateX(57deg);transform-origin:center top;mask-image:linear-gradient(transparent,#000 32%,transparent 91%);";
    fallback.append(stage, grid);
    container.append(fallback);
    return fallback;
  }

  function createScene(container) {
    const fallback = createFallback(container);
    const canvas = document.createElement("canvas");
    canvas.className = "pro-arena-canvas";
    canvas.setAttribute("aria-hidden", "true");
    canvas.style.cssText = "position:absolute;top:0;right:0;bottom:0;left:0;width:100%;height:100%;display:block;pointer-events:none;";
    container.append(canvas);
    container.dataset.arenaEngine = "fallback";
    const media = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-reduced-motion: reduce)") : { matches: false };
    let gl = null;
    try {
      gl = canvas.getContext("webgl", { alpha: false, antialias: true, depth: true, powerPreference: "low-power", preserveDrawingBuffer: false });
    } catch (_) { /* Some WebViews throw when their GPU context is unavailable. */ }
    let program = null, meshes = {}, uniforms = {}, attributes = {}, frame = 0, observer = null;
    let width = 1, height = 1, destroyed = false, lost = false, ready = false, paused = false;
    let mode = "home", signal = "idle", signalStrength = 0, signalAt = 0;
    let pointer = { x: 0, y: 0 }, smoothPointer = { x: 0, y: 0 };
    let color = [...PALETTE.cyan], scale = 1, dim = 1, lastFrame = 0;
    const buffers = [];
    let quality = "default", fallbackReason = "", dpr = 1, drawCalls = 0, triangleCount = 0;
    let frames = 0, frameMs = 0, averageFrameMs = 0, badFrames = 0, lastSampleAt = 0;

    function budget() { return PROFILES[quality === "default" ? "default" : "low"]; }
    function staticFallback(reason) {
      quality = "static"; fallbackReason = reason; ready = false;
      drawCalls = 0; triangleCount = 0;
      if (frame) cancelAnimationFrame(frame);
      frame = 0; canvas.style.visibility = "hidden"; fallback.style.visibility = "visible";
      container.dataset.arenaEngine = "fallback";
      disposeBuffers();
    }

    function disposeBuffers() {
      if (!gl || lost) return;
      buffers.forEach((buffer) => gl.deleteBuffer(buffer));
      buffers.length = 0;
      if (program) gl.deleteProgram(program);
      program = null;
    }
    function compile(type, source) {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) { gl.deleteShader(shader); throw new Error("Arena shader unavailable"); }
      return shader;
    }
    function buildMesh(geometry) {
      const position = gl.createBuffer(), normal = gl.createBuffer();
      buffers.push(position, normal);
      gl.bindBuffer(gl.ARRAY_BUFFER, position);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(geometry.positions), gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, normal);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(geometry.normals), gl.STATIC_DRAW);
      return { position, normal, count: geometry.positions.length / 3, primitive: geometry.points ? gl.POINTS : geometry.lines ? gl.LINES : gl.TRIANGLES };
    }
    function setup() {
      if (destroyed) return;
      if (!gl) { staticFallback("webgl-context-unavailable"); return; }
      try {
        const vertex = compile(gl.VERTEX_SHADER, VERTEX_SHADER), fragment = compile(gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
        program = gl.createProgram();
        gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
        gl.deleteShader(vertex); gl.deleteShader(fragment);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error("Arena renderer unavailable");
        attributes = { position: gl.getAttribLocation(program, "aPosition"), normal: gl.getAttribLocation(program, "aNormal") };
        ["Model", "ViewProjection", "Color", "Emission", "Alpha", "Eye", "Material", "PointSize"].forEach((name) => { uniforms[name] = gl.getUniformLocation(program, `u${name}`); });
        meshes = { cube: buildMesh(cubeGeometry()), core: buildMesh(coreGeometry()), ring: buildMesh(torusGeometry()), grid: buildMesh(gridGeometry()), frame: buildMesh(frameGeometry()), glow: buildMesh(glowGeometry()), sparks: buildMesh(sparkGeometry()) };
        gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
        gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.clearColor(5 / 255, 5 / 255, 8 / 255, 1);
        ready = true;
        canvas.style.visibility = "visible";
        fallback.style.visibility = "hidden";
        container.dataset.arenaEngine = "webgl";
      } catch (_) {
        staticFallback("shader-or-setup-failed");
      }
    }
    function draw(mesh, matrix, tint, emission = 0, alpha = 1, material = 0, pointSize = 1) {
      if (!ready || quality === "low" && (mesh === meshes.frame || mesh === meshes.glow || mesh === meshes.sparks)) return;
      const triangles = mesh.primitive === gl.TRIANGLES ? mesh.count / 3 : 0;
      if (drawCalls + 1 > budget().draws || triangleCount + triangles > budget().triangles) { staticFallback("geometry-budget"); return; }
      gl.bindBuffer(gl.ARRAY_BUFFER, mesh.position);
      gl.vertexAttribPointer(attributes.position, 3, gl.FLOAT, false, 0, 0);
      gl.enableVertexAttribArray(attributes.position);
      gl.bindBuffer(gl.ARRAY_BUFFER, mesh.normal);
      gl.vertexAttribPointer(attributes.normal, 3, gl.FLOAT, false, 0, 0);
      gl.enableVertexAttribArray(attributes.normal);
      gl.uniformMatrix4fv(uniforms.Model, false, matrix);
      gl.uniform3fv(uniforms.Color, tint);
      gl.uniform1f(uniforms.Emission, emission);
      gl.uniform1f(uniforms.Alpha, alpha);
      gl.uniform1f(uniforms.Material, material);
      gl.uniform1f(uniforms.PointSize, pointSize);
      gl.drawArrays(mesh.primitive, 0, mesh.count);
      drawCalls += 1; triangleCount += triangles;
    }
    function render(now) {
      frame = 0;
      if (destroyed || lost || !ready || paused || document.hidden) return;
      // Cap scenery work at 30 fps; game measurements use their own clock.
      if (!media.matches && now - lastFrame < 1000 / (quality === "low" ? 24 : 30) - 1) { frame = requestAnimationFrame(render); return; }
      const started = clockNow(), gap = lastSampleAt ? now - lastSampleAt : 0;
      lastSampleAt = now; drawCalls = 0; triangleCount = 0;
      lastFrame = now;
      const time = media.matches ? 3.4 : now / 1000;
      const config = MODES[mode] || MODES.home;
      const blend = media.matches ? 1 : 0.075;
      let targetColor = PALETTE[config.color];
      if (signal === "danger" || signal === "miss" || signal === "red" || signal === "error") targetColor = PALETTE.red;
      if (signal === "go" || signal === "success" || signal === "green" || signal === "ready") targetColor = PALETTE.cyan;
      color = mix(color, targetColor, blend);
      scale += (config.scale - scale) * blend;
      dim += (config.dim - dim) * blend;
      smoothPointer.x += ((media.matches ? 0 : pointer.x) - smoothPointer.x) * 0.04;
      smoothPointer.y += ((media.matches ? 0 : pointer.y) - smoothPointer.y) * 0.04;
      const aspect = width / height, mobile = aspect < 0.85;
      const active = !["home", "instruction", "result"].includes(mode);
      const panel = mode === "instruction" || mode === "result";
      const eye = [smoothPointer.x * 0.32, 3.0 + smoothPointer.y * 0.2, mobile ? 12.8 : 9.6];
      const target = [0, mobile ? 0.45 : 0.25, 0];
      const projection = multiply(perspective(aspect), view(eye, target));
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.useProgram(program);
      gl.uniformMatrix4fv(uniforms.ViewProjection, false, projection);
      gl.uniform3fv(uniforms.Eye, eye);
      const pulse = media.matches ? 0 : signalStrength * Math.max(0, 1 - (now - signalAt) / 1000);
      const accent = color.map((v) => v * dim);
      const cyan = PALETTE.cyan.map((v) => v * dim);
      const magenta = PALETTE.magenta.map((v) => v * dim);
      const yellow = PALETTE.yellow.map((v) => v * dim);
      const violet = PALETTE.violet.map((v) => v * dim);
      // Perspective floor, nested arena rings, and edge architecture.
      draw(meshes.cube, model(0, -1.65, -3, 16, 0.025, 19), [0.032, 0.023, 0.075]);
      draw(meshes.grid, model(0, -1.6, -1), cyan, 0.42, 0.17);
      const coreX = mobile ? (active || panel ? 1.7 : 0) : (active || panel ? 3.8 : 2.6);
      const coreY = mobile ? (active || panel ? 1.3 : 0.6) : (active || panel ? 1.1 : 0.8);
      const coreZ = active || panel ? -2.0 : -0.15;
      const hover = media.matches ? 0 : Math.sin(time * 0.8) * 0.12;
      const spin = time * 0.22;
      draw(meshes.ring, model(coreX, -1.5, coreZ, 1.7, 1, 1.7), cyan, 1.15, 0.96);
      draw(meshes.ring, model(coreX, -1.49, coreZ, 2.0, 1, 2.0), magenta, 1.0, 0.8);
      draw(meshes.ring, model(coreX, -1.48, coreZ, 1.15, 1, 1.15), violet, 0.92, 0.7);
      draw(meshes.ring, model(coreX, -1.48, coreZ, 2.22, 1, 2.22), magenta, 0.48, 0.17);
      // Low plinths make the core visibly inhabit a three-dimensional space.
      draw(meshes.cube, model(coreX, -1.58, coreZ, 0.94, 0.11, 0.94, 0, Math.PI / 4, 0), [0.055, 0.03, 0.17], 0.25);
      draw(meshes.frame, model(coreX, -1.46, coreZ, 0.95, 0.012, 0.95, 0, Math.PI / 4, 0), cyan, 1.2, 0.95);
      draw(meshes.frame, model(coreX, -1.56, coreZ, 1.01, 0.045, 1.01, 0, Math.PI / 4, 0), magenta, 0.8, 0.52);
      for (let i = 0; i < 4; i += 1) {
        const angle = i * Math.PI / 2 + Math.PI / 4;
        draw(meshes.cube, model(coreX + Math.cos(angle) * 1.85, -1.47, coreZ + Math.sin(angle) * 1.85, 0.11, 0.016, 0.035, 0, -angle, 0), i === 1 ? yellow : magenta, 1.2, 0.9);
      }
      for (let i = 0; i < 10; i += 1) {
        const side = i % 2 ? 1 : -1, row = Math.floor(i / 2);
        const x = side * (4.0 + (row % 2) * 0.8), z = 2 - row * 2.8;
        const h = [0.4, 1.0, 0.65, 1.45, 0.52][row];
        const c = i === 8 ? yellow : side > 0 ? cyan : magenta;
        draw(meshes.cube, model(x, -1.55 + h / 2, z, 0.18, h / 2, 0.18, 0, 0.14 * side, 0), mix(c.map((v) => v * 0.11), [0.022, 0.016, 0.06], 0.4), 0.1);
        draw(meshes.frame, model(x, -1.55 + h / 2, z, 0.181, h / 2 + 0.005, 0.181, 0, 0.14 * side, 0), c, 0.6, 0.5);
        draw(meshes.cube, model(x, -1.55 + h, z, 0.183, 0.014, 0.183, 0, 0.14 * side, 0), c, 1.05, 0.95);
      }
      const size = scale * (mobile ? 0.82 : 0.9);
      const y = coreY + hover;
      // Local additive glows remain around the core, away from the copy column.
      gl.depthMask(false);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      draw(meshes.glow, model(coreX - size * 0.35, y + size * 0.25, coreZ - 0.8, size * 2.0, size * 1.7, 1), cyan, 0, 0.10, 3);
      draw(meshes.glow, model(coreX + size * 0.65, y - size * 0.1, coreZ - 0.7, size * 2.3, size * 1.9, 1), magenta, 0, 0.13, 3);
      for (let i = 0; i < 3; i += 1) {
        const angle = i * 2.094 + spin * 0.1;
        const beamHeight = 1.3 + i * 0.35;
        draw(meshes.cube, model(coreX + Math.cos(angle) * size * 1.1, -1.48 + beamHeight / 2, coreZ + Math.sin(angle) * size * 1.1, 0.009, beamHeight / 2, 0.009), i === 1 ? magenta : cyan, 1.5, 0.17);
      }
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(true);
      draw(meshes.core, model(coreX, y, coreZ, size, size, size, 0.06, spin, -0.12), PALETTE.blue.map((v) => v * dim), 0.15 + pulse * 0.55, 1, 1);
      // Independent neon circuits: the secondary orbit never inherits the cue hue.
      draw(meshes.ring, model(coreX, y, coreZ, size * 1.64, size * 1.64, size * 1.64, 0.3, spin * -0.35, -0.36), magenta, 1.38, 0.95);
      draw(meshes.ring, model(coreX, y, coreZ, size * 1.87, size * 1.87, size * 1.87, 1.13, spin * 0.28, 0.62), cyan, 1.05, 0.74);
      draw(meshes.ring, model(coreX, y, coreZ, size * 1.93, size * 1.93, size * 1.93, 0.12, spin * -0.3, -0.2), mix(violet, accent, 0.35), 0.95, 0.48);
      for (let i = 0; i < 5; i += 1) {
        const angle = time * (i % 2 ? -0.15 : 0.2) + i * 1.31;
        const orbit = (1.9 + (i % 2) * 0.24) * size;
        const satelliteX = coreX + Math.cos(angle) * orbit;
        const satelliteZ = coreZ + Math.sin(angle) * orbit;
        const satelliteY = y + Math.sin(angle * 1.4 + i) * size * 0.63;
        const c = i === 2 ? yellow : i % 2 ? cyan : magenta;
        draw(meshes.cube, model(satelliteX, satelliteY, satelliteZ, 0.07 * size, 0.07 * size, 0.07 * size, spin, spin + i, spin * 0.7), c, 1.3);
      }
      // Quiet suspended cubes and track markers add depth at the outer edges.
      for (let i = 0; i < 7; i += 1) {
        const x = (i % 2 ? -1 : 1) * (3.2 + (i % 3) * 0.8), z = -2 - i * 1.2;
        const yOffset = media.matches ? 0 : Math.sin(time * 0.35 + i) * 0.18;
        draw(meshes.frame, model(x, 0.2 + (i % 3) * 0.7 + yOffset, z, 0.11, 0.11, 0.11, spin * 0.4, i + spin * 0.3, 0.2), i === 3 ? magenta : x > 0 ? cyan : violet, 0.7, x > 0 ? 0.4 : 0.15);
      }
      gl.depthMask(false);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      draw(meshes.sparks, model(coreX, y, coreZ - 0.4, size, size, size, 0, spin * 0.12, 0), mix(cyan, PALETTE.ice, 0.16), 0, 0.48 * dim, 2, Math.min(canvas.width / width, 1.75) * 3);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(true);
      frameMs = Math.max(0, clockNow() - started);
      averageFrameMs = frames ? averageFrameMs * .9 + frameMs * .1 : frameMs;
      frames += 1;
      const slow = averageFrameMs > (quality === "default" ? 24 : 40) || gap > (quality === "default" ? 48 : 75) && gap < 250;
      badFrames = frames > 4 && slow ? badFrames + 1 : Math.max(0, badFrames - 1);
      if (badFrames >= (quality === "default" ? 20 : 28)) {
        badFrames = 0;
        if (quality === "default") { quality = "low"; fallbackReason = "sustained-frame-time"; resize(); }
        else staticFallback("sustained-low-frame-time");
      }
      if (!media.matches && ready && quality !== "static" && !frame) frame = requestAnimationFrame(render);
    }
    function requestRender() {
      if (ready && !destroyed && !lost && !paused && !frame && !document.hidden) frame = requestAnimationFrame(render);
    }
    function resize() {
      const bounds = container.getBoundingClientRect();
      width = Math.max(1, bounds.width); height = Math.max(1, bounds.height);
      const limits = budget();
      dpr = Math.min(window.devicePixelRatio || 1, limits.dpr, Math.sqrt(limits.pixels / (width * height)));
      canvas.width = Math.max(1, Math.floor(width * dpr)); canvas.height = Math.max(1, Math.floor(height * dpr));
      const small = width / height < 0.85, edge = mode !== "home";
      const shape = fallback.firstElementChild;
      shape.style.left = small ? (edge ? "76%" : "34%") : "66%";
      shape.style.top = small ? "36%" : "22%";
      shape.style.width = small ? "32%" : "19%";
      shape.style.height = small ? "24%" : "42%";
      requestRender();
    }
    function onPointer(event) {
      if (media.matches || event.pointerType === "touch") return;
      const bounds = container.getBoundingClientRect();
      pointer.x = Math.max(-1, Math.min(1, (event.clientX - bounds.left) / (bounds.width || 1) * 2 - 1));
      pointer.y = Math.max(-1, Math.min(1, (event.clientY - bounds.top) / (bounds.height || 1) * 2 - 1));
    }
    function onVisibility() {
      lastFrame = 0; lastSampleAt = 0; badFrames = 0;
      if (document.hidden && frame) { cancelAnimationFrame(frame); frame = 0; }
      else requestRender();
    }
    function onMotion() {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      requestRender();
    }
    function onLost(event) {
      event.preventDefault();
      lost = true; ready = false;
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      canvas.style.visibility = "hidden"; fallback.style.visibility = "visible";
      container.dataset.arenaEngine = "fallback";
      fallbackReason = "webgl-context-lost"; quality = "static";
      drawCalls = 0; triangleCount = 0;
    }
    function onRestored() { lost = false; buffers.length = 0; program = null; ready = false; canvas.style.visibility = "hidden"; fallback.style.visibility = "visible"; }
    function onLeave() { pointer = { x: 0, y: 0 }; }

    setup(); resize();
    if (typeof ResizeObserver === "function") { observer = new ResizeObserver(resize); observer.observe(container); }
    else window.addEventListener("resize", resize);
    window.addEventListener("pointermove", onPointer, { passive: true });
    document.addEventListener("pointerleave", onLeave);
    document.addEventListener("visibilitychange", onVisibility);
    if (media.addEventListener) media.addEventListener("change", onMotion);
    else if (typeof media.addListener === "function") media.addListener(onMotion);
    canvas.addEventListener("webglcontextlost", onLost);
    canvas.addEventListener("webglcontextrestored", onRestored);

    return {
      getDiagnostics() {
        return { backend: ready ? "webgl" : "dom", quality, fallback: !ready, fallbackReason, dpr,
          pixels: canvas.width * canvas.height, drawCalls, triangles: triangleCount,
          textureBytes: 0, textureCount: 0, maxTextureEdge: 0, frameMs, averageFrameMs, frames, badFrames, budget: Object.assign({}, budget()) };
      },
      setPaused(value) {
        paused = Boolean(value);
        if (paused && frame) { cancelAnimationFrame(frame); frame = 0; }
        if (!paused) requestRender();
      },
      setMode(value) {
        mode = MODE_ALIASES[value] || value;
        if (!MODES[mode]) mode = "home";
        signal = "idle"; signalStrength = 0;
        container.dataset.arenaMode = mode;
        resize();
      },
      setSignal(value) {
        signal = typeof value === "string" ? value : value && (value.state || value.type) || "idle";
        const intensity = typeof value === "object" && value ? Number(value.intensity) : NaN;
        signalStrength = signal === "idle" || signal === "wait" ? 0 : Number.isFinite(intensity) ? Math.max(0, Math.min(1, intensity)) : 0.65;
        signalAt = performance.now();
        container.dataset.arenaSignal = signal;
        requestRender();
      },
      destroy() {
        destroyed = true;
        if (frame) cancelAnimationFrame(frame);
        if (observer) observer.disconnect();
        window.removeEventListener("resize", resize);
        window.removeEventListener("pointermove", onPointer);
        document.removeEventListener("pointerleave", onLeave);
        document.removeEventListener("visibilitychange", onVisibility);
        if (media.removeEventListener) media.removeEventListener("change", onMotion);
        else if (typeof media.removeListener === "function") media.removeListener(onMotion);
        canvas.removeEventListener("webglcontextlost", onLost);
        canvas.removeEventListener("webglcontextrestored", onRestored);
        disposeBuffers();
        canvas.remove(); fallback.remove();
        delete container.dataset.arenaEngine; delete container.dataset.arenaMode; delete container.dataset.arenaSignal;
      },
    };
  }

  window.ProArena3D = {
    mount(container) {
      this.destroy();
      if (!container || !container.append) return null;
      instance = createScene(container);
      return instance;
    },
    setMode(mode) { if (instance) instance.setMode(mode); },
    setPaused(value) { if (instance) instance.setPaused(value); },
    setSignal(signal) { if (instance) instance.setSignal(signal); },
    getDiagnostics() { return instance ? instance.getDiagnostics() : null; },
    destroy() { if (instance) instance.destroy(); instance = null; },
  };
})();
