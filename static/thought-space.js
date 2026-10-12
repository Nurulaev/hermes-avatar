// Ф4 — «пространство мыслей»: орбитальные CSS3D-панели вокруг аватара (текст, код, списки,
// графики, mermaid-схемы, картинки) + живой граф tool-calls Hermes (канвас-виджет с частицами)
// + режимы фона (космос/кабинет/HUD/прозрачный). Канал данных не меняется: те же сообщения
// SSE /events ({type: say|viz|clear|emotion}), плюс новый необязательный {type: toolcall}.
import * as THREE from "three";
import { CSS3DRenderer, CSS3DObject } from "three/addons/renderers/CSS3DRenderer.js";

const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const splitItems = s => String(s || "").split(/\s*[;\n]\s*/).map(x => x.trim()).filter(Boolean);

function sanitizeSvg(src) {
  try {
    const doc = new DOMParser().parseFromString(src, "image/svg+xml");
    const svg = doc.documentElement;
    if (svg.nodeName !== "svg" || doc.querySelector("parsererror")) return null;
    svg.querySelectorAll("script, foreignObject, iframe").forEach(n => n.remove());
    for (const n of [svg, ...svg.querySelectorAll("*")])
      for (const a of [...n.attributes]) if (/^on/i.test(a.name) || /javascript:/i.test(a.value)) n.removeAttribute(a.name);
    return svg;
  } catch { return null; }
}

let mermaidInitDone = false;
function ensureMermaid() {
  if (!window.mermaid) return false;
  if (!mermaidInitDone) {
    mermaidInitDone = true;
    window.mermaid.initialize({ startOnLoad: false, theme: "dark", themeVariables: {
      darkMode: true, background: "#0a121a", primaryColor: "#16313f", primaryTextColor: "#9fd8f5",
      primaryBorderColor: "#2c5a72", lineColor: "#5fb6de", secondaryColor: "#1f4356", fontFamily: "JetBrains Mono, monospace",
    } });
  }
  return true;
}

