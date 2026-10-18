import { readFile, readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const gameDir = path.join(root, "game");
const requiredFiles = ["index.html", "styles.css", "stage-styles.css", "impact-styles.css", "mini-compat.js", "mini-storage.js", "arena3d.js", "stage-engine.js", "stage-art.js", "stage-models.js", "stage-scenes.js", "game-audio.js", "impact-feedback.js", "game.js"];
const allowedExtensions = new Set([
  ".html", ".css", ".js", ".png", ".jpg", ".jpeg", ".gif", ".webp",
  ".svg", ".woff", ".woff2", ".json",
]);
const errors = [];

const version = (await readFile(path.join(root, "VERSION"), "utf8")).trim();
const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
if (packageJson.version !== version) {
  errors.push(`VERSION (${version}) and package.json (${packageJson.version}) do not match.`);
}

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const absolutePath = path.join(directory, entry.name);
    return entry.isDirectory() ? listFiles(absolutePath) : [absolutePath];
  }));
  return nested.flat();
}

const relativeFiles = (await listFiles(gameDir))
  .map((file) => path.relative(gameDir, file));

for (const file of requiredFiles) {
  if (!relativeFiles.includes(file)) errors.push(`Missing required game file: ${file}`);
}
for (const file of relativeFiles) {
  if (!allowedExtensions.has(path.extname(file).toLowerCase()) && file !== "README.md") {
    errors.push(`Unsupported file type in game/: ${file}`);
  }
}

const html = await readFile(path.join(gameDir, "index.html"), "utf8");
const cssFiles = relativeFiles.filter((file) => path.extname(file).toLowerCase() === ".css");
const scriptFiles = relativeFiles.filter((file) => path.extname(file).toLowerCase() === ".js");

