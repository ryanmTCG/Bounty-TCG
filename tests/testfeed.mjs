import { _electron as electron } from "playwright-core";
import { spawn } from "child_process";
import fs from "fs";
import { startFakeFire } from "./fakefire.mjs";
// Shared replays: a finished online match's replay (both boards, no hands) rides along with each player's shared record
// and plays from the Meta page's Recent games; any replay can be shared as a code, and anyone can open a code.
const OUT = process.argv[2] || "shots-feed";
fs.mkdirSync(OUT, { recursive: true });
const fire = await startFakeFire(9101);
const peer = spawn("node", ["node_modules/peer/dist/bin/peerjs.js", "--port", "9000", "--host", "127.0.0.1"], { stdio: "ignore" });
await new Promise(r => setTimeout(r, 1500));
const q = "?fbtest=http://127.0.0.1:9101&peerhost=127.0.0.1&peerport=9000&peersecure=0&peerpath=/";
async function launch(n) {
  const prof = `/tmp/bounty-prof-fd${n}`; fs.rmSync(prof, { recursive: true, force: true });
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
const until = async (fn, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await wait(400); } return false; };
const deck = ["OP05-002","OP05-004","OP05-006","OP05-007","OP05-009","OP05-010","OP05-011","OP05-013","OP05-015","OP05-016","OP05-017","OP05-018","OP05-019"].map(c => "4x" + c).join("\n").replace("4xOP05-019", "2xOP05-019");
const A = await launch("a"), B = await launch("b");
for (const [x, nick, ld, mail] of [[A, "Ryan", "OP05-001", "ryan@example.com"], [B, "Bea", "OP01-001", "bea@example.com"]]) {
  await x.page.evaluate(([d, n, l]) => localStorage.setItem("nakama:setup", JSON.stringify({nick: n, leader: l, deck: d, life: 5})), [deck, nick, ld]);
  await x.page.evaluate(m => window.bountyAccount.signUp(m, "secret1"), mail);
  await x.page.reload(); await x.page.waitForTimeout(1500);
}
// a short match: both sit down, a few moves each, then Bea concedes
for (const x of [A, B]) await x.page.evaluate(r => { sitAt(r, loadSaved()).then(() => { S.pubt = true; S.fmt = "std"; }); }, "feed-test-1");
check(await until(async () => (await A.page.evaluate(() => !!oppM && !!S.statOpp)) && (await B.page.evaluate(() => !!oppM && !!S.statOpp)), 25000), "both players sit down at the table");
// click through the opening (die roll, choose first, keep hand) on both sides, then pass a few turns
for (let i = 0; i < 16; i++) {
  for (const x of [A, B]) {
    if (await x.page.evaluate(() => S.phase === "play")) continue;
    const bt = await x.page.$(".banner .btn.pri, .banner .btn"); if (bt) { await bt.click().catch(() => {}); await wait(700); }
  }
  if (await A.page.evaluate(() => S.phase === "play") && await B.page.evaluate(() => S.phase === "play")) break;
}
check(await A.page.evaluate(() => S.phase === "play") && await B.page.evaluate(() => S.phase === "play"), "the match starts");
for (let i = 0; i < 12 && (await A.page.evaluate(() => S.turn + (oppM ? oppM.tn || 0 : 0))) < 5; i++) {
  for (const x of [A, B]) {
    const bt = await x.page.$(".banner .btn.pri"); if (bt) { await bt.click().catch(() => {}); await wait(600); }
    if (await x.page.evaluate(() => S.myTurn && !S.atk && !modal)) { await x.page.evaluate(() => endTurn()); await wait(1200); }
  }
}
await B.page.evaluate(() => { S.conceded = true; addLog("conceded the match"); commit(); render(); });
const docs = p => [...fire.docs.keys()].filter(k => k.startsWith(p)).map(k => Object.assign({ id: k }, fire.plain(fire.docs.get(k))));
check(await until(() => docs("games/").length === 2 && docs("replays/").length === 2, 20000), "each player shares their record and its replay");
const g = docs("games/"), rp = docs("replays/");
console.log("records", JSON.stringify(g.map(x => ({ id: x.id, n: x.n, rp: x.rp }))), JSON.stringify(rp.map(x => ({ id: x.id, by: x.by, len: (x.e || "").length }))));
check(g.every(x => x.rp === 1) && g.every(x => rp.some(r => r.id === "replays/" + x.id.slice(6) && r.by === x.by)), "each record points at its own replay, under the same id");
const inner = await A.page.evaluate(async txt => { const o = JSON.parse(txt); return await rpUnpack(o.e.z); }, rp[0].e);
check(!/"hd"/.test(inner) && /"ld"/.test(inner), "a shared match replay has both boards but no hands");