// ---------- содержимое панели по типу (портировано из toon.html, + mermaid/картинка) ----------
function renderVizDom(spec, idx) {
  const type = (spec.type || "мысль").toLowerCase(), a = spec.args || [];
  const box = document.createElement("div");
  let ttl = spec.title || "";
  switch (type) {
    case "иконки": case "иконка": case "эмодзи": {
      const items = splitItems(a.join(";")).map(it => {
        const m = it.match(/^([^\p{L}\p{N}]+)\s*(.*)$/u);
        return `<div class="it"><div class="em">${esc(m ? m[1].trim() : "✦")}</div><div class="cap">${esc(m ? m[2] : it)}</div></div>`;
      });
      box.innerHTML = `<div class="v-icons">${items.join("")}</div>`; break;
    }
    case "схема": case "процесс": case "цепочка": {
      const nodes = a.join(" ").split(/\s*(?:->|→|=>)\s*/).filter(Boolean);
      box.innerHTML = `<div class="v-flow">${nodes.map((n, i) => (i ? `<span class="ar">➜</span>` : "") +
        `<span class="nd">${esc(n)}</span>`).join("")}</div>`; break;
    }
    case "список": case "пункты": {
      box.innerHTML = `<ul class="v-list">${splitItems(a.join(";")).map(x => `<li>${esc(x)}</li>`).join("")}</ul>`; break;
    }
    case "число": case "цифра": {
      box.innerHTML = `<div class="v-num"><div class="n">${esc(a[0] || "")}</div><div class="c">${esc(a[1] || "")}</div></div>`; break;
    }
    case "график": case "сравнение": case "диаграмма": {
      ttl = ttl || a[1] || "";
      const rows = splitItems(a[0]).map(r => { const m = r.match(/^(.*?)[\s:=]+(-?\d+(?:[.,]\d+)?)\s*([^\d]*)$/);
        return m ? { l: m[1], v: parseFloat(m[2].replace(",", ".")), u: m[3] } : null; }).filter(Boolean);
      const mx = Math.max(...rows.map(r => Math.abs(r.v)), 1e-9);
      box.innerHTML = `<div class="v-bars">${rows.map(r => `<div class="row"><span>${esc(r.l)}</span>
        <div><div class="bar" style="width:${(Math.abs(r.v) / mx * 100).toFixed(1)}%"></div></div><b>${esc(r.v + (r.u ? " " + r.u : ""))}</b></div>`).join("")}</div>`;
      break;
    }
    case "код": { box.innerHTML = `<pre class="v-code">${esc(a.join(" | "))}</pre>`; break; }
    case "svg": case "рисунок": {
      const svg = sanitizeSvg(a.join("|"));
      if (svg) { const d = document.createElement("div"); d.className = "v-svg"; d.appendChild(document.importNode(svg, true)); box.appendChild(d); }
      else box.innerHTML = `<div class="v-thought">…</div>`;
      break;
    }
    case "картинка": case "фото": case "изображение": case "image": {
      const url = (a[0] || "").trim();
      const d = document.createElement("div"); d.className = "v-img";
      const img = document.createElement("img"); img.src = url; img.alt = a[1] || "";
      d.appendChild(img);
      if (a[1]) { const c = document.createElement("div"); c.className = "cap"; c.textContent = a[1]; d.appendChild(c); }
      box.appendChild(d);
      break;
    }
    case "mermaid": case "диаграмма-mermaid": {
      ttl = ttl || "СХЕМА";
      const src = a.join("|").replace(/;/g, "\n");
      const d = document.createElement("div"); d.className = "v-mermaid"; d.textContent = "рисую схему…";
      box.appendChild(d);
      if (ensureMermaid()) {
        const id = "mmd-" + Math.random().toString(36).slice(2);
        window.mermaid.render(id, src).then(({ svg }) => { d.innerHTML = svg; })
          .catch(err => { d.textContent = "ошибка схемы: " + (err?.message || err); });
      } else d.textContent = "mermaid не загружен";
      break;
    }
    default:
      box.innerHTML = `<div class="v-thought">${esc([type === "мысль" ? "" : spec.type, ...a].filter(Boolean).join(" — "))}</div>`;
  }
  if (ttl) box.insertAdjacentHTML("afterbegin", `<div class="ttl">${esc(ttl)}</div>`);
  box.className = "panel-body";
  return box;
}

const STYLE = `
.ts-panel { position: absolute; top: 0; left: 0; width: 230px; box-sizing: border-box; padding: 10px 13px;
  border-radius: 16px; background: linear-gradient(160deg, rgba(14,24,34,.86), rgba(7,12,18,.92));
  border: 1.5px solid rgba(95,182,222,.55); box-shadow: 0 0 22px rgba(60,160,220,.16), inset 0 0 26px rgba(60,160,220,.05);
  color: #bfe6fb; font-family: "JetBrains Mono", monospace; font-size: 13px; line-height: 1.4;
  opacity: 0; transform: scale(.7); transition: opacity .5s, transform .6s cubic-bezier(.3,1.5,.5,1); pointer-events: none; }
.ts-panel.on { opacity: .96; transform: scale(1); }
.ts-panel .ttl { font: 700 10px "JetBrains Mono", monospace; letter-spacing: .18em; opacity: .6; margin-bottom: 6px; text-transform: uppercase; }
.v-thought { font-style: italic; color: #d8f1ff; }
.v-icons { display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; }
.v-icons .it { display: flex; flex-direction: column; align-items: center; max-width: 80px; text-align: center; }
.v-icons .em { font-size: 28px; line-height: 1.1; }
.v-icons .cap { font-size: 11px; opacity: .85; margin-top: 2px; }
.v-flow { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.v-flow .nd { padding: 4px 9px; border-radius: 10px; background: rgba(95,182,222,.12); border: 1px solid rgba(95,182,222,.55); font-size: 12px; }
.v-flow .ar { color: #5fb6de; }
.v-list { margin: 0; padding: 0; list-style: none; font-size: 12px; }
.v-list li { margin: 3px 0; }
.v-list li::before { content: "◆"; color: #5fb6de; margin-right: 7px; font-size: 9px; }
.v-num .n { font: 800 30px "JetBrains Mono", monospace; color: #9fe8ff; }
.v-num .c { font-size: 11px; opacity: .85; margin-top: 2px; }
.v-bars .row { display: grid; grid-template-columns: auto 1fr auto; gap: 6px; align-items: center; font-size: 11px; margin: 4px 0; }
.v-bars .bar { height: 10px; border-radius: 5px; background: linear-gradient(90deg, #2a7fa8, #5fb6de); }
.v-code { margin: 0; font-size: 11px; white-space: pre-wrap; color: #cdeeff; }
.v-svg svg, .v-mermaid svg { width: 100%; height: auto; max-height: 180px; display: block; }
.v-img img { width: 100%; border-radius: 8px; display: block; }
.v-img .cap { font-size: 11px; opacity: .8; margin-top: 4px; text-align: center; }
`;

