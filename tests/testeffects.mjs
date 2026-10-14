import { _electron as electron } from "playwright-core";
import fs from "fs";
// Card abilities the game carries out: costs paid from the card itself, Choose one, a step's own condition, Triggers that
// play the card or use its [Main], effects on the opponent's side (cost, Freeze, their hand and Life), Life and deck
// steps, cards from the trash, always-on power and cost, and Double Attack, Banish and Unblockable in battle.
// Runs against the computer, offline.
const OUT = process.argv[2] || "shots-effects";
fs.mkdirSync(OUT, { recursive: true });
const prof = "/tmp/bounty-prof-fx"; fs.rmSync(prof, { recursive: true, force: true });
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

// every kind of step in effects.json is one the game knows
const kinds = await page.evaluate(() => {
  const known = ["rest","stand","ko","bounce","bottom","pwr","draw","look","don","returnDon","giveDon","discard","other","play","choose","cost","mark","life","trashCh","kw","restDon","standDon","oppDon","oppRetDon","oppDiscard","oppHandDeck","lifeHand","deckLife","handLife","lifeTrash","mill","handDeck","trashDeck","trashHand","shuffle","playSelf","handSelf","act","noBlock","noPlay","trash"];
  const seen = new Set(); let stat = 0, dup = 0;
  const walk = sts => sts.forEach(s => { seen.add(s.a); if (s.opts) s.opts.forEach(o => walk(o.steps)); });
  for (const [code] of BFX) { const ab = fxAb(code); ab.forEach(a => { walk(a.steps); if (a.s) stat++; }); if (ab.some(a => a.t === "yourTurn" && !a.s) && ab.some(a => a.t === "onPlay" && a.text === (ab.find(b => b.t === "yourTurn") || {}).text)) dup++; }
  return {unknown: [...seen].filter(a => !known.includes(a)), stat, dup, cards: BFX.size};
});
console.log("kinds", JSON.stringify(kinds));
check(kinds.cards > 2500 && !kinds.unknown.length, "every step in the ability list is one the game carries out");
check(kinds.stat > 100, "always-on power, cost and keyword effects are read");
check(kinds.dup === 0, "[Your Turn] [On Play] is one On Play ability, not two");

// a game against the computer, on your turn
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
const clear = () => page.evaluate(() => { while (fxCur) { fxQueue.length = 0; fxFinish(false); } if (modal && modal.type !== "home") closeModal(); closeMenu(); });
const panel = () => page.evaluate(() => { const p = document.querySelector("#fxpanel"); return p.hidden ? "" : p.innerText.replace(/\s+/g, " "); });
await page.evaluate(() => { S.turn = Math.max(S.turn, 3); S.donActive = 6; S.donRested = 0; S.leader.d = 0; S.chars = []; commit(); });
const card = c => ({c, n: ""});
const run = (code, t) => page.evaluate(([code, t]) => { const c = {c: code, n: nameOf(code) || ""}; const ab = fxAb(code).find(a => a.t === t); window.__c = c; return ab ? (fxEnqueue(fxJob(c, ab)), true) : false; }, [code, t]);

