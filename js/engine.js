/* Sunday Funday — LIVE AUCTION DRAFT BOARD: engine
   Roster slotting + budget math per Manifesto v5.1.
     roster: QB1, RB2, WR2, TE1, FLEX(RB/WR/TE)1, K1, DEF1, Bench6 = 15
     each team: purse (from the keeper site, trade-adjusted); keepers pre-loaded
     max bid = remaining - $1 * (open spots - 1)   [must leave $1 for each other spot]
*/
window.DraftEngine = (function () {
  const ROSTER_SIZE = 15;
  const KEEPER_CAP = 100;   // keeper budget; $2 luxury tax per $1 over
  const SLOTS = [
    { id: 'QB', label: 'QB', takes: ['QB'] },
    { id: 'RB1', label: 'RB', takes: ['RB'] },
    { id: 'RB2', label: 'RB', takes: ['RB'] },
    { id: 'WR1', label: 'WR', takes: ['WR'] },
    { id: 'WR2', label: 'WR', takes: ['WR'] },
    { id: 'TE', label: 'TE', takes: ['TE'] },
    { id: 'FLEX', label: 'FLEX', takes: ['RB', 'WR', 'TE'] },
    { id: 'K', label: 'K', takes: ['K'] },
    { id: 'DEF', label: 'D/ST', takes: ['D/ST'] },
    { id: 'B1', label: 'BE', takes: null }, { id: 'B2', label: 'BE', takes: null },
    { id: 'B3', label: 'BE', takes: null }, { id: 'B4', label: 'BE', takes: null },
    { id: 'B5', label: 'BE', takes: null }, { id: 'B6', label: 'BE', takes: null },
  ];

  /* Rank-aware slotting, recomputed from scratch on every roster change so the
     board always reflects the CURRENT best lineup (never acquisition order):

       - Each positional slot goes to that position's best available player, so
         a newly drafted stud takes RB1 and bumps the incumbent to RB2.
       - FLEX then takes the best remaining RB/WR/TE overall — so a strong WR3
         beats a weak RB3 for the spot, and a later, better pick takes it over.
       - Whatever's left falls to the bench, best players first.

     Lower `rank` = better (ESPN PPR overall rank); AAV breaks ties, then a
     stable name sort so the display never jitters between equal players. */
  const FLEX_POS = ['RB', 'WR', 'TE'];

  function betterFirst(a, b) {
    return (rankOf(a) - rankOf(b)) || ((b.aav || 0) - (a.aav || 0))
      || String(a.name).localeCompare(String(b.name));
  }
  function rankOf(p) {
    if (p.rank != null) return p.rank;
    const ref = (window.DRAFT_PLAYERS || {}).byName;
    const hit = ref && ref[normName(p.name)];
    return hit ? hit.rank : 9999;
  }
  function normName(s) {
    return String(s).toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
  }

  function assignSlots(players) {
    const slots = {};
    SLOTS.forEach((s) => { slots[s.id] = null; });
    // work on a rank-sorted copy: best players get first claim on every slot
    const left = players.slice().sort(betterFirst);
    const take = (slotId, ok) => {
      const i = left.findIndex(ok);
      if (i >= 0) slots[slotId] = left.splice(i, 1)[0];
    };
    const isPos = (pos) => (p) => p.pos === pos;

    // dedicated starters, each taking the best available at that position
    take('QB', isPos('QB'));
    take('RB1', isPos('RB'));
    take('RB2', isPos('RB'));
    take('WR1', isPos('WR'));
    take('WR2', isPos('WR'));
    take('TE', isPos('TE'));
    take('K', isPos('K'));
    take('DEF', isPos('D/ST'));
    // FLEX: best remaining RB/WR/TE regardless of position
    take('FLEX', (p) => FLEX_POS.includes(p.pos));
    // bench, best first
    ['B1', 'B2', 'B3', 'B4', 'B5', 'B6'].forEach((b) => {
      if (left.length) slots[b] = left.shift();
    });
    return { slots, overflow: left };   // overflow = beyond 15 (shouldn't happen)
  }

  /* ---------------------------- LEAGUE ROSTER RULES ----------------------
     Per the league settings: every team must end the draft with a full
     starting lineup, and may not exceed the per-position maximums. Both are
     enforced when a pick is entered — the board never hints at them. */
  const POS_MAX = { QB: 4, RB: 8, WR: 8, TE: 4, 'D/ST': 3, K: 3 };
  const REQUIRED = ['QB', 'RB1', 'RB2', 'WR1', 'WR2', 'TE', 'FLEX', 'K', 'DEF'];

  // minimum number of further players needed to complete the starting lineup
  function unfilledStarters(players) {
    const { slots } = assignSlots(players);
    return REQUIRED.filter((id) => !slots[id]).length;
  }

  /* Can this team legally roster one more player at `pos`? */
  function canRoster(team, pos) {
    const players = (team.players || []);
    const open = ROSTER_SIZE - players.length;
    if (open <= 0) return { ok: false, why: 'roster is full' };
    if (!pos) return { ok: true };            // unknown position (free-typed)

    const max = POS_MAX[pos];
    if (max != null) {
      const have = players.filter((p) => p.pos === pos).length;
      if (have >= max) return { ok: false, why: `already has the max ${max} ${pos}` };
    }
    // would taking him leave too few spots to finish the starting lineup?
    const after = players.concat([{ name: '__probe__', pos, cost: 0, rank: 9999 }]);
    const stillNeeded = unfilledStarters(after);
    if (stillNeeded > open - 1) {
      return { ok: false, why: 'needs the remaining spots for starters' };
    }
    return { ok: true };
  }

  /* Which starting slots are still empty — what a team actually needs.
     Bench spots aren't "needs"; they're depth. */
  function needsOf(slots) {
    const out = [];
    ['QB', 'RB1', 'RB2', 'WR1', 'WR2', 'TE', 'FLEX', 'K', 'DEF'].forEach((id) => {
      if (slots[id]) return;
      const label = { RB1: 'RB', RB2: 'RB', WR1: 'WR', WR2: 'WR', DEF: 'D/ST' }[id] || id;
      if (!out.includes(label)) out.push(label);
    });
    return out;
  }

  function teamState(team) {
    const players = team.players || [];
    // Manifesto: keepers come out of a $100 budget, and every $1 over it costs
    // $2 of luxury tax. Both the keeper prices and the tax come off the purse,
    // so a team $3 over doesn't just lose the $3 -- it loses $9.
    const keeperSpend = players.filter((p) => p.keeper)
      .reduce((s, p) => s + (+p.cost || 0), 0);
    const tax = Math.max(0, keeperSpend - KEEPER_CAP) * 2;
    const spent = players.reduce((s, p) => s + (+p.cost || 0), 0) + tax;
    const remaining = (team.purse || 0) - spent;
    const filled = players.length;
    const open = Math.max(0, ROSTER_SIZE - filled);
    // must reserve $1 for every OTHER open spot
    const maxBid = open > 0 ? Math.max(0, remaining - (open - 1)) : 0;
    const drafted = players.filter((p) => !p.keeper);
    const draftSpend = drafted.reduce((s, p) => s + (+p.cost || 0), 0);
    const assigned = assignSlots(players);
    return {
      spent, remaining, keeperSpend, tax, filled, open, maxBid,
      needs: needsOf(assigned.slots),
      avgPerPick: drafted.length ? draftSpend / drafted.length : 0,
      avgPerOpen: open > 0 ? remaining / open : 0,
      ...assigned,
    };
  }

  return { ROSTER_SIZE, SLOTS, POS_MAX, assignSlots, teamState, canRoster,
    unfilledStarters, rankOf, normName, betterFirst };
})();
