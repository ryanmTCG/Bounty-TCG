#!/usr/bin/env python3
"""Builds page/effects.json, the card abilities the game uses without asking Claude to read the card.

Usage: python3 tools/build_effects.py <folder of card JSON files> [--report]

The folder holds one JSON file per card from the Punk Records dataset (English cards, generated from
the official card list): https://github.com/buhbbl/punk-records (english/cards/<pack>/<card>.json).
Each card's effect and trigger text is split into abilities in the same shape the game asks Claude
for (see FX_PROMPT in page/bounty-tcg.html). Clauses the rules below don't recognise become "other"
steps, which the game shows as text for the player to carry out on the board. --report prints the
most common of those, which is where to look when teaching the rules a new kind of effect.

Always-on effects ("[DON!! x1] [Your Turn] All of your Characters gain +1000 power", "If you have 2 or
less Life cards, this Character gains +2000 power") get an "s" entry the game adds to power and cost
while the condition holds.

Cards the dataset doesn't have yet (a set that just came out) can be added to data/card-text-extra.json
as {"cards": {"OP18-001": {"effect": "...", "trigger": null}}}, read off the card images.
"""
import collections, glob, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "page", "effects.json")
# card text read off card images for sets the dataset doesn't have yet; the dataset wins once it has the card
EXTRA = os.path.join(ROOT, "data", "card-text-extra.json")

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
# ➀ / ① before a colon: rest that many DON!! as the cost
CIRCLED = {chr(0x2780 + i): i + 1 for i in range(10)} | {chr(0x2460 + i): i + 1 for i in range(10)}
SELF = r"this (?:character|leader|stage|card)"
# keywords a card can be given; the game shows and applies these in battle
KW_LETTER = {"rush": "r", "double attack": "d", "banish": "b", "unblockable": "u"}


def num(s):
    s = (s or "").strip().lower()
    return int(s) if s.isdigit() else NUM.get(s, 1)


def limits(clause):
    cost = re.search(r"with a (?:base )?cost of (\d+) or less", clause)
    power = re.search(r"with (\d+) (?:base )?power or less", clause)
    return (int(cost.group(1)) if cost else None, int(power.group(1)) if power else None)


def target(clause):
    """who/how many a targeting clause points at: (who, n, upTo, all, ld) or None. who "any" is a Character on either side."""
    m = re.search(r"\b(all|up to (\w+)|(\w+)) of your opponent's (?:%s)(Leader or Character cards?|Characters?|Leader)" % QUAL, clause, re.I)
    if m:
        kind = m.group(4).lower()
        if m.group(1).lower() == "all": return ("opp", 1, False, True, "leader" in kind)
        n = num(m.group(2) or m.group(3))
        return ("opp", n, bool(m.group(2)), False, "leader" in kind)
    if re.search(r"\byour opponent's Leader\b", clause, re.I): return ("opp", 1, False, False, True)
    m = re.search(r"\b(all|up to (\w+)|(\w+)) of your (?:%s)(Leader or Character cards?|Characters?|Leader|cards?)\b" % QUAL, clause, re.I)
    if m:
        kind = m.group(4).lower()
        if kind.startswith("card"): kind = "leader or character"
        if m.group(1).lower() == "all": return ("own", 1, False, True, "leader" in kind)
        n = num(m.group(2) or m.group(3))
        return ("own", n, bool(m.group(2)), False, "leader" in kind or bool(re.search(r"your Leader or", clause, re.I)))
    if re.search(r"\byour Leader\b", clause, re.I) and not re.search(r"\bif your Leader\b", clause, re.I): return ("own", 1, False, False, True)
    m = re.search(r"\b(all|up to (\w+)) (?:%s)Characters?\b" % QUAL, clause, re.I)
    if m:
        if m.group(1).lower() == "all": return ("any", 1, False, True, False)
        return ("any", num(m.group(2)), True, False, False)
    return None


def split_cond(c):
    """("If you have 2 or less Life cards, draw 1 card" -> core "draw 1 card"). The game checks the condition itself."""
    m = re.match(r"(?:then,\s*)?if ([^,]+),\s*(.+)$", c, re.I)
    return m.group(2) if m else re.sub(r"^then,\s*", "", c, flags=re.I)


