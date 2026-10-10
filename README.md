# Bounty TCG

A tabletop for playing the One Piece Card Game with friends: build decks, sit at a table with a room code or an open lobby, and play it out with drag-and-drop cards, DON!!, Life and combat helpers.

**Download for Windows:** [Bounty TCG on Google Drive](https://drive.google.com/file/d/1ci7He3Kh788nOqYoMZOrhuJtbyJnjsDl/view). If Google Drive asks you to request access, send the request.

This is an unofficial fan project. It isn't affiliated with or endorsed by Bandai, and this repository doesn't include any card images.

## Playing

The desktop app runs on Windows. Unzip the download and open **Play Bounty TCG** in the folder it makes. There's nothing to install and no account to make. The first time it opens, it puts a shortcut on your desktop.

- **Join table:** pick a room code and send it to a friend. When they type the same code, you're at the same table.
- **Lobbies:** make an open table that anyone playing can see and join.
- **Deck editor:** build decks, with banned and rotated cards marked for Standard and Extra.

Players connect directly to each other. The free public PeerJS service only introduces the two computers.

## Updates

The app checks this repository each time it starts. When there's a new version, it downloads it, says so at the top of the screen and uses it from the next restart. **Game > Check for updates** checks right away.

Updates carry the game itself and the card list. Card images and the DON!! and sleeve pictures stay on each player's computer.

## Building

You need Node 22 and Python 3.

```
npm install
python3 tools/build.py      # makes dist/kit
```

`dist/kit` goes to a Windows PC. Double-click `Build Bounty TCG.bat` there: it downloads Electron, adds the card images from a `cards` folder, makes the **Bounty TCG** app folder with a desktop shortcut, and zips it as `Bounty TCG.zip` for sharing. The folder has `Play Bounty TCG.exe` (a small launcher built from `desktop/kit/launcher.cs`) on top and the app in `Game files`.

The DON!! card and card-back images aren't in this repository. Put `don.png`, `dondeck.jpg` and `sleeve.png` in `private/static/` before building, or the DON!! cards and sleeves show blank.

## Publishing an update

1. Make the change, usually in `page/bounty-tcg.html` or `desktop/net.js`.
2. Raise `version` in `version.json`.
3. Build and pack it:
   ```
   python3 tools/build.py
   python3 tools/publish_update.py "One sentence on what changed."
   ```
4. Commit and push to `main`. Every copy of the app picks it up on its next launch.

If `desktop/main.src.js` or `desktop/preload.js` changed, raise `SHELL_VERSION` in `main.src.js`. Those files can't be updated in place; they reach players with the full app download. If the game page needs the new shell to work, also set `shell` in `version.json` to that number, and older copies are asked to download the full app.

## Layout

| Path | What it is |
| --- | --- |
| `page/bounty-tcg.html` | The game: one HTML page with all of its CSS and JavaScript |
| `desktop/` | The Electron shell (`main.src.js`, `preload.js`), the runtime that replaces claude.ai services (`net.js`), icons and the Windows build kit |
| `data/` | The card list (names, colors, types, cost, power) and card-reader settings |
| `tools/` | `build.py` makes the desktop kit, `publish_update.py` packs an update |
| `updates/` | `latest.json` and the newest update bundles the app downloads |
| `tests/` | Playwright tests that drive the built app (run with `xvfb-run -a node tests/<name>.mjs`) |
