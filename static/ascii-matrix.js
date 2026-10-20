// ASCII-«Матрица»: сцена рендерится во внеэкранный буфер, затем полноэкранный шейдер разбивает экран
// на ячейки-символы. Внутри силуэта (альфа) символ выбирается по яркости из шкалы плотности, снаружи —
// зелёный цифровой дождь из катаканы и цифр. Всё на GPU, один проход: держит 60 fps на 3050 Ti.
// Плюс CameraDirector — «оператор»: плавно меняет ракурсы (общий, 3/4, крупный, снизу) как в видео.
import * as THREE from "three";

// кандидаты для силуэта (порядок неважен — сортируются по реальной заливке пикселями)
const FIGURE_CHARS = " .`'-,:;_~^\"!|/\\()<>=+*ilrt1?7cvxzjfJLYTunoeaskhdbpqwmXZOQ0CUVAKHRDBENMW#%&$@8";
// дождь: полуширинная катакана (зеркально, как в фильме) + цифры и пара латинских
const RAIN_CHARS = "ｦｱｳｴｵｶｷｹｺｻｼｽｾｿﾀﾂﾃﾅﾆﾇﾈﾊﾋﾎﾏﾐﾑﾒﾓﾔﾕﾗﾘﾜ0123456789Z:.=*+<>";
const FONT = '"DejaVu Sans Mono", "Noto Sans Mono CJK JP", "Noto Sans CJK JP", monospace';
const GW = 32, GH = 48, COLS = 16;

function buildAtlas() {
  const probe = document.createElement("canvas"); probe.width = GW; probe.height = GH;
  const pc = probe.getContext("2d", { willReadFrequently: true });
  const raster = ch => {
    pc.clearRect(0, 0, GW, GH); pc.fillStyle = "#fff"; pc.font = `bold ${GH * 0.7}px ${FONT}`;
    pc.textAlign = "center"; pc.textBaseline = "middle"; pc.fillText(ch, GW / 2, GH / 2);
    const d = pc.getImageData(0, 0, GW, GH).data; let s = 0, sig = 0;
    for (let i = 3; i < d.length; i += 4) { s += d[i]; sig = (sig * 31 + d[i]) >>> 0; }
    return { cover: s / (255 * GW * GH), sig };
  };
  // символы, которых нет в шрифтах, рисуются «тофу»-квадратом — отбрасываем их
  const tofu = raster("\u{10FFFD}").sig;
  const figure = [...new Set(FIGURE_CHARS)].map(ch => ({ ch, ...raster(ch) })).sort((a, b) => a.cover - b.cover);
  let rain = [...RAIN_CHARS].filter(ch => raster(ch).sig !== tofu);
  if (rain.length < 12) rain = [..."0123456789Z:.=*+<>$#"];
  const all = [...figure.map(f => ({ ch: f.ch, mirror: false })), ...rain.map(ch => ({ ch, mirror: /[　-￯]/.test(ch) }))];
  const rows = Math.ceil(all.length / COLS);
  const cv = document.createElement("canvas"); cv.width = COLS * GW; cv.height = rows * GH;
  const ctx = cv.getContext("2d");
  ctx.fillStyle = "#000"; ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.font = `bold ${GH * 0.7}px ${FONT}`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillStyle = "#fff"; ctx.shadowColor = "rgba(255,255,255,.55)"; ctx.shadowBlur = 5;   // встроенное свечение
  all.forEach((g, i) => {
    const x = (i % COLS) * GW + GW / 2, y = Math.floor(i / COLS) * GH + GH / 2;
    ctx.save(); ctx.translate(x, y); if (g.mirror) ctx.scale(-1, 1); ctx.fillText(g.ch, 0, 0); ctx.restore();
  });
  const tex = new THREE.CanvasTexture(cv);
  tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter; tex.generateMipmaps = true;
  return { tex, rows, figureLen: figure.length, rainStart: figure.length, rainLen: rain.length };
}

const VERT = `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const FRAG = `
precision highp float;
uniform sampler2D tScene, tAtlas;
uniform vec2 uRes, uCell, uGrid;
uniform float uTime, uFigureLen, uRainStart, uRainLen, uExposure, uRain;
uniform vec3 uColor, uHot;
varying vec2 vUv;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float hash1(float x) { return fract(sin(x * 91.345) * 47453.5453); }
vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }

float glyph(float idx, vec2 inCell) {
  vec2 g = vec2(mod(idx, uGrid.x), floor(idx / uGrid.x));
  vec2 p = vec2(inCell.x, 1.0 - inCell.y);                        // внутри ячейки, y вниз как на канвасе
  p = mix(vec2(0.04), vec2(0.96), p);                               // поля против протекания соседей в мипах
  vec2 uv = vec2((g.x + p.x) / uGrid.x, 1.0 - (g.y + p.y) / uGrid.y);
  return texture2D(tAtlas, uv).r;
}

