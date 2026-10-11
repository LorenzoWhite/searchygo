// Renders the link-preview image with the site's own fonts, colours and textures: node og.mjs <out.png>
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const PORT = 9352;
const out = process.argv[2];
const profile = mkdtempSync(path.join(tmpdir(), "ygo-cdp-"));
const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "--window-size=1200,630", "--hide-scrollbars", "--no-first-run", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const card = (extra = "") => `<g ${extra}><rect x="12" y="3" width="40" height="58" rx="5" fill="#76441f" stroke="#e4b750" stroke-width="2.4"/><rect x="17.5" y="8.5" width="29" height="47" rx="2.5" fill="none" stroke="#b9914b" stroke-width="1.2"/>`;
const art = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-14 -6 92 78" width="386" height="328" style="overflow:visible">
  ${card('transform="rotate(-16 32 60)" opacity="0.55"')}</g>
  ${card('transform="rotate(12 32 60)" opacity="0.75"')}</g>
  ${card()}<circle cx="29.5" cy="27.5" r="8.5" fill="#29190e" stroke="#e4b750" stroke-width="3.6"/><path d="M36.5 34.5 44.5 44.5" fill="none" stroke="#e4b750" stroke-width="4.6" stroke-linecap="round"/></g>
</svg>`;
try {
  let target;
  for (let i = 0; i < 40 && !target; i++) { await sleep(250); target = await fetch(`http://127.0.0.1:${PORT}/json`).then((r) => r.json()).then((l) => l.find((t) => t.type === "page")).catch(() => undefined); }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0;
  const pending = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const send = (method, params = {}) => new Promise((r) => { pending.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });
  await send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 630, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: "http://localhost:3210/" });
  await sleep(5000);
  const html = `
    <div class="halftone" aria-hidden="true"></div>
    <div style="position:relative;z-index:1;width:1200px;height:630px;box-sizing:border-box;padding:0 84px 0 70px;display:grid;grid-template-columns:auto minmax(0,1fr);align-items:center;gap:56px">
      ${art}
      <div style="display:grid;gap:22px;font-family:var(--font-display)">
        <div class="mast__title" style="font-size:132px;font-weight:700;line-height:1;letter-spacing:0.02em;background-size:220% auto;background-position:30% 45%;padding-bottom:8px">Search YGO</div>
        <div style="height:1px;background:var(--color-mat-line)"></div>
        <div style="font-size:39px;font-weight:600;letter-spacing:0.04em;line-height:1.25;color:var(--color-on-mat)">Search Yu-Gi-Oh! cards<br>by what they do</div>
        <div style="font-size:28px;font-weight:600;letter-spacing:0.08em;color:var(--color-gold-dim)">searchygo.com</div>
      </div>
    </div>`;
  await send("Runtime.evaluate", { expression: `document.body.innerHTML = ${JSON.stringify(html)}; document.documentElement.style.overflow = 'hidden'; document.fonts.ready.then(() => 1)`, awaitPromise: true });
  await sleep(1200);
  const { result } = await send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: 1200, height: 630, scale: 1 } });
  writeFileSync(out, Buffer.from(result.data, "base64"));
  console.log("wrote", out);
  ws.close();
} finally {
  chrome.kill();
  await sleep(300);
  rmSync(profile, { recursive: true, force: true });
}
