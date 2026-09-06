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
    // preseason positional rank: where he stood among ALL players at his position
    // before keepers and picks came off the board (composite order over the whole
    // pool). Fixed for the night, so compute it once and stamp the pool.
    if (!pool.__preRanked) {
      POSITIONS.forEach((pos) => {
        pool.filter((p) => p.pos === pos)
          .sort((a, b) => ((a.cpos == null) - (b.cpos == null)) || (a.cpos - b.cpos) || (b.proj - a.proj))
          .forEach((p, i) => { p.preRank = i + 1; });
      });
      pool.__preRanked = true;
    }
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
    const HABIT = 0.25;                                             // history is a small factor; this year's value carries the split
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
    const SHAPE = 0.25;
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
    // clamped: with a handful of $1 spots left the ratio is noise
    const inflation = openSpots ? Math.min(1.8, Math.max(0.6, moneyLeft / mktValue)) : 1;

    // ---- what the room is paying by position TONIGHT ----
    // Realized price against ESPN value per position, shrunk toward the
    // room-wide ratio until a position has shown enough sales (six picks'
    // worth of prior), and clamped. Market prices bend to it: if RBs are
    // going 1.3x and WRs 0.9x, that's the room you're bidding in.
    const sold = { all: { paid: 0, aav: 0, n: 0 } };
    POSITIONS.forEach((p) => { sold[p] = { paid: 0, aav: 0, n: 0 }; });
    teams.forEach((t) => (t.players || []).forEach((p) => {
      if (p.keeper || !(p.aav > 0) || !sold[p.pos]) return;
      sold[p.pos].paid += +p.cost || 0; sold[p.pos].aav += p.aav; sold[p.pos].n++;
      sold.all.paid += +p.cost || 0; sold.all.aav += p.aav; sold.all.n++;
    }));
    const rAll = sold.all.aav ? sold.all.paid / sold.all.aav : 1;
    const PRIOR = 6;
    const tilt = {};
    POSITIONS.forEach((p) => {
      const s = sold[p];
      const rel = s.aav && rAll ? (s.paid / s.aav) / rAll : 1;
      tilt[p] = { x: Math.min(1.4, Math.max(0.7, (s.n * rel + PRIOR) / (s.n + PRIOR))), n: s.n, raw: rel };
    });
    avail.forEach((p) => {
      p.model = Math.max(1, Math.round(p.model));
      p.mkt = Math.max(1, Math.round(Math.max(1, p.aav) * inflation * (tilt[p.pos] ? tilt[p.pos].x : 1)));
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
      p.model = Math.min(p.model, roomMax);        // the K/D-ST override above can't exceed it either
      p.mkt = Math.min(p.mkt, roomMax);
      p.edge = p.model - p.mkt;
      // who can actually pay the market price AND legally roster him
      p.bidders = ts.filter(({ t, st }) =>
        st.open > 0 && st.maxBid >= p.mkt && E.canRoster(t, p.pos).ok).length;
    });

    // ---- who needs what, in THIS draft ----
    // For every position, every team's live need: open dedicated starter
    // slots for it (must have), an open FLEX it could fill (wants), bench room
    // only (might), or can't take one at all. Sorted by degree, then money.
    const posNeeds = {};
    POSITIONS.forEach((pos) => {
      posNeeds[pos] = ts.map(({ t, st }) => {
        const starters = E.SLOTS.filter((sl) => sl.takes && sl.id !== 'FLEX' && !st.slots[sl.id] && sl.takes.includes(pos)).length;
        const flex = (pos === 'K' || pos === 'D/ST') ? 0 : E.SLOTS.filter((sl) => sl.id === 'FLEX' && !st.slots[sl.id]).length;
        const bench = E.SLOTS.filter((sl) => !sl.takes && !st.slots[sl.id]).length;
        const have = (t.players || []).filter((p) => p.pos === pos).length;
        const can = st.open > 0 && E.canRoster(t, pos).ok;
        const degree = !can ? 0 : starters > 0 ? 3 : flex > 0 ? 2 : bench > 0 ? 1 : 0;
        return { name: t.name, ti: t.ti, starters, flex, bench, have, can, degree,
                 maxBid: st.maxBid, remaining: st.remaining, me: t.name === myName };
      }).sort((a, b) => b.degree - a.degree || b.maxBid - a.maxBid);
    });

    // ---- who's hunting whom ----
    // Each rival's likely targets: for every open starter slot, the three
    // best players they can legally roster at a price inside their max bid.
    // A player on several of those lists will be fought over; one on none
    // has a clear path.
    avail.forEach((p) => { p.contestBy = []; });
    ts.forEach(({ t, st }) => {
      if (t.name === myName || st.open <= 0) return;
      E.SLOTS.filter((sl) => sl.takes && !st.slots[sl.id]).forEach((sl) => {
        avail.filter((p) => sl.takes.includes(p.pos) && p.mkt <= st.maxBid && E.canRoster(t, p.pos).ok)
          .sort((a, b) => b.vor - a.vor).slice(0, 3)
          .forEach((p) => { if (!p.contestBy.includes(t.name)) p.contestBy.push(t.name); });
      });
    });
    avail.forEach((p) => { p.contest = p.contestBy.length; });

    // ---- who's nominating (if the board has an order) ----
    const order = (state && state.nomOrder) || [];
    let nominator = null, untilMe = null;
    if (order.length && teams.length) {
      const n = order.length, picksN = ((state && state.picks) || []).length;
      const idx = (((picksN + ((state && state.nomOffset) || 0)) % n) + n) % n;
      const team = teams.find((t) => t.ti === order[idx]) || teams[order[idx]];
      nominator = team ? team.name : null;
      const mineT = teams.find((t) => t.name === myName);
      const myTi = mineT ? (mineT.ti != null ? mineT.ti : teams.indexOf(mineT)) : -1;
      const at = order.indexOf(myTi);
      if (at >= 0) untilMe = (((at - idx) % n) + n) % n;
    }

    // ---- composite order within each position (the board's default) ----
    // byPos stays in projection order for the maths; compRank is the unique
    // 1..N position in the composite ranking (ESPN + every outside source),
    // unranked players after the ranked ones by projection.
    POSITIONS.forEach((pos) => {
      byPos[pos].slice().sort((a, b) => ((a.cpos == null) - (b.cpos == null)) || (a.cpos - b.cpos) || (b.proj - a.proj))
        .forEach((p, i) => { p.compRank = i + 1; });
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
      const rostered = (t.players || []).map((p) => {
        const ref = pool.find((x) => norm(x.name) === norm(p.name));
        return { pos: p.pos, name: p.name, bye: ref ? ref.bye : null };
      });
      const clash = (p) => rostered.find((r) => r.bye && r.bye === p.bye && r.pos === p.pos);
      // how flush this seat is: money per open spot against the room's
      const leagueAvg = openSpots ? moneyLeft / openSpots : 0;
      const richness = leagueAvg ? Math.min(1.5, Math.max(0.5, st.avgPerOpen / leagueAvg)) : 1;
      const starterOpen = openSlots.filter((sl) => sl.takes);
      const benchOpenN = openSlots.length - starterOpen.length;
      // ---- the plan: a lineup that fits the money ----
      // Start each open starter slot at its second-best remaining value (you
      // won't land everyone's first choice), one player per slot -- dedicated
      // slots claim first, FLEX takes what's left -- then, while the total is
      // over budget, step the priciest slot down to its next-cheaper candidate
      // until it fits. Bench is $2 a spot. The cushion left over is the only
      // money "your number" may spend above lineup value.
      const BENCH_EACH = 2;
      const planBudget = st.remaining - benchOpenN * BENCH_EACH;
      const planRows = starterOpen.slice().sort((a, b) => (a.id === 'FLEX') - (b.id === 'FLEX')).map((sl) => ({
        id: sl.id, slot: sl.label, idx: 1, pick: null,
        list: avail.filter((p) => sl.takes.includes(p.pos) && p.vor > 0 && E.canRoster(t, p.pos).ok)
          .sort((a, b) => b.model - a.model || b.proj - a.proj) }));
      const settle = () => planRows.forEach((r) => {
        const others = new Set(planRows.filter((o) => o !== r).map((o) => o.pick && o.pick.name).filter(Boolean));
        const free = r.list.filter((c) => !others.has(c.name));
        r.pick = free[Math.min(r.idx, free.length - 1)] || null;
      });
      settle();
      const planTotal = () => planRows.reduce((s, r) => s + (r.pick ? r.pick.model : 1), 0);
      let guard = 0;
      while (planTotal() > planBudget && guard++ < 80) {
        const cand = planRows.filter((r) => r.pick && r.idx + 1 < r.list.length).sort((a, b) => b.pick.model - a.pick.model)[0];
        if (!cand) break;
        cand.idx += 1; settle();
      }
      const planStarters = planTotal(), planBench = benchOpenN * BENCH_EACH;
      const plan = {
        rows: starterOpen.map((sl) => { const r = planRows.find((x) => x.id === sl.id);
          return { id: sl.id, slot: sl.label, target: r.pick ? r.pick.model : 1, who: r.pick ? r.pick.name : '—' }; }),
        bench: planBench, benchEach: BENCH_EACH, benchOpen: benchOpenN,
        total: planStarters + planBench, cushion: st.remaining - planStarters - planBench, fits: planStarters <= planBudget,
      };
      const cushion = Math.max(0, plan.cushion);
      const benchCap = Math.max(1, BENCH_EACH + Math.floor(cushion / Math.max(1, st.open)));
      // Your number. The path you'd take instead of buying him is the plan's
      // pick for that slot (or the next name down if he IS the plan). If he's
      // the upgrade, you should pay that player's price plus the step up --
      // and the step up is worth more to a seat with more money per open spot
      // than the room (a dollar is cheap for you) and less to a poorer seat,
      // which never pays above lineup value. If he's the cheaper option, he's
      // worth his lineup value and no more: someone as good is on the board at
      // that price. Small bumps for a thin position or the last man in a tier,
      // a small haircut for sharing a bye with a starter you already have at
      // the position; capped by your max bid, by what leaves the rest of your
      // starters fillable, and at $3 for K and D/ST.
      const perSpot = `($${Math.round(st.avgPerOpen)} vs $${Math.round(leagueAvg)} a spot)`;
      const seatNote = richness < 0.85 ? `seat is poorer than the room ${perSpot}`
        : richness < 0.97 ? `seat is a bit poorer than the room ${perSpot}`
        : richness > 1.03 ? `seat is flush ${perSpot}` : '';
      avail.forEach((p) => {
        const can = E.canRoster(t, p.pos);
        if (!can.ok) { p.payTo = 0; p.why = can.why || 'no room on your roster'; return; }
        const fits = starterOpen.filter((sl) => sl.takes.includes(p.pos));
        if (!fits.length) {
          p.payTo = Math.max(0, Math.min(p.model, benchCap, st.maxBid));
          p.why = `bench piece for you · bench money is ~$${benchCap} a spot`; return;
        }
        const sl = fits.find((x) => x.id !== 'FLEX') || fits[0];   // dedicated slot first, FLEX only if that's all that's open
        const pr = planRows.find((r) => r.id === sl.id);
        const others = new Set(planRows.filter((o) => o !== pr).map((o) => o.pick && o.pick.name).filter(Boolean));
        let alt = pr && pr.pick && pr.pick !== p ? pr.pick : null;
        if (!alt && pr) {
          const free = pr.list.filter((c) => c !== p && !others.has(c.name) && c.model <= st.maxBid);
          alt = free.find((c) => c.model <= p.model) || free[0] || null;
        }
        const bits = [`fills your ${sl.label}`];
        const upgrade = !alt || p.model >= alt.model;
        const gap = alt ? Math.round(p.vor - alt.vor) : 0;
        let num;
        if (upgrade) {
          num = alt ? alt.model + (p.model - alt.model) * richness : p.model;
          if (alt) bits.push(`upgrade on ${alt.name} ($${alt.model} in your plan, ${gap} pts back)`);
          const thin = scarcity[p.pos].label === 'thin';
          if (thin) { num += 0.05 * p.model * richness; bits.push(`${p.pos} is thin`); }
          if (p.cliff) { num += 0.05 * p.model * richness; bits.push('last of his tier'); }
          if (richness < 0.85) num = Math.min(num, p.model);
          if (seatNote) bits.push(seatNote + (richness < 0.85 ? ' — step-up discounted, never above lineup value' : richness < 1 ? ' — step-up discounted' : ' — the step-up is worth more to you'));
        } else {
          num = p.model;
          bits.push(`cheaper than your plan's ${alt.name} ($${alt.model}), ${Math.abs(gap)} pts worse — lineup value, no more`);
        }
        const cl = clash(p);
        if (cl) { num *= 0.96; bits.push(`shares bye ${p.bye} with ${cl.name}`); }
        let payTo = Math.round(Math.min(st.maxBid, num));   // max bid already keeps $1 for every other spot
        if (p.pos === 'K' || p.pos === 'D/ST') payTo = Math.min(payTo, 3);
        p.payTo = Math.max(st.maxBid >= 1 ? 1 : 0, payTo);
        if (p.payTo === st.maxBid && num > st.maxBid) bits.push('capped by your max bid');
        p.why = bits.join(' · ');
      });
      // "Best value for you", per open starter slot: legal for the slot, in
      // reach (the room's price is inside your max bid), ranked by YOUR edge --
      // your number minus what the room will likely pay -- among the
      // starter-caliber names (top 15 by talent) first. If fewer than three
      // are in reach the list is topped up by talent and those are marked as
      // a stretch. A bye shared with a starter you already have at the
      // position is flagged.
      const youEdge = (p) => p.payTo - p.mkt;
      const targets = starterOpen.map((sl) => {
        const talent = avail.filter((p) => sl.takes.includes(p.pos) && p.payTo > 0 && !(p.games != null && p.games <= 8))
          .sort((a, b) => b.vor - a.vor);
        const reach = (p) => p.mkt <= st.maxBid;
        const picks = talent.slice(0, 15).filter(reach)
          .sort((a, b) => (youEdge(b) - youEdge(a)) || (b.vor - a.vor)).slice(0, 3);
        const fill = (src) => src.filter((p) => !picks.includes(p)).slice(0, 3 - picks.length).forEach((p) => picks.push(p));
        if (picks.length < 3) fill(talent.filter(reach));
        if (picks.length < 3) fill(talent);
        return { slot: sl.label, id: sl.id,
                 cands: picks.map((p) => ({ ...p, youEdge: youEdge(p), stretch: !reach(p), byeClash: (clash(p) || {}).name || null })) };
      });
      // ---- nominate now: your targets with the clearest path ----
      // A target is best nominated when the fewest rivals are hunting him
      // (their open slots and money say so): fewest hunters first, then the
      // fewest who can pay at all, then the most edge for you. Only players
      // you'd actually pay the room's price for.
      const seen = new Set();
      const nominateNow = targets.flatMap((tg) => tg.cands)
        .filter((c) => !c.stretch && c.payTo >= c.mkt && c.pos !== 'K' && c.pos !== 'D/ST' && !seen.has(c.name) && seen.add(c.name))
        .map((c) => avail.find((x) => x.name === c.name) || c)
        .sort((a, b) => (a.contest - b.contest) || (a.bidders - b.bidders) || ((b.payTo - b.mkt) - (a.payTo - a.mkt)))
        .slice(0, 6);
      // ---- $1 fliers: bench upside once the money's gone ----
      const myRbs = (t.players || []).filter((p) => p.pos === 'RB' && p.nfl);
      const fliers = avail.filter((p) => p.mkt <= 2 && p.payTo >= 1 && p.pos !== 'K' && p.pos !== 'D/ST' && E.canRoster(t, p.pos).ok)
        .map((p) => {
          const cuffFor = p.pos === 'RB' ? myRbs.find((r) => r.nfl === p.nfl && norm(r.name) !== norm(p.name)) : null;
          const tags = [];
          if (cuffFor) tags.push(`handcuff · ${cuffFor.name}`);
          if (p.rookie) tags.push('rookie'); else if (p.soph) tags.push('2nd year');
          if (p.spread > 8) tags.push('rankers split');
          // a bench QB is worth little in a one-QB room that pays $1 for starters
          const upside = (p.proj * 0.2 + (cuffFor ? 30 : 0) + (p.rookie ? 20 : 0) + (p.soph ? 8 : 0) + (p.spread > 8 ? 5 : 0)) * (p.pos === 'QB' ? 0.5 : 1);
          return { ...p, cuff: !!cuffFor, tags, upside };
        })
        .sort((a, b) => b.upside - a.upside).slice(0, 8);
      me = { name: t.name, remaining: st.remaining, maxBid: st.maxBid, open: st.open, nominateNow, fliers,
             tax: st.tax, needs: openSlots.map((sl) => sl.label), targets,
             avgPerOpen: st.avgPerOpen, benchOpen: benchOpenN, plan, richness, leagueAvg };
    }

    const recent = ((state && state.picks) || []).slice(-10).reverse();
    return {
      avail, byPos, repl, scarcity, me, recent, target, auctionSpentAt, posNeeds,
      league: { moneyLeft, openSpots, spendable, inflation, tilt, nominator, untilMe, teams: ts.length,
                picks: ((state && state.picks) || []).length },
      teams: ts.map(({ t, st }) => ({ name: t.name, remaining: st.remaining, maxBid: st.maxBid, open: st.open,
        needs: E.SLOTS.filter((sl) => sl.takes && !st.slots[sl.id]).map((sl) => sl.label) })),
    };
  }
  return { compute, POSITIONS };
})();
