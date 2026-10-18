import { _electron as electron } from "playwright-core";
import fs from "fs";
import path from "path";
import zlib from "zlib";
// Match replays and the computer's difficulty. A match against the computer is recorded as it goes; "Watch replay"
// plays it back (both hands face up, step, jump a turn, speed, seek, keys), it's kept packed on this computer and
// listed on the Replays page, and saved as a file to share and opened again (checked, since it's someone else's
// file). Easy, Normal and Hard change how the computer plays. Runs offline.
const OUT = process.argv[2] || "shots-replay";
fs.mkdirSync(OUT, { recursive: true });
const prof = "/tmp/bounty-prof-replay"; fs.rmSync(prof, { recursive: true, force: true });
const app = await electron.launch({ executablePath: "node_modules/electron/dist/electron", args: ["--no-sandbox", "dist/kit/app"], env: { ...process.env, BOUNTY_PROFILE: prof } });
const page = await app.firstWindow();
const errs = [];
page.on("pageerror", e => errs.push(String(e)));
await page.setViewportSize({ width: 1500, height: 950 }).catch(() => {});
await page.waitForLoadState("load");
await page.waitForTimeout(1500);
let fail = 0;
const check = (ok, msg) => { console.log(ok ? "ok  " : "FAIL", msg); if (!ok) fail++; };
const deck = ["OP01-013","OP01-016","OP01-024","OP01-014","OP01-015","OP01-017","OP01-018","OP01-019","OP01-020","OP01-021","OP01-022","OP01-025","OP01-026"].map(c => "4x" + c).join("\n");

// ---- choosing a difficulty ----
{ const b = await page.$('[data-do="homeplay"]'); if (b && await b.isVisible()) { await b.click(); await page.waitForTimeout(300); } }
await page.click('[data-do="homepractice"]'); await page.waitForTimeout(300); await page.click('[data-do="homebot"]');
await page.waitForTimeout(300);
const d0 = await page.evaluate(() => ({vis: !!document.querySelector(".diffrow") && !document.querySelector(".diffrow").hidden, v: document.querySelector("#f-diff").value, h: document.querySelector("#f-diffh").textContent}));
check(d0.vis && d0.v === "1" && /strategy guides/.test(d0.h), "practice setup offers Computer difficulty, Normal to start");
await page.selectOption("#f-diff", "2");
check(/spreads DON!!/.test(await page.textContent("#f-diffh")), "picking Hard says what it does");
await page.fill("#f-nick", "Ryan");
await page.fill("#f-leader", "OP01-001");
await page.fill("#f-deck", deck);
await page.click('[data-do="vsbot"]');
await page.waitForTimeout(800);
const st = await page.evaluate(() => ({d: PR.diff, s: document.querySelector("#status").textContent, saved: JSON.parse(localStorage.getItem("nakama:setup") || "{}").diff}));
check(st.d === 2 && /\(Hard\)/.test(st.s) && st.saved === 2, "the match is against a Hard computer, and the choice is remembered");

// ---- play a few turns, then concede ----
await page.click('[data-do="prroll"]');
await page.waitForTimeout(400);
if (await page.evaluate(() => PR.roll[0] > PR.roll[1])) await page.click('[data-do="prfirst:0"]');
await page.waitForTimeout(2500);
await page.click('[data-do="keep"]');
for (let i = 0; i < 200; i++) {
  const s = await page.evaluate(() => {
    if (defending()) defResolve(true);
    if (modal && modal.type !== "home") closeModal(); closeMenu();
    while (fxCur) { fxQueue.length = 0; fxFinish(false); }
    if (S.myTurn && !S.atk && !(oppM && oppM.ak)) {
      if (S.turn >= 2 && !S.leader.r && S.donActive) { moveDon({pool: "a"}, "ld"); attackWith("ld", "ld"); }
      else endTurn();
    }
    return {t: S.turn, ot: oppM ? oppM.tn : 0, end: S.conceded || (oppM && oppM.cd)};
  });
  if (s.end || (s.t >= 3 && s.ot >= 3)) break;
  await page.waitForTimeout(400);
}
await page.evaluate(() => { while (fxCur) { fxQueue.length = 0; fxFinish(false); } if (modal) closeModal(); if (!S.conceded) doAction("concede"); });
await page.waitForTimeout(200);
await page.evaluate(() => { if (modal && modal.type === "concede") doAction("concedeyes"); });
await page.waitForTimeout(800);
const rec = await page.evaluate(() => ({n: REC && REC.fr.length, end: REC && REC.end, btn: !!document.querySelector('#mid [data-do="rpwatch"]'), t: S.turn, ot: oppM.tn}));
console.log("recorded", JSON.stringify(rec));
check(rec.n >= 10 && rec.end === "l", "the match was recorded frame by frame, ending in your loss");
check(rec.btn, "a Watch replay button sits next to the result");

