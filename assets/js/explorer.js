// "From orbit to drone": descend from 705 km to 100 m above Ebringen. The view
// narrows and the sensor pixels shrink with altitude (log-interpolated between the
// three platforms). Clicking the map sets where you descend; at drone height a
// "detector" draws boxes around the buildings in view (a simulation from map
// footprints). Data: assets/layers/explorer.json (tools/layers/build_explorer.py).
(function () {
  var section = document.querySelector("section[data-explorer]");
  if (!section || !window.fetch) return;

  var de = document.documentElement.lang === "de";
  var range = section.querySelector(".alt-range");
  var buttons = Array.prototype.slice.call(section.querySelectorAll(".ex-btn"));
  var stage = section.querySelector(".ex-stage");
  var canvas = section.querySelector(".ex-canvas");
  var fallback = section.querySelector(".ex-fallback");
  var readout = section.querySelector(".ex-readout");
  var detectBtn = section.querySelector(".ex-detect");
  var note = section.querySelector(".ex-note");
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  var ctx = canvas.getContext("2d");
  var off = document.createElement("canvas");
  var offCtx = off.getContext("2d");

  // Platforms at slider positions 0 / 500 / 1000: altitude (m), pixel size (m), view width (m)
  var ANCHORS = [[705000, 30, 1600], [1000, 0.2, 400], [100, 0.02, 80]];
  var DETECT_MAX_WIDTH = 130; // detector available when the view is at most this wide
  var ASPECT = 16 / 10;
  var data = null;
  var polys = []; // [{pts: Float64Array, box: [x0, y0, x1, y1]}]
  var focus = null;
  var value = 0;
  var detecting = false;
  var detectStart = 0;
  var tween = null;

  // ---------------------------------------------------------------- model --
  function state(v) {
    var seg = v <= 500 ? 0 : 1;
    var t = (v - seg * 500) / 500;
    var a = ANCHORS[seg], b = ANCHORS[seg + 1];
    var lerp = function (i) { return Math.exp(Math.log(a[i]) + (Math.log(b[i]) - Math.log(a[i])) * t); };
    return { alt: lerp(0), gsd: lerp(1), width: lerp(2) };
  }

  function view(s) {
    var w = s.width, h = w / ASPECT;
    var cx = Math.min(Math.max(focus[0], w / 2), data.w - w / 2);
    var cy = Math.min(Math.max(focus[1], h / 2), data.h - h / 2);
    return { x0: cx - w / 2, y0: cy - h / 2, w: w, h: h };
  }

  function decode(raw) {
    raw.b.forEach(function (d) {
      var pts = new Float64Array(d.length);
      var x = 0, y = 0, minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
      for (var i = 0; i < d.length; i += 2) {
        x += d[i]; y += d[i + 1];
        pts[i] = x; pts[i + 1] = y;
        if (x < minx) minx = x; if (x > maxx) maxx = x;
        if (y < miny) miny = y; if (y > maxy) maxy = y;
      }
      polys.push({ pts: pts, box: [minx, miny, maxx, maxy] });
    });
    focus = raw.focus.slice();
  }

  // ------------------------------------------------------------ formatting --
  function num(v, digits) {
    var s = v.toFixed(digits);
    return de ? s.replace(".", ",") : s;
  }
  function len(m) {
    if (m >= 100000) return num(m / 1000, 0) + " km";
    if (m >= 1000) return num(m / 1000, 1) + " km";
    if (m >= 1) return num(m, m >= 10 ? 0 : 1) + " m";
    return num(m * 100, m >= 0.1 ? 0 : 1) + " cm";
  }
  function describe(s) {
    return de
      ? "Höhe " + len(s.alt) + " · Pixel " + len(s.gsd) + " · Ausschnitt " + len(s.width)
      : "altitude " + len(s.alt) + " · pixel " + len(s.gsd) + " · view " + len(s.width);
  }

  // -------------------------------------------------------------- drawing --
  function colors() {
    var cs = getComputedStyle(document.documentElement);
    var get = function (n) { return cs.getPropertyValue(n).trim(); };
    return { ink: get("--ink"), paper: get("--paper"), contour: get("--contour"), grid: get("--grid"),
             accent: get("--accent-mark"), muted: get("--muted"), mono: get("--font-mono") };
  }

  function tracePolys(c, v) {
    c.beginPath();
    polys.forEach(function (p) {
      var b = p.box;
      if (b[2] < v.x0 || b[0] > v.x0 + v.w || b[3] < v.y0 || b[1] > v.y0 + v.h) return;
      var q = p.pts;
      c.moveTo(q[0], q[1]);
      for (var i = 2; i < q.length; i += 2) c.lineTo(q[i], q[i + 1]);
      c.closePath();
    });
  }

  function render() {
    if (!data) return;
    var s = state(value), v = view(s), col = colors();
    var dpr = window.devicePixelRatio || 1;
    var cw = canvas.width, ch = canvas.height;
    var k = cw / v.w; // device px per metre
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = col.paper;
    ctx.fillRect(0, 0, cw, ch);

    // Pixels blend into crisp footprints between 1.5 and 5.5 screen px per sensor pixel.
    var pxOnScreen = s.gsd * k;
    var mix = Math.min(1, Math.max(0, (pxOnScreen / dpr - 1.5) / 4));
    if (mix > 0) {
      // Sensor pixels: rasterise footprints on a grid of gsd-sized cells (anti-aliasing
      // gives each cell its building coverage), then scale up without smoothing.
      var gx0 = Math.floor(v.x0 / s.gsd), gy0 = Math.floor(v.y0 / s.gsd);
      var nx = Math.ceil((v.x0 + v.w) / s.gsd) - gx0, ny = Math.ceil((v.y0 + v.h) / s.gsd) - gy0;
      off.width = nx; off.height = ny;
      offCtx.setTransform(1 / s.gsd, 0, 0, 1 / s.gsd, -gx0, -gy0);
      offCtx.clearRect(gx0 * s.gsd, gy0 * s.gsd, nx * s.gsd, ny * s.gsd);
      offCtx.fillStyle = col.ink;
      tracePolys(offCtx, v);
      offCtx.fill();
      ctx.imageSmoothingEnabled = false;
      ctx.globalAlpha = 0.8 * mix;
      ctx.drawImage(off, (gx0 * s.gsd - v.x0) * k, (gy0 * s.gsd - v.y0) * k, nx * s.gsd * k, ny * s.gsd * k);
      ctx.globalAlpha = 1;
      if (pxOnScreen >= 7 * dpr) {
        // the pixel grid, faintly
        ctx.strokeStyle = col.grid;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (var i = 0; i <= nx; i++) {
          var x = Math.round((( gx0 + i) * s.gsd - v.x0) * k) + 0.5;
          ctx.moveTo(x, 0); ctx.lineTo(x, ch);
        }
        for (var j = 0; j <= ny; j++) {
          var y = Math.round(((gy0 + j) * s.gsd - v.y0) * k) + 0.5;
          ctx.moveTo(0, y); ctx.lineTo(cw, y);
        }
        ctx.stroke();
      }
    }
    if (mix < 1) {
      // Finer than the screen: crisp footprints.
      ctx.setTransform(k, 0, 0, k, -v.x0 * k, -v.y0 * k);
      tracePolys(ctx, v);
      ctx.globalAlpha = 0.14 * (1 - mix);
      ctx.fillStyle = col.contour;
      ctx.fill();
      ctx.globalAlpha = 1 - mix;
      ctx.lineWidth = (s.width < 200 ? 1.5 : 1) * dpr / k;
      ctx.lineJoin = "round";
      ctx.strokeStyle = col.ink;
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }

    if (detecting) drawDetections(v, k, col);

    // Where you descend: a small diamond, hidden at the top where the view can't move.
    if (s.width < data.w - 1 || value === 0) {
      var fx = (focus[0] - v.x0) * k, fy = (focus[1] - v.y0) * k, r = 6 * dpr;
      ctx.save();
      ctx.translate(fx, fy);
      ctx.rotate(Math.PI / 4);
      ctx.strokeStyle = col.accent;
      ctx.lineWidth = 1.5 * dpr;
      ctx.strokeRect(-r / 2, -r / 2, r, r);
      ctx.restore();
    }

    readout.textContent = describe(s);
    var label = (de ? "Ebringen aus " : "Ebringen from ") + len(s.alt) + ", " + (de ? "Pixelgröße " : "pixel size ") + len(s.gsd);
    canvas.setAttribute("aria-label", label);
    range.setAttribute("aria-valuetext", describe(s));
    buttons.forEach(function (b, i) {
      var zone = value < 250 ? 0 : value <= 750 ? 1 : 2;
      b.setAttribute("aria-pressed", String(zone === i));
    });
    var canDetect = s.width <= DETECT_MAX_WIDTH;
    detectBtn.disabled = !canDetect;
    if (!canDetect && detecting) setDetecting(false);
  }

  function drawDetections(v, k, col) {
    var dpr = window.devicePixelRatio || 1;
    var found = polys.filter(function (p) {
      var b = p.box;
      // like a detector's size threshold: skip sheds and garages (< ~40 m² box, < 4 m side)
      return b[2] > v.x0 && b[0] < v.x0 + v.w && b[3] > v.y0 && b[1] < v.y0 + v.h &&
        (b[2] - b[0]) * (b[3] - b[1]) > 40 && Math.min(b[2] - b[0], b[3] - b[1]) > 4;
    }).sort(function (a, b) { return a.box[0] - b.box[0]; });
    var shown = reduceMotion.matches ? found.length
      : Math.min(found.length, Math.floor((performance.now() - detectStart) / 90) + 1);
    ctx.font = "500 " + 10 * dpr + "px " + col.mono;
    ctx.textBaseline = "bottom";
    var labels = []; // placed label rectangles, to avoid overlaps
    for (var i = 0; i < shown; i++) {
      var b = found[i].box;
      var x = (b[0] - v.x0) * k - 3 * dpr, y = (b[1] - v.y0) * k - 3 * dpr;
      var w = (b[2] - b[0]) * k + 6 * dpr, h = (b[3] - b[1]) * k + 6 * dpr;
      ctx.strokeStyle = col.accent;
      ctx.lineWidth = 1.5 * dpr;
      ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(w), Math.round(h));
      var label = de ? "Gebäude" : "building";
      var tw = ctx.measureText(label).width + 6 * dpr;
      var lr = [Math.round(x), Math.round(y) - 13 * dpr, tw, 13 * dpr];
      var free = tw <= w + 12 * dpr && labels.every(function (o) {
        return lr[0] > o[0] + o[2] || lr[0] + lr[2] < o[0] || lr[1] > o[1] + o[3] || lr[1] + lr[3] < o[1];
      });
      if (!free) continue;
      labels.push(lr);
      ctx.fillStyle = col.accent;
      ctx.fillRect(lr[0], lr[1], lr[2], lr[3]);
      ctx.fillStyle = col.paper;
      ctx.fillText(label, Math.round(x) + 3 * dpr, Math.round(y) - 1 * dpr);
    }
    if (shown < found.length) requestAnimationFrame(render);
  }

  function setDetecting(on) {
    detecting = on;
    detectStart = performance.now();
    detectBtn.setAttribute("aria-pressed", String(on));
    detectBtn.textContent = on ? (de ? "Boxen ausblenden" : "hide boxes") : (de ? "Detektor starten" : "run detector");
    note.hidden = !on;
    render();
  }

  // --------------------------------------------------------------- layout --
  function resize() {
    var r = stage.getBoundingClientRect();
    var dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(r.width * dpr);
    canvas.height = Math.round(r.height * dpr);
    // The slider runs exactly from the first platform icon to the last one.
    // (vertically from the first platform icon to the last, on the axis line)
    var icons = section.querySelectorAll(".alt-icon");
    var box = range.parentNode.getBoundingClientRect();
    var list = section.querySelector(".alt-list").getBoundingClientRect();
    var a = icons[0].getBoundingClientRect(), b = icons[icons.length - 1].getBoundingClientRect();
    var top = a.top + a.height / 2 - box.top, bottom = b.top + b.height / 2 - box.top;
    range.style.top = top - 11 + "px";
    range.style.height = bottom - top + 22 + "px";
    range.style.left = list.left - box.left + 14 - 13 + "px";
    render();
  }

  function setValue(v) {
    value = Math.min(1000, Math.max(0, v));
    range.value = String(Math.round(value));
    render();
  }

  function glide(target) {
    if (tween) cancelAnimationFrame(tween);
    if (reduceMotion.matches) return setValue(target);
    var from = value, t0 = performance.now(), dur = 900;
    var step = function (now) {
      var t = Math.min(1, (now - t0) / dur);
      setValue(from + (target - from) * (1 - Math.pow(1 - t, 3)));
      tween = t < 1 ? requestAnimationFrame(step) : null;
    };
    tween = requestAnimationFrame(step);
  }

  // --------------------------------------------------------------- events --
  function start() {
    fetch(section.dataset.explorer)
      .then(function (r) { return r.json(); })
      .then(function (raw) {
        data = raw;
        decode(raw);
        fallback.hidden = true;
        canvas.hidden = false;
        range.hidden = false;
        detectBtn.hidden = false;
        section.classList.add("ex-ready");
        resize();
        new ResizeObserver(resize).observe(stage);
        new MutationObserver(render).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
        window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", render);
      })
      .catch(function () {});
  }

  range.addEventListener("input", function () {
    if (tween) cancelAnimationFrame(tween);
    setValue(Number(range.value));
  });
  buttons.forEach(function (b, i) {
    b.addEventListener("click", function () { if (data) glide(i * 500); });
  });
  detectBtn.addEventListener("click", function () { setDetecting(!detecting); });
  canvas.addEventListener("click", function (e) {
    var r = canvas.getBoundingClientRect();
    var v = view(state(value));
    focus = [v.x0 + (e.clientX - r.left) / r.width * v.w, v.y0 + (e.clientY - r.top) / r.height * v.h];
    if (detecting) setDetecting(false);
    render();
  });

  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (entries) {
      if (!entries[0].isIntersecting) return;
      io.disconnect();
      start();
    }, { rootMargin: "400px 0px" });
    io.observe(section);
  } else {
    start();
  }
})();
