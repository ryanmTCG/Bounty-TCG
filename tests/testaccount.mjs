// Desktop accounts: sign up, local decks and bounty move into the account, a second computer signs in and gets them.
// A small stand-in for Firebase's sign-in and Firestore REST APIs runs on 127.0.0.1:9100.
import { _electron as electron } from "playwright-core";
import http from "http";
import fs from "fs";
const OUT = process.argv[2] || "shots-account";
fs.mkdirSync(OUT, { recursive: true });
const users = new Map(), docs = new Map();
let n = 0;
const server = http.createServer((req, res) => {
  const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Authorization, Content-Type", "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS" };
  const send = (code, obj) => { res.writeHead(code, Object.assign({ "Content-Type": "application/json" }, cors)); res.end(JSON.stringify(obj)); };
  if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
  let body = ""; req.on("data", c => body += c);
  req.on("end", () => {
    const u = new URL(req.url, "http://x"), path = decodeURIComponent(u.pathname);
    const j = (() => { try { return JSON.parse(body || "{}"); } catch (e) { return {}; } })();
    const tok = id => ({ localId: id, email: users.get(id).email, idToken: "tok-" + id, refreshToken: "ref-" + id, expiresIn: "3600" });
    if (path === "/auth/accounts:signUp") {
      if ([...users.values()].some(x => x.email === j.email)) return send(400, { error: { message: "EMAIL_EXISTS" } });
      if ((j.password || "").length < 6) return send(400, { error: { message: "WEAK_PASSWORD : Password should be at least 6 characters" } });
      const id = "uid" + (++n); users.set(id, { email: j.email, pw: j.password }); return send(200, tok(id));
    }
    if (path === "/auth/accounts:signInWithPassword") {
      const id = [...users.keys()].find(k => users.get(k).email === j.email && users.get(k).pw === j.password);
      return id ? send(200, tok(id)) : send(400, { error: { message: "INVALID_LOGIN_CREDENTIALS" } });
    }
    if (path === "/auth/accounts:sendOobCode") return send(200, { email: j.email });
    const pre = "/fs/projects/test/databases/(default)/documents/";
    if (!path.startsWith(pre)) return send(404, {});
    const p = path.slice(pre.length), segs = p.split("/"), who = (req.headers.authorization || "").replace("Bearer tok-", "");
    // the same rules as tools/firestore.rules
    const owner = segs[0] === "data" ? segs[2] : segs[0] === "ranks" ? segs[1] : null;
    const write = req.method === "PATCH" || req.method === "DELETE";
    if (segs[0] === "results") {   // the loser creates the record; only the winner may mark it used
      const cur = docs.get(p), nw = j.fields || {}, sv = f => f && (f.stringValue || f.integerValue);
      if (!who) return send(403, { error: { message: "PERMISSION_DENIED" } });
      if (req.method === "PATCH" && (cur ? sv(cur.w) !== who || +sv(cur.c) !== 0 : sv(nw.l) !== who || sv(nw.w) === who)) return send(403, { error: { message: "PERMISSION_DENIED" } });
    } else if (segs[0] === "data" ? owner !== who : segs[0] === "ranks" ? (write && owner !== who) : true) return send(403, { error: { message: "PERMISSION_DENIED" } });
    if (segs.length % 2 === 1) {   // a collection: list its documents
      const out = [...docs.keys()].filter(k => k.startsWith(p + "/") && !k.slice(p.length + 1).includes("/")).map(k => ({ name: "projects/test/databases/(default)/documents/" + k, fields: docs.get(k) }));
      return send(200, { documents: out });
    }
    if (req.method === "GET") return docs.has(p) ? send(200, { name: p, fields: docs.get(p) }) : send(404, { error: { message: "NOT_FOUND" } });
    if (req.method === "PATCH") { docs.set(p, j.fields || {}); return send(200, { name: p, fields: j.fields }); }
    if (req.method === "DELETE") { docs.delete(p); return send(200, {}); }
    send(400, {});
  });
});
await new Promise(r => server.listen(9100, "127.0.0.1", r));
const q = "?fbtest=http://127.0.0.1:9100";
async function launch(name, keep) {
  const prof = `/tmp/bounty-prof-acct${name}`; if (!keep) fs.rmSync(prof, { recursive: true, force: true });
  const app = await electron.launch({ executablePath: "node_modules/electron/dist/electron", args: ["--no-sandbox", "dist/kit/app"], env: { ...process.env, BOUNTY_PROFILE: prof, BOUNTY_QUERY: q } });
  const page = await app.firstWindow(); const errs = [];
  page.on("pageerror", e => errs.push(String(e)));
  page.on("console", m => { if (m.type() === "error" && !/40[034]|peerjs\.com/.test(m.text())) errs.push(m.text()); });
  await page.setViewportSize({ width: 1280, height: 900 }).catch(() => {});
  await page.waitForLoadState("load"); await page.waitForTimeout(1500);
  return { app, page, errs };
}
const wait = ms => new Promise(r => setTimeout(r, ms));
const home = p => p.evaluate(() => ({ btn: (document.querySelector('[data-do="homesign"]') || {}).textContent, acct: (document.querySelector("#home-acct") || {}).textContent }));
const state = p => p.evaluate(() => ({ decks: DECKS.map(d => d.name), bounty: RANK.b, wl: RANK.w + "-" + RANK.l, stats: STATS.g, mode: deckMode }));
const toastText = p => p.evaluate(() => { const t = document.querySelector("#toast"); return t && !t.hidden ? t.textContent : ""; });

