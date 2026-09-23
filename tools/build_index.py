"""
Erzeugt pages/index.json – die Liste aller Arbeiten für die Works-Seite.

Einfach nach jeder neuen / gelöschten .md-Datei ausführen:
    python tools/build_index.py

Dateien, die mit "_" beginnen (z. B. _vorlage.md), werden ignoriert.
"""
import json
from pathlib import Path

pages = Path(__file__).resolve().parent.parent / "pages"
files = sorted(p.name for p in pages.glob("*.md") if not p.name.startswith("_"))

(pages / "index.json").write_text(json.dumps(files, indent=2, ensure_ascii=False), encoding="utf-8")
print(f"{len(files)} Arbeit(en) in pages/index.json eingetragen:")
for f in files:
    print("  -", f)
