// Э3 — «живое тело» Гермеса: idle (дыхание, перенос веса, покачивание), повороты головы/корпуса,
// жесты рук и пальцев, осанка эмоций, акценты речи, коартикуляция визем Oculus-15 → VRM.
// Все углы задаются в конвенции VRM 1.0 (модель смотрит в +Z), в градусах. Для VRM 0.x
// (смотрит в −Z) знаки X и Z зеркалятся множителем s0 — так же, как в restPose() vrm.html.
import * as THREE from "three";

const R = THREE.MathUtils.degToRad;
const clamp01 = v => Math.max(0, Math.min(1, v));
const sstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const ease = t => t * t * (3 - 2 * t);
const noise = (t, f, s) => Math.sin(t * f + s) * 0.6 + Math.sin(t * f * 2.31 + s * 1.7) * 0.3 + Math.sin(t * f * 4.07 + s * 0.3) * 0.1;

// ---------------------------------------------------------------- кости
const SIDES = ["left", "right"];
const FINGERS = ["Index", "Middle", "Ring", "Little"];
const PHAL = ["Proximal", "Intermediate", "Distal"];
const ARM_BONES = new Set();           // абсолютные позы (переопределяют позу покоя)
for (const s of SIDES) {
  for (const b of ["Shoulder", "UpperArm", "LowerArm", "Hand"]) ARM_BONES.add(s + b);
  for (const f of [...FINGERS, "Thumb"]) for (const p of [...PHAL, "Metacarpal"]) ARM_BONES.add(s + f + p);
}
const BODY_BONES = ["hips", "spine", "chest", "upperChest", "neck", "head"];   // аддитивные смещения

// зеркало левой стороны на правую: x тот же, y/z меняют знак
const mirror = pose => { const o = {}; for (const [k, v] of Object.entries(pose)) {
  if (k.startsWith("left")) o["right" + k.slice(4)] = [v[0], -v[1], -v[2]];
  else if (k === "handL") o.handR = v; else o[k] = v; } return o; };
const both = pose => ({ ...pose, ...mirror(pose) });

// кисть: [сгиб указательного, сгиб остальных, большой] 0..1 → углы фаланг
function handShape(side, [ci, co, th]) {
  const sg = side === "left" ? -1 : 1, o = {};
  FINGERS.forEach((f, fi) => {
    const c = fi === 0 ? ci : co;
    const spread = (fi - 1.5) * 4 * (1 - c);
    o[side + f + "Proximal"] = [0, -sg * spread, sg * c * 70];
    o[side + f + "Intermediate"] = [0, 0, sg * c * 85];
    o[side + f + "Distal"] = [0, 0, sg * c * 55];
  });
  o[side + "ThumbProximal"] = [0, sg * th * 25, sg * th * 15];
  o[side + "ThumbDistal"] = [0, sg * th * 30, 0];
  return o;
}

