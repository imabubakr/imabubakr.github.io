// Page finale: the Feldberg as a 3D point cloud colored from an orthophoto, the way LiDAR is shown today.
// The page opens on an old folded paper map that blows away as sand (the hero); it ends, after the plates,
// with that sand coming back: grains drift in from above and settle into a grey point cloud of the summit
// (like LiDAR intensity), then the orthophoto's color spreads out from the summit in an accent ring, like a
// ripple. Eye-dome lighting (as in point-cloud viewers like Potree or CloudCompare) shades depth edges so
// ridges and tree lines stand out; the round footprint fades out softly at its rim. Labelled at the summit.
//
// backdrop.js calls window.flightFinale(view) after every frame with its camera, so the points sit exactly
// where the ridge lines are (same projection, same vertical exaggeration); view.k is the finale's progress
// (0..1), eased with the camera. Phases: 0-0.4 the sand settles, 0.42-0.97 the color ring.
//
// Data (tools/finale/build_feldberg.py): assets/topo/feldberg-dop.webp (LGL-BW DOP20, dl-de/by-2-0),
// feldberg-dem.bin (Copernicus GLO-30, 25 m, Int16, row 0 = north), feldberg.json; loaded when Contact
// comes near. The points are sampled every SPACING m (jittered, heights interpolated) inside a round
// footprint around the summit and take the color of the orthophoto below them. WebGL only; without it, or
// under reduced motion, the flight ends as before. Without render-to-texture, no eye-dome lighting.
(function () {
  var root = document.documentElement;
  var contact = document.getElementById("contact");
  var hero = document.querySelector("[data-topo]");
  if (!contact || !hero || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  var base = hero.getAttribute("data-topo");
  var de = root.lang === "de";

  var SPACING = 8;            // point spacing (m)
  var RADIUS = 2800;          // the round scan footprint (m), centred AHEAD m beyond the summit as seen from
  var AHEAD = 1000;           // the flight (route heading HEAD), so its near side stays short; the rim fades out
  var HEAD = [0.6329, 0.7742];
  var EDL = 160;              // eye-dome lighting strength

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
    "attribute vec3 aPos;",            // x, y: m from the tile's north-west corner (y south); z: elevation (m)
    "attribute vec3 aCol;",            // orthophoto color
    "attribute vec3 aRnd;",            // per point: delay, start x, start y (0..1)
    "uniform vec3 uCam;",              // camera relative to the tile corner (z in scene units)
    "uniform vec4 uH;",                // heading (hx, hy) and right (rx, ry)
    "uniform vec4 uP;",                // cos / sin pitch, vertical exaggeration, base level
    "uniform vec4 uS;",                // focal length F, screen centre PX, PY, device pixel ratio
    "uniform vec4 uWH;",               // viewport w, h; point spacing (m); gather progress
    "uniform vec4 uTop;",              // the summit and the footprint's centre (tile coordinates)
    "uniform float uRad;",             // the footprint's radius
    "varying vec3 vCol; varying float vFly; varying float vZ; varying float vR; varying float vRim;",
    "void main() {",
    "  vR = length(aPos.xy - uTop.xy);",
    "  vRim = 1.0 - smoothstep(0.8, 1.0, length(aPos.xy - uTop.zw) / uRad);",   // the soft rim
    "  vec3 d = vec3(aPos.xy - uCam.xy, (aPos.z - uP.w) * uP.z - uCam.z);",
    "  float fh = d.x * uH.x + d.y * uH.y, rt = d.x * uH.z + d.y * uH.w;",
    "  float zc = fh * uP.x + d.z * uP.y, yc = -fh * uP.y + d.z * uP.x;",
    "  float n = 50.0, f = 400000.0;",
    "  vec4 p = vec4((2.0 * uS.y / uWH.x - 1.0) * zc + 2.0 * uS.x * rt / uWH.x,",
    "                (1.0 - 2.0 * uS.z / uWH.y) * zc + 2.0 * uS.x * yc / uWH.y,",
    "                (zc * (f + n) - 2.0 * f * n) / (f - n), zc);",
    "  float size = clamp(uS.x * uWH.z * 1.5 / zc, 1.0, 7.0);",            // close the gaps, near and far
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
    "uniform vec4 uScan;",             // ring radius (front), ring width, grey opacity, dim
    "uniform vec3 uInk; uniform vec3 uAcc; uniform vec3 uSand;",
    "uniform float uPass;",            // 0: color, 1: depth (packed into rgb)
    "varying vec3 vCol; varying float vFly; varying float vZ; varying float vR; varying float vRim;",
    "vec3 pack(float v) { vec3 e = fract(v * vec3(1.0, 255.0, 65025.0)); e -= e.yzz * vec3(1.0 / 255.0, 1.0 / 255.0, 0.0); return e; }",
    "void main() {",
    "  float behind = uScan.x - vR;",  // inside the ring: colored
    "  vec3 grey = vec3(dot(vCol, vec3(0.3, 0.59, 0.11)));",
    "  vec3 c = behind > 0.0 ? vCol * uScan.w : mix(uInk, grey, 0.35);",   // outside: LiDAR intensity in ink tones
    "  if (behind > 0.0) c = mix(c, uAcc, 0.9 * (1.0 - smoothstep(0.0, uScan.y, behind)));",
    "  float a = (behind > 0.0 ? 1.0 : uScan.z) * vRim;",
    "  if (vFly > 0.0) { c = mix(c, uSand, vFly); a = mix(a, 0.35, vFly); }",  // grains of sand in flight
    "  if (a < 0.01) discard;",
    "  gl_FragColor = uPass > 0.5 ? vec4(pack(vZ), 1.0) : vec4(c, a);",
    "}",
  ].join("\n");
  // eye-dome lighting: darken a pixel by how much nearer its neighbours are (log depth)
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
    "  if (c.a < 0.004) discard;",
    "  float d = dep(vUV), s = 0.0;",
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
    prog = program(VS, FS, ["aPos", "aCol", "aRnd", "uCam", "uH", "uP", "uS", "uWH", "uScan", "uInk", "uAcc", "uSand", "uPass", "uTop", "uRad"], P);
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
    var nx = Math.floor((x1 - x0) / SPACING), ny = Math.floor((y1 - y0) / SPACING), max = nx * ny;
    var pos = new Float32Array(max * 3), col = new Uint8Array(max * 3), rn = new Uint8Array(max * 3), seed = 7, k = 0;
    function rnd() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }
    for (var j = 0; j < ny; j++) for (i = 0; i < nx; i++) {
      var x = x0 + (i + 0.2 + 0.6 * rnd()) * SPACING, y = y0 + (j + 0.2 + 0.6 * rnd()) * SPACING;
      var r = Math.hypot(x - cx, y - cy) / RADIUS;
      if (r > 1) continue;                          // round footprint (its rim fades out in the shader)
      pos[3 * k] = x; pos[3 * k + 1] = y; pos[3 * k + 2] = height(x, y);
      var p = (Math.min(T - 1, Math.floor((y / size) * T)) * T + Math.min(T - 1, Math.floor((x / size) * T))) * 4;
      col[3 * k] = px[p]; col[3 * k + 1] = px[p + 1]; col[3 * k + 2] = px[p + 2];
      rn[3 * k] = rnd() * 255; rn[3 * k + 1] = rnd() * 255; rn[3 * k + 2] = rnd() * 255;
      k++;
    }
    cloud = {
      pos: buf(pos.subarray(0, k * 3)), col: buf(col.subarray(0, k * 3)), rnd: buf(rn.subarray(0, k * 3)), count: k,
      box: [x0, y0, x1, y1], height: height, centre: [cx, cy],
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
    var gather = k / 0.4, ring = smooth((k - 0.42) / 0.55);
    var front = ring > 0 ? (RADIUS + AHEAD + 200) * ring : -1e9;   // the ring's radius around the summit
    var dark = rgb(cs.getPropertyValue("--paper").trim())[0] < 0.3;

    gl.useProgram(prog);
    gl.uniform4f(P.uTop, cloud.top[0], cloud.top[1], cloud.centre[0], cloud.centre[1]);
    gl.uniform1f(P.uRad, RADIUS);
    gl.uniform3f(P.uCam, v.CX - X0, v.CY - Y0, v.CZ);
    gl.uniform4f(P.uH, v.hx, v.hy, v.rx, v.ry);
    gl.uniform4f(P.uP, v.cp, v.sp, v.ex, v.H0);
    gl.uniform4f(P.uS, v.F, v.PX, v.PY, v.dpr);
    gl.uniform4f(P.uWH, v.w, v.h, SPACING, gather);
    gl.uniform4f(P.uScan, front, 140, 0.75, dark ? 0.85 : 1);
    gl.uniform3fv(P.uInk, rgb(cs.getPropertyValue("--ink").trim()));
    gl.uniform3fv(P.uAcc, rgb(cs.getPropertyValue("--accent-mark").trim()));
    gl.uniform3fv(P.uSand, rgb(cs.getPropertyValue("--contour").trim()));
    [[cloud.pos, P.aPos, gl.FLOAT, false], [cloud.col, P.aCol, gl.UNSIGNED_BYTE, true], [cloud.rnd, P.aRnd, gl.UNSIGNED_BYTE, true]].forEach(function (a) {
      gl.bindBuffer(gl.ARRAY_BUFFER, a[0]);
      gl.enableVertexAttribArray(a[1]);
      gl.vertexAttribPointer(a[1], 3, a[2], a[3], 0, 0);
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
      for (var a = 0; a < 3; a++) gl.disableVertexAttribArray(a);
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

    // ---- overlay: the summit label
    oc.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
    oc.clearRect(0, 0, v.w, v.h);
    var ink = cs.getPropertyValue("--ink").trim(), paper = cs.getPropertyValue("--paper").trim();
    function screen(f2, l2, z) {                    // view coordinates (forward, lateral, real elevation) -> px
      var dz = (z - v.H0) * v.ex - v.CZ, zc = f2 * v.cp + dz * v.sp, yc = -f2 * v.sp + dz * v.cp;
      return zc > 1 ? [v.PX + (v.F * l2) / zc, v.PY - (v.F * yc) / zc] : null;
    }
    // label at the summit once the ring has left it
    var t = cloud.top, dx = X0 + t[0] - v.CX, dy = Y0 + t[1] - v.CY;
    var sp = front > 400 ? screen(dx * v.hx + dy * v.hy, dx * v.rx + dy * v.ry, t[2]) : null;
    if (sp) {
      var sx = sp[0], sy = sp[1];
      oc.globalAlpha = 1;
      oc.strokeStyle = ink;
      oc.lineWidth = 1;
      oc.beginPath(); oc.moveTo(sx, sy - 4); oc.lineTo(sx, sy - 26); oc.stroke();
      oc.textAlign = "center";
      if ("letterSpacing" in oc) oc.letterSpacing = "1.5px";
      oc.font = '500 10px "IBM Plex Mono", monospace';
      var txt = "FELDBERG  " + t[2].toLocaleString(root.lang) + " M", tw = oc.measureText(txt).width;
      oc.fillStyle = paper; oc.fillRect(sx - tw / 2 - 6, sy - 58, tw + 12, 16);
      oc.fillStyle = ink; oc.fillText(txt, sx, sy - 46);
      var cap = de ? "PUNKTWOLKE · EINGEFÄRBT AUS ORTHOFOTO" : "POINT CLOUD · COLORED FROM ORTHOPHOTO";
      oc.font = '400 9px "IBM Plex Mono", monospace';
      var cw = oc.measureText(cap).width;
      oc.fillStyle = paper; oc.fillRect(sx - cw / 2 - 6, sy - 42, cw + 12, 13);
      oc.fillStyle = cs.getPropertyValue("--muted").trim(); oc.fillText(cap, sx, sy - 32);
    }
  };

  document.body.insertBefore(over, document.body.firstChild);
  document.body.insertBefore(canvas, document.body.firstChild);
})();
