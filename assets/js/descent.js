// "From orbit to drone": a pinned map of Ebringen that descends while visitors scroll
// through three career chapters (satellite → aerial → drone). The view narrows and the
// sensor pixels shrink with altitude (log-interpolated through the three platforms);
// land cover becomes coloured pixels from orbit, a crisp map from the air, and at
// drone height boxes appear around buildings (a simulation from map footprints).
// Data: assets/layers/descent.json (tools/layers/build_descent.py).
(function () {
  var sec = document.querySelector("section[data-descent]");
  if (!sec || !window.fetch) return;

  var de = document.documentElement.lang === "de";
  var T = de
    ? { names: ["SATELLIT", "LUFTBILD", "DROHNE"], alt: "Höhe", px: "Pixel", box: "Gebäude", dec: "," }
    : { names: ["SATELLITE", "AERIAL", "DRONE"], alt: "altitude", px: "pixel", box: "building", dec: "." };

  var figure = sec.querySelector(".ds-figure");
  var stage = sec.querySelector(".ds-stage");
  var canvas = sec.querySelector(".ds-canvas");
  var readout = sec.querySelector(".ds-readout");
  var chapters = Array.prototype.slice.call(sec.querySelectorAll(".ds-ch"));
  var ctx = canvas.getContext("2d");
  var off = document.createElement("canvas");
  var offCtx = off.getContext("2d");
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  // Platforms at progress 0 / 500 / 1000: altitude (m), pixel size (m), view width (m)
  var ANCHORS = [[705000, 30, 1600], [1000, 0.2, 400], [100, 0.02, 80]];
  var ASPECT = 16 / 10;
  var ROAD_W = [1.5, 3, 5, 7]; // metres by road class
  var data, focus, lc = [], roads = [], streams = [], blds = [];
  var value = 0, detectSince = 0, raf = 0;

  // ---------------------------------------------------------------- model --
  function state(v) {
    var seg = v <= 500 ? 0 : 1, t = (v - seg * 500) / 500;
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

  function decode(d) {
    var pts = new Float64Array(d.length), x = 0, y = 0;
    var b = [Infinity, Infinity, -Infinity, -Infinity];
    for (var i = 0; i < d.length; i += 2) {
      x += d[i]; y += d[i + 1];
      pts[i] = x; pts[i + 1] = y;
      if (x < b[0]) b[0] = x; if (y < b[1]) b[1] = y;
      if (x > b[2]) b[2] = x; if (y > b[3]) b[3] = y;
    }
    return { pts: pts, box: b };
  }

  // -------------------------------------------------------------- drawing --
  function colors() {
    var cs = getComputedStyle(document.documentElement);
    var get = function (n) { return cs.getPropertyValue(n).trim(); };
    var c = { paper: get("--paper"), ink: get("--ink"), accent: get("--accent-mark"), mono: get("--font-mono"),
              base: get("--lc-base"), road: get("--lc-road"), bldg: get("--lc-building") };
    data.classes.forEach(function (k) { c[k] = get("--lc-" + k); });
    return c;
  }

  function visible(o, v) {
    var b = o.box;
    return !(b[2] < v.x0 || b[0] > v.x0 + v.w || b[3] < v.y0 || b[1] > v.y0 + v.h);
  }

  function trace(c, o, close) {
    var q = o.pts;
    c.moveTo(q[0], q[1]);
    for (var i = 2; i < q.length; i += 2) c.lineTo(q[i], q[i + 1]);
    if (close) c.closePath();
  }

  // Draws the scene in map metres; the caller sets the transform. px = metres per output pixel.
  function scene(c, v, col, px, outlines) {
    c.fillStyle = col.base;
    c.fillRect(v.x0, v.y0, v.w, v.h);
    lc.forEach(function (o) {
      if (!visible(o, v)) return;
      c.beginPath();
      trace(c, o, true);
      c.fillStyle = col[data.classes[o.cls]];
      c.fill();
    });
    c.lineCap = "round";
    c.lineJoin = "round";
    c.strokeStyle = col.water;
    c.lineWidth = Math.max(2, px);
    c.beginPath();
    streams.forEach(function (o) { if (visible(o, v)) trace(c, o, false); });
    c.stroke();
    c.strokeStyle = col.road;
    [0, 1, 2, 3].forEach(function (k) {
      c.lineWidth = Math.max(ROAD_W[k], outlines ? px * (k > 1 ? 2 : 1) : 0);
      c.beginPath();
      roads.forEach(function (o) { if (o.cls === k && visible(o, v)) trace(c, o, false); });
      c.stroke();
    });
    c.beginPath();
    blds.forEach(function (o) { if (visible(o, v)) trace(c, o, true); });
    c.fillStyle = col.bldg;
    c.fill();
    if (outlines) {
      c.strokeStyle = col.ink;
      c.globalAlpha = 0.55;
      c.lineWidth = px * (v.w < 200 ? 1.5 : 0.8);
      c.stroke();
      c.globalAlpha = 1;
    }
  }

  function render() {
    raf = 0;
    if (!data) return;
    var s = state(value), v = view(s), col = colors();
    var dpr = window.devicePixelRatio || 1, cw = canvas.width, ch = canvas.height;
    var k = cw / v.w; // device px per metre

    // crisp map
    ctx.setTransform(k, 0, 0, k, -v.x0 * k, -v.y0 * k);
    scene(ctx, v, col, 1 / k, true);
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    // sensor pixels on top, fading out between 6 and 1.5 screen px per sensor pixel
    var pxOnScreen = s.gsd * k / dpr;
    var mix = Math.min(1, Math.max(0, (pxOnScreen - 1.5) / 4.5));
    if (mix > 0) {
      var gx0 = Math.floor(v.x0 / s.gsd), gy0 = Math.floor(v.y0 / s.gsd);
      var nx = Math.ceil((v.x0 + v.w) / s.gsd) - gx0, ny = Math.ceil((v.y0 + v.h) / s.gsd) - gy0;
      off.width = nx;
      off.height = ny;
      offCtx.setTransform(1 / s.gsd, 0, 0, 1 / s.gsd, -gx0, -gy0);
      var cover = { x0: gx0 * s.gsd, y0: gy0 * s.gsd, w: nx * s.gsd, h: ny * s.gsd };
      scene(offCtx, cover, col, s.gsd, false);
      ctx.imageSmoothingEnabled = false;
      ctx.globalAlpha = mix;
      ctx.drawImage(off, (cover.x0 - v.x0) * k, (cover.y0 - v.y0) * k, cover.w * k, cover.h * k);
      ctx.globalAlpha = 1;
      if (pxOnScreen >= 7) {
        ctx.strokeStyle = col.paper;
        ctx.globalAlpha = 0.35 * mix;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (var i = 0; i <= nx; i++) {
          var x = Math.round(((gx0 + i) * s.gsd - v.x0) * k) + 0.5;
          ctx.moveTo(x, 0); ctx.lineTo(x, ch);
        }
        for (var j = 0; j <= ny; j++) {
          var y = Math.round(((gy0 + j) * s.gsd - v.y0) * k) + 0.5;
          ctx.moveTo(0, y); ctx.lineTo(cw, y);
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

    // drone height: the detector "runs"
    if (value >= 960) {
      if (!detectSince) detectSince = performance.now();
      detections(v, k, col, dpr);
    } else {
      detectSince = 0;
    }

    var zone = value < 250 ? 0 : value <= 750 ? 1 : 2;
    readout.textContent = T.names[zone] + " · " + T.alt + " " + len(s.alt) + " · " + T.px + " " + len(s.gsd);
    chapters.forEach(function (c, i) { c.classList.toggle("is-active", i === zone); });
  }

  function detections(v, k, col, dpr) {
    var found = blds.filter(function (o) {
      var b = o.box;
      return visible(o, v) && (b[2] - b[0]) * (b[3] - b[1]) > 40 && Math.min(b[2] - b[0], b[3] - b[1]) > 4;
    }).sort(function (a, b) { return a.box[0] - b.box[0]; });
    var shown = reduceMotion.matches ? found.length
      : Math.min(found.length, Math.floor((performance.now() - detectSince) / 70) + 1);
    ctx.font = "500 " + 10 * dpr + "px " + col.mono;
    ctx.textBaseline = "bottom";
    var labels = [];
    for (var i = 0; i < shown; i++) {
      var b = found[i].box;
      var x = Math.round((b[0] - v.x0) * k - 3 * dpr), y = Math.round((b[1] - v.y0) * k - 3 * dpr);
      var w = Math.round((b[2] - b[0]) * k + 6 * dpr), h = Math.round((b[3] - b[1]) * k + 6 * dpr);
      ctx.strokeStyle = col.accent;
      ctx.lineWidth = 1.5 * dpr;
      ctx.strokeRect(x + 0.5, y + 0.5, w, h);
      var tw = ctx.measureText(T.box).width + 6 * dpr;
      var lr = [x, y - 13 * dpr, tw, 13 * dpr];
      var free = tw <= w + 12 * dpr && labels.every(function (o) {
        return lr[0] > o[0] + o[2] || lr[0] + lr[2] < o[0] || lr[1] > o[1] + o[3] || lr[1] + lr[3] < o[1];
      });
      if (!free) continue;
      labels.push(lr);
      ctx.fillStyle = col.accent;
      ctx.fillRect(lr[0], lr[1], lr[2], lr[3]);
      ctx.fillStyle = col.paper;
      ctx.fillText(T.box, x + 3 * dpr, y - 1 * dpr);
    }
    if (shown < found.length) schedule();
  }

  function len(m) {
    var f = function (v, d) { return v.toFixed(d).replace(".", T.dec); };
    if (m >= 100000) return f(m / 1000, 0) + " km";
    if (m >= 1000) return f(m / 1000, 1) + " km";
    if (m >= 1) return f(m, m >= 10 ? 0 : 1) + " m";
    return f(m * 100, m >= 0.1 ? 0 : 1) + " cm";
  }

  function schedule() {
    if (!raf) raf = requestAnimationFrame(render);
  }

  // --------------------------------------------------------------- scroll --
  // Progress follows the reading line: the first chapter's middle = orbit,
  // the second's = aerial, the third's = drone; in between it glides.
  function progress() {
    var stageRect = stage.getBoundingClientRect();
    var narrow = window.matchMedia("(max-width: 899px)").matches;
    var probe = narrow ? stageRect.bottom + (window.innerHeight - stageRect.bottom) * 0.45 : window.innerHeight * 0.5;
    var mids = chapters.map(function (c) { var r = c.getBoundingClientRect(); return r.top + r.height / 2; });
    var v;
    if (probe <= mids[0]) v = 0;
    else if (probe >= mids[2]) v = 1000;
    else {
      var i = probe < mids[1] ? 0 : 1;
      v = (i + (probe - mids[i]) / (mids[i + 1] - mids[i])) * 500;
    }
    if (Math.abs(v - value) > 0.5) {
      value = v;
      schedule();
    }
  }

  function resize() {
    var r = stage.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(r.width * dpr);
    canvas.height = Math.round(r.height * dpr);
    progress();
    schedule();
  }

  function start() {
    fetch(sec.dataset.descent)
      .then(function (r) { return r.json(); })
      .then(function (raw) {
        data = raw;
        focus = raw.focus;
        raw.lc.forEach(function (e) { var o = decode(e[1]); o.cls = e[0]; lc.push(o); });
        raw.roads.forEach(function (e) { var o = decode(e[1]); o.cls = e[0]; roads.push(o); });
        raw.streams.forEach(function (e) { streams.push(decode(e)); });
        raw.b.forEach(function (e) { blds.push(decode(e)); });
        figure.hidden = false;
        sec.classList.add("ds-ready");
        resize();
        new ResizeObserver(resize).observe(stage);
        window.addEventListener("scroll", progress, { passive: true });
        new MutationObserver(schedule).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
        window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", schedule);
      })
      .catch(function () {});
  }

  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (entries) {
      if (!entries[0].isIntersecting) return;
      io.disconnect();
      start();
    }, { rootMargin: "600px 0px" });
    io.observe(sec);
  } else {
    start();
  }
})();
