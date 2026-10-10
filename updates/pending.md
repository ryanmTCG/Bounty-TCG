# Changes waiting for the next app update

The desktop app gets an update once 10 changes have piled up here, unless Ryan asks for one sooner.
Add one line per change. `tools/publish_update.py` publishes them and empties this list.

- Blocking: no pop-up; tap one of your active Characters during the opponent's attack to block with it.
- Card reader and card data are hidden except for the page's editors (desktop: Ctrl+Shift+O unlocks them on Ryan's copy).
- Characters with 0 power are K.O.'d when attacked by a card with 0 power or more.
- Characters K.O.'d by an attack or an opponent's effect now use their [On K.O.] ability.
- Nobody starts the first turn until both players have mulliganed (or kept) and set Life.
- Attacks are resolved by the defender: the attacker waits while the defender blocks, counters and presses Resolve attack.
- New "No Attack" marker next to the other four.
