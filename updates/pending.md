# Changes waiting for the next app update

The desktop app gets an update once 10 changes have piled up here, unless Ryan asks for one sooner.
Add one line per change. `tools/publish_update.py` publishes them and empties this list.

- Rejoin: if your game closes or drops mid-match, reopen it and press Rejoin to get back to the same table.
- Battle helper: the combat bar shows attacker power against defender power, lists your counter cards to play from hand, adds them up, and the Resolve button says what will happen. Counters come off after the battle.
- Automatic start of turn: your turn now stands your cards, draws and adds DON!! in one go (1 DON!! and no draw on the very first turn). Switch it off in the Markers panel.
- Quick chat: a Chat button in online matches sends set phrases and emotes (Good luck, Nice play, Thinking…, Good game and more). They pop up over your opponent's board and go in the table log.
- Ranked turn timer: 3 minutes a turn (paused while your opponent answers an attack, and they get 45 seconds). Running out ends your turn, and the third time loses the match.
- Match history on Profile: your last 20 online matches with the opponent, their Leader, the result, how it ended and the bounty change. Also fixed starting a new match from an old table counting a phantom win.
