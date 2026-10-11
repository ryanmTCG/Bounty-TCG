import { _electron as electron } from "playwright-core";
import { spawn } from "child_process";
import fs from "fs";
// the game modes sit behind the home screen's Play button
const openPlay = async p => { const b = await p.$('[data-do="homeplay"]'); if (b && await b.isVisible()) { await b.click(); await p.waitForTimeout(300); } };
const OUT = process.argv[2] || "shots-ranked";
fs.mkdirSync(OUT, { recursive: true });
const peer = spawn("node", ["node_modules/peer/dist/bin/peerjs.js", "--port", "9000", "--host", "127.0.0.1"], { stdio: "ignore" });
await new Promise(r => setTimeout(r, 1500));
const q = "?peerhost=127.0.0.1&peerport=9000&peersecure=0&peerpath=/";
async function launch(n) {
  const prof = `/tmp/bounty-prof-rk${n}`; fs.rmSync(prof, { recursive: true, force: true });
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


const A = await launch("a"), B = await launch("b");
for (const [x, nick] of [[A, "Ryan"], [B, "Friend"]]) {
  await x.page.evaluate(([d, n]) => localStorage.setItem("nakama:setup", JSON.stringify({nick: n, leader: "OP05-001", deck: d, life: 5})), [deckB.replace("4xOP05-019", "2xOP05-019"), nick]);
  await x.page.reload(); await x.page.waitForTimeout(1500);
}
const rk = p => p.evaluate(() => ({ me: (document.querySelector(".rkme") || {}).innerText, deck: (document.querySelector(".rkdeck") || {}).innerText, count: (document.querySelector("#lb-count") || {}).textContent, board: (document.querySelector("#rk-board") || {}).innerText }));
await openPlay(A.page); await A.page.click('[data-do="homeranked"]'); await wait(3000);
console.log("A page", JSON.stringify(await rk(A.page)));
await A.page.screenshot({ path: OUT + "/1-ranked.png" });
await A.page.click('[data-do="rkfind"]'); await wait(2500);
console.log("A toast", await toastText(A.page));
await openPlay(B.page); await B.page.click('[data-do="homelobby"]'); await wait(3500);
console.log("B lobbies (ranked hidden)", JSON.stringify(await lobbies(B.page)));
await B.page.click('[data-do="homeplay"]'); await wait(300); await B.page.click('[data-do="homeranked"]'); await wait(3500);
console.log("B page", JSON.stringify(await rk(B.page)));
await B.page.click('[data-do="rkfind"]'); await wait(5000);
console.log("B toast", await toastText(B.page));
for (const [n, x] of [["A", A], ["B", B]]) console.log(n, "table", JSON.stringify(await x.page.evaluate(() => ({ status: document.querySelector("#status").textContent, ranked: S.ranked, opprk: oppM && oppM.rk }))));
await A.page.evaluate(() => { const c = S.hand[0].c; moveCard("hand:0", "chars"); commit(); window.__played = c; });
await B.page.evaluate(() => { S.conceded = true; commit(); }); await wait(3000);
for (const [n, x] of [["A", A], ["B", B]]) console.log(n, "after", JSON.stringify(await x.page.evaluate(() => RANK)), await toastText(x.page));
// leaving counts as a loss: a second ranked match, then B closes the game mid-match
for (const x of [A, B]) await x.page.evaluate(() => { RANK_GRACE = 4000; closeModal(); openRanked(); });
await wait(2500);
await A.page.click('[data-do="rkfind"]'); await wait(3000);
await B.page.click('[data-do="rkfind"]'); await wait(5000);
console.log("match 2", JSON.stringify(await A.page.evaluate(() => ({ ranked: S.ranked, opp: !!oppM, pend: localStorage.getItem("bounty:rankpend") }))), JSON.stringify(await B.page.evaluate(() => ({ ranked: S.ranked, opp: !!oppM, pend: localStorage.getItem("bounty:rankpend") }))));
const bBefore = await B.page.evaluate(() => RANK);
await B.app.close();
await wait(26000);   // the desktop room notices a closed window within about 15 seconds, then the grace period runs
console.log("A after B left", JSON.stringify(await A.page.evaluate(() => RANK)), await toastText(A.page));
// B opens the game again: the match it walked out of costs bounty
const B2 = await (async () => {
  const app = await electron.launch({ executablePath: "node_modules/electron/dist/electron", args: ["--no-sandbox", "dist/kit/app"], env: { ...process.env, BOUNTY_PROFILE: "/tmp/bounty-prof-rkb", BOUNTY_QUERY: q } });
  const page = await app.firstWindow(); await page.waitForTimeout(3500); return { app, page };
})();
// the match could still be rejoined, so the loss waits; choosing not to rejoin (or waiting too long) applies it
console.log("B before", JSON.stringify(bBefore), "B reopened", JSON.stringify(await B2.page.evaluate(() => [RANK, (document.querySelector('[data-do="rejoin"]') || {}).textContent])));
await B2.page.evaluate(() => rankDeferredApply()); await B2.page.waitForTimeout(2000);
console.log("B gave up the rejoin", JSON.stringify(await B2.page.evaluate(() => [RANK, localStorage.getItem("bounty:rankpend"), localStorage.getItem("bounty:match")])), await toastText(B2.page));
console.log("B history", JSON.stringify(await B2.page.evaluate(() => STATS.h.map(e => [e.r, e.y, e.rk, e.on, e.op]))));
await B2.app.close();
await A.page.evaluate(() => { closeModal(); openRanked(); }); await wait(1500);
console.log("A board", JSON.stringify(await rk(A.page)));
console.log("A stats", JSON.stringify(await A.page.evaluate(() => [STATS, window.__played])));
await A.page.evaluate(() => { closeModal(); openHome(); }); await wait(300);
await A.page.click('[data-do="homeprofile"]'); await wait(800);
console.log("A profile", JSON.stringify(await A.page.evaluate(() => document.querySelector("#modal .sheet").innerText.replace(/\s+/g, " "))));
await A.page.screenshot({ path: OUT + "/3-profile.png" });
await A.page.screenshot({ path: OUT + "/2-after.png" });
console.log("errorsA", JSON.stringify(A.errs.slice(0, 5))); console.log("errorsB", JSON.stringify(B.errs.slice(0, 5)));
await A.app.close(); peer.kill();
