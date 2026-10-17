import { _electron as electron } from "playwright-core";
import { spawn } from "child_process";
import fs from "fs";
// Best of 3: one player asks for it at the table, the other takes it up, the loser of each game chooses who goes first
// in the next, and the first to two wins takes the match. Also checks the lobby presence carries achievement counts.
const openPlay = async p => { const b = await p.$('[data-do="homeplay"]'); if (b && await b.isVisible()) { await b.click(); await p.waitForTimeout(300); } };
const OUT = process.argv[2] || "shots-bo3";
fs.mkdirSync(OUT, { recursive: true });
const peer = spawn("node", ["node_modules/peer/dist/bin/peerjs.js", "--port", "9000", "--host", "127.0.0.1"], { stdio: "ignore" });
await new Promise(r => setTimeout(r, 1500));
const q = "?peerhost=127.0.0.1&peerport=9000&peersecure=0&peerpath=/";
let fail = 0;
const check = (ok, msg) => { console.log(ok ? "ok  " : "FAIL", msg); if (!ok) fail++; };
async function launch(n) {
  const prof = `/tmp/bounty-prof-bo3-${n}`; fs.rmSync(prof, { recursive: true, force: true });
  const app = await electron.launch({ executablePath: "node_modules/electron/dist/electron", args: ["--no-sandbox", "dist/kit/app"], env: { ...process.env, BOUNTY_PROFILE: prof, BOUNTY_QUERY: q } });
  const page = await app.firstWindow(); const errs = [];
  page.on("pageerror", e => errs.push(String(e)));
  page.on("console", m => { if (m.type() === "error" && !/peerjs\.com|ERR_CONNECTION|40[034]/.test(m.text())) errs.push(m.text()); });
  await page.waitForLoadState("load");
  return { app, page, errs };
}
const deck = ["OP01-013","OP01-016","OP01-024","OP01-014","OP01-015","OP01-017","OP01-018","OP01-019","OP01-020","OP01-021","OP01-022","OP01-025","OP01-026"].map(c => "4x" + c).join("\n").replace(/4x(\S+)$/, "2x$1");
async function join(p, nick, bo) {
  await openPlay(p); await p.click('[data-do="homefriends"]'); await p.click('[data-do="homejoin"]');
  await p.fill("#f-nick", nick); await p.fill("#f-room", "bo3-room-1");
  await p.fill("#f-leader", "OP01-001"); await p.fill("#f-deck", deck);
  if (bo) await p.check("#f-bo3");
  await p.click('[data-do="join"]');
}
const A = await launch(1), B = await launch(2);
await A.page.waitForTimeout(2500);
await A.page.evaluate(() => { STATS.w = 1; statsSave(); });   // one achievement, to see it in the presence
await join(A.page, "Ryan", true); await B.page.waitForTimeout(500); await join(B.page, "Friend", false);
await A.page.waitForTimeout(5000);
const ser = x => x.page.evaluate(() => SER && {w: SER.w, l: SER.l, g: SER.g, done: SER.done, gn: S.gn || 1, phase: S.phase});
check(!!(await ser(A)) && !!(await ser(B)), "the player who didn't ask takes up the best of 3 from the table");
// the opening: roll, choose, keep
async function opening() {
  for (let i = 0; i < 10; i++) {
    for (const x of [A, B]) { const b = await x.page.$(".banner .btn.pri, .banner .btn"); if (b) { await b.click().catch(() => {}); await x.page.waitForTimeout(500); } }
    const ph = await Promise.all([A, B].map(x => x.page.evaluate(() => S.phase)));
    if (ph.every(p => p === "play")) return true;
  }
  return false;
}
check(await opening(), "game 1 starts");
const concede = x => x.page.evaluate(() => doAction("concedeyes"));
await concede(A); await A.page.waitForTimeout(2000);
const s1 = [await ser(A), await ser(B)];
console.log("after game 1", JSON.stringify(s1));
check(s1[0].l === 1 && s1[0].w === 0 && s1[1].w === 1 && s1[1].l === 0, "game 1 goes to the player who didn't concede");
const mid = await A.page.evaluate(() => $("#mid").textContent);
check(/Best of 3: you 0, Friend 1/.test(mid) && await A.page.$('[data-do="sernext"]'), "the end of a game shows the score and Next game");
await A.page.screenshot({ path: OUT + "/after1.png" });
// B starts game 2 first: A still sees the finished game, and that B is ready
await B.page.click('[data-do="sernext"]'); await B.page.waitForTimeout(1500);
check(/Friend is ready for game 2/.test(await A.page.evaluate(() => $("#mid").textContent)), "the other player sees their opponent is ready for the next game");
check(/Waiting for them to start it/.test(await B.page.evaluate(() => $("#banner").textContent)), "the one who started waits for the other");
await A.page.click('[data-do="sernext"]'); await A.page.waitForTimeout(1500);
const ban = await Promise.all([A, B].map(x => x.page.evaluate(() => $("#banner").textContent)));
console.log("game 2 banners", JSON.stringify(ban));
check(/You lost the last game, so you choose/.test(ban[0]) && /Ryan lost the last game and is choosing/.test(ban[1]), "the loser of game 1 chooses who goes first, with no die roll");
await A.page.click('[data-do="fcs"]'); await A.page.waitForTimeout(1500);
const fs2 = await Promise.all([A, B].map(x => x.page.evaluate(() => [S.first, S.gn, S.phase, S.hand.length])));
console.log("game 2", JSON.stringify(fs2));
check(fs2[0][0] === false && fs2[1][0] === true && fs2[0][1] === 2 && fs2[1][1] === 2 && fs2[0][2] === "pre" && fs2[0][3] === 5, "game 2 starts fresh with B going first, as A chose");
check(await opening(), "game 2 starts");
await concede(B); await A.page.waitForTimeout(2000);
check(JSON.stringify([await ser(A), await ser(B)].map(s => [s.w, s.l])) === "[[1,1],[1,1]]", "game 2 makes it 1 to 1");
for (const x of [A, B]) { await x.page.click('[data-do="sernext"]'); await x.page.waitForTimeout(1200); }
await B.page.click('[data-do="fcf"]').catch(() => {}); await B.page.waitForTimeout(1000);
check(await opening(), "game 3 starts, with B choosing");
await concede(A); await A.page.waitForTimeout(2000);
const s3 = [await ser(A), await ser(B)];
console.log("after game 3", JSON.stringify(s3));
check(s3[1].done && s3[1].w === 2 && s3[0].done && s3[0].l === 2, "the first to two wins takes the match");
check(!(await A.page.$('[data-do="sernext"]')) && !(await B.page.$('[data-do="sernext"]')), "there's no next game after that");
await B.page.screenshot({ path: OUT + "/won.png" });
const st = await Promise.all([A, B].map(x => x.page.evaluate(() => [STATS.w, STATS.l])));
console.log("stats", JSON.stringify(st));
check(st[0][1] === 2 && st[1][0] === 2, "each game is counted in the players' stats");
// achievement count in the lobby presence
const ac = await B.page.evaluate(() => { const m = onlineMap(); return Array.from(m.values()).map(o => o.ac); });
console.log("ac", JSON.stringify(ac));
check(ac.some(n => n >= 1), "a player's achievement count reaches the others in the lobby");
for (const [n, x] of [["A", A], ["B", B]]) { console.log("errors" + n, JSON.stringify(x.errs.slice(0, 5))); check(!x.errs.length, "no page errors on " + n); }
await A.app.close(); await B.app.close(); peer.kill();
console.log(fail ? `${fail} FAILED` : "all passed");
process.exit(fail ? 1 : 0);
