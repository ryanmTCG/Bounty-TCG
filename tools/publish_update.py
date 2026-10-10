#!/usr/bin/env python3
"""Packs the built game (dist/kit/app/web) as an update every installed copy picks up.

    python3 tools/build.py && python3 tools/publish_update.py "What changed, in one sentence."

Writes updates/web-<version>.json.gz and updates/latest.json. Commit both and push to main:
each copy of the app reads updates/latest.json from GitHub when it starts, downloads the
bundle, checks its SHA-256 and switches to it on the next launch.

Bump "version" in version.json first. If main.src.js or preload.js changed, also raise
SHELL_VERSION in desktop/main.src.js and "shell" in version.json to match: copies with an
older shell are then told to download the full app instead of installing the update.
"""
import base64, glob, gzip, hashlib, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB = os.path.join(ROOT, "dist", "kit", "app", "web")
UPD = os.path.join(ROOT, "updates")
# Bandai's images stay out of the public repository; installed copies keep the ones they shipped with.
SKIP = {"static/don.png", "static/dondeck.jpg", "static/sleeve.png"}
KEEP = 3   # bundles kept in updates/

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
notes = (sys.argv[1] if len(sys.argv) > 1 else "").strip()[:300]
latest = {"version": ver["version"], "shell": ver["shell"], "bundle": name, "sha256": hashlib.sha256(data).hexdigest(), "size": len(data), "notes": notes}
json.dump(latest, open(os.path.join(UPD, "latest.json"), "w"), indent=2)
bundles = sorted(glob.glob(os.path.join(UPD, "web-*.json.gz")), key=lambda p: [int(x) for x in re.findall(r"\d+", os.path.basename(p))])
for p in bundles[:-KEEP]: os.remove(p)
print(f"updates/{name}: {len(files)} files, {len(data) // 1024} KB")
print(json.dumps(latest, indent=2))
