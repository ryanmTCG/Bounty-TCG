# Changes waiting for the next app update

The desktop app gets an update once 10 changes have piled up here, unless Ryan asks for one sooner.
Add one line per change. `tools/publish_update.py` publishes them and empties this list.
- Find a match (Play > Find a match): press Find a quick match or Find a ranked match and you're paired with the next player who's looking. The page shows how many players are in each queue and how many are in a match right now; the Ranked page shows its own.
- New Master level for the computer: it looks ahead to your next turn, takes out the Characters that could hurt it most, keeps its Blockers home when you could win, and weighs whether each attack is likely to get through your counters.
- Watch a match (Play > Find a match): every ranked, quick, lobby and tournament match being played is listed with both players and their Leaders, and anyone can watch it (boards only, never hands). Friends can also watch each other's ranked and lobby matches from the Friends page.
- Quick chat has five more messages, and "Mute their messages" in the chat menu hides your opponent's for the rest of the match.
- 22 more card abilities are carried out by the game instead of left to the player, such as "that card gains an additional +2000 power" (OP04-095), paying with your Leader's power (OP04-006) and "draw until you have 3 cards in hand" (OP02-051).
- Coach hints: in a practice game against the computer, the Hint button says what the Master computer would do in your seat (keep or mulligan, what to play, where DON!! goes, what to attack and how to defend) and lights up those cards.
- The Meta page reads one daily summary plus only the newest matches, instead of 1,000 matches on every visit, so it stays within Firebase's free limits.
- My collection in the Deck editor: Collection mode sets how many of each card you own, or add a list or a whole deck at once; each deck shows the cards it still needs and can copy them as a list. Signed in, it's kept in your account.
- Share links: replay codes and deck shares copy a link that opens straight in Bounty TCG (with the next full download of the app).