# power that lasts through the opponent's next turn, not just this one
NEXT_TURN = r"until the (?:start of your next turn|end of your opponent's next turn)"
def next_turn(low): return {"nx": True} if re.search(NEXT_TURN, low) else {}


def self_step(core, base):
    """Steps that act on the card itself: "You may rest this Character", "Play this card", "This Leader gains +2000 power"."""
    low = core.lower()
    battle = "during this battle" in low
    if re.search(r"\bfor every\b", low): return None
    if re.match(r"(?:you may )?rest %s(?:\.|$)" % SELF, low): return dict(base, a="rest", self=True)
    if re.match(r"(?:you may )?trash %s(?:\.|$)" % SELF, low): return dict(base, a="trash", self=True)
    if re.match(r"(?:you may )?return %s to (?:the owner's|your) hand" % SELF, low): return dict(base, a="bounce", self=True)
    if re.match(r"(?:you may )?place %s at the bottom of (?:the owner's|your) deck" % SELF, low): return dict(base, a="bottom", self=True)
    if re.match(r"(?:you may )?set %s as active(?:\.|$)" % SELF, low): return dict(base, a="stand", self=True)
    m = re.match(r"(?:you may )?play this (?:character |stage )?card(?: from your trash)?( rested)?(?:\.|$)", low)
    if m: return dict(base, a="playSelf", rested=bool(m.group(1)))
    if re.match(r"(?:you may )?add this card to your hand", low): return dict(base, a="handSelf")
    m = re.match(r"activate this card's \[(main|on play|counter)\] effect", low)
    if m: return dict(base, a="act", k={"main": "main", "on play": "onPlay", "counter": "counter"}[m.group(1)])
    m = re.match(r"%s gains \[(rush|double attack|banish|unblockable)\](?: and ([+\-−])(\d+) power)? during this turn" % SELF, low)
    if m: return dict(base, a="kw", self=True, k=KW_LETTER[m.group(1)], n=int(m.group(3) or 0) * (-1 if m.group(2) in ("-", "−") else 1))
    m = re.match(r"%s gains ([+\-−])(\d+) power(?: during this (?:turn|battle)| %s)?(?:\.|$)" % (SELF, NEXT_TURN), low)
    if m: return dict(base, a="pwr", self=True, n=int(m.group(2)) * (1 if m.group(1) == "+" else -1), battle=battle, **next_turn(low))
    m = re.match(r"give %s ([+\-−])(\d+) power(?: during this (?:turn|battle))?(?:\.|$)" % SELF, low)
    if m: return dict(base, a="pwr", self=True, n=int(m.group(2)) * (1 if m.group(1) == "+" else -1), battle=battle)
    m = re.match(r"give %s (?:up to )?(\w+) (rested )?don!! cards?" % SELF, low)
    if m: return dict(base, a="giveDon", self=True, who="own", n=num(m.group(1)), rested=bool(m.group(2)))
    return None


