# Notes for Claude

Bounty TCG is a One Piece Card Game tabletop. The same game page runs in two places: as a claude.ai artifact (Ryan's online page) and inside the Electron desktop app built from this repository.

## Where things live

- `page/bounty-tcg.html` is the source of truth for the game. It is written for claude.ai's `window.claude.use(...)` capabilities (room, db, assets, user, sample).
- `desktop/net.js` provides those capabilities in the desktop app: PeerJS rooms (the room namespace itself is the shared lobby), localStorage db with `seed.json`, card art on disk, and card reading with the player's own Claude API key. It also shows update banners, and provides optional email accounts (Firebase Auth + Firestore over REST; `FB_CONFIG` near the top of the db section holds Ryan's web config, `tools/firestore.rules` the security rules). Signed in, a player's `data/users/<uid>/...` and the shared `ranks` leaderboard live in Firestore; with no config the app works as before.
- `page/effects.json` holds every card's abilities, built from the official card text by `tools/build_effects.py` (run it on the English card files from github.com/buhbbl/punk-records). The game uses these first and only asks Claude to read cards that aren't in it. Rebuild it when a new set comes out, and publish it with the artifact as a supporting file. `--report` prints how many abilities the game carries out by itself and the wording it still leaves to the player.
- `tools/build.py` patches the page for the desktop (bundled fonts, wording that assumed claude.ai accounts) and builds `dist/kit`. Every patch must match exactly once, or the build stops.
- `desktop/main.src.js` is the Electron main process. It serves `app://bounty/` and runs the updater.
- The full app (with card art) is a zip on Ryan's Google Drive, linked at the top of `README.md`. The app's "Open download page" button opens this repository's page, so a new Drive link only needs changing in the README.

## Updates

Installed copies read `https://raw.githubusercontent.com/ryanmTCG/Bounty-TCG/main/updates/latest.json` at launch.

Ryan wants the desktop app updated only once 10 changes have piled up, unless he asks for an update sooner. The claude.ai artifact still gets each change right away. For each change to the game:

1. Make it in the source (usually `page/bounty-tcg.html`), republish the artifact, and commit and push. Source commits don't reach players.
2. Add one line about it to `updates/pending.md`.
3. Don't copy it onto Ryan's PC: his copy gets it from GitHub with everyone else's.

To publish, once `updates/pending.md` lists 10 changes or Ryan asks for an update:

1. Bump `version` in `version.json`.
2. Run `python3 tools/build.py` and the tests, then `python3 tools/publish_update.py`. It refuses with fewer than 10 changes unless you pass `--now` (only when Ryan asked). The notes default to the pending list, which it empties.
3. Commit `updates/` and push to `main`.

Whatever is on `main` in `updates/latest.json` reaches every player, so only publish tested builds. Changes to `main.src.js` or `preload.js` need `SHELL_VERSION` raised, and only reach players through a full app download. Raise `version.json`'s `shell` to match only when the page depends on the new shell: players on an older shell are then sent to download the full app.

## Rules

- Never commit card art, `*.webp`, or Bandai's DON!!/sleeve images. `private/static/` holds the latter locally and is gitignored. Update bundles skip them too.
- Run the tests in `tests/` against `dist/kit/app` after building: `xvfb-run -a node tests/testupdate.mjs`, `testlobby.mjs`, `testlegal.mjs`, `test2p.mjs`, `testranked.mjs`, `testaccount.mjs` (accounts against a local stand-in for Firebase), `testrejoin.mjs`, `testbattle.mjs`, `testtimer.mjs`, `testfriends.mjs`, `testbot.mjs` (the computer opponent), `testdeck.mjs` (deck import/export and checks), `testtutorial.mjs`, `testeffects.mjs` (card abilities the game carries out), `testfair.mjs` (public and ranked tables lock the free board tools), `testrules.mjs` (game rules from the official Comprehensive Rules, and the computer using its own card abilities). The multiplayer tests start a local PeerJS server from the `peer` package.
- Every open copy of the game sits in the shared lobby with its friend code, name and status (`lobbyUpdate`), so friends can see each other online. A challenge is a `ch` note in that presence naming a friend code and a `friend-...` table, and a decline is a `dc` note. Tests run offline, so a launch without the local PeerJS server logs failed connections to the public one.
- The game follows the official Comprehensive Rules (en.onepiece-cardgame.com/pdf/rule_comprehensive.pdf): attacks only on your own turn with an active card and one at a time, a Blocker can't block an attack on itself, an empty deck loses, a 6th Character makes you trash one of the other 5 (not a K.O.), and a used Event goes to the trash. `playTiming()` holds paid plays from hand to their timing: Characters, Stages and [Main] Events on your own turn outside a battle, [Counter] Events while you're attacked. `blockerNow()` and `cantAttack()` read a card's own conditions ("[DON!! x1] This Character gains [Blocker]", "This Leader cannot attack."). The computer opponent (`botMain`, `botAbility`, `botFxStep`) carries out its own cards' abilities through the same effects engine (On Play, Activate: Main, Events, Triggers, Counter Events, On Your Opponent's Attack, End of Your Turn), plays Stages, keeps DON!! back for a [Counter] Event in hand, and plays like the strategy guides: weaker attackers first, rested Characters before a healthy Leader, the Leader once you're at 2 Life, and everything at the Leader when it can win that turn (`botLethal`).
- Public lobby tables (`S.pubt`) and ranked matches have no free board tools (`boardTools()`): drawing, looking at the deck or Life, healing, DON!!, resting and moving cards by hand only work through `fair()`/`fairMove()`, which allow them while a card's ability is left to the player and its wording names that thing. Any new manual tool needs the same check.
- After changing the page, the claude.ai artifact needs republishing separately; the desktop app gets it through an update.
