import { _electron as electron } from "playwright-core";
import fs from "fs";
// Rules from the official Comprehensive Rules the game now holds to: attacks only on your turn with an active card
// and one at a time, no blocking an attack on the blocker itself (and only real Blockers at public tables), a 6th
// Character makes you trash one of the others, a used Event goes to the trash, and an empty deck loses the game.
// Also the computer's own card abilities: an On Play K.O., a [Trigger], a [Counter] Event, and keeping the board
// under control before going for the Leader. Runs against the computer, offline.
const OUT = process.argv[2] || "shots-rules";
fs.mkdirSync(OUT, { recursive: true });
const prof = "/tmp/bounty-prof-rules"; fs.rmSync(prof, { recursive: true, force: true });
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

{ const b = await page.$('[data-do="homeplay"]'); if (b && await b.isVisible()) { await b.click(); await page.waitForTimeout(300); } }
await page.click('[data-do="homebot"]');
await page.waitForTimeout(300);
await page.fill("#f-nick", "Ryan");
await page.fill("#f-leader", "OP01-001");
await page.fill("#f-deck", deck);
await page.click('[data-do="vsbot"]');
await page.waitForTimeout(800);
await page.click('[data-do="prroll"]');
await page.waitForTimeout(400);
if (await page.evaluate(() => PR.roll[0] > PR.roll[1])) await page.click('[data-do="prfirst:0"]');
await page.waitForTimeout(2500);
await page.click('[data-do="keep"]');
for (let i = 0; i < 80 && !await page.evaluate(() => S.myTurn && !oppM.ak); i++) {
  await page.evaluate(() => { if (defending()) defResolve(true); if (modal && modal.type === "trig") closeModal(); while (fxCur) { fxQueue.length = 0; fxFinish(false); } });
  await page.waitForTimeout(500);
}
check(await page.evaluate(() => S.myTurn), "it's your turn against the computer");
const toastText = () => page.evaluate(() => { const t = document.querySelector("#toast"); return t && !t.hidden ? t.innerText : ""; });
const clear = () => page.evaluate(() => { while (fxCur) { fxQueue.length = 0; fxFinish(false); } if (modal && modal.type !== "home") closeModal(); closeMenu(); });
const ch = (c, r) => `{card: {c: "${c}", n: nameOf("${c}")}, r: ${!!r}, d: 0, pt: 0}`;
// a card of a kind from the deck list, by what CARDDB says about it
const find = pred => page.evaluate(src => ["OP01-013","OP01-016","OP01-024","OP01-014","OP01-015","OP01-017","OP01-018","OP01-019","OP01-020","OP01-021","OP01-022","OP01-025"].find(c => eval(src)(CARDDB.get(c) || {}, c)) || null, `(${pred})`);
await page.evaluate(() => { S.turn = Math.max(S.turn, 3); S.donActive = 10; S.donRested = 0; S.leader.r = false; commit(); });

