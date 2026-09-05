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


# ------------------------------------------------------------------ sources
SOURCES = ROOT / "sources"
HDR = {
    "name": ["player name", "player", "name"],
    "pos": ["position", "pos"],
    "rank": ["overall rank", "overall", "ecr", "rank", "rk", "#"],
    "posrank": ["position rank", "pos rank", "posrank", "prk"],
    "proj": ["projected points", "fantasy points", "projection", "proj", "fpts", "points", "pts"],
    "aav": ["auction value", "avg $", "auction", "aav", "value", "$"],
}
POS_ALIAS = {"DST": "D/ST", "DEF": "D/ST", "D": "D/ST", "PK": "K"}


def _rows(path):
    """yield dict rows from a csv or xlsx, headers lower-cased"""
    if path.suffix.lower() == ".csv":
        import csv
        with open(path, newline="", encoding="utf-8-sig") as fh:
            for r in csv.DictReader(fh):
                yield {str(k or "").strip().lower(): (v or "").strip() for k, v in r.items()}
    elif path.suffix.lower() in (".xlsx", ".xlsm"):
        from openpyxl import load_workbook
        ws = load_workbook(path, read_only=True, data_only=True).active
        it = ws.iter_rows(values_only=True)
        hdr = [str(h or "").strip().lower() for h in next(it)]
        for row in it:
            yield {hdr[i]: ("" if v is None else str(v).strip()) for i, v in enumerate(row) if i < len(hdr)}


def _col(row, key):
    for h in HDR[key]:
        if h in row and row[h] != "":
            return row[h]
    return None


def _num(v):
    try:
        return float(str(v).replace("$", "").replace(",", ""))
    except (TypeError, ValueError):
        return None


def _clean_name(raw, pos):
    n = re.sub(r"\(.*?\)", "", raw)                  # "Josh Allen (BUF)"
    n = re.sub(r"\b(D/ST|DST|Defense)\b", "", n, flags=re.I).strip(" ,-")
    if pos == "D/ST" and n:
        n = n.split()[-1]                             # "Baltimore Ravens" -> Ravens
    return n


def read_sources():
    """-> list of (source_name, {norm_name: {pos, rank, posrank, proj, aav}})"""
    out = []
    if not SOURCES.exists():
        return out
    for path in sorted(SOURCES.iterdir()):
        if path.name.startswith(("_", ".")) or path.suffix.lower() not in (".csv", ".xlsx", ".xlsm"):
            continue
        rows, bad = {}, 0
        for r in _rows(path):
            raw = _col(r, "name")
            if not raw:
                continue
            pos_raw = (_col(r, "pos") or "").upper()
            m = re.match(r"([A-Z/]+)(\d+)?", pos_raw)
            pos = POS_ALIAS.get(m.group(1), m.group(1)) if m else None
            posrank = _num(_col(r, "posrank")) or (float(m.group(2)) if m and m.group(2) else None)
            name = _clean_name(raw, pos)
            if not name:
                bad += 1
                continue
            rows[norm(name)] = {"pos": pos, "rank": _num(_col(r, "rank")), "posrank": posrank,
                                "proj": _num(_col(r, "proj")), "aav": _num(_col(r, "aav"))}
        out.append((path.stem, rows))
        print(f"source {path.name}: {len(rows)} rows" + (f", {bad} unreadable" if bad else ""))
    return out


def blend(players, sources):
    """Fold outside sources into the ESPN pool. Consensus rank is the mean
    overall rank across everything that has one; projection is the mean of
    ESPN's and each source's (a rank-only source gets an implied projection:
    ESPN's projection at that positional rank); auction value likewise."""
    for p in players:
        p["projEspn"] = p["proj"]
        p["srcRanks"] = {}
        p["nsrc"] = 1
    if not sources:
        return
    by_norm = {norm(p["name"]): p for p in players}
    curve = {}
    for pos in set(p["pos"] for p in players):
        curve[pos] = [p["proj"] for p in sorted((x for x in players if x["pos"] == pos),
                                                key=lambda x: -x["proj"]) if p["proj"] > 0]
    for sname, rows in sources:
        by_pos = {}
        for k, r in rows.items():
            if r["rank"] is not None and r["pos"]:
                by_pos.setdefault(r["pos"], []).append((r["rank"], k))
        implied_prk = {}
        for pos, lst in by_pos.items():
            for i, (_, k) in enumerate(sorted(lst)):
                implied_prk[k] = i + 1
        unmatched = []
        for k, r in rows.items():
            p = by_norm.get(k)
            if not p:
                unmatched.append(k)
                continue
            projs = p.setdefault("_projs", [p["projEspn"]] if p["projEspn"] > 0 else [])
            aavs = p.setdefault("_aavs", [p["aav"]] if p["aav"] > 0 else [])
            ranks = p.setdefault("_ranks", ([p["cons"]] if p.get("cons") else []))
            if r["rank"] is not None:
                ranks.append(r["rank"]); p["srcRanks"][sname] = r["rank"]
            if r["proj"] is not None and r["proj"] > 0:
                projs.append(r["proj"])
            else:
                prk = r["posrank"] or implied_prk.get(k)
                cv = curve.get(p["pos"], [])
                if prk and 1 <= int(prk) <= len(cv):
                    projs.append(cv[int(prk) - 1])
            if r["aav"] is not None and r["aav"] > 0:
                aavs.append(r["aav"])
        if unmatched:
            print(f"  {sname}: {len(unmatched)} names not in the ESPN pool, e.g. {unmatched[:6]}")
    for p in players:
        if p.get("_projs"):
            p["proj"] = round(sum(p["_projs"]) / len(p["_projs"]), 1)
        if p.get("_aavs"):
            p["aav"] = round(sum(p["_aavs"]) / len(p["_aavs"]), 1)
        if p.get("_ranks"):
            p["cons"] = round(sum(p["_ranks"]) / len(p["_ranks"]), 1)
            p["spread"] = round(max(p["_ranks"]) - min(p["_ranks"]))
        p["nsrc"] = 1 + len(p.get("srcRanks", {}))
        for k in ("_projs", "_aavs", "_ranks"):
            p.pop(k, None)
    print(f"blended {len(sources)} outside source(s) into the pool")


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

    blend(out, read_sources())
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
