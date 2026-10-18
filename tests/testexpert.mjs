import { _electron as electron } from "playwright-core";
import fs from "fs";
import { startFakeFire } from "./fakefire.mjs";
// The computer's Expert level and the decks it can play: recent tournament lists, the Meta page's most played lists,
// or one you type in. Expert plans its plays to use its DON!!, keeps them for a winning turn, counters with no more
// than it needs and takes early hits on its Leader.
const OUT = process.argv[2] || "shots-expert";
fs.mkdirSync(OUT, { recursive: true });
const fire = await startFakeFire(9101);
const prof = "/tmp/bounty-prof-expert"; fs.rmSync(prof, { recursive: true, force: true });
const app = await electron.launch({ executablePath: "node_modules/electron/dist/electron", args: ["--no-sandbox", "dist/kit/app"], env: { ...process.env, BOUNTY_PROFILE: prof, BOUNTY_QUERY: "?fbtest=http://127.0.0.1:9101" } });
const page = await app.firstWindow(); const errs = [];
page.on("pageerror", e => errs.push(String(e)));
page.on("console", m => { if (m.type() === "error" && !/peerjs\.com|ERR_CONNECTION|40[034]/.test(m.text())) errs.push(m.text()); });
await page.setViewportSize({ width: 1280, height: 900 }).catch(() => {});
await page.waitForLoadState("load"); await page.waitForTimeout(1500);
let fail = 0;
const check = (ok, msg) => { console.log(ok ? "ok  " : "FAIL", msg); if (!ok) fail++; };
const wait = ms => page.waitForTimeout(ms);
const deck = ["OP01-013","OP01-016","OP01-024","OP01-014","OP01-015","OP01-017","OP01-018","OP01-019","OP01-020","OP01-021","OP01-022","OP01-025","OP01-026"].map(c => "4x" + c).join("\n");
// two shared matches with the same OP05-001 list, so the Meta page has a most played list
const list = "OP05-001|" + ["OP05-004","OP05-006","OP05-007","OP05-009","OP05-010","OP05-011","OP05-013","OP05-015","OP05-016","OP05-017","OP05-018","OP05-019"].map(c => c + "*4").join(" ") + " OP05-002*2";
for (const [i, r] of [[1, "w"], [2, "l"]]) fire.put(`games/m${i}-a`, {v: 1, t: Date.now() - i * 60000, m: "m" + i, k: "lb", f: "std", l: "OP05-001", o: "OP01-001", r, y: "", tn: 6, d: list, n: "Bea", on: "", by: "u" + i});

// ---- setting up a match against the computer ----
{ const b = await page.$('[data-do="homeplay"]'); if (b && await b.isVisible()) { await b.click(); await wait(300); } }
await page.click('[data-do="homepractice"]'); await page.waitForTimeout(300); await page.click('[data-do="homebot"]'); await wait(1200);
const s0 = await page.evaluate(() => ({diffs: [...document.querySelectorAll("#f-diff option")].map(o => o.textContent), open: document.querySelector("#f-other").open, sum: document.querySelector("#f-other summary").textContent,
  t: [...document.querySelectorAll('#f-odeck optgroup[label^="Tournament"] option')].map(o => o.textContent), m: [...document.querySelectorAll('#f-odeck optgroup[label^="Most played"] option')].map(o => o.textContent), v: document.querySelector("#f-odeck").value}));
