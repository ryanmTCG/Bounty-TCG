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
    if re.search(r"\byour opponent's Leader and all of (?:their|your opponent's) Characters\b", clause, re.I): return ("opp", 1, False, True, True)
    if re.search(r"\byour opponent's Leader\b", clause, re.I): return ("opp", 1, False, False, True)
    m = re.search(r"\b(all|up to (\w+)|(\w+)) of your (?:%s)(Leader or Character cards?|Characters?|Leader|cards?)\b" % QUAL, clause, re.I)
    if m:
        kind = m.group(4).lower()
        if kind.startswith("card"): kind = "leader or character"
        # "your Leader and all of your Characters"
        if m.group(1).lower() == "all": return ("own", 1, False, True, "leader" in kind or bool(re.search(r"\byour Leader and all of your", clause, re.I)))
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
NEXT_TURN = r"until the (?:start of your next turn|end of your opponent's next (?:turn|end phase))"
# "until the end of your next turn": through your next turn, too (nt; the game treats it as nx when it's used on your own turn)
def next_turn(low): return {"nx": True} if re.search(NEXT_TURN, low) else {"nt": True} if "until the end of your next turn" in low else {}


def self_step(core, base):
    """Steps that act on the card itself: "You may rest this Character", "Play this card", "This Leader gains +2000 power"."""
    low = core.lower()
    battle = "during this battle" in low
    if re.search(r"\bfor every\b|\bat the end of (?:this|the) turn\b", low): return None
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
    m = re.match(r"%s gains \[(rush|double attack|banish|unblockable)\](?: and ([+\-−])(\d+) power)?(?: during this turn)?(?:\.|$| \()" % SELF, low)
    if m: return dict(base, a="kw", self=True, k=KW_LETTER[m.group(1)], n=int(m.group(3) or 0) * (-1 if m.group(2) in ("-", "−") else 1))
    m = re.match(r"%s gains ([+\-−])(\d+) power(?: during this (?:turn|battle)| %s| until the end of your next turn)?(?:\.|$)" % (SELF, NEXT_TURN), low)
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
    cost, power = limits(core)
    s = self_step(core, base)
    if s: return s
    if re.search(r"\bfor every\b", cl): return dict(base, a="other")
    # later in the turn ("at the end of this turn"), a choice of two actions ("K.O. or rest", "to the owner's hand or the
    # bottom of their deck", "top or bottom of the owner's Life"), "for each", "1 each of", a total power, the opponent
    # choosing, "any number" of targets, and a Leader gaining a keyword and power at once
    if re.search(r"\bat the end of (?:this|the) turn\b|\b(?:k\.o\.|rest|return|place|trash) or (?:k\.o\.|rest|return|place|trash)\b|"
                 r"\bor (?:place|return) it\b|, or return it\b|hand or the bottom of|\btop or bottom of (?:the owner's|your opponent's|their) life|"
                 r"\bfor each\b|\b\w+ each of\b|\bany number of\b|\bthe same number\b|\band that character will\b|\bwould (?:be|leave)\b.*\binstead\b|\btotal (?:power|cost) of\b|\bboth the\b|"
                 r"\bgains? \[[^\]]+\] and [+\-−]\d+ power|\binstead of\b|\bplay up to \w+ [^.]*? and up to \w+ |\byour opponent's [^.]*?\bor stages?\b|"
                 r"\byour leader with [^.]*? and (?:up to \w+ |all )of your characters\b|\byour leader and up to \w+ of your characters\b|"
                 r"\bfrom your hand or (?:(?:rest|trash|return|place|add) )?(?:\d|up to|an?|one|this|that)\b|\bof your opponent's stages?\b|\bor your opponent's stages?\b|\bcharacters? or don!! cards?\b|"
                 r"\bplay up to \w+ [^.]*different card names\b|\bequal to or less than the number of don!!|\bof your [^.]*? or \w+ cards? from your hand\b", cl) and not re.match(r"(?:you may )?trash (?:up to )?\w+ cards? from the top or bottom of your life", cl):
        return dict(base, a="other")
    # "Negate the effect of up to 1 of your opponent's Characters with a cost of 6 or less during this turn[, and K.O. it]":
    # a mark that turns the card's own abilities off this turn, or, with "and K.O. it", the K.O. with ng set (the mark
    # goes first, so its [On K.O.] and "cannot be K.O.'d by effects" don't apply)
    m = re.match(r"negate the effects? of ((?:up to \w+ of |\w+ of )?your opponent's (?:leader or character cards?|characters?|leader))(?: with [^,]*?)?(?: during this turn)?"
                 r"(?:,? and (k\.o\. it|return it to (?:(?:the|its|their) owner'?s?'?|their) hand|give that card ([+\-−])(\d+) power))?(?: during this turn)?\.?$", cl)
    if m:
        t = target(core)
        if t and t[0] == "opp":
            kw = dict(who="opp", n=t[1], upTo=t[2], all=t[3], ld=t[4], cost=cost, power=power)
            if not m.group(2): return dict(base, a="mark", k="ng", now=True, **kw)
            if m.group(2).startswith("k.o."): return dict(base, a="ko", ng=True, **dict(kw, ld=False))
            if m.group(2).startswith("return"): return dict(base, a="bounce", ng=True, **dict(kw, ld=False))
            return dict(base, a="pwr", ng=True, battle=False, cnt=None, **dict(kw, n=int(m.group(4)) * (-1 if m.group(3) != "+" else 1)))
    m = re.match(r"reveal (\w+) cards? from the top of your (deck|life cards)\.?$", cl)
    if m: return dict(base, a="reveal", n=num(m.group(1)), lf=m.group(2) != "deck")
    # "You may reveal 2 Events from your hand": shown to the opponent, they stay in your hand
    m = re.match(r"(?:you may )?reveal (up to )?(?:a total of )?(\w+) (.+?) from your hand\.?$", core.strip(), re.I)
    if m: return dict(base, a="revealHand", n=num(m.group(2)), f=m.group(3), upTo=bool(m.group(1)))
    m = re.search(r"\bdraw (\w+) cards?\b", cl)
    if m and not re.search(r"\bwhen (?:you|your opponent) draws?\b", low): return dict(base, a="draw", who="own", n=num(m.group(1)))
    m = re.search(r"\btrash (any number of|all) ((?:[^.]*? )?)(?:cards?|events?|characters?|stages?) ?((?:with [^.]*?)?)from your hand\b", cl)
    if m and "your opponent" not in cl[:m.start()]: return dict(base, a="other")
    m = re.search(r"\btrash (up to )?(\w+) ((?:[^.]*? )?)(?:cards?|events?|characters?|stages?) ?((?:with [^.]*?)?)from your hand\b", cl)
    if m and "your opponent" not in cl[:m.start()]:
        return dict(base, a="discard", who="own", n=num(m.group(2)), upTo=bool(m.group(1)) or cl.startswith("you may"))
    m = re.search(r"\blook at (\w+) cards? from the top of your deck\b", cl)
    if m: return dict(base, a="look", who="own", n=num(m.group(1)))
    m = re.search(r"\badd (up to )?(\w+) (additional )?don!! cards?(?: from your don!! deck)?", cl)
    if m and re.search(r"\byour opponent (?:may )?adds?\b", cl): return dict(base, a="other")
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
    if m and m.group(3): return dict(base, a="other")
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
            return dict(base, a="cost", who=t[0], n=v, upTo=t[2], all=t[3], ld=False, cost=cost, power=power, cnt=t[1] if t[1] > 1 else None, **next_turn(cl))
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
    # "You may rest 1 of your [Gonbe] and this Character:" is two costs
    body = re.sub(r"\b(rest \w+ of your [^:.]+?) and this (Character|Leader|Stage)\b", r"\1 and rest this \2", body, flags=re.I)
    # "You can trash ...:", "you may trash 1 card from your hand to activate this effect. <effect>": a cost like any other
    body = re.sub(r"\bYou can (?=[^:]+:)", "You may ", body)
    body = re.sub(r"\b(you may [^.:]+?) to activate this effect\.\s*", r"\1: ", body, flags=re.I)
    # "K.O. up to 1 of X and up to 1 of Y", "Return up to 1 X and up to 1 Y to the owner's hand": a step for each
    body = re.sub(r"\b(K\.O\.|Rest|rest) (up to \w+ of your opponent's [^.:]*?) and (up to \w+ (?:of your opponent's )?Characters?\b)",
                  lambda m: f"{m.group(1)} {m.group(2)} and {'rest' if m.group(1) == 'Rest' else m.group(1)} {m.group(3)}", body)
    body = re.sub(r"\b(Return|return|Place|place) (up to \w+ (?:of your opponent's )?Characters? [^.:]*?) and (up to \w+ (?:of your opponent's )?Characters? [^.:]*?) "
                  r"((?:to the owner's hand|at the bottom of the owner's deck)(?: in any order)?)",
                  lambda m: f"{m.group(1)} {m.group(2)} {m.group(4)} and {m.group(1).lower()} {m.group(3)} {m.group(4)}", body)
    # "Draw 1 card if you have 5 or less cards in your hand": the condition first, like the game reads it
    body = re.sub(r"(^|(?<=[.:]\s)|(?<=Then,\s))(Draw \w+ cards?|draw \w+ cards?) if ([^.,]+)\.", lambda m: f"{m.group(1)}If {m.group(3)}, {m.group(2).lower()}.", body)
    body = re.sub(r"\b([Ss]et up to \w+ of your [^.:]*?) and your Leader as active\b", r"\1 as active and set your Leader as active", body)
    body = re.sub(r"\b(rest|Rest|K\.O\.) this (Character|Leader) and (up to \w+ of your opponent's)", lambda m: f"{m.group(1)} this {m.group(2)} and {m.group(1).lower() if m.group(1) == 'Rest' else m.group(1)} {m.group(3)}", body)
    for sent in re.split(r"(?<=\.)\s+(?=[A-Z])", body.strip()):
        sent = re.sub(r"^Then,\s*", "", sent)
        # "When your opponent plays a Character, if your Leader has ..., rest ...": the condition leads the step
        sent = re.sub(r"^When [^,.]+, if ", "If ", sent)
        if out and re.match(r"(?:place|put|trash|add) the rest\b|reveal\b|play up to\b(?![^.]*\bfrom your (?:hand|trash)\b)", sent, re.I) and re.search(r"look at", out[-1][0], re.I) and not out[-1][1]:
            out[-1] = (out[-1][0] + " " + sent, out[-1][1]); continue
        # "You may <cost>: <effect>" is two steps, the cost first ("You may rest this Character and add 1 card from the
        # top of your Life cards to your hand: ..." is two costs)
        m = re.match(r"((?:[^:]*?,\s*)?you may [^:]+):\s*(.+)$", sent, re.I)
        if m:
            for p in re.split(r",? and (?=(?:trash|rest|return|place|reveal|turn|add|give)\b(?! (?:it|them|that|those)\b)|K\.O\. (?!(?:it|them|that|those)\b))", m.group(1)):
                if p.strip(): out.append((p.strip().rstrip(".") + ".", True))
            sent = m.group(2)
        # "Draw 1 card, look at ...": the draw first
        dm = re.match(r"(draw \w+ cards?|add up to \w+ DON!! cards? from your DON!! deck(?: and rest (?:it|them))?),\s*(?:then,\s*)?(look at .+)$", sent, re.I)
        if dm: out.append((dm.group(1) + ".", False)); sent = dm.group(2)
        if re.search(r"\blook at\b", sent, re.I): out.append((sent, False)); continue
        # "X, then Y", "X and this Character gains Y": two steps
        # (K.O. has no word boundary after its last dot, so it's matched by the space after it)
        parts = [p.strip() for p in re.split(r",? and (?=(?:trash|draw|rest|give|add|return|set|place|play)\b(?! (?:it|them|that|those)\b)|K\.O\. (?!(?:it|them|that|those)\b))"
                                             r"|,? and (?=(?:this|your) (?:Character|Leader) gains\b)|, and (?=you may\b)|,? and,? (?=if\b)"
                                             r"|,? and then,? (?=(?:(?:trash|draw|rest|give|add|return|set|place|play|look)\b|K\.O\. ))|, then,? (?=(?:(?:trash|draw|rest|give|add|return|set|place|play|look|up to)\b|K\.O\. ))"
                                             r"|(?:(?<=[Dd]raw \w card)|(?<=[Dd]raw \w cards)),? and ", sent) if p.strip()]
        # "If X, A and B": B only happens when X is so, too
        cm = re.match(r"(?:then,\s*)?(if [^,]+,)\s", parts[0], re.I) if parts else None
        # ("A and, if Y, B": B needs X and Y)
        if cm: parts = parts[:1] + ["If " + cm.group(1)[3:-1] + " and " + p[3:] if re.match(r"if\b", p, re.I) else cm.group(1) + " " + p for p in parts[1:]]
        out.extend((p.rstrip(".") + ".", False) for p in parts)
    # "Look at 5 cards ...; ... place the rest at the bottom of your deck in any order and trash 1 card from your hand"
    res = []
    for c, pay in out:
        lm = re.match(r"(.*\blook at\b.*?)(?:,)? and (trash \w+ cards? from your hand|set up to \w+ of your DON!! cards? as active|play up to \w+ [^.;]*? from your hand)\.?$", c, re.I | re.S) if not pay else None
        if not lm: res.append((c, pay)); continue
        # with the look's "If X," in front of the second part too
        cm = re.match(r"(if [^,;]+,)\s", c, re.I)
        second = cm.group(1) + " " + lm.group(2) if cm else lm.group(2)[0].upper() + lm.group(2)[1:]
        res += [(lm.group(1).rstrip(".") + ".", False), (second + ".", False)]
    return res


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
    opts, tail = [], ""
    bul = [x.strip() for x in re.split(r"\s*•\s*", body[m.end():]) if x.strip()][:4]
    if bul:
        tm = re.search(r"(?<=\.)\s+Then,\s*(.+)$", bul[-1])
        if tm: bul[-1], tail = bul[-1][:tm.start()].strip(), tm.group(1)
    for o in bul:
        st = [step(c, pay) for c, pay in clauses(o)]
        opts.append({"text": o, "steps": st})
    ch = {"a": "choose", "text": (lead + " choose one.").strip() if re.match(r"(?:if|draw)\b", lead, re.I) else "Choose one.", "opts": opts}
    # "Draw 1 card, then choose one:" keeps the draw as its own step
    if lead and not re.match(r"if\b", lead, re.I) and re.sub(r",?\s*then,?$", "", lead).strip():
        out.append(step(re.sub(r",?\s*then,?\s*$", "", lead).strip() + "."))
        ch["text"] = "Choose one."
    out.append(ch)
    if tail: out += [step(c, pay) for c, pay in clauses(tail)]
    return out


