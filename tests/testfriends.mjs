import { _electron as electron } from "playwright-core";
import { spawn } from "child_process";
import fs from "fs";
// Friends: add someone by friend code, see them online, challenge them; they can decline, or accept and land at your table.
const OUT = process.argv[2] || "shots-friends";
fs.mkdirSync(OUT, { recursive: true });
const peer = spawn("node", ["node_modules/peer/dist/bin/peerjs.js", "--port", "9000", "--host", "127.0.0.1"], { stdio: "ignore" });
await new Promise(r => setTimeout(r, 1500));
const q = "?peerhost=127.0.0.1&peerport=9000&peersecure=0&peerpath=/";
async function launch(n) {
  const prof = `/tmp/bounty-prof-fr${n}`; fs.rmSync(prof, { recursive: true, force: true });
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
await wait(5000);
const fa = await A.page.evaluate(() => myFC()), fb = await B.page.evaluate(() => myFC());
console.log("codes", fa, fb);
check(/^[A-Z2-9]{6}$/.test(fa) && /^[A-Z2-9]{6}$/.test(fb) && fa !== fb, "each player has a friend code");
check(await A.page.evaluate(() => JSON.parse(localStorage.getItem("bounty:stats")).fc) === fa, "the code is kept with the profile");
await A.page.click('[data-do="homeplay"]'); await wait(300);
await A.page.click('[data-do="homefriends"]'); await wait(800);
check(await A.page.textContent("#fr-me") === fa, "Friends page shows your code");
await A.page.fill("#fr-code", fb.toLowerCase().slice(0, 3) + "-" + fb.toLowerCase().slice(3)); await A.page.click('[data-do="fradd"]'); await wait(1500);
const row = await A.page.evaluate(() => [...document.querySelectorAll("#fr-list .frrow")].map(r => r.innerText.replace(/\s+/g, " ")));
console.log("A friends", JSON.stringify(row));
check(row.length === 1 && /Friend/.test(row[0]) && /Online/.test(row[0]) && /Challenge/.test(row[0]), "added friend shows online with a Challenge button");
await A.page.screenshot({ path: OUT + "/friends.png" });
// challenge, then B declines
await A.page.click(`[data-do="frch:${fb}"]`); await wait(4000);
const aw = await A.page.evaluate(() => ({room: roomCode, phase: S.phase, chal: !!myChal, banner: (document.querySelector(".banner") || {}).textContent}));
console.log("A waiting", JSON.stringify(aw));
check(/^friend-/.test(aw.room) && aw.phase === "wait" && aw.chal && /Challenge sent to Friend/.test(aw.banner), "challenger waits at a new table");
const inv = await B.page.evaluate(() => { const e = document.querySelector("#invite"); return e && !e.hidden ? e.innerText.replace(/\s+/g, " ") : null; });
console.log("B invite", inv);
check(/Ryan challenges you/.test(inv || "") && /isn't on your friends list/.test(inv || ""), "friend gets the challenge");
await B.page.screenshot({ path: OUT + "/invite.png" });
await B.page.click('[data-do="invno"]'); await wait(3500);
const ad = await A.page.evaluate(() => ({chal: !!myChal, toast: document.querySelector("#toast").textContent}));
console.log("A after decline", JSON.stringify(ad));
check(!ad.chal && /can't play right now/.test(ad.toast), "challenger hears the decline");
// challenge again; B adds Ryan back and accepts
await A.page.evaluate(() => openFriends()); await wait(800);
await A.page.click(`[data-do="frch:${fb}"]`); await wait(4000);
await B.page.waitForSelector("#invite:not([hidden])", { timeout: 10000 }).catch(() => {});
await B.page.click('[data-do="invadd"]'); await wait(500);
check(await B.page.evaluate(code => STATS.fr.some(f => f.c === code), fa), "accepting player can add the challenger as a friend");
await B.page.click('[data-do="invyes"]'); await wait(7000);
const ra = await A.page.evaluate(() => ({room: roomCode, opp: oppM && oppM.nick, phase: S.phase, chal: !!myChal})), rb = await B.page.evaluate(() => ({room: roomCode, opp: oppM && oppM.nick, phase: S.phase}));
console.log("table", JSON.stringify(ra), JSON.stringify(rb));
check(ra.room === rb.room && ra.opp === "Friend" && rb.opp === "Ryan" && !ra.chal, "accepting puts both players at the same table");
await wait(2000);
const st = await A.page.evaluate(() => myStatus());
check(st === "match", "status shows the match");
// a third friend watches the match
const C = await launch("c");
await C.page.evaluate(n => localStorage.setItem("nakama:setup", JSON.stringify({nick: n})), "Watcher");
await C.page.reload(); await wait(1500);
await C.page.evaluate(code => { addFriend(code, "Ryan"); }, fa);
await wait(6000);
await C.page.evaluate(() => { closeModal(); openFriends(); }); await wait(1500);
const wrow = await C.page.evaluate(() => [...document.querySelectorAll("#fr-list .frrow")].map(r => r.textContent));
console.log("C friends", JSON.stringify(wrow));
check(wrow.some(r => /In a match/.test(r) && /Watch/.test(r)), "a friend in a match shows a Watch button");
await C.page.click('[data-do^="frwatch:"]'); await wait(6000);
const cw = await C.page.evaluate(() => ({watch: !!WATCH, mid: document.querySelector("#mid").textContent, me: document.querySelectorAll("#me .card").length, opp: document.querySelectorAll("#opp .card").length, peersA: 0}));
const aOpp = await A.page.evaluate(() => oppM && oppM.nick);
console.log("watching", JSON.stringify(cw), aOpp);
check(cw.watch && /Watching/.test(cw.mid) && /Ryan|Friend/.test(cw.mid) && /vs/.test(cw.mid), "the watcher sees both players");
check(aOpp === "Friend", "a watcher doesn't take a player's seat");
await C.page.screenshot({ path: OUT + "/watch.png" });
await C.page.click('[data-do="stopwatch"]'); await wait(1000);
check(await C.page.evaluate(() => !WATCH && !R), "Stop watching leaves the table");
console.log("errorsC", C.errs.slice(0, 5)); await C.app.close();
console.log("errorsA", A.errs.slice(0, 5)); console.log("errorsB", B.errs.slice(0, 5));
await A.app.close(); await B.app.close(); peer.kill();
console.log(fail ? `${fail} FAILED` : "all passed");
process.exit(fail ? 1 : 0);
