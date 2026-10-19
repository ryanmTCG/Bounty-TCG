/* Bounty TCG standalone runtime.
 * Stands in for the claude.ai services the game was built on:
 *   room   -> peer-to-peer rooms over WebRTC (PeerJS), no accounts needed; the room namespace
 *             itself is a shared lobby (presence + onPeers) that lists open tables
 *   db     -> this browser's storage, seeded with the bundled card database
 *   assets -> card art stored in this browser (IndexedDB), served by sw.js,
 *             or on disk through the desktop shell (window.bountyDesktop)
 *   user   -> a local player who can edit their own copy; signed in to a Bounty account (Firebase email
 *             sign-in), their id makes decks, bounty and profile sync between computers
 *   sample -> card reading through the desktop shell, with the player's own Claude API key
 * The game calls window.claude.use(name) exactly as before.
 */
(function () {
  "use strict";
  const ROOM_PREFIX = "bountytcg-v2-";
  const LOBBY_ID = "bountytcg-dir-v2-lobby";   // one shared lobby for every copy of the game
  // PeerJS ids allow only letters and digits with single - or _ between them
  const safeId = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "lobby";
  const desk = window.bountyDesktop || null;
  const clone = o => o == null ? o : JSON.parse(JSON.stringify(o));
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  /* ------------------------------------------------------------------ */
  /* room: one host per room code relays everyone's presence             */
  /* ------------------------------------------------------------------ */
  function peerOptions() {
    const q = new URLSearchParams(location.search);
    const o = {debug: 0, config: {iceServers: [
      {urls: "stun:stun.l.google.com:19302"},
      {urls: "stun:stun1.l.google.com:19302"},
      {urls: "stun:global.stun.twilio.com:3478"}
    ]}};
    if (q.get("peerhost")) { // optional self-hosted signalling server
      o.host = q.get("peerhost"); o.port = +(q.get("peerport") || 443);
      o.path = q.get("peerpath") || "/"; o.secure = q.get("peersecure") !== "0";
    }
    return o;
  }
  function PeerCtor() { return window.BountyPeer || window.Peer; }

  function joinRoom(code, opts) {
    opts = opts || {};
    const hostId = opts.hostId || ROOM_PREFIX + safeId(code), maxGuests = opts.max || 7;
    const peersCbs = new Set(), connCbs = new Set();
    const pres = new Map();          // peer id -> {presence, seen}
    const conns = new Map();         // host only: peer id -> DataConnection
    let me = "", peer = null, hostConn = null, role = "", left = false;
    let myPresence = {}, connected = false, beat = null, restartT = null;

    const peersList = () => {
      const out = [{peer: me || "me", isMe: true, kind: "viewer", guest: false, presence: myPresence}];
      pres.forEach((v, id) => { if (id !== me) out.push({peer: id, isMe: false, kind: "viewer", guest: false, presence: v.presence}); });
      return out;
    };
    const emitPeers = () => {
      const change = {peers: peersList(), joined: [], updated: [], left: []};
      peersCbs.forEach(f => { try { f(change); } catch (e) { console.error(e); } });
    };
    const setConn = c => {
      if (c === connected) return;
      connected = c;
      connCbs.forEach(f => { try { f(c); } catch (e) { console.error(e); } });
    };
    const safe = p => (p && typeof p === "object" && !Array.isArray(p)) ? p : {};
    const send = (c, m) => { try { if (c && c.open) c.send(m); } catch (e) {} };

    function hostBroadcast() {
      const all = {};
      pres.forEach((v, id) => { all[id] = v.presence; });
      all[me] = myPresence;
      conns.forEach(c => send(c, {t: "all", all}));
    }
    function dropGuest(id) {
      const c = conns.get(id);
      conns.delete(id);
      try { if (c) c.close(); } catch (e) {}
      if (pres.delete(id)) { emitPeers(); hostBroadcast(); }
    }
    function clearBeat() { if (beat) clearInterval(beat); beat = null; }

    function teardown() {
      clearBeat();
      conns.forEach(c => { try { c.close(); } catch (e) {} });
      conns.clear(); hostConn = null;
      if (peer) { try { peer.destroy(); } catch (e) {} }
      peer = null; role = "";
    }
    function restart(why) {
      if (left) return;
      teardown();
      if (pres.size) { pres.clear(); emitPeers(); }
      setConn(false);
      clearTimeout(restartT);
      tries = Math.min(tries + 1, 5);
      restartT = setTimeout(() => start(), 300 * Math.pow(2, tries - 1) + Math.random() * 800);
    }

    let firstResolve, firstReject, firstDone = false;
    const first = new Promise((res, rej) => { firstResolve = res; firstReject = rej; });
    let tries = 0;
    const ready = () => { tries = 0; setConn(true); if (!firstDone) { firstDone = true; firstResolve(); } };

    function start() {
      if (left) return;
      const P = PeerCtor();
      if (!P) { if (!firstDone) { firstDone = true; firstReject(new Error("peer library failed to load")); } return; }
      // 1) try to be the host of this room code
      const p = new P(hostId, peerOptions());
      peer = p;
      p.on("open", id => {
        if (peer !== p) return;
        me = id; role = "host"; ready(); emitPeers();
        clearBeat();
        beat = setInterval(() => {
          const now = Date.now();
          conns.forEach((c, id) => {
            send(c, {t: "ping"});
            const v = pres.get(id);
            if (v && now - v.seen > 15000) dropGuest(id);
          });
          if (p.disconnected && !p.destroyed) { try { p.reconnect(); } catch (e) {} }
        }, 3000);
      });
      p.on("connection", c => {
        c.on("open", () => {
          if (conns.size >= maxGuests) { send(c, {t: "full"}); setTimeout(() => { try { c.close(); } catch (e) {} }, 300); return; }
          conns.set(c.peer, c);
          pres.set(c.peer, {presence: {}, seen: Date.now()});
          hostBroadcast();
        });
        c.on("data", m => {
          if (!m || typeof m !== "object") return;
          const v = pres.get(c.peer); if (v) v.seen = Date.now();
          if (m.t === "p") {
            pres.set(c.peer, {presence: safe(m.p), seen: Date.now()});
            emitPeers(); hostBroadcast();
          }
        });
        c.on("close", () => dropGuest(c.peer));
        c.on("error", () => dropGuest(c.peer));
      });
      p.on("disconnected", () => { if (peer === p && !p.destroyed) setTimeout(() => { try { if (!p.destroyed) p.reconnect(); } catch (e) {} }, 1000); });
      p.on("error", err => {
        if (peer !== p) return;
        const t = err && err.type;
        if (t === "unavailable-id" && !role) { try { p.destroy(); } catch (e) {} becomeGuest(); return; }
        if (t === "browser-incompatible") { if (!firstDone) { firstDone = true; firstReject(err); } return; }
        if (!role && (t === "network" || t === "server-error" || t === "socket-error" || t === "socket-closed")) {
          if (!firstDone) { firstDone = true; firstReject(err); }
          return;
        }
      });
    }

    function becomeGuest() {
      if (left) return;
      const P = PeerCtor();
      const p = new P(undefined, peerOptions());
      peer = p;
      p.on("open", id => {
        if (peer !== p) return;
        me = id; role = "guest";
        const c = p.connect(hostId, {reliable: true, serialization: "json"});
        hostConn = c;
        let lastHeard = Date.now();
        c.on("open", () => {
          if (hostConn !== c) return;
          send(c, {t: "p", p: myPresence});
          ready(); emitPeers();
          clearBeat();
          beat = setInterval(() => {
            send(c, {t: "ping"});
            if (Date.now() - lastHeard > 15000) restart("host silent");
          }, 3000);
        });
        c.on("data", m => {
          lastHeard = Date.now();
          if (!m || typeof m !== "object") return;
          if (m.t === "all" && m.all && typeof m.all === "object") {
            pres.clear();
            for (const id of Object.keys(m.all)) if (id !== me) pres.set(id, {presence: safe(m.all[id]), seen: Date.now()});
            emitPeers();
          } else if (m.t === "full") {
            left = true; teardown(); setConn(false);
            if (!firstDone) { firstDone = true; firstReject(new Error("room full")); }
          }
        });
        c.on("close", () => { if (hostConn === c) restart("host left"); });
        c.on("error", () => { if (hostConn === c) restart("host error"); });
      });
      p.on("error", err => {
        if (peer !== p) return;
        const t = err && err.type;
        // host vanished between our claim attempt and connect: try to take over the room
        if (t === "peer-unavailable") { restart("no host"); return; }
        if (!firstDone && (t === "network" || t === "server-error" || t === "socket-error")) { firstDone = true; firstReject(err); }
      });
      p.on("disconnected", () => { if (peer === p && !p.destroyed) setTimeout(() => { try { if (!p.destroyed) p.reconnect(); } catch (e) {} }, 1000); });
    }

    start();
    const api = {
      async presence(patch) {
        myPresence = safe(clone(patch));
        if (opts.echo) emitPeers();      // the lobby lists your own table too
        if (role === "host") hostBroadcast();
        else if (role === "guest") send(hostConn, {t: "p", p: myPresence});
      },
      onPeers(fn) { peersCbs.add(fn); setTimeout(() => { if (peersCbs.has(fn)) fn({peers: peersList(), joined: [], updated: [], left: []}); }, 0); return () => peersCbs.delete(fn); },
      onConnection(fn) { connCbs.add(fn); return () => connCbs.delete(fn); },
      emit() { return Promise.resolve(); },
      on() { return () => {}; },
      async leave() { left = true; clearTimeout(restartT); teardown(); setConn(false); },
      get name() { return code; }
    };
    return Promise.race([
      first.then(() => api),
      sleep(20000).then(() => { if (!firstDone) { left = true; teardown(); throw new Error("timeout"); } return api; })
    ]);
  }
  /* the lobby: the room namespace's own presence/onPeers, like claude.ai's page-wide room.
     Connected while anyone listens or this player lists a table; dropped a little after both stop. */
  let lob = null, lobP = null, lobIdle = null, lobRetry = null, lobPeers = [], lobConn = false;
  const lobPres = {}, lobPeerCbs = new Set(), lobConnCbs = new Set();
  const lobNeeded = () => lobPeerCbs.size > 0 || Object.keys(lobPres).length > 0;
  const lobSelf = () => [{peer: "me", isMe: true, sameTab: true, kind: "viewer", guest: false, by: null, presence: clone(lobPres)}];
  function lobSetConn(c) {
    if (c === lobConn) return;
    lobConn = c;
    lobConnCbs.forEach(f => { try { f(c); } catch (e) { console.error(e); } });
  }
  function lobEnsure() {
    clearTimeout(lobIdle);
    if (lob || lobP || !lobNeeded()) return;
    lobP = joinRoom("lobby", {hostId: LOBBY_ID, max: 120, echo: true}).then(r => {
      lobP = null; lob = r;
      r.onConnection(lobSetConn);
      r.onPeers(ch => {
        if (lob !== r) return;
        lobPeers = ch.peers;
        lobPeerCbs.forEach(f => { try { f(ch); } catch (e) { console.error(e); } });
      });
      r.presence(lobPres); lobSetConn(true);
      if (!lobNeeded()) lobMaybeClose();
    }, () => {
      lobP = null; clearTimeout(lobRetry);
      lobRetry = setTimeout(lobEnsure, 5000);
    });
  }
  function lobMaybeClose() {
    clearTimeout(lobIdle);
    lobIdle = setTimeout(() => {
      if (lobNeeded() || !lob) return;
      const r = lob; lob = null; lobPeers = []; lobSetConn(false);
      r.leave();
    }, 10000);
  }
  const roomNS = Object.freeze({
    join: code => joinRoom(String(code || "lobby")),
    presence(patch) {
      patch = (patch && typeof patch === "object" && !Array.isArray(patch)) ? patch : {};
      for (const k of Object.keys(patch)) { if (patch[k] === null) delete lobPres[k]; else lobPres[k] = clone(patch[k]); }
      if (lob) lob.presence(lobPres);
      if (lobNeeded()) lobEnsure(); else lobMaybeClose();
      return Promise.resolve();
    },
    peers: () => lobPeers.length ? lobPeers : lobSelf(),
    onPeers(fn) {
      lobPeerCbs.add(fn); lobEnsure();
      setTimeout(() => { if (lobPeerCbs.has(fn)) fn({peers: lobPeers.length ? lobPeers : lobSelf(), joined: [], updated: [], left: []}); }, 0);
      return () => { lobPeerCbs.delete(fn); if (!lobNeeded()) lobMaybeClose(); };
    },
    connected: () => lobConn,
    onConnection(fn) {
      lobConnCbs.add(fn);
      setTimeout(() => { if (lobConnCbs.has(fn)) fn(lobConn); }, 0);
      return () => lobConnCbs.delete(fn);
    }
  });

  /* ------------------------------------------------------------------ */
  /* db: bundled seed data with this browser's own changes layered on top */
  /* ------------------------------------------------------------------ */
  const LS_DB = "bounty:db:v1";
  let local = {};
  try { local = JSON.parse(localStorage.getItem(LS_DB) || "{}") || {}; } catch (e) { local = {}; }
  let seed = {};
  const seedReady = fetch("seed.json").then(r => r.ok ? r.json() : {}).then(j => { seed = j || {}; }).catch(() => {})
    .then(() => desk ? desk.listCards() : [])
    .then(codes => {
      // card art index built from the bundled card folder: art/<set> = {cards: {code: "card_<code>"}}
      for (const code of codes || []) {
        const set = "art/" + code.split("-")[0];
        if (!seed[set] || typeof seed[set] !== "object") seed[set] = {cards: {}};
        seed[set].cards[code] = "card_" + code;
      }
    }).catch(() => {});
  // card data saved on this computer (the card reader, an import) keeps cards the bundle doesn't have, but the bundled
  // official data wins for the cards it has, so a copy with older saved card data still gets corrections and rarities
  const mergeNames = (l, s) => {
    const lc = (l && l.cards) || {}, sc = (s && s.cards) || {}, cards = Object.assign({}, lc);
    for (const k of Object.keys(sc)) cards[k] = Object.assign({}, lc[k] && typeof lc[k] === "object" ? lc[k] : {}, sc[k]);
    return Object.assign({}, l, {cards});
  };
  const getDoc = path => (path in local) ? (local[path] && seed[path] && path.startsWith("names/") ? mergeNames(local[path], seed[path]) : local[path]) : (seed[path] === undefined ? null : seed[path]);
  function persist() {
    try { localStorage.setItem(LS_DB, JSON.stringify(local)); }
    catch (e) { console.warn("Browser storage is full; this change won't survive a reload."); }
  }
  const subs = new Set();
  const childOf = (col, path) => path.startsWith(col + "/") && !path.slice(col.length + 1).includes("/");
  function colSnap(col) {
    const ids = new Set();
    for (const k of Object.keys(seed)) if (childOf(col, k)) ids.add(k.slice(col.length + 1));
    for (const k of Object.keys(local)) if (childOf(col, k)) ids.add(k.slice(col.length + 1));
    const docs = [];
    ids.forEach(id => { const d = getDoc(col + "/" + id); if (d) docs.push({id, exists: true, data: () => clone(d)}); });
    return {docs, size: docs.length, empty: !docs.length};
  }
  function docSnap(path) {
    const d = getDoc(path);
    return {id: path.split("/").pop(), exists: !!d, data: () => d ? clone(d) : undefined};
  }
  function notify(path) {
    setTimeout(() => subs.forEach(s => {
      try {
        if (s.kind === "doc" && s.path === path) s.cb(docSnap(path));
        else if (s.kind === "col" && childOf(s.path, path)) s.cb(colSnap(s.path));
      } catch (e) { console.error(e); }
    }), 0);
  }
  function docRef(path) {
    return {
      id: path.split("/").pop(), path,
      async get() { await seedReady; return docSnap(path); },
      async set(d) { await seedReady; local[path] = clone(d); persist(); notify(path); },
      async update(d) { await seedReady; local[path] = Object.assign({}, getDoc(path) || {}, clone(d)); persist(); notify(path); },
      async delete() { await seedReady; local[path] = null; persist(); notify(path); },
      onSnapshot(cb) { const s = {kind: "doc", path, cb}; subs.add(s); seedReady.then(() => { if (subs.has(s)) cb(docSnap(path)); }); return () => subs.delete(s); }
    };
  }
  // a filtered, ordered, limited view of a collection (claude.ai's db Query): where(field, "==", value), one orderBy, limit
  function query(load, q) {
    const run = async () => {
      let docs = (await load(q)).docs;
      for (const w of q.where) docs = docs.filter(d => { const v = (d.data() || {})[w[0]]; return w[1] === "==" ? v === w[2] : w[1] === "!=" ? v !== w[2] : w[1] === ">=" ? v >= w[2] : w[1] === "<=" ? v <= w[2] : w[1] === ">" ? v > w[2] : w[1] === "<" ? v < w[2] : true; });
      if (q.order) { const [f, dir] = q.order, s = dir === "desc" ? -1 : 1; docs = docs.filter(d => (d.data() || {})[f] != null).sort((a, b) => { const x = a.data()[f], y = b.data()[f]; return x < y ? -s : x > y ? s : 0; }); }
      if (q.lim) docs = docs.slice(0, q.lim);
      return {docs, size: docs.length, empty: !docs.length};
    };
    const next = o => query(load, Object.assign({}, q, o));
    return {
      where: (f, op, v) => next({where: q.where.concat([[f, op, v]])}),
      orderBy: (f, dir) => next({order: [f, dir === "desc" ? "desc" : "asc"]}),
      limit: n => next({lim: Math.max(1, Math.min(1000, n | 0))}),
      get: run,
      onSnapshot(cb, err) { let on = true; run().then(x => { if (on) cb(x); }, e => { if (on && err) err(e); }); return () => { on = false; }; }
    };
  }
  const Q0 = {where: [], order: null, lim: 0};
  function colRef(path) {
    const load = async () => { await seedReady; return colSnap(path); };
    return {
      path,
      doc: id => docRef(path + "/" + id),
      async get() { await seedReady; return colSnap(path); },
      where: (f, op, v) => query(load, Q0).where(f, op, v),
      orderBy: (f, dir) => query(load, Q0).orderBy(f, dir),
      limit: n => query(load, Q0).limit(n),
      onSnapshot(cb) { const s = {kind: "col", path, cb}; subs.add(s); seedReady.then(() => { if (subs.has(s)) cb(colSnap(path)); }); return () => subs.delete(s); }
    };
  }
  /* ------------------------------------------------------------------ */
  /* accounts: optional email sign-in. A signed-in player's decks, bounty and profile (data/users/<uid>/...)  */
  /* live in Firestore instead of this computer, and the ranked leaderboard (ranks/...) is shared by everyone. */
  /* Plain REST calls, so no Firebase library is bundled. Security rules: tools/firestore.rules.              */
  /* ------------------------------------------------------------------ */
  // Ryan's Firebase web app config. The apiKey isn't a secret: the Firestore rules decide who reads and writes what.
  const FB_CONFIG = {apiKey: "AIzaSyCIZXvpraLHWAFmGD4smB6tYMWO8zNGJGU", projectId: "bounty-tcg-1771e"};
  const fbq = new URLSearchParams(location.search);
  const FB = fbq.get("fbtest")   // tests point this at a local stand-in server
    ? {apiKey: "test", projectId: "test", auth: fbq.get("fbtest") + "/auth", token: fbq.get("fbtest") + "/token", store: fbq.get("fbtest") + "/fs"}
    : FB_CONFIG && FB_CONFIG.apiKey && FB_CONFIG.projectId
      ? {apiKey: FB_CONFIG.apiKey, projectId: FB_CONFIG.projectId, auth: "https://identitytoolkit.googleapis.com/v1", token: "https://securetoken.googleapis.com/v1", store: "https://firestore.googleapis.com/v1"}
      : null;
  const LS_AUTH = "bounty:auth";
  let auth = null;
  try { auth = FB ? JSON.parse(localStorage.getItem(LS_AUTH) || "null") : null; } catch (e) { auth = null; }
  function saveAuth(a) { auth = a; try { if (a) localStorage.setItem(LS_AUTH, JSON.stringify(a)); else localStorage.removeItem(LS_AUTH); } catch (e) {} }
  function keepAuth(j, email) {
    saveAuth({uid: j.localId || j.user_id, email: j.email || email || (auth && auth.email) || "", idToken: j.idToken || j.id_token,
      refresh: j.refreshToken || j.refresh_token, exp: Date.now() + (+(j.expiresIn || j.expires_in) || 3600) * 1000 - 60000});
  }
  const AUTH_MSG = {
    EMAIL_EXISTS: "There's already an account with that email. Sign in instead.",
    INVALID_LOGIN_CREDENTIALS: "That email and password don't match an account.",
    EMAIL_NOT_FOUND: "That email and password don't match an account.",
    INVALID_PASSWORD: "That email and password don't match an account.",
    WEAK_PASSWORD: "Use a password with at least 6 characters.",
    INVALID_EMAIL: "That doesn't look like an email address.",
    MISSING_EMAIL: "Enter your email address.",
    MISSING_PASSWORD: "Enter a password.",
    TOO_MANY_ATTEMPTS_TRY_LATER: "Too many tries. Wait a few minutes and try again.",
    USER_DISABLED: "This account has been switched off."
  };
  async function authPost(path, body) {
    let r, j = {};
    try { r = await fetch(`${FB.auth}/${path}?key=${encodeURIComponent(FB.apiKey)}`, {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(body)}); j = await r.json().catch(() => ({})); }
    catch (e) { throw new Error("Couldn't reach the account service. Check your internet connection and try again."); }
    if (!r.ok) {
      const code = String((j.error && j.error.message) || "").split(" ")[0].split(":")[0];
      const err = new Error(AUTH_MSG[code] || "Couldn't sign in right now. Try again in a moment."); err.code = code; throw err;
    }
    return j;
  }
  async function idToken() {
    if (!auth) return null;
    if (Date.now() < auth.exp) return auth.idToken;
    const r = await fetch(`${FB.token}/token?key=${encodeURIComponent(FB.apiKey)}`, {method: "POST",
      headers: {"Content-Type": "application/x-www-form-urlencoded"}, body: "grant_type=refresh_token&refresh_token=" + encodeURIComponent(auth.refresh)});
    if (r.status === 400) { saveAuth(null); location.reload(); throw new Error("signed out"); }   // password changed or account removed
    if (!r.ok) throw new Error("offline");
    keepAuth(await r.json()); return auth.idToken;
  }
  window.bountyAccount = FB ? Object.freeze({
    available: true,
    user: () => auth ? {uid: auth.uid, email: auth.email} : null,
    async signUp(email, password) { keepAuth(await authPost("accounts:signUp", {email, password, returnSecureToken: true}), email); },
    async signIn(email, password) { keepAuth(await authPost("accounts:signInWithPassword", {email, password, returnSecureToken: true}), email); },
    async reset(email) { await authPost("accounts:sendOobCode", {requestType: "PASSWORD_RESET", email}); },
    signOut() { saveAuth(null); }
  }) : null;

  // Firestore's typed values <-> plain JSON
  const fsv = v => v === null || v === undefined ? {nullValue: null} : typeof v === "boolean" ? {booleanValue: v}
    : typeof v === "number" ? (Number.isInteger(v) ? {integerValue: String(v)} : {doubleValue: v}) : typeof v === "string" ? {stringValue: v}
    : Array.isArray(v) ? {arrayValue: {values: v.map(fsv)}} : {mapValue: {fields: fsf(v)}};
  const fsf = o => { const f = {}; for (const k of Object.keys(o || {})) if (o[k] !== undefined) f[k] = fsv(o[k]); return f; };
  const jsv = v => !v ? null : "integerValue" in v ? Number(v.integerValue) : "doubleValue" in v ? Number(v.doubleValue) : "stringValue" in v ? v.stringValue
    : "booleanValue" in v ? v.booleanValue : "mapValue" in v ? jsf(v.mapValue.fields) : "arrayValue" in v ? (v.arrayValue.values || []).map(jsv)
    : "timestampValue" in v ? v.timestampValue : null;
  const jsf = f => { const o = {}; for (const k of Object.keys(f || {})) o[k] = jsv(f[k]); return o; };
  const fsUrl = path => `${FB.store}/projects/${encodeURIComponent(FB.projectId)}/databases/(default)/documents/${path.split("/").map(encodeURIComponent).join("/")}`;
  async function fsFetch(path, opt, query) {
    const t = await idToken().catch(() => null), h = Object.assign({}, (opt && opt.headers) || {});
    if (t) h.Authorization = "Bearer " + t;
    const r = await fetch(fsUrl(path) + (query || ""), Object.assign({}, opt || {}, {headers: h}));
    if (!r.ok && r.status !== 404) throw {code: r.status === 403 ? "not_granted" : "unavailable", message: "Couldn't reach your account's saved data."};
    return r;
  }
  const SHARED = ["ranks", "results", "games", "replays", "reports", "meta"];
  const isCloud = path => !!FB && (SHARED.includes(path.split("/")[0])
    || (!!auth && (path === "data/users/" + auth.uid || path.startsWith("data/users/" + auth.uid + "/"))));
  const cloudSubs = new Set();
  const cloudNotify = path => cloudSubs.forEach(s => { if (s.path === path || (s.col && childOf(s.path, path))) s.refresh(); });
  function cloudWatch(path, col, load, cb, err) {
    const s = {path, col, refresh: () => load().then(x => { if (cloudSubs.has(s)) cb(x); }, e => { if (cloudSubs.has(s) && err) err(e); })};
    cloudSubs.add(s); s.refresh();
    const iv = setInterval(s.refresh, 60000);   // picks up changes made on another computer
    return () => { cloudSubs.delete(s); clearInterval(iv); };
  }
  function cloudDocRef(path) {
    const id = path.split("/").pop();
    const snap = async () => { const r = await fsFetch(path); const d = r.status === 404 ? null : jsf((await r.json()).fields); return {id, exists: !!d, data: () => d ? clone(d) : undefined}; };
    const set = async d => { await fsFetch(path, {method: "PATCH", headers: {"Content-Type": "application/json"}, body: JSON.stringify({fields: fsf(clone(d))})}); cloudNotify(path); };
    return {
      id, path, get: snap, set,
      async update(d) { const cur = await snap(); await set(Object.assign(cur.exists ? cur.data() : {}, d)); },
      async delete() { await fsFetch(path, {method: "DELETE"}); cloudNotify(path); },
      onSnapshot: (cb, err) => cloudWatch(path, false, snap, cb, err)
    };
  }
  function cloudColRef(path) {
    // an orderBy and limit go to Firestore (newest games first without reading them all); filters run here. Newest first
    // with where(that field, ">", x) reads small pages and stops at the first page that reaches x, so only newer ones cost reads
    const list = async q => {
      const docs = [], want = (q && q.lim) || 3000, ord = q && q.order ? "&orderBy=" + encodeURIComponent(q.order[0] + (q.order[1] === "desc" ? " desc" : "")) : "";
      const stop = q && q.order && q.order[1] === "desc" && (q.where || []).find(w => w[0] === q.order[0] && (w[1] === ">" || w[1] === ">="));
      let tok = "";
      for (let i = 0; i < (stop ? 40 : 10) && docs.length < want; i++) {
        const r = await fsFetch(path, null, "?pageSize=" + Math.min(stop ? 50 : 300, want - docs.length) + ord + (tok ? "&pageToken=" + encodeURIComponent(tok) : ""));
        const j = r.status === 404 ? {} : await r.json();
        let past = false;
        for (const d of j.documents || []) { const data = jsf(d.fields); docs.push({id: d.name.split("/").pop(), exists: true, data: () => clone(data)}); if (stop && !(stop[1] === ">" ? data[stop[0]] > stop[2] : data[stop[0]] >= stop[2])) past = true; }
        if (past || !j.nextPageToken) break; tok = j.nextPageToken;
      }
      return {docs, size: docs.length, empty: !docs.length};
    };
    return {path, doc: id => cloudDocRef(path + "/" + id), get: () => list(), onSnapshot: (cb, err) => cloudWatch(path, true, () => list(), cb, err),
      where: (f, op, v) => query(list, Q0).where(f, op, v), orderBy: (f, dir) => query(list, Q0).orderBy(f, dir), limit: n => query(list, Q0).limit(n)};
  }
  const dbNS = Object.freeze({
    collection: path => isCloud(path) ? cloudColRef(path) : colRef(path),
    doc: path => isCloud(path) ? cloudDocRef(path) : docRef(path)
  });

  /* ------------------------------------------------------------------ */
  /* assets: card art kept in this browser's IndexedDB                    */
  /* ------------------------------------------------------------------ */
  let idbP = null;
  function idb() {
    if (!idbP) idbP = new Promise((res, rej) => {
      const r = indexedDB.open("bounty-blobs", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("b");
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return idbP;
  }
  const tx = (mode, fn) => idb().then(d => new Promise((res, rej) => {
    const t = d.transaction("b", mode), st = t.objectStore("b");
    let out; const r = fn(st); if (r) r.onsuccess = () => { out = r.result; };
    t.oncomplete = () => res(out); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error || {code: "quota_or_state"});
  }));
  const hex = n => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => b.toString(16).padStart(2, "0")).join("");
  const deskAssetsNS = desk && Object.freeze({
    async upload(blob) {
      const id = hex(16);
      try { await desk.artPut(id, new Uint8Array(await blob.arrayBuffer()), blob.type); }
      catch (e) { throw {code: "quota_or_state", message: "Couldn't save that card art on this computer."}; }
      return {id, url: "/_blob/" + id, sizeBytes: blob.size, contentType: blob.type};
    },
    async delete(id) { await desk.artDelete(String(id)); },
    async list() {
      const all = (await desk.artList()).map(a => Object.assign({url: "/_blob/" + a.id}, a));
      return {assets: all, usage: {bytes: all.reduce((n, a) => n + (a.sizeBytes || 0), 0), maxBytes: 20 * 1024 * 1024 * 1024, files: all.length, maxFiles: 100000}};
    }
  });
  const assetsNS = deskAssetsNS || Object.freeze({
    async upload(blob) {
      const id = hex(16);
      try { await tx("readwrite", st => st.put(blob, id)); }
      catch (e) { throw {code: "quota_or_state", message: "This browser is out of space for card art."}; }
      return {id, url: "_blob/" + id, sizeBytes: blob.size, contentType: blob.type};
    },
    async delete(id) { await tx("readwrite", st => st.delete(String(id))); },
    async list() {
      const all = [];
      await idb().then(d => new Promise(res => {
        const c = d.transaction("b").objectStore("b").openCursor();
        c.onsuccess = () => { const cur = c.result; if (!cur) return res(); all.push({id: cur.key, url: "_blob/" + cur.key, sizeBytes: cur.value.size, contentType: cur.value.type}); cur.continue(); };
        c.onerror = () => res();
      }));
      let maxBytes = 2 * 1024 * 1024 * 1024;
      try { const est = await navigator.storage.estimate(); if (est && est.quota) maxBytes = est.quota; } catch (e) {}
      return {assets: all, usage: {bytes: all.reduce((n, a) => n + (a.sizeBytes || 0), 0), maxBytes, files: all.length, maxFiles: 20000}};
    }
  });

  /* ------------------------------------------------------------------ */
  /* user: a local player who owns their own copy                          */
  /* ------------------------------------------------------------------ */
  // Only the copy Ryan unlocked (Ctrl+Shift+O) shows the card reader and card data tools.
  const owner = () => { try { return localStorage.getItem("bounty-owner") === "1"; } catch (e) { return false; } };
  document.addEventListener("keydown", e => {
    if (!(e.ctrlKey && e.shiftKey && (e.key === "O" || e.key === "o"))) return;
    try { localStorage.setItem("bounty-owner", owner() ? "0" : "1"); } catch (e) {}
    location.reload();
  });
  const userNS = Object.freeze({
    isOwner: () => owner(), canEdit: async () => owner(), can: () => owner(),
    id: async () => auth ? auth.uid : null, me: async () => ({id: auth ? auth.uid : "local", name: ""}), profiles: async () => ({}), search: async () => []
  });

  /* card art is served at _blob/<id> by the service worker */
  if (!desk && "serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("sw.js").then(() => {
      try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {}
    }).catch(() => {});
  }

  /* ------------------------------------------------------------------ */
  /* sample: card reading with the player's own Claude API key            */
  /* ------------------------------------------------------------------ */
  const MEDIA = ["image/jpeg", "image/png", "image/gif", "image/webp"];
  async function toImage(b) {
    if (!b) return null;
    if (!MEDIA.includes(b.type)) { // re-encode anything else as JPEG
      const bmp = await createImageBitmap(b), cv = document.createElement("canvas");
      cv.width = bmp.width; cv.height = bmp.height; cv.getContext("2d").drawImage(bmp, 0, 0);
      b = await new Promise(r => cv.toBlob(r, "image/jpeg", 0.92));
    }
    const bytes = new Uint8Array(await b.arrayBuffer());
    let bin = ""; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return {type: b.type, b64: btoa(bin)};
  }
  const sampleNS = desk && Object.freeze({
    async limits() { return {images: await desk.hasKey()}; },
    async json(prompt, opts) {
      opts = opts || {};
      if (opts.signal && opts.signal.aborted) throw {code: "cancelled"};
      if (!(await desk.hasKey())) { openKeyDialog(); throw {code: "not_granted", message: "Add a Claude API key from Game > Card reading to read cards."}; }
      const list = Array.isArray(opts.images) ? opts.images : (opts.images ? [opts.images] : []);
      const images = (await Promise.all(list.map(toImage))).filter(Boolean);
      const r = await desk.sampleJson(String(prompt), images);
      if (opts.signal && opts.signal.aborted) throw {code: "cancelled"};
      if (!r || r.error) throw (r && r.error) || {code: "error"};
      return r.value;
    }
  });

  function openKeyDialog() {
    if (!desk || document.getElementById("bounty-keydlg")) return;
    desk.hasKey().then(has => {
      const m = document.createElement("div");
      m.className = "modal"; m.id = "bounty-keydlg"; m.style.zIndex = 120;
      m.innerHTML = `<div class="sheet" role="dialog" aria-label="Card reading">
        <h2>Card reading</h2>
        <p>Automatic card effects (On Play, Blocker, Trigger and so on) are read off the card art by Claude. That needs your own Claude API key from console.anthropic.com. Each card is read once and remembered on this computer.</p>
        <label for="bounty-key">Claude API key</label>
        <input type="text" id="bounty-key" autocomplete="off" spellcheck="false" placeholder="${has ? "A key is saved. Paste a new one to replace it." : "sk-ant-..."}">
        <p class="hint">The key is stored encrypted on this computer and only sent to Anthropic.</p>
        <div class="row end">${has ? '<button class="btn warn" data-k="clear" type="button">Remove key</button>' : ""}<button class="btn" data-k="close" type="button">Close</button><button class="btn pri" data-k="save" type="button">Save key</button></div>
      </div>`;
      m.addEventListener("click", async e => {
        const k = e.target && e.target.dataset && e.target.dataset.k;
        if (e.target === m || k === "close") m.remove();
        else if (k === "clear") { await desk.setKey(""); m.remove(); }
        else if (k === "save") { const v = m.querySelector("#bounty-key").value.trim(); if (v) await desk.setKey(v); m.remove(); }
      });
      document.body.appendChild(m);
      m.querySelector("#bounty-key").focus();
    });
  }
  if (desk) desk.onKeyMenu(openKeyDialog);

  /* ------------------------------------------------------------------ */
  /* updates: the desktop shell checks GitHub at launch and says when a   */
  /* new version is downloaded and ready                                  */
  /* ------------------------------------------------------------------ */
  function say(m) { if (typeof window.toast === "function") window.toast(m); }
  function updateBar(html, buttons) {
    let el = document.getElementById("bounty-update");
    if (el) el.remove();
    if (!html) return;
    el = document.createElement("div");
    el.id = "bounty-update"; el.className = "banner"; el.setAttribute("role", "status");
    el.style.cssText = "position:fixed;left:50%;top:72px;transform:translateX(-50%);z-index:110;width:max-content;max-width:min(92vw,620px);margin:0";
    el.innerHTML = "<span>" + html + "</span>";
    buttons.forEach(([label, pri, fn]) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "btn" + (pri ? " pri" : ""); b.textContent = label;
      b.addEventListener("click", () => { if (fn) fn(); el.remove(); });
      el.appendChild(b);
    });
    document.body.appendChild(el);
  }
  const escHtml = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
  let shownReady = "";
  function onUpdate(s) {
    if (!s || typeof s !== "object") return;
    const v = escHtml(s.version);
    if (s.state === "ready" && (s.manual || shownReady !== s.version)) {
      shownReady = s.version;
      updateBar(`<b>Bounty TCG ${v} is ready.</b> ${s.notes ? escHtml(s.notes) + " " : ""}Restart to play it, or keep playing and it starts next time.`,
        [["Restart now", true, () => desk.restartToUpdate()], ["Later", false, null]]);
    } else if (s.state === "needs-download") {
      if (s.manual || shownReady !== s.version) {
        shownReady = s.version;
        updateBar(`<b>Bounty TCG ${v} is out.</b> This one needs a fresh download of the app.`,
          [["Open download page", true, () => window.open(s.url)], ["Later", false, null]]);
      }
    } else if (s.manual) {
      if (s.state === "checking") say("Checking for updates…");
      else if (s.state === "current") say(`You have the newest version (${s.version}).`);
      else if (s.state === "error") say("Couldn't check for updates. Check your internet connection and try again.");
    }
  }
  if (desk && desk.onUpdate) {
    desk.onUpdate(onUpdate);
    const late = () => desk.updateState().then(onUpdate).catch(() => {});
    if (document.readyState === "complete") late(); else window.addEventListener("load", late);
  }

  const table = {room: roomNS, db: dbNS, assets: assetsNS, user: userNS, sample: sampleNS || null};
  window.claude = Object.freeze({
    use: async name => table[name] || null
  });
  window.BountyRuntime = {seedReady, openKeyDialog};
})();
