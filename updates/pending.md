# Changes waiting for the next app update

The desktop app gets an update once 10 changes have piled up here, unless Ryan asks for one sooner.
Add one line per change. `tools/publish_update.py` publishes them and empties this list.

- The 73 cards that keep a Character on the field "instead" (like EB04-030, OP13-047 and OP11-101) now stop the K.O. or removal and ask whether you want to pay for it. The computer uses its own.
- About 55 "When ..." abilities are now offered when that happens instead of being left for you to remember: a DON!! returned to your DON!! deck, this Character becoming rested, activating an Event, playing a Character, a Character being K.O.'d, your attack dealing damage, and a card trashed from your hand by an effect.
- Cards that only gain [Rush] from an ability (like OP14-049 or OP03-004) no longer have Rush all the time.
- New lobby format, Standard + previews, for playing preview cards (EB05 and OP18) before they come out. Until each set's English release they're marked PREVIEW in the Deck editor and aren't legal in Standard, Extra or ranked.
- Tournaments: host a single-elimination tournament for 4, 8 or 16 players from Play > Tournaments. Players sign up with their saved deck, the decklist goes to the host automatically, and the bracket moves on as each loser's game reports the result. Decklists open up for everyone when it's over.
- New Meta page (Home > Meta): win rates and play share for each Leader from real online matches, with matchups, the most played lists (open them in the Deck editor) and the cards most lists run. Signed-in players share their side of each finished match; turn it off in Profile.
- Ranked is now skill-based: beating a higher bounty is worth more (up to ฿50,000) and a lower one less (at least ฿5,000), and losses mirror that. Ranked runs in seasons, one per quarter: each new season halves every bounty (to ฿300,000 at most) and starts the record again, and your Profile keeps each season's final bounty.
- Card data fixes from the official card list: about 60 black Events were marked yellow (so decks like Black Luffy with Gum-Gum Kong Gun showed as off-color), and some costs, power and Counter values were wrong (like OP15's black Characters having no Counter).
- The computer has an Expert level that plans its plays to use all its DON!!, holds them back when it can win that turn, counters with no more than it needs and takes early hits while it has Life to spare. In practice setup the computer can play one of 12 recent tournament decks (Black Luffy, Xebec, Kaido, Whitebeard and more) or a popular list from the Meta page, which also has "Play the computer with it".
- Replays can be shared as a code (signed in to an account): anyone opens it from Replays > Open a code. The Meta page has a Recent games tab where you can watch shared online matches (boards only, no hands).