def step(clause, pay=False):
    """One clause of an ability as a step the game can carry out, or an "other" step."""
    c = clause.strip()
    base = {"text": c}
    if pay: base["pay"] = True
    core = split_cond(c)
    low = c.lower()
    cl = core.lower()
    cost, power = limits(c)
    s = self_step(core, base)
    if s: return s
    if re.search(r"\bfor every\b", cl): return dict(base, a="other")
    m = re.match(r"reveal (\w+) cards? from the top of your (deck|life cards)\.?$", cl)
    if m: return dict(base, a="reveal", n=num(m.group(1)), lf=m.group(2) != "deck")
    # "You may reveal 2 Events from your hand": shown to the opponent, they stay in your hand
    m = re.match(r"(?:you may )?reveal (up to )?(?:a total of )?(\w+) (.+?) from your hand\.?$", core.strip(), re.I)
    if m: return dict(base, a="revealHand", n=num(m.group(2)), f=m.group(3), upTo=bool(m.group(1)))
    m = re.search(r"\bdraw (\w+) cards?\b", cl)
    if m and not re.search(r"\bwhen (?:you|your opponent) draws?\b", low): return dict(base, a="draw", who="own", n=num(m.group(1)))
    m = re.search(r"\btrash (up to )?(\w+) ((?:[^.]*? )?)(?:cards?|events?|characters?|stages?) ?((?:with [^.]*?)?)from your hand\b", cl)
    if m and "your opponent" not in cl[:m.start()]:
        return dict(base, a="discard", who="own", n=num(m.group(2)), upTo=bool(m.group(1)) or cl.startswith("you may"))
    m = re.search(r"\blook at (\w+) cards? from the top of your deck\b", cl)
    if m: return dict(base, a="look", who="own", n=num(m.group(1)))
    m = re.search(r"\badd (up to )?(\w+) (additional )?don!! cards?(?: from your don!! deck)?", cl)
    if m: return dict(base, a="don", who="own", n=num(m.group(2)), rested="rest" in cl[m.end():])
    m = re.search(r"\bgive (?:up to )?(\w+) (rested )?don!! cards?", cl)
    if m and "your opponent" not in cl:
        t = target(c) or ("own", 1, True, False, True)
        return dict(base, a="giveDon", who="own", n=num(m.group(1)), rested=bool(m.group(2)), ld=t[4])
    m = re.search(r"\breturn (\w+)( or more)? (?:of your (?:active )?)?don!! cards?(?: from your field)? to your don!! deck", cl)
    if m: return dict(base, a="returnDon", who="own", n=num(m.group(1)), upTo=False)
    # DON!! in the cost area: "You may rest 2 of your DON!! cards", "Set up to 2 of your DON!! cards as active"
    m = re.match(r"(?:you may )?rest (\w+) of your don!! cards(?:\.|$)", cl)
    if m: return dict(base, a="restDon", n=num(m.group(1)))
    m = re.match(r"set up to (\w+) of your don!! cards? as active(?:\.|$)", cl)
    if m: return dict(base, a="standDon", n=num(m.group(1)))
    # resting your own cards as a cost: "You may rest 1 of your cards" (a DON!! card counts), "You may rest your 1 Leader",
    # "rest 1 of your {Dressrosa} type Leader or Stage cards", "rest 1 of your [Uta] cards", "rest 1 of your Characters"
    if re.match(r"(?:you may )?rest your (?:\w+ )?leader(?:\.|$)", cl): return dict(base, a="rest", who="own", n=1, upTo=False, ld=True)
    m = re.match(r"(?:you may )?rest (\w+) of your (?!opponent's|don!!)(.*?)(cards?|characters?)(?:\.|$)", cl)
    if m:
        what = m.group(2) + m.group(3)
        return dict(base, a="rest", who="own", n=num(m.group(1)), upTo=False, ld=not re.fullmatch(r"characters?", what), dn=True if what == "cards" else None)
    m = re.match(r"rest up to (\w+) of your opponent's don!! cards?(?:\.|$)", cl)
    if m: return dict(base, a="oppDon", n=num(m.group(1)))
    m = re.search(r"your opponent returns (\w+) don!! cards? from their field to their don!! deck", cl)
    if m: return dict(base, a="oppRetDon", n=num(m.group(1)))
    # the opponent's hand
    m = re.match(r"your opponent trashes (\w+) cards? from their hand", cl)
    if m: return dict(base, a="oppDiscard", n=num(m.group(1)))
    m = re.match(r"your opponent places (\w+) cards? from their hand at the bottom of their deck", cl)
    if m: return dict(base, a="oppHandDeck", n=num(m.group(1)))
    # Life
    m = re.search(r"\badd (up to )?(\w+) cards? from (?:the top( or bottom)? of your life cards|your life area) to your hand", cl)
    if m: return dict(base, a="lifeHand", n=num(m.group(2)), tb=bool(m.group(3)))
    m = re.search(r"\badd (up to )?(\w+) cards? from the top of your deck to the top of your life cards", cl)
    if m: return dict(base, a="deckLife", n=num(m.group(2)))
    m = re.search(r"\badd (up to )?(\w+) (?:[^.]*? )?(?:cards?|characters?)(?: with [^.]*?)? from your hand to the top of your life cards( face-up)?", cl)
    if m: return dict(base, a="handLife", n=num(m.group(2)), up=True if m.group(3) else None)
    # face-up Life: "You may turn 1 card from the top of your Life cards face-up", "turn all of your Life cards face-down"
    m = re.match(r"(?:you may )?turn (all|\w+) (?:of your (?:face-up )?life cards|cards? from the top(?: or bottom)? of your life cards) face-(up|down)(?:\.|$)", cl)
    if m: return dict(base, a="lifeUp" if m.group(2) == "up" else "lifeDown", who="own", n=99 if m.group(1) == "all" else num(m.group(1)), all=m.group(1) == "all")
    m = re.search(r"\btrash (up to )?(\w+) cards? from the top( or bottom)? of your life cards", cl)
    if m: return dict(base, a="lifeTrash", who="own", n=num(m.group(2)))
    m = re.search(r"\btrash up to (\w+) cards? from the top of your opponent's life cards", cl)
    if m: return dict(base, a="lifeTrash", n=num(m.group(1)))
    # deck and trash
    m = re.search(r"\btrash (up to )?(\w+) cards? from the top of your deck", cl)
    if m: return dict(base, a="mill", n=num(m.group(2)))
    m = re.search(r"\bplace (\w+) cards? from your hand at the (top or bottom|bottom|top) of your deck", cl)
    if m: return dict(base, a="handDeck", n=num(m.group(1)), top=m.group(2) != "bottom")
    m = re.search(r"\b(?:place|return) (up to )?(\w+) (.*?)cards?(?: with [^.]*?)? from your trash (?:at|to) the bottom of your deck", cl)
    if m: return dict(base, a="trashDeck", n=num(m.group(2)), upTo=bool(m.group(1)))
    m = re.search(r"\badd (up to )?(\w+) (.+?) from your trash to your hand", cl)
    if m: return dict(base, a="trashHand", n=num(m.group(2)))
    if re.match(r"shuffle your deck(?:\.|$)", cl): return dict(base, a="shuffle")
    if re.search(r"\bplay up to (\d+) (.+?) from your (hand|trash)", cl): return dict(base, a="play")
    m = re.match(r"your opponent cannot activate (?:a |up to \w+ )?\[blocker\](?: character that has (\d+) power or less)? during this (?:battle|turn)", cl)
    if m: return dict(base, a="noBlock", power=int(m.group(1)) if m.group(1) else None)
    m = re.match(r"you cannot play character cards(?: with a base cost of (\d+) or more)? during this turn", cl)
    if m: return dict(base, a="noPlay", cost=int(m.group(1)) if m.group(1) else None)
    m = re.match(r"up to (\w+) of your (?:%s)(leader or character cards?|characters?|leader) gains? \[(rush|double attack|banish|unblockable)\] during this turn" % QUAL.lower(), cl)
    if m: return dict(base, a="kw", who="own", n=num(m.group(1)), k=KW_LETTER[m.group(3)], ld="leader" in m.group(2))
    # cost changes: "Give up to 1 of your opponent's Characters −2 cost during this turn"
    m = re.search(r"([+\-−])(\d+) cost\b", c)
    if m and not re.search(r"\bthis (character|leader|card)\b|in your hand", low[:m.start()]):
        t = target(c)
        if t and t[0] != "any":
            v = int(m.group(2)) * (-1 if m.group(1) != "+" else 1)
            return dict(base, a="cost", who=t[0], n=v, upTo=t[2], all=t[3], ld=False, cost=cost, power=power, cnt=t[1] if t[1] > 1 else None)
    # power changes: "Give up to 1 of your opponent's Characters -2000 power", "Up to 1 of your Characters gains +1000 power"
    m = re.search(r"([+\-−])(\d{3,5}) power", c)
    if m and not re.search(r"\bthis (character|leader|card)\b", low[:m.start()]):
        t = target(c)
        if t and t[0] != "any":
            v = int(m.group(2)) * (-1 if m.group(1) != "+" else 1)
            return dict(base, a="pwr", who=t[0], n=v, upTo=t[2], all=t[3], ld=t[4], cost=cost, power=power, battle="during this battle" in cl, cnt=t[1] if t[1] > 1 else None, **next_turn(cl))
    # "Up to 1 of your opponent's rested Characters ... will not become active in your opponent's next Refresh Phase",
    # "... cannot attack until the end of your opponent's next turn": a mark on the card
    for k, rx in (("fz", r"will not become active"), ("na", r"cannot attack(?! (?:a |your opponent's )?(?:leader|characters?|active))")):
        if re.search(rx, cl):
            t = target(core)
            if t and t[0] == "opp" and re.match(r"(?:up to|all|\w+ of your opponent)", cl):
                return dict(base, a="mark", k=k, who="opp", n=t[1], upTo=t[2], all=t[3], ld=t[4], cost=cost, power=power, now="during this turn" in cl)
    # the verb must be followed straight away by who it targets, so costs like "you may rest this Character" don't count
    who = r"(?:up to \w+ |all |\w+ )?of your (?:opponent's )?%s(?:leader or character cards?|characters?|leader)|your (?:opponent's )?leader|(?:up to \w+ |all )%scharacters?" % (QUAL.lower(), QUAL.lower())
    verbs = [("ko", r"\bk\.o\. (?:%s)" % who), ("rest", r"\brest (?:%s)" % who), ("stand", r"\bset (?:%s)[^.]* as active" % who),
             ("bounce", r"\breturn (?:%s)[^.]* to (?:the|its|their) owner'?s?'? hand" % who), ("bottom", r"\bplace (?:%s)[^.]* at the bottom of (?:the|its|their) owner'?s?'? deck" % who),
             ("life", r"\b(?:add|place) (?:%s)[^.]* (?:to|at) the top(?: or bottom)? of (?:(?:the|its|their) owner'?s?'?|your opponent's|their) life cards" % who), ("trashCh", r"\btrash (?:%s)" % who)]
    for a, rx in verbs:
        m = re.search(rx, low)
        if not m: continue
        t = target(c[m.start():])
        if not t: continue
        if t[0] == "any" and a not in ("ko", "bounce", "bottom", "life", "rest"): continue
        return dict(base, a=a, who=t[0], n=t[1], upTo=t[2], all=t[3], ld=t[4] if a in ("rest", "stand") else False, cost=cost, power=power, up=True if a == "life" and "face-up" in low else None)
    return dict(base, a="other")


