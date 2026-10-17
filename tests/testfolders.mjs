import { _electron as electron } from "playwright-core";
import fs from "fs";
// Deck folders and notes, and reading a deck from a link in the Deck editor.
const OUT = process.argv[2] || "shots-folders";
fs.mkdirSync(OUT, { recursive: true });
const prof = "/tmp/bounty-prof-folders"; fs.rmSync(prof, { recursive: true, force: true });
const app = await electron.launch({ executablePath: "node_modules/electron/dist/electron", args: ["--no-sandbox", "dist/kit/app"], env: { ...process.env, BOUNTY_PROFILE: prof } });
const page = await app.firstWindow(); const errs = [];
page.on("pageerror", e => errs.push(String(e)));
page.on("console", m => { if (m.type() === "error" && !/peerjs\.com|ERR_CONNECTION|40[034]/.test(m.text())) errs.push(m.text()); });
await page.setViewportSize({ width: 1280, height: 900 }).catch(() => {});
await page.waitForLoadState("load"); await page.waitForTimeout(1500);
let fail = 0;
const check = (ok, msg) => { console.log(ok ? "ok  " : "FAIL", msg); if (!ok) fail++; };
const wait = ms => page.waitForTimeout(ms);
const list = cs => cs.map(c => "4x" + c).join("\n").replace(/4x(\S+)$/, "2x$1");
const sabo = list(["OP05-003","OP05-004","OP05-006","OP05-007","OP05-009","OP05-010","OP05-011","OP05-013","OP05-015","OP05-016","OP05-017","OP05-018","OP05-019"]);
const zoro = list(["OP01-013","OP01-016","OP01-024","OP01-014","OP01-015","OP01-017","OP01-018","OP01-019","OP01-020","OP01-021","OP01-022","OP01-025","OP01-026"]);
await page.evaluate(([a, b]) => {
  localStorage.setItem("nakama:decks", JSON.stringify([{id: "d1", name: "Sabo", leader: "OP05-001 Sabo", deck: a, life: 5, folder: "Tournament", notes: "Mulligan for OP05-006.\nSide plan vs Purple."}, {id: "d2", name: "Old Zoro", leader: "OP01-001 Roronoa Zoro", deck: b, life: 5}, {id: "d3", name: "Zoro test", leader: "OP01-001 Roronoa Zoro", deck: b, life: 5, folder: "Fun"}]));
  localStorage.setItem("nakama:setup", JSON.stringify({nick: "Ryan", leader: "OP05-001 Sabo", deck: a, life: 5}));
}, [sabo, zoro]);
await page.reload(); await wait(1500);
// the saved decks list in Deck & room groups by folder and shows the first line of the notes
await page.evaluate(() => openSetup()); await wait(500);
const sv = await page.evaluate(() => ({heads: [...document.querySelectorAll("#saved-list .dfolder")].map(e => e.firstChild.textContent), notes: [...document.querySelectorAll("#saved-list .dnote")].map(e => e.textContent)}));
console.log("saved", JSON.stringify(sv));
check(sv.heads.join("|") === "Fun|Tournament|No folder", "saved decks are grouped by folder, A to Z, with the ones in no folder last");
check(sv.notes.length === 1 && sv.notes[0] === "Mulligan for OP05-006.", "a deck's row shows the first line of its notes");
await page.screenshot({ path: OUT + "/saved.png" });
// the drop-down groups them too
await page.evaluate(() => { closeModal(); openLobbies(); }); await wait(400);
const grp = await page.evaluate(() => [...document.querySelectorAll("#deckpick optgroup")].map(g => g.label + ":" + g.children.length));
console.log("optgroups", JSON.stringify(grp));
check(grp.includes("Tournament:1") && grp.includes("Fun:1"), "the deck drop-down has a group per folder");
// the Deck editor loads, edits and saves the folder and notes
await page.evaluate(() => { closeModal(); openBuilder(); bdLoadSaved("d1"); }); await wait(400);
const bd = await page.evaluate(() => ({f: $("#bd-folder").value, n: $("#bd-notes").value, open: $("#bd-notesbox").open, dl: [...document.querySelectorAll("#bd-folders option")].map(o => o.value)}));
console.log("builder", JSON.stringify(bd));
check(bd.f === "Tournament" && /Side plan/.test(bd.n) && bd.open && bd.dl.includes("Fun"), "the Deck editor shows a deck's folder and notes, and suggests your folders");
await page.evaluate(() => { $("#bd-folder").value = "Locals"; $("#bd-notes").value = "Keep 2 counters."; }); await page.evaluate(() => bdSave()); await wait(400);
const d1 = await page.evaluate(() => DECKS.find(d => d.id === "d1"));
check(d1.folder === "Locals" && d1.notes === "Keep 2 counters.", "saving keeps the new folder and notes");
await page.screenshot({ path: OUT + "/builder.png" });
// reading a deck from a link
const r1 = await page.evaluate(() => deckFromLink("https://deckgen.example/?dg=1nOP05-001a4nOP05-003a4nOP05-004a4nOP05-006a4nOP05-007a4nOP05-009a4nOP05-010a4nOP05-011a4nOP05-013a4nOP05-015a4nOP05-016a4nOP05-017a4nOP05-018a2nOP05-019"));
check(r1.l === "OP05-001" && r1.n === 50, "a link that carries the list in its address is read without opening the page");
const r2 = await page.evaluate(async () => {
  window.deskFetch = async u => ({status: 200, text: `<html><h1>Sabo deck</h1><ul><li>1x OP05-001 Sabo</li><li>4x OP05-003</li><li>4 x OP05-004</li><li>OP05-006 x4</li></ul><h2>Another deck</h2><li>1x OP01-001</li><li>4x OP01-013</li></html>`});
  return deckFromLink("https://decks.example/sabo");
});
console.log("page", JSON.stringify(r2));
check(r2.l === "OP05-001" && /4xOP05-006/.test(r2.deck) && !/OP01-013/.test(r2.deck) && r2.n === 12, "a deck page is read for its first list, up to the next deck's Leader");
const r3 = await page.evaluate(async () => { window.deskFetch = async () => ({error: "none"}); return [await deckFromLink("https://decks.example/x"), await deckFromLink("ftp://x.example/y")]; });
check(/paste it instead/.test(r3[0].err) && /isn't a link/.test(r3[1].err), "without the page reader it asks you to paste the list, and only web links are read");
await page.evaluate(() => { $("#bd-paste").value = "https://deckgen.example/?dg=1nOP01-001a4nOP01-013a4nOP01-016a4nOP01-024a4nOP01-014a4nOP01-015a4nOP01-017a4nOP01-018a4nOP01-019a4nOP01-020a4nOP01-021a4nOP01-022a4nOP01-025a2nOP01-026"; doAction("bdimport"); }); await wait(500);
const bd2 = await page.evaluate(() => ({ld: BD.leader && BD.leader.c, n: bdTotal()}));
check(bd2.ld === "OP01-001" && bd2.n === 50, "Import in the Deck editor reads a pasted link");
// the shell's page reader only takes https links
const ipc = await page.evaluate(async () => window.bountyDesktop && window.bountyDesktop.fetchPage ? window.bountyDesktop.fetchPage("http://127.0.0.1:1/") : "none");
console.log("ipc", JSON.stringify(ipc));
check(ipc && ipc.error, "the desktop's page reader turns down a link that isn't https");
console.log("errors", JSON.stringify(errs));
check(!errs.length, "no page errors");
await app.close();
console.log(fail ? `${fail} FAILED` : "all passed");
process.exit(fail ? 1 : 0);
