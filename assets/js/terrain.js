// "Light and water": the Freiburg region (Copernicus GLO-30, 100 m grid) as shaded
// relief with cast shadows, lit by a sun you drag around a dial (or today's real sun
// path over Freiburg), and flooded from the Rhine up to a chosen water level.
// Data: assets/topo/region-contours.json + -dem.bin (tools/contours/make_contours.sh).
(function () {
  var sec = document.querySelector("section[data-terrain]");
  if (!sec || !window.fetch) return;

  var de = document.documentElement.lang === "de";
  var T = de
    ? { dirs: ["N", "NO", "O", "SO", "S", "SW", "W", "NW"], sunFrom: "Sonne aus", high: "hoch",
        water: "Wasser", flooded: "überflutet", dry: "Freiburg trocken", under: function (d) { return "Freiburg " + d + " m unter Wasser"; },
        underHere: function (d) { return d + " m unter Wasser"; }, dec: ",", E: "O", night: "Sonne unter dem Horizont" }
    : { dirs: ["N", "NE", "E", "SE", "S", "SW", "W", "NW"], sunFrom: "sun from", high: "high",
        water: "water", flooded: "under water", dry: "Freiburg dry", under: function (d) { return "Freiburg under " + d + " m of water"; },
        underHere: function (d) { return "under " + d + " m of water"; }, dec: ".", E: "E", night: "sun below the horizon" };

  var base = sec.dataset.terrain;
  var stage = sec.querySelector(".tr-stage");
  var canvas = sec.querySelector(".tr-canvas");
  var poster = sec.querySelector(".tr-poster");
  var placesBox = sec.querySelector(".tr-places");
  var dial = sec.querySelector(".tr-dial");
  var dialSvg = dial.querySelector("svg");
  var sunDot = dial.querySelector(".tr-sun");
  var ray = dial.querySelector(".tr-ray");
  var pathEl = dial.querySelector(".tr-path");
  var sunRead = sec.querySelector(".tr-sun-read");
  var playBtn = sec.querySelector(".tr-play");
  var levelInput = sec.querySelector(".tr-level");
  var waterRead = sec.querySelector(".tr-water-read");
  var hoverRead = sec.querySelector(".tr-hover");
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  var Z = 2; // vertical exaggeration for the shading (shadows use true heights)
  var RING = 86; // dial radius in its viewBox units (horizon)
  var meta, grid, cols, rows, cell, hmin, hmax;
  var gx, gy, shade, shadow, flood;
  var sun = { az: 315, alt: 35 };
  var level = 170;
  var off, offCtx, img;
  var dirty = 0; // bit 1: light changed, bit 2: water changed
  var today = []; // today's sun path: [{az, alt, label}]
  var playing = null;

  // ------------------------------------------------------------------ data --
  function start() {
    fetch(base + "region-contours.json")
      .then(function (r) { return r.json(); })
      .then(function (m) {
        meta = m;
        return fetch(base + m.grid.file);
      })
      .then(function (r) { return r.arrayBuffer(); })
      .then(function (buf) {
        grid = new Int16Array(buf);
        cols = meta.grid.cols;
        rows = meta.grid.rows;
        cell = meta.grid.cell_m[0];
        hmin = Infinity;
        hmax = -Infinity;
        for (var i = 0; i < grid.length; i++) {
          if (grid[i] < hmin) hmin = grid[i];
          if (grid[i] > hmax) hmax = grid[i];
        }
        prepare();
        sec.classList.add("tr-ready");
        canvas.hidden = false;
        poster.hidden = true;
        levelInput.min = String(hmin);
        level = hmin;
        levelInput.value = String(level);
        resize();
        new ResizeObserver(resize).observe(stage);
        new MutationObserver(redraw).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
        window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", redraw);
        update(3);
      })
      .catch(function () {});
  }

  function prepare() {
    var n = cols * rows;
    gx = new Float32Array(n);
    gy = new Float32Array(n);
    shade = new Float32Array(n);
    shadow = new Uint8Array(n);
    flood = new Uint8Array(n);
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        var cl = Math.max(c - 1, 0), cr = Math.min(c + 1, cols - 1);
        var ru = Math.max(r - 1, 0), rd = Math.min(r + 1, rows - 1);
        gx[r * cols + c] = Z * (grid[r * cols + cr] - grid[r * cols + cl]) / ((cr - cl) * cell);
        gy[r * cols + c] = Z * (grid[rd * cols + c] - grid[ru * cols + c]) / ((rd - ru) * cell);
      }
    }
    off = document.createElement("canvas");
    off.width = cols;
    off.height = rows;
    offCtx = off.getContext("2d");
    img = offCtx.createImageData(cols, rows);
    today = sunPath(new Date());
    drawPath();
    drawPlaces();
  }

  // --------------------------------------------------------------- physics --
  function computeLight() {
    var az = sun.az * Math.PI / 180, alt = sun.alt * Math.PI / 180;
    // direction to the sun in grid axes (x east, y south, z up)
    var lx = Math.sin(az) * Math.cos(alt), ly = -Math.cos(az) * Math.cos(alt), lz = Math.sin(alt);
    for (var i = 0; i < gx.length; i++) {
      var nx = -gx[i], ny = -gy[i];
      var s = (nx * lx + ny * ly + lz) / Math.sqrt(nx * nx + ny * ny + 1);
      shade[i] = s > 0 ? s : 0;
    }
    // cast shadows: march towards the sun until the ray clears the highest point
    var dx = Math.sin(az), dy = -Math.cos(az);
    var m = Math.max(Math.abs(dx), Math.abs(dy));
    dx /= m;
    dy /= m;
    var rise = Math.tan(alt) * cell * Math.sqrt(dx * dx + dy * dy); // per step
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        var i = r * cols + c, h = grid[i], x = c, y = r, z = h, hit = 0;
        while (true) {
          x += dx;
          y += dy;
          z += rise;
          if (z > hmax || x < 0 || y < 0 || x > cols - 1 || y > rows - 1) break;
          if (grid[Math.round(y) * cols + Math.round(x)] > z) { hit = 1; break; }
        }
        shadow[i] = hit;
      }
    }
  }

  // Water fills cells below the level that are connected to the Rhine (west edge
  // and the lowest cell), like a rising river, not every hollow in the hills.
  var queue;
  function computeFlood() {
    flood.fill(0);
    if (!queue) queue = new Int32Array(cols * rows);
    var head = 0, tail = 0;
    function push(i) {
      if (!flood[i] && grid[i] < level) {
        flood[i] = 1;
        queue[tail++] = i;
      }
    }
    for (var r = 0; r < rows; r++) push(r * cols);
    var lowest = 0;
    for (var i = 1; i < grid.length; i++) if (grid[i] < grid[lowest]) lowest = i;
    push(lowest);
    while (head < tail) {
      var k = queue[head++], c = k % cols;
      if (c > 0) push(k - 1);
      if (c < cols - 1) push(k + 1);
      if (k >= cols) push(k - cols);
      if (k < cols * (rows - 1)) push(k + cols);
    }
    return tail;
  }

  // ----------------------------------------------------------- sun on Earth --
  // Solar position for a UTC instant (NOAA-style approximation, ~0.5° accuracy).
  function solar(date, lat, lon) {
    var d = date.getTime() / 86400000 - 10957.5; // days since J2000.0
    var rad = Math.PI / 180;
    var g = (357.529 + 0.98560028 * d) * rad;
    var q = 280.459 + 0.98564736 * d;
    var L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * rad;
    var e = (23.439 - 0.00000036 * d) * rad;
    var ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
    var dec = Math.asin(Math.sin(e) * Math.sin(L));
    var gmst = (18.697374558 + 24.06570982441908 * d) % 24;
    var H = ((gmst * 15 + lon) * rad - ra);
    var phi = lat * rad;
    var alt = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
    var az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi));
    return { az: (az / rad + 180 + 360) % 360, alt: alt / rad };
  }

  function sunPath(now) {
    var fmtDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit" });
    var fmtTime = new Intl.DateTimeFormat(de ? "de-DE" : "en-GB", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" });
    var day = fmtDay.format(now);
    var t0 = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - 4 * 3600000;
    var out = [];
    for (var t = t0; t < t0 + 32 * 3600000; t += 5 * 60000) {
      var dt = new Date(t);
      if (fmtDay.format(dt) !== day) continue;
      var p = solar(dt, 47.9956, 7.8522); // Freiburg Münster
      if (p.alt > 0.5) out.push({ az: p.az, alt: p.alt, label: fmtTime.format(dt) });
    }
    return out;
  }

  // ------------------------------------------------------------- drawing --
  function rgb(v) {
    v = v.trim();
    if (v[0] === "#") {
      if (v.length === 4) v = "#" + v[1] + v[1] + v[2] + v[2] + v[3] + v[3];
      return [parseInt(v.slice(1, 3), 16), parseInt(v.slice(3, 5), 16), parseInt(v.slice(5, 7), 16)];
    }
    return (v.match(/\d+/g) || [0, 0, 0]).slice(0, 3).map(Number);
  }

  function render() {
    var cs = getComputedStyle(document.documentElement);
    var paper = rgb(cs.getPropertyValue("--paper")), ink = rgb(cs.getPropertyValue("--ink"));
    var tint = rgb(cs.getPropertyValue("--contour")), water = rgb(cs.getPropertyValue("--water"));
    var darkTheme = paper[0] + paper[1] + paper[2] < 384;
    var data = img.data;
    for (var i = 0; i < shade.length; i++) {
      var s = shade[i] * (shadow[i] ? 0.4 : 1);
      var k, r, g, b;
      if (darkTheme) {
        k = 0.04 + 0.62 * Math.pow(s, 1.4); // lit faces glow out of the dark paper
        r = paper[0] + (ink[0] - paper[0]) * k;
        g = paper[1] + (ink[1] - paper[1]) * k;
        b = paper[2] + (ink[2] - paper[2]) * k;
      } else {
        var t1 = Math.min(1, (1 - s) * 1.25) * 0.5, t2 = Math.max(0, 0.55 - s) * 0.9;
        r = paper[0] + (tint[0] - paper[0]) * t1; r += (ink[0] - r) * t2;
        g = paper[1] + (tint[1] - paper[1]) * t1; g += (ink[1] - g) * t2;
        b = paper[2] + (tint[2] - paper[2]) * t1; b += (ink[2] - b) * t2;
      }
      if (flood[i]) {
        var a = 0.62 + 0.3 * Math.min(1, (level - grid[i]) / 200);
        r += (water[0] - r) * a;
        g += (water[1] - g) * a;
        b += (water[2] - b) * a;
      }
      data[i * 4] = r;
      data[i * 4 + 1] = g;
      data[i * 4 + 2] = b;
      data[i * 4 + 3] = 255;
    }
    offCtx.putImageData(img, 0, 0);
    var ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(off, 0, 0, canvas.width, canvas.height);
  }

  function update(what) {
    dirty |= what;
    if (update.raf) return;
    update.raf = requestAnimationFrame(function () {
      update.raf = 0;
      if (dirty & 1) computeLight();
      var n = dirty & 2 ? computeFlood() : null;
      if (n !== null) readWater(n);
      dirty = 0;
      render();
      readSun();
    });
  }
  function redraw() { if (meta) update(0); }

  function resize() {
    var r = stage.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(r.width * dpr);
    canvas.height = Math.round(r.height * dpr);
    if (meta) render();
  }

  function drawPlaces() {
    placesBox.textContent = "";
    (meta.places || []).forEach(function (p) {
      var el = document.createElement("span");
      el.className = "tr-place tr-" + p.kind + (p.x / meta.width_m > 0.6 ? " tr-flip" : "");
      el.style.left = (p.x / meta.width_m * 100) + "%";
      el.style.top = (p.y / meta.height_m * 100) + "%";
      el.textContent = (de ? p.de : p.en) + (p.elev ? " " + p.elev + " m" : "");
      placesBox.appendChild(el);
    });
  }

  // ---------------------------------------------------------------- dial --
  function polar(az, alt) {
    var r = (90 - alt) / 90 * RING, a = az * Math.PI / 180;
    return [Math.sin(a) * r, -Math.cos(a) * r];
  }

  function drawDial() {
    var p = polar(sun.az, Math.max(sun.alt, 0));
    sunDot.setAttribute("cx", p[0].toFixed(1));
    sunDot.setAttribute("cy", p[1].toFixed(1));
    ray.setAttribute("x2", p[0].toFixed(1));
    ray.setAttribute("y2", p[1].toFixed(1));
    dial.setAttribute("aria-valuenow", String(Math.round(sun.az)));
    dial.setAttribute("aria-valuetext", sunText());
  }

  function drawPath() {
    pathEl.setAttribute("d", today.map(function (p, i) {
      var q = polar(p.az, p.alt);
      return (i ? "L" : "M") + q[0].toFixed(1) + " " + q[1].toFixed(1);
    }).join(""));
  }

  function sunText(time) {
    var dir = T.dirs[Math.round(sun.az / 45) % 8];
    return T.sunFrom + " " + Math.round(sun.az) + "° " + dir + " · " + Math.round(sun.alt) + "° " + T.high + (time ? " · " + time : "");
  }
  function readSun(time) {
    sunRead.textContent = sunText(time || (playing && playing.label));
    drawDial();
  }

  function readWater(n) {
    var km2 = n * cell * cell / 1e6;
    var fb = (meta.places || []).filter(function (p) { return p.kind === "town"; })[0];
    var status = "";
    if (fb) {
      var i = Math.floor(fb.y / cell) * cols + Math.floor(fb.x / cell);
      status = flood[i] ? T.under(Math.round(level - grid[i])) : T.dry;
    }
    waterRead.textContent = T.water + " " + Math.round(level) + " m · " +
      Math.round(km2).toLocaleString(de ? "de-DE" : "en-GB") + " km² " + T.flooded + (status ? " · " + status : "");
  }

  function setSun(az, alt) {
    sun.az = (az + 360) % 360;
    sun.alt = Math.min(Math.max(alt, 5), 88);
    update(1);
  }

  function fromPointer(e) {
    var r = dialSvg.getBoundingClientRect();
    var x = (e.clientX - r.left) / r.width * 200 - 100, y = (e.clientY - r.top) / r.height * 200 - 100;
    var az = Math.atan2(x, -y) * 180 / Math.PI;
    var alt = 90 * (1 - Math.min(Math.hypot(x, y) / RING, 1));
    stopPlay();
    setSun(az, alt);
  }

  dial.addEventListener("pointerdown", function (e) {
    if (!meta) return;
    dial.setPointerCapture(e.pointerId);
    dial.classList.add("is-dragging");
    fromPointer(e);
  });
  dial.addEventListener("pointermove", function (e) {
    if (dial.classList.contains("is-dragging")) fromPointer(e);
  });
  ["pointerup", "pointercancel"].forEach(function (t) {
    dial.addEventListener(t, function () { dial.classList.remove("is-dragging"); });
  });
  dial.addEventListener("keydown", function (e) {
    var k = { ArrowLeft: [-5, 0], ArrowRight: [5, 0], ArrowUp: [0, 3], ArrowDown: [0, -3] }[e.key];
    if (!k || !meta) return;
    e.preventDefault();
    stopPlay();
    setSun(sun.az + k[0], sun.alt + k[1]);
  });

  // ----------------------------------------------------------------- play --
  function stopPlay() {
    if (!playing) return;
    cancelAnimationFrame(playing.raf);
    clearTimeout(playing.timer);
    playing = null;
    playBtn.textContent = playBtn.dataset.play;
    playBtn.setAttribute("aria-pressed", "false");
  }

  playBtn.setAttribute("aria-pressed", "false");
  playBtn.addEventListener("click", function () {
    if (!meta || !today.length) return;
    if (playing) return stopPlay();
    playing = { i: 0, label: "" };
    playBtn.textContent = playBtn.dataset.stop;
    playBtn.setAttribute("aria-pressed", "true");
    var n = today.length, t0 = performance.now(), dur = 9000;
    function show(i) {
      var p = today[Math.min(i, n - 1)];
      playing.label = p.label;
      sun.az = p.az;
      sun.alt = Math.max(p.alt, 2);
      update(1);
    }
    if (reduceMotion.matches) {
      // a few still frames instead of a sweep
      var stepTo = function (k) {
        if (!playing) return;
        show(Math.round(k * (n - 1) / 8));
        if (k < 8) playing.timer = setTimeout(function () { stepTo(k + 1); }, 900);
        else stopPlay();
      };
      stepTo(0);
      return;
    }
    function frame(now) {
      if (!playing) return;
      var t = Math.min(1, (now - t0) / dur);
      show(Math.round(t * (n - 1)));
      if (t < 1) playing.raf = requestAnimationFrame(frame);
      else setTimeout(stopPlay, 600);
    }
    playing.raf = requestAnimationFrame(frame);
  });

  // --------------------------------------------------------------- water --
  levelInput.addEventListener("input", function () {
    if (!meta) return;
    level = Number(levelInput.value);
    update(2);
  });

  // --------------------------------------------------------------- hover --
  canvas.addEventListener("pointermove", function (e) {
    if (!meta) return;
    var r = canvas.getBoundingClientRect();
    var x = (e.clientX - r.left) / r.width * meta.width_m, y = (e.clientY - r.top) / r.height * meta.height_m;
    var i = Math.min(rows - 1, Math.floor(y / cell)) * cols + Math.min(cols - 1, Math.floor(x / cell));
    var t = [1, x, y, x * x, x * y, y * y];
    var poly = function (c) { return c.reduce(function (s, k, j) { return s + k * t[j]; }, 0); };
    var lon = poly(meta.lonlat.lon), lat = poly(meta.lonlat.lat);
    var fmt = function (v) { return v.toFixed(4).replace(".", T.dec); };
    hoverRead.textContent = fmt(lat) + "°N " + fmt(lon) + "°" + T.E + " · " + grid[i] + " m" +
      (flood[i] ? " · " + T.underHere(Math.round(level - grid[i])) : "");
    hoverRead.classList.add("is-live");
  });
  canvas.addEventListener("pointerleave", function () {
    hoverRead.textContent = "";
    hoverRead.classList.remove("is-live");
  });

  readSun();
  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (entries) {
      if (!entries[0].isIntersecting) return;
      io.disconnect();
      start();
    }, { rootMargin: "500px 0px" });
    io.observe(sec);
  } else {
    start();
  }
})();
