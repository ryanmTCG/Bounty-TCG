import { _electron as electron } from "playwright-core";
import fs from "fs";
// Sealed: open 6 packs of a set, pick a Leader, build 30 to 50 cards from the pool, play the computer or save it.
const OUT = process.argv[2] || "shots-sealed";
fs.mkdirSync(OUT, { recursive: true });
const prof = "/tmp/bounty-prof-sealed"; fs.rmSync(prof, { recursive: true, force: true });
const app = await electron.launch({ executablePath: "node_modules/electron/dist/electron", args: ["--no-sandbox", "dist/kit/app"], env: { ...process.env, BOUNTY_PROFILE: prof } });
const page = await app.firstWindow(); const errs = [];
page.on("pageerror", e => errs.push(String(e)));
page.on("console", m => { if (m.type() === "error" && !/peerjs\.com|ERR_CONNECTION|40[034]|raw\.githubusercontent|Failed to fetch|ERR_/.test(m.text())) errs.push(m.text()); });
await page.setViewportSize({ width: 1280, height: 900 }).catch(() => {});
await page.waitForLoadState("load"); await page.waitForTimeout(3500);
let fail = 0;
const check = (ok, msg) => { console.log(ok ? "ok  " : "FAIL", msg); if (!ok) fail++; };
const wait = ms => page.waitForTimeout(ms);

const sets = await page.evaluate(() => slSets());
console.log("sets", sets.join(" "));
check(sets.includes("OP01") && sets.includes("OP16") && sets.includes("EB01") && !sets.includes("ST01") && sets[0].startsWith("OP"), "booster sets with rarity data can be opened, newest first");
// packs: 12 cards each, by rarity, all from the set, and the same seed opens the same packs
const pk = await page.evaluate(() => { const a = slOpen("OP05", 1234), b = slOpen("OP05", 1234), c = slOpen("OP05", 99); const r = x => (CARDDB.get(x) || {}).r;
  const packs = []; for (let i = 0; i < 6; i++) packs.push(a.slice(i * 12, i * 12 + 12));
  return {n: a.length, same: a.join() === b.join(), diff: a.join() !== c.join(), set: a.every(x => x.startsWith("OP05-")), noLd: a.every(x => r(x) !== "L"),
    shape: packs.every(p => p.slice(0, 7).every(x => r(x) === "C") && p.slice(7, 10).every(x => r(x) === "UC") && r(p[10]) === "R" && ["R", "SR", "SEC"].includes(r(p[11])))}; });
console.log("packs", JSON.stringify(pk));
check(pk.n === 72 && pk.same && pk.diff && pk.set && pk.noLd && pk.shape, "6 packs of 12: 7 Common, 3 Uncommon, a Rare and a hit, all from the set, no Leaders");
const hits = await page.evaluate(() => { let sr = 0, sec = 0; for (let s = 1; s <= 200; s++) { const p = slOpen("OP09", s); for (let i = 11; i < 72; i += 12) { const r = CARDDB.get(p[i]).r; if (r === "SR") sr++; if (r === "SEC") sec++; } } return {sr, sec, packs: 1200}; });
console.log("hits", JSON.stringify(hits));
check(hits.sr > 300 && hits.sr < 500 && hits.sec > 20 && hits.sec < 80, "about 1 pack in 3 has a Super Rare, and 1 in 25 a Secret Rare");

