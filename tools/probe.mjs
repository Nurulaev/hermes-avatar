// node tools/probe.mjs "<js expr>" — вычислить выражение на загруженной странице аватара
import { spawn } from "node:child_process";
const port = 9334;
const ch = spawn("chromium", ["--headless=new", "--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
  `--remote-debugging-port=${port}`, "--window-size=900,900", `--user-data-dir=${process.env.HOME}/.hermes/cache/scratch/chr-probe`, "about:blank"], { stdio: "ignore" });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let tabs; for (let i = 0; i < 40; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); break; } catch { await sleep(250); } }
const ws = new WebSocket(tabs.find(t => t.type === "page").webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
let id = 0; const pend = {};
ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; }
  if (d.method === "Runtime.exceptionThrown") console.log("EXC:", JSON.stringify(d.params.exceptionDetails).slice(0, 400)); };
const send = (method, params = {}) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async e => (await send("Runtime.evaluate", { expression: e, returnByValue: true })).result?.result?.value;
await send("Runtime.enable"); await send("Page.navigate", { url: "http://127.0.0.1:8765/" });
for (let i = 0; i < 60; i++) { await sleep(500); if (await ev("!document.getElementById('load')")) break; }
console.log(JSON.stringify(await ev(process.argv[2]), null, 1));
ws.close(); ch.kill(); process.exit(0);