// ---------------------------------------------------------------- клипы
// keys: [[t_sec, {bone: [x,y,z]°, handL/handR: [ci,co,th]}], ...]; руки/пальцы — абсолютно, корпус/голова — аддитивно.
// Значения между ключами — плавная интерполяция; fade — вход/выход веса; hold — держать последний ключ.
const L = (o) => o;
const REST_HAND = [0.25, 0.3, 0.2];
const CLIPS = {
  // --- жесты рук (setGesture)
  wave: { fade: 0.35, keys: [
    [0, L({ rightUpperArm: [0, 25, -15], rightLowerArm: [0, 10, -95], rightHand: [0, 0, 0], handR: [0, 0, 0], head: [0, -6, 4] })],
    [0.45, L({ rightUpperArm: [0, 25, -15], rightLowerArm: [0, 10, -70], rightHand: [0, 0, -10], handR: [0, 0, 0], head: [0, -6, 4] })],
    [0.8, L({ rightUpperArm: [0, 25, -15], rightLowerArm: [0, 10, -105], rightHand: [0, 0, 15], handR: [0, 0, 0], head: [0, -6, 4] })],
    [1.15, L({ rightUpperArm: [0, 25, -15], rightLowerArm: [0, 10, -70], rightHand: [0, 0, -10], handR: [0, 0, 0], head: [0, -6, 4] })],
    [1.5, L({ rightUpperArm: [0, 25, -15], rightLowerArm: [0, 10, -105], rightHand: [0, 0, 15], handR: [0, 0, 0], head: [0, -6, 4] })],
    [1.85, L({ rightUpperArm: [0, 25, -15], rightLowerArm: [0, 10, -85], rightHand: [0, 0, 0], handR: [0, 0, 0], head: [0, -6, 4] })],
  ] },
  explain: { fade: 0.4, keys: [
    [0, both({ leftUpperArm: [-14, 0, -72], leftLowerArm: [0, -72, 0], leftHand: [-40, 0, 0], handL: [0.1, 0.15, 0] })],
    [0.6, both({ leftUpperArm: [-20, 0, -68], leftLowerArm: [0, -82, 0], leftHand: [-55, 0, 0], handL: [0.05, 0.1, 0], head: [-3, 0, 0] })],
    [1.3, both({ leftUpperArm: [-14, 0, -72], leftLowerArm: [0, -70, 0], leftHand: [-40, 0, 0], handL: [0.1, 0.15, 0] })],
    [2.0, both({ leftUpperArm: [-18, 0, -69], leftLowerArm: [0, -78, 0], leftHand: [-50, 0, 0], handL: [0.08, 0.12, 0], head: [2, 0, 0] })],
  ] },
  point: { fade: 0.3, keys: [
    [0, L({ rightUpperArm: [-72, 0, 58], rightLowerArm: [0, 12, 0], rightHand: [0, 0, 0], handR: [0, 1, 1], head: [3, -4, 0], upperChest: [0, -4, 0] })],
    [1.6, L({ rightUpperArm: [-76, 0, 55], rightLowerArm: [0, 8, 0], rightHand: [0, 0, 0], handR: [0, 1, 1], head: [3, -4, 0], upperChest: [0, -4, 0] })],
  ] },
  shrug: { fade: 0.3, keys: [
    [0, both({ leftShoulder: [0, 0, 14], leftUpperArm: [-10, 0, -60], leftLowerArm: [0, -75, 0], leftHand: [-60, 0, 0], handL: [0, 0.05, 0], head: [-2, 0, 7], neck: [0, 0, 3] })],
    [0.9, both({ leftShoulder: [0, 0, 16], leftUpperArm: [-10, 0, -58], leftLowerArm: [0, -80, 0], leftHand: [-70, 0, 0], handL: [0, 0.05, 0], head: [-2, 0, 7], neck: [0, 0, 3] })],
  ] },
  think: { fade: 0.45, keys: [
    [0, L({ rightUpperArm: [0, 40, 62], rightLowerArm: [0, 135, -10], rightHand: [0, 0, 15], handR: [0.4, 0.8, 0.3], leftUpperArm: [0, -45, -70], leftLowerArm: [0, -95, 0], handL: [0.4, 0.6, 0.2], head: [6, 6, -5], neck: [2, 0, 0] })],
    [2.5, L({ rightUpperArm: [0, 40, 62], rightLowerArm: [0, 135, -10], rightHand: [0, 0, 15], handR: [0.4, 0.8, 0.3], leftUpperArm: [0, -45, -70], leftLowerArm: [0, -95, 0], handL: [0.4, 0.6, 0.2], head: [4, 10, -7], neck: [2, 0, 0] })],
  ] },
  celebrate: { fade: 0.3, keys: [
    [0, both({ leftUpperArm: [0, -10, 55], leftLowerArm: [0, -10, 25], handL: [1, 1, 1], head: [-6, 0, 0], upperChest: [-3, 0, 0] })],
    [0.35, both({ leftUpperArm: [0, -10, 65], leftLowerArm: [0, -10, 10], handL: [1, 1, 1], head: [-8, 0, 0], upperChest: [-4, 0, 0] })],
    [0.7, both({ leftUpperArm: [0, -10, 55], leftLowerArm: [0, -10, 25], handL: [1, 1, 1], head: [-6, 0, 0], upperChest: [-3, 0, 0] })],
    [1.05, both({ leftUpperArm: [0, -10, 65], leftLowerArm: [0, -10, 10], handL: [1, 1, 1], head: [-8, 0, 0], upperChest: [-4, 0, 0] })],
  ] },
  fist: { fade: 0.25, keys: [
    [0, L({ rightUpperArm: [-25, 0, 66], rightLowerArm: [0, 105, 0], rightHand: [0, 0, 0], handR: [1, 1, 1], head: [3, 0, 0], spine: [3, 0, 0] })],
    [0.25, L({ rightUpperArm: [-32, 0, 60], rightLowerArm: [0, 118, 0], rightHand: [0, 0, 0], handR: [1, 1, 1], head: [5, 0, 0], spine: [4, 0, 0] })],
    [1.2, L({ rightUpperArm: [-25, 0, 66], rightLowerArm: [0, 105, 0], rightHand: [0, 0, 0], handR: [1, 1, 1], head: [3, 0, 0], spine: [3, 0, 0] })],
  ] },
  cross_arms: { fade: 0.45, hold: false, dur: 4, keys: [
    [0, both({ leftUpperArm: [-28, -30, -66], leftLowerArm: [0, -128, 0], leftHand: [0, 0, 0], handL: [0.5, 0.6, 0.4], spine: [-2, 0, 0], head: [-3, 0, 0] })],
    [4, both({ leftUpperArm: [-30, -32, -65], leftLowerArm: [0, -130, 0], leftHand: [0, 0, 0], handL: [0.5, 0.6, 0.4], spine: [-2, 0, 0], head: [-3, 0, 0] })],
  ] },
  // короткие «удары» речи — автоматически на акцентах
  beatR: { fade: 0.18, keys: [
    [0, L({ rightUpperArm: [-12, 0, 70], rightLowerArm: [0, 68, 0], rightHand: [45, 0, -8], handR: [0.15, 0.25, 0.1] })],
    [0.22, L({ rightUpperArm: [-16, 0, 68], rightLowerArm: [0, 84, 0], rightHand: [50, 0, -16], handR: [0.1, 0.2, 0.05] })],
    [0.55, L({ rightUpperArm: [-12, 0, 70], rightLowerArm: [0, 64, 0], rightHand: [45, 0, -6], handR: [0.15, 0.25, 0.1] })],
  ] },
  beatL: { fade: 0.18, keys: [
    [0, L({ leftUpperArm: [-12, 0, -70], leftLowerArm: [0, -68, 0], leftHand: [45, 0, 8], handL: [0.15, 0.25, 0.1] })],
    [0.22, L({ leftUpperArm: [-16, 0, -68], leftLowerArm: [0, -84, 0], leftHand: [50, 0, 16], handL: [0.1, 0.2, 0.05] })],
    [0.55, L({ leftUpperArm: [-12, 0, -70], leftLowerArm: [0, -64, 0], leftHand: [45, 0, 6], handL: [0.15, 0.25, 0.1] })],
  ] },
  // --- движения всего тела (playMotion)
  nod: { fade: 0.15, keys: [[0, { head: [0, 0, 0] }], [0.18, { head: [13, 0, 0], neck: [4, 0, 0] }], [0.42, { head: [-2, 0, 0] }],
    [0.62, { head: [9, 0, 0], neck: [3, 0, 0] }], [0.9, { head: [0, 0, 0] }]] },
  shake: { fade: 0.15, keys: [[0, { head: [0, 0, 0] }], [0.2, { head: [2, 16, 0] }], [0.45, { head: [2, -16, 0] }],
    [0.7, { head: [2, 12, 0] }], [0.95, { head: [1, -8, 0] }], [1.15, { head: [0, 0, 0] }]] },
  bow: { fade: 0.4, keys: [[0, {}], [0.6, { spine: [16, 0, 0], chest: [8, 0, 0], head: [10, 0, 0], ...both({ leftUpperArm: [0, -8, -78] }) }],
    [1.4, { spine: [16, 0, 0], chest: [8, 0, 0], head: [10, 0, 0], ...both({ leftUpperArm: [0, -8, -78] }) }], [2.0, {}]] },
  lookAround: { fade: 0.6, keys: [[0, {}], [0.9, { head: [2, 24, 0], neck: [0, 10, 0], upperChest: [0, 8, 0], spine: [0, 6, 0] }],
    [2.0, { head: [2, 26, 0], neck: [0, 10, 0], upperChest: [0, 8, 0], spine: [0, 6, 0] }],
    [3.0, { head: [3, -24, 0], neck: [0, -10, 0], upperChest: [0, -8, 0], spine: [0, -6, 0] }],
    [4.1, { head: [3, -26, 0], neck: [0, -10, 0], upperChest: [0, -8, 0], spine: [0, -6, 0] }], [5.0, {}]] },
  turnLeft: { fade: 0.6, hold: true, keys: [[0, {}], [0.8, { hips: [0, 14, 0], spine: [0, 6, 0], upperChest: [0, 5, 0], head: [0, 10, 0] }]] },
  turnRight: { fade: 0.6, hold: true, keys: [[0, {}], [0.8, { hips: [0, -14, 0], spine: [0, -6, 0], upperChest: [0, -5, 0], head: [0, -10, 0] }]] },
  stretch: { fade: 0.5, keys: [[0, {}], [1.0, { ...both({ leftUpperArm: [0, -20, 70], leftLowerArm: [0, 0, 15], handL: [0, 0, 0] }), spine: [-6, 0, 0], head: [-14, 0, 0] }],
    [1.8, { ...both({ leftUpperArm: [0, -20, 72], leftLowerArm: [0, 0, 10], handL: [0, 0, 0] }), spine: [-7, 0, 6], head: [-14, 0, 5] }], [2.8, {}]] },
};
const GESTURES = ["wave", "explain", "point", "shrug", "think", "celebrate", "fist", "cross_arms", "beatL", "beatR"];
const MOTIONS = ["nod", "shake", "bow", "lookAround", "turnLeft", "turnRight", "stretch", "idle", "talk"];
for (const c of Object.values(CLIPS)) c.dur = c.keys[c.keys.length - 1][0];

