#!/usr/bin/env python3
"""Build js/players.js for the draft guide -- ESPN's full draftable pool with
the fields a value model needs: projected season points, auction value, ADP,
consensus rank, injury flag and a short outlook blurb.

Run:  python3 build_players.py     (prep.sh does this for you)
"""
import json, re, unicodedata, urllib.request
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SEASON = 2026
URL = ("https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/"
       f"{SEASON}/segments/0/leaguedefaults/3?view=kona_player_info")
FILTER = {"players": {"limit": 2000, "sortDraftRanks": {
    "sortPriority": 100, "sortAsc": True, "value": "PPR"}}}
POS = {1: "QB", 2: "RB", 3: "WR", 4: "TE", 5: "K", 16: "D/ST"}
PRO_TEAM = {1: "ATL", 2: "BUF", 3: "CHI", 4: "CIN", 5: "CLE", 6: "DAL", 7: "DEN",
            8: "DET", 9: "GB", 10: "TEN", 11: "IND", 12: "KC", 13: "LV", 14: "LAR",
            15: "MIA", 16: "MIN", 17: "NE", 18: "NO", 19: "NYG", 20: "NYJ", 21: "PHI",
            22: "ARI", 23: "PIT", 24: "LAC", 25: "SF", 26: "SEA", 27: "TB", 28: "WSH",
            29: "CAR", 30: "JAX", 33: "BAL", 34: "HOU"}
NFL_ABBR = {"cardinals": "ari", "falcons": "atl", "ravens": "bal", "bills": "buf",
            "panthers": "car", "bears": "chi", "bengals": "cin", "browns": "cle",
            "cowboys": "dal", "broncos": "den", "lions": "det", "packers": "gb",
            "texans": "hou", "colts": "ind", "jaguars": "jax", "chiefs": "kc",
            "raiders": "lv", "chargers": "lac", "rams": "lar", "dolphins": "mia",
            "vikings": "min", "patriots": "ne", "saints": "no", "giants": "nyg",
            "jets": "nyj", "eagles": "phi", "steelers": "pit", "49ers": "sf",
            "seahawks": "sea", "buccaneers": "tb", "titans": "ten", "commanders": "wsh"}
SUFFIXES = {"jr", "sr", "ii", "iii", "iv", "v"}
OUTLOOK_TOP = 260      # blurbs only for players who could plausibly matter


def norm(name):
    s = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    s = re.sub(r"[^a-z ]", "", s.lower().replace(".", " ").replace("'", ""))
    return " ".join(p for p in s.split() if p not in SUFFIXES)


def img(name, pos, pid):
    if pos == "D/ST":
        ab = NFL_ABBR.get(norm(name))
        return f"https://a.espncdn.com/i/teamlogos/nfl/500/{ab}.png" if ab else None
    return f"https://a.espncdn.com/i/headshots/nfl/players/full/{pid}.png" if pid else None


def projection(p):
    """ESPN's projected season total: statSourceId 1 = projection,
    statSplitTypeId 0 = full season."""
    for s in p.get("stats") or []:
        if (s.get("statSourceId") == 1 and s.get("statSplitTypeId") == 0
                and s.get("seasonId") == SEASON):
            return round(float(s.get("appliedTotal") or 0), 1)
    return 0.0


def main():
    req = urllib.request.Request(URL, headers={
        "X-Fantasy-Filter": json.dumps(FILTER), "User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=90) as r:
        data = json.load(r)

    seen, out, rankings_shape = set(), [], None
    for entry in data.get("players", []):
        p = entry.get("player") or {}
        pos = POS.get(p.get("defaultPositionId"))
        if not pos:
            continue
        name = (p.get("fullName") or "").replace(" D/ST", "").strip()
        if not name or norm(name) in seen:
            continue
        seen.add(norm(name))
        own = p.get("ownership") or {}
        ranks = p.get("draftRanksByRankType") or {}
        rank = ((ranks.get("PPR") or ranks.get("STANDARD") or {}).get("rank")) or 9999
        if rankings_shape is None and p.get("rankings"):
            rankings_shape = json.dumps(p["rankings"])[:300]
        inj = p.get("injuryStatus")
        # ESPN publishes several rankers per player; the mean PPR rank across
        # them is a real consensus, and the spread says how much they disagree
        ppr = [r["rank"] for grp in (p.get("rankings") or {}).values()
               for r in (grp or []) if r.get("rankType") == "PPR" and r.get("rank")]
        cons = round(sum(ppr) / len(ppr), 1) if ppr else None
        spread = (max(ppr) - min(ppr)) if len(ppr) > 1 else 0
        rec = {
            "name": name, "pos": pos,
            "nfl": PRO_TEAM.get(p.get("proTeamId")) if pos != "D/ST" else None,
            "img": img(name, pos, p.get("id")),
            "aav": round(own.get("auctionValueAverage") or 0, 1),
            "adp": round(own.get("averageDraftPosition") or 0, 1),
            "rank": rank,
            "proj": projection(p),
            "inj": None if not inj or inj == "ACTIVE" else inj,
            "cons": cons, "spread": spread, "nrank": len(ppr),
        }
        if rank <= OUTLOOK_TOP and p.get("seasonOutlook"):
            o = re.sub(r"\s+", " ", p["seasonOutlook"]).strip()
            rec["outlook"] = (o[:300] + "…") if len(o) > 300 else o
        out.append(rec)

    out.sort(key=lambda x: (x["rank"], -x["aav"], x["name"]))
    payload = {"season": SEASON,
               "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
               "players": out}
    (ROOT / "js" / "players.js").write_text(
        "window.GUIDE_PLAYERS = " + json.dumps(payload) + ";\n")
    print(f"wrote {len(out)} players:", dict(Counter(p['pos'] for p in out)))
    print("with projection:", sum(1 for p in out if p["proj"] > 0),
          "| with aav:", sum(1 for p in out if p["aav"] > 0),
          "| injured flagged:", sum(1 for p in out if p["inj"]))
    print("with consensus:", sum(1 for p in out if p["cons"]),
          "| rankers seen up to:", max((p["nrank"] for p in out), default=0))


if __name__ == "__main__":
    main()
