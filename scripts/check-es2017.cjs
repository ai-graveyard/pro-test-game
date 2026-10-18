"use strict";

// Node ships Acorn for its own tooling. No runtime or npm dependency is added.
const fs = require("node:fs");
let parser;
try { parser = require("internal/deps/acorn/acorn/dist/acorn"); }
catch (_) {
  console.error("ES2017 validation needs Node's bundled parser; run this script with node --expose-internals.");
  process.exit(1);
}
let failed = false;
for (const file of process.argv.slice(2)) {
  try { parser.parse(fs.readFileSync(file, "utf8"), { ecmaVersion: 2017, sourceType: "script" }); }
  catch (error) { console.error(`${file}: ES2017 parse failed: ${error.message}`); failed = true; }
}
if (failed) process.exit(1);
console.log(`ES2017 parse passed: ${process.argv.length - 2} classic scripts.`);
