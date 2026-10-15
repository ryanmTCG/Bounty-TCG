import { _electron as electron } from "playwright-core";
import fs from "fs";
const OUT = process.argv[2] || "shots-legal";
fs.mkdirSync(OUT, { recursive: true });
const prof = "/tmp/bounty-prof-legal"; fs.rmSync(prof, { recursive: true, force: true });
const app = await electron.launch({ executablePath: "node_modules/electron/dist/electron", args: ["--no-sandbox", "dist/kit/app"], env: { ...process.env, BOUNTY_PROFILE: prof } });
const page = await app.firstWindow();
const errs = [];
page.on("pageerror", e => errs.push(String(e)));
page.on("console", m => { if (m.type() === "error" && !/0\.peerjs\.com/.test(m.text())) errs.push(m.text()); });   // no internet here: the lobby can't reach the public PeerJS server
await page.setViewportSize({ width: 1500, height: 950 }).catch(() => {});
await page.waitForLoadState("load");
await page.waitForTimeout(1500);
await page.click('[data-do="homebuilder"]');
await page.waitForTimeout(800);
const count = () => page.evaluate(() => {
  const found = [...document.querySelectorAll("#bd-lib .empty")].map(e => e.textContent).find(t => /found|left/.test(t)) || "";
  return { found, ban: document.querySelectorAll("#bd-lib .legal.ban").length, rot: document.querySelectorAll("#bd-lib .legal.rot").length, soon: document.querySelectorAll("#bd-lib .legal.soon").length };
});
// unit checks on the legality rules
const rules = await page.evaluate(() => Object.fromEntries(["OP01-001", "OP01-016", "OP01-039", "OP04-118", "ST09-001", "ST10-001", "ST10-002", "P-039", "P-040", "OP06-047", "OP14-020", "OP05-001", "EB01-001", "OP03-122"].map(c => [c, legalOf(c)])));
console.log("rules", JSON.stringify(rules));
// all cards: group off, sort by set, pick OP01 to see rotated tags
await page.check("#bd-showban"); await page.check("#bd-showrot");
await page.selectOption("#bd-set", "OP01");
await page.waitForTimeout(400);
console.log("OP01 shown", JSON.stringify(await count()));
await page.screenshot({ path: OUT + "/op01-all.png" });
await page.uncheck("#bd-showrot");
await page.waitForTimeout(400);
console.log("OP01 rotated hidden", JSON.stringify(await count()), await page.evaluate(() => [...document.querySelectorAll("#bd-lib [data-lib]")].map(e => e.dataset.lib).join(" ")));
await page.screenshot({ path: OUT + "/op01-norot.png" });
await page.check("#bd-showrot");
await page.selectOption("#bd-set", "OP06");
await page.waitForTimeout(400);
console.log("OP06 shown", JSON.stringify(await count()));
await page.fill("#bd-q", "pudding");
await page.waitForTimeout(400);
await page.screenshot({ path: OUT + "/op06-pudding.png" });
await page.uncheck("#bd-showban");
await page.waitForTimeout(400);
console.log("pudding with banned hidden", JSON.stringify(await count()), await page.evaluate(() => [...document.querySelectorAll("#bd-lib [data-lib]")].map(e => e.dataset.lib).join(" ")));
await page.check("#bd-showban");
await page.fill("#bd-q", "");
await page.selectOption("#bd-set", "");
await page.waitForTimeout(400);
console.log("all sets shown", JSON.stringify(await count()));
await page.uncheck("#bd-showban"); await page.uncheck("#bd-showrot");
await page.waitForTimeout(400);
console.log("all sets, both hidden", JSON.stringify(await count()));
await page.check("#bd-showban"); await page.check("#bd-showrot");
// preview sets: legal only at Standard + previews tables (and Casual) until their English release
const fails = [];
const check = (name, ok) => { console.log((ok ? "ok   " : "FAIL ") + name); if (!ok) fails.push(name); };
const pv = await page.evaluate(() => {
  RELEASES.OP18 = "2099-01-01"; RELEASES.EB05 = "2000-01-01";
  const deck = {leader: "OP18-001", deck: "4xOP18-003\n4xOP01-013"};
  return {op18: legalOf("OP18-003"), eb05: legalOf("EB05-001"), sets: preSets(), tag: legalTag("OP18-003"), note: legalNote("OP18-003"),
    std: deckIllegal(deck, "std"), pre: deckIllegal(deck, "pre"), ext: deckIllegal(deck, "ext"), any: deckIllegal(deck, "any"),
    stdNote: illegalNote(deckIllegal(deck, "std"), "std"), lb: cleanLobby({c: "lobby-abc", n: "x", h: "y", f: "pre"}).f};
});
console.log("previews", JSON.stringify(pv));
check("an OP18 card is a preview before its date", pv.op18 === "pre" && /PREVIEW/.test(pv.tag) && /from Jan 1/.test(pv.note));
check("a released set isn't a preview", pv.eb05 === "" && pv.sets.join() === "OP18");
check("previews aren't legal in Standard or Extra", pv.std.includes("OP18-003") && pv.std.includes("OP18-001") && pv.ext.includes("OP18-003") && /Standard \+ previews tables/.test(pv.stdNote));
check("previews are legal at Standard + previews tables", !pv.pre.includes("OP18-003") && !pv.pre.includes("OP18-001") && pv.pre.includes("OP01-013") && !pv.any.length);
check("a lobby listing keeps the previews format", pv.lb === "pre");
await page.evaluate(() => { bdLeader("OP18-001"); bdAdd("OP18-003", 2); });
await page.waitForTimeout(300);
const pchip = await page.evaluate(() => [...document.querySelectorAll("#bd-deck .bd-stats .chip.pre")].map(e => e.textContent).join());
check("the deck editor counts previews", pchip === "2 previews");
await page.selectOption("#bd-set", "OP18"); await page.waitForTimeout(400);
const shownPre = await page.evaluate(() => document.querySelectorAll("#bd-lib .legal.pre").length);
await page.uncheck("#bd-showpre"); await page.waitForTimeout(400);
const hiddenPre = await page.evaluate(() => document.querySelectorAll("#bd-lib [data-lib]").length);
check("the Previews filter hides preview cards", shownPre > 0 && hiddenPre === 0);
await page.check("#bd-showpre"); await page.selectOption("#bd-set", "");
await page.evaluate(() => { BD.cards.clear(); BD.leader = null; RELEASES.OP18 = "2026-11-20"; RELEASES.EB05 = "2026-10-30"; renderBdDeck(); });
// deck panel warnings
await page.evaluate(() => {
  bdLeader("OP11-040");
  bdAdd("OP11-067", 2); bdAdd("OP06-047", 1); bdAdd("OP01-013", 4); bdAdd("OP01-016", 4); bdAdd("OP14-020", 1); bdAdd("OP05-002", 4);
});
await page.waitForTimeout(400);
console.log("deck chips", JSON.stringify(await page.evaluate(() => [...document.querySelectorAll("#bd-deck .bd-stats .chip")].map(e => [e.textContent, e.title]))));
console.log("deck stats", JSON.stringify(await page.evaluate(() => ({open: (document.querySelector("#bd-anal") || {}).open, bars: [...document.querySelectorAll("#bd-anal .bdc-n")].map(e => e.textContent), nums: [...document.querySelectorAll("#bd-anal .bdn div")].map(e => e.innerText.replace(/\s+/g, " ")), expect: (() => { let k = 0, c = 0; for (const [code, v] of BD.cards) { const e = CARDDB.get(code) || {}; k += v.count; c += (e.ctr || 0) * v.count; } return {cards: k, ctr: c}; })() }))));
console.log("deck labels", JSON.stringify(await page.evaluate(() => [...document.querySelectorAll("#bd-deck .bdctl span")].map(e => [e.textContent, e.className, e.title]))));
await page.check("#bd-showban"); await page.check("#bd-showrot");
await page.selectOption("#bd-set", "OP01");
await page.waitForTimeout(400);
await page.screenshot({ path: OUT + "/deck.png" });
// narrow window
await page.setViewportSize({ width: 420, height: 860 }).catch(() => {});
await page.waitForTimeout(500);
await page.screenshot({ path: OUT + "/narrow.png" });
console.log("errors", JSON.stringify(errs));
if (fails.length || errs.length) process.exitCode = 1;
await app.close();