function expandPose(pose) {
  const o = {};
  for (const [k, v] of Object.entries(pose)) {
    if (k === "handL") Object.assign(o, handShape("left", v));
    else if (k === "handR") Object.assign(o, handShape("right", v));
    else o[k] = v;
  }
  return o;
}
for (const c of Object.values(CLIPS)) c.keys = c.keys.map(([t, p]) => [t, expandPose(p)]);

function sampleClip(clip, t) {
  const k = clip.keys;
  if (t <= k[0][0]) return k[0][1];
  if (t >= k[k.length - 1][0]) return k[k.length - 1][1];
  let i = 0; while (k[i + 1][0] < t) i++;
  const [t0, a] = k[i], [t1, b] = k[i + 1], u = ease((t - t0) / (t1 - t0)), o = {};
  for (const n of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const va = a[n] || (ARM_BONES.has(n) ? null : [0, 0, 0]), vb = b[n] || (ARM_BONES.has(n) ? null : [0, 0, 0]);
    if (!va || !vb) { o[n] = va || vb; continue; }        // кость есть только в одном ключе — держим
    o[n] = [va[0] + (vb[0] - va[0]) * u, va[1] + (vb[1] - va[1]) * u, va[2] + (vb[2] - va[2]) * u];
  }
  return o;
}

