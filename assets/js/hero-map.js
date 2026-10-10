// Hero map tools, in the hero and in a fullscreen viewer:
//  - two views of the same DEM: contours (static SVG) or ridge lines (drawn here from
//    the 50 m elevation grid: one line per row, lifted by elevation, hiding what's behind)
//  - live coordinates + elevation under the pointer (snapped to the ridge line in ridge view)
//  - an elevation profile between two clicked points (draped over the ridges)
//  - fullscreen: zoom (buttons, wheel, pinch), pan (drag), scale bar
// Data (50 m grid + map→lat/lon formula, tools/contours/dem_grid.py) loads on first use.
(function () {
  var hero = document.querySelector(".hero[data-topo]");
  var heroSvg = hero && hero.querySelector("svg.topo");
  if (!heroSvg || !window.fetch) return;

  var de = document.documentElement.lang === "de";
  var T = de
    ? { profile: "Höhenprofil", close: "Profil schließen", length: "Länge", dec: ",", E: "O", W: "W",
        contours: "Höhenlinien", ridges: "Ridgelines", full: "Vollbild", view: "Kartenansicht",
        zoomIn: "Hineinzoomen", zoomOut: "Herauszoomen", reset: "Ganze Karte", closeMap: "Karte schließen",
        title: "Region Freiburg · Kaiserstuhl bis Feldberg · Copernicus GLO-30",
        ci: "Äquidistanz 20 m · gestrichelt: Ausschnitt der Startseite",
        hint: "Überfahren: Koordinaten · Klick, Klick: Höhenprofil · Ziehen: verschieben · Mausrad: zoomen",
        exag: function (x) { return "Ridgelines: " + String(x).replace(".", ",") + "-fach überhöht"; },
        crs: ["EPSG:32632 · eigentlich UTM 32N", "EPSG:3857 · bitte keine Flächen messen",
          "EPSG:4326 · Lat/Lon oder Lon/Lat?"] }
    : { profile: "elevation profile", close: "Close profile", length: "length", dec: ".", E: "E", W: "W",
        contours: "contours", ridges: "ridges", full: "fullscreen", view: "Map view",
        zoomIn: "Zoom in", zoomOut: "Zoom out", reset: "Whole map", closeMap: "Close map",
        title: "Freiburg region · Kaiserstuhl to Feldberg · Copernicus GLO-30",
        ci: "CI 20 m · dashed: the area on the homepage",
        hint: "hover: coordinates · click, click: elevation profile · drag: pan · wheel: zoom",
        exag: function (x) { return "ridges: vertical exaggeration " + x + "×"; },
        crs: ["EPSG:32632 · actually UTM 32N", "EPSG:3857 · do not measure areas",
          "EPSG:4326 · lat/lon or lon/lat?"] };

  var NS = "http://www.w3.org/2000/svg";
  var base = hero.dataset.topo;
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  var mode = "contours";
  var maps = []; // map instances (hero, viewer)

  // A dataset = one map: metadata, 16-bit elevation grid, its minimum. The hero uses
  // Freiburg (10 x 5 km); the fullscreen viewer the region (Kaiserstuhl to Feldberg).
  // exag: vertical exaggeration of the ridge view (the region has more relief, so less)
  function dataset(name, withSvg, exag) {
    var ds = { meta: null, grid: null, hmin: 0, svgText: null, ready: null, exag: exag };
    ds.load = function () {
      if (!ds.ready) {
        ds.ready = fetch(base + name + ".json")
          .then(function (r) { return r.json(); })
          .then(function (m) {
            ds.meta = m;
            return Promise.all([
              fetch(base + m.grid.file).then(function (r) { return r.arrayBuffer(); }),
              withSvg ? fetch(base + name + ".svg").then(function (r) { return r.text(); }) : null,
            ]);
          })
          .then(function (res) {
            ds.grid = new Int16Array(res[0]);
            var lo = Infinity;
            for (var i = 0; i < ds.grid.length; i++) if (ds.grid[i] < lo) lo = ds.grid[i];
            ds.hmin = lo;
            ds.svgText = res[1];
            return ds;
          })
          .catch(function () { ds.ready = null; });
      }
      return ds.ready;
    };
    return ds;
  }
  var heroData = dataset("hero-contours", false, 2.5);
  var regionData = dataset("region-contours", true, 4);
  function load() { return heroData.load(); }

  // ----------------------------------------------------------- geometry --
  function elevation(ds, x, y) {
    var g = ds.meta.grid, grid = ds.grid;
    var fx = Math.min(Math.max(x / g.cell_m[0] - 0.5, 0), g.cols - 1);
    var fy = Math.min(Math.max(y / g.cell_m[1] - 0.5, 0), g.rows - 1);
    var x0 = Math.floor(fx), y0 = Math.floor(fy);
    var x1 = Math.min(x0 + 1, g.cols - 1), y1 = Math.min(y0 + 1, g.rows - 1);
    var tx = fx - x0, ty = fy - y0;
    var v = function (c, r) { return grid[r * g.cols + c]; };
    return (v(x0, y0) * (1 - tx) + v(x1, y0) * tx) * (1 - ty) + (v(x0, y1) * (1 - tx) + v(x1, y1) * tx) * ty;
  }

  function lift(ds, x, y) {
    return mode === "ridges" ? ds.exag * (elevation(ds, x, y) - ds.hmin) : 0;
  }

  function lonLat(ds, x, y) {
    var t = [1, x, y, x * x, x * y, y * y];
    var poly = function (c) { return c.reduce(function (s, k, i) { return s + k * t[i]; }, 0); };
    return [poly(ds.meta.lonlat.lon), poly(ds.meta.lonlat.lat)];
  }

  function num(v, digits) {
    return Math.abs(v).toFixed(digits).replace(".", T.dec);
  }

  function readout(ds, p) {
    var ll = lonLat(ds, p.x, p.y);
    return num(ll[1], 4) + "°" + (ll[1] >= 0 ? "N" : "S") + " " + num(ll[0], 4) + "°" +
      (ll[0] >= 0 ? T.E : T.W) + " · " + Math.round(elevation(ds, p.x, p.y)) + " m";
  }

  function el(name, attrs, parent) {
    var e = document.createElementNS(NS, name);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  // Ridge lines, back (north) to front (south); each closes down to the map bottom
  // with a paper fill, so nearer lines hide the ones behind.
  function ridgeGroup(ds, step) {
    var W = ds.meta.width_m, H = ds.meta.height_m, cell = ds.meta.grid.cell_m[0];
    var dx = step <= cell ? cell / 2 : cell; // sample spacing along each line
    var g = el("g", { class: "ridges" });
    for (var y = step / 2; y < H; y += step) {
      var pts = [];
      for (var x = 0; x < W; x += dx) pts.push([x, y - lift(ds, x, y)]);
      pts.push([W, y - lift(ds, W, y)]);
      // smooth: quadratic curves through the midpoints between samples
      var d = "M" + pts[0][0] + " " + pts[0][1].toFixed(1);
      for (var i = 1; i < pts.length - 1; i++) {
        var mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
        d += "Q" + pts[i][0] + " " + pts[i][1].toFixed(1) + " " + mx + " " + my.toFixed(1);
      }
      d += "L" + W + " " + pts[pts.length - 1][1].toFixed(1) + "L" + W + " " + (H + 2000) + "L0 " + (H + 2000) + "Z";
      el("path", { d: d }, g);
    }
    return g;
  }

  // ------------------------------------------------------- map instance --
  // o.svg: SVG in map coordinates; o.content: where the ridge group goes;
  // o.readout: element showing the readout; o.panelHost: where the profile panel goes.
  function MapView(o) {
    var self = this;
    var ds = o.ds;
    var a = null, b = null, cursor = null;
    var ridges = null, ridgeStep = 0;
    var overlay = el("g", { class: "map-tools", "aria-hidden": "true" }, o.svg);
    var line = el("polyline", { class: "mt-line" }, overlay);
    var ptA = el("circle", { class: "mt-pt" }, overlay);
    var ptB = el("circle", { class: "mt-pt" }, overlay);
    var mark = el("circle", { class: "mt-hover" }, overlay);
    var panel = makePanel(o.panelHost, reset);
    var defaultText = o.readout ? o.readout.textContent : "";

    function px() {
      var m = o.svg.getScreenCTM();
      return m ? 1 / m.a : 1; // map units per CSS pixel
    }

    function toMap(evt) {
      var m = o.svg.getScreenCTM();
      if (!m) return null;
      var pt = o.svg.createSVGPoint();
      pt.x = evt.clientX;
      pt.y = evt.clientY;
      var p = pt.matrixTransform(m.inverse());
      return p.x >= 0 && p.y >= 0 && p.x <= ds.meta.width_m && p.y <= ds.meta.height_m ? { x: p.x, y: p.y } : null;
    }

    // Ground point under the pointer. In ridge view: the front-most ridge line at or
    // above the pointer is the one you see, so snap to it.
    function ground(p) {
      if (!p || mode !== "ridges") return p;
      for (var y = Math.floor((ds.meta.height_m - ridgeStep / 2) / ridgeStep) * ridgeStep + ridgeStep / 2; y > 0; y -= ridgeStep) {
        if (p.y >= y - lift(ds, p.x, y)) return { x: p.x, y: y };
      }
      return null;
    }

    function project(p) {
      return { x: p.x, y: p.y - lift(ds, p.x, p.y) };
    }

    function dot(c, p, r) {
      var q = p ? project(p) : null;
      c.setAttribute("cx", q ? q.x : -9999);
      c.setAttribute("cy", q ? q.y : -9999);
      c.setAttribute("r", r * px());
    }

    function draw() {
      dot(ptA, a, 5);
      dot(ptB, b, 5);
      dot(mark, mode === "ridges" && !b ? cursor : null, 3);
      var end = b || cursor;
      if (a && end) {
        var pts = [];
        for (var i = 0; i <= 80; i++) {
          var q = project({ x: a.x + (end.x - a.x) * i / 80, y: a.y + (end.y - a.y) * i / 80 });
          pts.push(q.x.toFixed(1) + "," + q.y.toFixed(1));
        }
        line.setAttribute("points", pts.join(" "));
        line.style.display = "";
      } else {
        line.style.display = "none";
      }
      line.classList.toggle("is-pending", !b);
    }

    function reset() {
      a = b = null;
      panel.hide();
      draw();
    }

    self.hasProfile = function () { return !!a; };
    self.reset = reset;
    self.redraw = draw;

    self.setStep = function (step) {
      if (mode !== "ridges") {
        if (ridges) ridges.remove();
        ridges = null;
        ridgeStep = 0;
        return;
      }
      if (ridges && step === ridgeStep) return;
      if (ridges) ridges.remove();
      ridgeStep = step;
      ridges = ridgeGroup(ds, step);
      o.content.appendChild(ridges);
    };

    self.applyMode = function () {
      o.svg.classList.toggle("show-ridges", mode === "ridges");
      self.setStep(o.step());
      draw();
      if (o.onMode) o.onMode();
    };

    self.move = function (e) {
      if (!ds.grid) return;
      var p = ground(toMap(e));
      cursor = p;
      if (o.readout) {
        o.readout.textContent = p ? readout(ds, p) : defaultText;
        o.readout.classList.toggle("is-live", !!p);
      }
      draw();
    };

    self.leave = function () {
      cursor = null;
      if (o.readout) {
        o.readout.textContent = defaultText;
        o.readout.classList.remove("is-live");
      }
      draw();
    };

    self.click = function (e) {
      if (!ds.grid) return;
      var p = ground(toMap(e));
      if (!p) return;
      if (o.readout) {
        o.readout.textContent = readout(ds, p);
        o.readout.classList.add("is-live");
      }
      if (!a || b) {
        a = p;
        b = null;
        panel.hide();
      } else {
        b = p;
        panel.show(profile(ds, a, b));
      }
      draw();
    };

    maps.push(self);
  }

  function profile(ds, a, b) {
    var n = 160, pts = [], up = 0, down = 0;
    for (var i = 0; i <= n; i++) {
      var h = elevation(ds, a.x + (b.x - a.x) * i / n, a.y + (b.y - a.y) * i / n);
      if (i) { var d = h - pts[i - 1]; if (d > 0) up += d; else down -= d; }
      pts.push(h);
    }
    return { pts: pts, len: Math.hypot(b.x - a.x, b.y - a.y), up: up, down: down };
  }

  function makePanel(host, onClose) {
    var panel = document.createElement("div");
    panel.className = "map-profile";
    panel.hidden = true;
    panel.setAttribute("role", "group");
    panel.setAttribute("aria-label", T.profile);
    panel.innerHTML =
      '<div class="mp-head"><span>' + T.profile + '</span>' +
      '<button class="mp-close" type="button" aria-label="' + T.close + '">×</button></div>' +
      '<div class="mp-chart"><svg viewBox="0 0 300 90" preserveAspectRatio="none" aria-hidden="true">' +
      '<polygon class="mp-fill"/><polyline class="mp-line"/></svg>' +
      '<span class="mp-max"></span><span class="mp-min"></span></div>' +
      '<p class="mp-stats" aria-live="polite"></p>';
    host.appendChild(panel);
    ["click", "pointerdown", "pointerup", "wheel"].forEach(function (t) {
      panel.addEventListener(t, function (e) { e.stopPropagation(); });
    });
    panel.querySelector(".mp-close").addEventListener("click", onClose);
    return {
      hide: function () { panel.hidden = true; },
      show: function (p) {
        var lo = Math.min.apply(null, p.pts), hi = Math.max.apply(null, p.pts), span = Math.max(hi - lo, 10);
        var coords = p.pts.map(function (h, i) {
          return (i * 300 / (p.pts.length - 1)).toFixed(1) + "," + (86 - (h - lo) / span * 80).toFixed(1);
        });
        panel.querySelector(".mp-line").setAttribute("points", coords.join(" "));
        panel.querySelector(".mp-fill").setAttribute("points", "0,90 " + coords.join(" ") + " 300,90");
        panel.querySelector(".mp-max").textContent = Math.round(hi) + " m";
        panel.querySelector(".mp-min").textContent = Math.round(lo) + " m";
        panel.querySelector(".mp-stats").textContent =
          T.length + " " + num(p.len / 1000, 2) + " km · +" + Math.round(p.up) + " / −" + Math.round(p.down) + " m";
        panel.hidden = false;
      },
    };
  }

  function setMode(m) {
    load().then(function () {
      if (!heroData.grid) return;
      mode = m;
      maps.forEach(function (v) { v.applyMode(); });
      document.querySelectorAll(".map-mode button").forEach(function (b) {
        b.setAttribute("aria-pressed", String(b.dataset.mode === mode));
      });
    });
  }

  function modeSwitch() {
    var wrap = document.createElement("div");
    wrap.className = "map-mode";
    wrap.setAttribute("role", "group");
    wrap.setAttribute("aria-label", T.view);
    ["contours", "ridges"].forEach(function (m) {
      var b = document.createElement("button");
      b.type = "button";
      b.dataset.mode = m;
      b.textContent = T[m];
      b.setAttribute("aria-pressed", String(m === mode));
      b.addEventListener("click", function () { setMode(m); });
      wrap.appendChild(b);
    });
    return wrap;
  }

  // --------------------------------------------------------------- hero --
  var heroView = new MapView({
    ds: heroData,
    svg: heroSvg,
    content: heroSvg,
    readout: hero.querySelector(".strip-crs"),
    panelHost: hero,
    step: function () { return 100; },
  });
  var hint = hero.querySelector(".map-hint");

  var controls = document.createElement("div");
  controls.className = "map-controls";
  controls.appendChild(modeSwitch());
  var fullBtn = document.createElement("button");
  fullBtn.type = "button";
  fullBtn.className = "map-full";
  fullBtn.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 6V1.5H6M10 1.5h4.5V6M14.5 10v4.5H10M6 14.5H1.5V10"/></svg>' + T.full;
  controls.appendChild(fullBtn);
  hero.appendChild(controls);
  // the CRS label is not a map click
  [controls, hero.querySelector(".strip-crs")].forEach(function (el) {
    if (!el) return;
    ["click", "pointerdown"].forEach(function (t) {
      el.addEventListener(t, function (e) { e.stopPropagation(); });
    });
  });

  // easter egg: clicking the CRS label cycles through a few in-jokes, then back to EPSG:4326
  var crs = hero.querySelector(".strip-crs"), crsDefault = crs ? crs.textContent : "", crsI = -1;
  if (crs) crs.addEventListener("click", function () {
    if (crs.classList.contains("is-live")) return;
    crsI = crsI + 1 < T.crs.length ? crsI + 1 : -1;
    crs.textContent = crsI < 0 ? crsDefault : T.crs[crsI];
  });

  hero.addEventListener("pointerenter", load);
  hero.addEventListener("pointerdown", load);
  var inStrip = false;
  hero.addEventListener("pointermove", function (e) {
    if (e.pointerType !== "mouse") return;
    // over the top strip: no readout, so the CRS label (and its jokes) can be read
    var s = !!e.target.closest(".hero-strip");
    if (!s) heroView.move(e);
    else if (!inStrip) heroView.leave();
    inStrip = s;
  });
  hero.addEventListener("pointerleave", function () { heroView.leave(); });
  hero.addEventListener("click", function (e) {
    load().then(function () {
      heroView.click(e);
      if (hint && heroView.hasProfile()) hint.hidden = true;
    });
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && heroView.hasProfile() && !(viewer && viewer.open)) heroView.reset();
  });
  if (hint) hint.hidden = false;

  // ----------------------------------------------------------- viewer --
  var viewer = null;

  // Fullscreen opens the region map on the hero's own frame; zoom out for the region.
  function openViewer() {
    fullBtn.classList.add("is-loading");
    Promise.all([heroData.load(), regionData.load()]).then(function () {
      fullBtn.classList.remove("is-loading");
      if (!regionData.grid) return;
      if (!viewer) buildViewer();
      viewer.showModal();
      viewer.showHeroFrame();
      viewer.querySelector(".mv-close").focus();
    });
  }
  fullBtn.addEventListener("click", openViewer);

  function buildViewer() {
    var ds = regionData, M = ds.meta;
    var W = M.width_m, H = M.height_m;
    viewer = document.createElement("dialog");
    viewer.className = "map-viewer";
    viewer.setAttribute("aria-label", T.title);
    viewer.innerHTML =
      '<div class="mv-top"><p class="mv-title">' + T.title + '</p><div class="mv-tools"></div></div>' +
      '<div class="mv-stage"></div>' +
      '<div class="mv-bottom"><p class="mv-readout">' + T.hint + '</p>' +
      '<p class="mv-note"></p><div class="mv-scale" aria-hidden="true"><span class="mv-bar"></span><span class="mv-len"></span></div></div>';
    document.body.appendChild(viewer);

    var tools = viewer.querySelector(".mv-tools");
    tools.appendChild(modeSwitch());
    var zoomBox = document.createElement("div");
    zoomBox.className = "mv-zoom";
    [["−", T.zoomOut, -1], ["+", T.zoomIn, 1], ["⤢", T.reset, 0]].forEach(function (z) {
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = z[0];
      b.setAttribute("aria-label", z[1]);
      b.title = z[1];
      b.addEventListener("click", function () {
        if (z[2] === 0) fit();
        else zoomAt(0, 0, z[2] > 0 ? 1.6 : 1 / 1.6, true);
      });
      zoomBox.appendChild(b);
    });
    tools.appendChild(zoomBox);
    var close = document.createElement("button");
    close.type = "button";
    close.className = "mv-close";
    close.textContent = "×";
    close.setAttribute("aria-label", T.closeMap);
    close.addEventListener("click", function () { viewer.close(); });
    tools.appendChild(close);

    // One SVG: region contours, ridges, places, tools.
    var stage = viewer.querySelector(".mv-stage");
    var svg = el("svg", { class: "topo mv-svg", viewBox: "0 0 " + W + " " + H, preserveAspectRatio: "xMidYMid meet" }, stage);
    var content = el("g", {}, svg);
    var parsed = new DOMParser().parseFromString(ds.svgText, "image/svg+xml").documentElement;
    Array.prototype.forEach.call(parsed.children, function (c) {
      if (c.tagName !== "style") content.appendChild(document.importNode(c, true));
    });
    var labels = content.querySelector(".topo-l");

    // Places (summits found in the DEM), the hero's frame and its location marker.
    var placesG = el("g", { class: "mv-places", "aria-hidden": "true" }, svg);
    var frame = M.hero_frame || [0, 0, 0, 0];
    var frameRect = el("rect", { class: "mv-frame", x: frame[0], y: frame[1], width: frame[2] - frame[0], height: frame[3] - frame[1] }, placesG);
    var placeEls = (M.places || []).map(function (pl) {
      var g = el("g", { class: "mv-place mv-" + pl.kind }, placesG);
      el(pl.kind === "summit" ? "path" : "circle", { class: "mv-sym" }, g);
      var t = el("text", {}, g);
      t.textContent = (de ? pl.de : pl.en) + (pl.elev ? " " + pl.elev + " m" : "");
      return { pl: pl, g: g, sym: g.firstChild, text: t };
    });
    var marker = M.hero_marker ? el("rect", { class: "mv-marker" }, placesG) : null;

    function drawPlaces() {
      var u = perPx();
      frameRect.style.display = mode === "ridges" ? "none" : "";
      placeEls.forEach(function (p) {
        var x = p.pl.x, y = p.pl.y - lift(ds, p.pl.x, p.pl.y);
        if (p.pl.kind === "summit") {
          var s = 5 * u;
          p.sym.setAttribute("d", "M" + x + " " + (y - s) + "L" + (x + s) + " " + (y + s * 0.7) + "L" + (x - s) + " " + (y + s * 0.7) + "Z");
        } else {
          p.sym.setAttribute("cx", x);
          p.sym.setAttribute("cy", y);
          p.sym.setAttribute("r", 3.5 * u);
        }
        p.text.setAttribute("x", x + 9 * u);
        p.text.setAttribute("y", y + 4 * u);
        p.text.setAttribute("font-size", 11 * u);
        p.text.setAttribute("stroke-width", 4 * u);
      });
      if (marker) {
        var mx = M.hero_marker[0], my = M.hero_marker[1] - lift(ds, M.hero_marker[0], M.hero_marker[1]), r = 4.5 * u;
        marker.setAttribute("x", mx - r);
        marker.setAttribute("y", my - r);
        marker.setAttribute("width", 2 * r);
        marker.setAttribute("height", 2 * r);
        marker.setAttribute("transform", "rotate(45 " + mx + " " + my + ")");
      }
    }

    // The viewBox always has the stage's aspect ratio (no letterboxing); it may be
    // wider or taller than the map only when the whole map is in view.
    var vb = { x: 0, y: 0, w: W, h: H };
    var view = new MapView({
      ds: ds,
      svg: svg,
      content: content,
      readout: viewer.querySelector(".mv-readout"),
      panelHost: stage,
      step: ridgeStep,
      onMode: function () { drawPlaces(); },
    });

    function aspect() {
      var r = stage.getBoundingClientRect();
      return r.width / Math.max(r.height, 1);
    }
    function maxW() { return Math.max(W, H * aspect()); }
    function perPx() { return vb.w / Math.max(stage.getBoundingClientRect().width, 1); }
    // ridge rows ~8-16 px apart on screen; never finer than the 100 m grid
    function ridgeStep() { var u = perPx(); return u < 8 ? 100 : u < 16 ? 200 : 400; }

    function apply() {
      var ar = aspect();
      vb.w = Math.min(Math.max(vb.w, 1500), maxW());
      vb.h = vb.w / ar;
      vb.x = vb.w >= W ? (W - vb.w) / 2 : Math.min(Math.max(vb.x, 0), W - vb.w);
      vb.y = vb.h >= H ? (H - vb.h) / 2 : Math.min(Math.max(vb.y, 0), H - vb.h);
      svg.setAttribute("viewBox", [vb.x, vb.y, vb.w, vb.h].join(" "));
      if (labels) {
        // labels stay ~10 px on screen at any zoom
        labels.setAttribute("font-size", 10 * perPx());
        labels.setAttribute("stroke-width", 4.5 * perPx());
      }
      view.setStep(ridgeStep());
      view.redraw();
      drawPlaces();
      scale();
    }

    function scale() {
      var m = svg.getScreenCTM();
      if (!m) return;
      var perPx = 1 / m.a, len = 100;
      [100, 200, 500, 1000, 2000, 5000, 10000].forEach(function (L) { if (L / perPx <= 160) len = L; });
      viewer.querySelector(".mv-bar").style.width = len / perPx + "px";
      viewer.querySelector(".mv-len").textContent = len >= 1000 ? num(len / 1000, 0) + " km" : len + " m";
      viewer.querySelector(".mv-note").textContent = mode === "ridges" ? T.exag(ds.exag) : T.ci;
    }

    function zoomAt(mx, my, f, centre) {
      var cx = centre ? vb.x + vb.w / 2 : mx, cy = centre ? vb.y + vb.h / 2 : my;
      var nw = Math.min(Math.max(vb.w / f, 1500), maxW());
      var k = nw / vb.w;
      vb.x = cx - (cx - vb.x) * k;
      vb.y = cy - (cy - vb.y) * k;
      vb.w = nw;
      apply();
    }

    function toMapRaw(e) {
      var pt = svg.createSVGPoint();
      pt.x = e.clientX;
      pt.y = e.clientY;
      return pt.matrixTransform(svg.getScreenCTM().inverse());
    }

    // Whole map on landscape screens; on portrait screens fill the height (pan sideways).
    function fit() {
      var ar = aspect();
      vb.w = ar < 1 ? H * ar : maxW();
      vb.x = (W - vb.w) / 2;
      vb.y = 0;
      apply();
    }
    viewer.fit = fit;
    // start on the area the hero shows
    viewer.showHeroFrame = function () {
      var ar = aspect();
      var fw = frame[2] - frame[0], fh = frame[3] - frame[1];
      vb.w = Math.max(fw, fh * ar);
      vb.x = (frame[0] + frame[2]) / 2 - vb.w / 2;
      vb.y = (frame[1] + frame[3]) / 2 - vb.w / ar / 2;
      apply();
    };

    // pointer: drag = pan, two fingers = pinch, short tap/click = profile point
    var pointers = {}, moved = 0, pinch = null;
    svg.addEventListener("pointerdown", function (e) {
      svg.setPointerCapture(e.pointerId);
      pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      moved = 0;
      var ids = Object.keys(pointers);
      if (ids.length === 2) {
        var p = pointers[ids[0]], q = pointers[ids[1]];
        pinch = { d: Math.hypot(p.x - q.x, p.y - q.y) };
      }
    });
    svg.addEventListener("pointermove", function (e) {
      var prev = pointers[e.pointerId];
      if (!prev) {
        if (e.pointerType === "mouse") view.move(e);
        return;
      }
      var dx = e.clientX - prev.x, dy = e.clientY - prev.y;
      pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      moved += Math.abs(dx) + Math.abs(dy);
      var ids = Object.keys(pointers);
      if (ids.length === 2 && pinch) {
        var p = pointers[ids[0]], q = pointers[ids[1]];
        var d = Math.hypot(p.x - q.x, p.y - q.y);
        var mid = toMapRaw({ clientX: (p.x + q.x) / 2, clientY: (p.y + q.y) / 2 });
        zoomAt(mid.x, mid.y, d / pinch.d);
        pinch.d = d;
      } else if (ids.length === 1 && moved > 4) {
        var perPx = 1 / svg.getScreenCTM().a;
        vb.x -= dx * perPx;
        vb.y -= dy * perPx;
        apply();
        svg.classList.add("is-panning");
      }
    });
    function up(e) {
      var wasClick = moved <= 4 && Object.keys(pointers).length === 1;
      delete pointers[e.pointerId];
      if (Object.keys(pointers).length < 2) pinch = null;
      svg.classList.remove("is-panning");
      if (wasClick && e.type === "pointerup") view.click(e);
    }
    svg.addEventListener("pointerup", up);
    svg.addEventListener("pointercancel", up);
    svg.addEventListener("pointerleave", function () { view.leave(); });
    svg.addEventListener("wheel", function (e) {
      e.preventDefault();
      var p = toMapRaw(e);
      zoomAt(p.x, p.y, Math.exp(-e.deltaY * 0.0015));
    }, { passive: false });

    viewer.addEventListener("keydown", function (e) {
      var step = vb.w * 0.1;
      var keys = { "+": function () { zoomAt(0, 0, 1.6, true); }, "=": function () { zoomAt(0, 0, 1.6, true); },
                   "-": function () { zoomAt(0, 0, 1 / 1.6, true); }, "0": fit,
                   ArrowLeft: function () { vb.x -= step; apply(); }, ArrowRight: function () { vb.x += step; apply(); },
                   ArrowUp: function () { vb.y -= step; apply(); }, ArrowDown: function () { vb.y += step; apply(); } };
      if (keys[e.key]) {
        e.preventDefault();
        keys[e.key]();
      }
    });
    // Esc clears a profile first, then closes.
    viewer.addEventListener("cancel", function (e) {
      if (view.hasProfile()) {
        e.preventDefault();
        view.reset();
      }
    });
    viewer.addEventListener("close", function () { fullBtn.focus(); });
    window.addEventListener("resize", function () { if (viewer.open) apply(); });

    // keep the scale note ("vertical exaggeration") in sync with the view mode
    var applyMode = view.applyMode;
    view.applyMode = function () { applyMode(); scale(); };
    view.applyMode();
  }
})();