console.log("setup", JSON.stringify(s0));
check(s0.diffs.join() === "Easy,Normal,Hard,Expert,Master", "the computer has Expert and Master levels");
check(s0.open && s0.sum === "The computer's deck" && s0.v === "", "the computer's deck shows, set to your own deck to start");
check(s0.t.length === 12 && s0.t.some(t => /^Black Luffy \(OP17-079\)/.test(t)) && s0.t.some(t => /^Blue Xebec \(OP17-039\)/.test(t)), "twelve tournament decks to pick from");
check(s0.m.length === 1 && /OP05-001\), 2 games/.test(s0.m[0]), "the Meta page's most played list is there too");
await page.selectOption("#f-diff", "3");
check(/plans each turn/.test(await page.textContent("#f-diffh")), "picking Expert says what it does");
await page.selectOption("#f-odeck", "t:OP17-079");
const f1 = await page.evaluate(() => ({l: $("#f-leader2").value, n: deckCount($("#f-deck2").value), h: $("#f-odeckh").textContent, bad: deckIllegal({leader: "OP17-079", deck: $("#f-deck2").value}, "std")}));
console.log("picked", JSON.stringify(f1));
check(/^OP17-079 Monkey\.D\.Luffy/.test(f1.l) && f1.n === 50 && /Black Luffy: 1st/.test(f1.h) && !f1.bad.length, "picking a tournament deck fills in its Leader and 50 cards, legal in Standard");
await page.fill("#f-deck2", "4xOP17-080"); await page.dispatchEvent("#f-deck2", "input");
check(await page.evaluate(() => $("#f-odeck").value) === "own", "typing a list switches to it");
await page.selectOption("#f-odeck", "m:0");
check(await page.evaluate(() => $("#f-leader2").value.startsWith("OP05-001") && deckCount($("#f-deck2").value) === 50), "the Meta page's list fills in too");
await page.selectOption("#f-odeck", "t:OP17-039");
await page.fill("#f-nick", "Ryan"); await page.fill("#f-leader", "OP01-001"); await page.fill("#f-deck", deck);
await page.evaluate(() => $("#f-other").scrollIntoView()); await wait(200);
await page.screenshot({ path: OUT + "/setup.png" });
await page.click('[data-do="vsbot"]'); await wait(800);
const st = await page.evaluate(() => ({d: PR.diff, s: document.querySelector("#status").textContent, ld: PR.sides[1].S.leader.card.c, n: PR.sides[1].S.deck.length + PR.sides[1].S.hand.length, saved: loadSaved().odeck}));
console.log("start", JSON.stringify(st));
check(st.d === 3 && /\(Expert\)/.test(st.s), "the match is against an Expert computer");
check(st.ld === "OP17-039" && st.n === 50 && st.saved === "t:OP17-039", "the computer plays the Xebec list, and the choice is remembered");
await page.evaluate(() => { closeModal(); openSetup({bot: true}); }); await wait(500);
check(await page.evaluate(() => $("#f-odeck").value === "t:OP17-039" && $("#f-leader2").value.startsWith("OP17-039")), "the next setup starts with the same deck");
await page.evaluate(() => closeModal());

// ---- how Expert plays ----
await page.evaluate(() => { PR.roll = [6, 1]; practiceFirst(0); }); await wait(2500);
await page.click('[data-do="keep"]'); await wait(1500);
const sync = () => page.evaluate(() => { PR.pres[0] = JSON.parse(JSON.stringify(pubFull())); });
const lvl = n => page.evaluate(n => { PR.diff = n; }, n);
await page.evaluate(() => { S.phase = "play"; S.myTurn = false; S.atk = null; S.turn = Math.max(S.turn, 3); commit(); });
await sync();
// with 5 DON!! and Characters costing 4, 3 and 2: Normal plays the 4, Expert the 3 and the 2
const cards = await page.evaluate(() => [4, 3, 2].map(k => [...CARDDB.keys()].find(c => /^OP0[5-9]-/.test(c) && (CARDDB.get(c) || {}).t === "Character" && CARDDB.get(c).k === k && !fxAb(c).length)));
const plays = [];
for (const n of [1, 3]) { await lvl(n); plays.push(await page.evaluate(cs => botSide(() => { S.myTurn = true; S.atk = null; S.turn += 1; S.chars = []; S.stage = null; S.hand = cs.map(c => ({c, n: nameOf(c), u: Math.random()})); S.donActive = 5; S.donRested = 0; PR.bwt = null;
  for (let i = 0; i < 4; i++) { const h = S.hand.length; botMain(); if (S.hand.length === h) break; } const r = S.chars.map(f => CARDDB.get(f.card.c).k).join(); S.myTurn = false; S.chars = []; return r + "|" + S.donActive; }), cards)); }
console.log("plays", JSON.stringify(cards), JSON.stringify(plays));
check(plays[0].startsWith("4|") && plays[1] === "3,2|0", "Normal plays its dearest Character, Expert the pair that uses all 5 DON!!");
// counters: Hard reaches 3000 with two 2000s, Expert with a 2000 and a 1000
const ct = await page.evaluate(() => { const c = code => ({c: {c: code}}), cs = [Object.assign(c("OP01-013"), {v: 2000}), Object.assign(c("OP01-014"), {v: 2000}), Object.assign(c("OP01-015"), {v: 1000})];
  return {a: botCtrSet(cs, 3000).map(x => x.v).join(), b: botCtrSet(cs, 1000).map(x => x.v).join(), c: botCtrSet(cs, 1500).map(x => x.v).join(), none: botCtrSet(cs, 6000)}; });
