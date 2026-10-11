import { _electron as electron } from "playwright-core";
import { spawn } from "child_process";
import fs from "fs";
// Ranked turn timer: a clock for each turn, a shorter one to answer an attack, and timeouts that end the turn (the third loses).
const openPlay = async p => { const b = await p.$('[data-do="homeplay"]'); if (b && await b.isVisible()) { await b.click(); await p.waitForTimeout(300); } };
const OUT = process.argv[2] || "shots-timer";
fs.mkdirSync(OUT, { recursive: true });
const peer = spawn("node", ["node_modules/peer/dist/bin/peerjs.js", "--port", "9000", "--host", "127.0.0.1"], { stdio: "ignore" });
await new Promise(r => setTimeout(r, 1500));
const q = "?peerhost=127.0.0.1&peerport=9000&peersecure=0&peerpath=/";
async function launch(n) {
  const prof = `/tmp/bounty-prof-tm${n}`; fs.rmSync(prof, { recursive: true, force: true });
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
let fail = 0;
const check = (ok, msg) => { console.log(ok ? "ok  " : "FAIL", msg); if (!ok) fail++; };
const deck = ["OP05-002","OP05-004","OP05-006","OP05-007","OP05-009","OP05-010","OP05-011","OP05-013","OP05-015","OP05-016","OP05-017","OP05-018","OP05-019"].map(c => "4x" + c).join("\n").replace("4xOP05-019", "2xOP05-019");
const A = await launch("a"), B = await launch("b");
for (const [x, nick] of [[A, "Ryan"], [B, "Friend"]]) {
  await x.page.evaluate(([d, n]) => localStorage.setItem("nakama:setup", JSON.stringify({nick: n, leader: "OP05-001", deck: d, life: 5})), [deck, nick]);
  await x.page.reload(); await x.page.waitForTimeout(1500);
}
await openPlay(A.page); await A.page.click('[data-do="homeranked"]'); await wait(2500);
await A.page.click('[data-do="rkfind"]'); await wait(2500);
await openPlay(B.page); await B.page.click('[data-do="homeranked"]'); await wait(3000);
await B.page.click('[data-do="rkfind"]'); await wait(5000);
for (let i = 0; i < 12; i++) {
  for (const x of [A, B]) {
    const b = await x.page.$(".banner .btn.pri, .banner .btn");
    if (b) { await b.click().catch(() => {}); await x.page.waitForTimeout(700); }
  }
}
await wait(2500);
const aTurn = await A.page.evaluate(() => S.myTurn);
const [atk, def] = aTurn ? [A, B] : [B, A];
const chip = (p, id) => p.evaluate(id => { const e = document.querySelector(id); return e && !e.hidden ? e.textContent : null; }, id);
const t1 = await chip(atk.page, "#tmr-me"), t2 = await chip(def.page, "#tmr-opp");
console.log("clocks", t1, "|", t2);
check(/^⏱ [23]:\d\d$/.test(t1 || ""), "player on turn sees their clock");
check(/^⏱ [23]:\d\d$/.test(t2 || ""), "opponent sees the same clock");
check(await chip(def.page, "#tmr-me") === null, "no clock for the player waiting");
await atk.page.screenshot({ path: OUT + "/clock.png" });
// attacking pauses the attacker's clock; the defender gets 45 seconds to answer
await atk.page.evaluate(() => attackWith("ld", "ld"));
await wait(3000);
const p1 = await chip(atk.page, "#tmr-me"), r1 = await chip(def.page, "#tmr-cmb"), o1 = await chip(def.page, "#tmr-opp");
console.log("attack", p1, "|", r1, "|", o1);
check(/paused/.test(p1 || "") && /paused/.test(o1 || ""), "attacker's clock pauses while the defender answers");
check(/^⏱ 0:4\d to respond$/.test(r1 || ""), "defender sees time to respond");
await def.page.screenshot({ path: OUT + "/respond.png" });
const life0 = await def.page.evaluate(() => S.life.length);
await def.page.evaluate(() => { defDl = Date.now(); });
await wait(3500);
const after = await def.page.evaluate(() => ({life: S.life.length, log: myLog.map(e => e[1]).slice(-3)}));
const atkGone = await atk.page.evaluate(() => S.atk);
console.log("auto resolve", JSON.stringify(after));
check(after.life === life0 - 1 && !atkGone, "an unanswered attack resolves by itself");
// running out of time ends the turn
await atk.page.evaluate(() => { S.tleft = 1500; });
await wait(3500);
const to = await atk.page.evaluate(() => ({mine: S.myTurn, tmo: S.tmo, log: myLog.map(e => e[1]).slice(-3)}));
const defTurn = await def.page.evaluate(() => S.myTurn);
console.log("timeout", JSON.stringify(to));
check(!to.mine && to.tmo === 1 && defTurn, "timeout ends the turn and passes it");
// the third timeout loses the match
await def.page.evaluate(() => { S.tmo = 2; S.tleft = 1000; });
await wait(4500);
const lost = await def.page.evaluate(() => ({conceded: S.conceded, rank: RANK}));
const won = await atk.page.evaluate(() => RANK);
console.log("third timeout", JSON.stringify(lost), JSON.stringify(won));
check(lost.conceded && lost.rank.l === 1 && won.w === 1, "third timeout loses the ranked match");
console.log("errorsA", A.errs.slice(0, 5)); console.log("errorsB", B.errs.slice(0, 5));
await A.app.close(); await B.app.close(); peer.kill();
console.log(fail ? `${fail} FAILED` : "all passed");
process.exit(fail ? 1 : 0);
