import { _electron as electron } from "playwright-core";
import { spawn } from "child_process";
import fs from "fs";
const OUT = process.argv[2] || "shots-lobby";
fs.mkdirSync(OUT, { recursive: true });
const peer = spawn("node", ["node_modules/peer/dist/bin/peerjs.js", "--port", "9000", "--host", "127.0.0.1"], { stdio: "ignore" });
await new Promise(r => setTimeout(r, 1500));
const q = "?peerhost=127.0.0.1&peerport=9000&peersecure=0&peerpath=/";
async function launch(n) {
  const prof = `/tmp/bounty-prof-lb${n}`; fs.rmSync(prof, { recursive: true, force: true });
  const app = await electron.launch({ executablePath: "node_modules/electron/dist/electron", args: ["--no-sandbox", "dist/kit/app"],
    env: { ...process.env, BOUNTY_PROFILE: prof, BOUNTY_QUERY: q } });
  const page = await app.firstWindow();
  const errs = [];
  page.on("pageerror", e => errs.push(String(e)));
  page.on("console", m => { if (m.type() === "error") errs.push(m.text()); });
  await page.setViewportSize({ width: 1280, height: 900 }).catch(() => {});
  await page.waitForLoadState("load");
  await page.waitForTimeout(1200);
  return { app, page, errs };
}
const wait = ms => new Promise(r => setTimeout(r, ms));
const deckA = ["OP01-013","OP01-016","OP01-024","OP01-014","OP01-015","OP01-017","OP01-018","OP01-019","OP01-020","OP01-021","OP01-022","OP01-025","OP01-026"].map(c => "4x" + c).join("\n");
const deckB = ["OP05-002","OP05-004","OP05-006","OP05-007","OP05-009","OP05-010","OP05-011","OP05-013","OP05-015","OP05-016","OP05-017","OP05-018","OP05-019"].map(c => "4x" + c).join("\n");
const lobbies = p => p.evaluate(() => ({
  count: (document.querySelector("#lb-count") || {}).textContent,
  rows: [...document.querySelectorAll(".lbrow")].map(r => r.innerText.replace(/\s+/g, " ").trim()),
  empty: (document.querySelector(".lbempty") || {}).textContent
}));
const toastText = p => p.evaluate(() => { const t = document.querySelector("#toast"); return t && !t.hidden ? t.textContent : ""; });

const A = await launch("a"), B = await launch("b"), C = await launch("c");
// A: open Lobbies, nothing there yet
await A.page.click('[data-do="homelobby"]');
await wait(4000);
console.log("A empty", JSON.stringify(await lobbies(A.page)));
await A.page.screenshot({ path: OUT + "/1-empty.png" });
// A: make a Standard lobby with a Block 1 deck (should warn)
await A.page.click('[data-do="lbmake"]');
await wait(300);
await A.page.screenshot({ path: OUT + "/2-make.png" });
console.log("A make form", JSON.stringify(await A.page.evaluate(() => ({ h: document.querySelector(".sheet h2").textContent, pub: document.querySelector("#f-pub").checked, room: document.querySelector("#f-room").value, btn: document.querySelector("#f-joinbtn").textContent, fmt: document.querySelector("#f-fmt").value }))));
await A.page.fill("#f-nick", "Ryan");
await A.page.fill("#f-lname", "Wano warmup");
await A.page.fill("#f-leader", "OP01-001");
await A.page.fill("#f-deck", deckA);
await A.page.click("#f-joinbtn");
await wait(2500);
console.log("A toast", await toastText(A.page));
console.log("A banner", await A.page.evaluate(() => (document.querySelector("#banner") || {}).textContent));
await A.page.screenshot({ path: OUT + "/3-hosting.png" });
// C: browse
await C.page.click('[data-do="homelobby"]');
await wait(4000);
console.log("C sees", JSON.stringify(await lobbies(C.page)));
await C.page.screenshot({ path: OUT + "/4-list.png" });
// B: browse and join from the list
await B.page.click('[data-do="homelobby"]');
await wait(4000);
console.log("B sees", JSON.stringify(await lobbies(B.page)));
await B.page.click('.lbrow [data-do^="lbjoin:"]');
await wait(300);
console.log("B join form", JSON.stringify(await B.page.evaluate(() => ({ h: document.querySelector(".sheet h2").textContent, note: (document.querySelector(".lbjoining") || {}).textContent, room: document.querySelector("#f-room").value, ro: document.querySelector("#f-room").readOnly, pub: !!document.querySelector("#f-pub"), btn: document.querySelector("#f-joinbtn").textContent }))));
await B.page.screenshot({ path: OUT + "/5-joinform.png" });
await B.page.fill("#f-nick", "Friend");
await B.page.fill("#f-leader", "OP05-001");
await B.page.fill("#f-deck", deckB);
await B.page.click("#f-joinbtn");
await wait(5000);
for (const [n, x] of [["A", A], ["B", B]]) {
  console.log(n, "table", JSON.stringify(await x.page.evaluate(() => ({ status: document.querySelector("#status").textContent, opp: [...document.querySelectorAll(".opp .nick, .lifehead .ltitle")].map(e => e.textContent), banner: (document.querySelector("#banner") || {}).textContent }))));
}
await B.page.screenshot({ path: OUT + "/6-B-table.png" });
console.log("C after join", JSON.stringify(await lobbies(C.page)));
await C.page.screenshot({ path: OUT + "/7-inmatch.png" });
// A's own view of the lobby list
await A.page.click('[data-do="home"]').catch(() => {});
await wait(300);
await A.page.click('[data-do="homelobby"]');
await wait(2500);
console.log("A sees", JSON.stringify(await lobbies(A.page)));
await A.page.click('[data-do="closemodal"]').catch(() => {});
// A leaves the table (practice alone) -> listing disappears
await A.page.click('[data-do="setup"]');
await wait(300);
await A.page.click('[data-do="solo"]');
await wait(3000);
console.log("C after host left", JSON.stringify(await lobbies(C.page)));
await C.page.screenshot({ path: OUT + "/8-closed.png" });
// narrow window
await C.page.setViewportSize({ width: 400, height: 860 }).catch(() => {});
await B.page.evaluate(() => { doAction("setup"); });
await wait(300);
await B.page.check("#f-pub"); await B.page.fill("#f-room", "narrow-test-1");
await B.page.click("#f-joinbtn");
await wait(3500);
await C.page.screenshot({ path: OUT + "/9-narrow.png" });
console.log("C narrow", JSON.stringify(await lobbies(C.page)));
console.log("errorsA", JSON.stringify(A.errs.slice(0, 5))); console.log("errorsB", JSON.stringify(B.errs.slice(0, 5))); console.log("errorsC", JSON.stringify(C.errs.slice(0, 5)));
await A.app.close(); await B.app.close(); await C.app.close(); peer.kill();
