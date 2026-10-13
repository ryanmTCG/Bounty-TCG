# Changes waiting for the next app update

The desktop app gets an update once 10 changes have piled up here, unless Ryan asks for one sooner.
Add one line per change. `tools/publish_update.py` publishes them and empties this list.

- Only active DON!! can be dragged, and DON!! given to a card stays until the Refresh Phase or a K.O., unless an effect moves it.
- Blocking is done by tapping a glowing Blocker (no Block button), and the Blocker tag is orange.
- Characters can't attack the turn they're played unless they have [Rush] or a card lets them (OP11-001 and similar let them attack Characters only).
- The game checks card "If ..." conditions itself (about 85% of wordings): abilities whose condition isn't met don't run, and conditional Rush is decided without asking.
- Ranked wins are cross-checked: a win reaches the shared leaderboard only once the loser's own game records it (needs the new Firestore rules).
- Watch a friend's match: friends in a Friends-only match show a Watch button, and watchers see both boards, the battle and the log without taking a seat.
- Practice against the computer: a simple opponent that keeps a hand, plays Characters, gives DON!!, attacks, and defends with Blockers and Counters (its own card abilities don't run yet).
- Deck lists import and export in the 1xOP01-001 / 4xOP01-016 format deck sites and simulators use, with the Leader picked out of pasted lists; "4 Nami (OP01-016)" lines read too.
- Decks are checked for the color rule: cards that don't share a color with the Leader are flagged in the deck builder and aren't allowed in Lobbies or Ranked. The deck stats also count Blockers and Triggers.
- New-player tutorial: a guided first game against the computer that covers keeping a hand, DON!!, playing Characters, Blockers, attacking and Counters.
