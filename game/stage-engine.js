/* Local 3D drawing primitives. The game owns animation, clocks, and pointer input. */
(() => {
  "use strict";

  const CUBE_POINTS = [[-.5, -.5, -.5], [.5, -.5, -.5], [.5, .5, -.5], [-.5, .5, -.5], [-.5, -.5, .5], [.5, -.5, .5], [.5, .5, .5], [-.5, .5, .5]];
  const CUBE_FACES = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 4, 7, 3], [1, 2, 6, 5], [3, 7, 6, 2], [0, 1, 5, 4]];
  const KEY_LIGHT = unit([-.55, .85, .8]);
  const FILL_LIGHT = unit([.8, .3, -.65]);
  const COLOR_CACHE = new Map();
  const LABEL_CACHE = new Map();
  let labelBytes = 0;
  const PROFILES = {
    default: { dpr: 1.5, pixels: 2000000, textureSize: 2048, textureBytes: 64 * 1024 * 1024, draws: 100, triangles: 100000, fps: 30 },
    low: { dpr: 1, pixels: 1000000, textureSize: 1024, textureBytes: 32 * 1024 * 1024, draws: 50, triangles: 50000, fps: 24 },
  };
  const clockNow = () => typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
  const BEVEL = .065;

  function vector(value, fallback) { return fallback.map((part, i) => value && Number.isFinite(Number(value[i])) ? Number(value[i]) : part); }
  function sub(a, b) { return a.map((part, i) => part - b[i]); }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function unit(value) { const length = Math.hypot(...value); return length > .000001 ? value.map((part) => part / length) : [0, 0, 1]; }
  function clamp(value, low, high) { return Math.max(low, Math.min(high, value)); }
  function color(value) {
    const key = String(value || "#6d87aa");
    if (COLOR_CACHE.has(key)) return COLOR_CACHE.get(key);
    let hex = key.replace(/^#/, "");
    if (hex.length === 3) hex = hex.split("").map((part) => part + part).join("");
    if (!/^[a-f\d]{6}([a-f\d]{2})?$/i.test(hex)) hex = "6d87aa";
    const rgb = [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255);
    if (COLOR_CACHE.size > 256) COLOR_CACHE.clear();
    COLOR_CACHE.set(key, rgb);
    return rgb;
  }
  function multiply(a, b) {
    const out = new Float32Array(16);
    for (let col = 0; col < 4; col += 1) {
      for (let row = 0; row < 4; row += 1) out[col * 4 + row] = a[row] * b[col * 4] + a[row + 4] * b[col * 4 + 1] + a[row + 8] * b[col * 4 + 2] + a[row + 12] * b[col * 4 + 3];
    }
    return out;
  }
  function transform(matrix, point) {
    return [matrix[0] * point[0] + matrix[4] * point[1] + matrix[8] * point[2] + matrix[12], matrix[1] * point[0] + matrix[5] * point[1] + matrix[9] * point[2] + matrix[13], matrix[2] * point[0] + matrix[6] * point[1] + matrix[10] * point[2] + matrix[14]];
  }
  // Euler rotations apply X, then Y, then Z; sizes are full world dimensions.
  function model(position, size, rotation) {
    const [rx, ry, rz] = rotation, cx = Math.cos(rx), sx = Math.sin(rx), cy = Math.cos(ry), sy = Math.sin(ry), cz = Math.cos(rz), sz = Math.sin(rz);
    return new Float32Array([
      cz * cy * size[0], sz * cy * size[0], -sy * size[0], 0,
      (cz * sy * sx - sz * cx) * size[1], (sz * sy * sx + cz * cx) * size[1], cy * sx * size[1], 0,
      (cz * sy * cx + sz * sx) * size[2], (sz * sy * cx - cz * sx) * size[2], cy * cx * size[2], 0,
      ...position, 1,
    ]);
  }
  function cubeGeometry() {
    const positions = [], normals = [];
    CUBE_FACES.forEach(([a, b, c, d]) => {
      const normal = unit(cross(sub(CUBE_POINTS[b], CUBE_POINTS[a]), sub(CUBE_POINTS[c], CUBE_POINTS[a])));
      [a, b, c, a, c, d].forEach((index) => { positions.push(...CUBE_POINTS[index]); normals.push(...normal); });
    });
    return { positions, normals };
  }
  function beveledGeometry() {
    const faces = [], b = .5 - BEVEL;
    for (let axis = 0; axis < 3; axis += 1) {
      const u = (axis + 1) % 3, v = (axis + 2) % 3;
      for (const side of [-1, 1]) {
        const points = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([su, sv]) => {
          const p = [0, 0, 0]; p[axis] = side * .5; p[u] = su * b; p[v] = sv * b; return p;
        });
        faces.push(points);
      }
    }
    for (let axis = 0; axis < 3; axis += 1) {
      const u = (axis + 1) % 3, v = (axis + 2) % 3;
      for (const su of [-1, 1]) for (const sv of [-1, 1]) {
        const points = [[-b, .5, b], [b, .5, b], [b, b, .5], [-b, b, .5]].map(([along, pu, pv]) => {
          const p = [0, 0, 0]; p[axis] = along; p[u] = su * pu; p[v] = sv * pv; return p;
        });
        faces.push(points);
      }
    }
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
      faces.push([[sx * .5, sy * b, sz * b], [sx * b, sy * .5, sz * b], [sx * b, sy * b, sz * .5]]);
    }
    const positions = [], normals = [];
    faces.forEach((face) => {
      let n = unit(cross(sub(face[1], face[0]), sub(face[2], face[0])));
      const center = face.reduce((sum, p) => sum.map((part, i) => part + p[i] / face.length), [0, 0, 0]);
      if (dot(n, center) < 0) { face.reverse(); n = n.map((part) => -part); }
      for (let i = 1; i < face.length - 1; i += 1) [face[0], face[i], face[i + 1]].forEach((p) => { positions.push(...p); normals.push(...n); });
    });
    return { positions, normals, faces };
  }
  const BEVELED_BOX = beveledGeometry();
  function cylinderGeometry(count = 12) {
    const positions = [], normals = [], faces = [];
    const profile = [[.91, -.5], [1, -.44], [1, .44], [.91, .5]];
    const point = (angle, [radius, y]) => [Math.cos(angle) * radius, y, Math.sin(angle) * radius];
    function triangle(points, ns) { faces.push(points); points.forEach((p, i) => { positions.push(...p); normals.push(...ns[i]); }); }
    for (let i = 0; i < count; i += 1) {
      const a = i * Math.PI * 2 / count, b = (i + 1) * Math.PI * 2 / count;
      for (let j = 0; j < profile.length - 1; j += 1) {
        const slope = profile[j + 1][0] - profile[j][0], rise = profile[j + 1][1] - profile[j][1];
        const na = unit([Math.cos(a) * rise, -slope, Math.sin(a) * rise]), nb = unit([Math.cos(b) * rise, -slope, Math.sin(b) * rise]);
        const p = point(a, profile[j]), q = point(b, profile[j]), r = point(b, profile[j + 1]), s = point(a, profile[j + 1]);
        triangle([p, q, r], [na, nb, nb]); triangle([p, r, s], [na, nb, na]);
      }
      triangle([[0, -.5, 0], point(b, profile[0]), point(a, profile[0])], [[0, -1, 0], [0, -1, 0], [0, -1, 0]]);
      triangle([[0, .5, 0], point(a, profile[3]), point(b, profile[3])], [[0, 1, 0], [0, 1, 0], [0, 1, 0]]);
    }
    return { positions, normals, faces };
  }
  const CYLINDER = cylinderGeometry();
  function quadGeometry() {
    return { positions: [-.5, -.5, 0, .5, -.5, 0, .5, .5, 0, -.5, -.5, 0, .5, .5, 0, -.5, .5, 0], normals: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1] };
  }
  function bevelPoint(p, size, bevel) { return p.map((part, i) => Math.sign(part) * (size[i] * .5 - bevel + (Math.abs(part) > .49 ? bevel : 0))); }
  function rasterLabel(text, tint, aspect) {
    const key = `label:${text}:${tint}:${Math.round(aspect * 10)}`;
    if (LABEL_CACHE.has(key)) return LABEL_CACHE.get(key);
    const image = document.createElement("canvas");
    image.width = 512; image.height = clamp(2 ** Math.ceil(Math.log2(512 / Math.max(.4, aspect))), 64, 512);
    const pen = image.getContext("2d");
    if (pen) {
      const lines = String(text).slice(0, 256).split("\n").slice(0, 4);
      let fontSize = Math.min(image.height * .7 / lines.length, 96);
      const font = () => `700 ${fontSize}px ui-monospace, Menlo, Consolas, "PingFang SC", sans-serif`;
      pen.font = font();
      while (fontSize > 9 && lines.some((line) => pen.measureText(line).width > 472)) { fontSize -= 1; pen.font = font(); }
      pen.textAlign = "center"; pen.textBaseline = "middle"; pen.fillStyle = tint;
      lines.forEach((line, index) => pen.fillText(line, 256, image.height / 2 + (index - (lines.length - 1) / 2) * fontSize * 1.2));
    }
    const raster = { key, image, bytes: image.width * image.height * 4 };
    while (LABEL_CACHE.size && (LABEL_CACHE.size >= 64 || labelBytes + raster.bytes > 16 * 1024 * 1024)) {
      const oldest = LABEL_CACHE.keys().next().value;
      labelBytes -= LABEL_CACHE.get(oldest).bytes || 0;
      LABEL_CACHE.delete(oldest);
    }
    labelBytes += raster.bytes;
    LABEL_CACHE.set(key, raster); return raster;
  }
  function rasterShadow() {
    if (LABEL_CACHE.has("shadow")) return LABEL_CACHE.get("shadow");
    const image = document.createElement("canvas"); image.width = 128; image.height = 128;
    const pen = image.getContext("2d");
    if (pen) {
      const gradient = pen.createRadialGradient(64, 64, 5, 64, 64, 64);
      gradient.addColorStop(0, "rgba(0,0,0,.92)"); gradient.addColorStop(.35, "rgba(0,0,0,.62)"); gradient.addColorStop(1, "rgba(0,0,0,0)");
      pen.fillStyle = gradient; pen.fillRect(0, 0, 128, 128);
    }
    const raster = { key: "shadow", image, bytes: 128 * 128 * 4 }; labelBytes += raster.bytes; LABEL_CACHE.set("shadow", raster); return raster;
  }
  function ringGeometry(segments = 32, sides = 4) {
    const positions = [], normals = [];
    function sample(u, v) {
      const a = u * Math.PI * 2 / segments, b = v * Math.PI * 2 / sides;
      return { p: [Math.cos(a), Math.sin(a), 0], n: [Math.cos(a) * Math.cos(b), Math.sin(a) * Math.cos(b), Math.sin(b)] };
    }
    for (let i = 0; i < segments; i += 1) {
      for (let j = 0; j < sides; j += 1) {
        const a = sample(i, j), b = sample(i + 1, j), c = sample(i + 1, j + 1), d = sample(i, j + 1);
        [a, b, c, a, c, d].forEach((point) => { positions.push(...point.p); normals.push(...point.n); });
      }
    }
    return { positions, normals };
  }
  const VERTEX_SHADER = `
    attribute vec3 aPosition;
    attribute vec3 aNormal;
    attribute vec4 aInstance0;
    attribute vec4 aInstance1;
    attribute vec4 aInstance2;
    attribute vec4 aInstance3;
    attribute vec4 aInstanceSize;
    attribute vec4 aInstanceColor;
    uniform mat4 uModel;
    uniform mat4 uViewProjection;
    uniform float uShape;
    uniform float uRadius;
    uniform float uTube;
    uniform vec4 uDimensions;
    uniform vec3 uColor;
    uniform float uEmission;
    uniform float uInstanced;
    varying vec3 vNormal;
    varying vec3 vWorld;
    varying vec3 vColor;
    varying float vEmission;
    varying vec2 vUv;
    void main() {
      mat4 objectMatrix = uModel;
      vec4 dimensions = uDimensions;
      vColor = uColor; vEmission = uEmission;
      if (uInstanced > 0.5) {
        objectMatrix = mat4(aInstance0, aInstance1, aInstance2, aInstance3);
        dimensions = aInstanceSize; vColor = aInstanceColor.rgb; vEmission = aInstanceColor.a;
      }
      vec3 local = aPosition;
      if (uShape > 1.5) local = sign(aPosition) * (dimensions.xyz * 0.5 - dimensions.w) + step(vec3(0.49), abs(aPosition)) * sign(aPosition) * dimensions.w;
      else if (uShape > 0.5) local = aPosition * dimensions.x + aNormal * dimensions.y;
      vec4 world = objectMatrix * vec4(local, 1.0);
      mat3 normalMatrix = mat3(objectMatrix[0].xyz / max(dot(objectMatrix[0].xyz, objectMatrix[0].xyz), 0.000001), objectMatrix[1].xyz / max(dot(objectMatrix[1].xyz, objectMatrix[1].xyz), 0.000001), objectMatrix[2].xyz / max(dot(objectMatrix[2].xyz, objectMatrix[2].xyz), 0.000001));
      vNormal = normalize(normalMatrix * aNormal);
      vWorld = world.xyz;
      vUv = aPosition.xy + 0.5;
      gl_Position = uViewProjection * world;
    }
  `;
  const FRAGMENT_SHADER = `
    precision mediump float;
    uniform vec3 uEye;
    uniform float uAlpha;
    uniform float uMaterial;
    uniform sampler2D uTexture;
    varying vec3 vNormal;
    varying vec3 vWorld;
    varying vec3 vColor;
    varying float vEmission;
    varying vec2 vUv;
    vec3 film(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
    void main() {
      if (uMaterial > 0.5) {
        vec4 ink = texture2D(uTexture, vUv);
        if (ink.a < 0.005) discard;
        gl_FragColor = vec4(uMaterial > 1.5 ? vec3(0.0) : ink.rgb, ink.a * uAlpha);
        return;
      }
      vec3 normal = normalize(vNormal);
      vec3 eyeDirection = normalize(uEye - vWorld);
      vec3 keyDirection = normalize(vec3(-0.55, 0.85, 0.8));
      float key = max(dot(normal, keyDirection), 0.0);
      float fill = max(dot(normal, normalize(vec3(0.8, 0.3, -0.65))), 0.0);
      float rim = pow(1.0 - abs(dot(normal, eyeDirection)), 3.0);
      vec3 cell = fract(vWorld * vec3(71.37, 83.71, 79.13));
      float grain = fract(dot(cell, cell.yzx + vec3(0.37, 0.51, 0.19)));
      float roughness = 0.4 + grain * 0.2;
      float specular = pow(max(dot(normalize(keyDirection + eyeDirection), normal), 0.0), mix(76.0, 22.0, roughness));
      vec3 albedo = pow(vColor, vec3(2.2)) * (0.975 + grain * 0.05);
      vec3 surface = albedo * (0.22 + key * 1.1 + fill * 0.16);
      surface += albedo * vec3(0.12, 0.2, 0.34) * (1.0 - key);
      surface += vec3(0.09, 0.045, 0.025) * fill * (0.15 + albedo);
      surface += mix(vec3(0.08), albedo, 0.48) * specular * 1.6;
      surface += mix(albedo, vec3(0.2, 0.36, 0.5), 0.2) * rim * 0.12;
      surface += vColor * vEmission * 1.5;
      float fog = smoothstep(14.0, 70.0, distance(vWorld, uEye)) * 0.65;
      surface = mix(surface, vec3(0.003, 0.005, 0.012), fog);
      gl_FragColor = vec4(pow(film(surface), vec3(1.0 / 2.2)), uAlpha);
    }
  `;

  function create(container) {
    if (!container || typeof container.append !== "function") throw new TypeError("Stage3DEngine needs a stage container");
    let canvas = makeCanvas(), gl = null, context = null, program = null, meshes = {}, destroyed = false;
    let type = "canvas", frameOpen = false, commands = [], lastCompleteCommands = [];
    let width = 1, height = 1, dpr = 1, viewProjection = null, eye = [0, 2, 8], forward = [0, 0, -1], right = [1, 0, 0], up = [0, 1, 0], focal = 1;
    const buffers = [], uniforms = {}, attributes = {}, textures = new Map(), staticCache = new Map();
    let instancing = null, instanceBuffer = null, lowMeshes = {}, staticLayer = null;
    let quality = "default", fallbackReason = "", textureBytes = 0, gpuTextureSize = 2048;
    let frameStarted = 0, frameTime = 0, lastRenderedAt = -Infinity, lastSampleAt = 0, badFrames = 0, frames = 0;
    let frameMs = 0, averageFrameMs = 0, drawCalls = 0, triangleCount = 0, uploads = 0, uploadBytes = 0;
    let instanceData = new Float32Array(24 * 256), currentLayer = "scene", invalidated = true;
    container.append(canvas);

    function profile() { return PROFILES[quality === "default" ? "default" : "low"]; }
    function lowerQuality(reason) {
      fallbackReason = reason;
      badFrames = 0;
      if (quality === "default") quality = "low";
      else if (type === "webgl") activateFallback(reason);
      else if (quality === "low") quality = "minimal";
      else if (type === "canvas") activateDOM();
      if (gl) while (textureBytes > profile().textureBytes && textures.size > 1) {
        let oldest = textures.keys().next().value;
        if (oldest === "white") { const keep = textures.get(oldest); textures.delete(oldest); textures.set(oldest, keep); oldest = textures.keys().next().value; }
        const entry = textures.get(oldest); gl.deleteTexture(entry.texture); textureBytes -= entry.bytes; textures.delete(oldest);
      }
      resize();
    }
    function activateDOM() {
      quality = "minimal"; type = "dom"; context = null;
      if (!staticLayer) {
        staticLayer = document.createElement("div");
        staticLayer.setAttribute("aria-hidden", "true");
        staticLayer.style.cssText = "position:absolute;top:0;right:0;bottom:0;left:0;overflow:hidden;pointer-events:none;background:#101a29;";
        container.appendChild(staticLayer);
      }
      if (lastCompleteCommands.length) renderDOM(lastCompleteCommands);
    }
    function measureFrame() {
      frameMs = Math.max(0, clockNow() - frameStarted);
      averageFrameMs = frames ? averageFrameMs * .9 + frameMs * .1 : frameMs;
      const gap = lastSampleAt && frameTime > lastSampleAt ? frameTime - lastSampleAt : 0;
      lastSampleAt = frameTime;
      frames += 1;
      const cpuLimit = quality === "default" ? 24 : type === "webgl" ? 40 : 65;
      const intervalLimit = quality === "default" ? 48 : 75;
      const slow = averageFrameMs > cpuLimit || gap > intervalLimit && gap < 250;
      badFrames = frames > 4 && slow ? badFrames + 1 : Math.max(0, badFrames - 1);
      if (badFrames >= (quality === "default" ? 20 : 28)) lowerQuality("sustained-frame-time");
    }
    function onVisibility() { lastSampleAt = 0; lastRenderedAt = -Infinity; badFrames = 0; }
    document.addEventListener("visibilitychange", onVisibility);

    function makeCanvas() {
      const element = document.createElement("canvas");
      element.className = "stage-engine-canvas";
      element.setAttribute("aria-hidden", "true");
      element.style.cssText = "position:absolute;top:0;right:0;bottom:0;left:0;display:block;width:100%;height:100%;pointer-events:none;";
      return element;
    }
    function resize() {
      const bounds = container.getBoundingClientRect();
      width = Math.max(1, bounds.width); height = Math.max(1, bounds.height);
      const budget = profile();
      dpr = Math.min(window.devicePixelRatio || 1, budget.dpr, Math.sqrt(budget.pixels / (width * height)));
      const pixelWidth = Math.max(1, Math.floor(width * dpr)), pixelHeight = Math.max(1, Math.floor(height * dpr));
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) { canvas.width = pixelWidth; canvas.height = pixelHeight; }
      if (context) context.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (gl) gl.viewport(0, 0, pixelWidth, pixelHeight);
    }
    function setCamera(camera) {
      eye = vector(camera && camera.eye, [0, 2, 8]);
      const target = vector(camera && camera.target, [0, 0, 0]);
      const back = unit(sub(eye, target));
      right = unit(cross(Math.abs(back[1]) > .99 ? [0, 0, 1] : [0, 1, 0], back));
      up = cross(back, right);
      forward = back.map((part) => -part);
      const fov = clamp(Number(camera && camera.fov) || 45, 15, 120);
      const f = 1 / Math.tan(fov * Math.PI / 360), near = .04, far = 160;
      focal = height * .5 * f;
      const view = new Float32Array([right[0], up[0], back[0], 0, right[1], up[1], back[1], 0, right[2], up[2], back[2], 0, -dot(right, eye), -dot(up, eye), -dot(back, eye), 1]);
      const projection = new Float32Array([f / (width / height), 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, 2 * far * near / (near - far), 0]);
      viewProjection = multiply(projection, view);
    }
    function projectPoint(position) {
      const relative = sub(position, eye), depth = dot(relative, forward), scale = depth > .00001 ? focal / depth : 0;
      const x = width * .5 + dot(relative, right) * scale, y = height * .5 - dot(relative, up) * scale;
      return { x, y, depth, scale, visible: depth >= .04 && depth <= 160 && x >= 0 && x <= width && y >= 0 && y <= height };
    }
    function compile(kind, source) {
      const shader = gl.createShader(kind);
      gl.shaderSource(shader, source); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) { gl.deleteShader(shader); throw new Error("Stage shader unavailable"); }
      return shader;
    }
    function buildMesh(geometry) {
      const position = gl.createBuffer(), normal = gl.createBuffer();
      buffers.push(position, normal);
      gl.bindBuffer(gl.ARRAY_BUFFER, position); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(geometry.positions), gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, normal); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(geometry.normals), gl.STATIC_DRAW);
      return { position, normal, count: geometry.positions.length / 3 };
    }
    function disposeGL() {
      if (!gl || (typeof gl.isContextLost === "function" && gl.isContextLost())) return;
      buffers.forEach((buffer) => gl.deleteBuffer(buffer));
      textures.forEach((entry) => gl.deleteTexture(entry.texture)); textures.clear(); textureBytes = 0;
      if (program) gl.deleteProgram(program);
      buffers.length = 0;
      textures.clear(); textureBytes = 0; instancing = null; instanceBuffer = null;
    }
    function releaseGL() {
      if (!gl) return;
      const alreadyLost = typeof gl.isContextLost === "function" && gl.isContextLost();
      if (!alreadyLost) {
        disposeGL();
        // A run creates several short-lived stages. Release their drawing
        // contexts now rather than waiting for detached canvases to be collected.
        try {
          const extension = gl.getExtension("WEBGL_lose_context");
          if (extension && typeof extension.loseContext === "function") extension.loseContext();
        } catch (_) { /* Context collection remains the browser's fallback. */ }
      }
      buffers.length = 0;
      textures.clear(); textureBytes = 0; instancing = null; instanceBuffer = null;
    }
    function activateFallback(reason) {
      if (destroyed) return;
      fallbackReason = reason || fallbackReason || "webgl-unavailable";
      quality = quality === "minimal" ? "minimal" : "low";
      drawCalls = 0; triangleCount = 0;
      canvas.removeEventListener("webglcontextlost", onContextLost);
      if (gl) {
        const previous = canvas;
        releaseGL();
        canvas = makeCanvas();
        container.replaceChild(canvas, previous);
      }
      buffers.length = 0;
      gl = null; program = null; meshes = {}; lowMeshes = {}; type = "canvas";
      try { context = canvas.getContext("2d"); } catch (_) { context = null; }
      if (!context) {
        activateDOM();
      }
      resize();
      if (context) renderFallback(lastCompleteCommands.length ? lastCompleteCommands : commands);
    }
    function onContextLost(event) {
      event.preventDefault();
      // A new Canvas2D element can immediately redraw the last submitted cue.
      // This instance stays in fallback even if the detached GL context restores.
      activateFallback("webgl-context-lost");
    }
    function setupGL() {
      try { gl = canvas.getContext("webgl", { alpha: true, antialias: true, depth: true, powerPreference: "low-power", premultipliedAlpha: true }); }
      catch (_) { gl = null; }
      if (!gl) { activateFallback("webgl-context-unavailable"); return; }
      try {
        const vertex = compile(gl.VERTEX_SHADER, VERTEX_SHADER), fragment = compile(gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
        program = gl.createProgram(); gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
        gl.deleteShader(vertex); gl.deleteShader(fragment);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error("Stage renderer unavailable");
        attributes.position = gl.getAttribLocation(program, "aPosition"); attributes.normal = gl.getAttribLocation(program, "aNormal");
        ["Model", "ViewProjection", "Color", "Eye", "Emission", "Alpha", "Shape", "Radius", "Tube", "Dimensions", "Instanced", "Material", "Texture"].forEach((name) => { uniforms[name] = gl.getUniformLocation(program, `u${name}`); });
        ["Instance0", "Instance1", "Instance2", "Instance3", "InstanceSize", "InstanceColor"].forEach((name) => { attributes[name] = gl.getAttribLocation(program, `a${name}`); });
        meshes = { box: buildMesh(BEVELED_BOX), line: buildMesh(cubeGeometry()), ring: buildMesh(ringGeometry()), cylinder: buildMesh(CYLINDER), quad: buildMesh(quadGeometry()) };
        lowMeshes = { box: buildMesh(cubeGeometry()), line: meshes.line, ring: buildMesh(ringGeometry(16, 4)), cylinder: buildMesh(cylinderGeometry(8)), quad: meshes.quad };
        instancing = gl.getExtension("ANGLE_instanced_arrays");
        if (instancing && typeof instancing.drawArraysInstancedANGLE === "function") { instanceBuffer = gl.createBuffer(); buffers.push(instanceBuffer); }
        else { instancing = null; quality = "low"; fallbackReason = "instancing-unavailable-low-detail"; }
        gpuTextureSize = Math.min(2048, Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || 2048);
        const white = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, white);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        textures.set("white", { texture: white, bytes: 4, width: 1, height: 1 }); textureBytes = 4;
        gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.enable(gl.BLEND);
        gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.clearColor(0, 0, 0, 0); type = "webgl";
        canvas.addEventListener("webglcontextlost", onContextLost);
      } catch (_) { activateFallback("webgl-shader-or-setup-failed"); }
    }
    function textureFor(raster) {
      if (textures.has(raster.key)) return textures.get(raster.key).texture;
      const budget = profile(), edge = Math.min(budget.textureSize, gpuTextureSize);
      let image = raster.image;
      if (image.width > edge || image.height > edge) {
        const reduced = document.createElement("canvas"), ratio = Math.min(edge / image.width, edge / image.height);
        reduced.width = Math.max(1, Math.floor(image.width * ratio)); reduced.height = Math.max(1, Math.floor(image.height * ratio));
        const pen = reduced.getContext("2d");
        if (!pen) return null;
        pen.drawImage(image, 0, 0, reduced.width, reduced.height); image = reduced;
      }
      const bytes = image.width * image.height * 4;
      // Labels are decorative: upload at most two small textures per frame,
      // never a whole room of first-use text in one animation callback.
      if (uploads >= 2 || uploadBytes + bytes > 1024 * 1024 || bytes > budget.textureBytes) return null;
      while (textureBytes + bytes > budget.textureBytes && textures.size > 1) {
        let oldest = textures.keys().next().value;
        if (oldest === "white") { const keep = textures.get(oldest); textures.delete(oldest); textures.set(oldest, keep); oldest = textures.keys().next().value; }
        const entry = textures.get(oldest); gl.deleteTexture(entry.texture); textureBytes -= entry.bytes; textures.delete(oldest);
      }
      const texture = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      textures.set(raster.key, { texture, bytes, width: image.width, height: image.height }); textureBytes += bytes; uploads += 1; uploadBytes += bytes; return texture;
    }
    function bindMesh(mesh) {
      gl.bindBuffer(gl.ARRAY_BUFFER, mesh.position); gl.vertexAttribPointer(attributes.position, 3, gl.FLOAT, false, 0, 0); gl.enableVertexAttribArray(attributes.position);
      gl.bindBuffer(gl.ARRAY_BUFFER, mesh.normal); gl.vertexAttribPointer(attributes.normal, 3, gl.FLOAT, false, 0, 0); gl.enableVertexAttribArray(attributes.normal);
    }
    function shapeFor(command) { return command.kind === "box" ? 2 : command.kind === "ring" ? 1 : 0; }
    function meshFor(command) { return (quality === "default" ? meshes : lowMeshes)[command.raster ? "quad" : command.kind]; }
    function dimensionsFor(command) { return command.kind === "box" ? [...command.size, command.bevel] : command.kind === "ring" ? [command.radius, command.tube, 0, 0] : [1, 1, 1, 0]; }
    function drawGL(command) {
      if (!gl || destroyed) return;
      const mesh = meshFor(command);
      const texture = command.raster ? textureFor(command.raster) : null;
      if (!mesh || command.raster && !texture) return;
      gl.useProgram(program);
      bindMesh(mesh);
      gl.uniformMatrix4fv(uniforms.Model, false, command.matrix); gl.uniformMatrix4fv(uniforms.ViewProjection, false, viewProjection);
      gl.uniform3fv(uniforms.Color, command.color); gl.uniform3fv(uniforms.Eye, eye);
      gl.uniform1f(uniforms.Emission, command.emission); gl.uniform1f(uniforms.Alpha, command.alpha);
      gl.uniform1f(uniforms.Instanced, 0); gl.uniform1f(uniforms.Shape, shapeFor(command));
      gl.uniform4fv(uniforms.Dimensions, dimensionsFor(command));
      gl.uniform1f(uniforms.Material, command.kind === "shadow" ? 2 : command.raster ? 1 : 0);
      if (texture) { gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texture); gl.uniform1i(uniforms.Texture, 0); }
      gl.depthMask(!command.raster && command.alpha >= .99);
      gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
      drawCalls += 1; triangleCount += mesh.count / 3;
    }
    function drawBatch(group) {
      if (!instancing || group.length < 2) { group.forEach(drawGL); return; }
      if (instanceData.length < group.length * 24) instanceData = new Float32Array(group.length * 48);
      const data = instanceData.subarray(0, group.length * 24);
      group.forEach((command, index) => { data.set(command.matrix, index * 24); data.set(dimensionsFor(command), index * 24 + 16); data.set([...command.color, command.emission], index * 24 + 20); });
      const first = group[0], mesh = meshFor(first);
      gl.useProgram(program); bindMesh(mesh);
      gl.uniformMatrix4fv(uniforms.ViewProjection, false, viewProjection); gl.uniform3fv(uniforms.Eye, eye);
      gl.uniform1f(uniforms.Instanced, 1); gl.uniform1f(uniforms.Material, 0); gl.uniform1f(uniforms.Shape, shapeFor(first)); gl.uniform1f(uniforms.Alpha, 1);
      gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer); gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
      ["Instance0", "Instance1", "Instance2", "Instance3", "InstanceSize", "InstanceColor"].forEach((name, index) => {
        gl.enableVertexAttribArray(attributes[name]); gl.vertexAttribPointer(attributes[name], 4, gl.FLOAT, false, 96, index * 16); instancing.vertexAttribDivisorANGLE(attributes[name], 1);
      });
      gl.depthMask(true); instancing.drawArraysInstancedANGLE(gl.TRIANGLES, 0, mesh.count, group.length);
      drawCalls += 1; triangleCount += mesh.count / 3 * group.length;
      ["Instance0", "Instance1", "Instance2", "Instance3", "InstanceSize", "InstanceColor"].forEach((name) => { instancing.vertexAttribDivisorANGLE(attributes[name], 0); gl.disableVertexAttribArray(attributes[name]); });
      gl.uniform1f(uniforms.Instanced, 0);
    }
    function renderGL(list) {
      const groups = new Map(), transparent = [];
      const visible = list.filter((command) => {
        if (quality !== "default" && command.raster) return false;
        const point = projectPoint([command.matrix[12], command.matrix[13], command.matrix[14]]);
        const matrixScale = Math.max(Math.hypot(command.matrix[0], command.matrix[1], command.matrix[2]), Math.hypot(command.matrix[4], command.matrix[5], command.matrix[6]), Math.hypot(command.matrix[8], command.matrix[9], command.matrix[10]));
        const radius = command.size ? Math.hypot.apply(Math, command.size) * matrixScale / 2 : command.radius ? (command.radius + command.tube) * matrixScale : matrixScale * 1.5;
        if (point.depth + radius < .04 || point.depth - radius > (quality === "default" ? 160 : 85)) return false;
        if (point.depth <= radius) return true;
        const projectedRadius = focal * radius / Math.max(.04, point.depth - radius);
        return point.x + projectedRadius >= 0 && point.x - projectedRadius <= width && point.y + projectedRadius >= 0 && point.y - projectedRadius <= height;
      });
      visible.forEach((command) => {
        if (command.raster || command.alpha < .99) { transparent.push(command); return; }
        if (!groups.has(command.kind)) groups.set(command.kind, []);
        groups.get(command.kind).push(command);
      });
      const budget = profile();
      const plannedDraws = instancing ? groups.size + transparent.length : visible.length;
      const plannedTriangles = visible.reduce((sum, command) => sum + meshFor(command).count / 3, 0);
      if (plannedDraws > budget.draws || plannedTriangles > budget.triangles) {
        if (quality === "default") { lowerQuality("geometry-budget"); renderGL(list); return; }
        activateFallback("low-geometry-budget"); return;
      }
      groups.forEach(drawBatch);
      // Soft shadows lie on the floor and never write depth over interactive props.
      transparent.filter((command) => command.kind === "shadow").forEach(drawGL);
      transparent.filter((command) => command.kind !== "shadow").sort((a, b) => projectPoint([b.matrix[12], b.matrix[13], b.matrix[14]]).depth - projectPoint([a.matrix[12], a.matrix[13], a.matrix[14]]).depth).forEach(drawGL);
      gl.depthMask(true); gl.flush();
    }
    function submit(command) {
      if (destroyed || !frameOpen || command.alpha <= 0) return;
      command.layer = currentLayer;
      commands.push(command);
    }
    function shade(rgb, normal, emission) {
      const key = Math.max(0, dot(normal, KEY_LIGHT)), fill = Math.max(0, dot(normal, FILL_LIGHT));
      return rgb.map((part, i) => {
        const albedo = part ** 2.2;
        const light = albedo * (.22 + key * 1.1 + fill * .16) + albedo * [.12, .2, .34][i] * (1 - key) + [.09, .045, .025][i] * fill * (.15 + albedo) + part * emission * 1.5;
        const film = clamp(light * (2.51 * light + .03) / (light * (2.43 * light + .59) + .14), 0, 1);
        return Math.round(film ** (1 / 2.2) * 255);
      });
    }
    function css(rgb, alpha) { return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})`; }
    function clipNear(points) {
      const clipped = [];
      let previous = points[points.length - 1], previousDepth = dot(sub(previous, eye), forward) - .04;
      points.forEach((point) => {
        const depth = dot(sub(point, eye), forward) - .04;
        if ((depth >= 0) !== (previousDepth >= 0)) {
          const fraction = previousDepth / (previousDepth - depth);
          clipped.push(previous.map((part, i) => part + (point[i] - part) * fraction));
        }
        if (depth >= 0) clipped.push(point);
        previous = point; previousDepth = depth;
      });
      return clipped;
    }
    function renderFallback(list) {
      if (!context || destroyed) return;
      context.setTransform(dpr, 0, 0, dpr, 0, 0); context.clearRect(0, 0, width, height);
      const surfaces = [];
      list.forEach((command) => {
        if (quality !== "default" && command.raster) return;
        if (command.raster) {
          const points = [[-.5, -.5, 0], [.5, -.5, 0], [.5, .5, 0], [-.5, .5, 0]].map((point) => projectPoint(transform(command.matrix, point)));
          if (points.some((point) => point.depth < .04)) return;
          surfaces.push({ kind: "decal", points, depth: points.reduce((sum, point) => sum + point.depth, 0) / 4 - (command.kind === "shadow" ? .01 : 0), raster: command.raster, alpha: command.alpha });
        } else if (command.kind !== "ring") {
          let faces;
          if (command.kind === "cylinder") {
            faces = []; const count = quality === "default" ? 12 : 6, bottom = [], top = [];
            for (let i = 0; i < count; i += 1) { const a = i * Math.PI * 2 / count; bottom.push([Math.cos(a), -.5, Math.sin(a)]); top.push([Math.cos(a), .5, Math.sin(a)]); }
            for (let i = 0; i < count; i += 1) faces.push([bottom[i], top[i], top[(i + 1) % count], bottom[(i + 1) % count]]);
            faces.push(bottom, top.slice().reverse());
            faces = faces.map((face) => face.map((point) => transform(command.matrix, point)));
          } else if (quality === "default" && command.kind === "box" && projectPoint([command.matrix[12], command.matrix[13], command.matrix[14]]).scale * Math.max(...command.size) > 70) {
            faces = BEVELED_BOX.faces.map((face) => face.map((point) => transform(command.matrix, bevelPoint(point, command.size, command.bevel))));
          } else {
            const corners = CUBE_POINTS.map((point) => transform(command.matrix, command.kind === "box" ? point.map((part, i) => part * command.size[i]) : point));
            faces = CUBE_FACES.map((face) => face.map((index) => corners[index]));
          }
          faces.forEach((points) => {
            const normal = unit(cross(sub(points[1], points[0]), sub(points[2], points[0])));
            const center = [0, 1, 2].map((axis) => points.reduce((sum, point) => sum + point[axis], 0) / points.length);
            if (dot(normal, sub(eye, center)) <= 0) return;
            if (points.length !== 4) {
              const clipped = clipNear(points), projected = clipped.map(projectPoint);
              if (projected.length >= 3) surfaces.push({ kind: "face", points: projected, depth: projected.reduce((sum, point) => sum + point.depth, 0) / projected.length, tint: shade(command.color, normal, command.emission), alpha: command.alpha, edge: true });
              return;
            }
            const axisU = sub(points[1], points[0]), axisV = sub(points[3], points[0]), lengthU = Math.hypot(...axisU), lengthV = Math.hypot(...axisV);
            // Tile broad platforms before painter sorting so a distant prop is
            // not hidden by one enormous floor polygon's average depth.
            const tiled = lengthU * lengthV > 9;
            const tileLimit = quality === "default" ? 12 : quality === "minimal" ? 2 : 4;
            const tilesU = tiled ? Math.min(tileLimit, Math.ceil(lengthU / 1.4)) : 1;
            const tilesV = tiled ? Math.min(tileLimit, Math.ceil(lengthV / 1.4)) : 1;
            const at = (u, v) => points[0].map((part, i) => part + axisU[i] * u + axisV[i] * v);
            const tint = shade(command.color, normal, command.emission);
            for (let u = 0; u < tilesU; u += 1) {
              for (let v = 0; v < tilesV; v += 1) {
                const tile = [at(u / tilesU, v / tilesV), at((u + 1) / tilesU, v / tilesV), at((u + 1) / tilesU, (v + 1) / tilesV), at(u / tilesU, (v + 1) / tilesV)];
                const clipped = clipNear(tile);
                if (clipped.length < 3) continue;
                const projected = clipped.map(projectPoint);
                if (projected.every((point) => point.depth > 160)) continue;
                surfaces.push({ kind: "face", points: projected, depth: projected.reduce((sum, point) => sum + point.depth, 0) / projected.length, tint, alpha: command.alpha, edge: !tiled });
              }
            }
          });
        } else {
          const count = quality === "default" ? 48 : 16, points = [];
          for (let i = 0; i <= count; i += 1) {
            const angle = i / count * Math.PI * 2;
            points.push(projectPoint(transform(command.matrix, [Math.cos(angle) * command.radius, Math.sin(angle) * command.radius, 0])));
          }
          for (let i = 0; i < count; i += 1) {
            const a = points[i], b = points[i + 1];
            if (a.depth < .04 || b.depth < .04 || a.depth > 160 && b.depth > 160) continue;
            surfaces.push({ kind: "segment", points: [a, b], depth: (a.depth + b.depth) / 2, width: Math.max(.6, command.tube * (a.scale + b.scale)), tint: command.color.map((part) => Math.round(clamp(part * 1.3, 0, 1) * 255)), alpha: command.alpha });
          }
        }
      });
      surfaces.sort((a, b) => b.depth - a.depth);
      context.lineJoin = "round"; context.lineCap = "round";
      surfaces.forEach((surface) => {
        if (surface.kind === "decal") { drawRaster(surface); return; }
        context.beginPath(); context.moveTo(surface.points[0].x, surface.points[0].y);
        surface.points.slice(1).forEach((point) => context.lineTo(point.x, point.y));
        if (surface.kind === "face") {
          context.closePath(); context.fillStyle = css(surface.tint, surface.alpha); context.fill();
          context.lineWidth = surface.edge ? .45 : .65;
          context.strokeStyle = css(surface.edge ? surface.tint.map((part) => Math.round(part * .6)) : surface.tint, surface.alpha * (surface.edge ? .65 : 1)); context.stroke();
        } else { context.lineWidth = surface.width; context.strokeStyle = css(surface.tint, surface.alpha); context.stroke(); }
      });
    }
    function drawRaster(surface) {
      const image = surface.raster.image, uv = [[0, image.height], [image.width, image.height], [image.width, 0], [0, 0]];
      [[0, 1, 2], [0, 2, 3]].forEach((indices) => {
        const p = indices.map((i) => surface.points[i]), s = indices.map((i) => uv[i]);
        const determinant = s[0][0] * (s[1][1] - s[2][1]) + s[1][0] * (s[2][1] - s[0][1]) + s[2][0] * (s[0][1] - s[1][1]);
        const coefficients = (axis) => [
          (p[0][axis] * (s[1][1] - s[2][1]) + p[1][axis] * (s[2][1] - s[0][1]) + p[2][axis] * (s[0][1] - s[1][1])) / determinant,
          (p[0][axis] * (s[2][0] - s[1][0]) + p[1][axis] * (s[0][0] - s[2][0]) + p[2][axis] * (s[1][0] - s[0][0])) / determinant,
          (p[0][axis] * (s[1][0] * s[2][1] - s[2][0] * s[1][1]) + p[1][axis] * (s[2][0] * s[0][1] - s[0][0] * s[2][1]) + p[2][axis] * (s[0][0] * s[1][1] - s[1][0] * s[0][1])) / determinant,
        ];
        const x = coefficients("x"), y = coefficients("y");
        context.save(); context.globalAlpha = surface.alpha;
        context.beginPath(); context.moveTo(p[0].x, p[0].y); context.lineTo(p[1].x, p[1].y); context.lineTo(p[2].x, p[2].y); context.closePath(); context.clip();
        context.transform(x[0], y[0], x[1], y[1], x[2], y[2]); context.drawImage(image, 0, 0); context.restore();
      });
    }
    function renderDOM(list) {
      if (!staticLayer) return;
      while (staticLayer.firstChild) staticLayer.removeChild(staticLayer.firstChild);
      list.filter((command) => !command.raster).sort((a, b) => {
        if (a.layer !== b.layer) return a.layer === "environment" ? -1 : 1;
        return projectPoint([b.matrix[12], b.matrix[13], b.matrix[14]]).depth - projectPoint([a.matrix[12], a.matrix[13], a.matrix[14]]).depth;
      }).slice(0, 180).forEach((command) => {
        const center = projectPoint([command.matrix[12], command.matrix[13], command.matrix[14]]);
        if (center.depth < .04) return;
        const scale = Math.max(Math.hypot(command.matrix[0], command.matrix[1], command.matrix[2]), Math.hypot(command.matrix[4], command.matrix[5], command.matrix[6]), Math.hypot(command.matrix[8], command.matrix[9], command.matrix[10]));
        const size = command.size || [scale, scale, scale];
        const points = CUBE_POINTS.map((p) => projectPoint(transform(command.matrix, command.size ? p.map((v, i) => v * size[i]) : p)));
        let left = Math.min.apply(Math, points.map((p) => p.x)), top = Math.min.apply(Math, points.map((p) => p.y));
        let w = Math.max(2, Math.max.apply(Math, points.map((p) => p.x)) - left), h = Math.max(2, Math.max.apply(Math, points.map((p) => p.y)) - top);
        if (command.kind === "ring") { w = h = Math.max(3, center.scale * command.radius * 2); left = center.x - w / 2; top = center.y - h / 2; }
        if (left > width || top > height || left + w < 0 || top + h < 0) return;
        const node = document.createElement("div"), tint = css(shade(command.color, [0, 0, 1], command.emission), command.alpha);
        node.style.cssText = `position:absolute;left:${left}px;top:${top}px;width:${Math.min(width * 3, w)}px;height:${Math.min(height * 3, h)}px;box-sizing:border-box;` + (command.kind === "ring" ? `border:2px solid ${tint};border-radius:50%;` : `background:${tint};border:1px solid rgba(155,190,215,.18);`);
        staticLayer.appendChild(node);
      });
    }

    resize(); setCamera({}); setupGL();
    const engine = {
      get element() { return canvas; },
      get type() { return type; },
      getQuality() { return quality; },
      invalidate() { invalidated = true; },
      setLayer(value) { currentLayer = value === "environment" ? "environment" : "scene"; },
      drawStatic(key, draw) {
        const cacheKey = quality + ":" + key;
        if (staticCache.has(cacheKey)) {
          staticCache.get(cacheKey).forEach((command) => commands.push(command));
          return;
        }
        const start = commands.length;
        draw();
        if (staticCache.size >= 4) staticCache.delete(staticCache.keys().next().value);
        staticCache.set(cacheKey, commands.slice(start));
      },
      shouldRender(now, changed) {
        if (destroyed || document.hidden) return false;
        return invalidated || Boolean(changed) || now - lastRenderedAt >= 1000 / (quality === "minimal" ? 20 : profile().fps) - 1;
      },
      getDiagnostics() {
        let maxTextureEdge = 0;
        textures.forEach((entry) => { maxTextureEdge = Math.max(maxTextureEdge, entry.width || 0, entry.height || 0); });
        return { backend: type, quality, fallback: type !== "webgl", fallbackReason,
          dpr, pixels: canvas.width * canvas.height, width: canvas.width, height: canvas.height,
          drawCalls, triangles: triangleCount, textureBytes, textureCount: textures.size, maxTextureEdge, rasterCacheBytes: labelBytes,
          frameMs, averageFrameMs, frames, badFrames, instancing: Boolean(instancing),
          budget: Object.assign({}, profile()), textureUploadsThisFrame: uploads };
      },
      begin(camera, now) {
        if (destroyed || document.hidden) { frameOpen = false; return; }
        frameStarted = clockNow(); frameTime = Number.isFinite(now) ? now : frameStarted;
        drawCalls = 0; triangleCount = 0; uploads = 0; uploadBytes = 0; currentLayer = "scene";
        resize(); setCamera(camera || {}); commands = []; frameOpen = true;
        if (gl) { gl.depthMask(true); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); }
        else if (context) context.clearRect(0, 0, width, height);
      },
      box(position, size, colorHex, rotation = [0, 0, 0], emission = 0, alpha = 1) {
        const dimensions = vector(size, [1, 1, 1]);
        if (dimensions.some((part) => part <= 0)) return;
        submit({ kind: "box", matrix: model(vector(position, [0, 0, 0]), [1, 1, 1], vector(rotation, [0, 0, 0])), size: dimensions, bevel: Math.min(.065, Math.min(...dimensions) * .085), color: color(colorHex), emission: clamp(Number(emission) || 0, 0, 4), alpha: clamp(Number(alpha), 0, 1) });
      },
      ring(position, radius, colorHex, rotation = [0, 0, 0], tube = .035, alpha = 1) {
        if (!(radius > 0)) return;
        submit({ kind: "ring", matrix: model(vector(position, [0, 0, 0]), [1, 1, 1], vector(rotation, [0, 0, 0])), radius: Number(radius), tube: Math.max(.001, Number(tube) || .035), color: color(colorHex), emission: .75, alpha: clamp(Number(alpha), 0, 1) });
      },
      line(from, to, colorHex, lineWidth = .03, alpha = 1) {
        const a = vector(from, [0, 0, 0]), b = vector(to, [0, 0, 0]), delta = sub(b, a), length = Math.hypot(...delta);
        if (length < .00001) return;
        const z = unit(delta), x = unit(cross(Math.abs(z[1]) > .99 ? [1, 0, 0] : [0, 1, 0], z)), y = cross(z, x), thickness = Math.max(.001, Number(lineWidth) || .03);
        const center = a.map((part, i) => (part + b[i]) / 2);
        const matrix = new Float32Array([x[0] * thickness, x[1] * thickness, x[2] * thickness, 0, y[0] * thickness, y[1] * thickness, y[2] * thickness, 0, z[0] * length, z[1] * length, z[2] * length, 0, ...center, 1]);
        submit({ kind: "line", matrix, color: color(colorHex), emission: .75, alpha: clamp(Number(alpha), 0, 1) });
      },
      cylinder(position, radius, cylinderHeight, colorHex, rotation = [0, 0, 0], emission = 0, alpha = 1) {
        if (!(radius > 0) || !(cylinderHeight > 0)) return;
        submit({ kind: "cylinder", matrix: model(vector(position, [0, 0, 0]), [Number(radius), Number(cylinderHeight), Number(radius)], vector(rotation, [0, 0, 0])), color: color(colorHex), emission: clamp(Number(emission) || 0, 0, 4), alpha: clamp(Number(alpha), 0, 1) });
      },
      label(text, position, size = [2, .4], colorHex = "#a8bfd4", rotation = [0, 0, 0]) {
        if (quality !== "default") return;
        const dimensions = vector(size, [2, .4]);
        if (dimensions.some((part) => part <= 0) || !String(text).trim()) return;
        submit({ kind: "label", matrix: model(vector(position, [0, 0, 0]), [...dimensions, 1], vector(rotation, [0, 0, 0])), color: color(colorHex), emission: 0, alpha: 1, raster: rasterLabel(String(text), colorHex, dimensions[0] / dimensions[1]) });
      },
      shadow(position, size = [1, 1], alpha = .25) {
        if (quality !== "default") return;
        const dimensions = vector(size, [1, 1]), point = vector(position, [0, 0, 0]); point[1] += .006;
        if (dimensions.some((part) => part <= 0)) return;
        submit({ kind: "shadow", matrix: model(point, [...dimensions, 1], [-Math.PI / 2, 0, 0]), color: [0, 0, 0], emission: 0, alpha: clamp(Number(alpha), 0, 1), raster: rasterShadow() });
      },
      end() {
        if (destroyed || !frameOpen) return;
        frameOpen = false; lastCompleteCommands = commands.slice();
        if (type === "canvas") renderFallback(commands);
        else if (type === "dom") renderDOM(commands);
        else if (gl) renderGL(commands);
        lastRenderedAt = frameTime; invalidated = false; measureFrame();
      },
      project(position) {
        const point = projectPoint(vector(position, [0, 0, 0]));
        return { x: point.x, y: point.y, visible: point.visible, scale: point.scale };
      },
      destroy() {
        if (destroyed) return;
        destroyed = true; frameOpen = false;
        canvas.removeEventListener("webglcontextlost", onContextLost);
        document.removeEventListener("visibilitychange", onVisibility);
        releaseGL(); gl = null; context = null; program = null; meshes = {}; commands = []; lastCompleteCommands = []; staticCache.clear();
        canvas.remove(); if (staticLayer) staticLayer.remove();
      },
    };
    return engine;
  }
  window.Stage3DEngine = { create };
})();
