import { _electron as electron } from "playwright-core";
import { spawn } from "child_process";
import fs from "fs";
// Rejoin: a player whose game closes mid-match reopens it, presses Rejoin and is back at the same table.
// the game modes sit behind the home screen's Play button
const openPlay = async p => { const b = await p.$('[data-do="homeplay"]'); if (b && await b.isVisible()) { await b.click(); await p.waitForTimeout(300); } };
const OUT = process.argv[2] || "shots-rejoin";
fs.mkdirSync(OUT, { recursive: true });
const peer = spawn("node", ["node_modules/peer/dist/bin/peerjs.js", "--port", "9000", "--host", "127.0.0.1"], { stdio: "ignore" });
await new Promise(r => setTimeout(r, 1500));
const q = "?peerhost=127.0.0.1&peerport=9000&peersecure=0&peerpath=/";
async function launch(n, keep) {
  const prof = `/tmp/bounty-prof-rj${n}`; if (!keep) fs.rmSync(prof, { recursive: true, force: true });
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
  await p.fill("#f-room", "rejoin-room-1");
  await p.fill("#f-leader", "OP01-001");
  await p.fill("#f-deck", deck);
  await p.click('[data-do="join"]');
}

const A = await launch(1), B = await launch(2);
await A.page.waitForTimeout(1500);
await join(A.page, "Ryan"); await join(B.page, "Friend");
await A.page.waitForTimeout(6000);
for (let i = 0; i < 12; i++) for (const x of [A, B]) {
  const b = await x.page.$(".banner .btn.pri, .banner .btn");
  if (b) { await b.click().catch(() => {}); await x.page.waitForTimeout(700); }
}
await A.page.waitForTimeout(1500);
await A.page.evaluate(() => { moveCard("hand:0", "chars"); commit(); });
await A.page.waitForTimeout(1500);
const look = p => p.evaluate(() => ({ phase: S.phase, turn: S.turn, hand: S.hand.length, chars: S.chars.map(f => f.card.c), life: S.life.length, deck: S.deck.length, room: roomCode, opp: oppM ? oppM.nick : null, oppChars: oppM ? oppM.ch.length : null }));
const before = await look(A.page);
console.log("A before", JSON.stringify(before));
await A.app.close();
await B.page.waitForTimeout(3000);
console.log("B while A is gone", JSON.stringify(await look(B.page)));
const A2 = await launch(1, true);
await A2.page.waitForTimeout(2000);
console.log("A2 home", JSON.stringify(await A2.page.evaluate(() => (document.querySelector('[data-do="rejoin"]') || {}).textContent)));
await A2.page.screenshot({ path: OUT + "/1-home.png" });
await A2.page.click('[data-do="rejoin"]');
let after, waited = 0;
for (let i = 0; i < 15; i++) { await A2.page.waitForTimeout(2000); waited += 2; after = await look(A2.page); if (after.opp) break; }
console.log("reconnected after about", waited, "s");
console.log("A2 after", JSON.stringify(after), "same table:", JSON.stringify([before.hand, before.chars, before.life, before.deck]) === JSON.stringify([after.hand, after.chars, after.life, after.deck]));
console.log("B sees A back", JSON.stringify(await look(B.page)));
console.log("B log", JSON.stringify(await B.page.evaluate(() => LOG.slice(-14).map(e => (e.mine ? "me: " : (e.who || "opp") + ": ") + e.m))));
console.log("A2 log", JSON.stringify(await A2.page.evaluate(() => LOG.slice(-14).map(e => (e.mine ? "me: " : (e.who || "opp") + ": ") + e.m))));
await A2.page.screenshot({ path: OUT + "/2-back.png" });
// conceding ends the match, so there's nothing left to rejoin
await A2.page.evaluate(() => { S.conceded = true; commit(); }); await A2.page.waitForTimeout(1500);
console.log("saved after concede", await A2.page.evaluate(() => localStorage.getItem("bounty:match")));
console.log("errorsA", JSON.stringify(A2.errs.slice(0, 5))); console.log("errorsB", JSON.stringify(B.errs.slice(0, 5)));
await A2.app.close(); await B.app.close(); peer.kill();