def rv_step(c, pay):
    """A clause after "Reveal 1 card from the top of your deck (or Life cards)" that does something with that card:
    play it, add it to your hand, or put it back. None for anything else."""
    t = c.strip().rstrip(".")
    base = {"text": c.strip()}
    if pay: base["pay"] = True
    m = re.match(r"(?:if (?:that|the revealed) card[^,]*,\s*)?(?:you may )?play (?:that card|it)( rested)?$", t, re.I)
    if m: return dict(base, a="playRv", rested=bool(m.group(1)))
    m = re.match(r"play up to (\w+) (.+?)( rested)?$", t, re.I)
    if m and not re.search(r"\bfrom your\b", t, re.I): return dict(base, a="playRv", f=m.group(2), rested=bool(m.group(3)))
    m = re.match(r"add up to (\w+) (.+?) to your hand$", t, re.I)
    if m and not re.search(r"\bfrom your\b", m.group(2), re.I): return dict(base, a="addRv", f=m.group(2))
    m = re.match(r"place (?:the rest|the revealed card|it) at the (top or bottom|bottom|top) of your deck(?: in any order)?$", t, re.I)
    if m: return dict(base, a="rvPlace", top="top" in m.group(1).lower(), bot="bottom" in m.group(1).lower())
    if re.match(r"if you do, that character gains \[rush\] during this turn", t, re.I): return dict(base, a="rvKw", k="r")
    return None