// from the Practice page
await page.evaluate(() => openHome("practice")); await wait(300);
await page.click('[data-do="sealed"]'); await wait(300);
check(await page.evaluate(() => modal.type === "sealed" && !!$("#sl-set")), "Practice has Sealed packs, which asks for a set");
await page.selectOption("#sl-set", "OP05"); await page.click('[data-do="slopen"]'); await wait(400);
// ripping the packs: a sealed pack first, torn by a swipe across its top
const r0 = await page.evaluate(() => ({rip: !!$("#rip") && !$("#rip").hidden, pack: !!$("#rip .rippack"), head: $("#rip .riphead").textContent, cards: document.querySelectorAll("#rip .ripc").length, pool: !!SL && SL.pool.length, toast: $("#toast").hidden ? "" : $("#toast").textContent}));
console.log("rip", JSON.stringify(r0));
check(r0.rip && r0.pack && /OP05/.test(r0.head) && /Pack 1 of 6/.test(r0.head) && r0.cards === 0 && r0.pool === 72 && !/opened 6 packs/.test(r0.toast), "opening shows a sealed pack to tear, with the pool already kept and nothing spoiled");
await page.screenshot({ path: OUT + "/pack.png" });
const pb = await page.locator("#rip .rippack").boundingBox();
await page.mouse.move(pb.x + 10, pb.y + 12); await page.mouse.down();
for (let i = 1; i <= 10; i++) await page.mouse.move(pb.x + 10 + i * pb.width * .08, pb.y + 14);
await page.mouse.up(); await wait(900);
const r1 = await page.evaluate(() => ({n: document.querySelectorAll("#rip .ripc").length, up: document.querySelectorAll("#rip .ripc.up").length, codes: [...document.querySelectorAll("#rip .ripc .ripf .card b")].map(b => b.textContent).join(), want: SL.pool.slice(0, 12).join()}));
console.log("torn", JSON.stringify(r1));
check(r1.n === 12 && r1.up === 0 && r1.codes === r1.want, "swiping tears it open: the pack's 12 cards, face down, in pack order");
await page.screenshot({ path: OUT + "/facedown.png" });
await page.click('#rip .ripc[data-k="0"]'); await wait(700);
const r2 = await page.evaluate(() => ({up: document.querySelectorAll("#rip .ripc.up").length, next: !!$('#rip [data-do="rip:next"]')}));
check(r2.up === 1 && !r2.next, "clicking a card flips it");
// hovering a flipped card zooms it over the screen
const fb = await page.locator('#rip .ripc[data-k="0"]').boundingBox();
await page.mouse.move(fb.x + fb.width / 2, fb.y + fb.height / 2); await wait(400);
check(await page.evaluate(() => !!$("#preview") && $("#preview").querySelector("b").textContent === SL.pool[0]), "hovering a flipped card zooms in on it");
await page.click('[data-do="rip:all"]'); await wait(2600);
const r3 = await page.evaluate(() => ({up: document.querySelectorAll("#rip .ripc.up").length, hits: document.querySelectorAll("#rip .ripc.hit").length, want: SL.pool.slice(0, 12).filter(ripHit).length, next: ($('#rip [data-do="rip:next"]') || {}).textContent}));
console.log("flipped", JSON.stringify(r3));
check(r3.up === 12 && r3.hits === r3.want && /Next pack \(2 of 6\)/.test(r3.next), "Flip them all turns the rest over, the hits shine, and Next pack comes up");
await page.screenshot({ path: OUT + "/flipped.png" });
await page.click('[data-do="rip:next"]'); await wait(300);
const r4 = await page.evaluate(() => ({pack: !!$("#rip .rippack"), head: $("#rip .riphead").textContent}));
check(r4.pack && /Pack 2 of 6/.test(r4.head), "the next pack comes sealed");
await page.click('#rip .rippack'); await wait(900);
check(await page.evaluate(() => document.querySelectorAll("#rip .ripc").length === 12 && $("#rip .ripc .ripf .card b").textContent === SL.pool[12]), "clicking a pack tears it too, and it holds the next 12 cards");
await page.click('[data-do="rip:skip"]'); await wait(400);
check(await page.evaluate(() => !RIP && $("#rip").hidden), "Skip to your cards closes the packs");
const st = await page.evaluate(() => ({n: SL.pool.length, set: SL.set, tiles: document.querySelectorAll(".slpool .slc").length, lds: [...document.querySelectorAll("#sl-ld option")].length - 1, toast: $("#toast").textContent, stored: !!localStorage.getItem("bounty:sealed")}));
console.log("opened", JSON.stringify(st));
check(st.n === 72 && st.set === "OP05" && st.tiles > 20 && st.lds >= 4 && /opened 6 packs of OP05/.test(st.toast) && st.stored, "opening shows the pool, the set's Leaders, and says what you pulled");
await page.screenshot({ path: OUT + "/pool.png" });
// hovering a card in the pool zooms it over the sealed screen (the docked zoom is behind it)
const sb = await page.locator(".slpool .slc").first().boundingBox();
await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2); await wait(400);
check(await page.evaluate(() => !!$("#preview") && $("#preview").querySelector("b").textContent === $(".slpool .slc").dataset.do.slice(6)), "hovering a card in the pool zooms in on it");
await page.mouse.move(5, 5); await wait(200);
// a pack with a hit: the hit shines when it's flipped
await page.evaluate(() => { const keep = SL.pool; const sr = [...CARDDB].find(([c, e]) => c.startsWith("OP05-") && e.r === "SR")[0]; SL.pool = [...keep.slice(0, 11), sr]; ripStart(); SL.pool = keep; RIP.packs = [RIP.packs[0]]; ripTear(); });
await wait(800); await page.click('[data-do="rip:all"]'); await wait(2400);
check(await page.evaluate(() => document.querySelectorAll("#rip .ripc.hit").length === 1 && /See all your cards/.test($('#rip [data-do="rip:next"]').textContent)), "a Super Rare shines when it's flipped, and the last pack goes on to your cards");
await page.screenshot({ path: OUT + "/hit.png" });
await page.click('[data-do="rip:next"]'); await wait(300);
check(await page.evaluate(() => !RIP && modal.type === "sealed" && !!$(".slpool")), "after the last pack, the pool is there to build from");
// adding and taking out copies, limited by what you pulled
const one = await page.evaluate(() => SL.pool.find(c => SL.pool.filter(x => x === c).length === 1));
await page.click(`.slc[data-do="sladd:${one}"]`); await wait(150);
await page.click(`.slc[data-do="sladd:${one}"]`); await wait(150);
check(await page.evaluate(c => SL.dk[c] === 1 && /only pulled 1/.test($("#toast").textContent), one), "a card goes in up to the copies you pulled");
await page.click(`.slc[data-do="sladd:${one}"]`, { button: "right" }); await wait(150);
check(await page.evaluate(c => !SL.dk[c], one), "right-click takes one out");
check(await page.evaluate(() => $('[data-do="slplay"]').disabled && $('[data-do="slsave"]').disabled), "Play and Save wait for a Leader and 30 cards");
// auto-build
await page.click('[data-do="slauto"]'); await wait(300);
const ab = await page.evaluate(() => { const n = slCount(SL.dk), have = {}; for (const c of SL.pool) have[c] = (have[c] || 0) + 1;
  return {n, ld: SL.ld, ok: Object.entries(SL.dk).every(([c, k]) => k <= have[c]), lds: slLeaders("OP05").includes(SL.ld), on: Object.entries(SL.dk).filter(([c]) => colorsOf(c).some(x => colorsOf(SL.ld).includes(x))).reduce((a, [, k]) => a + k, 0), chip: $("#sl-n").textContent, enabled: !$('[data-do="slplay"]').disabled}; });