const htmlRequirements = [
  [/<!doctype html>/i, "index.html must declare <!doctype html>."],
  [/<html[^>]+lang=["']zh-CN["']/i, "index.html must declare lang=\"zh-CN\"."],
  [/<meta[^>]+charset=["']?UTF-8/i, "index.html must declare UTF-8."],
  [/name=["']viewport["'][^>]+width=device-width/i, "viewport must include width=device-width."],
  [/name=["']viewport["'][^>]+initial-scale=1(?:\.0)?/i, "viewport must include initial-scale=1."],
  [/name=["']viewport["'][^>]+viewport-fit=cover/i, "viewport must include viewport-fit=cover."],
];
for (const [pattern, message] of htmlRequirements) {
  if (!pattern.test(html)) errors.push(message);
}

const forbiddenHtml = [
  [/<script(?![^>]+src=)[^>]*>/i, "Inline scripts are not allowed."],
  [/\son[a-z]+\s*=/i, "Inline event handlers are not allowed."],
  [/<script[^>]+type=["']module["']/i, "Module scripts are not supported."],
  [/<(?:base|iframe|object)\b/i, "base, iframe, and object elements are not allowed."],
  [/<meta[^>]+http-equiv=["']Content-Security-Policy["']/i, "The container owns the CSP."],
  [/(?:src|href)=["']https?:\/\//i, "External resources are not allowed."],
  [/\bjavascript\s*:/i, "javascript: URLs are not allowed."],
  [/<a\b[^>]*(?:\bdownload(?:\s|=|>)|target=["']_blank["'])/i, "Downloads and new-window links are not allowed."],
];
for (const [pattern, message] of forbiddenHtml) {
  if (pattern.test(html)) errors.push(message);
}

const forbiddenCode = [
  [/\bfetch\s*\(/, "fetch"],
  [/\bXMLHttpRequest\b/, "XMLHttpRequest"],
  [/\b(?:WebSocket|EventSource|RTCPeerConnection)\s*\(/, "network communication API"],
  [/navigator\.(?:geolocation|clipboard|bluetooth|usb|hid|serial|serviceWorker)/, "restricted navigator API"],
  [/navigator\.(?:getBattery|connection|credentials|locks)|navigator\.storage\.persist|navigator\.mediaDevices\.(?:enumerateDevices|getDisplayMedia)/, "restricted device API"],
  [/\b(?:Accelerometer|Gyroscope|Magnetometer|DeviceMotionEvent|DeviceOrientationEvent|PaymentRequest)\b/, "restricted sensor/payment API"],
  [/\b(?:requestFullscreen|webkitRequestFullscreen)\s*\(/, "fullscreen API"],
  [/\b(?:Worker|SharedWorker)\s*\(/, "worker API"],
  [/\b(?:eval|Function)\s*\(/, "dynamic code execution"],
  [/\bWebAssembly\b/, "WebAssembly"],
  [/window\.(?:open|prompt)\s*\(/, "window.open/window.prompt"],
  [/\b(?:import|export)\s+/, "ES module syntax"],
];
for (const file of cssFiles) {
  const css = await readFile(path.join(gameDir, file), "utf8");
  if (/url\(\s*["']?(?:https?:)?\/\/|@import\s+["'](?:https?:)?\/\//i.test(css)) errors.push(`${file}: external CSS resources are not allowed.`);
}

const allowedBridgeCalls = new Set(["postNote", "saveImageToPhotosAlbum", "writeTempFile", "getLaunchOptions", "getStorage", "setStorage", "removeStorage"]);
for (const file of scriptFiles) {
  const js = await readFile(path.join(gameDir, file), "utf8");
  for (const [pattern, name] of forbiddenCode) {
    if (pattern.test(js)) errors.push(`${file}: restricted API or syntax found: ${name}.`);
  }

  const bridgeCalls = [...js.matchAll(/(?:miniTool|bridge)\.([A-Za-z0-9_]+)\s*\(/g)].map((match) => match[1]);
  for (const call of bridgeCalls) {
    if (!allowedBridgeCalls.has(call)) errors.push(`${file}: unsupported miniTool bridge call: ${call}`);
  }

  const syntax = spawnSync(process.execPath, ["--check", path.join(gameDir, file)], {
    encoding: "utf8",
  });
  if (syntax.status !== 0) {
    errors.push(`${file}: ${syntax.stderr.trim() || "failed syntax validation."}`);
  }
}

const controller = await readFile(path.join(gameDir, "game.js"), "utf8");
if (!controller.includes(`const APP_VERSION = "${version}"`)) errors.push("The controller version differs from VERSION.");
const storage = await readFile(path.join(gameDir, "mini-storage.js"), "utf8");
if (!storage.includes(`"pro-test-game-progress-${version}"`)) errors.push("The native-storage preload key differs from VERSION.");

const resourcePattern = /(?:src|href)\s*=\s*["']([^"']+)["']/gi;
for (const match of html.matchAll(resourcePattern)) {
  const reference = match[1];
  if (reference === "data:,") continue; // Empty local favicon.
  if (!reference.startsWith("./")) { errors.push(`Resource must use a local relative path: ${reference}`); continue; }
  const file = reference.slice(2).split(/[?#]/)[0];
  if (!relativeFiles.includes(file)) errors.push(`Missing referenced resource: ${file}`);
}

const scripts = [...html.matchAll(/<script\b[^>]*\bsrc=["']\.\/([^"'?#]+)[^"']*["']/gi)].map(match => match[1]);
const expectedScripts = requiredFiles.filter(file => file.endsWith(".js"));
if (scripts.join(",") !== expectedScripts.join(",")) errors.push("Classic-script dependency order does not match the package manifest.");
const es2017 = spawnSync(process.execPath, ["--expose-internals", path.join(root, "scripts/check-es2017.cjs"), ...scriptFiles.map(file => path.join(gameDir, file))], { encoding: "utf8" });
if (es2017.status !== 0) errors.push(es2017.stderr.trim() || "ES2017 parser validation failed.");
else console.log(es2017.stdout.trim());
const storageCheck = spawnSync(process.execPath, [path.join(root, "scripts/check-storage.cjs")], { encoding: "utf8" });
if (storageCheck.status !== 0) errors.push(storageCheck.stderr.trim() || "Storage contract validation failed.");
else console.log(storageCheck.stdout.trim());

if (errors.length > 0) {
  console.error("Validation failed:\n");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Validation passed: v${version}, ${relativeFiles.length} files in game/.`);
