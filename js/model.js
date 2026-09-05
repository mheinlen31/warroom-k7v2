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
    // Money is allocated BY POSITION the way this league actually spends it,
    // then by value within the position. Nine years of auctions say the room
    // puts ~52% of its dollars on RBs, ~35% on WRs, 5-6% each on QB and TE,
    // and about 1% each on K and D/ST -- a pure points-over-replacement
    // split would hand kickers $14 because their point spreads are real, and
    // this room simply does not pay for them. Each position's target for the
    // REST of the draft is its historical share of the whole auction pot
    // minus what has already been spent there tonight.
    const spendable = Math.max(0, moneyLeft - openSpots);          // $1 floor per open spot
    const T = window.GUIDE_TRENDS;
    const auctionSpentAt = {}; let auctionSpent = 0;
    POSITIONS.forEach((p) => auctionSpentAt[p] = 0);
    teams.forEach((t) => (t.players || []).forEach((p) => {
      if (p.keeper) return;
      auctionSpent += (+p.cost || 0);
      if (auctionSpentAt[p.pos] != null) auctionSpentAt[p.pos] += (+p.cost || 0);
    }));
    const pot = moneyLeft + auctionSpent;                           // the whole auction, start to finish
    // How much of the remaining money each position gets: half the league's
    // habit (its historical share of the pot, less what's already been spent
    // there tonight), half this year's value (the position's share of total
    // points-over-replacement still on the board). Habit alone over-funds a
    // position whose stars were all kept; value alone ignores how the room
    // actually behaves.
    const HABIT = 0.5;
    const target = {};
    let habitSum = 0; const habit = {};
    POSITIONS.forEach((p) => {
      habit[p] = T && T.share ? Math.max(0, T.share[p] * pot - auctionSpentAt[p]) : 0;
      habitSum += habit[p];
    });
    // K and D/ST are habit only: their point spreads are real but this room
    // has never paid for them, so value has nothing to say. Whatever they
    // don't take flows to the four positions the room actually bids on.
    const FLAT = ['K', 'D/ST'];
    let flatTake = 0;
    FLAT.forEach((p) => { target[p] = habitSum ? spendable * habit[p] / habitSum : 0; flatTake += target[p]; });
    const skill = POSITIONS.filter((p) => !FLAT.includes(p));
    const skillHabit = skill.reduce((s, p) => s + habit[p], 0) || 1;
    const skillVor = skill.reduce((s, p) => s + byPos[p].reduce((a, x) => a + x.vor, 0), 0) || 1;
    skill.forEach((p) => {
      const h = habit[p] / skillHabit;
      const v = byPos[p].reduce((a, x) => a + x.vor, 0) / skillVor;
      target[p] = (spendable - flatTake) * (habitSum ? HABIT * h + (1 - HABIT) * v : v);
    });

    // Within a position, the spend CURVE matters as much as the total: this
    // room pays one QB and shrugs at the rest, but spreads RB money across
    // several stars. Blend each position's historical price ladder (the shape
    // of what the Nth most expensive pick went for) with this year's VOR.
    const SHAPE = 0.5;
    POSITIONS.forEach((pos) => {
      const list = byPos[pos];
      const n = Math.max(1, Math.min(list.length, Math.round(qualityDemand[pos])));
      const sumVor = list.reduce((s, p) => s + p.vor, 0);
      const lad = (T && T.ladderFull && T.ladderFull[pos]) || [];
      const shapeRaw = list.map((_, i) => Math.max(1, i < lad.length ? lad[i] : (i < n ? 1 : 0)));
      const shapeSum = shapeRaw.slice(0, n).reduce((s, x) => s + x, 0) || 1;
      const above = Math.max(0, target[pos] - n);                  // $1 floors come off the top
      list.forEach((p, i) => {
        const vShare = sumVor ? p.vor / sumVor : 0;
        const sShare = i < n ? shapeRaw[i] / shapeSum : 0;
        const share = lad.length ? SHAPE * sShare + (1 - SHAPE) * vShare : vShare;
        p.model = 1 + above * share;
      });
    });
    // nobody can pay more than the biggest max bid in the room
    const roomMax = Math.max(1, ...ts.map((x) => x.st.maxBid));
    avail.forEach((p) => { p.model = Math.min(p.model, roomMax); });

    // inflation: the room's money against the ADP value of the players who'll actually be drafted
    const willDraft = avail.slice().sort((a, b) => a.rank - b.rank).slice(0, openSpots);
    const mktValue = willDraft.reduce((s, p) => s + Math.max(1, p.aav), 0) || 1;
    const inflation = openSpots ? moneyLeft / mktValue : 1;

    avail.forEach((p) => {
      p.model = Math.max(1, Math.round(p.model));
      p.mkt = Math.max(1, Math.round(Math.max(1, p.aav) * inflation));
    });
    // K and D/ST: 85% and 77% of this league's kickers and defenses have gone
    // for $1, seven of ~150 ever reached $3. The best one available is a $2
    // player; a genuine outlier (a big projection gap to #2) can be $3.
    ['K', 'D/ST'].forEach((pos) => {
      const list = byPos[pos];
      list.forEach((p, i) => {
        const gap = i === 0 && list[1] ? p.proj - list[1].proj : 0;
        p.model = i === 0 ? (gap >= 15 ? 3 : 2) : 1;
        p.mkt = Math.min(p.mkt, i === 0 ? 2 : 1);
      });
    });
    avail.forEach((p) => {
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
      // "Best value" is judged against THIS roster, not the league: legal for
      // the slot, inside this team's max bid, ranked by what it would save
      // against the room's likely price (edge), then by talent. If fewer than
      // three fit the money, the list is topped up by talent and those are
      // marked as a stretch. A bye shared with a starter already rostered at
      // the position is flagged too -- that's a real cost on draft night.
      const rostered = (t.players || []).map((p) => {
        const ref = pool.find((x) => norm(x.name) === norm(p.name));
        return { pos: p.pos, name: p.name, bye: ref ? ref.bye : null };
      });
      const clash = (p) => rostered.find((r) => r.bye && r.bye === p.bye && r.pos === p.pos);
      const targets = openSlots.filter((sl) => sl.takes).map((sl) => {
        const talent = avail.filter((p) => sl.takes.includes(p.pos) && E.canRoster(t, p.pos).ok)
          .sort((a, b) => b.vor - a.vor);
        const afford = (p) => p.model <= st.maxBid;
        // starter-caliber names first (top 15 by talent), best edge among those I can pay for
        const picks = talent.slice(0, 15).filter(afford)
          .sort((a, b) => (b.edge - a.edge) || (b.vor - a.vor)).slice(0, 3);
        const fill = (src) => src.filter((p) => !picks.includes(p)).slice(0, 3 - picks.length).forEach((p) => picks.push(p));
        if (picks.length < 3) fill(talent.filter(afford));   // money is tight: best I can actually pay for
        if (picks.length < 3) fill(talent);                   // still short: show the talent, marked over max
        return { slot: sl.label, id: sl.id,
                 cands: picks.map((p) => ({ ...p, stretch: p.model > st.maxBid, byeClash: (clash(p) || {}).name || null })) };
      });
      me = { name: t.name, remaining: st.remaining, maxBid: st.maxBid, open: st.open,
             tax: st.tax, needs: openSlots.map((sl) => sl.label), targets,
             avgPerOpen: st.avgPerOpen, benchOpen: openSlots.filter((sl) => !sl.takes).length };
    }

    const recent = ((state && state.picks) || []).slice(-10).reverse();
    return {
      avail, byPos, repl, scarcity, me, recent, target, auctionSpentAt,
      league: { moneyLeft, openSpots, spendable, inflation, teams: ts.length,
                picks: ((state && state.picks) || []).length },
      teams: ts.map(({ t, st }) => ({ name: t.name, remaining: st.remaining, maxBid: st.maxBid, open: st.open })),
    };
  }
  return { compute, POSITIONS };
})();
