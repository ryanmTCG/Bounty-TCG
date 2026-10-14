# Changes waiting for the next app update

The desktop app gets an update once 10 changes have piled up here, unless Ryan asks for one sooner.
Add one line per change. `tools/publish_update.py` publishes them and empties this list.

- The tutorial's table log no longer reads "You goes first" when you haven't set a name.
- Nickname: set one name on your Profile (or from "Playing as" on the home page) and everyone sees it: your opponent at the table (even mid-match), the lobby, friends' lists and the Ranked leaderboard. Signed in, it's saved with your account.
- Card abilities: the game now carries out about twice as many by itself (2,520 of 3,515, up from 1,242), including Choose one, costs paid from the card itself, "If ..." and "If you do" conditions, Triggers that play the card or use its [Main], and effects on the opponent's hand, Life, DON!! and cost.
- Always-on abilities now count: power and cost boosts (like Zoro's +1000 for your Characters), and Double Attack, Banish and Unblockable work in battles.
- Public and ranked matches: DON!!, resting and standing, drawing, looking at your deck or Life, healing and moving cards by hand only work while a card's ability calls for them, so nobody can help themselves. Card effects always run there, and a step your opponent's card makes you do comes up on your screen.
- Rules from the official rulebook: you can only attack on your own turn with an active card, one attack at a time; a Character can't block an attack on itself (and at public tables only [Blocker]s can block); running out of deck loses the game; playing a 6th Character asks which of the others to trash; and a used Event goes to the trash.
- The computer opponent now uses its cards' abilities (On Play, Activate: Main, Events, Triggers and Counter Events) and plays smarter: weaker attackers first, your rested Characters before your Leader, then your Leader once you're down to 2 Life.
- Cards follow their timing: [Main] Events only on your own turn, [Counter] Events only while you're being attacked, and no cards are played in the middle of an attack.
- Card text the game now checks: Blockers that need something (a DON!!, few cards in hand, little Life) only block while it holds, Leaders and Characters that "cannot attack" can't, and "you cannot play Character cards during this turn" stops further plays.
- The computer opponent plays Stage cards, uses its End of Turn and On Your Opponent's Attack abilities, keeps DON!! back for a Counter Event, and throws every attack at your Leader when it can win that turn.
