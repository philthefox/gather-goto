#!/usr/bin/env python3
"""Builds picker/index.html from template.html + data.json (exported by tools/export-map.mjs).

    python3 picker/build.py [data.json]     a relative path is resolved against the current directory
"""
import json, pathlib, sys
here = pathlib.Path(__file__).resolve().parent
src = pathlib.Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else here / "data.json"
if len(sys.argv) == 1 and not src.exists():
    src = here / "data.example.json"   # synthetic demo floor; export your own with tools/export-map.mjs
    print(f"no data.json yet, using {src.name}")
try:
    data = json.loads(src.read_text())
except (OSError, ValueError) as e:
    sys.exit(f"cannot read {src}: {e}\nrun: node tools/export-map.mjs")
payload = json.dumps(data, separators=(",", ":")).replace("</", "<\\/")
html = (here / "template.html").read_text().replace("__DATA__", payload)
(here / "index.html").write_text(html)
print(f"wrote {here / 'index.html'} ({len(html)} bytes)")
