import { _electron as electron } from "playwright-core";
import fs from "fs";
// Deck tools: lists from deck sites and simulators import with their Leader, the builder exports the same
// "1xOP01-001 / 4xOP01-016" format, off-color cards are flagged, and the stats count Blockers and Triggers.
const OUT = process.argv[2] || "shots-deck";
fs.mkdirSync(OUT, { recursive: true });
const prof = "/tmp/bounty-prof-deck"; fs.rmSync(prof, { recursive: true, force: true });
const app = await electron.launch({ executablePath: "node_modules/electron/dist/electron", args: ["--no-sandbox", "dist/kit/app"], env: { ...process.env, BOUNTY_PROFILE: prof } });
const page = await app.firstWindow();
const errs = [];
page.on("pageerror", e => errs.push(String(e)));
await page.setViewportSize({ width: 1500, height: 950 }).catch(() => {});
await page.waitForLoadState("load");
await page.waitForTimeout(1500);
let fail = 0;
const check = (ok, msg) => { console.log(ok ? "ok  " : "FAIL", msg); if (!ok) fail++; };

// the formats people paste
const pl = await page.evaluate(() => [
  "4xOP01-016", "OP01-016 x4", "4 OP01-016", "4 Nami (OP01-016)", "4 Nami OP01-016", "Nami OP01-016 x3", "4xOP01-013 Sanji", "1xOP01-001"
].map(t => parseLines(t)[0]));
console.log("parse", JSON.stringify(pl));
check(pl.slice(0, 5).every(e => e.code === "OP01-016" && e.count === 4), "counts read in every common line format");
check(pl[3].name === "Nami" && pl[4].name === "Nami" && pl[5].name === "Nami" && pl[5].count === 3, "a name before the card number is kept");
check(pl[6].name === "Sanji" && pl[7].count === 1, "names after the number still work");

const sim = "1xOP01-001\n4xOP01-016\n4xOP01-013\n4xOP01-004";
const sp = await page.evaluate(t => splitLeader(t), sim);
check(sp.leader && sp.leader.code === "OP01-001" && !/OP01-001/.test(sp.deck), "a 1x Leader line is taken out of the main deck");
const sp2 = await page.evaluate(() => splitLeader("// Leader: OP01-060 Doflamingo\n4xOP01-016"));
check(sp2.leader && sp2.leader.code === "OP01-060" && sp2.deck.trim() === "4xOP01-016", "a Leader: line is read as the Leader");

// builder: paste a simulator list
await page.click('[data-do="homebuilder"]');
await page.waitForTimeout(800);
await page.evaluate(() => { const d = document.querySelector("#bd-paste").closest("details"); if (d) d.open = true; });
await page.fill("#bd-paste", sim);
await page.click('[data-do="bdimport"]');
await page.waitForTimeout(400);
const b1 = await page.evaluate(() => ({leader: BD.leader && BD.leader.c, total: bdTotal(), has: BD.cards.has("OP01-001"), text: document.querySelector("#bd-text").value, toast: document.querySelector("#toast").textContent}));
console.log("import", JSON.stringify(b1));
check(b1.leader === "OP01-001" && !b1.has && b1.total === 12, "the builder sets the Leader from the list and keeps it out of the deck");
check(b1.text === "1xOP01-001\n4xOP01-004\n4xOP01-013\n4xOP01-016", "the deck text is the common format, Leader first");
check(/OP01-001 as Leader/.test(b1.toast), "the import says which Leader it set");

// stats: Blockers and Triggers
const st = await page.evaluate(() => {
  const nums = [...document.querySelectorAll("#bd-anal .bdn div")].map(e => e.innerText.replace(/\s+/g, " "));
  let blk = 0, trg = 0; for (const [k, v] of BD.cards) { if (isBlocker(k)) blk += v.count; if (fxAb(k).some(a => a.t === "trigger")) trg += v.count; }
  return {nums, blk, trg};
});
console.log("stats", JSON.stringify(st));
check(st.nums.some(t => t === `${st.blk} / ${st.trg} Blockers / Triggers`), "the stats count Blockers and Triggers");

// off-color cards
const blue = await page.evaluate(() => [...CARDDB.keys()].find(k => /^OP01-/.test(k) && (CARDDB.get(k) || {}).c === "Blue" && (CARDDB.get(k) || {}).t === "Character"));
await page.evaluate(code => bdAdd(code, 2), blue);
await page.waitForTimeout(300);
const chips = await page.evaluate(() => [...document.querySelectorAll("#bd-deck .bd-stats .chip")].map(e => [e.textContent, e.title]));
console.log("chips", blue, JSON.stringify(chips));
check(chips.some(([t, ti]) => /1 not in the Leader's color/.test(t) && ti.includes(blue)), "a card that doesn't share the Leader's color is flagged");
const ill = await page.evaluate(code => deckIllegal({leader: "OP01-001", deck: "4xOP01-016\n2x" + code}, "ext"), blue);
check(ill.length === 1 && ill[0].startsWith(blue), "off-color cards make the deck illegal for lobbies and ranked");
check((await page.evaluate(() => deckIllegal({leader: "OP01-001", deck: "4xOP01-016\n4xOP01-004"}, "ext"))).length === 0, "an on-color deck stays legal");
await page.screenshot({ path: OUT + "/builder.png" });

// setup form: the pasted list's Leader fills the Leader field
await page.click('[data-do="bdclose"]');
await page.waitForTimeout(300);
await page.evaluate(() => openSetup());
await page.waitForTimeout(300);
await page.fill("#f-leader", "");
await page.fill("#f-deck", sim);
const f = await page.evaluate(() => { const r = readDeckFields(); return {leader: r.leader, deck: r.deck}; });
console.log("setup", JSON.stringify(f));
check(/^OP01-001/.test(f.leader) && !/OP01-001/.test(f.deck), "the setup form takes the Leader out of a pasted list");
check(!errs.length, "no page errors" + (errs.length ? ": " + errs.slice(0, 3).join(" / ") : ""));
await app.close();
console.log(fail ? `${fail} FAILED` : "all passed");
process.exit(fail ? 1 : 0);
