# Changes waiting for the next app update

The desktop app gets an update once 10 changes have piled up here, unless Ryan asks for one sooner.
Add one line per change. `tools/publish_update.py` publishes them and empties this list.

- The table background is an old sea chart instead of water.
- The home screen and deck builder use the sea-chart background too.
- The home screen has three buttons (Play, Deck editor, Sign in); Play opens a page with the game modes.
- The deck editor's Back to table button is now Home.
- The deck editor's Use this deck button is now Play: it saves the deck and opens the Play page.
- The deck editor's filter bar is tidier: search and dropdowns on one row, colors and sort below, checkboxes in their own row.
- The deck editor hides banned and rotated cards by default.
- The deck editor's card list loads more cards by itself as you scroll, so there's no Show more button.
