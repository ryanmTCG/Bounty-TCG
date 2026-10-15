import { _electron as electron } from "playwright-core";
import { spawn } from "child_process";
import fs from "fs";
import { startFakeFire } from "./fakefire.mjs";
// The Meta page: each signed-in player shares their side of a finished online match (their Leader, their opponent's,
// the result and their own decklist), the page adds the shared records up per Leader, and sharing can be turned off.
const OUT = process.argv[2] || "shots-meta";
fs.mkdirSync(OUT, { recursive: true });
const fire = await startFakeFire(9101);
const peer = spawn("node", ["node_modules/peer/dist/bin/peerjs.js", "--port", "9000", "--host", "127.0.0.1"], { stdio: "ignore" });
await new Promise(r => setTimeout(r, 1500));
const q = "?fbtest=http://127.0.0.1:9101&peerhost=127.0.0.1&peerport=9000&peersecure=0&peerpath=/";
async function launch(n) {
  const prof = `/tmp/bounty-prof-mt${n}`; fs.rmSync(prof, { recursive: true, force: true });
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
check(await A.page.evaluate(() => !!acctUid() && shareOn()), "a signed-in player shares by default");
const games = () => [...fire.docs.keys()].filter(k => k.startsWith("games/")).map(k => Object.assign({ id: k }, fire.plain(fire.docs.get(k))));
async function match(room) {
  for (const x of [A, B]) await x.page.evaluate(r => { sitAt(r, loadSaved()).then(() => { S.pubt = true; S.fmt = "std"; }); }, room);
  const ok = await until(async () => (await A.page.evaluate(() => !!oppM && !!S.statOpp)) && (await B.page.evaluate(() => !!oppM && !!S.statOpp)), 25000);
  await B.page.evaluate(() => { S.conceded = true; addLog("conceded the match"); commit(); render(); });
  return ok;
}
check(await match("meta-test-1"), "both players sit down at the table");
check(await until(() => games().length === 2), "each player's game shares their side of the match");
const g = games(), ga = g.find(x => x.n === "Ryan"), gb = g.find(x => x.n === "Bea");
console.log("records", JSON.stringify(g.map(x => Object.assign({}, x, { d: (x.d || "").slice(0, 40) + "…" }))));
check(ga && gb && ga.l === "OP05-001" && ga.o === "OP01-001" && ga.r === "w" && gb.l === "OP01-001" && gb.o === "OP05-001" && gb.r === "l", "records name each side's Leader and result");
check(ga && ga.k === "lb" && ga.f === "std" && ga.on === "Bea" && ga.m && ga.m === gb.m && ga.by && ga.by !== gb.by, "records carry the kind, format, opponent and match");
check(ga && /^OP05-001\|/.test(ga.d) && gb && /^OP01-001\|/.test(gb.d), "each record has only its own player's decklist");
// someone else's record can't be changed, and nobody can write one for someone else
const tamper = await A.page.evaluate(async id => { try { await (await getDb()).doc(id).set({v: 1, t: Date.now(), l: "OP01-001", r: "w", by: acctUid()}); return "written"; } catch (e) { return e.code || "error"; } }, gb.id);
check(tamper === "not_granted", "a shared record can't be overwritten");
// more shared results, from other players
const LD = ["OP09-001", "OP11-040", "OP17-039"];
for (let i = 0; i < 24; i++) fire.put("games/seed" + i, { v: 1, t: Date.now() - i * 3600e3, m: "seed" + (i >> 1), k: i % 3 ? "lb" : "rk", f: "std", l: LD[i % 3], o: LD[(i + 1) % 3], r: i % 4 === 0 ? "l" : "w", y: "dmg", tn: 7, d: LD[i % 3] + "|OP05-004*4 OP05-006*" + (i % 2 ? 4 : 3), n: "P" + i, on: "", by: "uidx" });
fire.put("games/old", { v: 1, t: Date.now() - 40 * 864e5, k: "lb", f: "std", l: "OP02-001", o: "OP01-001", r: "w", d: "", n: "Old", by: "uidx" });
fire.put("games/extra", { v: 1, t: Date.now(), k: "lb", f: "ext", l: "OP02-001", o: "OP01-001", r: "w", d: "", n: "Ext", by: "uidx" });
fire.put("games/junk", { v: 1, t: Date.now(), l: "<img>", r: "w" });
await A.page.evaluate(() => { COMM.recs = null; COMM.at = 0; openMeta(); });
await A.page.waitForSelector("#mt-body .mtrow", { timeout: 10000 }).catch(() => {});
const rows = await A.page.evaluate(() => [...document.querySelectorAll("#mt-body .mtrow")].map(r => r.innerText.replace(/\s+/g, " ")));
console.log("leaders", JSON.stringify(rows));
check(rows.length === 5 && /OP09-001 · 8 games/.test(rows[0]) && rows.every(r => !/OP02-001/.test(r)), "the Meta page lists Leaders by games played, last 30 days, Standard only");
const r9 = rows.find(r => /OP09-001/.test(r)) || "";
check(/75%$/.test(r9), "win rates are counted per Leader");
await A.page.screenshot({ path: OUT + "/meta.png" });
await A.page.selectOption("#mt-d", "0"); await A.page.selectOption("#mt-f", "all"); await wait(300);
check(await A.page.evaluate(() => document.querySelectorAll("#mt-body .mtrow").length) === 6, "any time and all formats take in the older and Extra games");
await A.page.check("#mt-rk"); await wait(300);
const rk = await A.page.evaluate(() => [...document.querySelectorAll("#mt-body .mtrow")].map(r => r.innerText.replace(/\s+/g, " ")));
check(rk.length === 1 && /OP09-001 · 8 games/.test(rk[0]), "ranked and tournaments only filters out lobby games");
await A.page.uncheck("#mt-rk"); await A.page.selectOption("#mt-f", "std"); await A.page.selectOption("#mt-d", "30"); await wait(300);
await A.page.click('[data-do="mt:ld:OP11-040"]'); await wait(400);
const det = await A.page.evaluate(() => ({mu: [...document.querySelectorAll("#mt-body .mtgrid .mtrow")].map(r => r.innerText.replace(/\s+/g, " ")), lists: [...document.querySelectorAll("#mt-body .mtlist summary")].map(s => s.innerText), core: document.querySelectorAll("#mt-body .mtcore span").length}));
console.log("OP11-040", JSON.stringify(det));
check(det.mu.length === 1 && /vs .*OP17-039 · 8 games/.test(det.mu[0]) && det.lists.length === 2 && /played 4 times/.test(det.lists[0]) && det.core === 2, "a Leader shows its matchups, most played lists and core cards");
await A.page.screenshot({ path: OUT + "/leader.png" });
await A.page.click('[data-do="mt:open:0"]'); await wait(800);
const bd = await A.page.evaluate(() => ({ld: BD.leader && BD.leader.c, n: bdTotal()}));
console.log("deck editor", JSON.stringify(bd));
check(bd.ld === "OP11-040" && bd.n === 8, "a list opens in the Deck editor");
await A.page.evaluate(() => closeBuilder());
// Bea turns sharing off: her side isn't shared, and Ryan's record leaves her name out
await B.page.evaluate(() => { openProfile(); const c = document.querySelector("#pf-share"); c.checked = false; c.dispatchEvent(new Event("change")); });
check(await B.page.evaluate(() => STATS.ns === 1 && !shareOn()), "sharing can be turned off in Profile");
const before = games().length;
check(await match("meta-test-2"), "a second match starts");
check(await until(() => games().length === before + 1), "only the player who shares adds a record");
await wait(1500);
const last = games().filter(x => x.n === "Ryan").sort((a, b) => b.t - a.t)[0];
check(games().length === before + 1 && last && last.on === "" && last.o === "OP01-001", "the opponent who doesn't share isn't named");
const errs = [A, B].flatMap(x => x.errs);
console.log("errors", JSON.stringify(errs));
check(!errs.length, "no page errors");
for (const x of [A, B]) await x.app.close();
peer.kill(); fire.close();
console.log(fail ? `${fail} FAILED` : "all passed");
process.exit(fail ? 1 : 0);
