import { _electron as electron } from "playwright-core";
import fs from "fs";
// Public lobby tables and ranked matches: the free board tools (DON!! deck, tapping DON!!, resting and standing,
// drawing, looking at the deck or Life, healing, moving cards by hand, power badges) only work while a card's
// ability is left to the player and its wording calls for that tool. Playing cards and giving DON!! on your turn
// still work, and a step the opponent has to carry out by hand reaches their side as an effect to do.
// Runs against the computer, offline, with the table marked as a public one.
const OUT = process.argv[2] || "shots-fair";
fs.mkdirSync(OUT, { recursive: true });
const prof = "/tmp/bounty-prof-fair"; fs.rmSync(prof, { recursive: true, force: true });
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
const toastText = () => page.evaluate(() => { const t = document.querySelector("#toast"); return t && !t.hidden ? t.innerText : ""; });
// open a menu, then tap the item that starts with label
const pick = async (open, label) => { await page.evaluate(open); return page.evaluate(label => { const b = [...document.querySelectorAll("#menu button")].find(x => x.textContent.startsWith(label)); if (b) b.click(); return !!b; }, label); };
const snap = () => page.evaluate(() => ({dd: S.donDeck, da: S.donActive, dr: S.donRested, h: S.hand.length, lf: S.life.length, dk: S.deck.length, tr: S.trash.length, ch: S.chars.length, r0: S.chars[0] ? S.chars[0].r : null, pm0: S.chars[0] ? S.chars[0].pm || 0 : 0, modal: modal ? modal.type : null}));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// a public table, with a Character and some DON!! on the board
await page.evaluate(() => {
  botSide(() => { S.pubt = true; return 0; });
  S.pubt = true; S.turn = Math.max(S.turn, 3); S.donActive = 8; S.donRested = 0;
  S.chars = [{card: {c: "OP01-025", n: nameOf("OP01-025")}, r: false, d: 0, pt: 0, pm: -2000}];
  for (const c of ["OP01-016", "OP01-013"]) S.hand.push({c, n: nameOf(c)});
  S.trash.unshift({c: "OP01-014", n: nameOf("OP01-014")});
  commit();
});
check(await page.evaluate(() => !boardTools() && fxOn()), "a public table has no free board tools, and card effects always run");

