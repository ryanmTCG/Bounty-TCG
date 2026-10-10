# Notes for Claude

Bounty TCG is a One Piece Card Game tabletop. The same game page runs in two places: as a claude.ai artifact (Ryan's online page) and inside the Electron desktop app built from this repository.

## Where things live

- `page/bounty-tcg.html` is the source of truth for the game. It is written for claude.ai's `window.claude.use(...)` capabilities (room, db, assets, user, sample).
- `desktop/net.js` provides those capabilities in the desktop app: PeerJS rooms (the room namespace itself is the shared lobby), localStorage db with `seed.json`, card art on disk, and card reading with the player's own Claude API key. It also shows update banners.
- `tools/build.py` patches the page for the desktop (bundled fonts, wording that assumed claude.ai accounts) and builds `dist/kit`. Every patch must match exactly once, or the build stops.
- `desktop/main.src.js` is the Electron main process. It serves `app://bounty/` and runs the updater.

## Updates

Installed copies read `https://raw.githubusercontent.com/ryanmTCG/Bounty-TCG/main/updates/latest.json` at launch. To ship a change:

1. Bump `version` in `version.json`.
2. Run `python3 tools/build.py`, then `python3 tools/publish_update.py "notes"`.
3. Commit `updates/` with the change and push to `main`.

Whatever is on `main` in `updates/latest.json` reaches every player, so only publish tested builds. Changes to `main.src.js` or `preload.js` need `SHELL_VERSION` raised, and only reach players through a full app download. Raise `version.json`'s `shell` to match only when the page depends on the new shell: players on an older shell are then sent to download the full app.

## Rules

- Never commit card art, `*.webp`, or Bandai's DON!!/sleeve images. `private/static/` holds the latter locally and is gitignored. Update bundles skip them too.
- Run the tests in `tests/` against `dist/kit/app` after building: `xvfb-run -a node tests/testupdate.mjs`, `testlobby.mjs`, `testlegal.mjs`, `test2p.mjs`. The multiplayer tests start a local PeerJS server from the `peer` package.
- After changing the page, the claude.ai artifact needs republishing separately; the desktop app gets it through an update.
