#!/usr/bin/env python3
"""Check the day's top meta decks and write meta/topdecks.json, which every copy of the game reads at launch.

    python3 tools/topdecks.py candidates.json [--dry-run]

candidates.json (written by whoever looked up the meta, usually the daily job):
    {"date": "2026-10-18", "decks": [
        {"name": "Purple Enel", "leader": "OP15-058", "list": "4xOP12-071\\n4 OP15-061\\nOP15-066 x2 ...",
         "winrate": "69.6% win rate over 50+ games", "source": "1st place, Japanese store event, Oct 12 (onepiecetopdecks.com)"},
        ...]}

Each deck has to be Standard legal by the game's own rules (read from page/bounty-tcg.html: bans, banned pairs,
Block 1 rotation, sets not out yet, the Leader's colors), every card has to be in data/names, and the list has to be
exactly 50 cards with at most 4 of each. Decks that fail are left out and listed. Fewer than 5 good decks and the
file is left as it was, so a bad day never empties the list players see.
"""
import json, re, sys, datetime, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
PAGE = (ROOT / "page" / "bounty-tcg.html").read_text(encoding="utf-8")
OUT = ROOT / "meta" / "topdecks.json"
CODE = re.compile(r"^[A-Z]{1,4}\d{0,3}-\d{2,4}$")


def page_const(pat):
    m = re.search(pat, PAGE)
    if not m:
        sys.exit("Couldn't find %r in the page" % pat)
    return m.group(1)


BANNED = dict(re.findall(r'\["([A-Z0-9-]+)", "([0-9-]*)"\]', page_const(r"const BANNED = new Map\(\[(.*?)\]\);")))
BAN_PAIRS = re.findall(r'\["([A-Z0-9-]+)", "([A-Z0-9-]+)"\]', page_const(r"const BAN_PAIRS = \[(.*?)\];"))
BLOCK1 = re.compile(page_const(r"const BLOCK1 = /(.*?)/;"))
BLOCK1_KEPT = set(page_const(r'const BLOCK1_KEPT = new Set\("(.*?)"\.split').split())
RELEASES = dict(re.findall(r'([A-Z0-9]+): "(\d{4}-\d{2}-\d{2})"', page_const(r"const RELEASES = (\{.*?\});")))

CARDS = {}
for f in sorted((ROOT / "data" / "names").glob("*.json")):
    CARDS.update(json.loads(f.read_text(encoding="utf-8")).get("cards", {}))


def colors(code):
    return [c.strip() for c in str(CARDS.get(code, {}).get("c", "")).split("/") if c.strip()]


def parse_list(txt):
    rows = {}
    for line in re.split(r"[\n,;]+", str(txt or "")):
        line = line.strip()
        m = re.match(r"^(\d{1,2})\s*[x×*]?\s*([A-Z]{1,4}\d{0,3}-\d{2,4})\b", line) or None
        if m:
            n, c = int(m.group(1)), m.group(2)
        else:
            m = re.match(r"^([A-Z]{1,4}\d{0,3}-\d{2,4})\b\s*(?:[x×*:]\s*(\d{1,2}))?", line)
            if not m:
                continue
            c, n = m.group(1), int(m.group(2) or 1)
        rows[c] = rows.get(c, 0) + n
    return rows


def check(d, today):
    leader = str(d.get("leader", "")).strip().upper()[:12]
    if not CODE.match(leader) or CARDS.get(leader, {}).get("t") != "Leader":
        return None, "the Leader %r isn't a Leader card in data/names" % leader
    rows = parse_list(d.get("list"))
    rows.pop(leader, None)
    probs = []
    for c, n in rows.items():
        if c not in CARDS:
            probs.append(c + " isn't in data/names")
        elif CARDS[c].get("t") == "Leader":
            probs.append(c + " is a Leader")
        if n > 4:
            probs.append("%d copies of %s" % (n, c))
    total = sum(rows.values())
    if total != 50:
        probs.append("%d cards, not 50" % total)
    lc = colors(leader)
    for c in [leader] + list(rows):
        if c in BANNED and (not BANNED[c] or today >= BANNED[c]):
            probs.append(c + " is banned")
        if BLOCK1.match(c) and c not in BLOCK1_KEPT:
            probs.append(c + " rotated out of Standard")
        rel = RELEASES.get(c.split("-")[0])
        if rel and today < rel:
            probs.append(c + " isn't released yet")
        if c != leader and c in CARDS and lc and not set(colors(c)) & set(lc):
            probs.append(c + " isn't the Leader's color")
    for a, b in BAN_PAIRS:
        if a in rows and b in rows or (a == leader and b in rows) or (b == leader and a in rows):
            probs.append(a + " with " + b + " is a banned pair")
    if probs:
        return None, "; ".join(probs[:6])
    clip = lambda s, n: re.sub(r"\s+", " ", str(s or "")).strip()[:n]
    packed = leader + "|" + " ".join("%s*%d" % (c, n) for c, n in rows.items())
    return {"n": clip(d.get("name"), 40) or CARDS[leader].get("n", leader), "w": clip(d.get("winrate"), 90),
            "e": clip(d.get("source"), 140), "d": packed}, None


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not args:
        sys.exit(__doc__)
    src = json.loads(pathlib.Path(args[0]).read_text(encoding="utf-8"))
    today = datetime.date.today().isoformat()
    date = src.get("date") if re.match(r"^\d{4}-\d{2}-\d{2}$", str(src.get("date", ""))) else today
    good, seen = [], set()
    for d in (src.get("decks") or [])[:20]:
        out, why = check(d if isinstance(d, dict) else {}, today)
        name = (d or {}).get("name", "?") if isinstance(d, dict) else "?"
        if why:
            print("left out %s: %s" % (name, why))
            continue
        ld = out["d"].split("|")[0]
        if ld in seen:
            print("left out %s: a second deck for %s" % (name, ld))
            continue
        seen.add(ld)
        good.append(out)
        print("ok       %s (%s)" % (out["n"], ld))
    good = good[:10]
    print("%d good decks" % len(good))
    if len(good) < 5:
        print("Fewer than 5 good decks, so %s stays as it was." % OUT.relative_to(ROOT))
        sys.exit(1)
    if "--dry-run" in sys.argv:
        return
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps({"v": 1, "t": date, "decks": good}, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print("wrote", OUT.relative_to(ROOT))


if __name__ == "__main__":
    main()
