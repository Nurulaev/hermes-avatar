// node tools/stage3.mjs <script.json>  — живой прогон /vrm в headless Chromium (GPU по возможности).
// script.json: {url, w, h, steps:[{eval?:js, wait?:ms, shot?:path, print?:js}]}
// eval/print выполняются с awaitPromise; print — выводит JSON-результат в stdout.
import { spawn } from "node:child_process"; import { writeFileSync, readFileSync } from "node:fs";
const cfg = JSON.parse(readFileSync(process.argv[2], "utf8"));
const port = 9342 + Math.floor(Math.random() * 500);
const W = cfg.w || 1280, H = cfg.h || 960;
const ch = spawn("chromium", ["--headless=new", "--no-sandbox", `--remote-debugging-port=${port}`, `--window-size=${W},${H}`,
  "--autoplay-policy=no-user-gesture-required", "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows", "--use-angle=vulkan", "--enable-gpu", "--ignore-gpu-blocklist",
  `--user-data-dir=${process.env.HOME}/.hermes/profiles/opus/cache/scratch/chr-stage3-${port}`, "about:blank"], { stdio: "ignore" });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let tabs; for (let i = 0; i < 60; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); break; } catch { await sleep(250); } }
const ws = new WebSocket(tabs.find(t => t.type === "page").webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
let id = 0; const pend = {};
ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; }
  if (d.method === "Page.screencastFrame") ws.send(JSON.stringify({ id: ++id, method: "Page.screencastFrameAck", params: { sessionId: d.params.sessionId } }));
  if (d.method === "Runtime.exceptionThrown") console.log("EXC:", JSON.stringify(d.params.exceptionDetails).slice(0, 600));
  if (d.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(d.params.type))
    console.log(d.params.type.toUpperCase() + ":", d.params.args.map(a => a.value ?? a.description).join(" ").slice(0, 300)); };
const send = (method, params = {}) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
await send("Runtime.enable"); await send("Page.enable"); await send("Page.bringToFront");
await send("Emulation.setFocusEmulationEnabled", { enabled: true });
// headless не рисует кадры без потребителя → rAF «засыпает»; screencast держит постоянный поток кадров
await send("Page.startScreencast", { format: "jpeg", quality: 10, maxWidth: 160, maxHeight: 120, everyNthFrame: 1 });
await send("Page.navigate", { url: cfg.url });
for (const st of cfg.steps) {
  if (st.wait) await sleep(st.wait);
  if (st.eval) { const r = await send("Runtime.evaluate", { expression: st.eval, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) console.log("EVAL EXC:", JSON.stringify(r.result.exceptionDetails).slice(0, 400)); }
  if (st.print) { const r = await send("Runtime.evaluate", { expression: st.print, awaitPromise: true, returnByValue: true });
    console.log(st.label || "PRINT", JSON.stringify(r.result?.result?.value ?? r.result)); }
  if (st.shot) { const s = await send("Page.captureScreenshot", { format: "png" }); writeFileSync(st.shot, Buffer.from(s.result.data, "base64")); console.log("SHOT", st.shot); }
}
ws.close(); ch.kill(); process.exit(0);
