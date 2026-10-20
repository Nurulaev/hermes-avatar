// Доспехи Гермеса — процедурная броня поверх любой humanoid-VRM: крылатый шлем, кираса с «мышечным»
// рельефом, наплечники, наручи, пояс. Размеры берутся из реальной сетки (вершины, привязанные к костям),
// куски крепятся к сырым костям (bone.attach), поэтому броня двигается вместе с жестами и мимикой тела.
// Материал назван по шаблону VRoid «…_Armor_00_ACCESSORY» — редактор внешности сам покажет переключатель.
import * as THREE from "three";

const HAIR_RE = /hair/i;

// Габариты сетки по костям: каждая вершина относится к доминирующей кости, кость — к ближайшему
// humanoid-предку; волосы исключаются (иначе голова «раздувается» причёской).
function boneBoxes(vrm) {
  const h = vrm.humanoid, rawToName = new Map();
  for (const name of Object.keys(h.humanBones)) {
    const n = h.getRawBoneNode(name); if (n) rawToName.set(n, name);
  }
  const humanoidOf = node => { for (let n = node; n; n = n.parent) if (rawToName.has(n)) return rawToName.get(n); return null; };
  const boxes = {}, v = new THREE.Vector3();
  vrm.scene.traverse(o => {
    if (!o.isSkinnedMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    if (mats.some(m => HAIR_RE.test(m?.name || "")) || HAIR_RE.test(o.name)) return;
    const bones = o.skeleton.bones.map(humanoidOf);
    const si = o.geometry.attributes.skinIndex, sw = o.geometry.attributes.skinWeight, n = o.geometry.attributes.position.count;
    for (let i = 0; i < n; i++) {
      let best = 0, bw = -1;
      for (let k = 0; k < 4; k++) { const w = sw.getComponent(i, k); if (w > bw) { bw = w; best = si.getComponent(i, k); } }
      const name = bones[best]; if (!name) continue;
      o.getVertexPosition(i, v); o.applyBoneTransform(i, v); o.localToWorld(v);
      (boxes[name] || (boxes[name] = new THREE.Box3())).expandByPoint(v);
    }
  });
  return boxes;
}

function makeMaterials() {
  const name = "Hermes_Armor_00_ACCESSORY";
  const bronze = new THREE.MeshStandardMaterial({ name, color: 0xc89b4a, metalness: 1, roughness: 0.32, envMapIntensity: 1.4 });
  const gold = new THREE.MeshStandardMaterial({ name, color: 0xffd27a, metalness: 1, roughness: 0.18, envMapIntensity: 1.8 });
  const dark = new THREE.MeshStandardMaterial({ name, color: 0x5a4524, metalness: 0.9, roughness: 0.5 });
  const wing = new THREE.MeshStandardMaterial({ name, color: 0xf3ead2, metalness: 0.6, roughness: 0.3, side: THREE.DoubleSide });
  return { bronze, gold, dark, wing };
}

// Крыло из веера перьев (линзовидные пластины), в плоскости YZ: основание в нуле, перья уходят вверх-назад (−Z).
function makeWing(len, mat) {
  const g = new THREE.Group();
  const N = 6;
  for (let k = 0; k < N; k++) {
    const L = len * (1 - k * 0.11), W = L * 0.17;
    const s = new THREE.Shape();
    s.moveTo(0, 0);
    s.quadraticCurveTo(W, L * 0.45, 0, L);
    s.quadraticCurveTo(-W * 0.6, L * 0.5, 0, 0);
    const geo = new THREE.ExtrudeGeometry(s, { depth: len * 0.012, bevelEnabled: true, bevelThickness: len * 0.006,
      bevelSize: len * 0.006, bevelSegments: 1, curveSegments: 8 });
    const m = new THREE.Mesh(geo, mat);
    m.rotation.y = Math.PI / 2;                                    // плоскость пера → YZ
    m.rotation.x = THREE.MathUtils.degToRad(-12 - k * 15);         // веер: от почти вертикали к горизонтали назад
    m.position.set(0, -k * len * 0.035, -k * len * 0.03);
    g.add(m);
  }
  return g;
}

// Строит броню в мировых координатах текущей позы и цепляет куски к костям.
// faceSign: +1 — модель смотрит в +Z (VRM 1.0), −1 — в −Z (VRM 0.x).
export function addHermesArmor(vrm, faceSign = 1) {
  const h = vrm.humanoid; if (!h) return null;
  h.update?.();
  vrm.scene.updateMatrixWorld(true);
  const raw = n => h.getRawBoneNode(n);
  const wpos = n => { const b = raw(n); return b ? b.getWorldPosition(new THREE.Vector3()) : null; };
  const boxes = boneBoxes(vrm);
  const M = makeMaterials();
  const parts = [];
  const fwd = faceSign;                                            // знак «вперёд» по Z
  const attach = (boneName, obj) => {
    const b = raw(boneName) || raw("hips");
    obj.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });
    vrm.scene.add(obj); obj.updateMatrixWorld(true); b.attach(obj); parts.push(obj);
  };
  const facing = g => { g.rotation.y = fwd > 0 ? 0 : Math.PI; return g; };   // канонический «перед» = +Z

  // ---------- шлем ----------
  const head = wpos("head"), headBox = boxes.head;
  if (head && headBox) {
    const c = headBox.getCenter(new THREE.Vector3()), sz = headBox.getSize(new THREE.Vector3());
    const R = Math.max(sz.x, sz.z) * 0.6;
    const eyeY = wpos("leftEye")?.y ?? (c.y + sz.y * 0.05);
    const cy = Math.max(c.y, eyeY - R * 0.15);                     // центр купола — чуть ниже середины лба
    const g = facing(new THREE.Group());
    g.position.set(c.x, cy, c.z);
    const browT = Math.acos(THREE.MathUtils.clamp((eyeY + R * 0.22 - cy) / R, -0.9, 0.95));
    const dome = new THREE.Mesh(new THREE.SphereGeometry(R, 40, 24, 0, Math.PI * 2, 0, browT), M.bronze);
    // назатыльник: задняя половина купола опускается до шеи
    const nape = new THREE.Mesh(new THREE.SphereGeometry(R * 1.01, 32, 12, Math.PI, Math.PI, browT, Math.PI * 0.78 - browT), M.bronze);
    const band = new THREE.Mesh(new THREE.TorusGeometry(R * Math.sin(browT) * 1.02, R * 0.07, 10, 48), M.gold);
    band.rotation.x = Math.PI / 2; band.position.y = R * Math.cos(browT);
    const crest = new THREE.Mesh(new THREE.TorusGeometry(R * 1.03, R * 0.055, 8, 40, Math.PI * 0.9), M.gold);
    crest.rotation.y = Math.PI / 2; crest.rotation.z = Math.PI * 0.05;
    g.add(dome, nape, band, crest);
    for (const side of [-1, 1]) {
      const w = makeWing(R * 1.7, M.wing);
      w.position.set(side * R * 0.97, R * 0.2, -R * 0.05);
      // развернуть плоскость крыла к зрителю (иначе спереди оно видно ребром) и развести в стороны
      w.rotation.set(0, side * THREE.MathUtils.degToRad(-50), side * THREE.MathUtils.degToRad(-22), "YXZ");
      g.add(w);
    }
    attach("head", g);
  }

  // ---------- кираса ----------
  const torso = new THREE.Box3();
  for (const n of ["spine", "chest", "upperChest"]) if (boxes[n]) torso.union(boxes[n]);
  const neck = wpos("neck"), hips = wpos("hips");
  if (!torso.isEmpty() && neck && hips) {
    const c = torso.getCenter(new THREE.Vector3()), sz = torso.getSize(new THREE.Vector3());
    const rx = sz.x * 0.5 * 1.04, rz = sz.z * 0.5 * 1.18;
    const yTop = neck.y - (neck.y - hips.y) * 0.06, yBot = hips.y + (neck.y - hips.y) * 0.08, H = yTop - yBot;
    const g = facing(new THREE.Group());
    g.position.set(c.x, yBot, c.z);
    const shell = new THREE.Mesh(new THREE.CylinderGeometry(1, 0.88, H, 40, 6, true), M.bronze);
    shell.scale.set(rx, 1, rz); shell.position.y = H / 2;
    const shoulderCap = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), M.bronze);
    shoulderCap.scale.set(rx, H * 0.16, rz); shoulderCap.position.y = H;
    const collar = new THREE.Mesh(new THREE.TorusGeometry(1, 0.12, 10, 40), M.gold);
    collar.rotation.x = Math.PI / 2; collar.scale.set(rx * 0.38, rz * 0.5, 1); collar.position.y = H * 1.12;
    g.add(shell, shoulderCap, collar);
    // рельеф: пологие грудные пластины + сегментные полосы на животе — дают перепады яркости в ASCII
    for (const side of [-1, 1]) {
      const pec = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 14), M.bronze);
      pec.scale.set(rx * 0.46, H * 0.13, rz * 0.12); pec.position.set(side * rx * 0.36, H * 0.72, rz * 0.9);
      g.add(pec);
    }
    for (let k = 0; k < 3; k++) {
      const t = 0.18 + k * 0.14, s = 1 - (1 - t) * 0.12;
      const lame = new THREE.Mesh(new THREE.TorusGeometry(1, 0.05, 8, 40, Math.PI), M.dark);
      lame.rotation.x = Math.PI / 2;                                  // полукольцо по передней стороне
      lame.scale.set(rx * s * 1.02, rz * s * 1.04, 1); lame.position.y = H * t;
      g.add(lame);
    }
    for (const t of [0.02, 0.98]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.035, 8, 48), M.gold);
      const s = 1 - (1 - t) * 0.12;
      ring.rotation.x = Math.PI / 2; ring.scale.set(rx * s * 1.01, rz * s * 1.01, 1); ring.position.y = H * t;
      g.add(ring);
    }
    // эмблема — кадуцей: жезл + маленькие крылья на груди
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(rx * 0.025, rx * 0.025, H * 0.34, 8), M.gold);
    rod.position.set(0, H * 0.62, rz * 1.02);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(rx * 0.06, 12, 8), M.gold);
    ball.position.set(0, H * 0.8, rz * 1.02);
    g.add(rod, ball);
    for (const side of [-1, 1]) {
      const w = makeWing(H * 0.16, M.gold);
      w.rotation.set(0, side * Math.PI / 2, side * -0.9);
      w.position.set(side * rx * 0.03, H * 0.76, rz * 1.04);
      g.add(w);
    }
    attach("upperChest", g);

    // пояс
    const belt = new THREE.Mesh(new THREE.TorusGeometry(1, 0.09, 10, 48), M.dark);
    belt.rotation.x = Math.PI / 2; belt.scale.set(rx * 0.92, rz * 0.92, rz * 0.6);
    belt.position.set(c.x, yBot, c.z);
    attach("hips", belt);
  }

  // ---------- наплечники и наручи ----------
  for (const side of ["left", "right"]) {
    const sh = wpos(side + "UpperArm"), el = wpos(side + "LowerArm"), hand = wpos(side + "Hand");
    if (!sh || !el || !hand) continue;
    const upBox = boxes[side + "UpperArm"], loBox = boxes[side + "LowerArm"];
    const armR = upBox ? Math.min(upBox.getSize(new THREE.Vector3()).x, upBox.getSize(new THREE.Vector3()).z) * 0.62 : 0.05;
    const out = Math.sign(sh.x - (hips?.x ?? 0)) || (side === "left" ? 1 : -1);
    const p = new THREE.Group();
    p.position.copy(sh);
    for (let k = 0; k < 3; k++) {
      const cap = new THREE.Mesh(new THREE.SphereGeometry(armR * (0.95 + k * 0.08), 24, 10, 0, Math.PI * 2, 0, Math.PI * 0.5),
        k === 0 ? M.bronze : M.dark);
      cap.scale.set(1.1, 0.6, 1.05);
      cap.position.set(out * armR * (0.3 + k * 0.16), armR * (0.4 - k * 0.38), 0);
      cap.rotation.z = -out * (0.5 + k * 0.14);
      p.add(cap);
    }
    attach(side + "UpperArm", p);

    const dir = hand.clone().sub(el), len = dir.length(); dir.normalize();
    const loR = loBox ? Math.min(loBox.getSize(new THREE.Vector3()).x, loBox.getSize(new THREE.Vector3()).z) * 0.4 : armR * 0.7;
    const v = new THREE.Group();
    v.position.copy(el).addScaledVector(dir, len * 0.66);
    v.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(loR * 1.05, loR * 1.25, len * 0.48, 24, 1, true), M.bronze);
    v.add(tube);
    for (const t of [-0.5, 0, 0.5]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(loR * (1.17 - t * 0.12), loR * 0.08, 8, 28), M.gold);
      ring.rotation.x = Math.PI / 2; ring.position.y = t * len * 0.48;
      v.add(ring);
    }
    attach(side + "LowerArm", v);
  }
  return parts;
}