// ---------------------------------------------------------------- визем Oculus-15 → 5 VRM-гласных
// Губно-губные (PP) — активное смыкание: все гласные в 0 с повышенной скоростью.
export const VISEME_MAP = {
  sil: {}, PP: {}, FF: { ih: 0.12 }, TH: { aa: 0.1, ih: 0.1 }, DD: { aa: 0.12, ih: 0.12 },
  kk: { aa: 0.18, ih: 0.08 }, CH: { ou: 0.3, ih: 0.1 }, SS: { ih: 0.25 }, nn: { aa: 0.08, ih: 0.15 },
  RR: { aa: 0.15, ou: 0.15 }, aa: { aa: 1 }, E: { ee: 0.85, aa: 0.15 }, ih: { ih: 0.85 }, oh: { oh: 0.9, aa: 0.1 },
  ou: { ou: 1 }, ee: { ee: 1 }, // совместимость со старыми timeline (имена VRM)
};
const CLOSE = new Set(["PP", "FF"]);   // смыкание/прикус губ
const VOWELS5 = ["aa", "ih", "ou", "ee", "oh"];

// ---------------------------------------------------------------- эмоции
// Базовые пресеты модели (VRM 0.x: Joy/Sorrow/Angry/Fun/Surprised → happy/sad/angry/relaxed/surprised).
export const EMO_ALIAS = { joy: "happy", fun: "relaxed", sorrow: "sad", angry: "angry", happy: "happy", sad: "sad",
  relaxed: "relaxed", surprised: "surprised", neutral: "neutral", "нейтрально": "нейтраль" };
const BASE = ["happy", "sad", "angry", "relaxed", "surprised"];
// 12 эмоций (РЕШЕНИЕ, имена фиксированы): смесь пресетов лица + веки + осанка тела (аддитивно, градусы VRM1)
// + плечи (+ вверх) + сдвиг взгляда. Эмоции смешиваются весами: итог = Σ w·рецепт.
export const EMOTIONS = {
  "радость":    { face: { happy: 1 }, post: { head: [-4, 0, 0], upperChest: [-3, 0, 0] }, sh: 0 },
  "грусть":     { face: { sad: 1 }, lid: 0.15, post: { head: [11, 0, -3], neck: [5, 0, 0], spine: [5, 0, 0], upperChest: [5, 0, 0] }, sh: -5, gaze: [0, -0.15] },
  "злость":     { face: { angry: 1 }, post: { head: [5, 0, 0], spine: [4, 0, 0], chest: [3, 0, 0] }, sh: 5 },
  "страх":      { face: { surprised: 0.55, sad: 0.45 }, post: { head: [-3, -6, 0], neck: [-2, 0, 0], spine: [-4, 0, 0], upperChest: [-3, 0, 0] }, sh: 9, gaze: [0.12, 0] },
  "удивление":  { face: { surprised: 1 }, post: { head: [-7, 0, 0], upperChest: [-4, 0, 0] }, sh: 7 },
  "отвращение": { face: { angry: 0.45, sad: 0.35 }, lid: 0.2, post: { head: [-4, 12, 6], neck: [0, 4, 0], spine: [-3, 0, 0] }, sh: 2, gaze: [-0.2, 0] },
  "интерес":    { face: { happy: 0.25, surprised: 0.3 }, post: { head: [3, 0, 9], neck: [2, 0, 3], spine: [4, 0, 0], upperChest: [3, 0, 0] }, sh: 1 },
  "скука":      { face: { relaxed: 0.45, sad: 0.25 }, lid: 0.4, post: { head: [6, 0, -8], spine: [6, 0, 0], upperChest: [4, 0, 0] }, sh: -4, gaze: [0.25, 0.1] },
  "смущение":   { face: { happy: 0.45, sad: 0.3 }, lid: 0.2, post: { head: [12, -10, 5], neck: [4, 0, 0] }, sh: 4, gaze: [-0.25, -0.2] },
  "гордость":   { face: { happy: 0.5, relaxed: 0.3 }, lid: 0.15, post: { head: [-9, 0, 0], neck: [-3, 0, 0], upperChest: [-6, 0, 0], spine: [-3, 0, 0] }, sh: -2 },
  "усталость":  { face: { sad: 0.4, relaxed: 0.45 }, lid: 0.5, post: { head: [9, 0, 4], neck: [4, 0, 0], spine: [8, 0, 0], upperChest: [5, 0, 0] }, sh: -6, gaze: [0, -0.2], slow: 0.6 },
  "нейтраль":   { face: {}, post: {}, sh: 0 },
};
// английские пресеты — те же рецепты (совместимость с API этапа 1)
const EN2RU = { happy: "радость", sad: "грусть", angry: "злость", surprised: "удивление", relaxed: null, neutral: "нейтраль" };
EMOTIONS.relaxed = { face: { relaxed: 1 }, post: { head: [0, 0, 5], spine: [-2, 0, 0] }, sh: -2 };

