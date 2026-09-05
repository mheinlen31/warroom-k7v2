# Extra ranking sources

Drop CSV or XLSX files in this folder and run `./prep.sh`. Each file is one
source (FantasyPros ECR export, Yahoo, Sleeper, your own sheet...). Columns
are detected by header name, case-insensitive; only PLAYER is required.

| what        | accepted headers                                   |
|-------------|----------------------------------------------------|
| player      | player, name, player name                          |
| position    | pos, position  (also parsed from "RB12")           |
| overall rank| rank, overall, ecr, rk, #                          |
| pos rank    | pos rank, position rank, prk                       |
| projection  | proj, projection, fpts, pts, points, fantasy points|
| auction $   | aav, auction, auction value, value, $, avg $       |
| team        | team, tm, nfl  (optional, ignored for matching)    |

How it blends:
- The board's default order is the COMPOSITE rank: the weighted mean of each
  player's positional rank across ESPN and every source that ranks him (a
  source's positional rank is put on an overall scale through ESPN's ladder for
  the ALL tab). Each source's own rank sits beside the name as a note
  ("ESPN RB1 · ATH RB3 · 353 · SBN RB2 · T1").
- Projection = mean of ESPN's projection and each source's -- a source with
  ranks but no points gets an implied projection (the ESPN projection of the
  player at that positional rank), so rank-only sources still move Model $.
- Auction value = mean across sources that give one (ESPN always does).
Names like "Josh Allen (BUF)" or "Baltimore Ravens" are handled. Unmatched
names are listed when prep.sh runs. Spread shows how far sources disagree.

## Positional guides (side-by-side tables)

A sheet that lays one table per position across the page -- RK, Player, TM,
BYE, FPS, AUC$, a blank column, then the next position -- is read as one table
per block. RK in such a block is the rank WITHIN the position (there is no
overall rank), FPS is the projection, and team names ("Houston Texans") match
the D/ST pool. The Athletic's positional guide is built this way.

## sources.json (optional)

Per-file settings, keyed by the file name without its extension:

    { "The Athletic Positional Guide": { "label": "ATH", "aav": false, "weight": 1 } }

- `label`: short tag shown on player rows (default: the file name's initials).
- `aav`: `false` keeps the file's auction values OUT of Mkt $ -- use it for a
  model's values (The Athletic, a projection system); leave it `true` for real
  market averages (ESPN, FantasyPros AAV). Its projections still feed Model $.
- `weight`: relative weight against ESPN (1) in the blended rank/projection.

## Tiers sheets as PDF

A tiers sheet printed to PDF (SB Nation's) -- one column per position, "Tier N"
markers, names in order, no numbers -- is read too. Order within a column is the
rank within the position and the tier is recorded; the rank becomes an implied
projection (ESPN's projection at that positional rank). Rows show "SBN RB7 · T2".

## League scoring

ESPN's totals are standard PPR (4 points a passing TD); Sunday Funday pays 6.
`LEAGUE_SCORING_DELTA` in build_players.py re-expresses ESPN's projections and
last season's actuals in the league's scoring before anything is blended, so a
source built on 6-point passing TDs (The Athletic) needs no rescaling and one
built on 4 gets scaled up. Add any other difference there as stat id -> extra
points per unit.

## News, injuries, missed games

Every rebuild pulls ESPN's league-wide injury report: status (Questionable, Out,
Injured Reserve, Suspension...), the injury, the latest blurb, and a projected
return date. A player who is Out / IR / suspended with a return date has his
projection scaled to the games he'll play (Week 1 = the first Sunday), and his
composite rank re-derived from that. `sources/news.json` overrides by hand:

    { "Josh Jacobs": { "games": 10, "note": "exempt list · court Sept 10" } }

Rows show the status, the blurb and "~10 gm"; the clock panel shows it large;
the Injury & news watch card lists everyone who matters who isn't simply Active.
