import { _electron as electron } from "playwright-core";
import { spawn } from "child_process";
import fs from "fs";
const peer = spawn("node", ["node_modules/peer/dist/bin/peerjs.js", "--port", "9000", "--host", "127.0.0.1"], { stdio: "ignore" });
await new Promise(r => setTimeout(r, 1500));
const q = "?peerhost=127.0.0.1&peerport=9000&peersecure=0&peerpath=/";
async function launch(n) {
  const prof = `/tmp/bounty-prof-lc${n}`; fs.rmSync(prof, { recursive: true, force: true });
  const app = await electron.launch({ executablePath: "node_modules/electron/dist/electron", args: ["--no-sandbox", "dist/kit/app"], env: { ...process.env, BOUNTY_PROFILE: prof, BOUNTY_QUERY: q } });
  const page = await app.firstWindow(); const errs = [];
  page.on("pageerror", e => errs.push(String(e)));
  await page.waitForLoadState("load"); await page.waitForTimeout(1200);
  return { app, page, errs };
}
const wait = ms => new Promise(r => setTimeout(r, ms));
const rows = p => p.evaluate(() => [...document.querySelectorAll(".lbrow b")].map(e => e.textContent).join(" | ") + " / " + (document.querySelector("#lb-count") || {}).textContent);
const A = await launch("a"), B = await launch("b"), C = await launch("c");
await A.page.click('[data-do="homelobby"]'); await wait(2500);           // A becomes the lobby's relay
await B.page.click('[data-do="homelobby"]'); await wait(1000);
await B.page.click('[data-do="lbmake"]'); await wait(300);
await B.page.fill("#f-nick", "Bea"); await B.page.fill("#f-leader", "OP05-001"); await B.page.fill("#f-deck", "4xOP05-002\n4xOP05-004");
await B.page.click("#f-joinbtn"); await wait(2500);
await C.page.click('[data-do="homelobby"]'); await wait(3000);
console.log("C before", await rows(C.page));
await A.app.close();                                                       // the relay quits
for (const t of [3, 8, 15, 25]) { await wait(t === 3 ? 3000 : (t === 8 ? 5000 : t === 15 ? 7000 : 10000)); console.log(`C ${t}s after relay quit`, await rows(C.page)); }
console.log("errs", JSON.stringify(B.errs.concat(C.errs).slice(0, 5)));
await B.app.close(); await C.app.close(); peer.kill();
