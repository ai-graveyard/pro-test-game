/* Chrome 61 layout baseline, enhanced by measured browser capabilities. */
(function () {
  "use strict";
  var root = document.documentElement;
  var probe = document.createElement("div");
  probe.style.cssText = "position:absolute;visibility:hidden;display:flex;flex-direction:column;row-gap:1px;";
  probe.appendChild(document.createElement("div"));
  probe.appendChild(document.createElement("div"));
  document.body.appendChild(probe);
  var flexGap = probe.scrollHeight === 1;
  probe.parentNode.removeChild(probe);
  root.classList.add(flexGap ? "supports-flex-gap" : "no-flex-gap");

  function updateHeight() {
    var viewport = window.visualViewport;
    var height = viewport && viewport.height > 0 ? viewport.height : window.innerHeight;
    if (height > 0) root.style.setProperty("--app-height", Math.round(height) + "px");
  }
  updateHeight();
  window.addEventListener("resize", updateHeight, { passive: true });
  window.addEventListener("orientationchange", updateHeight, { passive: true });
  if (window.visualViewport && typeof window.visualViewport.addEventListener === "function") {
    window.visualViewport.addEventListener("resize", updateHeight, { passive: true });
  }
})();