// ---- free tools are locked ----
let s0 = await snap();
check(await pick(() => openActMenu("dondeck", 300, 300), "Add 1 DON!! (active)"), "the DON!! deck menu still opens");
check(same(await snap(), s0) && /only works while a card's ability calls for it/.test(await toastText()), "adding DON!! from the DON!! deck is refused, with the reason");
await pick(() => openActMenu("dondeck", 300, 300), "Return 1 DON!! to deck");
await pick(() => openActMenu("dondeck", 300, 300), "Activate all DON!!");
await page.evaluate(() => { const d = document.querySelector('#me [data-don="a"]'); if (d) d.click(); });
await page.evaluate(() => moveDon({kind: "don", pool: "a"}, "dondeck"));
check(same(await snap(), s0), "returning DON!!, activating them all, tapping a DON!! and dragging one to the DON!! deck are refused");
await pick(() => openCardMenu("ch:0", 300, 300), "Rest");
await page.evaluate(() => { const c = document.querySelector('#me [data-src="ch:0"]'); if (c) c.dispatchEvent(new MouseEvent("dblclick", {bubbles: true})); });
check(same(await snap(), s0), "resting a Character from its menu or by double-click is refused");
await pick(() => openActMenu("deck", 300, 300), "Draw a card");
await pick(() => openActMenu("deck", 300, 300), "Look at top 5");
await page.evaluate(() => { doAction("searchdeck"); doAction("heal"); doAction("damage"); });
await pick(() => openActMenu("life", 300, 300), "Look at top Life card");
await pick(() => openActMenu("deck", 300, 300), "Add top card to Life");
check(same(await snap(), s0), "drawing, looking at or searching the deck, healing, taking damage, looking at Life and adding Life are refused");
await pick(() => openCardMenu("hand:0", 300, 300), "Trash");
await pick(() => openCardMenu("hand:0", 300, 300), "Add to Life");
await pick(() => openCardMenu("tr:0", 300, 300), "Return to hand");
await page.evaluate(() => movePm("ch:0", null));
check(same(await snap(), s0), "trashing from hand, adding hand to Life, taking from the trash and clearing a −2000 power badge are refused");
check(await page.evaluate(() => { const c = S.trash[0], ab = {t: "trigger", text: "[Trigger] Draw 1 card.", steps: []}; return abilityNow(c, ab) === false; }), "a [Trigger] can't be used from the trash");
await clear();

// ---- the normal turn still works ----
const h1 = (await snap()).h;
await pick(() => openCardMenu(`hand:${S.hand.length - 1}`, 300, 300), "Play to Character area");
check(await page.evaluate(h => S.chars.length === 2 && S.hand.length === h - 1 && S.donRested > 0, h1), "playing a Character from hand on your turn pays its cost as usual");
const da = await page.evaluate(() => S.donActive);
await pick(() => openCardMenu("ch:0", 300, 300), "Give DON!! (+1)");
check(await page.evaluate(da => S.chars[0].d === 1 && S.donActive === da - 1, da), "giving DON!! on your turn works");
await clear();

// ---- a card's ability that's left to the player opens the tools its wording names ----
await page.evaluate(() => { const ab = normFx({abilities: [{t: "main", text: "[Main] Draw 1 card and add 1 card from the top of your deck to the top of your Life cards.", steps: [{a: "other", text: "Draw 1 card and add 1 card from the top of your deck to the top of your Life cards."}]}]}).ab[0]; fxEnqueue(fxJob({c: "OP01-016", n: "Nami"}, ab)); });
check(/Do this one yourself/.test(await panel()), "the ability is left to the player");
s0 = await snap();
await pick(() => openActMenu("deck", 300, 300), "Draw a card");
await pick(() => openActMenu("deck", 300, 300), "Add top card to Life");
let s1 = await snap();
check(s1.h === s0.h + 1 && s1.lf === s0.lf + 1, "while it's being done, drawing and adding Life from the deck work");
await pick(() => openActMenu("dondeck", 300, 300), "Add 1 DON!! (active)");
await pick(() => openCardMenu("ch:0", 300, 300), "Rest");
check(same(await snap(), s1) && /doesn't let you do that/.test(await toastText()), "tools the ability doesn't name stay locked");
await page.evaluate(() => doAction("fxskip"));
await pick(() => openActMenu("deck", 300, 300), "Draw a card");
check(same(await snap(), s1) && !await page.evaluate(() => fxCur), "once the ability is done, drawing is locked again");

// a look at the deck from an effect only lets you take what the effect allows
await page.evaluate(() => { const t = "Look at 5 cards from the top of your deck; reveal up to 1 [Nobody At All] and add it to your hand. Then, place the rest at the bottom of your deck in any order."; const ab = normFx({abilities: [{t: "onPlay", text: "[On Play] " + t, steps: [{a: "look", n: 5, text: t}]}]}).ab[0]; fxEnqueue(fxJob({c: "OP01-016", n: "Nami"}, ab)); doAction("fxlook"); });
check(await page.evaluate(() => modal && modal.type === "peek" && modal.lim && modal.fx), "the effect opens the top 5");
s0 = await snap();
await pick(() => openCardMenu("dk:0", 300, 300), "Add to hand");
check((await snap()).h === s0.h && /doesn't let you take that card/.test(await toastText()), "a card the effect doesn't allow can't be taken");
await pick(() => openCardMenu("dk:0", 300, 300), "Put on bottom of deck");
check(await page.evaluate(n => S.deck.length === n, s0.dk), "putting a looked-at card on the bottom is allowed");
await clear();

// ---- a step the opponent carries out reaches their side ----
await page.evaluate(() => { const c = {c: "OP07-090", n: nameOf("OP07-090")}; fxEnqueue(fxJob(c, fxAb("OP07-090").find(a => a.t === "onPlay"))); doAction("fxgo"); });
await page.waitForTimeout(600);
check(/Do this one yourself/.test(await panel()) && await page.evaluate(() => !!(S.mf && S.mf.c === "OP07-090")), "\"your opponent draws 1 card\" is sent to the opponent");
const relay = await page.evaluate(() => botSide(() => (S.pfx || []).map(p => p.st.text)));
console.log("opponent gets", JSON.stringify(relay));
check(relay.some(t => /your opponent draws 1 card/i.test(t)), "the opponent's side gets it as an effect to do");
await page.evaluate(() => doAction("fxskip"));
await clear();
// and from the other side: the opponent's OP11-072 asks you to put 2 cards from your trash on the bottom of your deck
await page.evaluate(() => { S.trash.unshift({c: "OP01-015", n: nameOf("OP01-015")}); oppM.mf = {c: "OP11-072", a: 0, s: 2, n: 4242}; applyMarkReqs(); pendFx(); render(); });
check(await page.evaluate(() => !!(fxCur && fxCur.forced && fxCur.manual && /trash at the bottom/.test(fxCur.text))), "the opponent's effect shows up for you to carry out, with no Cancel");
check(await page.evaluate(() => fairMove("tr:0", "deckbot") && !fairMove("hand:0", "trash")), "it opens moving trash cards to the deck, and nothing else");
await clear();

// friends only tables and practice keep every tool
await page.evaluate(() => { S.pubt = false; commit(); });
s0 = await snap();
await pick(() => openActMenu("dondeck", 300, 300), "Add 1 DON!! (active)");
check((await snap()).dd === s0.dd - 1, "at a Friends only table the DON!! deck menu works as before");

await page.screenshot({ path: `${OUT}/fair.png` });
check(!errs.length, "no page errors");
if (errs.length) console.log(errs);
await app.close();
console.log(fail ? `${fail} FAILED` : "all passed");
process.exit(fail ? 1 : 0);
