import { _electron as electron } from "playwright-core";
import fs from "fs";
// Card abilities the game carries out: costs paid from the card itself, Choose one, a step's own condition, Triggers that
// play the card or use its [Main], effects on the opponent's side (cost, Freeze, their hand and Life), Life and deck
// steps, cards from the trash, always-on power and cost, Double Attack, Banish and Unblockable in battle, revealed
// cards, and power that lasts through the opponent's next turn.
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
  const known = ["rest","stand","ko","bounce","bottom","pwr","draw","look","don","returnDon","giveDon","discard","other","play","choose","cost","mark","life","trashCh","kw","restDon","standDon","oppDon","oppRetDon","oppDiscard","oppHandDeck","lifeHand","deckLife","handLife","lifeTrash","mill","handDeck","trashDeck","trashHand","shuffle","playSelf","handSelf","act","noBlock","noPlay","revealHand","reveal","playRv","addRv","rvPlace","rvKw","lifeUp","lifeDown","trash","oppHandTrash","oppLifeHand","koStage"];
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
await page.click('[data-do="homepractice"]'); await page.waitForTimeout(300); await page.click('[data-do="homebot"]');
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

// more of the opponent's side: a card trashed at random from their hand, their Life to their hand, their Stage K.O.'d
const parsed = await page.evaluate(() => { const st = (c, t) => (fxAb(c).find(a => a.t === t) || {steps: []}).steps; return {
  hand: st("OP06-097", "main").map(x => x.a), life: st("EB04-054", "onKO").map(x => x.a), stage: st("OP17-018", "main").map(x => x.a),
  zoro: st("OP12-039", "main")[0], buggy: st("OP16-058", "counter")[0], linlin: st("ST07-013", "activateMain").map(x => x.a), types: st("OP11-039", "counter")[0] }; });
console.log("parsed", JSON.stringify(parsed));
check(parsed.hand.includes("oppHandTrash") && parsed.life.includes("oppLifeHand") && parsed.stage.includes("koStage"), "the opponent's hand, Life and Stage wordings are carried out");
check(parsed.zoro && parsed.zoro.myLd && parsed.zoro.ldn === "Roronoa Zoro" && parsed.buggy && parsed.buggy.a === "pwr" && parsed.buggy.ld && parsed.linlin.includes("kw") && parsed.types && parsed.types.a === "pwr", "named cards and several types are targets the game picks");
await page.evaluate(() => botSide(() => { S.stage = {card: {c: "OP02-048", n: nameOf("OP02-048")}, r: false, d: 0, pt: 0}; return 0; }));
await page.waitForTimeout(300);
const p0 = await page.evaluate(() => ({h: oppM.h, lf: oppM.lf, st: !!oppM.st, tr: oppM.tr.length}));
await fxRun([{a: "oppHandTrash", text: "Trash 1 card from your opponent's hand."}]); await page.evaluate(() => doAction("fxgo"));
await page.waitForTimeout(300);
await fxRun([{a: "oppLifeHand", text: "Add up to 1 card from the top of your opponent's Life cards to the owner's hand."}]); await page.evaluate(() => doAction("fxgo"));
await page.waitForTimeout(300);
await fxRun([{a: "koStage", cost: 0, text: "K.O. up to 1 of your opponent's Stages with a cost of 0 or less."}]);
const p1 = await page.evaluate(() => ({open: !!fxCur, log: myLog.slice(-2).map(e => e[1]).join(" | ")}));
await fxRun([{a: "koStage", text: "K.O. up to 1 of your opponent's Stages."}]); await page.evaluate(() => doAction("fxgo"));
await page.waitForTimeout(500);
const p2 = await page.evaluate(() => ({h: oppM.h, lf: oppM.lf, st: !!oppM.st, tr: oppM.tr.length}));
console.log("opponent 2", JSON.stringify(p0), JSON.stringify(p1), JSON.stringify(p2));
check(p0.st && !p1.open && /no Stage that fits/.test(p1.log), "a Stage that costs too much can't be K.O.'d, and the step passes");
check(p2.h === p0.h && p2.lf === p0.lf - 1 && !p2.st && p2.tr === p0.tr + 2, "a random card from the opponent's hand is trashed, their top Life goes to their hand and their Stage is K.O.'d");

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
// face-up Life: EB01-040 turns the top Life card face-up to pay, EB03-051 turns them all back face-down
await page.evaluate(() => { while (fxCur) { fxQueue.length = 0; fxFinish(false); } S.chars = []; S.rs = 0; oppM = oppModel(PR.pres[1]); while (S.life.length < 4) S.life.push(S.deck.shift()); S.life.forEach(c => delete c.up); commit(); });
const drive = async () => { for (let i = 0; i < 8 && await page.evaluate(() => !!fxCur); i++) { await page.evaluate(() => { const b = document.querySelector("#fxpanel .btn.pri") || document.querySelector('#fxpanel [data-do^="fxskip"]'); if (b) b.click(); }); await page.waitForTimeout(200); } };
const fxClear = () => page.evaluate(() => { while (fxCur) { fxQueue.length = 0; fxFinish(false); } });
await page.evaluate(() => fxEnqueue(fxJob({c: "EB01-040", n: nameOf("EB01-040")}, fxAb("EB01-040").find(a => a.t === "activateMain"))));
await drive();
const fu = await page.evaluate(() => ({top: !!S.life[0].up, rest: S.life.slice(1).some(c => c.up), lu: pubFull().lu, seen: oppModel(pubFull()).lu, shown: document.querySelectorAll("#me .lifez .lifeup").length, cond: condCheck("you have a face-up Life card", S.leader)}));
console.log("face-up", JSON.stringify(fu));
check(fu.top && !fu.rest && fu.lu && fu.lu[0][0] === 0 && fu.seen.length === 1 && fu.shown === 1 && fu.cond === true, "turning the top Life card face-up shows it on the board and to the opponent");
await fxClear();
await page.evaluate(() => fxEnqueue(fxJob({c: "EB03-051", n: nameOf("EB03-051")}, fxAb("EB03-051").find(a => a.t === "onPlay"))));
await drive();
check(await page.evaluate(() => !S.life.some(c => c.up) && !pubFull().lu), "\"turn all of your Life cards face-down\" turns them back");
await fxClear();
const hl = await page.evaluate(() => {
  const ab = normFx({abilities: [{t: "main", text: "[Main] Add up to 1 card from your hand to the top of your Life cards face-up.", steps: [{a: "handLife", up: true, n: 1, text: "Add up to 1 card from your hand to the top of your Life cards face-up."}]}]}).ab[0];
  fxEnqueue(fxJob({c: "OP01-016", n: ""}, ab)); const c = S.hand[0]; fxCur.pick = ["hand:0"]; doAction("fxapply"); return {same: S.life[0] === c, up: !!S.life[0].up};
});
check(hl.same && hl.up, "a card added from hand to Life face-up is face-up");
const lfu = await page.evaluate(() => {
  const base = JSON.parse(JSON.stringify(PR.pres[1])); S.chars = [{card: {c: "OP01-016", n: ""}, r: false, d: 0, pt: 0}]; S.life.forEach(c => delete c.up);
  base.mq = [{id: S.ack + 1, r: "ch:0", c: "OP01-016", k: "lfu", v: 0}]; oppM = oppModel(base); applyMarkReqs(); commit();
  return {gone: !S.chars.length, top: S.life[0].c, up: !!S.life[0].up};
});
check(lfu.gone && lfu.top === "OP01-016" && lfu.up, "the opponent's effect adds your Character to the top of your Life face-up");
// "You may rest 1 of your cards": a DON!! will do (EB04-015), and resting your Leader (OP04-088)
await fxClear();
await page.evaluate(() => { S.life.forEach(c => delete c.up); S.donActive = 3; S.leader.r = false; commit(); fxEnqueue(fxJob({c: "EB04-015", n: nameOf("EB04-015")}, fxAb("EB04-015").find(a => a.t === "onKO"))); });
await page.waitForTimeout(300);
const rd = await page.evaluate(() => { const b = document.querySelector('#fxpanel [data-do="fxrestdon"]'); const da = S.donActive; if (b) b.click(); return {btn: !!b, paid: S.donActive === da - 1, moved: !fxCur || fxCur.i === 1}; });
await page.evaluate(() => { while (fxCur) { fxQueue.length = 0; fxFinish(false); } });
check(rd.btn && rd.paid && rd.moved, "\"rest 1 of your cards\" can be paid by resting a DON!!");
const rl = await page.evaluate(() => { fxEnqueue(fxJob({c: "OP04-088", n: nameOf("OP04-088")}, fxAb("OP04-088").find(a => a.t === "activateMain"))); const cands = fxCands(fxCur.steps[0]).map(x => x.ref); fxCur.pick = ["ld"]; doAction("fxapply"); const r = {cands, rested: !!S.leader.r, next: fxCur && fxCur.i === 1}; while (fxCur) { fxQueue.length = 0; fxFinish(false); } S.leader.r = false; commit(); return r; });
check(rl.cands.join() === "ld" && rl.rested && rl.next, "\"rest your 1 Leader\" rests the Leader to pay");
// "This Character cannot be K.O.'d by effects" (OP02-102): an effect can't, a battle can
const sh = await page.evaluate(() => {
  const base = JSON.parse(JSON.stringify(PR.pres[1])); S.chars = [{card: {c: "OP02-102", n: ""}, r: false, d: 0, pt: 0}];
  base.mq = [{id: S.ack + 1, r: "ch:0", c: "OP02-102", k: "ko", v: 0}]; oppM = oppModel(base); applyMarkReqs(); const fx = S.chars.length;
  base.mq = [{id: S.ack + 1, r: "ch:0", c: "OP02-102", k: "bounce", v: 0}]; oppM = oppModel(base); applyMarkReqs(); const bn = S.chars.length;
  return {fx, bn};
});
check(sh.fx === 1 && sh.bn === 0, "OP02-102 can't be K.O.'d by an effect, but can still be returned to hand");
await page.evaluate(() => { oppM = oppModel(PR.pres[1]); commit(); });
// "Reveal 1 card from the top of your deck": play it (ST12-010), or put it on the bottom when it doesn't fit; a draw
// that depends on it (ST22-003); playing a Life card (ST13-007); the computer doing the same (OP08-052)
await fxClear();
const rvc = await page.evaluate(() => { const ks = [...CARDDB.keys()].filter(k => /^OP0[1-9]-/.test(k));
  const two = ks.find(k => { const e = CARDDB.get(k); return e.t === "Character" && e.k === 2; }), five = ks.find(k => { const e = CARDDB.get(k); return e.t === "Character" && e.k === 5; });
  const wb = [...CARDDB.keys()].find(k => typesOf(k).some(y => y.includes("Whitebeard Pirates")) && (CARDDB.get(k) || {}).t === "Character" && (CARDDB.get(k) || {}).k <= 4);
  const sabo = [...CARDDB.keys()].find(k => nameOf(k) === "Sabo" && (CARDDB.get(k) || {}).k === 5 && (CARDDB.get(k) || {}).t === "Character");
  return {two, five, wb, sabo}; });
