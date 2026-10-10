BOUNTY TCG - DESKTOP APP
========================

Build it
--------
Double-click "Build Bounty TCG.bat". It downloads the Electron runtime (about
110 MB, checked against its published checksum), adds the game and your card
images from the bounty-tcg\cards folder, puts the finished app in the
"Bounty TCG" folder here, adds a desktop shortcut, makes "Bounty TCG.zip"
for sharing and starts the game.

Run it again any time you get an updated "app" folder.

Share it with a friend
----------------------
Send "Bounty TCG.zip" (or upload it to Google Drive). They unzip it and
open "Play Bounty TCG" in the folder it makes. Nothing else to install, no
accounts. The first time the game opens, it puts a Bounty TCG shortcut on
their desktop.

Updates
-------
The game checks github.com/ryanmTCG/Bounty-TCG each time it starts. When a
new version is out it downloads it, says so at the top of the screen, and
switches to it when you restart (or the next time you open the game).
Game > Check for updates checks right away. Card images aren't part of
updates, so everyone keeps the ones they have.

Play online
-----------
Join table > pick a room code > send it to your friend > they type the same
code. Players connect directly to each other. The free public PeerJS service
introduces the two computers; after that the game traffic goes between you.

Card reading (automatic card effects)
-------------------------------------
On claude.ai the page used Claude to read effect text off the card art. In
the desktop app each player can add their own Claude API key under
Game > Card reading. Without a key the game still plays; effects are applied
by hand, the same as with "Auto card effects" turned off.

Getting it onto Steam
---------------------
The "Game files" folder is exactly what you upload to Steam as the game's
content (the depot), with "Bounty TCG.exe" as the launch option.
What Steam needs that isn't code:
 1. A Steamworks partner account and the $100 app fee per game.
 2. Tax and bank details, a store page, capsule art, screenshots, and Valve's
    review (a few days per review, and the store page must be up about
    2 weeks before release).
 3. Rights to the card art and the One Piece name. The images are Bandai's,
    and Steam requires you to own or license everything in the game. Without
    a license from Bandai, a Steam release using these cards and the One Piece
    name would very likely be rejected or taken down. The way around it is your
    own art and names, or a game with no bundled cards where players import
    their own images.
 4. For a real release, its own matchmaking server instead of the public PeerJS
    service, or Steam's own networking (Steamworks SDK).