// A: a player with a deck and some bounty on this computer
const A = await launch("a");
await A.page.evaluate(() => {
  localStorage.setItem("nakama:decks", JSON.stringify([{ id: "d1", name: "Red Zoro", leader: "OP01-001", deck: "4xOP01-013", life: 5 }]));
  localStorage.setItem("bounty:rank", JSON.stringify({ b: 81200, w: 3, l: 0, nick: "Ryan" }));
  localStorage.setItem("bounty:stats", JSON.stringify({ g: 3, w: 3, l: 0, ld: { "OP01-001": { n: 3, w: 3, l: 0 } }, cd: { "OP01-013": 5 } }));
});
await A.page.reload(); await wait(1500);
console.log("A home signed out", JSON.stringify(await home(A.page)), JSON.stringify(await state(A.page)));
await A.page.click('[data-do="homesign"]'); await wait(300);
await A.page.screenshot({ path: OUT + "/1-signin.png" });
await A.page.fill("#acc-email", "ryan@example.com"); await A.page.fill("#acc-pw", "123");
await A.page.click('[data-do="accup"]'); await wait(800);
console.log("A weak password", await A.page.evaluate(() => document.querySelector("#acc-msg").textContent));
await A.page.fill("#acc-pw", "grandline1");
await A.page.click('[data-do="accup"]'); await wait(4000);
console.log("A home signed in", JSON.stringify(await home(A.page)), JSON.stringify(await state(A.page)), await toastText(A.page));
await wait(2500);
console.log("server docs", JSON.stringify([...docs.keys()].sort()));
// B: another computer signs in with the same email
const B = await launch("b");
console.log("B before", JSON.stringify(await state(B.page)));
await B.page.click('[data-do="homesign"]'); await wait(300);
await B.page.fill("#acc-email", "ryan@example.com"); await B.page.fill("#acc-pw", "wrongpass");
await B.page.click('[data-do="accin"]'); await wait(800);
console.log("B wrong password", await B.page.evaluate(() => document.querySelector("#acc-msg").textContent));
await B.page.fill("#acc-pw", "grandline1");
await B.page.click('[data-do="accin"]'); await wait(4000);
console.log("B signed in", JSON.stringify(await home(B.page)), JSON.stringify(await state(B.page)));
// B saves a new deck; it lands in the account
await B.page.evaluate(() => persistDeck({ name: "Blue Sabo", leader: "OP05-001", deck: "4xOP05-010", life: 5, sleeve: 0, first: false })); await wait(1500);
console.log("B decks", JSON.stringify(await state(B.page)), "server", [...docs.keys()].filter(k => k.startsWith("data/")).length);
// the shared leaderboard reads from the account service
await B.page.evaluate(() => { closeModal(); openRanked(); }); await wait(2000);
console.log("B leaderboard", JSON.stringify(await B.page.evaluate(() => document.querySelector("#rk-board").innerText.replace(/\s+/g, " "))));
await B.page.screenshot({ path: OUT + "/2-ranked.png" });
// ranked wins need the loser's own record: no record, no win; with one, the win counts once
const before = await A.page.evaluate(() => ({w: RANK.w, b: RANK.b, uid: acctUid()}));
const noRec = await A.page.evaluate(() => rankClaim("m1-m2", 26000));
docs.set("results/m1-m2", { w: { stringValue: before.uid }, l: { stringValue: "uid99" }, c: { integerValue: "0" }, t: { integerValue: "1" } });
const withRec = await A.page.evaluate(() => rankClaim("m1-m2", 26000));
const again = await A.page.evaluate(async () => { await rankClaim("m1-m2", 26000); return {w: RANK.w, b: RANK.b}; });
const fake = await A.page.evaluate(async () => { try { const db = await getDb(); await db.doc("results/x-y").set({w: acctUid(), l: "uid99", c: 0, t: 1}); return "written"; } catch (e) { return "refused"; } });
console.log("ranked claims", JSON.stringify({before, noRec, withRec, again, fake}));
const lossT = await A.page.evaluate(async () => { const b0 = RANK.b; await rankLossCloud(20000); const sn = await (await rankDoc()).get(); return sn.data(); });
console.log("cloud loss", JSON.stringify(lossT));
if (lossT.l !== 1 || lossT.b !== again.b - 20000 || lossT.w !== again.w) { console.log("FAIL a loss counts once against the saved bounty"); process.exitCode = 1; } else console.log("ok   a loss counts once against the saved bounty");
if (noRec !== false || withRec !== true || again.w !== before.w + 1 || again.b !== before.b + 26000 || fake !== "refused") { console.log("FAIL ranked wins are cross-checked"); process.exitCode = 1; } else console.log("ok   ranked wins are cross-checked");
// a nickname set on the profile reaches the leaderboard entry (name only) and the account, and comes back on a new device
const nk = await A.page.evaluate(async () => {
  const r0 = (await (await rankDoc()).get()).data();
  closeModal(); openProfile(true); document.querySelector("#pf-nick").value = "Captain Ryan"; doAction("pfnick");
  await new Promise(r => setTimeout(r, 2500));
  const r1 = (await (await rankDoc()).get()).data();
  const v = loadSaved(); delete v.nick; save(v); STATS.nk = ""; await statsLoad();
  return {r0, r1, back: loadSaved().nick, my: myNick(), head: document.querySelector(".pfhead b").textContent};
});
const stDoc = [...docs.entries()].find(([k]) => /^data\/users\/[^/]+\/_stats$/.test(k) && k.includes(before.uid));
console.log("nickname", JSON.stringify(nk), stDoc ? JSON.stringify(stDoc[1].nk) : "no stats doc");
if (nk.r1.nick !== "Captain Ryan" || nk.r1.b !== nk.r0.b || nk.r1.w !== nk.r0.w || nk.r1.l !== nk.r0.l || nk.head !== "Captain Ryan") { console.log("FAIL the nickname updates the leaderboard entry and nothing else"); process.exitCode = 1; } else console.log("ok   the nickname updates the leaderboard entry and nothing else");
if (!stDoc || !stDoc[1].nk || stDoc[1].nk.stringValue !== "Captain Ryan" || nk.back !== "Captain Ryan" || nk.my !== "Captain Ryan") { console.log("FAIL the nickname is saved with the account and comes back on sign-in"); process.exitCode = 1; } else console.log("ok   the nickname is saved with the account and comes back on sign-in");
// sign out on B: back to this computer's own (empty) data
await B.page.evaluate(() => { closeModal(); openHome(); }); await wait(300);
await B.page.click('[data-do="homesign"]'); await wait(300);
await B.page.screenshot({ path: OUT + "/3-account.png" });
await B.page.click('[data-do="accout"]'); await wait(3000);
console.log("B signed out", JSON.stringify(await home(B.page)), JSON.stringify(await state(B.page)));
console.log("errorsA", JSON.stringify(A.errs.slice(0, 5))); console.log("errorsB", JSON.stringify(B.errs.slice(0, 5)));
await A.app.close(); await B.app.close(); server.close();
