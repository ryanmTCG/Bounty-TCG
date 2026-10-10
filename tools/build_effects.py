#!/usr/bin/env python3
"""Builds page/effects.json, the card abilities the game uses without asking Claude to read the card.

Usage: python3 tools/build_effects.py <folder of card JSON files>

The folder holds one JSON file per card from the Punk Records dataset (English cards, generated from
the official card list): https://github.com/buhbbl/punk-records (english/cards/<pack>/<card>.json).
Each card's effect and trigger text is split into abilities in the same shape the game asks Claude
for (see FX_PROMPT in page/bounty-tcg.html). Clauses the rules below don't recognise become "other"
steps, which the game shows as text for the player to carry out on the board.
"""
import glob, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "page", "effects.json")

TIMING = {
    "On Play": "onPlay", "When Attacking": "whenAttacking", "On Your Opponent's Attack": "onOppAttack",
    "On Block": "onBlock", "On K.O.": "onKO", "Activate: Main": "activateMain", "Main": "main",
    "Counter": "counter", "End of Your Turn": "endOfTurn", "Your Turn": "yourTurn",
}
CONDITION = {"Once Per Turn", "Opponent's Turn", "End of Your Opponent's Turn"}
KEYWORD = {"Blocker", "Rush", "Rush: Character", "Double Attack", "Banish", "Unblockable"}
HEADER_TAG = r"\[(?:%s|DON!! x\d+)\]" % "|".join(re.escape(t) for t in list(TIMING) + list(CONDITION) + list(KEYWORD) + ["Trigger"])
# an ability starts at a run of header tags at the start of the text or right after a sentence ends
HEADER = re.compile(r"(?:(?<=^)|(?<=[.)]\s)|(?<=[.)]))\s*((?:%s(?:\s*/\s*|\s*))+)" % HEADER_TAG)
QUAL = r"(?:\{[^}]+\} type |\[[^\]]+\] |(?:red|green|blue|purple|black|yellow) |rested |active )*"
NUM = {"a": 1, "an": 1, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5}


def num(s):
    s = (s or "").strip().lower()
    return int(s) if s.isdigit() else NUM.get(s, 1)


def limits(clause):
    cost = re.search(r"with a (?:base )?cost of (\d+) or less", clause)
    power = re.search(r"with (\d+) (?:base )?power or less", clause)
    return (int(cost.group(1)) if cost else None, int(power.group(1)) if power else None)


def target(clause):
    """who/how many a targeting clause points at: (who, n, upTo, all, ld) or None."""
    m = re.search(r"\b(all|up to (\w+)|(\w+)) of your opponent's (?:%s)(Leader or Character cards?|Characters?|Leader)" % QUAL, clause, re.I)
    if m:
        kind = m.group(4).lower()
        if m.group(1).lower() == "all": return ("opp", 1, False, True, "leader" in kind)
        n = num(m.group(2) or m.group(3))
        return ("opp", n, bool(m.group(2)), False, "leader" in kind)
    if re.search(r"\byour opponent's Leader\b", clause, re.I): return ("opp", 1, False, False, True)
    m = re.search(r"\b(all|up to (\w+)|(\w+)) of your (?:%s)(Leader or Character cards?|Characters?|Leader)\b" % QUAL, clause, re.I)
    if m:
        kind = m.group(4).lower()
        if m.group(1).lower() == "all": return ("own", 1, False, True, "leader" in kind)
        n = num(m.group(2) or m.group(3))
        return ("own", n, bool(m.group(2)), False, "leader" in kind or bool(re.search(r"your Leader or", clause, re.I)))
    if re.search(r"\byour Leader\b", clause, re.I) and not re.search(r"\bif your Leader\b", clause, re.I): return ("own", 1, False, False, True)
    return None


def step(clause):
    """One clause of an ability as a step the game can carry out, or an "other" step."""
    c = clause.strip()
    base = {"text": c}
    low = c.lower()
    cost, power = limits(c)
    if re.search(r"\bdraw (\w+) cards?\b", low) and not re.search(r"\b(if|when) .*draw", low):
        m = re.search(r"\bdraw (\w+) cards?\b", low)
        return dict(base, a="draw", who="own", n=num(m.group(1)))
    m = re.search(r"\btrash (\w+) cards? from your hand\b", low)
    if m and "your opponent" not in low[:m.start()]:
        return dict(base, a="discard", who="own", n=num(m.group(1)), upTo=False)
    m = re.search(r"\blook at (\w+) cards? from the top of your deck\b", low)
    if m: return dict(base, a="look", who="own", n=num(m.group(1)))
    m = re.search(r"\badd (up to )?(\w+) don!! cards? from your don!! deck", low)
    if m: return dict(base, a="don", who="own", n=num(m.group(2)), rested="rest" in low[m.end():])
    m = re.search(r"\bgive (?:up to )?(\w+) (rested )?don!! cards?", low)
    if m and "your opponent" not in low:
        t = target(c) or ("own", 1, True, False, True)
        return dict(base, a="giveDon", who="own", n=num(m.group(1)), rested=bool(m.group(2)), ld=t[4])
    m = re.search(r"\breturn (\w+) don!! cards? from your field to your don!! deck", low)
    if m: return dict(base, a="returnDon", who="own", n=num(m.group(1)))
    # power changes: "Give up to 1 of your opponent's Characters -2000 power", "Up to 1 of your Characters gains +1000 power"
    m = re.search(r"([+\-−])(\d{3,5}) power", c)
    if m and not re.search(r"\bthis (character|leader|card)\b", low[:m.start()]):
        t = target(c)
        if t:
            v = int(m.group(2)) * (-1 if m.group(1) != "+" else 1)
            return dict(base, a="pwr", who=t[0], n=v, upTo=t[2], all=t[3], ld=t[4], cost=cost, power=power)
    # the verb must be followed straight away by who it targets, so costs like "you may rest this Character" don't count
    who = r"(?:up to \w+ |all |\w+ )?of your (?:opponent's )?%s(?:leader or character cards?|characters?|leader)|your (?:opponent's )?leader" % QUAL.lower()
    verbs = [("ko", r"\bk\.o\. (?:%s)" % who), ("rest", r"\brest (?:%s)" % who), ("stand", r"\bset (?:%s)[^.]* as active" % who),
             ("bounce", r"\breturn (?:%s)[^.]* to (?:the|its|their) owner'?s?'? hand" % who), ("bottom", r"\bplace (?:%s)[^.]* at the bottom of (?:the|its|their) owner'?s?'? deck" % who)]
    for a, rx in verbs:
        m = re.search(rx, low)
        if not m: continue
        t = target(c[m.start():])
        if not t: continue
        return dict(base, a=a, who=t[0], n=t[1], upTo=t[2], all=t[3], ld=t[4] if a in ("rest", "stand") else False, cost=cost, power=power)
    return dict(base, a="other")