// ---------------------------------------------------------------- движок
export class AvatarMotion {
  constructor() {
    this.vrm = null; this.rest = {}; this.restHips = null;
    this.layers = [];             // активные клипы {name, clip, t, w, state, hold, speed}
    this.timeline = null; this.tlStart = 0; this.audio = null; this.tlIdx = 0;
    this.vis = Object.fromEntries(VOWELS5.map(v => [v, 0]));
    this.emo = {}; this.emoTarget = {};
    this.speakEnv = 0; this.nodImp = 0; this.lastBeat = 0; this.accentSeen = new Set();
    this.autoGestures = true; this.idleBody = true;
    this.turn = { cur: 0, tgt: 0, next: 0 }; this.gaze = { x: 0, y: 0, tx: 0, ty: 0, next: 0 };
    this.gazeObj = new THREE.Object3D();
    this.mode = "idle"; this.lastAccentT = -9;
  }

  attach(vrm, scene) {
    this.vrm = vrm; this.rest = {}; this.layers = [];
    this.s0 = vrm.meta?.metaVersion === "0" ? -1 : 1;
    const h = vrm.humanoid;
    this.bones = {};
    for (const n of [...ARM_BONES, ...BODY_BONES]) { const b = h.getNormalizedBoneNode(n); if (b) this.bones[n] = b; }
    // поза покоя (как её выставил restPose) → в конвенцию VRM1, градусы
    for (const n of ARM_BONES) { const b = this.bones[n]; if (!b) continue;
      this.rest[n] = [THREE.MathUtils.radToDeg(b.rotation.x) * this.s0, THREE.MathUtils.radToDeg(b.rotation.y), THREE.MathUtils.radToDeg(b.rotation.z) * this.s0]; }
    // расслабленные пальцы в покое
    for (const s of SIDES) Object.assign(this.rest, handShape(s, REST_HAND));
    this.restHips = this.bones.hips ? this.bones.hips.position.clone() : null;
    // expressions: имя → реальное имя в модели (регистронезависимо, VRM 0.x алиасы)
    const names = (vrm.expressionManager?.expressions || []).map(e => e.expressionName);
    this.exprName = n => names.find(x => x.toLowerCase() === n.toLowerCase());
    // глаза следят за объектом перед лицом
    if (vrm.lookAt) { scene.add(this.gazeObj); vrm.lookAt.target = this.gazeObj; }
  }