// одна «струя» дождя в колонке: 0..1 — яркость следа, head=1 у головы
float stream(float col, float row, float rows, float seed, out float head) {
  float speed = mix(4.0, 15.0, hash1(col * 1.7 + seed));            // ячеек в секунду
  float len = mix(6.0, 26.0, hash1(col * 3.1 + seed * 2.0));
  float period = rows + len + mix(0.0, rows, hash1(col + seed * 5.0));
  float pos = mod(uTime * speed + hash1(col * 7.3 + seed) * period, period);
  float d = pos - (rows - row);                                     // >0 — позади головы
  head = step(0.0, d) * step(d, 1.0);
  return d >= 0.0 && d < len ? pow(1.0 - d / len, 1.6) : 0.0;
}

void main() {
  vec2 px = vUv * uRes;
  vec2 cell = floor(px / uCell), inCell = fract(px / uCell);
  vec2 c = (cell + 0.5) * uCell / uRes, d = uCell / uRes;
  // яркость/маска ячейки — 5 отсчётов
  vec4 s = texture2D(tScene, c) * 0.4 + 0.15 * (texture2D(tScene, c + d * vec2(0.3, 0.3)) + texture2D(tScene, c + d * vec2(-0.3, 0.3))
         + texture2D(tScene, c + d * vec2(0.3, -0.3)) + texture2D(tScene, c + d * vec2(-0.3, -0.3)));
  float a = clamp(s.a, 0.0, 1.0);
  vec3 col = s.a > 0.001 ? s.rgb / max(s.a, 1e-3) : vec3(0.0);
  float lum = dot(pow(aces(col * uExposure), vec3(1.0 / 2.2)), vec3(0.299, 0.587, 0.114));
  // контур силуэта — ярче, чтобы фигура читалась на фоне дождя
  float aL = texture2D(tScene, c - vec2(d.x, 0.0)).a, aR = texture2D(tScene, c + vec2(d.x, 0.0)).a;
  float aD = texture2D(tScene, c - vec2(0.0, d.y)).a, aU = texture2D(tScene, c + vec2(0.0, d.y)).a;
  float edge = clamp(abs(aL - aR) + abs(aU - aD), 0.0, 1.0);

  float rows = uRes.y / uCell.y;
  float h1, h2;
  float r = max(stream(cell.x, cell.y, rows, 0.0, h1), 0.8 * stream(cell.x, cell.y, rows, 17.0, h2));
  float head = max(h1, h2);
  float flick = floor(uTime * mix(2.0, 9.0, hash(cell.yx)) + hash(cell) * 10.0);
  float rIdx = uRainStart + floor(hash(cell + flick * 0.37) * uRainLen);
  vec3 rainC = mix(uColor * 0.55, uHot, head) * r * uRain;
  vec3 rainOut = rainC * glyph(rIdx, inCell);

  // фигура: яркость → плотность символа, лёгкое мерцание соседними символами
  // контраст: тени фигуры почти гаснут, блики — плотные и светлые
  float v = clamp(max(smoothstep(0.02, 0.8, lum), edge * 0.8), 0.0, 1.0);
  v = max(v, 0.06);
  float jr = mix(1.0, 7.0, smoothstep(0.6, 1.0, v));                 // в бликах — разброс шире, без «стены» из B/M
  float jitter = floor(hash(cell + floor(uTime * 4.0 + hash(cell) * 4.0)) * (2.0 * jr + 1.0)) - jr;
  float fIdx = clamp(floor(v * (uFigureLen - 1.0) + 0.5) + jitter * step(0.25, v), 1.0, uFigureLen - 1.0);
  vec3 figC = mix(uColor * (0.18 + 0.82 * v), uHot, smoothstep(0.78, 1.0, v));
  vec3 figOut = figC * glyph(fIdx, inCell) * (0.7 + 0.3 * v);

  vec3 outC = mix(rainOut * 0.9, figOut, smoothstep(0.15, 0.6, a));
  // лёгкая виньетка и строчная развёртка — «экран»
  vec2 q = vUv - 0.5;
  outC *= 1.0 - dot(q, q) * 0.55;
  outC *= 0.93 + 0.07 * sin(px.y * 3.14159 / max(uCell.y * 0.5, 1.0));
  gl_FragColor = vec4(outC, 1.0);
}`;

export class AsciiMatrix {
  constructor(renderer, opt = {}) {
    this.renderer = renderer;
    this.cell = opt.cell || 9;                 // ширина ячейки, CSS px
    this.aspect = opt.aspect || 1.55;           // высота/ширина ячейки
    this.scale = opt.scale || 0.5;              // разрешение внеэкранного буфера относительно экрана
    const at = buildAtlas();
    this.atlas = at.tex;
    this.rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, depthTest: false, depthWrite: false,
      uniforms: {
        tScene: { value: this.rt.texture }, tAtlas: { value: at.tex },
        uRes: { value: new THREE.Vector2() }, uCell: { value: new THREE.Vector2() },
        uGrid: { value: new THREE.Vector2(COLS, at.rows) }, uTime: { value: 0 },
        uFigureLen: { value: at.figureLen }, uRainStart: { value: at.rainStart }, uRainLen: { value: at.rainLen },
        uExposure: { value: opt.exposure ?? 1.25 }, uRain: { value: opt.rain ?? 1 },
        uColor: { value: new THREE.Color(0x00ff41) }, uHot: { value: new THREE.Color(0xd8ffe0) },
      },
    });
    this.quadScene = new THREE.Scene();
    this.quadScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material));
    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this._size = new THREE.Vector2(); this._clear = new THREE.Color();
  }
  render(scene, camera, time) {
    const r = this.renderer, u = this.material.uniforms;
    r.getDrawingBufferSize(this._size);
    const w = Math.max(1, Math.round(this._size.x * this.scale)), h = Math.max(1, Math.round(this._size.y * this.scale));
    if (this.rt.width !== w || this.rt.height !== h) this.rt.setSize(w, h);
    const pr = r.getPixelRatio();
    u.uRes.value.copy(this._size);
    u.uCell.value.set(Math.round(this.cell * pr), Math.round(this.cell * this.aspect * pr));
    u.uTime.value = time;
    r.getClearColor(this._clear); const clearA = r.getClearAlpha();
    r.setClearColor(0x000000, 0);
    r.setRenderTarget(this.rt); r.clear(); r.render(scene, camera);
    r.setRenderTarget(null); r.render(this.quadScene, this.quadCam);
    r.setClearColor(this._clear, clearA);
  }
  dispose() { this.rt.dispose(); this.material.dispose(); this.atlas.dispose(); }
}

// ---------- «оператор»: ракурсы как в видео ----------
// yaw/elev — градусы вокруг аватара; zoom — доля от кадра «по пояс»; focus 0 — центр кадра, 1 — голова.
const SHOTS = [
  { name: "общий", yaw: 0, elev: 2, zoom: 1, focus: 0 },
  { name: "3/4 слева", yaw: 32, elev: 5, zoom: 0.82, focus: 0.3 },
  { name: "крупный", yaw: -6, elev: 3, zoom: 0.45, focus: 1 },
  { name: "3/4 справа", yaw: -34, elev: -2, zoom: 0.8, focus: 0.25 },
  { name: "снизу", yaw: 16, elev: -16, zoom: 0.78, focus: 0.4 },
  { name: "полупрофиль", yaw: 55, elev: 4, zoom: 0.55, focus: 0.85 },
  { name: "средний", yaw: -18, elev: 6, zoom: 0.62, focus: 0.65 },
];
const TALK_SHOTS = ["крупный", "средний", "полупрофиль"];
const KEYS = ["yaw", "elev", "zoom", "focus"];
const ease = t => t * t * (3 - 2 * t);

export class CameraDirector {
  constructor(camera) {
    this.camera = camera; this.enabled = true; this.frame = null;
    this.from = { ...SHOTS[0] }; this.to = SHOTS[0]; this.t = 1; this.hold = 6; this.since = 0; this.clock = 0;
  }
  // кадр из frameCamera: центр/полувысота кадра «по пояс», высота головы, сторона лица
  setFrame(f) { this.frame = f; }
  get shot() { return this.to.name; }
  cut(name) {
    const next = SHOTS.find(s => s.name === name) || SHOTS[(SHOTS.indexOf(this.to) + 1) % SHOTS.length];
    this.from = this._current(); this.to = next; this.t = 0; this.since = 0;
    this.hold = 8 + Math.random() * 7;
  }
  // реплика аватара — оператор переходит на более близкий план (если сейчас не он)
  cue() { if (!TALK_SHOTS.includes(this.to.name) && this.since > 2) this.cut(TALK_SHOTS[Math.floor(Math.random() * TALK_SHOTS.length)]); }
  _current() {
    const k = ease(Math.min(1, this.t)), o = {};
    for (const key of KEYS) o[key] = this.from[key] + (this.to[key] - this.from[key]) * k;
    return o;
  }
  update() {
    // свои часы, а не dt кадра: при просадке fps монтаж не должен «замедляться»
    const now = performance.now() / 1000, dt = Math.min(0.5, now - (this._last ?? now)); this._last = now;
    if (!this.enabled || !this.frame) return;
    this.clock += dt; this.since += dt; this.t += dt / 2.8;
    if (this.since > this.hold) {
      let next; do next = SHOTS[Math.floor(Math.random() * SHOTS.length)]; while (next === this.to);
      this.cut(next.name);
    }
    const s = this._current(), f = this.frame, cam = this.camera;
    const yaw = THREE.MathUtils.degToRad(s.yaw + Math.sin(this.clock * 0.13) * 3);
    const elev = THREE.MathUtils.degToRad(s.elev + Math.sin(this.clock * 0.09 + 1) * 1.5);
    const half = f.halfExtent * s.zoom;
    const dist = half / Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2);
    const ty = f.centerY + (f.headY - f.centerY) * s.focus + Math.sin(this.clock * 0.21) * 0.006;
    cam.position.set(Math.sin(yaw) * Math.cos(elev) * dist * f.faceSign, ty + Math.sin(elev) * dist,
      Math.cos(yaw) * Math.cos(elev) * dist * f.faceSign);
    cam.lookAt(0, ty, 0);
  }
}
