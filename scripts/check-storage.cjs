"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const source = fs.readFileSync(path.join(__dirname, "../game/mini-storage.js"), "utf8");
const progress = "pro-test-game-progress-1.4.0";
const preference = "pro-test-game-sfx-muted-v1";

async function fixture(options = {}) {
  const browser = { local: new Map(options.legacy || []), session: new Map() };
  const native = new Map(options.native || []);
  const calls = [];
  let browserReads = 0;
  let mutationTimers = 0;
  function storage(scope) {
    return {
      getItem(key) { browserReads += 1; if (options.blocked) throw Error("blocked"); return browser[scope].has(key) ? browser[scope].get(key) : null; },
      setItem(key, value) { if (options.blocked) throw Error("blocked"); browser[scope].set(key, value); },
      removeItem(key) { if (options.blocked) throw Error("blocked"); browser[scope].delete(key); }
    };
  }
  const bridge = {
    getLaunchOptions() { calls.push("launch"); return Promise.resolve({ miniToolEnv: { buildVersion: 9462004 } }); },
    getStorage({ key }) {
      calls.push("get:" + key);
      if (options.failNative) return Promise.reject(Error("native failed"));
      if (options.fulfilledFailure) return Promise.resolve({ errMsg: "getStorage:fail unavailable" });
      if (options.missingData) return Promise.resolve({ errMsg: "getStorage:ok" });
      return Promise.resolve({ errMsg: "getStorage:ok", data: native.has(key) ? native.get(key) : null });
    },
    setStorage({ key, data }) {
      calls.push("set:" + key);
      if (options.failNative) return Promise.reject(Error("native failed"));
      if (options.fulfilledFailure) return Promise.resolve({ errMsg: "setStorage:fail unavailable" });
      if (options.delayFirst && calls.filter(call => call.startsWith("set:")).length === 1) return new Promise(resolve => setTimeout(() => { native.set(key, data); resolve({ errMsg: "setStorage:ok" }); }, 35));
      native.set(key, data); return Promise.resolve({ errMsg: "setStorage:ok" });
    },
    removeStorage({ key }) { calls.push("remove:" + key); if (options.failNative) return Promise.reject(Error("native failed")); native.delete(key); return Promise.resolve({ errMsg: "removeStorage:ok" }); }
  };
  const timer = options.fastTimeout ? (fn, delay) => setTimeout(fn, delay === 1200 ? (++mutationTimers === 1 ? 5 : 80) : 5) : setTimeout;
  const window = { localStorage: storage("local"), sessionStorage: storage("session"), setTimeout: timer, clearTimeout };
  if (options.version !== undefined) window.xhs = { launchOptions: { miniToolEnv: { buildVersion: options.version } }, miniTool: bridge };
  vm.runInNewContext(source, { window, Promise, Error });
  await window.MiniStorage.ready;
  return { api: window.MiniStorage, browser, native, calls, reads: () => browserReads };
}

(async function () {
  const browser = await fixture();
  assert.equal(browser.api.getState().mode, "browser");
  assert.equal(await browser.api.setItem(progress, "{}", "session"), true);
  assert.equal(browser.browser.session.get(progress), "{}");
  assert.equal(await browser.api.removeItem(progress, "session"), true);
  assert.equal(browser.api.getItem(progress, "session"), null);

  const current = await fixture({ version: 9462004, native: [[progress, "{}"], [preference, "1"]], legacy: [[preference, "0"]] });
  assert.equal(current.api.getState().mode, "native");
  assert.equal(current.api.getItem(preference, "local"), "1");
  assert.equal(current.reads(), 0, "native values must take priority over browser copies");
  await Promise.all([current.api.setItem(progress, "first", "session"), current.api.removeItem(progress, "session"), current.api.setItem(progress, "last", "session")]);
  assert.equal(current.native.get(progress), "last", "queued writes must preserve ordering");
  assert.equal(current.api.getState().pending, 0);

  const old = await fixture({ version: 9459000 });
  assert.equal(old.api.getState().mode, "browser");
  assert.equal(old.calls.length, 0);
  const asynchronous = await fixture({ version: 0 });
  assert.equal(asynchronous.api.getState().mode, "native");
  assert.equal(asynchronous.calls[0], "launch");

  const failure = await fixture({ version: 9460001, failNative: true });
  assert.equal(failure.api.getState().mode, "native");
  assert.equal(await failure.api.setItem(preference, "1", "local"), false);
  assert.equal(failure.reads(), 0, "failed native reads must not silently switch storage backends");
  assert.equal(failure.browser.local.size, 0);
  assert.ok(failure.api.getState().failed >= 3);

  const migration = await fixture({ version: 9460001, legacy: [[preference, "1"]] });
  assert.equal(migration.api.getItem(preference, "local"), "1");
  assert.equal(migration.native.get(preference), "1");
  assert.equal(migration.browser.local.has(preference), false);
  assert.equal(migration.api.getState().migrated, 1);
  const fulfilledFailure = await fixture({ version: 9460001, fulfilledFailure: true, legacy: [[preference, "1"]] });
  assert.equal(fulfilledFailure.api.getState().migrated, 0);
  assert.equal(fulfilledFailure.reads(), 0);
  assert.equal(fulfilledFailure.browser.local.get(preference), "1");
  assert.equal(await fulfilledFailure.api.setItem(preference, "0", "local"), false);
  const missingData = await fixture({ version: 9460001, missingData: true, legacy: [[preference, "1"]] });
  assert.equal(missingData.api.getState().migrated, 0);
  assert.equal(missingData.reads(), 0);
  const delayed = await fixture({ version: 9460001, native: [[progress, "{}"], [preference, "1"]], fastTimeout: true, delayFirst: true });
  assert.equal(await delayed.api.setItem(preference, "first", "local"), false, "UI timeout must not release the native write gate");
  assert.equal(await delayed.api.setItem(preference, "last", "local"), true);
  assert.equal(delayed.native.get(preference), "last", "a late older write must not overwrite the newer value");
  const lateMigration = await fixture({ version: 9460001, legacy: [[preference, "1"]], fastTimeout: true, delayFirst: true });
  assert.equal(lateMigration.api.getState().migrated, 0);
  await lateMigration.api.setItem(preference, "0", "local");
  await new Promise(resolve => setTimeout(resolve, 45));
  assert.equal(lateMigration.native.get(preference), "0", "late migration must not overwrite a user preference");
  assert.equal(lateMigration.browser.local.get(preference), "1", "timed-out migration must retain its source copy");
  const blocked = await fixture({ blocked: true });
  assert.equal(blocked.api.getItem(preference, "local"), null);
  assert.equal(await blocked.api.setItem(preference, "1", "local"), false);
  console.log("Storage contract passed: native/legacy versions, async launch, write ordering, late writes/migration, failure responses, unavailable browser storage.");
})().catch(error => { console.error(error); process.exitCode = 1; });
