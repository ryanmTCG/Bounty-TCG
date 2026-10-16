import { _electron as electron } from "playwright-core";
import { spawn } from "child_process";
import fs from "fs";
// Find a match: quick and ranked queues pair the next two players, and the page counts who's queuing and who's playing.
const OUT = process.argv[2] || "shots-quick";
fs.mkdirSync(OUT, { recursive: true });
const peer = spawn("node", ["node_modules/peer/dist/bin/peerjs.js", "--port", "9000", "--host", "127.0.0.1"], { stdio: "ignore" });
await new Promise(r => setTimeout(r, 1500));
const q = "?peerhost=127.0.0.1&peerport=9000&peersecure=0&peerpath=/";
async function launch(n) {
  const prof = `/tmp/bounty-prof-qk${n}`; fs.rmSync(prof, { recursive: true, force: true });
  const app = await electron.launch({ executablePath: "node_modules/electron/dist/electron", args: ["--no-sandbox", "dist/kit/app"], env: { ...process.env, BOUNTY_PROFILE: prof, BOUNTY_QUERY: q } });
  const page = await app.firstWindow(); const errs = [];
  page.on("pageerror", e => errs.push(String(e)));
  page.on("console", m => { if (m.type() === "error" && !/40[034]|peerjs\.com|ERR_CONNECTION/.test(m.text())) errs.push(m.text()); });
  await page.setViewportSize({ width: 1280, height: 900 }).catch(() => {});
  await page.waitForLoadState("load"); await page.waitForTimeout(1500);
  return { app, page, errs };
}
const wait = ms => new Promise(r => setTimeout(r, ms));
let fail = 0;
const check = (ok, msg) => { console.log(ok ? "ok  " : "FAIL", msg); if (!ok) fail++; };
const until = async (fn, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await wait(400); } return false; };
const A = await launch("a"), B = await launch("b"), C = await launch("c");
for (const [x, nick] of [[A, "Ryan"], [B, "Bea"], [C, "Cal"]]) {
  await x.page.evaluate(n => { const d = deckUnpack(BOT_DECKS[0].d); localStorage.setItem("nakama:setup", JSON.stringify({nick: n, leader: d.l, deck: d.deck, life: 5})); }, nick);
  await x.page.reload(); await x.page.waitForTimeout(1500);
}
await C.page.evaluate(() => { openHome("play"); }); await wait(300);
await C.page.click('[data-do="homequick"]');
const line = k => C.page.evaluate(k => (document.querySelector(`.lbcount[data-q="${k}"]`) || {}).textContent || "", k);
check(await until(async () => /0 in the queue · 0 in a match/.test(await line(2))), "the page shows an empty quick queue");
await A.page.evaluate(() => openQuick()); await wait(1500);
await A.page.click('[data-do="qkfind"]');
check(await until(async () => /1 in the queue · 0 in a match/.test(await line(2))), "a player waiting shows in the quick queue");
check(/0 in the queue/.test(await line(1)), "the ranked queue is counted apart");
await C.page.screenshot({ path: OUT + "/queue.png" });
await B.page.evaluate(() => openQuick()); await wait(2500);
await B.page.click('[data-do="qkfind"]');
check(await until(async () => (await A.page.evaluate(() => !!oppM && S.quick && S.pubt && !S.ranked)) && (await B.page.evaluate(() => !!oppM && roomCode.startsWith("quick-")))), "the next player is paired into the same public table");
check(await until(async () => /0 in the queue · 2 in a match/.test(await line(2))), "both show as in a match");
// the match shows under Watch a match, and C can watch it
check(await until(async () => /Ryan.*vs.*Bea|Bea.*vs.*Ryan/.test(await C.page.evaluate(() => (document.querySelector("#live-list") || {}).innerText || ""))), "the quick match is listed to watch, with both players");
await C.page.screenshot({ path: OUT + "/live.png" });
// quick chat: Bea sees Ryan's message, then mutes him
const blog = () => B.page.evaluate(() => LOG.filter(l => /says/.test(l.m) && !l.mine).length);
await A.page.evaluate(() => { qcLast = 0; quickChat(0); });
check(await until(async () => await blog() === 1), "a quick chat message reaches the opponent");
await B.page.evaluate(() => { qcMenu(); const it = [...document.querySelectorAll("#menu button")].find(b => /Mute their messages/.test(b.textContent)); it.click(); });
await A.page.evaluate(() => { qcLast = 0; quickChat(QC.length - 1); });
await wait(2500);
check(await blog() === 1 && await B.page.evaluate(() => qcMute), "muting stops their messages for the match");
await C.page.click('#live-list [data-do^="livewatch:"]');
check(await until(() => C.page.evaluate(() => !!WATCH && !!WATCH.a && !!WATCH.b && document.body.classList.contains("watching"))), "watching shows both boards");
check(await C.page.evaluate(() => !(WATCH.a.hd || WATCH.b.hd)), "a watcher never gets a hand");
await C.page.screenshot({ path: OUT + "/watching.png" });
check(await A.page.evaluate(() => !!oppM && oppM.nick === "Bea"), "the watcher doesn't take a seat");
await C.page.evaluate(() => stopWatch()); await wait(800);
await C.page.evaluate(() => findMatch(1));
await wait(500);
const D = await launch("d");
await D.page.evaluate(() => { const d = deckUnpack(BOT_DECKS[0].d); localStorage.setItem("nakama:setup", JSON.stringify({nick: "Dee", leader: d.l, deck: d.deck, life: 5})); });
await D.page.reload(); await D.page.waitForTimeout(1500);
await D.page.evaluate(() => openQuick());
check(await until(async () => /1 in the queue/.test(await D.page.evaluate(() => document.querySelector('.lbcount[data-q="1"]').textContent))), "a ranked player waiting shows in the ranked count");
const errs = [A, B, C, D].flatMap(x => x.errs);
console.log("errors", JSON.stringify(errs));
check(!errs.length, "no page errors");
for (const x of [A, B, C, D]) await x.app.close();
peer.kill();
console.log(fail ? `${fail} FAILED` : "all passed");
process.exit(fail ? 1 : 0);