console.log("auto", JSON.stringify(ab));
check(ab.n >= 30 && ab.n <= 40 && ab.ok && ab.lds && ab.on >= ab.n / 2 && ab.enabled, "Auto-build picks a Leader from the set and 30 to 40 cards of the pool, mostly its colors");
// picking another Leader
await page.selectOption("#sl-ld", await page.evaluate(() => slLeaders("OP05").find(c => c !== SL.ld)));
await wait(200);
check(await page.evaluate(() => SL.ld !== "" && JSON.parse(localStorage.getItem("bounty:sealed")).ld === SL.ld), "the Leader can be changed and is kept");
// reload keeps the pool
await page.evaluate(() => { SL = null; openSealed(); }); await wait(300);
check(await page.evaluate(() => SL && SL.pool.length === 72 && slCount(SL.dk) >= 30), "the pool and deck come back after closing");
// save as a deck in the Sealed folder
await page.click('[data-do="slsave"]'); await wait(500);
check(await page.evaluate(() => DECKS.some(d => d.folder === "Sealed" && /^Sealed OP05/.test(d.name) && deckCount(d.deck) === slCount(SL.dk))), "Save as a deck puts it in a Sealed folder");
// play the computer: it opens its own packs
await page.click('[data-do="slplay"]'); await wait(1200);
const pl = await page.evaluate(() => { const me = S.deck.length + S.hand.length; const opp = botSide(() => ({n: S.deck.length + S.hand.length, ld: S.leader.card.c})); return {bot: PR && PR.bot, me, n: slCount(SL.dk), ld: S.leader.card.c, sl: SL.ld, opp, toast: $("#toast").textContent}; });
console.log("play", JSON.stringify(pl));
check(pl.bot && pl.me === pl.n && pl.ld === pl.sl && pl.opp.ld.startsWith("OP05-") && pl.opp.n >= 30 && !/rules call for 50/.test(pl.toast), "Play the computer starts with your sealed deck against the computer's own sealed deck, with no 50-card warning");
await page.screenshot({ path: OUT + "/table.png" });
// New packs starts over
await page.evaluate(() => { leaveRoom(); openSealed(); }); await wait(300);
await page.click('[data-do="slnew"]'); await wait(300);
check(await page.evaluate(() => !SL && !!$("#sl-set")), "New packs starts over");
// a bad saved pool is cleaned
check(await page.evaluate(() => { localStorage.setItem("bounty:sealed", JSON.stringify({set: "OP05", seed: 1, pool: ["OP05-010", "OP05-010", "<x>", "OP99-999"], ld: "OP01-001", dk: {"OP05-010": 9, "OP05-011": 2}})); const x = slLoad(); return x.pool.length === 2 && x.ld === "" && x.dk["OP05-010"] === 2 && !x.dk["OP05-011"]; }), "a saved pool is checked when it's read back");
// card data saved on this computer before rarities came (the card reader) still gets the bundled rarities and corrections
await page.evaluate(() => localStorage.setItem("bounty:db:v1", JSON.stringify({"names/OP05": {cards: {"OP05-001": {n: "Old name", c: "Red", t: "Leader"}, "OP05-999": {n: "My own card", c: "Red", t: "Character"}}}})));
await page.reload(); await page.waitForLoadState("load"); await wait(3500);
const old = await page.evaluate(() => ({sets: slSets(), n: CARDDB.get("OP05-001").n, r: CARDDB.get("OP05-001").r, mine: (CARDDB.get("OP05-999") || {}).n}));
console.log("saved card data", JSON.stringify(old));
check(old.sets.includes("OP05") && old.n !== "Old name" && old.r === "L" && old.mine === "My own card", "older card data saved on the computer doesn't hide the bundled rarities, and keeps its own extra cards");
console.log("errors", JSON.stringify(errs));
check(!errs.length, "no page errors");
await app.close();
console.log(fail ? `${fail} FAILED` : "all passed");
process.exit(fail ? 1 : 0);