  // ---------- API
  play(name, opt = {}) {
    if (name === "idle") { this.stopAll(); this.mode = "idle"; return true; }
    if (name === "talk") { this.mode = "talk"; return true; }
    const clip = CLIPS[name]; if (!clip) return false;
    const old = this.layers.find(l => l.name === name);
    if (old) { old.t = 0; old.state = "in"; return true; }
    // жест одной руки вытесняет другие жесты на тех же костях
    const bones = new Set(clip.keys.flatMap(k => Object.keys(k[1]).filter(b => ARM_BONES.has(b))));
    for (const l of this.layers) if (l.bones && [...l.bones].some(b => bones.has(b))) l.state = "out";
    this.layers.push({ name, clip, t: 0, w: 0, state: "in", hold: opt.hold ?? clip.hold ?? false,
      speed: opt.speed || 1, amp: opt.amp ?? 1, bones });
    return true;
  }
  stop(name) { for (const l of this.layers) if (!name || l.name === name) l.state = "out"; }
  stopAll() { this.stop(); }
  // name: одна из 12 русских эмоций или пресет VRM (happy/Joy/…); w 0..1. «нейтраль» с w>0.5 гасит остальные.
  setEmotion(name, w = 1) {
    let n = String(name).trim().toLowerCase();
    n = EMO_ALIAS[n] || n;
    if (n in EN2RU && EN2RU[n]) n = EN2RU[n];
    if (!(n in EMOTIONS)) return false;
    if (n === "нейтраль" && w > 0.5) { for (const k of Object.keys(this.emoTarget)) this.emoTarget[k] = 0; }
    this.emoTarget[n] = clamp01(w);
    return true;
  }
  // взгляд за курсором: x,y в -1..1 относительно окна; держится 2,5 с после последнего движения
  lookAtCursor(x, y) { this.cursor = { x: Math.max(-1, Math.min(1, x)), y: Math.max(-1, Math.min(1, y)), t: performance.now() / 1000 }; }
  setVisemes(tl, opt = {}) {
    this.timeline = Array.isArray(tl) && tl.length ? tl.slice().sort((a, b) => a.t - b.t) : null;
    this.audio = opt.audio || null; this.tlStart = performance.now() / 1000; this.tlIdx = 0;
    this.accentSeen = new Set();
    return true;
  }
  speechTime() {
    if (!this.timeline) return null;
    return this.audio ? this.audio.currentTime : performance.now() / 1000 - this.tlStart;
  }

  // ---------- визем с коартикуляцией: целевая форма = текущая визема → следующая (предвосхищение)
  visemeTarget(t) {
    const tl = this.timeline, out = { _close: false };
    if (!tl || t == null) return out;
    if (t > tl[tl.length - 1].t + 0.25) { this.timeline = null; return out; }
    let i = Math.min(this.tlIdx, tl.length - 1);
    if (tl[i].t > t) i = 0;
    while (i + 1 < tl.length && tl[i + 1].t <= t) i++;
    this.tlIdx = i;
    if (tl[i].t > t) return out;
    const a = tl[i], b = tl[i + 1];
    const shape = e => { const m = VISEME_MAP[e.viseme] || {}, o = {}; for (const [k, v] of Object.entries(m)) o[k] = v * (e.weight ?? 1); return o; };
    const sa = shape(a), sb = b ? shape(b) : {};
    const dur = b ? Math.max(0.02, b.t - a.t) : 0.1;
    const u = b ? sstep(0.6, 1.0, (t - a.t) / dur) * 0.5 : 0;      // 50% предвосхищения на последних 40% фоны
    const decay = 1 - 0.3 * sstep(0.12, 0.35, t - a.t);            // длинная гласная слегка «оседает»
    for (const v of VOWELS5) out[v] = ((sa[v] || 0) * decay * (1 - u) + (sb[v] || 0) * u);
    out._close = CLOSE.has(a.viseme) && u < 0.5;
    // акцент: кивок + жест-«удар»
    if (a.accent && !this.accentSeen.has(i)) { this.accentSeen.add(i); this.onAccent(t); }
    out._open = VOWELS5.reduce((s, v) => s + out[v], 0);
    return out;
  }
  onAccent(t) {
    this.nodImp = 1; this.lastAccentT = t;
    const now = performance.now() / 1000;
    if (this.autoGestures && now - this.lastBeat > 1.6 && !this.layers.some(l => !l.name.startsWith("beat") && l.bones?.size)) {
      this.lastBeat = now;
      this.play(Math.random() < 0.5 ? "beatR" : "beatL");
    }
  }