def with_rv(cls):
    """Steps for clauses, reading the ones after a reveal as about the revealed card first."""
    out, rv = [], False
    for c, pay in cls:
        s = (rv_step(c, pay) if rv else None) or step(c, pay)
        if s["a"] == "reveal": rv = True
        out.append(s)
    return out


def clauses(body):
    """Split an ability's text into the clauses that become steps: [(text, pay)], pay marking a "You may ...:" cost."""
    out = []
    # "Reveal 1 card ... and place it at the top or bottom of your deck", "reveal 1 card ..., play up to 1 ...": one step each
    body = re.sub(r"(reveal \w+ cards? from the top of your deck) and place it at the ((?:top or )?bottom|top) of your deck", r"\1. Place the revealed card at the \2 of your deck", body, flags=re.I)
    body = re.sub(r"(reveal \w+ cards? from the top of your deck), (play|add) ", lambda m: m.group(1) + ". " + m.group(2).capitalize() + " ", body, flags=re.I)
    body = re.sub(r"\brest (\w+) of your DON!! cards and this (Character|Leader|Stage)\b", r"rest \1 of your DON!! cards and rest this \2", body)
    body = re.sub(r"\brest this (Character|Leader|Stage|card) and (\w+) of your\b", r"rest this \1 and rest \2 of your", body)
    body = re.sub(r"\b(rest|Rest|K\.O\.) this (Character|Leader) and (up to \w+ of your opponent's)", lambda m: f"{m.group(1)} this {m.group(2)} and {m.group(1).lower() if m.group(1) == 'Rest' else m.group(1)} {m.group(3)}", body)
    for sent in re.split(r"(?<=\.)\s+(?=[A-Z])", body.strip()):
        sent = re.sub(r"^Then,\s*", "", sent)
        if out and re.match(r"(?:place|put|trash|add) the rest\b|reveal\b|play up to\b", sent, re.I) and re.search(r"look at", out[-1][0], re.I):
            out[-1] = (out[-1][0] + " " + sent, out[-1][1]); continue
        if re.search(r"\blook at\b", sent, re.I): out.append((sent, False)); continue
        # "You may <cost>: <effect>" is two steps, the cost first
        m = re.match(r"((?:[^:]*?,\s*)?you may [^:]+):\s*(.+)$", sent, re.I)
        if m:
            for p in re.split(r",? and (?=(?:trash|rest|return|place|reveal|turn)\b(?! (?:it|them|that|those)\b))", m.group(1)):
                if p.strip(): out.append((p.strip().rstrip(".") + ".", True))
            sent = m.group(2)
        parts = [p.strip() for p in re.split(r",? and (?=(?:trash|draw|rest|K\.O\.|give|add|return|set|place|play)\b(?! (?:it|them|that|those)\b))", sent) if p.strip()]
        # "If X, A and B": B only happens when X is so, too
        cm = re.match(r"(?:then,\s*)?(if [^,]+,)\s", parts[0], re.I) if parts else None
        if cm: parts = parts[:1] + [p if re.match(r"if\b", p, re.I) else cm.group(1) + " " + p for p in parts[1:]]
        out.extend((p.rstrip(".") + ".", False) for p in parts)
    return out