export class ThoughtSpace {
  constructor(renderer, camera) {
    this.camera = camera;
    this.cssScene = new THREE.Scene();
    this.renderer = new CSS3DRenderer();
    Object.assign(this.renderer.domElement.style, { position: "absolute", top: "0", left: "0", zIndex: "2", pointerEvents: "none" });
    renderer.domElement.insertAdjacentElement("afterend", this.renderer.domElement);
    const st = document.createElement("style"); st.textContent = STYLE; document.head.appendChild(st);
    this.k = 0.0021; // масштаб: CSS-пиксели -> мировые единицы
    this.orbitAngle = 0;
    const base = [-0.62, 0.62, -0.92, 0.92, -0.34, 0.34];
    const h = [0.95, 0.95, 0.5, 0.5, 0.08, 0.08];
    const dir = [1, -1, 1, -1, 1, -1];
    this.slots = base.map((a, i) => ({ angleBase: a, heightFrac: h[i], dir: dir[i], panel: null, t: 0 }));
    this.frame = { center: new THREE.Vector3(0, 1.3, 0), topY: 1.6, bottomY: 1.0, radius: 0.55, faceSign: 1 };
  }
  setSize(w, h) { this.renderer.setSize(w, h); }
  setFrame(topY, bottomY, faceSign) {
    this.frame.topY = topY; this.frame.bottomY = bottomY; this.frame.faceSign = faceSign;
    this.frame.radius = Math.max(0.45, (topY - bottomY) * 0.78);
  }
  clear() {
    for (const s of this.slots) if (s.panel) { this.cssScene.remove(s.panel.obj); s.panel.el.remove(); s.panel = null; }
  }
  showViz(spec) {
    if ((spec.type || "").toLowerCase() === "очистить") return this.clear();
    let s = this.slots.find(x => !x.panel);
    if (!s) s = this.slots.reduce((a, b) => (a.t < b.t ? a : b));
    if (s.panel) { this.cssScene.remove(s.panel.obj); s.panel.el.remove(); }
    const el = document.createElement("div"); el.className = "ts-panel";
    el.appendChild(renderVizDom(spec));
    document.body.appendChild(el); // временно в DOM для расчёта layout — CSS3DObject сам переносит стилями
    const obj = new CSS3DObject(el);
    obj.scale.set(this.k, this.k, this.k);
    this.cssScene.add(obj);
    s.panel = { el, obj }; s.t = performance.now();
    requestAnimationFrame(() => el.classList.add("on"));
  }
  update(dt) {
    this.orbitAngle += dt * 0.12;
    const { center, bottomY, topY, radius, faceSign } = this.frame;
    const cy = (topY + bottomY) / 2;
    for (const s of this.slots) {
      if (!s.panel) continue;
      const osc = Math.sin(this.orbitAngle * 0.6 + s.angleBase * 3) * 0.12; // лёгкий орбитальный дрейф, не полный оборот
      const ang = s.angleBase + osc * s.dir;
      const y = bottomY + (topY - bottomY) * s.heightFrac;
      const x = Math.sin(ang) * radius;
      const z = (Math.cos(ang) * radius * 0.55 + 0.25) * faceSign; // позади центра — шире видимая полоса кадра, не загораживает лицо
      s.panel.obj.position.set(x, y, z);
      s.panel.obj.quaternion.copy(this.camera.quaternion); // билборд — панель всегда читаема
    }
    this.renderer.render(this.cssScene, this.camera);
  }
}

