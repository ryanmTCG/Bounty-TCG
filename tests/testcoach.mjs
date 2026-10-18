import { _electron as electron } from "playwright-core";
import fs from "fs";
// Coach hints: in a practice game against the computer, Hint asks the Master computer's planning what it would do in
// your seat (keep or mulligan, plays, DON!!, attacks, defending) and lights up the cards. It never acts for you.
const OUT = process.argv[2] || "shots-coach";
fs.mkdirSync(OUT, { recursive: true });
const prof = "/tmp/bounty-prof-coach"; fs.rmSync(prof, { recursive: true, force: true });
const app = await electron.launch({ executablePath: "node_modules/electron/dist/electron", args: ["--no-sandbox", "dist/kit/app"], env: { ...process.env, BOUNTY_PROFILE: prof } });
const page = await app.firstWindow(); const errs = [];
page.on("pageerror", e => errs.push(String(e)));
page.on("console", m => { if (m.type() === "error" && !/peerjs\.com|ERR_CONNECTION|40[034]/.test(m.text())) errs.push(m.text()); });
await page.setViewportSize({ width: 1280, height: 900 }).catch(() => {});
await page.waitForLoadState("load"); await page.waitForTimeout(1500);
let fail = 0;
const check = (ok, msg) => { console.log(ok ? "ok  " : "FAIL", msg); if (!ok) fail++; };
const wait = ms => page.waitForTimeout(ms);
const deck = ["OP01-013","OP01-016","OP01-024","OP01-014","OP01-015","OP01-017","OP01-018","OP01-019","OP01-020","OP01-021","OP01-022","OP01-025","OP01-026"].map(c => "4x" + c).join("\n");
const hint = async () => { await page.click('[data-do="hint"]'); await wait(300); return page.evaluate(() => ({t: [...document.querySelectorAll("#coach p:not(.cstep)")].map(p => p.textContent), hl: document.querySelectorAll(".coachhl").length, shown: !document.querySelector("#coach").hidden})); };

check(await page.evaluate(() => typeof hintOk === "function" && !hintOk()), "no hints outside a practice game");
{ const b = await page.$('[data-do="homeplay"]'); if (b && await b.isVisible()) { await b.click(); await wait(300); } }
await page.click('[data-do="homepractice"]'); await page.waitForTimeout(300); await page.click('[data-do="homebot"]'); await wait(1000);
await page.fill("#f-nick", "Ryan"); await page.fill("#f-leader", "OP01-001"); await page.fill("#f-deck", deck);
await page.click('[data-do="vsbot"]'); await wait(800);
await page.evaluate(() => { TUT = null; PR.roll = [6, 1]; practiceFirst(0); }); await wait(2000);
check(await page.isVisible('[data-do="hint"]'), "the Hint button shows in a practice game");

// opening hand
await page.evaluate(() => { const ch = [...CARDDB.keys()].filter(c => /^OP01-/.test(c) && CARDDB.get(c).t === "Character" && CARDDB.get(c).k >= 5); S.deck.push(...S.hand.splice(0)); S.hand = ch.slice(0, 5).map(c => ({c, n: nameOf(c), u: Math.random()})); S.mull = false; render(); });
const h0 = await hint();
console.log("pre", JSON.stringify(h0));
check(h0.shown && /^Mulligan: only 0/.test(h0.t[0]) && h0.hl === 1, "a hand with no cheap Characters gets told to mulligan, with the button lit");
await page.click('[data-do="keep"]'); await wait(1500);
check(await page.evaluate(() => document.querySelector("#coach").hidden), "the hint goes away once the board changes");

// your turn: 5 DON!!, Characters costing 4, 3 and 2 in hand
const cards = await page.evaluate(() => [4, 3, 2].map(k => [...CARDDB.keys()].find(c => /^OP0[5-9]-/.test(c) && (CARDDB.get(c) || {}).t === "Character" && CARDDB.get(c).k === k && !fxAb(c).length && !isBlocker(c))));
await page.evaluate(cs => { S.phase = "play"; S.myTurn = true; S.atk = null; S.turn = 3; S.chars = []; S.stage = null; S.hand = cs.map(c => ({c, n: nameOf(c), u: Math.random()})); S.donActive = 5; S.donRested = 0; S.leader.r = false; S.leader.d = 0; S.leader.pm = 0; commit(); }, cards);
const h1 = await hint();
console.log("main", JSON.stringify(h1));
check(/^Play .+, then .+: that uses 5 of your 5 active DON!!/.test(h1.t[0]) && h1.hl >= 2, "it suggests the 3 and the 2, using all 5 DON!!, and lights them up");
check(await page.evaluate(() => S.hand.length === 3 && S.chars.length === 0 && S.donActive === 5), "the hint doesn't play anything for you");
await page.screenshot({ path: OUT + "/hint.png" });
await page.click('[data-do="hintclose"]'); await wait(200);
check(await page.evaluate(() => document.querySelector("#coach").hidden && !document.querySelector(".coachhl")), "Close hides it");

// attacking: no cards in hand, the computer at 5 Life
await page.evaluate(() => { S.hand = []; S.leader.pm = 2000; commit(); });
const h2 = await hint();
console.log("attack", JSON.stringify(h2));
check(h2.t.some(t => /^Attack their Leader with/.test(t)), "with a strong enough Leader it says to attack their Leader");
// a winning turn: the computer has no Life
await page.evaluate(() => { const B = PR.sides[1].S; B.trash.push(...B.life.splice(0)); B.chars = [];
  PR.pres[1] = JSON.parse(JSON.stringify((() => { practiceStash(); practiceLoad(1); const p = pubFull(); practiceStash(); practiceLoad(0); return p; })())); oppM = oppModel(PR.pres[1]); S.leader.pm = 1000; commit(); });
const h3 = await hint();
console.log("lethal", JSON.stringify(h3));
check(/^You can win this turn/.test(h3.t[0]), "when you can win it says so");

// defending: the computer attacks your Leader at 1 Life, and you have Counter cards
await page.evaluate(() => { const c2 = [...CARDDB.keys()].find(k => /^OP0/.test(k) && (CARDDB.get(k) || {}).ctr === 2000);
  const B = PR.sides[1].S; for (let i = 0; i < 4; i++) B.life.push(B.deck.shift());
  S.trash.push(...S.life.splice(0)); S.life.push(S.deck.shift()); S.chars = []; S.hand = [c2, c2].map(c => ({c, n: nameOf(c), u: Math.random()})); S.leader.pm = 0; S.leader.d = 0;
  S.myTurn = false; S.atk = null; commit(); PR.pres[0] = JSON.parse(JSON.stringify(pubFull()));
  botSide(() => { S.myTurn = true; S.atk = null; S.turn = 6; S.leader.r = false; S.leader.pm = 1000; attackWith("ld", "ld"); return 0; }); });
await wait(500);
const h4 = await hint();
console.log("defend", JSON.stringify(h4));
check(await page.evaluate(() => defending()), "the computer is attacking");
check(/^Counter with .+ \(\+2000\): it needs \+2000 .+at 1 Life/.test(h4.t[0]) && h4.hl === 1, "at 1 Life it says which one Counter card to use");
check(await page.evaluate(() => S.hand.length === 2 && S.life.length === 1), "and leaves the choice to you");

console.log("errors", JSON.stringify(errs));
check(!errs.length, "no page errors");
await app.close();
console.log(fail ? `${fail} FAILED` : "all passed");
process.exit(fail ? 1 : 0);
