// node tools/shot2d.mjs <out.png> <js-before-shot> [w h] — снимок мультяшной страницы
import { spawn } from "node:child_process"; import { writeFileSync } from "node:fs";
const [out, js = "", W = 1600, H = 900] = process.argv.slice(2); const port = 9341;
const ch = spawn("chromium", ["--headless=new", "--no-sandbox", `--remote-debugging-port=${port}`, `--window-size=${W},${H}`,
  `--user-data-dir=${process.env.HOME}/.hermes/cache/scratch/chr-vrm`, "about:blank"], { stdio: "ignore" });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let tabs; for (let i = 0; i < 40; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); break; } catch { await sleep(250); } }
const ws = new WebSocket(tabs.find(t => t.type === "page").webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
let id = 0; const pend = {};
ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; }
  if (d.method === "Runtime.exceptionThrown") console.log("EXC:", JSON.stringify(d.params.exceptionDetails).slice(0, 500));
  if (d.method === "Runtime.consoleAPICalled" && d.params.type === "error") console.log("ERR:", d.params.args.map(a => a.value ?? a.description).join(" ").slice(0, 300)); };
const send = (method, params = {}) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
await send("Runtime.enable"); await send("Page.navigate", { url: process.env.URL }); await sleep(1500);
await send("Runtime.evaluate", { expression: "document.getElementById('start')?.remove();" + js });
await sleep(9000);
const s = await send("Page.captureScreenshot", { format: "png" }); writeFileSync(out, Buffer.from(s.result.data, "base64"));
ws.close(); ch.kill(); process.exit(0);