// ---------- живой граф tool-calls: канвас-виджет с узлами-частицами и бегущими импульсами ----------
const STAGE_LABEL = { think: "ДУМАЮ", search: "ИЩУ", read: "ЧИТАЮ ФАЙЛ", write: "ПИШУ", exec: "ВЫПОЛНЯЮ",
  tool: "TOOL", output: "ВЫВОД", done: "ГОТОВО", error: "ОШИБКА" };
const STAGE_COLOR = { think: "#9fd8f5", search: "#f5c76c", read: "#8fe08f", write: "#e08fe0",
  exec: "#ff9d6c", tool: "#6cc4ff", output: "#ffe36c", done: "#7dff9d", error: "#ff6c6c" };

export class ToolCallGraph {
  constructor(container) {
    this.canvas = document.createElement("canvas");
    this.canvas.id = "toolcallGraph";
    Object.assign(this.canvas.style, { position: "absolute", left: "10px", bottom: "10px", width: "300px", height: "150px", zIndex: "3", pointerEvents: "none" });
    container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext("2d");
    this.nodes = []; // {stage, label, t, x, y}
    this.particles = []; // бегущие по рёбрам частицы {from, to, p}
    this.visible = true;
    this.resize();
  }
  resize() {
    const r = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.max(1, r.width * devicePixelRatio);
    this.canvas.height = Math.max(1, r.height * devicePixelRatio);
  }
  setVisible(v) { this.visible = v; this.canvas.style.display = v ? "block" : "none"; }
  push(stage, label) {
    const now = performance.now();
    const node = { stage, label: label || STAGE_LABEL[stage] || stage, t: now };
    this.nodes.push(node);
    if (this.nodes.length > 7) this.nodes.shift();
    if (this.nodes.length > 1) {
      const from = this.nodes[this.nodes.length - 2], to = node;
      for (let i = 0; i < 5; i++) this.particles.push({ from, to, p: -i * 0.22, speed: 1.1 + Math.random() * 0.5 });
    }
  }
  clear() { this.nodes = []; this.particles = []; }
  update(dt) {
    if (!this.visible || !this.nodes.length) return;
    const ctx = this.ctx, W = this.canvas.width, H = this.canvas.height, N = this.nodes.length;
    ctx.clearRect(0, 0, W, H);
    const pad = 18 * devicePixelRatio, step = N > 1 ? (W - pad * 2) / (N - 1) : 0;
    const pos = this.nodes.map((n, i) => ({ x: pad + step * i, y: H * 0.55 + Math.sin(i * 1.7) * H * 0.12 }));
    // рёбра
    ctx.lineWidth = 1.4 * devicePixelRatio;
    for (let i = 1; i < N; i++) {
      ctx.strokeStyle = "rgba(120,190,230,.35)";
      ctx.beginPath(); ctx.moveTo(pos[i - 1].x, pos[i - 1].y); ctx.lineTo(pos[i].x, pos[i].y); ctx.stroke();
    }
    // частицы вдоль рёбер
    this.particles = this.particles.filter(pt => pt.p < 1.15);
    for (const pt of this.particles) {
      pt.p += dt * pt.speed;
      const i = this.nodes.indexOf(pt.to);
      if (i < 1) continue;
      const a = pos[i - 1], b = pos[i], t = Math.max(0, Math.min(1, pt.p));
      const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
      ctx.fillStyle = STAGE_COLOR[pt.to.stage] || "#9fd8f5";
      ctx.beginPath(); ctx.arc(x, y, 2.6 * devicePixelRatio, 0, 7); ctx.fill();
    }
    // узлы
    ctx.font = `${10 * devicePixelRatio}px "JetBrains Mono", monospace`;
    ctx.textAlign = "center";
    this.nodes.forEach((n, i) => {
      const age = (performance.now() - n.t) / 1000, pulse = Math.max(0, 1 - age * 1.5);
      const r = (5 + pulse * 4) * devicePixelRatio;
      ctx.fillStyle = STAGE_COLOR[n.stage] || "#9fd8f5";
      ctx.globalAlpha = 0.35 + 0.5 * (i + 1) / N;
      ctx.beginPath(); ctx.arc(pos[i].x, pos[i].y, r, 0, 7); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = "rgba(210,235,250,.9)";
      ctx.fillText(n.label, pos[i].x, pos[i].y + r + 13 * devicePixelRatio);
    });
  }
}

