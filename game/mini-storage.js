/* Use the documented App 9.46+ Storage API; older environments keep local fallbacks. */
(function () {
  "use strict";
  var keys = ["pro-test-game-progress-1.4.0", "pro-test-game-sfx-muted-v1"];
  var cache = Object.create(null);
  var revisions = Object.create(null);
  var bridge = null;
  var mode = "pending";
  var queue = Promise.resolve();
  var failed = 0;
  var pending = 0;
  var migrated = 0;

  function scopedKey(key, scope) { return scope + ":" + key; }
  function browserStore(scope) {
    try { return scope === "session" ? window.sessionStorage : window.localStorage; }
    catch (_) { return null; }
  }
  function readBrowser(key, scope) {
    try { var store = browserStore(scope); return store ? store.getItem(key) : null; }
    catch (_) { return null; }
  }
  function timed(operation, fallback, delay) {
    return new Promise(function (resolve) {
      var settled = false;
      var timer = window.setTimeout(function () { settled = true; resolve(fallback); }, delay);
      Promise.resolve(operation).then(function (value) {
        if (settled) return;
        settled = true; window.clearTimeout(timer); resolve(value);
      }, function () {
        if (settled) return;
        settled = true; window.clearTimeout(timer); resolve(fallback);
      });
    });
  }
  function launchVersion(options) {
    return Math.floor((Number(options && options.miniToolEnv && options.miniToolEnv.buildVersion) || 0) / 1000);
  }
  function succeeded(result, method) {
    return Boolean(result && result.errMsg === method + ":ok");
  }
  function enqueueNative(method, options) {
    // The UI can time out, but this gate waits for the real write to settle.
    // Native writes cannot be cancelled; releasing this gate early permits stale overwrites.
    var operation = queue.then(function () {
      return bridge[method](options);
    }).then(function (result) {
      if (!succeeded(result, method)) throw new Error("Native storage operation failed");
      return result;
    });
    queue = operation.then(function () {}, function () {});
    return operation;
  }
  function chooseBridge() {
    var xhs = window.xhs;
    var miniTool = xhs && xhs.miniTool;
    if (!miniTool || typeof miniTool.getStorage !== "function" || typeof miniTool.setStorage !== "function" || typeof miniTool.removeStorage !== "function") return Promise.resolve(null);
    var version = launchVersion(xhs.launchOptions);
    if (version) return Promise.resolve(version >= 9460 ? miniTool : null);
    if (typeof miniTool.getLaunchOptions !== "function") return Promise.resolve(null);
    try {
      return timed(miniTool.getLaunchOptions(), null, 700).then(function (options) {
        return launchVersion(options) >= 9460 ? miniTool : null;
      });
    } catch (_) { return Promise.resolve(null); }
  }
  var ready = chooseBridge().then(function (selected) {
    bridge = selected;
    mode = bridge ? "native" : "browser";
    if (!bridge) return;
    return Promise.all(keys.map(function (key, index) {
      var scope = index === 0 ? "session" : "local";
      var operation;
      try { operation = bridge.getStorage({ key: key }); }
      catch (_) { operation = Promise.reject(new Error("Storage read unavailable")); }
      return timed(operation, null, 900).then(function (result) {
        if (!succeeded(result, "getStorage") || result.data !== null && typeof result.data !== "string") { failed += 1; return; }
        var entry = scopedKey(key, scope);
        if (revisions[entry]) return;
        cache[entry] = result.data;
        if (result.data !== null) return;
        // One-time migration: native data wins; never use this after a failed native read.
        var legacy = readBrowser(key, scope);
        if (legacy === null) return;
        cache[entry] = legacy;
        try {
          var migration = enqueueNative("setStorage", { key: key, data: legacy });
          return timed(migration, null, 900).then(function (saved) {
            if (!saved) { failed += 1; return; }
            migrated += 1;
            try { var store = browserStore(scope); if (store) store.removeItem(key); } catch (_) { /* Native remains authoritative. */ }
          });
        } catch (_) { failed += 1; }
      });
    }));
  }).then(function () { return mode; }, function () {
    // A native failure does not silently claim that a browser copy was persisted.
    failed += 1;
    mode = bridge ? "native" : "browser";
    return mode;
  });

  function getItem(key, scope) {
    scope = scope === "session" ? "session" : "local";
    var entry = scopedKey(key, scope);
    if (Object.prototype.hasOwnProperty.call(cache, entry)) return cache[entry];
    return mode === "browser" ? readBrowser(key, scope) : null;
  }
  function mutate(key, value, scope, remove) {
    scope = scope === "session" ? "session" : "local";
    var entry = scopedKey(key, scope);
    revisions[entry] = (revisions[entry] || 0) + 1;
    cache[entry] = remove ? null : String(value);
    if (mode === "browser") {
      try {
        var store = browserStore(scope);
        if (!store) throw new Error("Storage unavailable");
        if (remove) store.removeItem(key); else store.setItem(key, String(value));
        return Promise.resolve(true);
      } catch (_) { failed += 1; return Promise.resolve(false); }
    }
    pending += 1;
    var reportedFailure = false;
    function recordFailure() { if (!reportedFailure) { reportedFailure = true; failed += 1; } }
    var completed = false;
    var operation = ready.then(function () {
      if (!bridge) {
        var store = browserStore(scope);
        if (!store) throw new Error("Storage unavailable");
        if (remove) store.removeItem(key); else store.setItem(key, String(value));
        return true;
      }
      return enqueueNative(remove ? "removeStorage" : "setStorage", remove ? { key: key } : { key: key, data: String(value) });
    }).then(function () { completed = true; pending -= 1; return true; }, function () { completed = true; pending -= 1; recordFailure(); return false; });
    return timed(operation, false, 1200).then(function (saved) {
      if (!completed) recordFailure();
      return saved === true;
    });
  }
  window.MiniStorage = Object.freeze({
    ready: ready,
    getItem: getItem,
    setItem: function (key, value, scope) { return mutate(key, value, scope, false); },
    removeItem: function (key, scope) { return mutate(key, null, scope, true); },
    getState: function () { return { mode: mode, failed: failed, pending: pending, migrated: migrated }; }
  });
})();