  // ---------- кадр
  update(dt, ts) {
    const vrm = this.vrm; if (!vrm) return;
    const em = vrm.expressionManager;
    const st = this.speechTime();
    const vt = this.visemeTarget(st);
    const speaking = !!this.timeline;
    this.speakEnv += ((speaking ? 1 : 0) - this.speakEnv) * (1 - Math.exp(-dt * 3));
    if (this.mode === "talk") this.speakEnv = Math.max(this.speakEnv, 0.6);

    // визем → expressions (атака быстрее, смыкание губ — ещё быстрее)
    const kA = 1 - Math.exp(-dt * (vt._close ? 45 : 24)), kR = 1 - Math.exp(-dt * 20);
    let open = 0;
    for (const v of VOWELS5) {
      const tgt = vt._close ? 0 : (vt[v] || 0);
      this.vis[v] += (tgt - this.vis[v]) * (tgt > this.vis[v] ? kA : kR);
      open += this.vis[v];
      const n = this.exprName?.(v); if (n) em.setValue(n, this.vis[v]);
    }
    this.mouthOpen = open;

    // эмоции → expressions (рот эмоции приглушается во время речи, чтобы визем читались)
    const kE = 1 - Math.exp(-dt * 4);
    const face = {}; let lid = 0, slow = 0; this.emoGaze = [0, 0];
    for (const n of Object.keys(EMOTIONS)) {
      const tgt = this.emoTarget[n] || 0, cur = this.emo[n] || 0;
      if (tgt === 0 && cur < 0.001) { delete this.emo[n]; continue; }
      const w = this.emo[n] = cur + (tgt - cur) * kE, r = EMOTIONS[n];
      for (const [k, v] of Object.entries(r.face)) face[k] = (face[k] || 0) + v * w;
      lid += (r.lid || 0) * w; slow += (r.slow || 0) * w;
      if (r.gaze) { this.emoGaze[0] += r.gaze[0] * w; this.emoGaze[1] += r.gaze[1] * w; }
    }
    for (const n of BASE) {
      const real = this.exprName?.(n);
      if (real) em.setValue(real, clamp01(face[n] || 0) * (1 - 0.35 * this.speakEnv * (n === "happy" || n === "surprised" ? 1 : 0)));
    }
    // веки: полуопущены (скука/усталость) — поверх моргания
    const bn = this.exprName?.("blink");
    if (bn && lid > 0.01) em.setValue(bn, Math.max(em.getValue(bn) || 0, Math.min(0.6, lid)));
    this.slow = Math.min(0.6, slow);

    // ---------- скелет
    const pose = {};                                  // кость → [x,y,z]° (VRM1)
    for (const [n, r] of Object.entries(this.rest)) pose[n] = r.slice();
    const add = (n, x, y, z, w = 1) => { const p = pose[n] || (pose[n] = [0, 0, 0]); p[0] += x * w; p[1] += y * w; p[2] += z * w; };

    // idle: дыхание (~15/мин), перенос веса, покачивание, микродвижения головы
    this.brPh = (this.brPh || 0) + dt * 1.6 * (1 - 0.4 * (this.slow || 0));
    const br = Math.sin(this.brPh), br2 = Math.sin(this.brPh - 0.6);
    if (this.idleBody) {
      add("spine", br * 0.6, 0, 0); add("chest", br * 1.1, 0, 0); add("upperChest", br2 * 0.9, 0, 0);
      for (const s of SIDES) { const sg = s === "left" ? 1 : -1;
        add(s + "Shoulder", 0, 0, sg * (0.9 + br2 * 0.9)); add(s + "UpperArm", br2 * 0.8, 0, sg * br * 0.7); }
      const sway = noise(ts, 0.23, 1.3), wshift = noise(ts, 0.11, 4.1);
      add("hips", 0, sway * 2.2, wshift * 1.6); add("spine", 0, -sway * 1.2, -wshift * 1.2); add("chest", 0, -sway * 0.6, -wshift * 0.4);
      add("head", noise(ts, 0.37, 2) * 1.8, noise(ts, 0.29, 5) * 2.4, noise(ts, 0.21, 7) * 1.6);
      if (this.restHips) this.hipsOffset = wshift * 0.012;
      // повороты корпуса: изредка Гермес «переступает» и разворачивается на несколько градусов
      if (ts > this.turn.next) { this.turn.tgt = (Math.random() - 0.5) * (speaking ? 10 : 16); this.turn.next = ts + 5 + Math.random() * 8; }
      this.turn.cur += (this.turn.tgt - this.turn.cur) * (1 - Math.exp(-dt * 0.9));
      add("hips", 0, this.turn.cur, 0); add("spine", 0, this.turn.cur * 0.25, 0); add("head", 0, -this.turn.cur * 0.55, 0);
    }

    // взгляд: саккады глаз + доворот головы/шеи за взглядом (при речи — чаще смотрит на собеседника)
    if (ts > this.gaze.next) {
      const away = Math.random() < (speaking ? 0.35 : 0.6);
      this.gaze.tx = away ? (Math.random() - 0.5) * 0.9 : (Math.random() - 0.5) * 0.15;
      this.gaze.ty = away ? (Math.random() - 0.5) * 0.35 : (Math.random() - 0.5) * 0.08;
      this.gaze.next = ts + 0.8 + Math.random() * 2.8;
    }
    const cur = this.cursor && ts - this.cursor.t < 2.5 ? this.cursor : null;
    if (cur) { this.gaze.tx = cur.x * 0.8; this.gaze.ty = cur.y * 0.45; this.gaze.next = ts + 0.6; }
    const eg = this.emoGaze || [0, 0];
    const kg = 1 - Math.exp(-dt * 9), kh = 1 - Math.exp(-dt * 2.2);
    this.gaze.tx2 = this.gaze.tx + eg[0]; this.gaze.ty2 = this.gaze.ty + eg[1];
    this.gaze.x += (this.gaze.tx2 - this.gaze.x) * kg; this.gaze.y += (this.gaze.ty2 - this.gaze.y) * kg;
    this.gaze.hx = (this.gaze.hx || 0) + (this.gaze.x - (this.gaze.hx || 0)) * kh;
    this.gaze.hy = (this.gaze.hy || 0) + (this.gaze.y - (this.gaze.hy || 0)) * kh;
    add("head", -this.gaze.hy * 14, this.gaze.hx * 16, 0); add("neck", -this.gaze.hy * 4, this.gaze.hx * 6, 0);
    const head = this.bones.head;
    if (head && vrm.lookAt) {
      const hp = head.getWorldPosition(new THREE.Vector3());
      this.gazeObj.position.set(hp.x + this.gaze.x * this.s0 * 0.6, hp.y + this.gaze.y * 0.5, hp.z + 1.0 * this.s0);
    }

    // речь: ритмичное «подкачивание» головы от раскрытия рта + кивок на акцентах
    this.nodImp = Math.max(0, this.nodImp - dt * 3.2);
    const nod = Math.sin((1 - this.nodImp) * Math.PI) * (this.nodImp > 0 ? 1 : 0);
    add("head", (open * 2.2 + nod * 6) * this.speakEnv, 0, 0); add("neck", nod * 2 * this.speakEnv, 0, 0);
    add("upperChest", open * 0.6 * this.speakEnv, 0, 0);
    // «разговорная» поза рук: локти чуть согнуты, кисти вперёд (вес по speakEnv)
    if (this.speakEnv > 0.01) {
      const w = this.speakEnv * 0.55;
      add("leftLowerArm", 0, -40 * w, 0); add("rightLowerArm", 0, 40 * w, 0);
      add("leftUpperArm", -8 * w, 0, 0); add("rightUpperArm", -8 * w, 0, 0);
    }

    // осанка эмоций
    for (const [n, w] of Object.entries(this.emo)) {
      if (w < 0.01) continue; const r = EMOTIONS[n];
      for (const [b, v] of Object.entries(r.post)) add(b, v[0], v[1], v[2], w);
      const sh = (r.sh || 0) * w; add("leftShoulder", 0, 0, sh); add("rightShoulder", 0, 0, -sh);
      if (n === "радость") add("spine", Math.sin(ts * 5) * 0.8 * w * this.speakEnv, 0, 0);
      if (n === "страх") add("head", 0, Math.sin(ts * 23) * 0.5 * w, 0);          // мелкая дрожь
    }

    // клипы (жесты / движения): руки — смешивание к абсолютной позе, корпус/голова — аддитивно
    for (const l of this.layers) {
      l.t += dt * l.speed;
      const fd = l.clip.fade || 0.3;
      if (l.state === "in") { l.w = Math.min(1, l.w + dt / fd); if (l.w >= 1) l.state = "on"; }
      if (l.state !== "out" && !l.hold && l.t >= l.clip.dur) l.state = "out";
      if (l.state === "out") l.w = Math.max(0, l.w - dt / fd);
      const w = ease(l.w) * l.amp;
      const p = sampleClip(l.clip, Math.min(l.t, l.clip.dur));
      for (const [b, v] of Object.entries(p)) {
        if (ARM_BONES.has(b)) { const c = pose[b] || (pose[b] = [0, 0, 0]);
          for (let k = 0; k < 3; k++) c[k] += (v[k] - c[k]) * w; }
        else add(b, v[0], v[1], v[2], w);
      }
    }
    this.layers = this.layers.filter(l => !(l.state === "out" && l.w <= 0));

    // запись в нормализованные кости (VRM 0.x: зеркалим X и Z)
    for (const [n, v] of Object.entries(pose)) {
      const b = this.bones[n]; if (!b) continue;
      b.rotation.set(R(v[0]) * this.s0, R(v[1]), R(v[2]) * this.s0);
    }
    if (this.restHips && this.bones.hips) this.bones.hips.position.x = this.restHips.x + (this.hipsOffset || 0) * this.s0;
  }

  state() {
    const r3 = a => a.map(v => +v.toFixed(2));
    const deg = n => { const b = this.bones[n]; return b ? r3([b.rotation.x, b.rotation.y, b.rotation.z].map(THREE.MathUtils.radToDeg)) : null; };
    return { mode: this.mode, speaking: !!this.timeline, speakEnv: +this.speakEnv.toFixed(2),
      layers: this.layers.map(l => `${l.name}:${l.state}:${l.w.toFixed(2)}`),
      vis: Object.fromEntries(VOWELS5.map(v => [v, +this.vis[v].toFixed(2)])),
      emo: Object.fromEntries(Object.entries(this.emo).map(([k, v]) => [k, +v.toFixed(2)])),
      bones: Object.fromEntries(["hips", "spine", "chest", "neck", "head", "leftUpperArm", "rightUpperArm", "rightLowerArm", "rightIndexProximal"].map(n => [n, deg(n)])),
      gestures: GESTURES, motions: MOTIONS, emotions: Object.keys(EMOTIONS).filter(k => /[а-я]/.test(k)) };
  }
}
export { CLIPS, GESTURES, MOTIONS };