def steps_of(body):
    """The steps of an ability's text. "Choose one: • A • B" becomes one "choose" step holding each option's steps."""
    # the opponent picking is beyond the game: do it by hand
    if re.search(r"\bchooses one:", body, re.I): return [{"a": "other", "text": body.strip()}]
    m = re.search(r"\bchoose one:\s*(?=•)", body, re.I)
    if not m: return with_rv(clauses(body))
    head = body[:m.start()]
    # the sentence that says "choose one" may start with a condition ("If X, choose one:")
    cut = max(head.rfind(". "), head.rfind(": "))
    pre, lead = (head[:cut + 1], head[cut + 2:]) if cut >= 0 else ("", head)
    lead = re.sub(r"^Then,\s*", "", lead).strip()
    out = [step(c, pay) for c, pay in clauses(pre)] if pre.strip() else []
    # "You may <cost>: Choose one: ..." keeps the cost as the step to pay first
    if pre.strip().endswith(":"):
        p = pre.strip()[:-1]
        cut2 = p.rfind(". ")
        out = ([step(c, pay) for c, pay in clauses(p[:cut2 + 1])] if cut2 >= 0 else []) + [step(c, True) for c, _ in clauses(p[cut2 + 2 if cut2 >= 0 else 0:] + ".")]
    opts = []
    for o in [x.strip() for x in re.split(r"\s*•\s*", body[m.end():]) if x.strip()][:4]:
        st = [step(c, pay) for c, pay in clauses(o)]
        opts.append({"text": o, "steps": st})
    ch = {"a": "choose", "text": (lead + " choose one.").strip() if re.match(r"(?:if|draw)\b", lead, re.I) else "Choose one.", "opts": opts}
    # "Draw 1 card, then choose one:" keeps the draw as its own step
    if lead and not re.match(r"if\b", lead, re.I) and re.sub(r",?\s*then,?$", "", lead).strip():
        out.append(step(re.sub(r",?\s*then,?\s*$", "", lead).strip() + "."))
        ch["text"] = "Choose one."
    out.append(ch)
    return out


