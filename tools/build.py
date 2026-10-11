#!/usr/bin/env python3
"""Builds the Bounty TCG desktop kit in dist/kit from the game page and the desktop shell.

    python3 tools/build.py

dist/kit is what goes to a Windows PC: double-click "Build Bounty TCG.bat" there and it
downloads Electron, adds the card images and makes the "Bounty TCG" app folder.
dist/kit/app is the app itself, which the tests run with the Linux Electron from node_modules.

The DON!! and card-back images are Bandai's, so they're not in this repository. The build
takes them from private/static (or the folder in BOUNTY_STATIC) when they're there.
"""
import json, glob, os, shutil, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_HTML = os.path.join(ROOT, "page", "bounty-tcg.html")
DESK = os.path.join(ROOT, "desktop")
DATA = os.path.join(ROOT, "data")
STATIC = os.environ.get("BOUNTY_STATIC") or os.path.join(ROOT, "private", "static")
NM = os.path.join(ROOT, "node_modules")
KIT = os.path.join(ROOT, "dist", "kit")
OUT = os.path.join(KIT, "app")
WEB = os.path.join(OUT, "web")
VER = json.load(open(os.path.join(ROOT, "version.json")))

shutil.rmtree(KIT, ignore_errors=True)
os.makedirs(os.path.join(WEB, "static"))
os.makedirs(os.path.join(WEB, "fonts"))

html = open(SRC_HTML, encoding="utf-8").read()
def rep(a, b, n=1):
    global html
    c = html.count(a)
    if c != n: sys.exit(f"patch expected {n} got {c}: {a[:80]}")
    html = html.replace(a, b)

# fonts bundled instead of Google Fonts
rep('''<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Alfa+Slab+One&family=Barlow+Semi+Condensed:wght@400;500;600;700&display=swap" rel="stylesheet">''',
'''<link rel="icon" href="static/icon.png">
<link rel="stylesheet" href="fonts.css">''')
# standalone runtime before the game script
rep('\n<script>\n', '\n<script src="peerjs.min.js"></script>\n<script src="net.js"></script>\n<script>\n')
# wording that assumed claude.ai accounts
rep('toast("Couldn\'t join a live room. Live play needs everyone signed in and invited to this page. Playing solo for now.");',
    'toast("Couldn\'t reach the online table service. Check your internet connection and try again. Playing solo for now.");')
rep('''async function diagnose(){
  const r = {};''', '''async function diagnose(){
  toast("Pick a room code in Join table and send it to your friend. When they enter the same code, you're at the same table.");
  return;
  const r = {};''')
rep('"<b>Signed in.</b> Your decks save to your account on any device."',
    '"<b>Ready to play.</b> Share a room code with a friend to play online. Your decks and card art save on this computer."')
rep('function acctBtn(){ const a = fbAcct(); return a ? (a.user() ? "Account" : "Sign in") : "Sign in"; }',
    'function acctBtn(){ const a = fbAcct(); return a ? (a.user() ? "Account" : "Sign in") : "How to play online"; }')
rep('"Saved in this browser only, because account storage isn\'t available here."', '"Saved on this computer."')
rep('Images are shrunk to save space and shared with everyone at the table, so your opponent sees them too.',
    'Images are shrunk to save space and saved on this computer. Your opponent sees the art from their own copy of the game.')
rep('"Reading names needs Claude, which isn\'t available in this view. Open the page from your own Claude account, signed in."',
    '"Reading cards needs a Claude API key. Add one from Game > Card reading in the menu bar."')
rep('if (!fx) { if (manual) toast("Couldn\'t read the card text here."); return; }',
    'if (!fx) { if (manual) toast("Card reading needs a Claude API key. Add one from Game > Card reading in the menu bar."); return; }')
open(os.path.join(WEB, "index.html"), "w", encoding="utf-8").write(html)

# card database: names + settings; art is indexed from the cards folder at startup
seed = {}
for coll in ("names", "settings"):
    for f in sorted(glob.glob(os.path.join(DATA, coll, "*.json"))):
        seed[coll + "/" + os.path.basename(f)[:-5]] = json.load(open(f))
json.dump(seed, open(os.path.join(WEB, "seed.json"), "w"), separators=(",", ":"))
json.dump({"version": VER["version"], "shell": VER["shell"]}, open(os.path.join(WEB, "version.json"), "w"))

shutil.copy(os.path.join(ROOT, "page", "effects.json"), WEB)
shutil.copy(os.path.join(DESK, "net.js"), WEB)
shutil.copy(os.path.join(NM, "peerjs", "dist", "peerjs.min.js"), WEB)
shutil.copy(os.path.join(DESK, "icon.png"), os.path.join(WEB, "static", "icon.png"))
missing = [n for n in ("don.png", "dondeck.jpg", "sleeve.png") if not os.path.exists(os.path.join(STATIC, n))]
for n in ("don.png", "dondeck.jpg", "sleeve.png"):
    if n not in missing: shutil.copy(os.path.join(STATIC, n), os.path.join(WEB, "static", n))
if missing: print("warning: no", ", ".join(missing), "in", STATIC, "- DON!! cards and sleeves will be blank")

css = []
fs_ = os.path.join(NM, "@fontsource")
for fam, pkg, weights in (("Alfa Slab One", "alfa-slab-one", [400]), ("Barlow Semi Condensed", "barlow-semi-condensed", [400, 500, 600, 700])):
    for w in weights:
        for sub in ("latin", "latin-ext"):
            n = f"{pkg}-{sub}-{w}-normal.woff2"
            shutil.copy(os.path.join(fs_, pkg, "files", n), os.path.join(WEB, "fonts", n))
            css.append(f"@font-face{{font-family:'{fam}';font-style:normal;font-weight:{w};font-display:swap;src:url(fonts/{n}) format('woff2')}}")
open(os.path.join(WEB, "fonts.css"), "w").write("\n".join(css) + "\n")

shutil.copy(os.path.join(DESK, "preload.js"), OUT)
subprocess.run([os.path.join(NM, ".bin", "esbuild"), os.path.join(DESK, "main.src.js"),
                "--bundle", "--platform=node", "--target=node22", "--external:electron", "--minify-syntax",
                "--outfile=" + os.path.join(OUT, "main.js")], check=True)
json.dump({"name": "bounty-tcg", "productName": "Bounty TCG", "version": VER["version"], "description": "Bounty TCG", "main": "main.js", "private": True},
          open(os.path.join(OUT, "package.json"), "w"), indent=2)

for n in os.listdir(os.path.join(DESK, "kit")):
    shutil.copy(os.path.join(DESK, "kit", n), KIT)
shutil.copy(os.path.join(DESK, "icon.ico"), KIT)
print("built", KIT, "version", VER["version"])
