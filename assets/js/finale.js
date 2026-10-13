// Page finale: the Feldberg as a 3D point cloud colored from an orthophoto, the way LiDAR is shown today.
// The page opens on an old folded paper map that rises into 3D and blows away as sand (the hero); it ends,
// after the plates, with that sand coming back: grains drift in from above and settle into a flat colored map,
// which then rises into the mountain (as the hero's map did), while the flight's ridge lines give way
// (backdrop.js). Then today's sun crosses it: the real sun path at the Feldberg for the visitor's date, from
// the low morning sun to the evening, with slope shading, cast shadows (marched through the DEM) and warm
// light while the sun is low. Eye-dome lighting (as in point-cloud viewers like Potree or CloudCompare) shades
// depth edges. The footprint is a set of flight strips with staggered crisp ends, like a drone survey's raw
// data. Labelled above the summit with a live sun-time line.
//
// backdrop.js calls window.flightFinale(view) after every frame with its camera, so the points sit exactly
// where the ridge lines are (same projection, same vertical exaggeration); view.k is the finale's progress
// (0..1), eased with the camera. Phases: 0-0.4 the sand settles (flat), 0.4-0.8 the rise, 0.4-0.95 the sun.
//
// Data (tools/finale/build_feldberg.py): assets/topo/feldberg-dop.webp (LGL-BW DOP20, dl-de/by-2-0),
// feldberg-dem.bin (Copernicus GLO-30, 25 m, Int16, row 0 = north), feldberg.json; loaded when Contact
// comes near. The points are sampled every SPACING m (jittered, heights interpolated) and take the color of
// the orthophoto below them. WebGL only; without it, or under reduced motion, the flight ends as before.
// Without render-to-texture, no eye-dome lighting; without vertex texture fetch, no cast shadows.
(function () {
  var root = document.documentElement;
  var contact = document.getElementById("contact");
  var hero = document.querySelector("[data-topo]");
  if (!contact || !hero || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  var base = hero.getAttribute("data-topo");
  var de = root.lang === "de";

  var SPACING = 8;            // point spacing (m)
  var RADIUS = 2800;          // the footprint (m), centred AHEAD m beyond the summit as seen from the flight
  var AHEAD = 1000;           // (route heading HEAD), so its near side stays short
  var HEAD = [0.6329, 0.7742];
  var STRIP_W = 280;          // width of one flight strip (m); the strips run across the heading
  var FRINGE = 8, SCAN = 22;  // the LiDAR edge: scan lines beyond each strip's end, SCAN m apart, thinning out
  var SCAN_DL = 2.5;          // point spacing along a scan line (m)
  var EDL = 160;              // eye-dome lighting strength
  var SHADOW_RELIEF = 1.4;    // cast shadows with the relief as drawn (~1.4x real at the Feldberg)

  // Today's sun at the Feldberg (47.874 N, 8.004 E): declination and equation of time from the day of the
  // year (NOAA approximations), German clock time (CET / CEST). The sweep runs from 45 min after sunrise to
  // 45 min before sunset (solar time), so the sun is low at both ends.
  var LAT = 47.874 * Math.PI / 180, LON = 8.004;
  var today = new Date(), Y = today.getFullYear(), M = today.getMonth(), Dd = today.getDate();
  var N = Math.round((Date.UTC(Y, M, Dd) - Date.UTC(Y, 0, 0)) / 864e5);
  var DEC = -Math.asin(0.39779 * Math.cos((0.98565 * (N + 10) + 1.914 * Math.sin(0.98565 * (N - 2) * Math.PI / 180)) * Math.PI / 180));
  var EB = 2 * Math.PI * (N - 81) / 365, EOT = 9.87 * Math.sin(2 * EB) - 7.53 * Math.cos(EB) - 1.5 * Math.sin(EB);   // min
  function lastSunday(m) { var d = new Date(Date.UTC(Y, m + 1, 0)); return d.getUTCDate() - d.getUTCDay(); }
  var summer = (M > 2 && M < 9) || (M === 2 && Dd >= lastSunday(2)) || (M === 9 && Dd < lastSunday(9));
  var CLOCK = (summer ? 2 : 1) - LON / 15 - EOT / 60;   // clock time = solar time + CLOCK (h)
  var DAY = Math.acos(Math.max(-1, Math.min(1, -Math.tan(LAT) * Math.tan(DEC)))) * 12 / Math.PI;   // sunrise to noon (h)
  var SUN0 = 12 - DAY + 0.75, SUN1 = 12 + DAY - 0.75;
  var DATE = de
    ? Dd + ". " + ["JAN.", "FEB.", "MÄRZ", "APR.", "MAI", "JUNI", "JULI", "AUG.", "SEPT.", "OKT.", "NOV.", "DEZ."][M]
    : Dd + " " + ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"][M];

  var canvas = document.createElement("canvas"), gl = null;
  canvas.className = "finale";
  canvas.setAttribute("aria-hidden", "true");
  var over = document.createElement("canvas"), oc = over.getContext("2d");   // the label on top
  over.className = "finale finale-labels";
  over.setAttribute("aria-hidden", "true");

  var meta = null, dem = null, img = null, loading = false, ready = false, last = null;
  var P = {}, Q = {}, prog = null, quad = null, cloud = null, fb = null;

  function smooth(t) { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); }

  function load() {
    if (loading) return;
    loading = true;
    Promise.all([
      fetch(base + "feldberg.json").then(function (r) { return r.json(); }),
      fetch(base + "feldberg-dem.bin").then(function (r) { return r.arrayBuffer(); }),
      new Promise(function (ok, fail) { var i = new Image(); i.onload = function () { ok(i); }; i.onerror = fail; i.src = base + "feldberg-dop.webp"; }),
    ]).then(function (r) {
      meta = r[0]; dem = new Int16Array(r[1]); img = r[2];
      // building the points takes a moment: do it when the browser is idle, not in the middle of a scroll
      (window.requestIdleCallback || function (f) { setTimeout(f, 200); })(function () {
        if (setup()) { ready = true; if (last) window.flightFinale(last); }
      }, { timeout: 1500 });
    }).catch(function () {});
  }

  // ------------------------------------------------------------- shaders --
  var VS = [
    "attribute vec4 aPos;",            // x, y: m from the tile's north-west corner (y south); z: elevation (m); w: spacing (m, sets the size)
    "attribute vec3 aCol;",            // orthophoto color
    "attribute vec3 aRnd;",            // per point: delay, start x, start y (0..1)
    "attribute vec3 aNrm;",            // the ground's normal (relief x2, for the sun)
    "uniform vec3 uCam;",              // camera relative to the tile corner (z in scene units)
    "uniform vec4 uH;",                // heading (hx, hy) and right (rx, ry)
    "uniform vec4 uP;",                // cos / sin pitch, vertical exaggeration, base level
    "uniform vec4 uS;",                // focal length F, screen centre PX, PY, device pixel ratio
    "uniform vec4 uWH;",               // viewport w, h; point spacing (m); gather progress
    "uniform vec4 uSun;",              // direction to the sun (x east, y south, z up), strength (0 = off)
    "uniform vec4 uRise;",             // rise (0 flat .. 1), the lowest ground (where it lies flat), warm light, shadows on
    "uniform sampler2D uDem;",         // the DEM (heights + 1000 m, 16 bit in r, g) for cast shadows
    "uniform float uSize;",            // the DEM tile's size (m)
    "varying vec3 vCol; varying float vFly; varying float vZ; varying vec3 vLight;",
    "float dh(vec2 p) { vec4 e = texture2D(uDem, p / uSize); return e.r * 65280.0 + e.g * 255.0 - 1000.0; }",
    "void main() {",
    "  float z = uRise.y + (aPos.z - uRise.y) * uRise.x;",                       // rise out of the flat map
    "  vec3 nr = normalize(vec3(aNrm.xy, aNrm.z / max(uRise.x, 0.05)));",
    // cast shadows: march from the point towards the sun through the DEM (relief as drawn)
    "  float sh = 1.0;",
    "  if (uRise.w > 0.5 && uSun.w > 0.0) {",
    "    vec2 dir = normalize(uSun.xy);",
    "    float tn = uSun.z / max(length(uSun.xy), 0.01) / (" + SHADOW_RELIEF.toFixed(2) + " * max(uRise.x, 0.05)), occ = 0.0, dd = 20.0;",
    "    for (int i = 0; i < 24; i++) {",
    "      dd *= 1.2;",
    "      occ = max(occ, (dh(aPos.xy + dir * dd) - aPos.z - 4.0 - dd * tn) / (6.0 + dd * 0.03));",
    "    }",
    "    sh = 1.0 - smoothstep(0.0, 1.0, occ);",
    "  }",
    "  float lam = max(dot(nr, uSun.xyz), 0.0);",
    "  float lit = clamp((0.3 + lam * sh) / (0.3 + uSun.z), 0.22, 1.7);",       // flat sunlit ground keeps its brightness
    // golden hour: warm where the low sun reaches, a little cool in the shade
    "  vec3 tint = mix(vec3(0.9, 0.96, 1.08), vec3(1.12, 0.97, 0.8), sh * smoothstep(0.0, 0.3, lam));",
    "  vLight = mix(vec3(1.0), lit * mix(vec3(1.0), tint, uRise.z), uSun.w);",
    "  vec3 d = vec3(aPos.xy - uCam.xy, (z - uP.w) * uP.z - uCam.z);",
    "  float fh = d.x * uH.x + d.y * uH.y, rt = d.x * uH.z + d.y * uH.w;",
    "  float zc = fh * uP.x + d.z * uP.y, yc = -fh * uP.y + d.z * uP.x;",
    "  float n = 50.0, f = 400000.0;",
    "  vec4 p = vec4((2.0 * uS.y / uWH.x - 1.0) * zc + 2.0 * uS.x * rt / uWH.x,",
    "                (1.0 - 2.0 * uS.z / uWH.y) * zc + 2.0 * uS.x * yc / uWH.y,",
    "                (zc * (f + n) - 2.0 * f * n) / (f - n), zc);",
    "  float size = clamp(uS.x * aPos.w * 1.9 / zc, 1.0, 7.0);",                // close the gaps, near and far
    // the sand: from a start above the top left, along a curve, each grain after its own delay
    "  float t = clamp((uWH.w - aRnd.x * 0.6) / 0.4, 0.0, 1.0); t = t * t * (3.0 - 2.0 * t);",
    "  if (t < 1.0) {",
    "    vec2 s = vec2(mix(-1.5, 0.4, aRnd.y), 1.15 + aRnd.z * 0.6);",
    "    vec2 q = mix(s, p.xy / p.w, t) + vec2(0.25 * (aRnd.z - 0.5), 0.12) * sin(t * 3.14159);",
    "    p = vec4(q * p.w, p.z, p.w);",
    "    size = mix(1.6, size, t);",
    "  }",
    "  gl_Position = p;",
    "  gl_PointSize = size * uS.w;",
    "  vCol = aCol; vFly = 1.0 - t; vZ = log2(max(zc, 1.0)) / 19.0;",
    "}",
  ].join("\n");
  var FS = [
    "#ifdef GL_FRAGMENT_PRECISION_HIGH",
    "precision highp float;",
    "#else",
    "precision mediump float;",
    "#endif",
    "uniform vec3 uSand;",             // the grains in flight: contour color, as the hero's sand
    "uniform float uDim;",             // a little darker on dark paper
    "uniform float uPass;",            // 0: color, 1: depth (packed into rgb)
    "varying vec3 vCol; varying float vFly; varying float vZ; varying vec3 vLight;",
    "vec3 pack(float v) { vec3 e = fract(v * vec3(1.0, 255.0, 65025.0)); e -= e.yzz * vec3(1.0 / 255.0, 1.0 / 255.0, 0.0); return e; }",
    "void main() {",
    "  vec3 c = min(vCol * uDim * vLight, vec3(1.0));",
    "  float a = 1.0;",
    "  if (vFly > 0.0) { c = mix(c, uSand, vFly); a = mix(a, 0.35, vFly); }",  // grains of sand in flight
    "  if (a < 0.01) discard;",
    "  gl_FragColor = uPass > 0.5 ? vec4(pack(vZ), 1.0) : vec4(c, a);",
    "}",
  ].join("\n");
  // eye-dome lighting: darken a pixel by how much nearer its neighbours are (log depth); single-pixel holes
  // between points take their neighbours' color, so the paper never shows through as white specks
  var QVS = "attribute vec2 aXY; varying vec2 vUV; void main() { vUV = aXY * 0.5 + 0.5; gl_Position = vec4(aXY, 0.0, 1.0); }";
  var QFS = [
    "#ifdef GL_FRAGMENT_PRECISION_HIGH",
    "precision highp float;",
    "#else",
    "precision mediump float;",
    "#endif",
    "uniform sampler2D uC; uniform sampler2D uD; uniform vec2 uPx; uniform float uStr;",
    "varying vec2 vUV;",
    "float dep(vec2 uv) { vec4 e = texture2D(uD, uv); return e.a < 0.5 ? 2.0 : dot(e.rgb, vec3(1.0, 1.0 / 255.0, 1.0 / 65025.0)); }",
    "void main() {",
    "  vec4 c = texture2D(uC, vUV);",
    "  float d = dep(vUV), s = 0.0;",
    "  if (c.a < 0.004) {",
    "    vec4 m = vec4(0.0); float dn = 0.0, nn = 0.0;",
    "    for (int i = 0; i < 8; i++) {",
    "      vec2 o = vec2(cos(float(i) * 0.785398), sin(float(i) * 0.785398)) * uPx * 1.5;",
    "      vec4 e = texture2D(uC, vUV + o);",
    "      if (e.a > 0.5) { m += e; dn += dep(vUV + o); nn += 1.0; }",
    "    }",
    "    if (nn < 6.0) discard;",
    "    c = m / nn; d = dn / nn;",
    "  }",
    "  for (int i = 0; i < 8; i++) {",
    "    float an = float(i) * 0.785398;",
    "    s += max(0.0, d - dep(vUV + vec2(cos(an), sin(an)) * uPx * 1.6));",
    "  }",
    "  gl_FragColor = vec4(c.rgb / c.a * max(exp(-s * uStr), 0.5), c.a);",
    "}",
  ].join("\n");

  function shader(type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
  }
  function program(vs, fs, names, out) {
    var v = shader(gl.VERTEX_SHADER, vs), f = shader(gl.FRAGMENT_SHADER, fs);
    if (!v || !f) return null;
    var pr = gl.createProgram();
    gl.attachShader(pr, v); gl.attachShader(pr, f); gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) return null;
    names.forEach(function (k) { out[k] = k[0] === "a" ? gl.getAttribLocation(pr, k) : gl.getUniformLocation(pr, k); });
    return pr;
  }
  function setup() {
    gl = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: false, antialias: false });
    if (!gl) return false;
    prog = program(VS, FS, ["aPos", "aCol", "aRnd", "aNrm", "uCam", "uH", "uP", "uS", "uWH", "uSun", "uRise", "uDem", "uSize", "uSand", "uDim", "uPass"], P);
    if (!prog) return false;
    quad = program(QVS, QFS, ["aXY", "uC", "uD", "uPx", "uStr"], Q);
    if (quad) Q.buf = buf(new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]));

    // the orthophoto's pixels, to color the points
    var T = img.naturalWidth, tc = document.createElement("canvas");
    tc.width = tc.height = T;
    var tx = tc.getContext("2d");
    tx.drawImage(img, 0, 0);
    var px = tx.getImageData(0, 0, T, T).data;

    // the summit and the footprint around it
    var n = meta.n, c = meta.cell, size = meta.size, top = 0, i;
    for (i = 1; i < dem.length; i++) if (dem[i] > dem[top]) top = i;
    var sx = (top % n + 0.5) * c, sy = (Math.floor(top / n) + 0.5) * c;
    var cx = sx + HEAD[0] * AHEAD, cy = sy + HEAD[1] * AHEAD;
    var x0 = Math.max(0, cx - RADIUS), x1 = Math.min(size, cx + RADIUS);
    var y0 = Math.max(0, cy - RADIUS), y1 = Math.min(size, cy + RADIUS);
    function height(x, y) {                         // bilinear between cell centres
      var fx = Math.min(Math.max(x / c - 0.5, 0), n - 1.001), fy = Math.min(Math.max(y / c - 0.5, 0), n - 1.001);
      var ci = Math.floor(fx), cj = Math.floor(fy), u = fx - ci, w = fy - cj, k = cj * n + ci;
      return (dem[k] * (1 - u) + dem[k + 1] * u) * (1 - w) + (dem[k + n] * (1 - u) + dem[k + n + 1] * u) * w;
    }
    // the DEM as a texture (heights + 1000 m in 16 bit: r high, g low byte), for cast shadows in the vertex shader
    var demTex = null;
    if (gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS) > 0) {
      var db = new Uint8Array(n * n * 4);
      for (i = 0; i < n * n; i++) { var hv = Math.max(0, dem[i] + 1000); db[4 * i] = hv >> 8; db[4 * i + 1] = hv & 255; db[4 * i + 3] = 255; }
      demTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, demTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, n, n, 0, gl.RGBA, gl.UNSIGNED_BYTE, db);
      [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER].forEach(function (q) { gl.texParameteri(gl.TEXTURE_2D, q, gl.NEAREST); });
      [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T].forEach(function (q) { gl.texParameteri(gl.TEXTURE_2D, q, gl.CLAMP_TO_EDGE); });
    }
    // the flight strips: across the heading, each as long as the circle there, with staggered ends
    function hash(i) { var h = Math.sin(i * 127.1 + 311.7) * 43758.5453; return h - Math.floor(h); }
    var strips = {};
    for (var si = Math.floor(-RADIUS / STRIP_W); si * STRIP_W < RADIUS; si++) {
      var uc = (si + 0.5) * STRIP_W;
      if (Math.abs(uc) > RADIUS) continue;
      var half = Math.sqrt(RADIUS * RADIUS - uc * uc) * (0.78 + 0.3 * hash(si));
      strips[si] = { uc: uc, mid: (hash(si + 50) - 0.5) * 500, half: half };
    }
    function toXY(u, v) { return [cx + HEAD[0] * u - HEAD[1] * v, cy + HEAD[1] * u + HEAD[0] * v]; }
    var pos = [], col = [], rn = [], nrm = [], zmin = 1e9, seed = 7, k = 0;
    function rnd() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }
    function add(x, y, sp) {
      if (x < 0 || y < 0 || x >= size || y >= size) return;
      var hz = height(x, y);
      pos.push(x, y, hz, sp);
      if (hz < zmin) zmin = hz;
      var gx = (height(x + 12, y) - height(x - 12, y)) / 12, gy = (height(x, y + 12) - height(x, y - 12)) / 12, gn = Math.hypot(gx, gy, 1);
      nrm.push(-gx / gn, -gy / gn, 1 / gn);         // relief x2 (gradient over 24 m, doubled), for livelier shading
      var p = (Math.min(T - 1, Math.floor((y / size) * T)) * T + Math.min(T - 1, Math.floor((x / size) * T))) * 4;
      col.push(px[p], px[p + 1], px[p + 2]);
      rn.push(rnd() * 255, rnd() * 255, rnd() * 255);
      k++;
    }
    // the strips' body: jittered points every SPACING m
    var nx = Math.floor((x1 - x0) / SPACING), ny = Math.floor((y1 - y0) / SPACING);
    for (var j = 0; j < ny; j++) for (i = 0; i < nx; i++) {
      var x = x0 + (i + 0.2 + 0.6 * rnd()) * SPACING, y = y0 + (j + 0.2 + 0.6 * rnd()) * SPACING;
      var u = (x - cx) * HEAD[0] + (y - cy) * HEAD[1], v = -(x - cx) * HEAD[1] + (y - cy) * HEAD[0];
      var st = strips[Math.floor(u / STRIP_W)];
      if (st && Math.abs(v - st.mid) < st.half) add(x, y, SPACING);
    }
    // the LiDAR edge: beyond each strip's end the last scan lines run on as rows of single points, each a little
    // shorter and sparser than the one before, broken off at random, like the end of a real flight line;
    // the outermost strips get the same along their open long side
    function scanLine(a, b, ln, gone, key) {        // a, b: the line's ends in (u, v); ln: its number outwards
      var len = Math.hypot(b[0] - a[0], b[1] - a[1]), cut = 0.5 * gone * hash(key) * len, keep = Math.pow(1 - gone, 1.3);
      for (var l = cut * hash(key + 7); l < len - cut * hash(key + 9); l += SCAN_DL) {
        if (rnd() > keep) { rnd(); continue; }
        var t2 = l / len, jit = (rnd() - 0.5) * 0.8;
        var q = toXY(a[0] + (b[0] - a[0]) * t2 + jit, a[1] + (b[1] - a[1]) * t2);
        add(q[0], q[1], SCAN_DL * 1.3);
      }
    }
    var keys = Object.keys(strips).map(Number), sMin = Math.min.apply(null, keys), sMax = Math.max.apply(null, keys);
    keys.forEach(function (si) {
      var st = strips[si], u0 = st.uc - STRIP_W / 2, u1 = st.uc + STRIP_W / 2;
      for (var ln = 0; ln < FRINGE; ln++) {
        var gone = (ln + 1) / (FRINGE + 1), off = (ln + 0.6) * SCAN;
        [-1, 1].forEach(function (side) {
          var ve = st.mid + side * (st.half + off);
          scanLine([u0, ve], [u1, ve], ln, gone, si * 97 + ln * 13 + side * 5);
        });
        if (si === sMax || (si === sMin && ln < FRINGE / 2)) {   // the open long side of the first and last strip
          // (the near side's fringe is half as long: it would reach over the footer line)
          var ue = si === sMin ? u0 - off : u1 + off;
          scanLine([ue, st.mid - st.half], [ue, st.mid + st.half], ln, gone, si * 31 + ln * 17);
        }
      }
    });
    cloud = {
      pos: buf(new Float32Array(pos)), col: buf(new Uint8Array(col)), rnd: buf(new Uint8Array(rn)), nrm: buf(new Float32Array(nrm)),
      count: k, zmin: zmin, demTex: demTex, height: height, centre: [cx, cy],
      top: [sx, sy, dem[top]],                      // the summit, for the label
    };
    return true;
  }
  function buf(data) {
    var b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    return b;
  }
  // offscreen color and depth targets for the eye-dome lighting
  function targets(W, H) {
    if (fb && fb.w === W && fb.h === H) return fb;
    if (!quad) return null;
    function tex() {
      var t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER].forEach(function (p) { gl.texParameteri(gl.TEXTURE_2D, p, gl.NEAREST); });
      [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T].forEach(function (p) { gl.texParameteri(gl.TEXTURE_2D, p, gl.CLAMP_TO_EDGE); });
      return t;
    }
    var f = { w: W, h: H, fbo: gl.createFramebuffer(), color: tex(), depth: tex(), rb: gl.createRenderbuffer() };
    gl.bindRenderbuffer(gl.RENDERBUFFER, f.rb);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, W, H);
    gl.bindFramebuffer(gl.FRAMEBUFFER, f.fbo);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, f.rb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, f.color, 0);
    var ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (!ok) { quad = null; return null; }
    fb = f;
    return f;
  }
  function rgb(css) {
    var m = css.match(/[0-9a-f]{2}/gi);
    return css[0] === "#" && m ? m.slice(0, 3).map(function (x) { return parseInt(x, 16) / 255; }) : [0.5, 0.5, 0.5];
  }

  // --------------------------------------------------------------- frame --
  window.flightFinale = function (v) {
    last = v;
    var cr = contact.getBoundingClientRect();
    if (cr.top < v.h * 3) load();
    var k = v.k, on = ready && k > 0.005;
    window.flightFinaleOn = on;                    // backdrop.js then leaves out its own summit labels
    var op = on ? 1 : 0;
    if (canvas.style.opacity !== String(op)) canvas.style.opacity = over.style.opacity = String(op);
    if (!on) return;
    var W = Math.round(v.w * v.dpr), H = Math.round(v.h * v.dpr);
    if (canvas.width !== W || canvas.height !== H) { canvas.width = over.width = W; canvas.height = over.height = H; }
    var X0 = meta.x0, Y0 = meta.y0, cs = getComputedStyle(root);
    var dark = rgb(cs.getPropertyValue("--paper").trim())[0] < 0.3;
    var rise = 0.02 + 0.98 * smooth((k - 0.4) / 0.4);
    var sunA = smooth((k - 0.3) / 0.2), labelA = smooth((k - 0.62) / 0.12);
    var solar = SUN0 + (SUN1 - SUN0) * smooth((k - 0.4) / 0.55), HA = (solar - 12) * Math.PI / 12;
    var el = Math.asin(Math.sin(LAT) * Math.sin(DEC) + Math.cos(LAT) * Math.cos(DEC) * Math.cos(HA));
    var az = Math.atan2(Math.sin(HA), Math.cos(HA) * Math.sin(LAT) - Math.tan(DEC) * Math.cos(LAT)) + Math.PI;   // from north, clockwise
    var warm = 1 - smooth((Math.sin(el) - 0.15) / 0.4);   // golden hour while the sun is low

    gl.useProgram(prog);
    gl.uniform3f(P.uCam, v.CX - X0, v.CY - Y0, v.CZ);
    gl.uniform4f(P.uH, v.hx, v.hy, v.rx, v.ry);
    gl.uniform4f(P.uP, v.cp, v.sp, v.ex, v.H0);
    gl.uniform4f(P.uS, v.F, v.PX, v.PY, v.dpr);
    gl.uniform4f(P.uWH, v.w, v.h, SPACING, k / 0.4);
    gl.uniform4f(P.uSun, Math.sin(az) * Math.cos(el), -Math.cos(az) * Math.cos(el), Math.sin(el), sunA);
    gl.uniform4f(P.uRise, rise, cloud.zmin, warm, cloud.demTex ? 1 : 0);
    gl.uniform1f(P.uSize, meta.size);
    if (cloud.demTex) { gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, cloud.demTex); gl.uniform1i(P.uDem, 2); gl.activeTexture(gl.TEXTURE0); }
    gl.uniform3fv(P.uSand, rgb(cs.getPropertyValue("--contour").trim()));
    gl.uniform1f(P.uDim, dark ? 0.85 : 1);
    [[cloud.pos, P.aPos, gl.FLOAT, false, 4], [cloud.col, P.aCol, gl.UNSIGNED_BYTE, true, 3], [cloud.rnd, P.aRnd, gl.UNSIGNED_BYTE, true, 3], [cloud.nrm, P.aNrm, gl.FLOAT, false, 3]].forEach(function (a) {
      if (a[1] < 0) return;
      gl.bindBuffer(gl.ARRAY_BUFFER, a[0]);
      gl.enableVertexAttribArray(a[1]);
      gl.vertexAttribPointer(a[1], a[4], a[2], a[3], 0, 0);
    });
    gl.enable(gl.DEPTH_TEST);
    gl.viewport(0, 0, W, H);
    var f = targets(W, H);
    function pass(depth) {
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.uniform1f(P.uPass, depth ? 1 : 0);
      if (depth) gl.disable(gl.BLEND);
      else { gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA); }
      gl.drawArrays(gl.POINTS, 0, cloud.count);
    }
    if (f) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, f.fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, f.color, 0);
      pass(false);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, f.depth, 0);
      pass(true);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      for (var a = 0; a < 4; a++) gl.disableVertexAttribArray(a);
      gl.useProgram(quad);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.BLEND);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, f.color);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, f.depth);
      gl.uniform1i(Q.uC, 0); gl.uniform1i(Q.uD, 1);
      gl.uniform2f(Q.uPx, 1 / W, 1 / H);
      gl.uniform1f(Q.uStr, EDL);
      gl.bindBuffer(gl.ARRAY_BUFFER, Q.buf);
      gl.enableVertexAttribArray(Q.aXY);
      gl.vertexAttribPointer(Q.aXY, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.disableVertexAttribArray(Q.aXY);
    } else {
      pass(false);
    }

    // ---- overlay: the summit label, above the cloud in the open sky (no boxes: they read as white patches)
    oc.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
    oc.clearRect(0, 0, v.w, v.h);
    function screen(gx, gy, z) {                    // tile coordinates and real elevation (risen) -> px
      var ex = X0 + gx - v.CX, ey = Y0 + gy - v.CY, f2 = ex * v.hx + ey * v.hy, l2 = ex * v.rx + ey * v.ry;
      var dz = (cloud.zmin + (z - cloud.zmin) * rise - v.H0) * v.ex - v.CZ, zc = f2 * v.cp + dz * v.sp, yc = -f2 * v.sp + dz * v.cp;
      return zc > 1 ? [v.PX + (v.F * l2) / zc, v.PY - (v.F * yc) / zc] : null;
    }
    var t = cloud.top, sp = labelA > 0.01 ? screen(t[0], t[1], t[2]) : null;
    if (!sp) return;
    var sx = sp[0], sy = sp[1], top = sy;
    for (var an = 0; an < 6.283; an += 0.1) {       // the cloud's top edge above the summit, on screen
      var gx = cloud.centre[0] + Math.cos(an) * RADIUS, gy = cloud.centre[1] + Math.sin(an) * RADIUS;
      var q = screen(gx, gy, cloud.height(gx, gy));
      if (q && Math.abs(q[0] - sx) < 160) top = Math.min(top, q[1]);
    }
    // three lines (phones: two, without the caption), the first baseline just under the nav
    var narrow = v.w < 600, gap = narrow ? 17 : 34;
    var ly = Math.max(Math.min(sy - 33 - gap, top - 14 - gap), (parseFloat(cs.getPropertyValue("--nav-h")) || 57) + 21);
    var ink = cs.getPropertyValue("--ink").trim();
    oc.globalAlpha = labelA;
    oc.strokeStyle = ink;
    oc.lineWidth = 1;
    oc.beginPath(); oc.moveTo(sx, sy - 4); oc.lineTo(sx, ly + gap + 5); oc.stroke();
    oc.textAlign = "center";
    if ("letterSpacing" in oc) oc.letterSpacing = "1px";
    oc.font = '500 12px "IBM Plex Mono", monospace';     // readable at a glance: 12 / 11 px
    oc.fillStyle = ink;
    oc.fillText("FELDBERG  " + t[2].toLocaleString(root.lang) + " M", sx, ly);
    if (!narrow) {
      oc.font = '400 11px "IBM Plex Mono", monospace';
      oc.fillStyle = cs.getPropertyValue("--muted").trim();
      oc.fillText(de ? "PUNKTWOLKE · EINGEFÄRBT AUS ORTHOFOTO" : "POINT CLOUD · COLORED FROM ORTHOPHOTO", sx, ly + 17);
    }
    // the sun's time today, in ink: the live line (not "SUN", which reads as Sunday)
    var clock = solar + CLOCK, hh = Math.floor(clock), mm = Math.floor((clock - hh) * 12) * 5;
    var tm = (hh < 10 ? "0" : "") + hh + ":" + (mm < 10 ? "0" : "") + mm;
    oc.font = '500 11px "IBM Plex Mono", monospace';
    oc.fillStyle = ink;
    oc.fillText((de ? "SONNENSTAND · " : "SUNLIGHT · ") + DATE + " · " + tm, sx, ly + gap);
  };

  document.body.insertBefore(over, document.body.firstChild);
  document.body.insertBefore(canvas, document.body.firstChild);
})();