// ---- attacks ----
await page.evaluate(src => { S.chars = [eval(src)]; commit(); attackWith("ch:0", "ld"); }, `(${ch("OP01-016", true)})`);
check(await page.evaluate(() => !S.atk) && /is rested, so it can't attack/.test(await toastText()), "a rested Character can't attack (even dragged onto the Leader)");
await page.evaluate(() => { S.myTurn = false; attackWith("ld", "ld"); S.myTurn = true; });
check(await page.evaluate(() => !S.atk) && /only attack on your own turn/.test(await toastText()), "nobody attacks on the other player's turn");
const one = await page.evaluate(() => { S.chars[0].r = false; S.chars[0].pt = 0; commit(); attackWith("ld", "ld"); attackWith("ch:0", "ld"); return {atk: S.atk && S.atk.s, r: S.chars[0].r, t: document.querySelector("#toast").innerText}; });
check(one.atk === "ld" && !one.r && /Finish the attack/.test(one.t), "one attack at a time");
for (let i = 0; i < 30 && await page.evaluate(() => !!S.atk); i++) await page.waitForTimeout(300);
check(await page.evaluate(() => !S.atk), "the computer answered the attack");
await clear();

// ---- blocking ----
const nonBlk = await page.evaluate(() => ["OP01-013","OP01-016","OP01-024","OP01-014","OP01-015","OP01-017","OP01-018","OP01-019","OP01-020","OP01-021","OP01-022","OP01-025"].find(c => BFX.has(c) && !isBlocker(c) && (CARDDB.get(c) || {}).t === "Character"));
const blk = await page.evaluate(() => [...BFX.keys()].find(c => isBlocker(c) && (CARDDB.get(c) || {}).t === "Character"));
const b = await page.evaluate(([nb, bl]) => {
  const keep = oppM.ak, pubt = S.pubt;
  S.chars = [nb, bl].map(c => ({card: {c, n: nameOf(c)}, r: false, d: 0, pt: 0}));
  oppM.ak = {s: "ld", t: "ch:1", n: 4242};
  doBlock(1); const self = S.blk;
  S.pubt = true; doBlock(0); const nonb = S.blk; const t1 = document.querySelector("#toast").innerText;
  oppM.ak = {s: "ld", t: "ld", n: 4243}; doBlock(1); const real = S.blk;
  S.blk = null; S.chars.forEach(f => f.r = false); S.pubt = pubt; oppM.ak = keep;
  return {self, nonb, t1, real};
}, [nonBlk, blk]);
console.log("block", JSON.stringify(b));
check(b.self == null, "a Character can't block an attack on itself");
check(b.nonb == null && /doesn't have \[Blocker\]/.test(b.t1), "at a public table a Character without [Blocker] can't block");
check(b.real === 1, `a [Blocker] (${blk}) can block`);
await clear();

// ---- a 6th Character ----
await page.evaluate(() => { S.chars = ["OP01-013","OP01-014","OP01-015","OP01-017","OP01-018"].map(c => ({card: {c, n: nameOf(c)}, r: false, d: 1, pt: 0})); S.hand.push({c: "OP01-016", n: nameOf("OP01-016")}); commit(); moveCard("hand:" + (S.hand.length - 1), "chars", false, 0); });
await page.waitForTimeout(400);
check(await page.evaluate(() => S.chars.length === 6 && modal && modal.type === "limit" && document.querySelectorAll('#modal [data-do^="limit:"]').length === 5), "playing a 6th Character asks which of the other 5 to trash");
const tr0 = await page.evaluate(() => ({tr: S.trash.length, dr: S.donRested}));
await page.evaluate(() => doAction("limit:0"));
await page.waitForTimeout(300);
check(await page.evaluate(t => S.chars.length === 5 && S.trash.length === t.tr + 1 && S.trash[0].c === "OP01-013" && S.donRested === t.dr + 1 && S.chars[4].card.c === "OP01-016" && !modal, tr0), "the chosen one is trashed (its DON!! go back rested) and the new one stays");
await clear();

// ---- a used Event goes to the trash ----
await page.evaluate(() => { S.donActive = 10; S.hand.push({c: "OP02-046", n: nameOf("OP02-046")}); commit(); moveCard("hand:" + (S.hand.length - 1), "event", false, 0); });
for (let i = 0; i < 10 && !await page.evaluate(() => !!fxCur); i++) await page.waitForTimeout(200);
check(await page.evaluate(() => S.ev && S.ev.card.c === "OP02-046" && fxCur && fxCur.card.c === "OP02-046"), "the Event's [Main] comes up");
await page.evaluate(() => { const b = document.querySelector('#fxpanel [data-do^="fxskip"]'); if (b) b.click(); else fxFinish(true); });
check(await page.evaluate(() => !S.ev && S.trash[0].c === "OP02-046"), "once it's done the Event is in the trash");
await clear();

// ---- the computer's abilities ----
// [On Play] K.O. up to 1 of your opponent's Characters with 3000 power or less (OP02-011)
const small = await find((e, c) => e.t === "Character" && e.p != null && e.p <= 3000);
await page.evaluate(c => { S.chars = [{card: {c, n: nameOf(c)}, r: false, d: 0, pt: 0}]; commit(); }, small);
await page.waitForTimeout(300);
const bot1 = await page.evaluate(() => botSide(() => { S.chars = []; S.hand = [{c: "OP02-011", n: nameOf("OP02-011")}]; S.donActive = 10; botMain(); return S.chars.length; }));
await page.waitForTimeout(500);
check(bot1 === 1 && await page.evaluate(c => !S.chars.length && S.trash[0].c === c, small), `the computer's On Play K.O.s your ${small} (3000 power or less)`);
// [Trigger] Draw 2 cards (OP02-066)
const trig = await page.evaluate(() => botSide(() => { const c = {c: "OP02-066", n: nameOf("OP02-066")}; S.hand.push(c); const h = S.hand.length; botTrigger(c); return {dh: S.hand.length - h, tr: S.trash[0].c}; }));
check(trig.dh === 1 && trig.tr === "OP02-066", "the computer uses a [Trigger] that draws 2 (the card goes to its trash)");
// [Counter] +4000 when its counter cards can't save it
const ctr = await page.evaluate(() => botSide(() => { S.hand = [{c: "OP01-026", n: nameOf("OP01-026")}]; S.donActive = 5; const e = botCounterEvent(3000); return e && e.n; }));
check(ctr === 4000, "the computer picks a +4000 [Counter] Event when it needs 3000 more");
// board control: a rested Character that matters before your Leader while you have Life to spare
const mid = await find(e => e.t === "Character" && e.k >= 3 && e.p != null && e.p <= 4000);
await page.evaluate(c => { S.chars = [{card: {c, n: nameOf(c)}, r: true, d: 0, pt: 0}]; commit(); }, mid);
await page.waitForTimeout(300);
const tgt = await page.evaluate(() => botSide(() => { S.leader.pm = 2000; return botTarget({f: S.leader, k: "all", r: "ld"}); }));
check(tgt === "ch:0", `with 3 or more Life left, the computer's Leader goes after your rested ${mid} first`);
await page.evaluate(() => { S.trash.push(...S.life.slice(2)); S.life = S.life.slice(0, 2); commit(); });
await page.waitForTimeout(300);
const tgt2 = await page.evaluate(() => botSide(() => botTarget({f: S.leader, k: "all", r: "ld"})));
check(tgt2 === "ld", "at 2 Life it goes for your Leader");
await clear();

// ---- an empty deck loses ----
await page.evaluate(() => { S.trash.push(...S.deck); S.deck = []; commit(); });
await page.waitForTimeout(300);
check(await page.evaluate(() => S.conceded && S.lostDeck && /deck is empty/i.test(document.body.innerText)), "a player with no cards left in their deck loses");

await page.screenshot({ path: `${OUT}/rules.png` });
check(!errs.length, "no page errors");
if (errs.length) console.log(errs);
await app.close();
console.log(fail ? `${fail} FAILED` : "all passed");
process.exit(fail ? 1 : 0);
