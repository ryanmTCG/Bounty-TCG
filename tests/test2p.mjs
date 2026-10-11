import { _electron as electron } from "playwright-core";
import { spawn } from "child_process";
import fs from "fs";
// the game modes sit behind the home screen's Play button
const openPlay = async p => { const b = await p.$('[data-do="homeplay"]'); if (b && await b.isVisible()) { await b.click(); await p.waitForTimeout(300); } };
const OUT = process.argv[2] || "shots";
fs.mkdirSync(OUT, { recursive: true });
const peer = spawn("node", ["node_modules/peer/dist/bin/peerjs.js", "--port", "9000", "--host", "127.0.0.1"], { stdio: "ignore" });
await new Promise(r => setTimeout(r, 1500));
const q = "?peerhost=127.0.0.1&peerport=9000&peersecure=0&peerpath=/";
async function launch(n) {
  const prof = `/tmp/bounty-prof-${n}`; fs.rmSync(prof, { recursive: true, force: true });
  const app = await electron.launch({ executablePath: "node_modules/electron/dist/electron", args: ["--no-sandbox", "dist/kit/app"],
    env: { ...process.env, BOUNTY_PROFILE: prof, BOUNTY_QUERY: q } });
  const page = await app.firstWindow();
  const errs = [];
  page.on("pageerror", e => errs.push(String(e)));
  page.on("console", m => { if (m.type() === "error") errs.push(m.text()); });
  await page.waitForLoadState("load");
  return { app, page, errs };
}
const deck = ["OP01-013","OP01-016","OP01-024","OP01-014","OP01-015","OP01-017","OP01-018","OP01-019","OP01-020","OP01-021","OP01-022","OP01-025","OP01-026"].map(c => "4x" + c).join("\n");
async function join(p, nick) {
  await openPlay(p); await p.click('[data-do="homejoin"]');
  await p.fill("#f-nick", nick);
  await p.fill("#f-room", "test-room-1");
  await p.fill("#f-leader", "OP01-001");
  await p.fill("#f-deck", deck);
  await p.click('[data-do="join"]');
}
const A = await launch(1), B = await launch(2);
await A.page.waitForTimeout(1500);
await A.page.screenshot({ path: OUT + "/home.png" });
const fonts = await A.page.evaluate(async () => { await document.fonts.ready; return [...document.fonts].filter(f => f.status === "loaded").map(f => f.family + " " + f.weight); });
console.log("fonts", fonts);
const art = await A.page.evaluate(async () => { const r = await fetch("/_blob/card_OP01-013"); const s = await fetch("/_blob/621dd934e12d43b3703a3254ac86e6f1"); return [r.status, r.headers.get("content-type"), s.status]; });
console.log("art fetch", art);
await join(A.page, "Ryan"); await join(B.page, "Friend");
await A.page.waitForTimeout(6000);
for (const [n, x] of [["A", A], ["B", B]]) {
  const st = await x.page.evaluate(() => ({ status: document.querySelector(".status") && document.querySelector(".status").textContent, opp: [...document.querySelectorAll(".opp .nick")].map(e => e.textContent), arts: document.querySelectorAll("img.art").length, broken: [...document.querySelectorAll("img.art")].filter(i => i.complete && !i.naturalWidth).length, banner: (document.querySelector(".banner") || {}).textContent }));
  console.log(n, JSON.stringify(st));
  await x.page.screenshot({ path: `${OUT}/${n}.png` });
}
// click through the opening (die roll, choose first, keep hand) on both sides
for (let i = 0; i < 12; i++) {
  for (const x of [A, B]) {
    const b = await x.page.$(".banner .btn.pri, .banner .btn");
    if (b) { console.log("click", await b.textContent()); await b.click().catch(() => {}); await x.page.waitForTimeout(700); }
  }
}
await A.page.waitForTimeout(1500);
for (const [n, x] of [["A", A], ["B", B]]) {
  const st = await x.page.evaluate(() => ({ chips: [...document.querySelectorAll(".shead .chip, .ohandp .chip")].map(e => e.textContent), banner: (document.querySelector(".banner") || {}).textContent, hand: document.querySelectorAll(".hand .card").length }));
  console.log(n, JSON.stringify(st));
  await x.page.screenshot({ path: `${OUT}/${n}-play.png` });
}
// card reading without a key should point at the menu
const s = await A.page.evaluate(async () => { const sm = await window.claude.use("sample"); return [await sm.limits(), await sm.json("x", {}).then(() => "ok", e => e.code)]; });
console.log("sample", JSON.stringify(s));
await A.page.waitForTimeout(500);
await A.page.screenshot({ path: OUT + "/keydlg.png" });
console.log("errorsA", A.errs.slice(0, 5)); console.log("errorsB", B.errs.slice(0, 5));
await A.app.close(); await B.app.close(); peer.kill();
