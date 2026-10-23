# Changes waiting for the next app update

The desktop app gets an update once 10 changes have piled up here, unless Ryan asks for one sooner.
Add one line per change. `tools/publish_update.py` publishes them and empties this list.

- Sealed: tear each pack open with a swipe and flip its cards one by one (the big pulls shine), and hovering a card zooms in on it.
- Sealed opens 24 packs, and adding a card keeps the card list where you'd scrolled it.
- Sealed: Play a friend takes your sealed deck to a Friends match (no 50-card warning for it).
- Draft (Practice > Sealed packs): you and 3 computer players open a pack each, take one card and pass the rest, 4 packs each; build from your picks and play the deck a computer player drafted.
- EB05 preview cards: a misspelled name fixed and 7 unnamed cards named.
- Card abilities follow the rules like other simulators: steps a card says must happen can't be skipped or cancelled, a cost has to be paid in full before anything happens ([Trigger]s that can't pay go to hand), steps with nothing to choose pass by themselves, Once Per Turn is per ability and resets each turn, and "at the end of this turn" DON!! effects wait for the end of the turn.
- Abilities that trigger together: you pick which of yours goes first, and online the player whose turn it is resolves theirs before the other player's.
- 57 more cards' abilities carried out by the game: trashing a random card from the opponent's hand, their Life to their hand, K.O.ing their Stage, setting a named Leader active, giving active DON!! to a named card, and power or keywords for named cards and several types.