console.log("counter sets", JSON.stringify(ct));
check(ct.a === "2000,1000" && ct.b === "1000" && ct.c === "2000" && ct.none === null, "Expert spends no more Counter than it needs");
// at 5 Life Expert takes a hit it could counter, at 2 Life it counters
const lifeTest = async life => {
  await page.evaluate(life => { const B = PR.sides[1].S, c2 = [...CARDDB.keys()].find(k => /^OP0/.test(k) && (CARDDB.get(k) || {}).ctr === 2000);
    B.trash.push(...B.life.splice(0)); for (let i = 0; i < life; i++) B.life.push(B.deck.shift());
    B.chars = []; B.hand = [c2, c2, c2, c2, c2].map((c, i) => ({c, n: "", u: 99901 + i + Math.random()})); B.leader.pm = 0; B.leader.d = 0;
    PR.pres[1] = JSON.parse(JSON.stringify((() => { practiceStash(); practiceLoad(1); const p = pubFull(); practiceStash(); practiceLoad(0); return p; })()));
    oppM = oppModel(PR.pres[1]);
    S.myTurn = true; S.atk = null; S.leader.r = false; S.leader.pm = 1000; S.leader.d = 0; S.chars = []; commit();
    PR.pres[0] = JSON.parse(JSON.stringify(pubFull())); attackWith("ld", "ld"); }, life);
  for (let i = 0; i < 30 && await page.evaluate(() => !!S.atk); i++) await wait(250);
  return page.evaluate(() => ({lf: oppM.lf, h: oppM.h}));
};
const l5 = await lifeTest(5), l2 = await lifeTest(2);
console.log("life", JSON.stringify(l5), JSON.stringify(l2));
check(l5.lf === 4 && l2.lf === 2 && l2.h === 4, "Expert takes the hit at 5 Life and counters it at 2");
// when its attacks can win this turn, Expert keeps its DON!! for them instead of playing a Character
await page.evaluate(() => { S.trash.push(...S.life.splice(0)); S.chars = []; S.leader.pm = 0; S.myTurn = false; S.atk = null; commit(); });
await sync();
const hold = [];
for (const n of [2, 3]) { await lvl(n); hold.push(await page.evaluate(c => botSide(() => { S.myTurn = true; S.atk = null; S.turn += 1; S.chars = []; S.leader.r = false; S.leader.d = 0; S.leader.pm = 0; S.hand = [{c, n: nameOf(c), u: Math.random()}]; S.donActive = 4; S.donRested = 0; PR.bwt = null;
  botMain(); const r = S.chars.length + ":" + S.hand.length; S.myTurn = false; S.chars = []; return r; }), cards[0])); }
console.log("hold", JSON.stringify(hold));
check(hold[0] === "1:0" && hold[1] === "0:1", "Hard plays a Character first; Expert, with a winning attack, keeps the DON!!");

// ---- Master looks ahead to your next turn ----
const pick = await page.evaluate(() => { const ks = [...CARDDB.keys()].filter(c => /^OP0[1-9]-/.test(c) && (CARDDB.get(c) || {}).t === "Character");
  return {small: ks.find(c => CARDDB.get(c).k <= 2 && (CARDDB.get(c).p || 0) <= 3000 && !isBlocker(c) && !fxAb(c).length),
    blk: ks.find(c => isBlocker(c) && CARDDB.get(c).k >= 3 && (CARDDB.get(c).p || 0) <= 5000 && fxAb(c).every(a => a.t === "other" && !/DON!!|Turn/.test(a.text || ""))),
    big: ks.find(c => (CARDDB.get(c).p || 0) >= 6000 && !isBlocker(c) && !fxAb(c).length)}; });
