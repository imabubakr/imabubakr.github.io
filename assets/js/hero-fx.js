// Hero effects, PREVIEW (2026-10-11): the owner tries them before choosing.
// A picker bottom-right switches and replays them; ?hero=<mode> also works.
//   draw    the contours draw themselves like a plotter (index lines first), then
//           labels and the town label fade in, the sentence appears word by word
//   scan    a survey scan line sweeps across and reveals the map behind it
//   tilt    scrolling tilts the flat map back into 3D as you leave the hero
//   light   faint relief shading whose sun follows the mouse
//   accent  "all things spatial" gets a thin survey line drawn under it
//   draw+accent
// Reduced motion: no animation (the static hero stays as it is).
(function () {
  var root = document.documentElement;
  var hero = document.querySelector(".hero");
  var svg = hero && hero.querySelector("svg.topo");
  if (!hero || !svg) return;
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var de = root.lang === "de";
  var h1 = hero.querySelector("h1");
  var mapEls = [hero.querySelector(".hero-map"), hero.querySelector(".hero-places")];
  var MODES = ["none", "draw", "scan", "tilt", "light", "accent", "draw+accent"];
  var LABEL = de
    ? { title: "Startbereich (Vorschau)", none: "ohne", draw: "zeichnen", scan: "scan", tilt: "kippen", light: "licht", accent: "akzent", "draw+accent": "zeichnen+akzent", replay: "wiederholen ↺" }
    : { title: "Hero (preview)", none: "none", draw: "draw", scan: "scan", tilt: "tilt", light: "light", accent: "accent", "draw+accent": "draw+accent", replay: "replay ↺" };

  var mode = new URLSearchParams(location.search).get("hero");
  if (MODES.indexOf(mode) < 0) { try { mode = localStorage.getItem("hero-preview"); } catch (e) {} }
  if (MODES.indexOf(mode) < 0) mode = "draw+accent";
  var smooth = function (t) { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); };

  // -------------------------------------------------- words of the sentence --
  var words = [];
  (function splitWords() {
    var text = h1.textContent;
    var phrase = de ? "alles Räumliche" : "all things spatial";
    var at = text.indexOf(phrase);
    h1.textContent = "";
    var parts = at < 0 ? [[text, false]] : [[text.slice(0, at), false], [phrase, true], [text.slice(at + phrase.length), false]];
    parts.forEach(function (p) {
      var host = h1;
      if (p[1]) {
        host = document.createElement("span");
        host.className = "hfx-hl";
        h1.appendChild(host);
      }
      p[0].split(/(\s+)/).forEach(function (w) {
        if (!w) return;
        if (/^\s+$/.test(w)) { host.appendChild(document.createTextNode(w)); return; }
        var s = document.createElement("span");
        s.className = "hfx-w";
        s.textContent = w;
        host.appendChild(s);
        words.push(s);
      });
    });
  })();
  var hl = h1.querySelector(".hfx-hl");
  // the survey line under the phrase is drawn by CSS (.hfx-hl::after / ::before)

  // ------------------------------------------- split contours for drawing --
  // The contour paths use only M m L l H h V v; each subpath becomes its own
  // element so all lines can draw at once (a dash on one long path would draw
  // them one after another).
  function subpaths(d) {
    var tok = d.match(/[MmLlHhVv]|-?\d*\.?\d+(?:e-?\d+)?/g), out = [], cur = null, x = 0, y = 0, cmd = "M", i = 0;
    var num = function () { return parseFloat(tok[i++]); };
    while (i < tok.length) {
      if (/[A-Za-z]/.test(tok[i])) cmd = tok[i++];
      if (cmd === "M" || cmd === "m") {
        var nx = num(), ny = num();
        if (cmd === "m") { nx += x; ny += y; }
        x = nx; y = ny;
        cur = ["M" + x + " " + y]; out.push(cur);
        cmd = cmd === "m" ? "l" : "L";          // implicit lineto after moveto
      } else if (cmd === "L" || cmd === "l") {
        var lx = num(), ly = num();
        if (cmd === "l") { lx += x; ly += y; }
        x = lx; y = ly; cur.push("L" + x + " " + y);
      } else if (cmd === "H" || cmd === "h") {
        var hx = num(); x = cmd === "h" ? x + hx : hx; cur.push("L" + x + " " + y);
      } else if (cmd === "V" || cmd === "v") {
        var vy = num(); y = cmd === "v" ? y + vy : vy; cur.push("L" + x + " " + y);
      } else i++;
    }
    return out.map(function (c) { return c.join(""); });
  }
  var overlay = null;
  function buildOverlay() {
    if (overlay) return overlay;
    overlay = svg.cloneNode(false);
    overlay.setAttribute("class", "topo hfx-draw");
    ["topo-i", "topo-c"].forEach(function (cls, k) {
      var src = svg.querySelector("." + cls);
      if (!src) return;
      var g = document.createElementNS("http://www.w3.org/2000/svg", "g");
      g.setAttribute("class", cls);
      subpaths(src.getAttribute("d")).forEach(function (d, j) {
        var p = document.createElementNS("http://www.w3.org/2000/svg", "path");
        p.setAttribute("d", d);
        p.setAttribute("pathLength", "1");
        // index contours first, then the fine ones; a little random spread
        p.style.setProperty("--delay", (k * 0.45 + Math.random() * 0.5).toFixed(2) + "s");
        g.appendChild(p);
      });
      overlay.appendChild(g);
    });
    svg.parentNode.insertBefore(overlay, svg.nextSibling);
    return overlay;
  }

  // ------------------------------------------------------------- scan line --
  var scanLine = document.createElement("div");
  scanLine.className = "hfx-scan";
  scanLine.setAttribute("aria-hidden", "true");
  hero.appendChild(scanLine);

  // ------------------------------------------------------------ relief light --
  var light = null;
  function buildLight() {
    if (light) return light;
    var box = hero.querySelector(".map-box");
    var c = document.createElement("canvas");
    c.className = "hfx-light";
    c.width = 800; c.height = 400;
    box.insertBefore(c, box.firstChild);
    light = { canvas: c, ctx: c.getContext("2d"), dem: null, az: 315 };
    fetch(hero.dataset.topo + "hero-contours-dem.bin").then(function (r) { return r.arrayBuffer(); }).then(function (buf) {
      light.dem = new Int16Array(buf);   // 200 x 100 cells of 50 m
      paintLight();
    });
    return light;
  }
  function paintLight() {
    if (!light || !light.dem) return;
    var C = 200, R = 100, dem = light.dem, img = light.ctx.createImageData(C, R), d = img.data;
    var a = (light.az * Math.PI) / 180, alt = (38 * Math.PI) / 180, dark = root.dataset.theme === "dark" ||
      (!root.dataset.theme && window.matchMedia("(prefers-color-scheme: dark)").matches);
    for (var r = 0; r < R; r++) for (var c = 0; c < C; c++) {
      var z = function (rr, cc) { return dem[Math.min(R - 1, Math.max(0, rr)) * C + Math.min(C - 1, Math.max(0, cc))]; };
      var gx = (z(r, c + 1) - z(r, c - 1)) / 100 * 2.5, gy = (z(r + 1, c) - z(r - 1, c)) / 100 * 2.5;
      var slope = Math.atan(Math.hypot(gx, gy)), aspect = Math.atan2(-gx, gy);
      var hs = Math.sin(alt) * Math.cos(slope) + Math.cos(alt) * Math.sin(slope) * Math.cos(a - aspect);
      var k = (r * C + c) * 4, v = hs - 0.62;     // flat ground ~ neutral
      if (v < 0) { d[k] = d[k + 1] = d[k + 2] = 0; d[k + 3] = Math.min(255, -v * (dark ? 260 : 170)); }
      else { d[k] = d[k + 1] = d[k + 2] = 255; d[k + 3] = Math.min(255, v * (dark ? 90 : 140)); }
    }
    var tmp = document.createElement("canvas"); tmp.width = C; tmp.height = R;
    tmp.getContext("2d").putImageData(img, 0, 0);
    light.ctx.imageSmoothingQuality = "high";
    light.ctx.clearRect(0, 0, 800, 400);
    light.ctx.drawImage(tmp, 0, 0, 800, 400);
  }
  var lightQueued = false;
  hero.addEventListener("pointermove", function (e) {
    if (!light || mode !== "light") return;
    var b = hero.getBoundingClientRect();
    // the sun sits where the pointer is, seen from the map centre
    light.az = (Math.atan2((e.clientX - b.left) / b.width - 0.5, -((e.clientY - b.top) / b.height - 0.5)) * 180) / Math.PI;
    if (!lightQueued) { lightQueued = true; requestAnimationFrame(function () { lightQueued = false; paintLight(); }); }
  });

  // ------------------------------------------------------------------ tilt --
  function onScroll() {
    var p = mode === "tilt" ? Math.min(1, Math.max(0, window.scrollY / (hero.offsetHeight * 0.9))) : 0;
    mapEls.forEach(function (el) {
      if (!el) return;
      el.style.transform = p ? "perspective(1100px) rotateX(" + (58 * smooth(p)).toFixed(2) + "deg) scale(" + (1 + 0.12 * p).toFixed(3) + ")" : "";
      el.style.opacity = p ? String(1 - 0.75 * smooth(p)) : "";
    });
  }
  window.addEventListener("scroll", onScroll, { passive: true });

  // ------------------------------------------------------------------ play --
  var timers = [];
  function reset() {
    timers.forEach(clearTimeout); timers = [];
    root.classList.remove("hfx-drawing", "hfx-drawn", "hfx-scanning", "hfx-words", "hfx-words-in", "hfx-ul-on", "hfx-light-on");
    if (overlay) overlay.remove(), (overlay = null);
    scanLine.style.left = "";
    hero.style.removeProperty("--scan");
    onScroll();
  }
  function wordsIn(delay) {
    root.classList.add("hfx-words");
    words.forEach(function (w, i) { w.style.transitionDelay = (delay + i * 0.06).toFixed(2) + "s"; });
    timers.push(setTimeout(function () { root.classList.add("hfx-words-in"); }, 30));
  }
  function play() {
    reset();
    if (reduce) return;
    var m = mode;
    if (m === "draw" || m === "draw+accent") {
      buildOverlay();
      root.classList.add("hfx-drawing");
      void overlay.getBoundingClientRect();
      timers.push(setTimeout(function () { root.classList.add("hfx-drawn"); }, 40));
      timers.push(setTimeout(function () {             // hand over to the real map (tools keep working)
        root.classList.remove("hfx-drawing", "hfx-drawn");
        if (overlay) overlay.remove(), (overlay = null);
      }, 3400));
      wordsIn(1.6);
      if (m === "draw+accent") timers.push(setTimeout(function () { root.classList.add("hfx-ul-on"); }, 3100));
    } else if (m === "scan") {
      root.classList.add("hfx-scanning");
      var t0 = performance.now();
      (function step(now) {
        var t = (now - t0) / 2400, x = -6 + 112 * smooth(t);
        hero.style.setProperty("--scan", x.toFixed(2) + "%");
        if (t < 1) requestAnimationFrame(step);
        else root.classList.remove("hfx-scanning");
      })(t0);
      wordsIn(1.4);
    } else if (m === "accent") {
      timers.push(setTimeout(function () { root.classList.add("hfx-ul-on"); }, 400));
    } else if (m === "light") {
      buildLight(); paintLight();
      root.classList.add("hfx-light-on");
    }
    onScroll();
  }

  // ---------------------------------------------------------------- picker --
  var picker = document.createElement("div");
  picker.className = "orbit-picker hfx-picker";
  picker.setAttribute("role", "group");
  picker.setAttribute("aria-label", LABEL.title);
  picker.innerHTML = "<span>" + LABEL.title + "</span>" + MODES.map(function (m) {
    return '<button type="button" data-hero="' + m + '">' + LABEL[m] + "</button>";
  }).join("") + '<button type="button" data-replay>' + LABEL.replay + "</button>";
  function syncPicker() {
    picker.querySelectorAll("[data-hero]").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.hero === mode)); });
  }
  picker.addEventListener("click", function (e) {
    var b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.hero) { mode = b.dataset.hero; try { localStorage.setItem("hero-preview", mode); } catch (err) {} }
    syncPicker();
    if (window.scrollY > 10 && mode !== "tilt") window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
    play();
  });
  document.body.appendChild(picker);
  syncPicker();
  play();
})();
