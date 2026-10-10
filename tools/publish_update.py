#!/usr/bin/env python3
"""Packs the built game (dist/kit/app/web) as an update every installed copy picks up.

    python3 tools/build.py && python3 tools/publish_update.py ["What changed."] [--now]

Writes updates/web-<version>.json.gz and updates/latest.json. Commit both and push to main:
each copy of the app reads updates/latest.json from GitHub when it starts, downloads the
bundle, checks its SHA-256 and switches to it on the next launch.

Updates go out in batches: Ryan wants one only once BATCH changes are listed in
updates/pending.md, unless he asks for one sooner (--now). The notes default to that list,
which is emptied after publishing.

Bump "version" in version.json first. If main.src.js or preload.js changed, raise
SHELL_VERSION in desktop/main.src.js; those files only reach players in a full app download.
Set "shell" in version.json to it only when the page needs the new shell: copies with an
older shell are then told to download the full app instead of installing the update.
"""
import base64, glob, gzip, hashlib, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB = os.path.join(ROOT, "dist", "kit", "app", "web")
UPD = os.path.join(ROOT, "updates")
# Bandai's images stay out of the public repository; installed copies keep the ones they shipped with.
SKIP = {"static/don.png", "static/dondeck.jpg", "static/sleeve.png"}
KEEP = 3   # bundles kept in updates/
BATCH = 10 # changes per update
PENDING = os.path.join(UPD, "pending.md")

args = [a for a in sys.argv[1:] if a != "--now"]
now = "--now" in sys.argv[1:]
pending_text = open(PENDING, encoding="utf-8").read()
changes = [l[2:].strip() for l in pending_text.splitlines() if l.startswith("- ")]
if len(changes) < BATCH and not now:
    sys.exit(f"{len(changes)} of {BATCH} changes are waiting in updates/pending.md. Updates go out every {BATCH} changes; "
             "pass --now only when Ryan asked for an update sooner.")

ver = json.load(open(os.path.join(ROOT, "version.json")))
built = json.load(open(os.path.join(WEB, "version.json")))
if built["version"] != ver["version"]:
    sys.exit(f"dist is version {built['version']} but version.json says {ver['version']}: run tools/build.py first")
shell = int(re.search(r"const SHELL_VERSION = (\d+);", open(os.path.join(ROOT, "desktop", "main.src.js")).read()).group(1))
if ver["shell"] > shell:
    sys.exit(f"version.json needs shell {ver['shell']} but main.src.js is shell {shell}")
old = {}
try: old = json.load(open(os.path.join(UPD, "latest.json")))
except FileNotFoundError: pass
if old and [int(x) for x in old["version"].split(".")] >= [int(x) for x in ver["version"].split(".")]:
    sys.exit(f"updates/latest.json is already at {old['version']}: bump version.json")

files = {}
for f in sorted(glob.glob(os.path.join(WEB, "**", "*"), recursive=True)):
    if os.path.isfile(f):
        rel = os.path.relpath(f, WEB).replace(os.sep, "/")
        if rel not in SKIP: files[rel] = base64.b64encode(open(f, "rb").read()).decode()
data = gzip.compress(json.dumps({"version": ver["version"], "files": files}, separators=(",", ":")).encode(), 9, mtime=0)
os.makedirs(UPD, exist_ok=True)
name = f"web-{ver['version']}.json.gz"
open(os.path.join(UPD, name), "wb").write(data)
notes = (args[0] if args else " ".join(c if c.endswith(".") else c + "." for c in changes)).strip()
if len(notes) > 300: notes = notes[:297].rsplit(" ", 1)[0] + "..."
latest = {"version": ver["version"], "shell": ver["shell"], "bundle": name, "sha256": hashlib.sha256(data).hexdigest(), "size": len(data), "notes": notes}
json.dump(latest, open(os.path.join(UPD, "latest.json"), "w"), indent=2)
bundles = sorted(glob.glob(os.path.join(UPD, "web-*.json.gz")), key=lambda p: [int(x) for x in re.findall(r"\d+", os.path.basename(p))])
for p in bundles[:-KEEP]: os.remove(p)
open(PENDING, "w", encoding="utf-8").write("\n".join(l for l in pending_text.splitlines() if not l.startswith("- ")).rstrip() + "\n\n")
print(f"updates/{name}: {len(files)} files, {len(data) // 1024} KB")
print(json.dumps(latest, indent=2))