# ---------- always-on effects ----------
def static(body, tags):
    """An always-on power or cost change, or None. Read by the game (statB in page/bounty-tcg.html) while its condition holds."""
    b = re.sub(r"\s*\([^)]*\)", "", body).strip().rstrip(".")
    s = {}
    if "Your Turn" in tags: s["turn"] = "own"
    if "Opponent's Turn" in tags: s["turn"] = "opp"
    m = re.match(r"if it is your opponent's turn, (.+)$", b, re.I)
    if m: s["turn"], b = "opp", m.group(1)
    # the condition stays in its own sentence ("K.O.'d" has dots, but no sentence ends inside it)
    m = re.match(r"If ((?:[^.]|\.(?=\S))+?), (?=(?:this|all|your|give)\b)(.+)$", b, re.I)
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
    b = re.sub(r"\bcannot be (?:k\.o\.'d|removed)[^,]*? and (gains?)\b", r"\1", b, flags=re.I)
    m = re.fullmatch(r"(?:this (?:Character|Leader|card)) gains ([+\-−]\d+) power(?: and ([+\-−]\d+) cost)?", b, re.I)
    if m:
        s.update(to="self", p=sgn(m.group(1)))
        if m.group(2): s["k"] = sgn(m.group(2))
        return s
    m = re.fullmatch(r"(?:this (?:Character|Leader)) gains ([+\-−]\d+) cost", b, re.I)
    if m: return dict(s, to="self", k=sgn(m.group(1)))
    m = re.fullmatch(r"give this (?:Character|Leader) ([+\-−]\d+) power", b, re.I)
    if m: return dict(s, to="self", p=sgn(m.group(1)))
    m = re.fullmatch(r"(?:all of )?your (?:(red|green|blue|purple|black|yellow) )?(?:\{([^}]+)\} type )?(Leader and all of your Characters|Leader or Character cards|Characters|Leader)"
                     r"(?: with a type including \"([^\"]+)\")?(?: with a (?:base )?cost of (\d+)(?: or (less|more))?)?(?: with (\d+) base power( or less)?)?(?: other than this Character)? gains? ([+\-−]\d+) (power|cost)", b, re.I)
    if m:
        col, ty, kind, tin, kv, kd, pv, pd, v, what = m.groups()
        if pv: s["pmax" if pd else "peq"] = int(pv)
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
    # a misprint on OP17-076
    text = re.sub(r"\bCharactes\b", "Characters", (text or "").strip())
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
        m = re.match(r"DON!!\s*[−\-](\d+)\s*(?:\([^)]*\))?\s*[:,]?\s*", body)
        if m: donMinus = int(m.group(1)); body = body[m.end():]
        restDon = 0
        m = re.match(r"([%s])\s*(?:\([^)]*\))?\s*[:,]?\s*" % "".join(CIRCLED), body)
        if m: restDon = CIRCLED[m.group(1)]; body = body[m.end():]
        body = re.sub(r"^\([^)]*\)\s*", "", body) if kws else body
        if not body: continue
        steps = steps_of(body)
        # "[DON!! x1] This Character gains [Rush]" with no timing is always-on (the game reads it from the text), not
        # something to carry out
        if set(timings) <= {"yourTurn"}: steps = [s for s in steps if not (s["a"] == "kw" and s.get("self"))]
        if all(s["a"] == "other" for s in steps): steps = []
        if restDon: steps = [{"a": "restDon", "n": restDon, "pay": True, "text": f"Rest {restDon} of your DON!! cards."}] + (steps or [{"a": "other", "text": body}])
        st = static(body, tags) if set(timings) <= {"yourTurn"} else None
        # "All of your Characters gain +1 cost. If you have a Character with a cost of 8 or more, this Leader gains +1000
        # power.": each sentence that is always-on on its own is an ability of its own; the rest stays as the steps
        more = []
        sents = re.split(r"(?<=\.)\s+(?=[A-Z])|,? and (?=if it is your opponent's turn, )", body) if st is None and set(timings) <= {"yourTurn"} else []
        if len(sents) > 1 and any(static(x, tags) for x in sents):
            more = [static(x, tags) for x in sents if static(x, tags)]
            left = " ".join(x for x in sents if not static(x, tags))
            steps = steps_of(left) if left else []
            if steps and all(s["a"] == "other" for s in steps): steps = []
            if restDon: steps = [{"a": "restDon", "n": restDon, "pay": True, "text": f"Rest {restDon} of your DON!! cards."}] + (steps or [{"a": "other", "text": left}])
            # with nothing else to do by hand, the first always-on sentence is this ability's own
            if not left: st = more.pop(0)
        # "... instead of drawing 1 card", "If ... would be removed ..., you may ... instead": a replacement the player
        # picks, so the whole ability is done by hand
        if re.search(r"\binstead\b", body, re.I): steps = []
        # "All Character cards in your hand without a Counter have a +1000 Counter" (while this card is on the field)
        hc = None if timings else re.match(r"all (?:of your )?(?:\{([^}]+)\} type )?character cards (?:in your hand )?without a counter have a \+(\d+) counter", body, re.I)
        if hc: steps = []
        for t in timings or ["other"]:
            ab = {"t": t, "text": raw}
            if hc: ab["hc"] = dict({"n": int(hc.group(2))}, **({"ty": hc.group(1)} if hc.group(1) else {}))
            if don: ab["don"] = don
            if donMinus: ab["donMinus"] = donMinus
            if steps: ab["steps"] = steps
            if st: ab["s"] = st
            out.append(ab)
            for m2 in more: out.append(dict({"t": t, "text": raw, "s": m2}, **({"don": don} if don else {})))
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
            if a.get("s") or a.get("hc"): n_stat += 1; continue
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