console.log("master cards", JSON.stringify(pick));
const mine = (c, r) => ({card: {c, n: nameOf(c), u: Math.random()}, r, d: 0, pm: 0, t: 0});
// your board: a small rested Character and a rested Blocker. Master's 9000 Leader goes for the Blocker, not your Leader
await page.evaluate(([p, mk]) => { const mk2 = eval(mk); S.trash.push(...S.life.splice(0)); for (let i = 0; i < 5; i++) S.life.push(S.deck.shift()); S.chars = [mk2(p.small, true), mk2(p.blk, true)]; S.myTurn = false; S.atk = null; commit(); }, [pick, mine.toString()]);
await sync();
await lvl(4);
const tgt = await page.evaluate(() => botSide(() => { S.leader.r = false; S.leader.pm = 4000; const t = botTargetAhead({r: "ld", f: S.leader, k: "all"}, false, false); S.leader.pm = 0; return t; }));
console.log("master target", tgt);
check(!!pick.small && tgt === "ch:1", "Master takes out your Blocker instead of hitting a Leader at 5 Life");
// your next turn could win: four big Characters and 10 DON!! against its 1 Life. Expert attacks with its Blocker, Master keeps it home
await page.evaluate(([p, mk]) => { const mk2 = eval(mk); S.chars = [mk2(p.big, false), mk2(p.big, false), mk2(p.big, false), mk2(p.big, false)]; S.donDeck = 0; S.myTurn = false; S.atk = null; commit(); }, [pick, mine.toString()]);
await sync();
const home = [];
for (const n of [3, 4]) { await lvl(n); home.push(await page.evaluate(([b, mk]) => botSide(() => { const mk2 = eval(mk);
  S.myTurn = true; S.atk = null; S.turn += 1; S.hand = []; S.leader.r = true; S.leader.d = 0; S.donActive = 0; S.donRested = 0; PR.bwt = null; PR.bt = null;
  S.trash.push(...S.life.splice(0)); S.life.push(S.deck.shift()); S.chars = [Object.assign(mk2(b, false), {t: S.turn - 2})];
  const th = botThreat(); for (let i = 0; i < 4 && !S.atk; i++) botMain(); const r = (th.lethal ? "danger" : "safe") + ":" + (S.chars[0].r ? "attacked" : "home");
  S.atk = null; S.myTurn = false; S.chars = []; return r; }), [pick.blk, mine.toString()])); }
console.log("blocker", JSON.stringify(home));
check(home[1] === "danger:home" && home[0].endsWith("attacked"), "Master keeps its Blocker home when your next turn could win");
await page.evaluate(() => { S.chars = []; S.myTurn = false; S.atk = null; commit(); }); await sync();

// ---- a few turns of tournament deck against tournament deck, with Expert ----
await page.evaluate(() => { closeModal(); openSetup({bot: true}); }); await wait(500);
await page.selectOption("#f-odeck", "t:OP17-079");
await page.fill("#f-leader", "OP17-058"); await page.evaluate(() => { const x = BOT_DECKS.find(x => x.d.startsWith("OP17-058")); $("#f-deck").value = deckUnpack(x.d).deck; });
await page.selectOption("#f-diff", "4");
await page.click('[data-do="vsbot"]'); await wait(800);
await page.evaluate(() => { PR.roll = [6, 1]; practiceFirst(0); }); await wait(2500);
await page.click('[data-do="keep"]'); await wait(1500);
const seen = {turns: 0, played: 0, atk: 0}; let lastAk = null;
for (let step = 0; step < 300 && seen.turns < 5; step++) {
  const s = await page.evaluate(() => ({mine: S.myTurn, ak: oppM && oppM.ak ? oppM.ak.n : null, rs: S.rs, atk: S.atk ? S.atk.n : null, och: oppM ? oppM.ch.length : 0, done: S.conceded || (oppM && oppM.cd), modal: modal && modal.type, fx: !!fxCur}));
  if (s.done) break;
  seen.played = Math.max(seen.played, s.och);
  if (s.modal || s.fx) { await page.evaluate(() => { while (fxCur) { fxQueue.length = 0; fxFinish(false); } if (modal && modal.type !== "home") closeModal(); closeMenu(); }).catch(() => {}); await wait(300); continue; }
  if (s.ak != null && s.rs !== s.ak) { if (s.ak !== lastAk) { seen.atk++; lastAk = s.ak; } await page.evaluate(() => defResolve(true)); await wait(400); continue; }
  if (s.mine && s.atk == null) { await page.evaluate(() => endTurn()); seen.turns++; await wait(600); continue; }
  await wait(300);
}
console.log("game", JSON.stringify(seen));
await page.screenshot({ path: OUT + "/game.png" });
check(seen.turns >= 4 && seen.played > 0 && seen.atk > 0, "Master plays and attacks with the Black Luffy list");

// ---- the Meta page: play the computer with a popular list ----
await page.evaluate(() => { closeModal(); openMeta(); }); await wait(1500);
await page.click('[data-do="mt:ld:OP05-001"]'); await wait(500);
await page.click('[data-do="mt:bot:0"]'); await wait(800);
const mb = await page.evaluate(() => ({m: modal && modal.type, v: $("#f-odeck").value, l: $("#f-leader2").value, n: deckCount($("#f-deck2").value), open: $("#f-other").open}));
console.log("from meta", JSON.stringify(mb));
check(mb.m === "setup" && mb.v === "own" && mb.l.startsWith("OP05-001") && mb.n === 50 && mb.open, "a Meta page list opens the computer setup with that list");
console.log("errors", JSON.stringify(errs));
check(!errs.length, "no page errors");
await app.close(); fire.close();
console.log(fail ? `${fail} FAILED` : "all passed");
process.exit(fail ? 1 : 0);
