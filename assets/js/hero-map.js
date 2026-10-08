// Hero map tools: live coordinates + elevation under the pointer, and an elevation
// profile between two clicked points. Data (a 50 m elevation grid and a map→lat/lon
// formula, both from tools/contours/dem_grid.py) loads on first interaction only.
(function () {
  var hero = document.querySelector(".hero[data-topo]");
  var topo = hero && hero.querySelector("svg.topo");
  if (!topo || !window.fetch) return;

  var de = document.documentElement.lang === "de";
  var T = de
    ? { profile: "Höhenprofil", close: "Profil schließen", length: "Länge", dec: ",", E: "O", W: "W" }
    : { profile: "elevation profile", close: "Close profile", length: "length", dec: ".", E: "E", W: "W" };
  var base = hero.dataset.topo;
  var crs = hero.querySelector(".strip-crs");
  var crsText = crs ? crs.textContent : "";
  var hint = hero.querySelector(".map-hint");
  var meta = null;
  var grid = null;
  var loading = null;
  var a = null; // first point of the profile line
  var b = null; // second point
  var overlay, line, ptA, ptB, panel;

  function load() {
    if (!loading) {
      loading = fetch(base + "hero-contours.json")
        .then(function (r) { return r.json(); })
        .then(function (m) {
          meta = m;
          return fetch(base + m.grid.file);
        })
        .then(function (r) { return r.arrayBuffer(); })
        .then(function (buf) {
          grid = new Int16Array(buf);
          build();
        })
        .catch(function () { loading = null; });
    }
    return loading;
  }

  // ------------------------------------------------------------ geometry --
  function toMap(evt) {
    var m = topo.getScreenCTM();
    if (!m) return null;
    var pt = topo.createSVGPoint();
    pt.x = evt.clientX;
    pt.y = evt.clientY;
    var p = pt.matrixTransform(m.inverse());
    return p.x >= 0 && p.y >= 0 && p.x <= meta.width_m && p.y <= meta.height_m ? { x: p.x, y: p.y } : null;
  }

  function elevation(x, y) {
    var g = meta.grid;
    var fx = Math.min(Math.max(x / g.cell_m[0] - 0.5, 0), g.cols - 1);
    var fy = Math.min(Math.max(y / g.cell_m[1] - 0.5, 0), g.rows - 1);
    var x0 = Math.floor(fx), y0 = Math.floor(fy);
    var x1 = Math.min(x0 + 1, g.cols - 1), y1 = Math.min(y0 + 1, g.rows - 1);
    var tx = fx - x0, ty = fy - y0;
    var v = function (c, r) { return grid[r * g.cols + c]; };
    return (v(x0, y0) * (1 - tx) + v(x1, y0) * tx) * (1 - ty) + (v(x0, y1) * (1 - tx) + v(x1, y1) * tx) * ty;
  }

  function lonLat(x, y) {
    var t = [1, x, y, x * x, x * y, y * y];
    var poly = function (c) { return c.reduce(function (s, k, i) { return s + k * t[i]; }, 0); };
    return [poly(meta.lonlat.lon), poly(meta.lonlat.lat)];
  }

  function num(v, digits) {
    return Math.abs(v).toFixed(digits).replace(".", T.dec);
  }

  function readout(p) {
    var ll = lonLat(p.x, p.y);
    return num(ll[1], 4) + "°" + (ll[1] >= 0 ? "N" : "S") + " " + num(ll[0], 4) + "°" +
      (ll[0] >= 0 ? T.E : T.W) + " · " + Math.round(elevation(p.x, p.y)) + " m";
  }

  // ------------------------------------------------------------ drawing --
  var NS = "http://www.w3.org/2000/svg";
  function el(name, attrs, parent) {
    var e = document.createElementNS(NS, name);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  function build() {
    overlay = el("svg", { class: "map-tools", viewBox: "0 0 " + meta.width_m + " " + meta.height_m, "aria-hidden": "true" });
    line = el("line", { class: "mt-line" }, overlay);
    ptA = el("circle", { class: "mt-pt" }, overlay);
    ptB = el("circle", { class: "mt-pt" }, overlay);
    topo.parentNode.appendChild(overlay);

    panel = document.createElement("div");
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
    hero.appendChild(panel);
    panel.addEventListener("click", function (e) { e.stopPropagation(); });
    panel.querySelector(".mp-close").addEventListener("click", reset);
    draw();
  }

  function setPoint(c, p) {
    // Radius in map units so the dot stays ~5 px whatever the zoom.
    var r = 5 * meta.width_m / topo.getBoundingClientRect().width;
    c.setAttribute("cx", p ? p.x : -999);
    c.setAttribute("cy", p ? p.y : -999);
    c.setAttribute("r", r);
  }

  function draw(cursor) {
    if (!overlay) return;
    var end = b || cursor;
    setPoint(ptA, a);
    setPoint(ptB, b);
    line.setAttribute("x1", a ? a.x : 0);
    line.setAttribute("y1", a ? a.y : 0);
    line.setAttribute("x2", a && end ? end.x : 0);
    line.setAttribute("y2", a && end ? end.y : 0);
    line.style.display = a && end ? "" : "none";
    line.classList.toggle("is-pending", !b);
  }

  function profile() {
    var n = 160, pts = [], up = 0, down = 0;
    var len = Math.hypot(b.x - a.x, b.y - a.y);
    for (var i = 0; i <= n; i++) {
      var h = elevation(a.x + (b.x - a.x) * i / n, a.y + (b.y - a.y) * i / n);
      if (i) { var d = h - pts[i - 1]; if (d > 0) up += d; else down -= d; }
      pts.push(h);
    }
    var lo = Math.min.apply(null, pts), hi = Math.max.apply(null, pts);
    var span = Math.max(hi - lo, 10);
    var coords = pts.map(function (h, i) {
      return (i * 300 / n).toFixed(1) + "," + (86 - (h - lo) / span * 80).toFixed(1);
    });
    panel.querySelector(".mp-line").setAttribute("points", coords.join(" "));
    panel.querySelector(".mp-fill").setAttribute("points", "0,90 " + coords.join(" ") + " 300,90");
    panel.querySelector(".mp-max").textContent = Math.round(hi) + " m";
    panel.querySelector(".mp-min").textContent = Math.round(lo) + " m";
    panel.querySelector(".mp-stats").textContent =
      T.length + " " + num(len / 1000, 2) + " km · +" + Math.round(up) + " / −" + Math.round(down) + " m";
    panel.hidden = false;
    if (hint) hint.hidden = true;
  }

  function reset() {
    a = b = null;
    if (panel) panel.hidden = true;
    draw();
  }

  // ------------------------------------------------------------- events --
  hero.addEventListener("pointerenter", load);
  hero.addEventListener("pointerdown", load);

  hero.addEventListener("pointermove", function (e) {
    if (!grid || e.pointerType !== "mouse") return;
    var p = toMap(e);
    if (crs) {
      crs.textContent = p ? readout(p) : crsText;
      crs.classList.toggle("is-live", !!p);
    }
    if (a && !b) draw(p);
  });

  hero.addEventListener("pointerleave", function () {
    if (crs) {
      crs.textContent = crsText;
      crs.classList.remove("is-live");
    }
    if (a && !b) draw();
  });

  hero.addEventListener("click", function (e) {
    load().then(function () {
      if (!grid) return;
      var p = toMap(e);
      if (!p) return;
      if (crs) {
        crs.textContent = readout(p);
        crs.classList.add("is-live");
      }
      if (!a || b) {
        a = p;
        b = null;
        panel.hidden = true;
      } else {
        b = p;
        profile();
      }
      draw();
    });
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && a) reset();
  });

  if (hint) hint.hidden = false;
})();
