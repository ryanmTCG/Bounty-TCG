# Changes waiting for the next app update

The desktop app gets an update once 10 changes have piled up here, unless Ryan asks for one sooner.
Add one line per change. `tools/publish_update.py` publishes them and empties this list.

- Concede, Draw for turn, DON!! for turn, Undo action and End turn moved to a panel under the hand.
- Roll Dice box under Power and Cost (moved from the top bar).
- Start my turn removed: your turn starts by itself when the opponent ends theirs; Draw for turn and DON!! for turn glow until used and work once per turn.
- Test a deck (both sides) starts with a die roll for who goes first; the Roll Dice box glows while a first-player roll is waiting.
- Roll Dice box removed again (the who-goes-first roll stays in the banner).
- Coin flip button removed.
- Concede asks "Are you sure you want to concede?" with Keep playing / Yes, concede.
- Ability used marker goes on a card automatically when its ability resolves.
- Ability used marker only for Once Per Turn abilities.
- A card can't use its Once Per Turn ability again while it has Ability used.