def clauses(body):
    """Split an ability's text into the clauses that become steps."""
    out = []
    for sent in re.split(r"(?<=\.)\s+(?=[A-Z])", body.strip()):
        sent = re.sub(r"^Then,\s*", "", sent)
        if out and re.match(r"(?:place|put|trash|add) the rest\b|reveal\b", sent, re.I) and re.search(r"look at", out[-1], re.I):
            out[-1] = out[-1] + " " + sent; continue
        if re.search(r"\blook at\b", sent, re.I): out.append(sent); continue
        # "You may <cost>: <effect>" is two steps, the cost first
        m = re.match(r"((?:[^:]*?,\s*)?you may [^:]+):\s*(.+)$", sent, re.I)
        if m: out.append(m.group(1).strip() + "."); sent = m.group(2)
        parts = re.split(r",? and (?=(?:trash|draw|rest|K\.O\.|give|add|return|set|place)\b(?! (?:it|them|that|those)\b))", sent)
        out.extend(p.strip().rstrip(".") + "." for p in parts if p.strip())
    return out


def abilities(text, is_trigger=False):
    text = (text or "").strip()
    if not text or text == "-": return [], False
    # "this Character gains [Blocker]" when a condition holds still makes it a possible blocker
    blocker = bool(re.search(r"\bgains? \[Blocker\]", text))
    heads = list(HEADER.finditer(text))
    chunks = []
    if not heads or heads[0].start(1) > 0:
        pre = text[:heads[0].start(1)] if heads else text
        if pre.strip(): chunks.append(([], pre, pre.strip()))
    for i, h in enumerate(heads):
        tags = re.findall(r"\[([^\]]+)\]", h.group(1))
        body = text[h.end(1):heads[i + 1].start(1) if i + 1 < len(heads) else len(text)]
        chunks.append((tags, body, text[h.start(1):heads[i + 1].start(1) if i + 1 < len(heads) else len(text)].strip()))
    out = []
    for tags, body, raw in chunks:
        body = body.strip()
        kws = [t for t in tags if t in KEYWORD]
        if "Blocker" in kws: blocker = True
        timings = [TIMING[t] for t in tags if t in TIMING] or (["trigger"] if "Trigger" in tags or is_trigger else [])
        don = next((int(t[7:]) for t in tags if t.startswith("DON!! x")), 0)
        # a keyword tag followed only by its reminder text has nothing to carry out
        if kws and not timings and (not body or re.fullmatch(r"\([^()]*\)\.?", body)): continue
        donMinus = 0
        m = re.match(r"DON!!\s*[−\-](\d+)\s*(?:\([^)]*\))?\s*:\s*", body)
        if m: donMinus = int(m.group(1)); body = body[m.end():]
        body = re.sub(r"^\([^)]*\)\s*", "", body) if kws else body
        if not body: continue
        steps = [step(c) for c in clauses(body)]
        if all(s["a"] == "other" for s in steps): steps = []
        for t in timings or ["other"]:
            ab = {"t": t, "text": raw}
            if don: ab["don"] = don
            if donMinus: ab["donMinus"] = donMinus
            if steps: ab["steps"] = steps
            out.append(ab)
    return out, blocker


def compact(step):
    out = {"a": step["a"]}
    for k, v in step.items():
        if k == "a" or v is None: continue
        if k == "upTo" and v is True: continue
        if k == "who" and v == "opp": continue
        if k in ("rested", "all") and v is False: continue
        if k == "n" and v == 1: continue
        out[k] = v
    return out


def main(folder):
    effects = {}
    for f in sorted(glob.glob(os.path.join(folder, "**", "*.json"), recursive=True)):
        c = json.load(open(f, encoding="utf-8"))
        code = c.get("id") or ""
        if not re.fullmatch(r"[A-Z0-9]{1,8}-\d{2,4}", code): continue
        ab, blocker = abilities(c.get("effect"))
        tab, _ = abilities(c.get("trigger"), is_trigger=True)
        for a in ab + tab:
            if "steps" in a: a["steps"] = [compact(s) for s in a["steps"]]
        entry = {"abilities": ab + tab}
        if blocker: entry["blocker"] = True
        effects[code] = entry
    json.dump(effects, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    print(f"page/effects.json: {len(effects)} cards, {os.path.getsize(OUT) // 1024} KB")


if __name__ == "__main__":
    if len(sys.argv) != 2: sys.exit(__doc__)
    main(sys.argv[1])
