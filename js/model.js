/* The value model. Everything on the page derives from compute().

   Prices are not ADP. Two things move a player's real price at THIS table:
     1. Inflation -- keepers were kept below market, so the money left in the
        room outweighs the players left to buy. Recomputed on every pick.
     2. Scarcity -- an open RB1 slot on eight rosters is demand; the eighth
        best RB left is the replacement level. Value is what a player gives
        you ABOVE the guy you could get for $1 at his position.

   Model $ = value-over-replacement (projected points) converted to dollars
             by sharing the room's spendable money in proportion to VOR.
   Mkt $   = ESPN auction value scaled by current inflation. What the room
             will probably pay if it bids on ADP instinct.
   Edge    = Model - Mkt. Positive: the room is likely to underpay him. */
window.GuideModel = (function () {
  const E = window.DraftEngine;
  const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'D/ST'];
  // how open FLEX slots and bench spots tend to get filled, by position
  const FLEX_SHARE = { RB: .50, WR: .42, TE: .08 };
  const BENCH_SHARE = { QB: .08, RB: .42, WR: .40, TE: .10, K: 0, 'D/ST': 0 };
  const BENCH_WEIGHT = .5;   // bench demand counts half: those are replacement-grade fills
  const TIER_GAP = (pts) => Math.max(6, pts * 0.06);

  // the keeper site and ESPN spell a few names differently
  const ALIASES = { 'kenneth gainwell': 'kenny gainwell', 'rickey pearsall': 'ricky pearsall',
                    'jason meyers': 'jason myers' };
  const norm = (n) => { const k = E.normName(n); return ALIASES[k] || k; };

  function compute(pool, state, myName) {
    const teams = (state && state.teams) || [];
    const rostered = new Set();
    teams.forEach((t) => (t.players || []).forEach((p) => rostered.add(norm(p.name))));
    const avail = pool.filter((p) => !rostered.has(norm(p.name))).map((p) => ({ ...p }));

    const ts = teams.map((t) => ({ t, st: E.teamState(t) }));
    const moneyLeft = ts.reduce((s, x) => s + Math.max(0, x.st.remaining), 0);
    const openSpots = ts.reduce((s, x) => s + x.st.open, 0);

    // ---- demand: every unfilled slot in the league, by position ----
    const demand = { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, 'D/ST': 0, FLEX: 0, BENCH: 0 };
    ts.forEach(({ st }) => E.SLOTS.forEach((sl) => {
      if (st.slots[sl.id]) return;
      if (sl.id === 'FLEX') demand.FLEX++;
      else if (sl.id[0] === 'B') demand.BENCH++;
      else demand[sl.takes[0]]++;
    }));
    const starterDemand = {}, qualityDemand = {};
    POSITIONS.forEach((pos) => {
      starterDemand[pos] = demand[pos] + (FLEX_SHARE[pos] || 0) * demand.FLEX;
      qualityDemand[pos] = starterDemand[pos] + (BENCH_SHARE[pos] || 0) * demand.BENCH * BENCH_WEIGHT;
    });

    // ---- replacement level: the player you'd get for nothing at each position ----
    const byPos = {};
    POSITIONS.forEach((pos) => {
      byPos[pos] = avail.filter((p) => p.pos === pos)
        .sort((a, b) => (b.proj - a.proj) || (a.rank - b.rank));
    });
    const repl = {};
    POSITIONS.forEach((pos) => {
      const list = byPos[pos];
      const idx = Math.min(Math.max(list.length - 1, 0), Math.max(0, Math.round(qualityDemand[pos])));
      repl[pos] = list.length ? list[idx].proj : 0;
    });
    avail.forEach((p) => { p.vor = Math.max(0, p.proj - (repl[p.pos] || 0)); });

    // ---- dollars ----
    const spendable = Math.max(0, moneyLeft - openSpots);          // $1 floor per open spot
    const sumVor = avail.reduce((s, p) => s + p.vor, 0) || 1;
    const rate = spendable / sumVor;
    // inflation: the room's money against the ADP value of the players who'll actually be drafted
    const willDraft = avail.slice().sort((a, b) => a.rank - b.rank).slice(0, openSpots);
    const mktValue = willDraft.reduce((s, p) => s + Math.max(1, p.aav), 0) || 1;
    const inflation = openSpots ? moneyLeft / mktValue : 1;

    avail.forEach((p) => {
      p.model = Math.max(1, Math.round(1 + p.vor * rate));
      p.mkt = Math.max(1, Math.round(Math.max(1, p.aav) * inflation));
      p.edge = p.model - p.mkt;
      // who can actually pay the market price AND legally roster him
      p.bidders = ts.filter(({ t, st }) =>
        st.open > 0 && st.maxBid >= p.mkt && E.canRoster(t, p.pos).ok).length;
    });

    // ---- tiers and cliffs within each position ----
    POSITIONS.forEach((pos) => {
      const list = byPos[pos]; let tier = 1;
      list.forEach((p, i) => {
        p.posRank = i + 1;
        if (i > 0 && (list[i - 1].proj - p.proj) > TIER_GAP(list[i - 1].proj) && tier < 9) tier++;
        p.tier = tier;
        const next = list[i + 1];
        p.cliff = !!next && (p.proj - next.proj) > TIER_GAP(p.proj);
      });
    });

    // ---- scarcity read-out per position ----
    // "startable" can't just mean above replacement -- replacement is defined
    // BY demand, so that ratio is always ~1. Count SOLID starters instead:
    // players worth a meaningful margin over the replacement guy (20 pts is
    // roughly 1.2 a week). Fewer solid players than open starter slots is
    // thin; none at all is flat (nothing at this position is worth paying up
    // for -- true of K and D/ST all night).
    const SOLID = 20;
    const scarcity = {};
    POSITIONS.forEach((pos) => {
      const solid = byPos[pos].filter((p) => p.vor >= SOLID).length;
      const d = starterDemand[pos];
      const label = solid <= 1 ? 'flat' : solid < d ? 'thin' : solid >= 2 * d ? 'deep' : 'even';
      scarcity[pos] = { demand: d, solid, repl: repl[pos], label };
    });

    // ---- my seat ----
    let me = null;
    const mine = ts.find((x) => x.t.name === myName);
    if (mine) {
      const { t, st } = mine;
      const openSlots = E.SLOTS.filter((sl) => !st.slots[sl.id]);
      const targets = openSlots.filter((sl) => sl.takes).map((sl) => ({
        slot: sl.label, id: sl.id,
        cands: avail.filter((p) => sl.takes.includes(p.pos) && E.canRoster(t, p.pos).ok)
          .sort((a, b) => b.vor - a.vor).slice(0, 3),
      }));
      me = { name: t.name, remaining: st.remaining, maxBid: st.maxBid, open: st.open,
             tax: st.tax, needs: openSlots.map((sl) => sl.label), targets,
             avgPerOpen: st.avgPerOpen, benchOpen: openSlots.filter((sl) => !sl.takes).length };
    }

    const recent = ((state && state.picks) || []).slice(-10).reverse();
    return {
      avail, byPos, repl, scarcity, me, recent,
      league: { moneyLeft, openSpots, spendable, inflation, teams: ts.length,
                picks: ((state && state.picks) || []).length },
      teams: ts.map(({ t, st }) => ({ name: t.name, remaining: st.remaining, maxBid: st.maxBid, open: st.open })),
    };
  }
  return { compute, POSITIONS };
})();