console.log("reveal cards", JSON.stringify(rvc));
const runRv = (code, t, top) => page.evaluate(([code, t, top]) => { S.chars = []; S.deck.unshift({c: top, n: nameOf(top), u: 88000 + S.deck.length}); commit(); fxEnqueue(fxJob({c: code, n: nameOf(code)}, fxAb(code).find(a => a.t === t))); return S.deck.length; }, [code, t, top]);
await runRv("ST12-010", "onPlay", rvc.two);
await drive();
const rv1 = await page.evaluate(c => ({played: S.chars.some(f => f.card.c === c), top: S.deck[0].c, log: myLog.map(e => e[1]).slice(-4).join(" | ")}), rvc.two);
console.log("reveal play", JSON.stringify(rv1));
check(rv1.played && /revealed .*from the top of their deck/.test(rv1.log) && /for free/.test(rv1.log), "ST12-010 reveals the top card and plays the cost 2 Character for free");
await fxClear();
const n1 = await runRv("ST12-010", "onPlay", rvc.five);
await page.evaluate(() => document.querySelector("#fxpanel .btn.pri").click());
await page.waitForTimeout(200);
const rv2 = await page.evaluate(() => ({txt: document.querySelector("#fxpanel").innerText, shown: !!document.querySelector("#fxpanel .fxrv .card")}));
await drive();
const rv2b = await page.evaluate(c => ({chars: S.chars.length, bottom: S.deck[S.deck.length - 1].c === c}), rvc.five);
check(/isn't a Character card with a cost of 2/.test(rv2.txt) && rv2.shown && rv2b.chars === 0 && rv2b.bottom, "a revealed card that doesn't fit is shown, not played, and goes to the bottom");
await fxClear();
const rvh0 = await page.evaluate(() => S.hand.length);
await runRv("ST22-003", "onPlay", rvc.five);
await drive();
const rvh1 = await page.evaluate(() => S.hand.length);
await fxClear();
await runRv("ST22-003", "onPlay", rvc.wb);
await drive();
const rvh2 = await page.evaluate(() => S.hand.length);
check(rvh1 === rvh0 && rvh2 === rvh1 + 2, "ST22-003 draws 2 only when the revealed card is a Whitebeard Pirates card");
await fxClear();
const rv3 = await page.evaluate(sabo => { S.chars = [{card: {c: "ST13-007", n: nameOf("ST13-007")}, r: false, d: 0, pt: 0}]; S.life.unshift({c: sabo, n: nameOf(sabo), u: 88999}); S.leader.pm = 0; commit();
  const lf = S.life.length; fxEnqueue(fxJob(S.chars[0].card, fxAb("ST13-007").find(a => a.t === "activateMain"))); return lf; }, rvc.sabo);
for (let i = 0; i < 8 && await page.evaluate(() => !!fxCur); i++) { await page.evaluate(() => { if (fxCur.steps[fxCur.i].a === "pwr") { fxCur.pick = ["ld"]; doAction("fxapply"); return; } const b = document.querySelector("#fxpanel .btn.pri"); if (b) b.click(); }); await page.waitForTimeout(200); }
const rv3b = await page.evaluate(sabo => ({lf: S.life.length, sabo: S.chars.some(f => f.card.c === sabo), pm: S.leader.pm}), rvc.sabo);
console.log("life reveal", rv3, JSON.stringify(rv3b));
check(rv3b.lf === rv3 - 1 && rv3b.sabo && rv3b.pm === 2000, "ST13-007 reveals the top Life card, plays the Sabo there, and gives the Leader +2000");
await fxClear();
check(await page.evaluate(() => { const k = [...CARDDB.keys()].find(k => hasType(k, "Red-Haired Pirates") && !/red/i.test((CARDDB.get(k) || {}).c || "")); return !k || cardFilter("{Red-Haired Pirates} type card")(k); }), "a type name with a color word in it isn't read as a color");
const brv = await page.evaluate(wb => botSide(() => { S.chars = []; S.deck.unshift({c: wb, n: nameOf(wb), u: 88777}); botAbility({c: "OP08-052", n: nameOf("OP08-052")}, ["onPlay"], 0); return S.chars.map(f => f.card.c); }), rvc.wb);
check(brv.includes(rvc.wb), "the computer reveals with OP08-052 and plays the Whitebeard Pirates Character it finds");
// "You may reveal 2 Events from your hand:" (OP12-004): the cards stay in hand, and without 2 Events it can't be paid
await page.evaluate(() => { oppM = oppModel(PR.pres[1]); commit(); });
const evs = await page.evaluate(() => [...CARDDB.keys()].filter(k => /^OP0[1-9]-/.test(k) && (CARDDB.get(k) || {}).t === "Event").slice(0, 2));
const rh = await page.evaluate(evs => { while (fxCur) { fxQueue.length = 0; fxFinish(false); }
  S.chars = [{card: {c: "OP12-004", n: nameOf("OP12-004")}, r: false, d: 0, pt: 0}]; S.hand = [{c: "OP01-016", n: "", u: 91001}, ...evs.map((c, i) => ({c, n: nameOf(c), u: 91002 + i}))]; commit();
  fxEnqueue(fxJob(S.chars[0].card, fxAb("OP12-004").find(a => a.t === "activateMain")));
  const st = fxCur.steps[0], glow = document.querySelectorAll("#hand .fxglow, #hand [data-fx]").length; fxCur.pick = ["hand:0"]; doAction("fxapply"); const early = fxCur && fxCur.i === 0;
  fxCur.pick = ["hand:1", "hand:2"]; doAction("fxapply"); const pay = {a: st.a, early, h: S.hand.length, next: fxCur && fxCur.steps[fxCur.i].a, log: myLog.slice(-1)[0][1]};
  doAction("fxgo"); pay.pm = S.chars[0].pm || 0; while (fxCur) { fxQueue.length = 0; fxFinish(false); }
  S.hand = S.hand.slice(0, 2); commit(); fxEnqueue(fxJob(S.chars[0].card, fxAb("OP12-004").find(a => a.t === "activateMain"))); pay.short = myLog.slice(-1)[0][1]; pay.btns = fxCur ? ["still open"] : [];
  while (fxCur) { fxQueue.length = 0; fxFinish(false); }
  pay.events = cardFilter("Events")(evs[0]) && !cardFilter("Events")("OP01-016");
  return pay; }, evs);
console.log("reveal hand", JSON.stringify(rh));
check(rh.a === "revealHand" && rh.early && rh.h === 3 && /revealed .* from hand/.test(rh.log) && rh.pm === 2000, "OP12-004 reveals 2 Events from hand (they stay there) and gets +2000");
check(/couldn't pay the cost .*needs 2 cards/.test(rh.short) && !rh.btns.length && rh.events, "with only 1 Event in hand the cost can't be paid, so the ability isn't used");
// "You may place 2 cards with a type including "CP" from your trash at the bottom of your deck:" (OP03-080), by the computer
const cp = await page.evaluate(() => [...CARDDB.keys()].filter(k => typesOf(k).some(y => y.includes("CP"))).slice(0, 2));
const small = await page.evaluate(() => { const k = [...CARDDB.keys()].find(k => /^OP01-/.test(k) && (CARDDB.get(k) || {}).t === "Character" && (CARDDB.get(k) || {}).k <= 3); S.chars = [{card: {c: k, n: nameOf(k)}, r: false, d: 0, pt: 0}]; commit(); PR.pres[0] = JSON.parse(JSON.stringify(pubFull())); return k; });
// (the made-up requests above moved your side's count of the computer's requests past its own)
const bcp = await page.evaluate(cp => botSide(() => { S.mqn = Math.max(S.mqn || 0, (PR.sides[0].S.ack || 0) + 5); S.trash = cp.map((c, i) => ({c, n: nameOf(c), u: 92000 + i})); const d = S.deck.length; botAbility({c: "OP03-080", n: nameOf("OP03-080")}, ["onPlay"], 0); return {tr: S.trash.length, dk: S.deck.length - d}; }), cp);
await page.waitForTimeout(300);
const gone = await page.evaluate(() => !S.chars.length);
console.log("cp", JSON.stringify(cp), JSON.stringify(bcp), gone, small);
check(bcp.tr === 0 && bcp.dk === 2 && gone, "the computer pays OP03-080 with 2 CP cards from its trash and K.O.s your cost 3 or less Character");
await page.evaluate(() => { oppM = oppModel(PR.pres[1]); commit(); });
// power "until the end of your opponent's next turn": your Leader keeps +1000 through the computer's turn (OP09-013),
// and the computer's Character keeps your −2000 through its own turn (OP11-009); both end when your next turn starts
const nx = await page.evaluate(() => {
  while (fxCur) { fxQueue.length = 0; fxFinish(false); }
  botSide(() => { S.chars = [{card: {c: "OP01-013", n: nameOf("OP01-013")}, r: false, d: 0, pt: 0}]; return 0; });
  S.myTurn = true; S.atk = null; S.chars = []; S.leader.pm = 0; S.leader.nx = 0; S.mqn = Math.max(S.mqn || 0, (PR.sides[1].S.ack || 0) + 5); commit();
  fxEnqueue(fxJob({c: "OP09-013", n: nameOf("OP09-013")}, fxAb("OP09-013").find(a => a.t === "onPlay")));
  const s1 = fxCur.steps[fxCur.i]; fxCur.pick = ["ld"]; doAction("fxapply");
  const ld = {pm: S.leader.pm, nx: S.leader.nx, flag: !!s1.nx};
  fxEnqueue(fxJob({c: "OP11-009", n: nameOf("OP11-009")}, fxAb("OP11-009").find(a => a.t === "whenAttacking")));
  fxCur.pick = fxCands(fxCur.steps[fxCur.i]).map(x => x.ref).slice(0, 1); doAction("fxapply");
  const req = Object.assign({}, S.mq[S.mq.length - 1]);
  while (fxCur) { fxQueue.length = 0; fxFinish(false); }
  endTurn(); clearTimeout(botT); botT = null;
  const end = S.leader.pm;
  PR.pres[0] = JSON.parse(JSON.stringify(pubFull()));
  const opp = botSide(() => { const f = S.chars[0]; startTurn(); const a = f.pm; endTurn(); return {a, b: f.pm, nt: f.nt || 0}; });
  return {ld, req, end, opp, start: {pm: S.leader.pm, nx: S.leader.nx || 0, my: S.myTurn}};
});
console.log("next turn", JSON.stringify(nx));
check(nx.ld.flag && nx.ld.pm === 1000 && nx.ld.nx === 1000 && nx.end === 1000, "your Leader keeps +1000 from OP09-013 after your turn ends");
check(nx.req.k === "pwr" && nx.req.v === -2000 && nx.req.nx === 1 && nx.opp.a === -2000 && nx.opp.b === 0 && nx.opp.nt === 0, "the computer's Character keeps −2000 from OP11-009 through its turn, then loses it");
check(nx.start.my && nx.start.pm === 0 && nx.start.nx === 0, "the +1000 ends when your next turn starts");
// OP17-063 Kaido: while it's on your field, Character cards in your hand without a Counter have +1000 Counter; its
// Activate: Main (DON!! −1, if it was played this turn) negates a cost 6 or less Character and K.O.s it, so "cannot be
// K.O.'d by effects" (OP03-088) doesn't stop it and an [On K.O.] (OP01-080) doesn't run
const kd = await page.evaluate(() => {
  while (fxCur) { fxQueue.length = 0; fxFinish(false); }
  const noCtr = [...CARDDB.keys()].find(k => /^OP0/.test(k) && (CARDDB.get(k) || {}).t === "Character" && !(CARDDB.get(k) || {}).ctr);
  S.chars = []; S.hand = [{c: noCtr, n: nameOf(noCtr), u: 93001}]; commit();
  const before = ctrOf(noCtr);
  S.chars = [{card: {c: "OP17-063", n: nameOf("OP17-063")}, r: false, d: 0, pt: S.turn}]; commit();
  const after = ctrOf(noCtr), list = handCounters().map(x => x.v);
  S.chars[0].mk = ["ng"]; const neg = ctrOf(noCtr); S.chars[0].mk = [];
  return {noCtr, before, after, list, neg};
});
console.log("kaido counter", JSON.stringify(kd));
check(kd.before === 0 && kd.after === 1000 && kd.list.join() === "1000" && kd.neg === 0, "OP17-063 gives Characters in your hand without a Counter a +1000 Counter while it's on your field");
await page.evaluate(() => { botSide(() => { S.chars = ["OP03-088", "OP01-080"].map((c, i) => ({card: {c, n: nameOf(c), u: 93100 + i}, r: false, d: 0, pt: 0})); return 0; });
  oppM = oppModel(PR.pres[1]); S.myTurn = true; S.atk = null; S.donActive = Math.max(S.donActive, 3); S.mqn = Math.max(S.mqn || 0, (PR.sides[1].S.ack || 0) + 5); commit(); });
const kaido = async target => {
  await page.evaluate(() => { const k = S.chars.find(f => f.card.c === "OP17-063"); k.mk = []; fxEnqueue(fxJob(k.card, fxAb("OP17-063").find(a => a.t === "activateMain"))); });
  for (let i = 0; i < 6 && await page.evaluate(() => !!fxCur); i++) {
    await page.evaluate(t => { const st = fxCur.steps[fxCur.i];
      if (st.a === "returnDon") { doAction("fxrd:a"); doAction("fxrdok"); return; }
      if (st.a === "ko") { const r = fxCands(st).find(x => (oppCardAt(x.ref) || {}).c === t); fxCur.pick = r ? [r.ref] : []; doAction("fxapply"); return; }
      const b = document.querySelector("#fxpanel .btn.pri"); if (b) b.click(); }, target);
    await page.waitForTimeout(200);
  }
  return page.evaluate(() => { PR.pres[0] = JSON.parse(JSON.stringify(pubFull())); const h = PR.sides[1].S.hand.length, mh = S.hand.length;
    botSide(() => 0); return {h, mh, mq: (S.mqh || []).slice(-2).map(q => q.k).join()}; });
};
const fd0 = await page.evaluate(() => fieldDon());
const ka = await kaido("OP03-088");
await page.waitForTimeout(500);
const kb = await page.evaluate(() => ({chars: PR.sides[1].S.chars.map(f => f.card.c), tr: (PR.sides[1].S.trash[0] || {}).c, fd: fieldDon()}));
console.log("kaido ko", JSON.stringify(ka), JSON.stringify(kb), fd0);
check(ka.mq === "ng,ko" && !kb.chars.includes("OP03-088") && kb.tr === "OP03-088" && kb.fd === fd0 - 1, "OP17-063 pays DON!! −1, negates OP03-088 and K.O.s it although it can't be K.O.'d by effects");
const kc = await kaido("OP01-080");
await page.waitForTimeout(600);
const kc2 = await page.evaluate(() => ({chars: PR.sides[1].S.chars.map(f => f.card.c), h: PR.sides[1].S.hand.length, mh: S.hand.length, log: PR.sides[1].S.trash[0].c, lg: PR.sides[1].myLog.slice(-12).map(e => e[1])}));
console.log("kaido onko", JSON.stringify(kc), JSON.stringify(kc2));
const kAfter = kc2.lg.slice(kc2.lg.findIndex(l => /OP01-080.*was K\.O\.'d/.test(l)));
check(!kc2.chars.includes("OP01-080") && kc2.log === "OP01-080" && kAfter.length && kAfter.some(l => /OP01-080.*Negated/.test(kc2.lg.join("|"))) && !kAfter.some(l => /drew|resolved OP01-080/.test(l)) && kc2.mh === kc.mh, "the negated OP01-080's [On K.O.] draw doesn't happen");
const kn = await page.evaluate(() => { botSide(() => { S.chars = [{card: {c: "OP03-088", n: nameOf("OP03-088"), u: 93200}, r: false, d: 0, pt: 0, mk: ["ng"]}]; return 0; });
  const r = botSide(() => ({blk: blockerNow(S.chars[0]), kw: kwNow(S.chars[0]), sh: shielded(S.chars[0], "ko")}));
  botSide(() => { S.chars[0].myTurn = 0; startTurn(); const left = (S.chars[0].mk || []).includes("ng"); S.myTurn = false; return 0; });
  const after = PR.sides[1].S.chars[0].mk || []; return Object.assign(r, {after: after.includes("ng")}); });
console.log("negated", JSON.stringify(kn));
check(!kn.blk && !/b/.test(kn.kw) && !kn.sh && !kn.after, "a negated Blocker can't block or shield itself, and the negation ends at its owner's turn");
const kp = await page.evaluate(() => { const k = S.chars.find(f => f.card.c === "OP17-063"); k.pt = S.turn - 1; k.mk = []; const n = PR.sides[1].S.chars.length;
  fxEnqueue(fxJob(k.card, fxAb("OP17-063").find(a => a.t === "activateMain"))); doAction("fxgo"); const skipped = !fxCur || fxCur.steps[fxCur.i].a !== "ko";
  while (fxCur) { fxQueue.length = 0; fxFinish(false); } return {skipped, log: myLog.slice(-2).map(e => e[1]).join(" | ")}; });
console.log("kaido old", JSON.stringify(kp));
check(kp.skipped && /skipped a step/.test(kp.log), "OP17-063 does nothing if it wasn't played this turn");
// a step's "If ...," isn't a target limit: EB04-016 rests any opponent's Character with a cost of 8 or less, not only {Neptunian} ones
const lm = await page.evaluate(() => { const st = fxAb("EB04-016").flatMap(a => a.steps || []).find(x => x.a === "rest"), l = fxLimits(st);
  const st2 = fxAb("OP08-085").flatMap(a => a.steps || []).find(x => x.a === "ko"), l2 = fxLimits(st2); return {type: l.type, maxK: l.maxK, minK: l2.minK, maxK2: l2.maxK}; });
console.log("limits", JSON.stringify(lm));
check(lm.type === null && lm.maxK === 8 && lm.minK === null && lm.maxK2 === 4, "an ability's condition doesn't narrow what it can target");
// card wording: "X or Y" picks, "from your hand or trash", target limits, when by-hand abilities can be used, two-part always-on effects
const cx = await page.evaluate(() => {
  const f = cardFilter("[Sanji] or Event card"), ps = playSpec("Play up to 1 [Sabo], [Portgas.D.Ace], or [Monkey.D.Luffy] with a cost of 2 from your hand or trash.");
  const L = (code, a) => fxLimits(fxAb(code).flatMap(x => x.steps || []).find(s => s.a === a));
  const at = L("EB05-057", "giveDon"), ty = L("OP14-040", "giveDon"), dn = L("OP15-027", "rest"), bk = L("ST01-016", "ko"), fl = L("ST27-001", "rest"), z = L("OP14-064", "ko");
  const c = S.leader.card, my = S.myTurn, opp = {t: "other", text: "[Opponent's Turn] All of your Characters gain +1000 power."}, rep = {t: "other", text: "If this Character would be K.O.'d, you may trash 1 card from your hand instead."};
  const now = [abilityNow(c, opp), abilityNow(c, rep)]; S.myTurn = !my; now.push(abilityNow(c, opp), abilityNow(c, rep)); S.myTurn = my;
  return {sanji: f("OP01-013"), ev: f("OP01-026"), nami: f("OP01-016"), from: ps.from, luffy: ps.pred("OP01-024"), usopp: ps.pred("OP01-004"),
    attr: at.attr, types: ty.types, don: dn.don, blk: bk.blk, stage: fl.stage, eqP: z.eqP, bp: z.bp, my, now,
    st: fxAb("ST14-001").map(a => a.s && (a.s.k || a.s.p)), buchi: condCheck("you don't have [Buchi]", S.leader), orTrig: L("OP05-002", "pwr").orTrig,
    all: fxAb("OP12-018").flatMap(a => a.steps || []).some(s => s.n === -1000 && s.all && s.ld),
    fits: [abFits({text: "[Opponent's Turn] [On K.O.] Draw 1 card."}, null) === !my, abFits({koBy: "opp", text: ""}, "opp"), !abFits({koBy: "opp", text: ""}, "battle"), abFits({koBy: "fx", text: ""}, "own"), !abFits({koBy: "fx", text: ""}, "battle"), abFits({koBy: "opp", text: ""}, null)],
    ko: fxAb("OP11-035").find(a => a.koBy === "opp" && a.t === "onKO") && fxAb("OP16-102").some(a => a.t === "trigger" && a.steps[0].a === "act" && a.steps[0].k === "onKO"), peq: statFits({to: "chars", peq: 6000}, S.leader, {card: {c: "ST01-012"}}) && !statFits({to: "chars", peq: 6000}, S.leader, {card: {c: "OP01-013"}})};
});
console.log("card wording", JSON.stringify(cx));
check(cx.sanji && cx.ev && !cx.nami, "\"[Sanji] or Event card\" takes either one");
check(cx.from === "both" && cx.luffy && !cx.usopp, "\"from your hand or trash\" offers both, with the names and cost kept");
check(cx.attr.join() === "Special,Wisdom" && cx.types.join() === "Fish-Man,Merfolk" && cx.don === 1 && cx.blk && cx.stage && cx.eqP === 0 && cx.bp, "attributes, types, DON!! given, [Blocker], a named Stage and base power 0 limit targets");
check(cx.now[0] === !cx.my && cx.now[2] === cx.my && cx.now[1] && cx.now[3], "[Opponent's Turn] abilities are used on the opponent's turn, and \"would be K.O.'d ... instead\" on either");
check(cx.buchi === true && cx.orTrig && cx.all, "\"you don't have [X]\", \"{X} type Characters or Characters with a [Trigger]\" and \"your opponent's Leader and all of their Characters\" read right");
check(cx.fits.every(Boolean) && cx.ko, "\"When this Character is K.O.'d by your opponent's effect\" fires only for that, [Opponent's Turn] abilities only then, and \"Activate this card's [On K.O.] effect\" Triggers work");
check(cx.st.join() === "1,1000" && cx.peq, "ST14-001's two always-on effects both count, and \"with 6000 base power\" means exactly that");
// "If this Character would be K.O.'d, you may ... instead": the K.O. waits while you choose. Paying keeps the card, saying
// no lets it go (EB04-030). "your {X} type Character ... by your opponent's effect" covers only those, and not battles
// (OP13-047); "in battle" only battles (OP10-034); "add it to the top of your Life cards" moves the card itself (OP11-101)
await fxClear();
const rp = await page.evaluate(() => {
  const base = JSON.parse(JSON.stringify(PR.pres[1])), ch = c => ({card: {c, n: nameOf(c), u: 94000 + Math.floor(Math.random() * 999)}, r: false, d: 0, pt: 0});
  const hit = (code, k, v) => { base.mq = [{id: S.ack + 1, r: "ch:" + S.chars.findIndex(f => f.card.c === code), c: code, k, v: v || 0}]; oppM = oppModel(base); applyMarkReqs(); };
  const has = c => S.chars.some(f => f.card.c === c), out = {};
  S.chars = [ch("EB04-030")]; S.donActive = 3; S.donRested = 0; S.leader.d = 0;
  hit("EB04-030", "ko"); out.wait = has("EB04-030") && !!(fxCur && fxCur.rpl); out.txt = /would be K\.O\.'d/.test(document.querySelector("#fxpanel").innerText);
  doAction("fxcancel"); out.gone = !has("EB04-030") && S.trash[0].c === "EB04-030" && !fxCur;
  S.trash.shift(); S.chars = [ch("EB04-030")];
  hit("EB04-030", "ko"); doAction("fxrd:a"); doAction("fxrdok"); out.kept = has("EB04-030") && !fxCur && S.donActive === 2;
  const wb = [...BFX.keys()].find(k => (CARDDB.get(k) || {}).t === "Character" && typesOf(k).some(y => y.includes("Whitebeard Pirates")) && !fxAb(k).some(a => a.rp || a.s));
  S.chars = [ch("OP13-047"), ch(wb), ch("OP01-016")];
  hit("OP01-016", "ko"); out.other = !has("OP01-016") && !fxCur;
  hit(wb, "ko", -1); out.battle = !has(wb) && !fxCur;
  S.chars = [ch("OP13-047"), ch(wb)];
  hit(wb, "ko"); out.wbAsk = has(wb) && !!(fxCur && fxCur.rpl); doAction("fxgo"); out.wbPaid = has(wb) && !has("OP13-047") && S.trash[0].c === "OP13-047" && !fxCur;
  S.chars = [ch("OP10-034")]; const lf = S.life.length, hd = S.hand.length;
  hit("OP10-034", "ko"); out.fxKo = !has("OP10-034") && !fxCur;
  S.chars = [ch("OP10-034")];
  hit("OP10-034", "ko", -1); out.inBattle = has("OP10-034") && !!(fxCur && fxCur.rpl); doAction("fxgo"); out.lifePaid = has("OP10-034") && S.life.length === lf - 1 && S.hand.length === hd + 1;
  const sn = [...BFX.keys()].find(k => (CARDDB.get(k) || {}).t === "Character" && hasType(k, "Supernovas") && nameOf(k) !== nameOf("OP11-101") && ((CARDDB.get(k) || {}).k || 0) <= 5 && !fxAb(k).some(a => a.rp || a.s));
  S.chars = [ch("OP11-101"), ch(sn)]; const lf2 = S.life.length;
  hit(sn, "bounce"); out.itAsk = !!(fxCur && fxCur.rpl) && /to the top of your Life/.test(document.querySelector("#fxpanel").innerText); doAction("fxgo");
  out.toLife = !has(sn) && S.life.length === lf2 + 1 && S.life[0].c === sn && !S.life[0].up && !S.hand.some(c => c.c === sn);
  out.rp = [...BFX.values()].filter(x => x.ab.some(a => a.rp)).length;
  oppM = oppModel(PR.pres[1]); S.chars = []; commit(); return out;
});
console.log("instead", JSON.stringify(rp));
check(rp.rp > 65, "the \"... instead\" abilities are read (" + rp.rp + " cards)");
check(rp.wait && rp.txt && rp.gone && rp.kept, "a K.O. waits while you choose: \"Don't use it\" lets it go, paying keeps the card");
check(rp.other && rp.battle && rp.wbAsk && rp.wbPaid, "\"your {X} type Character ... by your opponent's effect\" covers only those Characters, and not a battle");
check(rp.fxKo && rp.inBattle && rp.lifePaid, "\"K.O.'d in battle\" covers only battles");
check(rp.itAsk && rp.toLife, "\"add it to the top of your Life cards\" moves the card that would leave the field");
// the computer pays for its own (Normal), and on Easy lets the card go
const rpBot = async diff => page.evaluate(d => {
  const was = PR.diff; PR.diff = d;
  botSide(() => { S.chars = [{card: {c: "EB04-030", n: nameOf("EB04-030"), u: 95000 + d}, r: false, d: 0, pt: 0}]; S.donActive = 2; S.donRested = 0; return 0; });
  S.mqn = Math.max(S.mqn || 0, (PR.sides[1].S.ack || 0) + 5); sendOpp({r: "ch:0", c: "EB04-030", k: "ko", v: 0}); commit();
  PR.pres[0] = JSON.parse(JSON.stringify(pubFull())); botSide(() => 0);
  const b = PR.sides[1].S; PR.diff = was;
  return {kept: b.chars.some(f => f.card.c === "EB04-030"), don: b.donActive + b.donRested, tr: (b.trash[0] || {}).c, mine: !fxCur};
}, diff);
const rb1 = await rpBot(1), rb0 = await rpBot(0);
console.log("instead bot", JSON.stringify(rb1), JSON.stringify(rb0));
check(rb1.kept && rb1.don === 1 && rb1.mine, "the computer returns a DON!! to keep its EB04-030");
check(!rb0.kept && rb0.tr === "EB04-030", "on Easy the computer lets it be K.O.'d");
// "When ..." abilities the game offers when that happens: a DON!! returned (OP06-042, then not again that turn), this card
// rested (OP14-032), an Event activated (OP04-053), one of your {Alabasta} Characters K.O.'d (OP18-001), an opponent's
// Character K.O.'d (EB04-044), a card trashed from hand by an effect giving [Rush] (OP14-049), an attack dealing damage
// (OP03-047), and the computer using its own (ST10-014)
await fxClear();
const wh = await page.evaluate(() => {
  const out = {}, ld0 = S.leader.card, ch = (c, x) => Object.assign({card: {c, n: nameOf(c), u: 96000 + Math.floor(Math.random() * 999)}, r: false, d: 0, pt: 0}, x || {});
  const job = steps => fxEnqueue(fxJob({c: "OP01-016", n: "Nami"}, normFx({abilities: [{t: "onPlay", text: "test", steps}]}).ab[0]));
  const clear = () => { while (fxCur) { fxQueue.length = 0; fxFinish(false); } };
  const queued = c => [fxCur, ...fxQueue].filter(Boolean).some(j => j.card.c === c);
  S.myTurn = true; S.phase = "play"; S.chars = []; S.donActive = 4; S.donRested = 0;
  S.leader = Object.assign({}, S.leader, {card: {c: "OP06-042", n: nameOf("OP06-042")}, mk: []});
  job([{a: "returnDon", who: "own", n: 1, upTo: false}]); doAction("fxrd:a"); doAction("fxrdok");
  out.don = !!fxCur && fxCur.card.c === "OP06-042"; const h0 = S.hand.length; doAction("fxdraw"); out.drew = S.hand.length === h0 + 1 && !fxCur;
  job([{a: "returnDon", who: "own", n: 1, upTo: false}]); doAction("fxrd:a"); doAction("fxrdok"); out.once = !fxCur; clear();
  S.leader = Object.assign({}, S.leader, {card: ld0, mk: []});
  const hm = ch("OP14-032"); S.chars = [hm]; fxEnqueue(fxJob(hm.card, normFx({abilities: [{t: "onPlay", text: "Rest this Character.", steps: [{a: "rest", self: true}]}]}).ab[0])); doAction("fxgo");
  out.rest = hm.r && (!!fxCur && fxCur.card.c === "OP14-032" && fxCur.steps[0].a === "rest" && fxCur.steps[0].who === "opp" || myLog.slice(-3).some(e => /OP14-032.*nothing could be chosen/.test(e[1]))); clear();
  S.chars = [ch("OP04-053", {d: 1})]; const ev = [...BFX.keys()].find(k => (CARDDB.get(k) || {}).t === "Event" && fxAb(k).some(a => a.t === "main"));
  S.hand.push({c: ev, n: nameOf(ev), u: 96500}); moveCard("hand:" + (S.hand.length - 1), "event", true); out.event = queued("OP04-053"); clear();
  if (S.ev) { S.trash.unshift(S.ev.card); S.ev = null; }
  const ala = [...BFX.keys()].find(k => (CARDDB.get(k) || {}).t === "Character" && hasType(k, "Alabasta") && !fxAb(k).some(a => a.rp || a.wh));
  S.leader = Object.assign({}, S.leader, {card: {c: "OP18-001", n: nameOf("OP18-001")}, mk: []}); S.chars = [ch(ala), ch("OP01-016")];
  const base = JSON.parse(JSON.stringify(PR.pres[1])), hit = (code, k, v) => { base.mq = [{id: S.ack + 1, r: "ch:" + S.chars.findIndex(f => f.card.c === code), c: code, k, v: v || 0}]; oppM = oppModel(base); applyMarkReqs(); };
  const kc0 = S.kc || 0; hit("OP01-016", "ko"); out.koOther = !queued("OP18-001"); hit(ala, "ko"); out.koAla = queued("OP18-001") && (S.kc || 0) === kc0 + 2 && pubFull().kc === kc0 + 2; clear();
  S.leader = Object.assign({}, S.leader, {card: ld0, mk: []}); S.chars = [ch("EB04-044")];
  base.mq = []; base.kc = (S.okc || 0) + 1; oppM = oppModel(base); applyMarkReqs(); out.oppKo = queued("EB04-044"); clear();
  oppM = oppModel(base); applyMarkReqs(); out.oppKoOnce = !fxCur;
  const jb = ch("OP14-049", {pt: S.turn}); S.chars = [jb]; out.rushBefore = rushNow(jb);
  S.hand.push({c: "OP01-016", n: "Nami", u: 96600}); job([{a: "discard", who: "own", n: 1, upTo: false}]); fxPick("hand:" + (S.hand.length - 1)); if (fxCur && fxCur.card.c === "OP01-016") doAction("fxapply");
  out.rushJob = !!fxCur && fxCur.card.c === "OP14-049"; doAction("fxgo"); out.rushAfter = rushNow(jb); clear();
  S.chars = [ch("OP03-047", {d: 1})]; S.atk = {s: "ch:0", t: "ld", n: 7777, l0: 5}; const b2 = JSON.parse(JSON.stringify(PR.pres[1])); b2.rs = 7777; b2.lf = 4; oppM = oppModel(b2); advance();
  out.dmg = !S.atk && queued("OP03-047"); clear();
  oppM = oppModel(PR.pres[1]); S.chars = []; S.atk = null; commit();
  out.bot = botSide(() => {
    const w = {card: {c: "ST10-014", n: nameOf("ST10-014"), u: 96700}, r: false, d: 0, pt: 0}; S.chars = [w]; S.donActive = 2; S.donRested = 0;
    const h = S.hand.length, t = S.trash.length;
    fxEnqueue(fxJob({c: "OP01-016", n: "Nami"}, normFx({abilities: [{t: "onPlay", text: "test", steps: [{a: "returnDon", who: "own", n: 1, upTo: false}]}]}).ab[0])); botFxGo();
    const r = {h: S.hand.length - h, t: S.trash.length - t, log: myLog.slice(-4).map(e => e[1]).join(" | ")}; S.chars = []; return r;
  });
  return out;
});
console.log("when", JSON.stringify(wh));
check(wh.don && wh.drew && wh.once, "a DON!! returned to the DON!! deck offers OP06-042's draw, once per turn");
check(wh.rest, "resting OP14-032 offers its \"When this Character becomes rested\"");
check(wh.event, "activating an Event offers OP04-053's ability");
check(wh.koOther && wh.koAla, "OP18-001 is offered only when an {Alabasta} Character is K.O.'d, and K.O.s are counted for the opponent");
check(wh.oppKo && wh.oppKoOnce, "an opponent's Character K.O.'d offers EB04-044's draw, once");
check(!wh.rushBefore && wh.rushJob && wh.rushAfter === "all", "OP14-049 gets [Rush] only after a card is trashed from your hand by an effect");
check(wh.dmg, "an attack that deals damage offers OP03-047's ability");
check(wh.bot && wh.bot.h === 0 && wh.bot.t === 1 && /ST10-014/.test(wh.bot.log), "the computer uses its own \"When ...\" ability (ST10-014)");
// more card text the game carries out: "that card gains an additional +2000", your own active Leader as a cost,
// "draw so that you have 3 cards", and a Leader of a named type
const more = await page.evaluate(() => {
  const clear = () => { while (fxCur) { fxQueue.length = 0; fxFinish(false); } }, tr0 = S.trash.slice(), out = {};
  out.ctr = [];
  for (const n of [20, 0]) {
    clear(); S.trash = S.deck.slice(0, n); S.leader.pm = 0; S.leader.bc = 0; S.leader.r = false; commit();
    fxEnqueue(fxJob({c: "OP04-095", n: nameOf("OP04-095")}, fxAb("OP04-095").find(a => a.t === "counter")));
    fxCur.pick = ["ld"]; doAction("fxapply"); if (fxCur && fxCur.i === 1) doAction("fxgo");
    out.ctr.push(S.leader.pm);
  }
  clear(); S.trash = tr0; S.leader.pm = 0; S.leader.bc = 0;
  // OP04-006: pay with your active Leader's power; a rested Leader can't pay
  const ch = {c: "OP04-006", n: nameOf("OP04-006")}; S.chars = [{card: ch, r: false, d: 0, pt: 0}]; commit();
  fxEnqueue(fxJob(ch, fxAb("OP04-006").find(a => a.t === "whenAttacking"))); doAction("fxgo");
  out.paid = {ld: S.leader.pm, step: fxCur ? fxCur.i : -1};
  if (fxCur) doAction("fxgo");
  out.after = S.chars[0].pm || 0;
  clear(); S.leader.pm = 0; S.leader.r = true; S.chars[0].pm = 0; commit();
  fxEnqueue(fxJob(ch, fxAb("OP04-006").find(a => a.t === "whenAttacking")));
  out.rested = (fxCur ? document.querySelector("#fxpanel").innerText : "") + myLog.slice(-1)[0][1]; doAction("fxgo"); out.restedPm = S.leader.pm;
  clear(); S.leader.r = false; S.chars = [];
  // OP02-051: draw until you have 3 cards
  const h0 = S.hand.slice(); S.hand = S.hand.slice(0, 1); commit();
  fxEnqueue(fxJob({c: "OP02-051", n: nameOf("OP02-051")}, fxAb("OP02-051").find(a => a.t === "onPlay")));
  out.drawTxt = document.querySelector("#fxpanel").innerText; doAction("fxdraw"); out.hand = S.hand.length;
  clear(); S.hand = h0;
  // EB05-013 on a Leader that isn't {Fish-Man} or {Merfolk}: nothing happens
  S.donActive = 2; commit();
  fxEnqueue(fxJob({c: "EB05-013", n: nameOf("EB05-013")}, fxAb("EB05-013").find(a => a.t === "onOppAttack")));
  doAction("fxgo"); out.typeTxt = (fxCur ? document.querySelector("#fxpanel").innerText : "") + myLog.slice(-3).map(e => e[1]).join(" | "); out.typePm = S.leader.pm || 0;
  clear(); commit();
  return out;
});
console.log("more", JSON.stringify(more));
check(more.ctr[0] === 4000 && more.ctr[1] === 2000, "OP04-095 gives the chosen card an additional +2000 only with 15 or more cards in the trash");
check(more.paid.ld === -5000 && more.paid.step === 1 && more.after === 2000, "OP04-006 pays with its Leader's −5000 power, then gains +2000");
check(/couldn't pay the cost .*active Leader/.test(more.rested) && more.restedPm === 0, "a rested Leader can't pay that cost, so the ability isn't used");
check(/until you have 3 cards in hand: 2 cards/.test(more.drawTxt) && more.hand === 3, "OP02-051 draws until you have 3 cards");
check(/Leader isn't that type/.test(more.typeTxt) && more.typePm === 0, "EB05-013 only powers up a {Fish-Man} or {Merfolk} Leader");
// ---- the rules other simulators follow: required steps, costs paid in full first, Once Per Turn per ability ----
const strict = await page.evaluate(() => {
  const out = {}, wasBot = PR.bot, clear = () => { while (fxCur) { fxQueue.length = 0; fxFinish(false); } };
  const btns = () => [...document.querySelectorAll("#fxpanel button")].map(b => b.textContent);
  clear(); PR.bot = 1;   // against the computer: the rules are strict
  out.strict = fxStrict();
  // "Draw 1 card and trash 1 card from your hand": both happen
  const h0 = S.hand.length; S.hand.push({c: "OP01-016", n: "Nami", u: 97001}); commit();
  fxEnqueue(fxJob({c: "OP01-016", n: "Nami"}, normFx({abilities: [{t: "onPlay", text: "[On Play] Draw 1 card and trash 1 card from your hand.", steps: [{a: "draw", n: 1, who: "own", text: "Draw 1 card"}, {a: "discard", n: 1, who: "own", text: "trash 1 card from your hand"}]}]}).ab[0]));
  out.draw = btns(); doAction("fxdraw"); out.discard = btns(); clear();
  // "up to" and "you may" can be passed
  fxEnqueue(fxJob({c: "OP01-016", n: "Nami"}, normFx({abilities: [{t: "onPlay", text: "[On Play] You may trash 1 card from your hand.", steps: [{a: "discard", n: 1, who: "own", text: "You may trash 1 card from your hand"}]}]}).ab[0]));
  out.may = btns(); clear();
  // a cost that can't be paid in full: the ability isn't used
  S.hand = S.hand.slice(0, 1); commit();
  fxEnqueue(fxJob({c: "OP01-016", n: "Nami"}, normFx({abilities: [{t: "onPlay", text: "[On Play] You may trash 2 cards from your hand: Draw 3 cards.", steps: [{a: "discard", n: 2, who: "own", pay: true, text: "You may trash 2 cards from your hand"}, {a: "draw", n: 3, who: "own", text: "Draw 3 cards"}]}]}).ab[0]));
  out.unpaid = {open: !!fxCur, log: myLog.slice(-1)[0][1], hand: S.hand.length}; clear();
  // nothing to choose: the step passes by itself
  const oc = oppM && oppM.chars ? oppM.chars.length : 0;
  fxEnqueue(fxJob({c: "OP01-016", n: "Nami"}, normFx({abilities: [{t: "onPlay", text: "[On Play] K.O. up to 1 of your opponent's Characters with a cost of 0.", steps: [{a: "ko", cost: 0, who: "opp", upTo: true, text: "K.O. up to 1 of your opponent's Characters with a cost of 0."}]}]}).ab[0]));
  out.none = {open: !!fxCur, log: myLog.slice(-2).map(e => e[1]).join(" | ")}; clear();
  // "at the end of this turn": waits for the end of the turn
  fxEnqueue(fxJob({c: "OP01-016", n: "Nami"}, normFx({abilities: [{t: "onPlay", text: "[On Play] Set up to 2 of your DON!! cards as active at the end of this turn.", steps: [{a: "other", text: "Set up to 2 of your DON!! cards as active at the end of this turn."}]}]}).ab[0]));
  out.laterStep = fxCur && fxCur.steps[0].a; doAction("fxlater"); out.queued = (S.eotq || []).length;
  S.eotq = []; clear();
  // Once Per Turn is per ability and ends with the turn
  const f = {card: {c: "OP06-042", n: nameOf("OP06-042"), u: 97100}, r: false, d: 0, pt: 0}; S.chars = [f];
  const a1 = {text: "[Once Per Turn] A"}, a2 = {text: "[Once Per Turn] B"};
  optMark({card: f.card, text: a1.text}); out.opt = [optUsed(f.card, a1), optUsed(f.card, a2)];
  // two abilities waiting together: the player picks which resolves first
  const ab2 = t => normFx({abilities: [{t: "onPlay", text: "[On Play] " + t, steps: [{a: "draw", n: 1, who: "own", text: t}]}]}).ab[0];
  fxEnqueue(fxJob({c: "OP01-016", n: "Nami"}, ab2("Draw 1 card."))); fxEnqueue(fxJob({c: "OP01-013", n: "Sanji"}, ab2("Draw 1 card. ")));
  out.order = {offer: $("#fxpanel").innerHTML.includes('data-do="fxfirst:0"'), before: fxCur.card.c};
  doAction("fxfirst:0"); out.order.after = fxCur.card.c; out.order.queued = fxQueue.map(j => j.card.c);
  doAction("fxdraw"); out.order.offerAfterStart = fxCur && $("#fxpanel").innerHTML.includes("fxfirst"); clear();
  // online, on the opponent's turn: mine waits while theirs is being resolved
  const wasR = R, wasPR = PR, wasOpp = oppM, wasTurn = S.myTurn;
  R = {presence: () => Promise.resolve()}; PR = null; S.myTurn = false; oppM = Object.assign({}, wasOpp || oppModel({nick: "Opp", p: 1}), {fb: 1});
  try {
    fxEnqueue(fxJob({c: "OP01-016", n: "Nami"}, ab2("Draw 1 card.")));
    out.hold = {held: fxHeld(fxCur), text: $("#fxpanel").textContent.includes("Waiting for")};
    const h = S.hand.length; doAction("fxdraw"); out.hold.blocked = S.hand.length === h && !!fxCur;
    oppM.fb = 0; renderFx(); out.hold.free = !fxHeld(fxCur) && !$("#fxpanel").textContent.includes("Waiting for");
    S.myTurn = true; oppM.fb = 1; fxCur.wt = 0; fxEnqueue(fxJob({c: "OP01-013", n: "Sanji"}, ab2("Draw 1 card. "))); out.hold.ownTurn = !fxQueue[0].wt;
    clear();
  } finally { R = wasR; PR = wasPR; oppM = wasOpp; S.myTurn = wasTurn; }
  S.chars = []; PR.bot = wasBot; commit();
  return out;
});
console.log("strict", JSON.stringify(strict));
check(strict.strict && !strict.draw.includes("Cancel") && !strict.draw.includes("Skip") && !strict.discard.includes("Skip") && !strict.discard.includes("Cancel"), "against someone, an ability's required steps have no Skip or Cancel");
check(strict.may.includes("Skip"), "a \"you may\" step can still be passed");
check(!strict.unpaid.open && /couldn't pay the cost/.test(strict.unpaid.log) && strict.unpaid.hand === 1, "a cost that can't be paid in full stops the ability before anything happens");
check(!strict.none.open && /nothing could be chosen/.test(strict.none.log), "a step with nothing to choose passes by itself and says so");
check(strict.laterStep === "later" && strict.queued === 1, "\"at the end of this turn\" waits for the end of the turn");
check(strict.order.offer && strict.order.before === "OP01-016" && strict.order.after === "OP01-013" && strict.order.queued[0] === "OP01-016" && !strict.order.offerAfterStart, "with two abilities waiting, the player picks which resolves first");
check(strict.hold.held && strict.hold.text && strict.hold.blocked && strict.hold.free && strict.hold.ownTurn, "online, the turn player's ability resolves before the other player's");
check(strict.opt[0] && !strict.opt[1], "Once Per Turn counts each ability on a card on its own");
await page.screenshot({ path: OUT + "/board.png" });
check(!errs.length, "no page errors" + (errs.length ? ": " + errs.slice(0, 3).join(" / ") : ""));
await app.close();
console.log(fail ? `${fail} FAILED` : "all passed");
process.exit(fail ? 1 : 0);