// ---------- режимы фона ----------
const BG_MODES = ["transparent", "cosmos", "cabinet", "hud"];
export class BackgroundModes {
  constructor(scene, body) {
    this.scene = scene; this.body = body;
    this.hudEl = null; this.starsEl = null;
    this.mode = localStorage.getItem("hermes-bgmode") || "transparent";
    this._apply();
  }
  cycle() { const i = BG_MODES.indexOf(this.mode); this.set(BG_MODES[(i + 1) % BG_MODES.length]); }
  set(mode) {
    if (!BG_MODES.includes(mode)) return;
    this.mode = mode; localStorage.setItem("hermes-bgmode", mode);
    this._apply();
  }
  _apply() {
    this.body.classList.remove("bg-transparent", "bg-cosmos", "bg-cabinet", "bg-hud");
    this.body.classList.add("bg-" + this.mode);
    if (this.hudEl) { this.hudEl.remove(); this.hudEl = null; }
    if (this.starsEl) { this.starsEl.remove(); this.starsEl = null; }
    if (this.mode === "transparent") {
      this.body.style.background = "transparent";
    } else if (this.mode === "cabinet") {
      this.body.style.background = "radial-gradient(ellipse at 50% 30%, #2a2420 0%, #16130f 55%, #060504 100%)";
    } else if (this.mode === "cosmos") {
      this.body.style.background = "radial-gradient(ellipse at 50% 35%, #182a46 0%, #0a1222 55%, #020308 100%)";
      this.starsEl = document.createElement("canvas");
      Object.assign(this.starsEl.style, { position: "absolute", inset: "0", zIndex: "0" });
      this.body.insertBefore(this.starsEl, this.body.firstChild);
      this._paintStars(this.starsEl);
    } else if (this.mode === "hud") {
      this.body.style.background = "#030507";
      this.hudEl = document.createElement("div");
      this.hudEl.id = "hudOverlay";
      Object.assign(this.hudEl.style, { position: "absolute", inset: "0", zIndex: "0",
        backgroundImage: "linear-gradient(rgba(95,182,222,.06) 1px, transparent 1px), linear-gradient(90deg, rgba(95,182,222,.06) 1px, transparent 1px)",
        backgroundSize: "34px 34px" });
      this.body.insertBefore(this.hudEl, this.body.firstChild);
    }
  }
  _paintStars(canvas) {
    canvas.width = innerWidth; canvas.height = innerHeight;
    const ctx = canvas.getContext("2d");
    for (let i = 0; i < 220; i++) {
      const x = Math.random() * canvas.width, y = Math.random() * canvas.height, r = Math.random() * 1.4 + 0.2;
      ctx.globalAlpha = Math.random() * 0.7 + 0.2;
      ctx.fillStyle = "#cfe9ff";
      ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
    }
  }
}
