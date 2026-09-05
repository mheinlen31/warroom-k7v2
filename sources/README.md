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
- Consensus rank = mean of overall rank across ESPN + every source that has it.
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