// ---- watching it ----
await page.click('#mid [data-do="rpwatch"]');
await page.waitForTimeout(300);
const w0 = await page.evaluate(() => ({on: document.body.classList.contains("replaying"), bar: !!document.querySelector("#rpbar"), n: RPV.A.length, rn: REC.fr.length, playing: RPV.on, info: document.querySelector("#rpinfo").textContent, ev: !!document.querySelector("#rpev")}));
console.log("replay", JSON.stringify(w0));
check(w0.on && w0.bar && w0.n === w0.rn && w0.playing, "the replay opens and plays, with every recorded frame");
check(/Replay: Ryan vs Computer/.test(w0.info), "the bar names both players");
await page.waitForTimeout(1600);
check(await page.evaluate(() => RPV.i) > 0, "playback moves on by itself");
await page.click('[data-do="rp:play"]');
check(await page.evaluate(() => !RPV.on && /Play/.test(document.querySelector("#rp-play").getAttribute("aria-label"))), "pause stops it");
await page.click('[data-do="rp:start"]');
check(await page.evaluate(() => RPV.i === 0 && document.querySelector("#rpseek").value === "0"), "back to the start");
// a frame where the computer holds cards: its hand shows face up, and yours under your side
const hf = await page.evaluate(() => { const i = RPV.B.findIndex((b, k) => b.hd && b.hd.length >= 3 && RPV.A[k].hd && RPV.A[k].hd.length); if (i < 0) return null; rpSeek(i);
  return {i, bh: RPV.B[i].hd.length, oh: document.querySelectorAll("#oppHand .ohcard:not(.back)").length, ah: RPV.A[i].hd.length, mh: document.querySelectorAll("#hand .card").length, codes: [...document.querySelectorAll("#hand .card b")].map(b => b.textContent).join(","), want: RPV.A[i].hd.join(",")}; });
console.log("hands", JSON.stringify(hf));
check(hf && hf.oh === hf.bh && hf.mh === hf.ah && hf.codes === hf.want, "both hands show face up in the replay");
const tj = await page.evaluate(() => { rpSeek(0); const t0 = rpTurn(0); doAction("rp:nextturn"); const t1 = rpTurn(RPV.i), i1 = RPV.i; doAction("rp:nextturn"); const t2 = rpTurn(RPV.i); doAction("rp:prevturn"); return {t0, t1, t2, back: rpTurn(RPV.i), i1, i: RPV.i}; });
console.log("turns", JSON.stringify(tj));
check(tj.t1 > tj.t0 && tj.t2 > tj.t1 && tj.back === tj.t1 && tj.i === tj.i1, "next turn and previous turn jump between turns");
await page.click('[data-do="rp:speed"]');
check(await page.evaluate(() => RPV.sp === 2 && document.querySelector("#rp-speed").textContent === "2×"), "the speed button goes to 2×");
const k0 = await page.evaluate(() => RPV.i);
await page.keyboard.press("ArrowRight");
await page.keyboard.press("ArrowRight");
await page.keyboard.press("ArrowLeft");
check(await page.evaluate(() => RPV.i) === k0 + 1, "the arrow keys step through it");
const sk = await page.evaluate(() => { const el = document.querySelector("#rpseek"); el.value = String(Math.floor(RPV.A.length / 2)); el.dispatchEvent(new Event("input", {bubbles: true})); return {i: RPV.i, want: Math.floor(RPV.A.length / 2)}; });
check(sk.i === sk.want, "dragging the slider seeks");
check(await page.evaluate(() => document.querySelectorAll("#log p:not(.tips)").length > 3 && !S.atk), "the log shows the match up to that point");
await page.screenshot({ path: `${OUT}/replay.png` });
await page.click('[data-do="rp:exit"]');
await page.waitForTimeout(200);
const ex = await page.evaluate(() => ({w: document.body.classList.contains("watching"), rp: RPV, btn: !!document.querySelector('#mid [data-do="rpwatch"]'), mine: document.querySelector("#me").innerHTML.length > 0}));
check(!ex.w && ex.rp === null && ex.btn && ex.mine, "Exit replay goes back to the table");

