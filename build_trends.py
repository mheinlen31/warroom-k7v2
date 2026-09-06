#!/usr/bin/env python3
"""Distil nine years of this league's auctions into js/trends.js.

Everything here is AUCTION picks only -- keepers are priced by rule, not by
bidding, so they say nothing about how the room spends. Recent window is
2021-25 (the league's spending pattern shifted hard toward RB around 2021).
"""
import json, sqlite3, statistics as S
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

DB = Path.home() / "sunday-funday-draft" / "sunday_funday_draft.db"
OUT = Path(__file__).resolve().parent / "js" / "trends.js"
POS = ['QB', 'RB', 'WR', 'TE', 'K', 'D/ST']
RECENT = 2021

def pos(r):
    p = (r['position'] or '').upper().replace(' ', '')
    return 'D/ST' if p in ('DST', 'D/ST', 'DEF', 'D', 'DEFENSE') else p

con = sqlite3.connect(DB); con.row_factory = sqlite3.Row
D = [dict(r) for r in con.execute("select * from drafts") if not r['is_keeper']]
years = sorted({r['year'] for r in D}); recent = [y for y in years if y >= RECENT]

def share(yrs):
    out = {}
    for p in POS:
        vals = []
        for y in yrs:
            yr = [r for r in D if r['year'] == y]; tot = sum(r['price'] for r in yr) or 1
            vals.append(sum(r['price'] for r in yr if pos(r) == p) / tot)
        out[p] = round(S.mean(vals), 4)
    return out

ladder = {}
for p in POS:
    ladder[p] = {}
    for n in (1, 2, 3, 5, 8, 12, 16, 20):
        vals = []
        for y in recent:
            xs = sorted((r['price'] for r in D if r['year'] == y and pos(r) == p), reverse=True)
            if len(xs) >= n: vals.append(xs[n - 1])
        if vals: ladder[p][n] = round(S.mean(vals))

# the full ladder, rank 1..25, for shaping each position's spend curve:
# average price of the Nth most expensive auction pick, recent years, where
# at least three seasons drafted that many at the position
ladderFull = {}
for p in POS:
    col = []
    for n in range(1, 26):
        vals = []
        for y in recent:
            xs = sorted((r['price'] for r in D if r['year'] == y and pos(r) == p), reverse=True)
            if len(xs) >= n: vals.append(xs[n - 1])
        if len(vals) >= 3: col.append(round(S.mean(vals), 1))
    ladderFull[p] = col

kdst = {}
for p in ('K', 'D/ST'):
    xs = [r['price'] for r in D if pos(r) == p]; c = Counter(xs)
    kdst[p] = {"n": len(xs), "one": round(c[1] / len(xs), 2), "two": c[2],
               "threePlus": sum(v for k, v in c.items() if k >= 3), "mean": round(S.mean(xs), 2),
               "max": max(xs),
               "outliers": [{"year": r['year'], "name": r['player'], "price": r['price']}
                            for r in D if pos(r) == p and r['price'] >= 3]}

th = defaultdict(list)
for y in recent:
    yr = sorted((r['price'] for r in D if r['year'] == y), reverse=True); tot = sum(yr)
    th['top5'].append(sum(yr[:5]) / tot); th['top10'].append(sum(yr[:10]) / tot); th['top20'].append(sum(yr[:20]) / tot)
    th['b50'].append(sum(1 for x in yr if x >= 50)); th['b30'].append(sum(1 for x in yr if 30 <= x < 50))
    th['b10'].append(sum(1 for x in yr if 10 <= x < 30)); th['b2'].append(sum(1 for x in yr if 2 <= x < 10))
    th['b1'].append(sum(1 for x in yr if x == 1)); th['picks'].append(len(yr))
topHeavy = {k: round(S.mean(v), 3 if k.startswith('top') else 1) for k, v in th.items()}

