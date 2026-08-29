import { readFile, readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const gameDir = path.join(root, "game");
const requiredFiles = ["index.html", "styles.css", "game.js"];
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
const css = await readFile(path.join(gameDir, "styles.css"), "utf8");
const js = await readFile(path.join(gameDir, "game.js"), "utf8");

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
];
for (const [pattern, message] of forbiddenHtml) {
  if (pattern.test(html)) errors.push(message);
}

const forbiddenCode = [
  [/\bfetch\s*\(/, "fetch"],
  [/\bXMLHttpRequest\b/, "XMLHttpRequest"],
  [/\b(?:WebSocket|EventSource|RTCPeerConnection)\s*\(/, "network communication API"],
  [/navigator\.(?:geolocation|clipboard|bluetooth|usb|hid|serial|serviceWorker)/, "restricted navigator API"],
  [/\b(?:Worker|SharedWorker)\s*\(/, "worker API"],
  [/\b(?:eval|Function)\s*\(/, "dynamic code execution"],
  [/\bWebAssembly\b/, "WebAssembly"],
  [/window\.(?:open|prompt)\s*\(/, "window.open/window.prompt"],
  [/\b(?:import|export)\s+/, "ES module syntax"],
];
for (const [pattern, name] of forbiddenCode) {
  if (pattern.test(js)) errors.push(`Restricted API or syntax found: ${name}.`);
}
if (/url\(\s*["']?https?:\/\//i.test(css)) errors.push("External CSS resources are not allowed.");

const bridgeCalls = [...js.matchAll(/miniTool\.([A-Za-z0-9_]+)\s*\(/g)].map((match) => match[1]);
const allowedBridgeCalls = new Set(["postNote", "saveImageToPhotosAlbum", "writeTempFile", "openRedPage"]);
for (const call of bridgeCalls) {
  if (!allowedBridgeCalls.has(call)) errors.push(`Unsupported miniTool bridge call: ${call}`);
}

const resourcePattern = /(?:src|href)=["']\.\/([^"'#?]+)["']/gi;
for (const match of html.matchAll(resourcePattern)) {
  if (!relativeFiles.includes(match[1])) errors.push(`Missing referenced resource: ${match[1]}`);
}

const syntax = spawnSync(process.execPath, ["--check", path.join(gameDir, "game.js")], {
  encoding: "utf8",
});
if (syntax.status !== 0) errors.push(syntax.stderr.trim() || "game.js failed syntax validation.");

if (errors.length > 0) {
  console.error("Validation failed:\n");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Validation passed: v${version}, ${relativeFiles.length} files in game/.`);
