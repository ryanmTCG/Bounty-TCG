# Changes waiting for the next app update

The desktop app gets an update once 10 changes have piled up here, unless Ryan asks for one sooner.
Add one line per change. `tools/publish_update.py` publishes them and empties this list.


- OP17-063 Kaido's ability now negates the Character before K.O.ing it, so "cannot be K.O.'d by effects" and On K.O. don't stop it, and other "negate the effect" cards work too.
- Cards like OP17-063 and EB01-001 that give Characters in your hand without a Counter a +1000 Counter now do so while they're on the field.
- About 50 card abilities no longer skip part of their cost or their second action (for example OP01-115, OP04-041, OP09-095 and OP15-118).
- A card's "If you have ..." condition no longer limits what it can target, and "base power" limits use the printed power.
