#!/usr/bin/env python3
"""Hand the draft board what it needs to grade the drafts once the last spot
fills: each player's projection in the league's scoring (blended across
sources, news-adjusted) and his composite positional rank. Written to the
board repo as js/grades-data.js; the board only loads it when the draft is
complete. Run after build_players.py (prep.sh does)."""
import json, re, pathlib, datetime
ROOT = pathlib.Path(__file__).resolve().parent
src = (ROOT / "js" / "players.js").read_text()
data = json.loads(src[src.index("{"): src.rindex("}") + 1])
players = [{"name": p["name"], "pos": p["pos"], "proj": round(p["proj"], 1),
            "full": round(p.get("projFull") or p["proj"], 1), "cpos": p.get("cpos"),
            "games": p.get("games")}
           for p in data["players"] if (p.get("proj") or 0) > 0]
out = {"generated": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
       "source": data.get("generated"), "players": players}
dest = ROOT.parent / "draft-board" / "js" / "grades-data.js"
dest.write_text("window.GRADE_POOL = " + json.dumps(out, separators=(",", ":")) + ";\n")
print(f"grades data: {len(players)} players -> {dest}")