// "You may rest this Character: Draw 1 card" (OP16-049): the cost is the card itself
await page.evaluate(() => { const c = {c: "OP16-049", n: nameOf("OP16-049")}; S.chars.push({card: c, r: false, d: 0, pt: 0}); window.__c = c; commit(); fxEnqueue(fxJob(c, fxAb("OP16-049").find(a => a.t === "activateMain"))); });
let p = await panel();
console.log("rest cost", p);
check(/Rest .*OP16-049/.test(p) && /This is the cost/.test(p) && /Don't use it/.test(p), "the cost step names the card to rest and says it's the cost");
const h0 = await page.evaluate(() => S.hand.length);
await page.evaluate(() => doAction("fxgo"));
await page.waitForTimeout(200);
check(await page.evaluate(() => S.chars[0].r === true) && /Draw 1 card/.test(await panel()), "paying rests the Character, then the draw comes up");
await page.evaluate(() => doAction("fxdraw"));
check(await page.evaluate(h0 => S.hand.length === h0 + 1 && !fxCur, h0), "the ability draws 1 and finishes");
await page.evaluate(() => { S.chars[0].r = false; commit(); fxEnqueue(fxJob(window.__c, fxAb("OP16-049").find(a => a.t === "activateMain"))); doAction("fxcancel"); });
check(await page.evaluate(h0 => S.hand.length === h0 + 1 && !fxCur && !S.chars[0].r, h0), "not paying the cost ends the ability with nothing drawn");

// Choose one, and a step whose own condition isn't met
await page.evaluate(() => {
  const ab = normFx({abilities: [{t: "main", text: "[Main] Choose one: • Draw 1 card. • Draw 2 cards.", steps: [{a: "choose", text: "Choose one.", opts: [{text: "Draw 1 card.", steps: [{a: "draw", who: "own", text: "Draw 1 card."}]}, {text: "Draw 2 cards.", steps: [{a: "draw", who: "own", n: 2, text: "Draw 2 cards."}]}]}]}]}).ab[0];
  window.__h = S.hand.length; fxEnqueue(fxJob({c: "OP01-016", n: "Nami"}, ab));
});
p = await panel();
check(/Choose one/.test(p) && await page.evaluate(() => document.querySelectorAll('#fxpanel [data-do^="fxopt:"]').length === 2), "Choose one shows each option");
await page.evaluate(() => doAction("fxopt:1"));
check(/Draw 2 cards/.test(await panel()), "picking an option runs its steps");
await page.evaluate(() => doAction("fxdraw"));
check(await page.evaluate(() => S.hand.length === window.__h + 2), "the chosen option drew 2");
await page.evaluate(() => {
  const ab = normFx({abilities: [{t: "onPlay", text: "x", steps: [{a: "draw", who: "own", text: "Draw 1 card."}, {a: "draw", who: "own", n: 2, text: "Then, if you have 0 or less cards in your hand, draw 2 cards."}]}]}).ab[0];
  window.__h = S.hand.length; fxEnqueue(fxJob({c: "OP01-016", n: "Nami"}, ab)); doAction("fxdraw");
});
check(await page.evaluate(() => S.hand.length === window.__h + 1 && !fxCur), "a later step whose condition isn't met is skipped");
// "If you do" follows whether the step before it was carried out
const ifDo = () => normFx({abilities: [{t: "onPlay", text: "x", steps: [{a: "discard", who: "own", upTo: true, text: "You may trash 1 card from your hand."}, {a: "draw", who: "own", n: 2, text: "If you do, draw 2 cards."}]}]}).ab[0];
await page.evaluate(src => { const ab = eval(src)(); window.__h = S.hand.length; fxEnqueue(fxJob({c: "OP01-016", n: "Nami"}, ab)); doAction("fxskip:no"); }, `(${ifDo})`);
check(await page.evaluate(() => S.hand.length === window.__h && !fxCur), "skipping the optional step skips its If you do");
await page.evaluate(src => { const ab = eval(src)(); window.__h = S.hand.length; fxEnqueue(fxJob({c: "OP01-016", n: "Nami"}, ab)); fxPick("hand:0"); }, `(${ifDo})`);
check(await page.evaluate(() => fxCur && fxCur.steps[fxCur.i].a === "draw"), "doing the optional step leads to its If you do");
await page.evaluate(() => doAction("fxdraw"));
check(await page.evaluate(() => S.hand.length === window.__h + 1 && !fxCur), "trashed 1 then drew 2");
check(await page.evaluate(() => condCheck("you and your opponent have a total of 99 or less Life cards", null) === true && condCheck("your Leader has the {Nonexistent} type and you have no other [Nobody] Characters", null) === false), "more conditions are checked");

// Triggers: "Play this card" plays it from hand, "Activate this card's [Main] effect" runs the Main
const trig = await page.evaluate(() => [...BFX.keys()].find(k => (CARDDB.get(k) || {}).t === "Character" && fxAb(k).some(a => a.t === "trigger" && a.text === "[Trigger] Play this card.")));
await page.evaluate(code => { const c = {c: code, n: nameOf(code)}; S.hand.push(c); window.__c = c; modal = {type: "trig", card: c, ab: fxAb(code).find(a => a.t === "trigger")}; doAction("trigyes"); }, trig);
p = await panel();
await page.evaluate(() => doAction("fxgo"));
await page.waitForTimeout(300);
await clear();
check(await page.evaluate(code => S.chars.some(f => f.card.c === code) && !S.hand.some(c => c.c === code), trig), `[Trigger] Play this card plays ${trig} from hand`);
await page.evaluate(() => { const c = {c: "EB01-051", n: nameOf("EB01-051")}; S.hand.push(c); modal = {type: "trig", card: c, ab: fxAb("EB01-051").find(a => a.t === "trigger")}; doAction("trigyes"); doAction("fxgo"); });
check(await page.evaluate(() => fxCur && fxCur.tl === "Main" && fxCur.card.c === "EB01-051" && S.trash[0].c === "EB01-051"), "[Trigger] Activate this card's [Main] goes to the trash and runs its [Main]");
await clear();

// the opponent's side: give the computer a Character, then −cost, Freeze, and their hand and Life
await page.evaluate(() => botSide(() => { S.chars.push({card: {c: "OP01-025", n: nameOf("OP01-025")}, r: true, d: 0, pt: 0}); return 0; }));
await page.waitForTimeout(300);
const o0 = await page.evaluate(() => ({ch: oppM.ch.length, h: oppM.h, lf: oppM.lf, tr: oppM.tr.length}));
const fxRun = (steps, picks) => page.evaluate(([steps, picks]) => { const ab = normFx({abilities: [{t: "onPlay", text: "test", steps}]}).ab[0]; fxEnqueue(fxJob({c: "OP01-016", n: "Nami"}, ab)); for (const r of picks || []) fxPick(r); }, [steps, picks]);
await fxRun([{a: "cost", n: -2, text: "Give up to 1 of your opponent's Characters −2 cost during this turn."}], ["ch:0"]);
await page.waitForTimeout(300);
await fxRun([{a: "mark", k: "fz", text: "Up to 1 of your opponent's rested Characters will not become active in your opponent's next Refresh Phase."}], ["ch:0"]);
await page.waitForTimeout(300);
await fxRun([{a: "oppDiscard", text: "Your opponent trashes 1 card from their hand."}]); await page.evaluate(() => doAction("fxgo"));
await page.waitForTimeout(300);
await fxRun([{a: "lifeTrash", text: "Trash up to 1 card from the top of your opponent's Life cards."}]); await page.evaluate(() => doAction("fxgo"));
await page.waitForTimeout(500);
const o1 = await page.evaluate(() => ({cm: oppM.ch[0] && oppM.ch[0].cm, mk: oppM.ch[0] && oppM.ch[0].mk, h: oppM.h, lf: oppM.lf, tr: oppM.tr.length}));
console.log("opponent", JSON.stringify(o0), JSON.stringify(o1));
check(o1.cm === -2, "−2 cost lands on the opponent's Character");
check((o1.mk || []).includes("fz"), "Freeze lands on the opponent's rested Character");
check(o1.h === o0.h - 1, "the opponent trashes a card from their hand");
check(o1.lf === o0.lf - 1 && o1.tr >= o0.tr + 2, "the top of the opponent's Life is trashed");

// Life, deck and trash steps
const z0 = await page.evaluate(() => ({h: S.hand.length, lf: S.life.length, dk: S.deck.length, tr: S.trash.length}));
await fxRun([{a: "lifeHand", text: "Add 1 card from the top of your Life cards to your hand."}]); await page.evaluate(() => doAction("fxgo"));
await fxRun([{a: "deckLife", text: "Add up to 1 card from the top of your deck to the top of your Life cards."}]); await page.evaluate(() => doAction("fxgo"));
await fxRun([{a: "mill", n: 2, text: "Trash 2 cards from the top of your deck."}]); await page.evaluate(() => doAction("fxgo"));
const z1 = await page.evaluate(() => ({h: S.hand.length, lf: S.life.length, dk: S.deck.length, tr: S.trash.length}));
console.log("zones", JSON.stringify(z0), JSON.stringify(z1));
check(z1.h === z0.h + 1 && z1.lf === z0.lf && z1.dk === z0.dk - 3 && z1.tr === z0.tr + 2, "Life to hand, deck to Life and trashing from the deck move the right cards");
await page.evaluate(() => { S.trash.unshift({c: "OP01-025", n: nameOf("OP01-025")}, {c: "EB01-051", n: "x"}); commit(); });
await fxRun([{a: "trashHand", text: "Add up to 1 Character card from your trash to your hand."}]);
await page.evaluate(() => doAction("fxzone"));
await page.waitForTimeout(200);
const zm = await page.evaluate(() => ({open: modal && modal.type === "fxzone", lit: document.querySelectorAll("#modal .fxtarget").length, off: document.querySelectorAll("#modal .nomatch").length}));
await page.screenshot({ path: OUT + "/trash-pick.png" });
await page.evaluate(() => { doAction("fxz:0"); doAction("fxzok"); });
check(zm.open && zm.lit > 0 && zm.off > 0 && await page.evaluate(() => S.hand[S.hand.length - 1].c === "OP01-025" && !fxCur), "the trash opens with the allowed cards lit, and the pick goes to hand");

// an effect the opponent makes you do waits for you, and can't be cancelled
await page.evaluate(() => { FX_OPP.odis({v: 1}, "Computer"); render(); });
await page.waitForTimeout(300);
p = await panel();
const hb = await page.evaluate(() => S.hand.length);
check(/Opponent's effect/.test(p) && /trash 1 card from your hand/.test(p) && !await page.$('#fxpanel [data-do="fxcancel"]'), "the opponent's discard asks you to pick, with no cancel");
await page.click(`#hand [data-src="hand:${hb - 1}"]`);
await page.waitForTimeout(200);
check(await page.evaluate(hb => S.hand.length === hb - 1 && !fxCur, hb), "tapping a card trashes it");

// always-on effects: Zoro's [DON!! x1] [Your Turn] +1000 to your Characters, and −5 cost to the opponent's Characters
await clear();
await page.evaluate(() => { S.chars = [{card: {c: "OP01-016", n: "Nami"}, r: false, d: 0, pt: 0}]; S.leader.d = 0; commit(); });
const s0 = await page.evaluate(() => ({pow: myPow(S.chars[0]), pub: pubFull().ch[0].pm}));
await page.evaluate(() => { S.leader.d = 1; commit(); });
const s1 = await page.evaluate(() => ({pow: myPow(S.chars[0]), pub: pubFull().ch[0].pm, shown: document.querySelector('#me [data-src="ch:0"] .pw') && document.querySelector('#me [data-src="ch:0"] .pw').textContent}));
console.log("always-on", JSON.stringify(s0), JSON.stringify(s1));
check(s0.pow === 2000 && s1.pow === 3000 && s1.pub === 1000, "Zoro gives your Characters +1000 once he has a DON!!, and the opponent sees it");
check(await page.evaluate(() => { S.chars.push({card: {c: "OP02-121", n: ""}, r: false, d: 0, pt: 0}); const o = pubFull().ox; S.chars.pop(); return o && o[1] === -5; }), "a [Your Turn] −5 cost to the opponent's Characters is sent to them");

// battle keywords, as the defender
await page.evaluate(() => { S.leader.d = 0; S.chars = []; commit(); });
const hit = (code, extra) => page.evaluate(([code, extra]) => {
  const base = JSON.parse(JSON.stringify(PR.pres[1]));
  base.ch = [{c: code, n: "", r: 1, d: 0, pm: 0, cm: 0, mk: []}]; base.ak = Object.assign({s: "ch:0", t: "ld", n: Math.floor(Math.random() * 1e8)}, extra || {});
  oppM = oppModel(base); S.rs = 0; S.blk = null;
  const lf = S.life.length, h = S.hand.length, tr = S.trash.length;
  defResolve(true);
  return {life: lf - S.life.length, hand: S.hand.length - h, trash: S.trash.length - tr};
}, [code, extra]);
await page.evaluate(() => { while (S.life.length < 4) S.life.push(S.deck.shift()); commit(); });
const da = await hit("EB04-023"); await page.evaluate(() => { if (modal) closeModal(); });
const ban = await hit("OP01-067"); await page.evaluate(() => { if (modal) closeModal(); });
console.log("battle", JSON.stringify(da), JSON.stringify(ban));
check(da.life === 2 && da.hand === 2, "Double Attack deals 2 damage");
check(ban.life === 1 && ban.hand === 0 && ban.trash === 1, "Banish trashes the Life card instead of adding it to hand");
const ub = await page.evaluate(() => {
  S.chars = [{card: {c: "OP01-024", n: ""}, r: false, d: 0, pt: 0}];
  const base = JSON.parse(JSON.stringify(PR.pres[1]));
  base.ch = [{c: "OP16-033", n: "", r: 1, d: 0, pm: 0, cm: 0, mk: []}]; base.ak = {s: "ch:0", t: "ld", n: 77}; oppM = oppModel(base); S.rs = 0; S.blk = null;
  const ban = blockBan(S.chars[0]); doBlock(0);
  const o = {ban, blocked: S.blk};
  base.ch = [{c: "OP01-025", n: "", r: 1, d: 0, pm: 0, cm: 0, mk: []}]; base.ak = {s: "ch:0", t: "ld", n: 78, u: 1}; oppM = oppModel(base);
  o.nb = blockBan(S.chars[0]);
  base.ak = {s: "ch:0", t: "ld", n: 79}; oppM = oppModel(base); o.ok = blockBan(S.chars[0]);
  S.rs = 79; return o;
});
console.log("unblockable", JSON.stringify(ub));
check(/Unblockable/.test(ub.ban) && ub.blocked == null, "an Unblockable attacker can't be blocked");
check(/stops \[Blocker\]/.test(ub.nb) && ub.ok === "", "\"your opponent cannot activate [Blocker]\" stops blocking for that battle only");
await page.screenshot({ path: OUT + "/board.png" });
check(!errs.length, "no page errors" + (errs.length ? ": " + errs.slice(0, 3).join(" / ") : ""));
await app.close();
console.log(fail ? `${fail} FAILED` : "all passed");
process.exit(fail ? 1 : 0);
