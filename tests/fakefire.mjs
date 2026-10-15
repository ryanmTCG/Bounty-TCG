// A small stand-in for Firebase's sign-in and Firestore REST APIs, for tests: users, documents, listing with orderBy
// and pages, and the parts of tools/firestore.rules the tests rely on (each player's own data, the ranked board, and
// the shared collections anyone signed in can add to but nobody can change).
import http from "http";
const sv = f => f == null ? undefined : "stringValue" in f ? f.stringValue : "integerValue" in f ? Number(f.integerValue) : "doubleValue" in f ? f.doubleValue : "booleanValue" in f ? f.booleanValue : undefined;
export async function startFakeFire(port) {
  const users = new Map(), docs = new Map(), log = [];
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
        const id = "uid" + (++n); users.set(id, { email: j.email, pw: j.password }); return send(200, tok(id));
      }
      if (path === "/auth/accounts:signInWithPassword") {
        const id = [...users.keys()].find(k => users.get(k).email === j.email && users.get(k).pw === j.password);
        return id ? send(200, tok(id)) : send(400, { error: { message: "INVALID_LOGIN_CREDENTIALS" } });
      }
      const pre = "/fs/projects/test/databases/(default)/documents/";
      if (!path.startsWith(pre)) return send(404, {});
      const p = path.slice(pre.length), segs = p.split("/"), who = (req.headers.authorization || "").replace("Bearer tok-", "");
      const deny = () => send(403, { error: { message: "PERMISSION_DENIED" } });
      const write = req.method === "PATCH" || req.method === "DELETE";
      log.push(req.method + " " + p);
      if (segs[0] === "data" && segs[2] !== who) return deny();
      if (segs[0] === "ranks" && write && segs[1] !== who) return deny();
      if (segs[0] === "results" && write && !who) return deny();
      if (["games", "replays"].includes(segs[0]) && write && (!who || docs.has(p) || req.method === "DELETE" || sv((j.fields || {}).by) !== who)) return deny();
      if (segs[0] === "reports" && (req.method === "GET" || (write && (docs.has(p) || req.method === "DELETE")))) return deny();
      if (!["data", "ranks", "results", "games", "replays", "reports"].includes(segs[0])) return deny();
      if (segs.length % 2 === 1) {   // a collection: list its documents, ordered and in pages like Firestore
        let keys = [...docs.keys()].filter(k => k.startsWith(p + "/") && !k.slice(p.length + 1).includes("/"));
        const ob = u.searchParams.get("orderBy");
        if (ob) { const [f, dir] = ob.split(" "); keys = keys.filter(k => sv(docs.get(k)[f]) != null).sort((a, b) => { const x = sv(docs.get(a)[f]), y = sv(docs.get(b)[f]); return (x < y ? -1 : x > y ? 1 : 0) * (dir === "desc" ? -1 : 1); }); }
        else keys.sort();
        const size = Math.max(1, +(u.searchParams.get("pageSize") || 300)), from = +(u.searchParams.get("pageToken") || 0);
        const page = keys.slice(from, from + size).map(k => ({ name: "projects/test/databases/(default)/documents/" + k, fields: docs.get(k) }));
        return send(200, Object.assign({ documents: page }, from + size < keys.length ? { nextPageToken: String(from + size) } : {}));
      }
      if (req.method === "GET") return docs.has(p) ? send(200, { name: p, fields: docs.get(p) }) : send(404, { error: { message: "NOT_FOUND" } });
      if (req.method === "PATCH") { docs.set(p, j.fields || {}); return send(200, { name: p, fields: j.fields }); }
      if (req.method === "DELETE") { docs.delete(p); return send(200, {}); }
      send(400, {});
    });
  });
  await new Promise(r => server.listen(port, "127.0.0.1", r));
  // plain JSON for a stored document, and a way to put one in directly
  const plain = f => Object.fromEntries(Object.entries(f || {}).map(([k, v]) => [k, sv(v)]));
  const fsv = v => typeof v === "number" ? (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v }) : typeof v === "boolean" ? { booleanValue: v } : { stringValue: String(v) };
  return { users, docs, log, plain, put: (path, obj) => docs.set(path, Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, fsv(v)]))), close: () => server.close() };
}