P = [r for r in D if r['pts_ppr'] is not None and r['price'] > 0]
hits = {}
for p in ('QB', 'RB', 'WR', 'TE'):
    xs = [r for r in P if pos(r) == p and r['price'] == 1]
    hits[p] = {"n": len(xs), "top24": round(sum(1 for r in xs if (r['rk_ppr'] or 999) <= 24) / len(xs), 2),
               "top12": round(sum(1 for r in xs if (r['rk_ppr'] or 999) <= 12) / len(xs), 2)}
bust = {}
for p in ('RB', 'WR'):
    xs = [r for r in P if pos(r) == p and r['price'] >= 30]
    bust[p] = {"n": len(xs), "rate": round(sum(1 for r in xs if (r['rk_ppr'] or 999) > 24 or r['dnp']) / len(xs), 2)}

# owner first names in the draft database -> current franchise (from Matt, Sept 5 2026)
OWNER_TEAM = {"Matt": "Silent Pugios", "Leo": "Centersup", "Mike": "House Bom", "John": "Juice",
              "Bob": "The Pu Pu Platters", "Mark": "Ben Fong Torres", "Pat": "AFRESHAYPEPPER ASAYWHEN",
              "Steve": "Paw", "AJ": "Chance", "Brian": "Magic Rats"}

R = [r for r in D if r['year'] >= RECENT]; lgtot = sum(r['price'] for r in R)
lg = {p: sum(r['price'] for r in R if pos(r) == p) / lgtot for p in POS}
owners = []
for o in sorted({r['owner'] for r in R}):
    ors = [r for r in R if r['owner'] == o]; tot = sum(r['price'] for r in ors) or 1
    tilt = {p: round((sum(r['price'] for r in ors if pos(r) == p) / tot - lg[p]) * 100) for p in ('QB', 'RB', 'WR', 'TE')}
    owners.append({"owner": o, "team": OWNER_TEAM.get(o), "years": len({r['year'] for r in ors}), "avg": round(S.mean(r['price'] for r in ors), 1),
                   "big": sum(1 for r in ors if r['price'] >= 50), "tilt": tilt,
                   "lean": max(tilt, key=lambda p: abs(tilt[p]))})

qbTop = []
for y in years:
    q = sorted(((r['price'], r['player']) for r in D if r['year'] == y and pos(r) == 'QB'), reverse=True)[:2]
    qbTop.append({"year": y, "top": [{"name": n, "price": p} for p, n in q]})

# what this league has paid for each player, every year he was rostered (keepers included,
# flagged) -- keyed the way the front-end normalises names (letters and spaces, suffix dropped)
import re
NAME_FIX = {"puka nakua": "puka nacua"}
SUFFIX = {"jr", "sr", "ii", "iii", "iv", "v"}
def jskey(name):
    k = re.sub(r"\s+", " ", re.sub(r"[^a-z ]", "", str(name).lower())).strip()
    k = NAME_FIX.get(k, k)
    parts = k.split()
    while parts and parts[-1] in SUFFIX:
        parts.pop()
    return " ".join(parts)
history = {}
for r in (dict(x) for x in con.execute("select * from drafts")):
    history.setdefault(jskey(r['player']), []).append({
        "y": r['year'], "p": r['price'], "o": OWNER_TEAM.get(r['owner'], r['owner']), "k": bool(r['is_keeper']),
        "pts": round(r['pts_ppr']) if r['pts_ppr'] is not None else None, "rk": r['rk_ppr'], "gp": round(r['gp']) if r['gp'] else None})
for k in history:
    history[k].sort(key=lambda x: -x['y'])

payload = {"generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
           "history": history,
           "years": years, "recent": recent,
           "share": share(recent), "shareEarly": share([y for y in years if y < RECENT]),
           "ladder": ladder, "ladderFull": ladderFull, "kdst": kdst, "topHeavy": topHeavy, "dollarHits": hits, "bust": bust,
           "owners": owners, "qbTop": qbTop}
OUT.write_text("window.GUIDE_TRENDS = " + json.dumps(payload) + ";\n")
print("trends.js written:", {k: (v if not isinstance(v, (dict, list)) else f"{type(v).__name__}[{len(v)}]") for k, v in payload.items()})
print("share 2021-25:", payload['share'])
