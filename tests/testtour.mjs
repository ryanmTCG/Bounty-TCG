import { _electron as electron } from "playwright-core";
import { spawn } from "child_process";
import fs from "fs";
// Tournaments: host one, sign up three players (decklists go to the host), withdraw and come back, start it, play a
// round where the loser's game reports the result, have the host hand over the final, and open the decklists at the end.
const OUT = process.argv[2] || "shots-tour";
fs.mkdirSync(OUT, { recursive: true });
const peer = spawn("node", ["node_modules/peer/dist/bin/peerjs.js", "--port", "9000", "--host", "127.0.0.1"], { stdio: "ignore" });
await new Promise(r => setTimeout(r, 1500));
const q = "?peerhost=127.0.0.1&peerport=9000&peersecure=0&peerpath=/";
async function launch(n) {
  const prof = `/tmp/bounty-prof-tn${n}`; fs.rmSync(prof, { recursive: true, force: true });
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
const until = async (x, fn, arg, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await x.page.evaluate(fn, arg)) return true; await wait(500); } return false; };
const deck = ["OP05-002","OP05-004","OP05-006","OP05-007","OP05-009","OP05-010","OP05-011","OP05-013","OP05-015","OP05-016","OP05-017","OP05-018","OP05-019"].map(c => "4x" + c).join("\n").replace("4xOP05-019", "2xOP05-019");
const A = await launch("a"), B = await launch("b"), C = await launch("c");
const P = {A, B, C};
for (const [x, nick] of [[A, "Host"], [B, "Bea"], [C, "Cid"]]) {
  await x.page.evaluate(([d, n]) => localStorage.setItem("nakama:setup", JSON.stringify({nick: n, leader: "OP05-001", deck: d, life: 5})), [deck, nick]);
  await x.page.reload(); await x.page.waitForTimeout(1500);
}
await wait(4000);
check(await A.page.evaluate(d => !deckIllegal({leader: "OP05-001", deck: d}, "std").length && deckCount(d) === 50, deck), "the test deck is a legal 50-card Standard deck");
// host a tournament
await A.page.click('[data-do="homeplay"]'); await wait(300);
await A.page.click('[data-do="hometours"]'); await wait(600);
await A.page.click('[data-do="tn:host"]'); await wait(300);
await A.page.fill("#tn-name", "Grand Line Cup");
await A.page.selectOption("#tn-cap", "4");
await A.page.click('[data-do="tn:create"]'); await wait(500);
const id = await A.page.evaluate(() => TOUR && TOUR.id);
check(/^t[a-z0-9]{6,12}$/.test(id || "") && await A.page.evaluate(() => TOUR.st === "reg" && TOUR.cap === 4 && TOUR.n === "Grand Line Cup"), "the host opens sign-ups");
check(await until(B, i => tourList().some(t => t.id === i && t.hn === "Host"), id), "other players see the tournament");
await B.page.evaluate(() => { closeModal(); openTours(); }); await wait(600);
const brow = await B.page.evaluate(() => [...document.querySelectorAll("#tn-body .lbrow")].map(r => r.innerText.replace(/\s+/g, " ")));
console.log("B list", JSON.stringify(brow));
check(brow.length === 1 && /Grand Line Cup/.test(brow[0]) && /Sign up/.test(brow[0]) && /0 of 4/.test(brow[0]), "the Tournaments page lists it with a Sign up button");
// everyone signs up, the host too
for (const x of [A, B, C]) await x.page.evaluate(i => { closeModal(); openTours(); tourJoin(i); }, id);
check(await until(A, () => TOUR.pl.length === 3), "the host's game seats all three players");
const hostDecks = await A.page.evaluate(() => TOUR.pl.map(p => deckUnpack(p.d) && deckUnpack(p.d).n));
check(hostDecks.length === 3 && hostDecks.every(n => n === 50), "each decklist reached the host");
await A.page.evaluate(i => { modal.tid = i; renderTours(); }, id); await wait(400);
await B.page.evaluate(i => { modal.tid = i; renderTours(); }, id);
check(await until(B, () => document.querySelectorAll("#tn-body .tnrow").length === 3), "players see who signed up");
check(await A.page.evaluate(() => document.querySelectorAll("#tn-body .tnrow details").length) === 3 && await B.page.evaluate(() => document.querySelectorAll("#tn-body .tnrow details").length) === 0, "only the host sees decklists while it runs");
await A.page.screenshot({ path: OUT + "/signups.png" });
// Cid withdraws, then signs up again
await C.page.evaluate(() => { modal.tid = TME.id; tourWithdraw(); });
check(await until(A, () => TOUR.pl.length === 2 && !TOUR.pl.some(p => p.n === "Cid")), "withdrawing takes a player off the list");
await C.page.evaluate(i => tourJoin(i), id);
check(await until(A, () => TOUR.pl.length === 3), "signing up again puts them back");
// an illegal deck can't sign up
const bad = await B.page.evaluate(() => { const t = tourList()[0]; return tourDeckBad(deckUnpack("OP05-001|OP05-002*4"), t.f); });
check(/50-card/.test(bad), "a short deck can't sign up");
// start: 3 players means one bye
await A.page.click('[data-do="tn:start"]'); await wait(500);
const r0 = await A.page.evaluate(() => ({st: TOUR.st, rd: TOUR.rd, pl: TOUR.pl.map(p => p.n)}));
console.log("round 1", JSON.stringify(r0));
check(r0.st === "run" && r0.rd.length === 1 && r0.rd[0].length === 2 && r0.rd[0].filter(m => m[1] === -1).length === 1, "starting pairs the players, with a bye for the odd one out");
const live = r0.rd[0].find(m => m[1] >= 0), byeP = r0.pl[r0.rd[0].find(m => m[1] === -1)[0]];
const p1 = P[{Host: "A", Bea: "B", Cid: "C"}[r0.pl[live[0]]]], p2 = P[{Host: "A", Bea: "B", Cid: "C"}[r0.pl[live[1]]]];
check(await until(p1, i => !!tourMyMatch(tourList().find(t => t.id === i)), id) && await until(p2, i => !!tourMyMatch(tourList().find(t => t.id === i)), id), "both players in the live match see it's ready");
const toastSeen = await p2.page.evaluate(() => document.querySelector("#toast").textContent);
console.log("toast", toastSeen);
await p1.page.evaluate(i => { closeModal(); openTours(); modal.tid = i; renderTours(); }, id); await wait(400);
check(/Play your match/.test(await p1.page.evaluate(() => document.querySelector("#tn-body .tnstat").innerText)), "the page offers Play your match");
await p1.page.screenshot({ path: OUT + "/ready.png" });
await p1.page.click('[data-do^="tn:play:"]');
await p2.page.evaluate(i => tourPlay(i), id);
check(await until(p1, () => !!oppM && S.phase !== "wait", null, 20000) && await until(p2, () => !!oppM, null, 20000), "both players land at the tournament table");
const tbl = await p1.page.evaluate(() => ({room: roomCode, tour: S.tour, pubt: S.pubt, tools: boardTools()}));
console.log("table", JSON.stringify(tbl));
check(/^tour-t[a-z0-9]+-1-\d$/.test(tbl.room) && tbl.tour && tbl.pubt && !tbl.tools, "a tournament table has no free board tools");
// p2 concedes: their own game reports the loss and the host moves p1 on
await p2.page.evaluate(() => doAction("concedeyes")); await wait(500);
check(await p2.page.evaluate(() => !!(TME && TME.lost)), "the loser's game reports the result");
check(await until(A, () => TOUR.rd.length === 2), "the host moves the winner on to the final");
const fin = await A.page.evaluate(() => ({rd: TOUR.rd, pl: TOUR.pl.map(p => p.n)}));
console.log("after round 1", JSON.stringify(fin));
check(fin.pl[fin.rd[0].find(m => m[1] >= 0)[2]] === r0.pl[live[0]] && fin.rd[1].length === 1 && fin.pl[fin.rd[1][0][0]] === byeP, "the final is the winner against the player with the bye");
check(await until(p2, i => { const t = tourList().find(x => x.id === i); return t && tourOut(t); }, id), "the loser sees they're out");
// the host gives the final to the player with the bye (a no-show)
await A.page.evaluate(i => { closeModal(); openTours(); modal.tid = i; renderTours(); }, id); await wait(400);
await A.page.screenshot({ path: OUT + "/bracket.png" });
const side = fin.rd[1][0][0] === fin.pl.indexOf(byeP) ? 0 : 1;
await A.page.click(`[data-do="tn:give:1:0:${side}"]`); await wait(500);
const done = await A.page.evaluate(() => ({st: TOUR.st, stat: ((document.querySelector("#tn-body .tnstat") || {}).innerText || "").replace(/\s+/g, " ")}));
console.log("done", JSON.stringify(done));
check(done.st === "done" && new RegExp(byeP === "Host" ? "You won" : byeP + " won").test(done.stat), "the host can hand a match over, and the winner is named");
check(await until(B, i => { const t = tourList().find(x => x.id === i); return t && t.st === "done" && t.dl && t.dl.filter(Boolean).length === 3; }, id), "decklists open up for everyone at the end");
await B.page.evaluate(i => { closeModal(); openTours(); modal.tid = i; renderTours(); }, id); await wait(400);
check(await B.page.evaluate(() => document.querySelectorAll("#tn-body .tnrow details").length) === 3, "everyone can read the decklists afterwards");
await B.page.screenshot({ path: OUT + "/done.png" });
// the host takes it down
await A.page.click('[data-do="tn:close"]'); await wait(400);
check(await A.page.evaluate(() => !TOUR) && await until(B, i => !tourList().some(t => t.id === i), id), "taking it down removes it for everyone");
const errs = [A, B, C].flatMap(x => x.errs.filter(e => !/peerjs|ERR_CONNECTION|Failed to load resource/i.test(e)));
console.log("errors", JSON.stringify(errs));
check(!errs.length, "no page errors");
for (const x of [A, B, C]) await x.app.close();
peer.kill();
console.log(fail ? `${fail} FAILED` : "all passed");
process.exit(fail ? 1 : 0);
