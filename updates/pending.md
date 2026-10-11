# Changes waiting for the next app update

The desktop app gets an update once 10 changes have piled up here, unless Ryan asks for one sooner.
Add one line per change. `tools/publish_update.py` publishes them and empties this list.

- New table layout like the playmat: Life sits on the board beside your Characters, the opponent's hand and the table log are on the left, and the card preview and turn buttons are on the right.
- Took out the Markers box and the Power and Cost counters now that card effects run by themselves. The Auto card effects, Auto start of turn and Sounds switches sit under the turn buttons, and the card preview is bigger.
- Playing a card from your hand now needs as many active DON!! as it costs (it used to let you play short with a warning). Tap a card in your hand and choose Play for free when an effect plays it.
- Cards that cost less from hand when their condition is met (like ST33-004) now cost the lower amount when played, and show the lower cost in green on the card in your hand. Leader and Stage discounts (OP01-067, OP05-097) count too.
- New Friends only mode on the Play page: challenge a friend or use a room code. Reset board, Refresh and Undo are only there and in practice, not at public Lobbies tables or in Ranked.
- Start of turn is always automatic now (stand, draw, DON!!), so the Auto start of turn switch and the Draw for turn and DON!! for turn buttons are gone.