// ---- kept on this computer ----
await page.waitForTimeout(800);
const kept = await page.evaluate(() => { const l = JSON.parse(localStorage.getItem("bounty:replays") || "[]"); return l.map(e => ({id: e.id, r: e.r, on: e.on, n: e.n, z: e.z[0], len: e.z.length, b: e.b})); });
console.log("kept", JSON.stringify(kept));
check(kept.length === 1 && kept[0].r === "l" && kept[0].on === "Computer" && kept[0].b === 1 && kept[0].z === "z", "the replay is saved, packed, with who played and how it ended");
await page.evaluate(() => openHome());
await page.click('[data-do="homereplays"]');
await page.waitForTimeout(300);
const ls = await page.evaluate(() => ({rows: document.querySelectorAll(".rprow").length, txt: (document.querySelector(".rprow") || {}).innerText || ""}));
check(ls.rows === 1 && /Loss/.test(ls.txt) && /Ryan vs Computer/.test(ls.txt) && /Practice/.test(ls.txt), "the Replays page lists it");
await page.click('.rprow [data-do^="rpopen:"]');
await page.waitForTimeout(500);
const fromList = await page.evaluate(() => ({ok: !!RPV, n: RPV && RPV.A.length, from: RPV && RPV.from, want: REC.fr.length}));
check(fromList.ok && fromList.from === "list" && fromList.n === fromList.want, "Watch opens it from storage (unpacked)");
await page.click('[data-do="rp:exit"]');
await page.waitForTimeout(200);
check(await page.evaluate(() => modal && modal.type === "replays"), "exiting returns to the Replays page");
// ---- replay files ----
const dlPath = path.resolve(`${OUT}/replay-file.json`); fs.rmSync(dlPath, { force: true });
await app.evaluate(({ session }, p) => { session.defaultSession.once("will-download", (e, item) => { item.setSavePath(p); globalThis.__dlName = item.getFilename(); }); }, dlPath);
await page.click('.rprow [data-do^="rpfile:"]');
for (let i = 0; i < 25 && !fs.existsSync(dlPath); i++) await page.waitForTimeout(200);
await page.waitForTimeout(400);
const file = fs.existsSync(dlPath) ? JSON.parse(fs.readFileSync(dlPath, "utf8")) : null, dlName = await app.evaluate(() => globalThis.__dlName);
console.log("file", dlName, file && JSON.stringify(Object.assign({}, file.e, { z: file.e.z.length })));
check(file && file.bounty === "replay" && file.e.z[0] === "z" && file.e.me === "Ryan" && file.e.on === "Computer", "Save file writes the replay to a file");
check(/^bounty-replay-ryan-vs-computer-\d{4}-\d{2}-\d{2}\.json$/.test(dlName || ""), "the file is named after the players and the date");
await page.click('.rprow [data-do^="rpdel:"]');
await page.waitForTimeout(200);
check(await page.evaluate(() => !document.querySelector(".rprow") && JSON.parse(localStorage.getItem("bounty:replays")).length === 0), "Delete removes it");
await page.setInputFiles("#rp-file", dlPath);
await page.waitForTimeout(800);
const im = await page.evaluate(() => ({rows: document.querySelectorAll(".rprow").length, txt: (document.querySelector(".rprow") || {}).innerText || "", toast: document.querySelector("#toast").textContent}));
console.log("opened", JSON.stringify(im));
check(im.rows === 1 && /From a file/.test(im.txt) && /Computer won/.test(im.txt) && /Replay added/.test(im.toast), "Open a replay file adds it to the list");
await page.click('.rprow [data-do^="rpopen:"]');
await page.waitForTimeout(500);
const fw = await page.evaluate(() => ({n: RPV && RPV.A.length, want: REC.fr.length, info: document.querySelector("#rpinfo").textContent}));
check(fw.n === fw.want && /Ryan vs Computer/.test(fw.info), "a replay from a file plays back in full");
await page.click('[data-do="rp:exit"]');
await page.waitForTimeout(200);
await page.setInputFiles("#rp-file", dlPath);
await page.waitForTimeout(600);
check(await page.evaluate(() => document.querySelectorAll(".rprow").length === 1 && /already have/.test(document.querySelector("#toast").textContent)), "opening the same file again doesn't add it twice");
// someone else's file: only what a recording keeps, names cleaned, and nothing too big to unpack
const ev = JSON.parse(JSON.stringify(file));
ev.e.id = "other1"; ev.e.me = '<img src=x onerror="window.__x=1">Zoro'; ev.e.tn = "lots";
const bomb = { bounty: "replay", v: 1, e: { id: "bomb1", me: "B", z: "z" + zlib.gzipSync(Buffer.alloc(40 * 1048576, 32)).toString("base64") } };
const bad = await page.evaluate(async ([ev, bomb]) => {
  const fr = JSON.parse(await rpUnpack(ev.e.z)); fr[1][1] = Object.assign({}, fr[1][1] || {}, {evil: "x", __proto__x: 1}); ev.e.z = "j" + JSON.stringify(fr);
  const r = await rpImport(JSON.stringify(ev)), e = rpList().find(x => x.id === r.id), back = e && JSON.parse(await rpUnpack(e.z));
  return {ok: !!e, me: e && e.me, tn: e && e.tn, evil: back && Object.keys(back[1][1] || {}).some(k => k === "evil" || k === "__proto__x"),
    bomb: (await rpImport(JSON.stringify(bomb))).err || "", junk: (await rpImport("hello")).err || "", wrong: (await rpImport(JSON.stringify({bounty: "replay", e: {z: "j[1,2]"}}))).err || ""};
}, [ev, bomb]);
console.log("checked", JSON.stringify(bad));
check(bad.ok && bad.me === "img srcx onerrorwind" && bad.tn === 0 && !bad.evil, "a file's names are cleaned and board parts a recording doesn't keep are dropped");
check(/too large/.test(bad.bomb) && /isn't a Bounty TCG replay/.test(bad.junk) && /damaged/.test(bad.wrong), "a file that unpacks too big, isn't a replay, or is damaged is refused");
check(await page.evaluate(() => !window.__x), "nothing in a replay file runs");
await page.evaluate(() => { rpStore([]); closeModal(); });

// ---- how each level plays ----
const sync = () => page.evaluate(() => { PR.pres[0] = JSON.parse(JSON.stringify(pubFull())); });
const lvl = n => page.evaluate(n => { PR.diff = n; }, n);
await page.evaluate(() => { S.conceded = false; S.lostDmg = false; S.phase = "play"; S.myTurn = true; S.atk = null; S.turn = Math.max(S.turn, 3); while (S.life.length < 5) S.life.push(S.deck.shift()); commit(); });
// one Character a turn on Easy, as many as it can pay for on Normal
const plays = [];
for (const n of [0, 1]) { await lvl(n); plays.push(await page.evaluate(() => botSide(() => { S.myTurn = true; S.atk = null; S.turn += 1; S.chars = []; S.hand = ["OP01-013", "OP01-014", "OP01-016"].map(c => ({c, n: nameOf(c)})); S.donActive = 10; S.donRested = 0; botMain(); botMain(); botMain(); const r = S.chars.length; S.myTurn = false; return r; }))); }
console.log("plays", JSON.stringify(plays));
check(plays[0] === 1 && plays[1] >= 2, "Easy plays one Character a turn, Normal more");
// a rested Character worth K.O.ing: Normal goes after it, Easy goes straight at your Leader
const mid = await page.evaluate(() => ["OP01-013","OP01-016","OP01-024","OP01-014","OP01-015","OP01-017","OP01-018","OP01-019","OP01-020","OP01-021","OP01-022","OP01-025"].find(c => { const e = CARDDB.get(c) || {}; return e.t === "Character" && e.k >= 3 && e.p != null && e.p <= 4000; }));
await page.evaluate(c => { S.myTurn = false; S.chars = [{card: {c, n: nameOf(c)}, r: true, d: 0, pt: 0}]; commit(); }, mid);
await sync();
const tg = [];
for (const n of [0, 1]) { await lvl(n); tg.push(await page.evaluate(() => botSide(() => { S.leader.pm = 2000; return botTarget({f: S.leader, k: "all", r: "ld"}); }))); }
check(tg[0] === "ld" && tg[1] === "ch:0", `Easy attacks your Leader, Normal K.O.s your rested ${mid} first`);
// Hard goes after a Blocker before a bigger Character
const pair = await page.evaluate(() => { const ks = [...CARDDB.keys()].filter(k => /^OP0[1-4]-/.test(k));
  const blk = ks.find(k => { const e = CARDDB.get(k); return e.t === "Character" && isBlocker(k) && e.k <= 2 && e.p != null && e.p <= 3000; });
  const big = ks.find(k => { const e = CARDDB.get(k); return e.t === "Character" && !isBlocker(k) && e.k >= 4 && e.p != null && e.p <= 4000; });
  S.chars = [blk, big].map(c => ({card: {c, n: nameOf(c)}, r: true, d: 0, pt: 0})); commit(); return [blk, big]; });
await sync();
const tb = [];
for (const n of [1, 2]) { await lvl(n); tb.push(await page.evaluate(() => botSide(() => { S.leader.pm = 2000; return botTarget({f: S.leader, k: "all", r: "ld"}); }))); }
console.log("blocker", JSON.stringify(pair), JSON.stringify(tb));
check(tb[0] === "ch:1" && tb[1] === "ch:0", `Normal K.O.s the bigger ${pair[1]}, Hard your Blocker ${pair[0]}`);
// Hard raises each attacker past your Leader's power; Normal puts the spare DON!! on its Leader
await page.evaluate(() => { S.chars = []; commit(); });
await sync();
const dn = [];
for (const n of [1, 2]) { await lvl(n); dn.push(await page.evaluate(() => botSide(() => { S.myTurn = true; S.atk = null; S.turn += 1; S.leader.r = false; S.leader.d = 0; S.leader.pm = 0;
  S.chars = ["OP01-013", "OP01-013"].map(c => ({card: {c, n: nameOf(c)}, r: false, d: 0, pt: 1, pm: 5000 - (CARDDB.get(c).p || 0)}));
  S.donActive = 4; S.donRested = 0; const atks = botAttackers(); botGiveDon(atks, 4); const r = [S.leader.d || 0, ...S.chars.map(f => f.d || 0)]; S.myTurn = false; return r; }))); }
console.log("don", JSON.stringify(dn));
check(dn[0].join() === "4,0,0" && dn[1].join() === "2,1,1", "Hard spreads DON!! so each attack needs a bigger counter");
// at 1 Life: Normal counters an attack it can stop, Easy only does when the hit would lose
const counters = [];
for (const n of [0, 1]) {
  await lvl(n);
  await page.evaluate(() => { const B = PR.sides[1].S, c2 = [...CARDDB.keys()].find(k => /^OP0/.test(k) && (CARDDB.get(k) || {}).ctr === 2000);
    while (B.life.length > 1) B.trash.push(B.life.pop()); while (!B.life.length) B.life.push(B.deck.shift());
    B.chars = []; B.hand = [{c: c2, n: "", u: 99901 + Math.random()}]; B.leader.pm = 0;
    PR.pres[1] = JSON.parse(JSON.stringify((() => { practiceStash(); practiceLoad(1); const p = pubFull(); practiceStash(); practiceLoad(0); return p; })()));
    oppM = oppModel(PR.pres[1]);
    S.myTurn = true; S.atk = null; S.leader.r = false; S.leader.pm = 1000; S.leader.d = 0; S.chars = []; commit();
    PR.pres[0] = JSON.parse(JSON.stringify(pubFull())); attackWith("ld", "ld"); });
  for (let i = 0; i < 30 && await page.evaluate(() => !!S.atk); i++) await page.waitForTimeout(250);
  counters.push(await page.evaluate(() => ({lf: oppM.lf, h: oppM.h})));
}
console.log("counters", JSON.stringify(counters));
check(counters[0].lf === 0 && counters[1].lf === 1, "at 1 Life Easy takes the hit, Normal counters it");
check(!errs.length, "no page errors" + (errs.length ? ": " + errs.slice(0, 3).join(" / ") : ""));
await app.close();
console.log(fail ? `${fail} FAILED` : "all passed");
process.exit(fail ? 1 : 0);
