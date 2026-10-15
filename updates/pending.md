# Changes waiting for the next app update

The desktop app gets an update once 10 changes have piled up here, unless Ryan asks for one sooner.
Add one line per change. `tools/publish_update.py` publishes them and empties this list.


- OP17-063 Kaido's ability now negates the Character before K.O.ing it, so "cannot be K.O.'d by effects" and On K.O. don't stop it, and other "negate the effect" cards work too.
- Cards like OP17-063 and EB01-001 that give Characters in your hand without a Counter a +1000 Counter now do so while they're on the field.
- About 50 card abilities no longer skip part of their cost or their second action (for example OP01-115, OP04-041, OP09-095 and OP15-118).
- A card's "If you have ..." condition no longer limits what it can target, and "base power" limits use the printed power.
- Every automated card ability was checked against its card text, and the 250 or so that didn't match now follow it or are left to the player: second targets and second actions are no longer dropped, DON!! −N costs are always paid, and conditions written after the action ("Draw 1 card if ...") are checked.
- Power and cost changes "until the end of your opponent's next turn" now last that long, and target limits now read colors, attributes, two types, [Trigger], [Blocker], DON!! given, a named Leader and "a cost equal to or less than your opponent's Life".
- "Play ... from your hand or trash" offers both, searches like "[Sanji] or Event card" take either one, and "Your Leader and all of your Characters" includes the Leader.
- [Opponent's Turn] abilities are used on the opponent's turn and "would be K.O.'d ... instead" ones on either, while choices, replacements and "at the end of this turn" effects are left to the player instead of being carried out wrong.
- Leaders and Characters with two always-on effects (like ST14-001 and OP17-119) now get both.