// ---- Recent games ----
await A.page.evaluate(() => { COMM.recs = null; COMM.at = 0; closeModal(); openMeta(); });
await A.page.waitForSelector("#mt-tab-recent"); await wait(800);
await A.page.click('[data-do="mt:view:recent"]'); await wait(500);
const feed = await A.page.evaluate(() => ({rows: [...document.querySelectorAll("#mt-body .rprow")].map(r => r.innerText.replace(/\s+/g, " ")), watch: document.querySelectorAll('#mt-body [data-do^="mt:rp:"]').length, tab: document.querySelector("#mt-tab-recent").classList.contains("pri")}));
console.log("feed", JSON.stringify(feed));
check(feed.tab && feed.rows.length === 1 && feed.watch === 1, "Recent games shows the match once, with Watch");
check(/(Ryan beat Bea|Bea lost to Ryan)/.test(feed.rows[0]) && /Bea conceded/.test(feed.rows[0]) && /Lobby/.test(feed.rows[0]), "the row says who won, how and where");
await A.page.screenshot({ path: OUT + "/feed.png" });
const before = await A.page.evaluate(() => rpList().length);
await A.page.click('[data-do="mt:rp:0"]');
check(await until(() => A.page.evaluate(() => !!RPV && RPV.from === "feed" && RPV.A.length > 5)), "Watch plays the shared replay");
const pl = await A.page.evaluate(() => ({kept: rpList().length, opp: document.querySelectorAll("#opp .card").length, mid: document.querySelector("#mid").textContent}));
console.log("playing", JSON.stringify(pl));
check(pl.kept === before, "watching from the feed doesn't add to your replays");
await A.page.click('[data-do="rp:exit"]'); await wait(500);
check(await A.page.evaluate(() => modal && modal.type === "meta" && modal.view === "recent"), "leaving the replay goes back to Recent games");

// ---- replay codes ----
await A.page.evaluate(() => { closeModal(); openReplays(); }); await wait(500);
const mine = await A.page.evaluate(() => rpList().filter(e => !e.sh).map(e => e.id));
check(mine.length >= 1, "the match is in Ryan's replays");
await A.page.click(`[data-do="rpshare:${mine[0]}"]`);
check(await until(() => docs("replays/").length === 3), "Share code puts the replay up under a code");
const codeDoc = docs("replays/").find(x => /^replays\/[a-z0-9]{8}$/.test(x.id));
const code = codeDoc ? codeDoc.id.slice(8) : "";
const nice = (code.slice(0, 4) + "-" + code.slice(4)).toUpperCase();
await until(() => A.page.evaluate(n => document.querySelector("#toast").textContent.includes(n) && /Code /.test(document.querySelector(".rprow").innerText), nice));
const shown = await A.page.evaluate(() => ({toast: document.querySelector("#toast").textContent, row: document.querySelector(".rprow").innerText.replace(/\s+/g, " ")}));
console.log("shared", code, JSON.stringify(shown));
check(codeDoc && codeDoc.by === g.find(x => x.n === "Ryan").by && /"hd"/.test(await A.page.evaluate(async t => rpUnpack(JSON.parse(t).e.z), codeDoc.e)), "the code holds the replay as Ryan saved it, hand and all");
check(shown.toast.includes(nice) && shown.row.includes("Code " + nice) && /Copy code/.test(shown.row), "the code is shown, and stays on the replay");
const tamper = await B.page.evaluate(async c => { try { await (await getDb()).doc("replays/" + c).set({v: 1, t: Date.now(), by: acctUid(), e: "x"}); return "written"; } catch (e) { return e.code || "error"; } }, code);
check(tamper === "not_granted", "nobody can replace a shared replay");
// Bea opens it
await B.page.evaluate(() => { closeModal(); openReplays(); }); await wait(400);
await B.page.fill("#rp-code", "zzzz-zzzz"); await B.page.click('[data-do="rpcode"]'); await wait(1200);
check(/no replay with that code/.test(await B.page.textContent("#toast")), "a wrong code says so");
const n0 = await B.page.evaluate(() => rpList().length);
await B.page.fill("#rp-code", " " + nice.toLowerCase() + " "); await B.page.click('[data-do="rpcode"]');
check(await until(() => B.page.evaluate(() => !!RPV && RPV.from === "list")), "a code opens the replay");
const bl = await B.page.evaluate(c => { const e = rpList().find(x => x.code === c); return {n: rpList().length, sh: e && e.sh, me: e && e.me}; }, code);
check(bl.n === n0 + 1 && bl.sh === 1 && bl.me === "Ryan", "and keeps it in Bea's replays, marked as shared with her");
await B.page.click('[data-do="rp:exit"]'); await wait(500);
check(/Shared with you/.test(await B.page.evaluate(() => document.querySelector("#modal").innerText)), "the list says it was shared");
await B.page.screenshot({ path: OUT + "/replays.png" });
// signed out, Share code asks you to sign in
await A.page.evaluate(() => window.bountyAccount.signOut()); await A.page.reload(); await A.page.waitForTimeout(1500);
await A.page.evaluate(id => rpShare(id), mine[mine.length - 1]); await wait(300);
check(/Sign in to an account/.test(await A.page.textContent("#toast")) || (await A.page.evaluate(() => rpList().every(e => e.code))), "sharing a code needs an account");
console.log("errorsA", JSON.stringify(A.errs)); console.log("errorsB", JSON.stringify(B.errs));
check(!A.errs.length && !B.errs.length, "no page errors");
await A.app.close(); await B.app.close(); peer.kill(); fire.close();
console.log(fail ? `${fail} FAILED` : "all passed");
process.exit(fail ? 1 : 0);