# ---------- always-on effects ----------
def static(body, tags):
    """An always-on power or cost change, or None. Read by the game (statB in page/bounty-tcg.html) while its condition holds."""
    b = re.sub(r"\s*\([^)]*\)", "", body).strip().rstrip(".")
    s = {}
    if "Your Turn" in tags: s["turn"] = "own"
    if "Opponent's Turn" in tags: s["turn"] = "opp"
    m = re.match(r"If (.+?), (?=(?:this|all|your|give)\b)(.+)$", b, re.I)
    if m: s["if"], b = m.group(1), m.group(2)
    # "this Character gains [Double Attack]" (kept), "gains [Blocker] and +1000 power", "gains +1000 power and cannot be K.O.'d by effects"
    m = re.match(r"((this (?:Character|Leader)|your Leader) gains )((?:\[[^\]]+\](?:,? and |, )?)+)(.*)$", b, re.I)
    if m:
        kw = [k for k in re.findall(r"\[([^\]]+)\]", m.group(3)) if k.lower() in KW_LETTER and k != "Rush"]
        if kw: s["kw"] = kw
        b = (m.group(1) + m.group(4)).strip() if m.group(4).strip() else ""
        if not b: return dict(s, to="leader" if m.group(2).lower() == "your leader" else "self") if kw else None
    b = re.sub(r"gains? \[[^\]]+\] and ", "gains ", b)
    b = re.sub(r" and cannot be [^,]+$", "", b)
    m = re.fullmatch(r"(?:this (?:Character|Leader)) gains ([+\-−]\d+) power(?: and ([+\-−]\d+) cost)?", b, re.I)
    if m:
        s.update(to="self", p=sgn(m.group(1)))
        if m.group(2): s["k"] = sgn(m.group(2))
        return s
    m = re.fullmatch(r"(?:this (?:Character|Leader)) gains ([+\-−]\d+) cost", b, re.I)
    if m: return dict(s, to="self", k=sgn(m.group(1)))
    m = re.fullmatch(r"give this (?:Character|Leader) ([+\-−]\d+) power", b, re.I)
    if m: return dict(s, to="self", p=sgn(m.group(1)))
    m = re.fullmatch(r"(?:all of )?your (?:(red|green|blue|purple|black|yellow) )?(?:\{([^}]+)\} type )?(Leader and all of your Characters|Leader or Character cards|Characters|Leader)"
                     r"(?: with a type including \"([^\"]+)\")?(?: with a (?:base )?cost of (\d+)(?: or (less|more))?)?(?: other than this Character)? gains? ([+\-−]\d+) (power|cost)", b, re.I)
    if m:
        col, ty, kind, tin, kv, kd, v, what = m.groups()
        kind = kind.lower()
        s["to"] = "leader" if kind == "leader" else "all" if kind.startswith("leader") else "chars"
        if col: s["col"] = col.capitalize()
        if ty: s["ty"] = ty
        if tin: s["tin"] = tin
        if kv: s["kmax" if kd == "less" else "kmin" if kd == "more" else "keq"] = int(kv)
        if "other than this Character" in b: s["other"] = True
        s["p" if what.lower() == "power" else "k"] = sgn(v)
        return s
    m = re.fullmatch(r"give all of your opponent's Characters ([+\-−]\d+) (power|cost)", b, re.I)
    if m: return dict(s, to="opp", **{"p" if m.group(2).lower() == "power" else "k": sgn(m.group(1))})
    return None


def sgn(v):
    return int(v[1:]) * (-1 if v[0] in "-−" else 1)


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
        # [Your Turn] in front of another timing ("[Your Turn] [On Play]") only says when it can happen
        if len(timings) > 1 and "yourTurn" in timings: timings.remove("yourTurn")
        don = next((int(t[7:]) for t in tags if t.startswith("DON!! x")), 0)
        # a keyword tag followed only by its reminder text has nothing to carry out; Double Attack, Banish and
        # Unblockable are kept as always-on grants (they can need DON!!: "[DON!! x1] [Banish]")
        if kws and not timings and (not body or re.fullmatch(r"\([^()]*\)\.?", body)):
            kg = [k for k in kws if k in ("Double Attack", "Banish", "Unblockable")]
            if kg:
                ab = {"t": "other", "text": raw, "s": {"to": "self", "kw": kg}}
                if don: ab["don"] = don
                if "Opponent's Turn" in tags: ab["s"]["turn"] = "opp"
                out.append(ab)
            continue
        donMinus = 0
        m = re.match(r"DON!!\s*[−\-](\d+)\s*(?:\([^)]*\))?\s*[:,]\s*", body)
        if m: donMinus = int(m.group(1)); body = body[m.end():]
        restDon = 0
        m = re.match(r"([%s])\s*(?:\([^)]*\))?\s*[:,]?\s*" % "".join(CIRCLED), body)
        if m: restDon = CIRCLED[m.group(1)]; body = body[m.end():]
        body = re.sub(r"^\([^)]*\)\s*", "", body) if kws else body
        if not body: continue
        steps = steps_of(body)
        if all(s["a"] == "other" for s in steps): steps = []
        if restDon: steps = [{"a": "restDon", "n": restDon, "pay": True, "text": f"Rest {restDon} of your DON!! cards."}] + (steps or [{"a": "other", "text": body}])
        st = static(body, tags) if set(timings) <= {"yourTurn"} else None
        for t in timings or ["other"]:
            ab = {"t": t, "text": raw}
            if don: ab["don"] = don
            if donMinus: ab["donMinus"] = donMinus
            if steps: ab["steps"] = steps
            if st: ab["s"] = st
            out.append(ab)
    return out, blocker


def compact(step):
    out = {"a": step["a"]}
    for k, v in step.items():
        if k == "a" or v is None: continue
        if k == "upTo" and v is True: continue
        if k == "who" and v == "opp": continue
        if k in ("rested", "all", "battle", "self", "pay", "tb", "now") and v is False: continue
        if k == "n" and v == 1: continue
        if k == "opts": v = [{"text": o["text"], "steps": [compact(s) for s in o["steps"]]} for o in v]
        out[k] = v
    return out


def load(folder):
    cards = [json.load(open(f, encoding="utf-8")) for f in sorted(glob.glob(os.path.join(folder, "**", "*.json"), recursive=True))]
    have = {c.get("id") for c in cards}
    if os.path.exists(EXTRA):
        extra = json.load(open(EXTRA, encoding="utf-8"))["cards"]
        cards += [dict(v, id=k) for k, v in sorted(extra.items()) if k not in have]
    return cards


def main(folder, report=False):
    effects = {}
    for c in load(folder):
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
    if report: print_report(effects)


def print_report(effects):
    """How much of the card text the game carries out, and the most common clauses it doesn't."""
    n_ab = n_auto = n_stat = 0
    rest = collections.Counter()
    def walk(steps):
        for s in steps:
            if s["a"] == "choose":
                for o in s["opts"]: yield from walk(o["steps"])
            else: yield s
    for code, e in effects.items():
        for a in e["abilities"]:
            n_ab += 1
            if a.get("s"): n_stat += 1; continue
            st = list(walk(a.get("steps", [])))
            if st and all(s["a"] != "other" for s in st): n_auto += 1
            for s in st or [{"a": "other", "text": a["text"]}]:
                if s["a"] == "other": rest[re.sub(r"\d+", "N", re.sub(r"\[[^\]]+\]|\{[^}]+\}", "X", s["text"]))[:100]] += 1
    print(f"{n_ab} abilities: {n_auto} fully carried out, {n_stat} always-on, {n_ab - n_auto - n_stat} with something to do by hand")
    for k, v in rest.most_common(40): print(f"{v:5} {k}")


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if a != "--report"]
    if len(args) != 1: sys.exit(__doc__)
    main(args[0], "--report" in sys.argv)
