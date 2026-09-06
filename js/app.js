/* War Room UI. Read-only. State comes from the board's live room; every
   render recomputes the model from scratch so nothing is ever stale. */
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const POOL = (window.GUIDE_PLAYERS || {}).players || [];
  const M = window.GuideModel;
  const TABS = ['ALL', 'QB', 'RB', 'WR', 'TE', 'K', 'D/ST', 'ROOKIES', '2ND YR', 'WATCH', 'DRAFTED'];
  const posClass = (p) => 'pos-' + String(p).replace('/', '');

  let me = localStorage.getItem('sfg-me') || 'Silent Pugios';
  let tab = localStorage.getItem('sfg-tab') || 'ALL';
  if (!TABS.includes(tab)) tab = 'ALL';
  let q = '';
  let dmode = localStorage.getItem('sfg-dmode') || 'order';   // drafted view: order | pos | team
  // compact list by default; a row opens on tap, or everything opens at once
  const expanded = new Set();                      // exceptions: open rows, or closed rows when expandAll is on
  let expandAll = localStorage.getItem('sfg-expand') === '1';
  const isOpen = (n) => expandAll ? !expanded.has(n) : expanded.has(n);
  const SORTS = ['rank', 'model', 'edge', 'you'];   // composite rank is the default view
  let sortMode = SORTS.includes(localStorage.getItem('sfg-sort2')) ? localStorage.getItem('sfg-sort2') : 'rank';
  let clock = null;                                            // who's on the clock, from the board
  let watch = new Set();                                       // your watch list (this device)
  try { watch = new Set(JSON.parse(localStorage.getItem('sfg-watch') || '[]')); } catch (e) {}
  const saveWatch = () => { try { localStorage.setItem('sfg-watch', JSON.stringify([...watch])); } catch (e) {} };
  const E = window.DraftEngine;
  let state = null;
  let R = null;   // last model result

  // ---- tabs ----
  const tabLabel = (t) => t === 'WATCH' ? `★ Watch${watch.size ? ` <b>${watch.size}</b>` : ''}` : t;
  $('tabs').innerHTML = TABS.map((t) =>
    `<button class="tab${t === tab ? ' on' : ''}" data-t="${t}">${tabLabel(t)}</button>`).join('');
  $('tabs').addEventListener('click', (e) => {
    const b = e.target.closest('.tab'); if (!b) return;
    tab = b.dataset.t; localStorage.setItem('sfg-tab', tab);
    [...$('tabs').children].forEach((x) => x.classList.toggle('on', x.dataset.t === tab));
    renderBoard();
  });
  $('q').addEventListener('input', () => { q = $('q').value.trim().toLowerCase(); renderBoard(); });
  $('expand-btn').addEventListener('click', () => {
    expandAll = !expandAll; expanded.clear();
    try { localStorage.setItem('sfg-expand', expandAll ? '1' : '0'); } catch (err) { /* private mode */ }
    renderBoard();
  });
  $('board').addEventListener('click', (e) => {
    if (e.target.closest('.star, a, button')) return;
    const tr = e.target.closest('tr.row'); if (!tr) return;
    const n = tr.dataset.n;
    expanded.has(n) ? expanded.delete(n) : expanded.add(n);
    const det = tr.nextElementSibling;
    const open = isOpen(n);
    if (det && det.classList.contains('det')) {
      if (open && !det.querySelector('.dhead')) { const p = R && R.avail.find((x) => x.name === n); if (p) det.querySelector('.det-in').innerHTML = detailHtml(p); }
      det.hidden = !open;
    }
    tr.classList.toggle('open', open);
  });
  $('sort-btn').addEventListener('click', () => {
    sortMode = SORTS[(SORTS.indexOf(sortMode) + 1) % SORTS.length];
    try { localStorage.setItem('sfg-sort2', sortMode); } catch (err) { /* private mode */ }
    renderBoard();
  });
  $('board').addEventListener('click', (e) => {
    const st = e.target.closest('.star');
    if (st) {
      const n = st.dataset.w;
      watch.has(n) ? watch.delete(n) : watch.add(n);
      saveWatch(); renderBoard(); renderClock(); return;
    }
    const b = e.target.closest('.dm'); if (!b) return;
    dmode = b.dataset.m; try { localStorage.setItem('sfg-dmode', dmode); } catch (err) { /* private mode */ }
    renderBoard();
  });
  $('me-select').addEventListener('change', () => {
    me = $('me-select').value; localStorage.setItem('sfg-me', me); render();
  });

  const money = (n) => '$' + Math.round(n);
  // what each source individually ranks this player: ESPN first, then the outside sources
  const srcChips = (p) => (p.espnPos ? `<span class="src espn" title="ESPN: ${esc(p.pos)}${p.espnPos}, overall #${p.rank}">ESPN ${esc(p.pos.replace('/', ''))}${p.espnPos}</span>` : '') + Object.entries(p.srcPos || {}).map(([l, r]) =>
    `<span class="src" title="${esc(l)}: ${esc(p.pos)}${r}${p.srcTier && p.srcTier[l] ? ` · tier ${p.srcTier[l]}` : ''}${p.srcProj && p.srcProj[l] ? ` · ${p.srcProj[l]} pts` : ''}">${esc(l)} ${esc(p.pos.replace('/', ''))}${r}${p.srcTier && p.srcTier[l] ? ` · T${p.srcTier[l]}` : ''}${p.srcProj && p.srcProj[l] ? ` · ${Math.round(p.srcProj[l])}` : ''}</span>`).join('');
  const edgeHtml = (e) => e > 0 ? `<span class="pos-edge">+$${e}</span>`
    : e < 0 ? `<span class="neg-edge">−$${Math.abs(e)}</span>` : '<span class="zero-edge">—</span>';
  /* last season, in the stats that score for the position; ESPN default PPR */
  function statLine(p) {
    const s = p.s25, fp = p.fp25;
    if (!s) return p.rookie ? '2025: rookie — no NFL season yet' : '2025: no stats';
    const n = (v) => (v == null ? 0 : v).toLocaleString();
    let core;
    switch (p.pos) {
      case 'QB': core = `${n(s.py)} pass yds · ${s.ptd} TD · ${s.int} INT · ${n(s.ry)} rush · ${s.rtd} rTD`; break;
      case 'RB': core = `${n(s.ry)} rush · ${s.rtd} TD · ${s.rec} rec · ${n(s.recy)} yds · ${s.rectd} TD`; break;
      case 'WR': core = `${s.rec}/${s.tgt} rec · ${n(s.recy)} yds · ${s.rectd} TD${s.ry > 40 ? ` · ${n(s.ry)} rush` : ''}`; break;
      case 'TE': core = `${s.rec}/${s.tgt} rec · ${n(s.recy)} yds · ${s.rectd} TD`; break;
      case 'K': core = `${s.fgm}/${s.fga} FG · ${s.xpm} XP`; break;
      default:   core = `${s.sack} sacks · ${s.int} INT · ${s.fr} FR · ${s.td} TD · ${n(s.pa)} pts allowed`;
    }
    return `2025: ${core} · <b>${fp} pts</b>${p.gp25 ? ` in ${p.gp25}` : ''}`;
  }
  const yearTag = (p) => p.rookie ? '<span class="yr r">R</span>' : p.soph ? '<span class="yr">2Y</span>' : '';
  const byeTag = (p) => p.bye ? `<span class="bye">bye ${p.bye}</span>` : '';
  const INJ_LABEL = { Q: 'Q', D: 'Dbt', OUT: 'Out', IR: 'IR', SUSP: 'Susp', PUP: 'PUP', DAY_TO_DAY: 'DTD', QUESTIONABLE: 'Q' };
  const injHtml = (p) => !p.inj ? '' : `<span class="inj${p.inj === 'Q' || p.inj === 'QUESTIONABLE' || p.inj === 'DAY_TO_DAY' ? ' q' : ''}">${esc(INJ_LABEL[p.inj] || (p.inj[0] + p.inj.slice(1, 3).toLowerCase()))}</span>`
    + (p.games != null && p.games < 17 ? `<span class="inj games" title="projection scaled to ${p.games} games">~${p.games} gm</span>` : '');
  /* The dossier behind a collapsed row: everything we know about him, in
     labelled lines. Built on demand from the pool, the model, the league's
     draft history, tonight's room and your own roster. */
  const SUFFIX_RE = /\s+(jr|sr|ii|iii|iv|v)$/;
  const histKey = (name) => E.normName(name).replace(SUFFIX_RE, '');
  const poolByName = (() => { const m = {}; (window.GUIDE_PLAYERS.players || []).forEach((p) => { m[E.normName(p.name)] = p; }); return m; })();
  function detailHtml(p) {
    const L = [];
    const line = (label, html) => { if (html) L.push(`<div class="dl"><b>${label}</b><span>${html}</span></div>`); };
    const myT = (state && state.teams || []).find((t) => t.name === me);
    const rosteredBy = {}; (state && state.teams || []).forEach((t) => (t.players || []).forEach((x) => { rosteredBy[E.normName(x.name)] = t.name; }));
    // value
    const repl = R.repl && R.repl[p.pos];
    line('Value', [`proj <b>${p.proj ? p.proj.toFixed(0) : '—'}</b>${p.projFull ? ` (${p.projFull.toFixed(0)} full season, ~${p.games} games)` : ''}`,
      p.vor > 0 && repl != null ? `+${p.vor.toFixed(0)} over the ${esc(p.pos)} you'd get for $1 (${Math.round(repl)})` : null,
      p.tier ? `tier ${p.tier}${p.cliff ? ' · cliff after him' : ''}` : null].filter(Boolean).join(' · '));
    // rankings
    const cons = p.cons ? `composite ${esc(p.pos)}${p.compRank} · rank ${p.cons}${p.spread > 8 ? ` ±${p.spread}` : ''} · ${p.nsrc} src` : '';
    line('Rankings', `${cons}${srcChips(p) ? ' ' + srcChips(p) : ''}${p.adp ? ` · ESPN ADP ${p.adp}` : ''}${p.aav ? ` · AAV $${p.aav}` : ''}${p.nrank > 1 && p.consEspn ? ` · ${p.nrank} ESPN rankers avg ${p.consEspn}` : ''}`);
    // last season
    const sl = statLine(p);
    line('2025', sl ? `${sl}${p.fp25 && p.gp25 ? ` · <b>${(p.fp25 / p.gp25).toFixed(1)}</b>/g` : ''}` : '');
    // this league's history
    const h = (T && T.history && T.history[histKey(p.name)]) || [];
    line('Paid here', h.length ? h.slice(0, 6).map((r) => `<b>${r.y}</b> $${r.p} ${esc(r.o || '')}${r.k ? ' <i class="kp">keeper</i>' : ''}${r.pts != null ? ` → ${r.pts} pts${r.rk ? `, ${esc(p.pos)}${r.rk}` : ''}` : ''}`).join(' · ') : (p.yrs > 1 ? 'never rostered in this league' : ''));
    // tonight's room
    const needs = (R.posNeeds && R.posNeeds[p.pos]) || [];
    const must = needs.filter((n) => n.degree === 3 && n.name !== me), flex = needs.filter((n) => n.degree === 2 && n.name !== me);
    const hunters = (p.contestBy || []).map((nm) => { const n = needs.find((x) => x.name === nm); return `${esc(nm)}${n ? ` <i>${esc(needLabel(n, p.pos))}</i>` : ''}`; });
    line('Tonight', `room <b>$${p.mkt}</b> · ${p.bidders} can pay${hunters.length ? ` · hunted by ${hunters.join(', ')}` : ' · nobody hunting him'}${must.length ? ` · ${must.length} still need a ${esc(p.pos)} starter (${must.map((n) => esc(n.name) + (n.starters > 1 ? ' ×' + n.starters : '')).join(', ')})` : ''}${flex.length ? ` · ${flex.length} FLEX open` : ''}`);
    // teammates at his position (depth-chart proxy)
    if (p.pos === 'RB' || p.pos === 'WR' || p.pos === 'TE') {
      const mates = (window.GUIDE_PLAYERS.players || []).filter((x) => x.nfl === p.nfl && x.pos === p.pos && x.name !== p.name && x.proj > 20)
        .sort((a, b) => b.proj - a.proj).slice(0, 3);
      line(`${esc(p.nfl || '')} ${esc(p.pos)}s`, mates.map((x) => `${esc(x.name)} ${x.proj.toFixed(0)}${rosteredBy[E.normName(x.name)] ? ` <i>${esc(rosteredBy[E.normName(x.name)])}</i>` : ''}`).join(' · '));
    }
    // you
    let clash = '';
    if (myT && p.bye) { const c = (myT.players || []).find((x) => x.pos === p.pos && (poolByName[E.normName(x.name)] || {}).bye === p.bye); if (c) clash = ` · <i class="warn">bye ${p.bye} clashes with your ${esc(c.name)}</i>`; }
    line('You', p.payTo != null ? `pay up to <b>$${p.payTo}</b>${p.why ? ` · ${esc(p.why)}` : ''}${clash}` : '');
    // news + outlook
    const nh = newsHtml(p); if (nh) L.push(nh);
    line('Outlook', p.outlook ? esc(p.outlook) : '');
    const head = `<div class="dhead">${p.img ? `<img class="mug" src="${esc(p.img)}" alt="" loading="lazy" onerror="this.remove()">` : ''}<div><div class="dname">${esc(p.name)}${injHtml(p)}</div><div class="dsub">${esc(p.pos)} · ${esc(p.nfl || '')}${p.bye ? ` · bye ${p.bye}` : ''}${p.rookie ? ' · rookie' : p.soph ? ' · 2nd year' : p.yrs ? ` · year ${p.yrs}` : ''}</div></div></div>`;
    return head + L.join('');
  }

  // list view: a cross when there's an injury concern (red: out / IR / suspended /
  // doubtful / missed games; amber: questionable or day-to-day)
  const injFlag = (p) => {
    const games = p.games != null && p.games < 17;
    const bad = games || /^(OUT|IR|SUSP|PUP|D)$/.test(p.inj || '');
    const q = /^(Q|DTD)$/.test(p.inj || '');
    if (!bad && !q) return '';
    const label = [INJ_LABEL[p.inj] || p.inj, games ? `~${p.games} games` : '', p.news && p.news.type ? p.news.type : ''].filter(Boolean).join(' · ');
    return `<i class="cross ${bad ? 'bad' : 'q'}" title="${esc(label)}">✚${games ? `<small>${p.games}</small>` : ''}</i>`;
  };
  // the latest word on a player: the report's status + blurb (always when he's
  // not Active, otherwise only when it's fresh), plus any note of ours
  const FRESH_MS = 3 * 86400000;
  const newsHtml = (p) => {
    const n = p.news; const bits = [];
    if (p.newsNote) bits.push(`<b>${esc(p.newsNote)}</b>`);
    if (n && (n.status !== 'Active' || (Date.now() - new Date(n.date).getTime()) < FRESH_MS)) {
      bits.push(`${n.status !== 'Active' ? `<b class="${/Out|Reserve|Susp|PUP/.test(n.status) ? 'bad' : 'warn'}">${esc(n.status)}${n.type ? ' · ' + esc(n.type) : ''}${n.return ? ' · back ' + esc(n.return.slice(5).replace('-', '/')) : ''}</b> · ` : ''}${esc(n.note)}${n.date ? ` <small>${esc(n.date.slice(5).replace('-', '/'))}</small>` : ''}`);
    }
    return bits.length ? `<div class="news">${bits.join('<br>')}</div>` : '';
  };

  function renderCockpit() {
    if (!R) return;
    const L = R.league, me_ = R.me;
    // what the room has actually paid against ESPN so far, and any run on a position
    const picks = (state && state.picks) || [];
    const withAav = picks.filter((p) => p.aav > 0);
    const paid = { n: withAav.length, ratio: withAav.length ? withAav.reduce((s, p) => s + p.cost, 0) / withAav.reduce((s, p) => s + Math.max(1, p.aav), 0) : 1 };
    const last5 = picks.slice(-5).map((p) => p.pos);
    let run = null;
    if (last5.length >= 3) { const c = {}; last5.forEach((p) => { c[p] = (c[p] || 0) + 1; }); const top = Object.entries(c).sort((a, b) => b[1] - a[1])[0]; if (top && top[1] >= 3) run = { pos: top[0], n: top[1] }; }
    const seat = me_ ? `
      <div class="card">
        <h4>${esc(me_.name)}</h4>
        <div class="stats">
          <div class="stat big${me_.remaining <= 5 ? ' red' : ''}"><b>${money(me_.remaining)}</b><span>left</span></div>
          <div class="stat"><b>${money(me_.maxBid)}</b><span>max bid</span></div>
          <div class="stat"><b>${me_.open}</b><span>spots</span></div>
          <div class="stat"><b>${money(me_.avgPerOpen)}</b><span>avg/spot</span></div>
          ${me_.tax ? `<div class="stat red"><b>−${money(me_.tax)}</b><span>tax</span></div>` : ''}
        </div>
        <div class="chips">${me_.needs.length ? me_.needs.map((n) =>
          `<span class="chip ${posClass(n === 'FLEX' || n === 'BE' ? 'X' : n)}">${esc(n)}</span>`).join('')
          : '<span class="chip">roster full</span>'}</div>
      </div>` : `<div class="card"><h4>Your seat</h4><div class="empty">pick your team above</div></div>`;
    const league = `
      <div class="card">
        <h4>The room</h4>
        <div class="stats">
          <div class="stat big"><b>${money(L.moneyLeft)}</b><span>in play</span></div>
          <div class="stat"><b>${L.openSpots}</b><span>open spots</span></div>
          <div class="stat"><b>${L.inflation.toFixed(2)}×</b><span>inflation</span></div>
          <div class="stat"><b>${L.picks}</b><span>picks</span></div>
          ${paid.n >= 5 ? `<div class="stat"><b>${paid.ratio.toFixed(2)}×</b><span>paying vs ESPN</span></div>` : ''}
        </div>
        ${run ? `<div class="fact run"><b>${esc(run.pos)} run</b> — ${run.n} of the last 5 picks</div>` : ''}
        ${L.nominator ? `<div class="fact nom"><b>${esc(L.nominator)}</b> nominates${L.untilMe === 0 ? " — that's you" : L.untilMe != null ? ` · you're up in ${L.untilMe}` : ''}</div>` : ''}
      </div>`;
    const scar = `
      <div class="card">
        <h4>Scarcity · solid starters left / open starter slots</h4>
        <div class="scar">${M.POSITIONS.map((pos) => { const s = R.scarcity[pos]; return `
          <div class="sc ${s.label}">
            <div class="p ${posClass(pos)}">${pos}</div>
            <div class="n">${s.solid}<small> / ${Math.round(s.demand)}</small></div>
            <div class="l">${s.label}</div>
            ${L.tilt && L.tilt[pos] && L.tilt[pos].n >= 3 && Math.abs(L.tilt[pos].x - 1) >= 0.08 ? `<div class="t ${L.tilt[pos].x > 1 ? 'hot' : 'cold'}">paying ${L.tilt[pos].x.toFixed(2)}×</div>` : ''}
          </div>`; }).join('')}</div>
      </div>`;
    $('cockpit').innerHTML = league + scar;
  }

  /* One line of the numbers you need while a player is up: your money, your
     open spots, who's nominating. Sits right above the rankings. */
  function renderSeat() {
    const box = $('seat');
    if (!R || !R.me) { box.innerHTML = ''; return; }
    const m = R.me, L = R.league;
    box.innerHTML = `<div class="seat-in">
      <span class="seat-name">${esc(m.name)}</span>
      <span class="seat-n big${m.remaining <= 5 ? ' red' : ''}"><b>${money(m.remaining)}</b><small>left</small></span>
      <span class="seat-n"><b>${money(m.maxBid)}</b><small>max bid</small></span>
      <span class="seat-n"><b>${m.open}</b><small>spots</small></span>
      <span class="seat-n"><b>${money(m.avgPerOpen)}</b><small>avg/spot</small></span>
      ${m.tax ? `<span class="seat-n red"><b>−${money(m.tax)}</b><small>tax</small></span>` : ''}
      <span class="seat-needs">${m.needs.length ? m.needs.map((n) => `<i class="chip ${posClass(n === 'FLEX' || n === 'BE' ? 'X' : n)}">${esc(n)}</i>`).join('') : '<i class="chip">roster full</i>'}</span>
      ${L.nominator ? `<span class="seat-nom"><b>${esc(L.nominator)}</b> nominates${L.untilMe === 0 ? " — you're up" : L.untilMe != null ? ` · you in ${L.untilMe}` : ''}</span>` : ''}
    </div>`;
  }

  /* who needs this position tonight, and how badly */
  const needLabel = (n, pos) => n.degree === 3 ? `needs ${n.starters > 1 ? n.starters + ' ' : ''}${pos}` : n.degree === 2 ? 'FLEX open' : n.degree === 1 ? 'bench only' : n.can ? 'full' : "can't";
  const needTag = (n, pos) => `<i class="need need${n.degree}">${esc(needLabel(n, pos))}</i>`;
  function needsLine(pos) {
    if (!R || !R.posNeeds || !R.posNeeds[pos]) return '';
    const L = R.posNeeds[pos];
    const must = L.filter((n) => n.degree === 3), flex = L.filter((n) => n.degree === 2), bench = L.filter((n) => n.degree === 1), cant = L.filter((n) => n.degree === 0);
    const nm = (n) => `${esc(n.name)}${n.starters > 1 ? ` ×${n.starters}` : ''} <small>$${n.maxBid}</small>`;
    return `<div class="hint needs"><b>Still need ${esc(pos)}:</b> ${must.length ? must.map(nm).join(' · ') : 'nobody'}
      ${flex.length ? `<span class="dim">· FLEX open: ${flex.map((n) => esc(n.name)).join(', ')}</span>` : ''}
      ${bench.length ? `<span class="dim">· bench only: ${bench.length}</span>` : ''}
      ${cant.length ? `<span class="dim">· can't: ${cant.map((n) => esc(n.name)).join(', ')}</span>` : ''}</div>`;
  }

  /* Second row of the cockpit: the plan, the drain list, your roster.
     - PLAN: what to budget for each open starter slot so the money lasts.
       Uses the second-best value at each slot (you won't land everyone's
       first choice) and $2 a bench spot -- this league's bench reality.
     - DRAIN: players the room is likely to overpay for that aren't on your
       shopping list. Nominate them early and let other budgets bleed.
     - ROSTER: your lineup taking shape, slot by slot. */
  function renderPlan() {
    const box = $('cockpit2');
    if (!R || !R.me || !state) { box.innerHTML = ''; return; }
    const me_ = R.me;
    const meT = (state.teams || []).find((t) => t.name === me);
    const st = meT ? E.teamState(meT) : null;

    // ---- plan (computed in the model, shared with "your number") ----
    const pl = me_.plan;
    const BENCH_EACH = pl.benchEach, rows = pl.rows, bench = pl.bench, total = pl.total, diff = pl.cushion, fits = pl.fits;
    const plan = `<div class="card">
      <h4>Your plan · $${me_.remaining} to spend</h4>
      <table class="plan">${rows.map((r) => `<tr><td class="ps ${posClass(r.slot)}">${esc(r.slot)}</td><td class="pw">${esc(r.who)}</td><td class="pt">$${r.target}</td></tr>`).join('')}
        ${me_.benchOpen ? `<tr><td class="ps">BE ×${me_.benchOpen}</td><td class="pw muted">bench at ~$${BENCH_EACH}</td><td class="pt">$${bench}</td></tr>` : ''}
        <tr class="tot"><td></td><td>planned</td><td class="pt">$${total}</td></tr>
        <tr class="tot ${diff >= 0 ? 'ok' : 'bad'}"><td></td><td>${diff >= 0 ? 'cushion' : 'over by'}</td><td class="pt">$${Math.abs(diff)}</td></tr>
      </table>
      <div class="fact">${fits ? `Fits with $${diff} to spare — that's your room to chase one target.` : `Even the cheapest sensible plan is $${-diff} over: you'll be leaning on $1 bench fliers.`}</div>
    </div>`;

    // ---- drain ----
    // the room will pay well past YOUR number: nominate them and let other people spend
    const wanted = new Set(me_.targets.flatMap((t) => t.cands.map((c) => c.name)));
    const yours = (p) => p.payTo == null ? p.model : p.payTo;
    const gapOf = (p) => p.mkt - yours(p);
    const drain = R.avail.filter((p) => p.mkt >= 10 && !wanted.has(p.name) && gapOf(p) >= 4 && p.bidders >= 2)
      .sort((a, b) => gapOf(b) - gapOf(a)).slice(0, 6);
    const drainCard = `<div class="card">
      <h4>Nominate to drain · the room pays more than you would</h4>
      ${drain.length ? drain.map((p) => `<div class="dr"><span class="nm">${esc(p.name)}</span><span class="pos ${posClass(p.pos)}">${esc(p.pos)}</span>
        <span class="drv">room ~<b>$${p.mkt}</b> · you ${yours(p) ? '$' + yours(p) : '—'} · ${p.bidders} can pay</span></div>`).join('')
        : '<div class="fact">Nothing left worth draining.</div>'}
    </div>`;

    // ---- nominate now ----
    const nn = me_.nominateNow || [];
    const nomCard = `<div class="card">
      <h4>Nominate now · your targets with the clearest path</h4>
      ${nn.length ? nn.map((p) => `<div class="dr"><span class="nm">${esc(p.name)}</span><span class="pos ${posClass(p.pos)}">${esc(p.pos)}</span>
        <span class="drv">${p.contest ? `<b class="warn">${p.contest}</b> hunting${p.contestBy.length ? ` (${p.contestBy.slice(0, 2).map((nm) => { const n = (R.posNeeds[p.pos] || []).find((x) => x.name === nm); return esc(nm) + (n ? ` <i>${esc(needLabel(n, p.pos))}</i>` : ''); }).join(', ')}${p.contestBy.length > 2 ? ` +${p.contestBy.length - 2}` : ''})` : ''}` : '<b class="ok">clear path</b>'} · you $${p.payTo} · room $${p.mkt}</span></div>`).join('')
        : '<div class="fact">Nothing on your list has a clear path yet — drain instead.</div>'}
    </div>`;
    // ---- $1 fliers ----
    const fl = me_.fliers || [];
    const flierCard = me_.benchOpen ? `<div class="card">
      <h4>$1 fliers · bench upside when the money's gone</h4>
      ${fl.length ? fl.map((p) => `<div class="dr"><span class="nm">${esc(p.name)}</span><span class="pos ${posClass(p.pos)}">${esc(p.pos)}</span>
        <span class="drv">${p.tags.length ? `<b class="${p.cuff ? 'ok' : 'soft'}">${esc(p.tags.join(' · '))}</b> · ` : ''}proj ${p.proj.toFixed(0)}</span></div>`).join('')
        : '<div class="fact">No $1 upside left.</div>'}
    </div>` : '';
    // ---- roster ----
    const slotsHtml = st ? E.SLOTS.map((sl) => { const p = st.slots[sl.id];
      return `<div class="rs${p ? '' : ' open'}"><span class="ps ${p ? posClass(p.pos) : ''}">${esc(sl.label)}</span><span class="rn">${p ? esc(p.name) : '—'}</span><span class="rc">${p ? '$' + p.cost : ''}</span></div>`; }).join('') : '';
    const roster = `<div class="card">
      <h4>Your roster · ${st ? st.filled : 0}/15${st && st.tax ? ` · tax $${st.tax}` : ''}</h4>
      <div class="rgrid">${slotsHtml}</div>
    </div>`;
    // ---- room budgets: who's flush, who's spent ----
    const budgets = `<div class="card">
      <h4>Room budgets · richest first · open starters</h4>
      <table class="rb">${R.teams.slice().sort((a, b) => b.remaining - a.remaining).map((t) => `
        <tr class="${t.name === me ? 'me' : ''}"><td class="tn">${esc(t.name)}<div class="tneeds">${(t.needs || []).length ? t.needs.map((n) => `<i class="${posClass(n)}">${esc(n)}</i>`).join('') : '<i class="done">starters set</i>'}</div></td><td class="tl">$${t.remaining}</td><td class="tm">max $${t.maxBid}</td><td class="to">${t.open} open</td></tr>`).join('')}</table>
    </div>`;
    // ---- room rosters: who has what, at a glance ----
    // one row per team, a count per position; amber = still short of a
    // starter there (they'll be bidding), dim = at the position max (they can't)
    const NEED = { QB: 1, RB: 2, WR: 2, TE: 1, K: 1, 'D/ST': 1 };
    const POSL = ['QB', 'RB', 'WR', 'TE', 'K', 'D/ST'];
    const rr = (state.teams || []).map((t) => {
      const c = {}; POSL.forEach((p) => { c[p] = 0; });
      (t.players || []).forEach((p) => { if (c[p.pos] != null) c[p.pos]++; });
      const s = E.teamState(t);
      return { name: t.name, c, filled: s.filled, open: s.open };
    });
    const rostersCard = `<div class="card wide2">
      <h4>Room rosters · who has what</h4>
      <table class="rr"><thead><tr><th class="l">team</th>${POSL.map((p) => `<th class="${posClass(p)}">${esc(p.replace('/', ''))}</th>`).join('')}<th>filled</th></tr></thead>
      <tbody>${rr.map((r) => `<tr class="${r.name === me ? 'me' : ''}"><td class="tn">${esc(r.name)}</td>${POSL.map((p) => {
          const n = r.c[p], need = NEED[p], max = (E.POS_MAX || {})[p] || 99;
          const cls = n < need ? 'need' : n >= max ? 'full' : '';
          const tip = `${n} ${p}${n < need ? ` · needs ${need - n} more starter${need - n > 1 ? 's' : ''}` : n >= max ? ' · at the max' : ''}`;
          return `<td class="${cls}" title="${esc(tip)}">${n}</td>`; }).join('')}<td class="sp">${r.filled}<small>/15</small></td></tr>`).join('')}</tbody></table>
      <div class="fact rr-key"><i class="need">n</i> short of a starter there · <i class="full">n</i> at the position max</div>
    </div>`;
    // ---- news watch: anyone that matters who isn't simply Active ----
    const watchList = R.avail.filter((p) => (p.news && p.news.status !== 'Active') || (p.games != null && p.games < 17))
      .filter((p) => p.projFull ? p.projFull > 60 : p.proj > 60 || p.aav >= 3)
      .sort((a, b) => (b.projFull || b.proj) - (a.projFull || a.proj)).slice(0, 14);
    const newsCard = `<div class="card">
      <h4>Injury &amp; news watch · not simply active</h4>
      ${watchList.length ? watchList.map((p) => `<div class="nw"><span class="nm">${esc(p.name)}</span><span class="pos ${posClass(p.pos)}">${esc(p.pos)}</span>${injHtml(p)}
        <span class="nwt">${p.newsNote ? esc(p.newsNote) : p.news ? esc(p.news.note) : ''}</span></div>`).join('')
        : '<div class="fact">Nobody who matters is on the report.</div>'}
    </div>`;
    box.innerHTML = plan + nomCard + drainCard + flierCard + roster + budgets + rostersCard + newsCard;
  }

  function renderTargets() {
    if (!R || !R.me || !R.me.targets.length) { $('targets').innerHTML = ''; return; }
    $('targets').innerHTML = `<div class="tcap">Best value for <b>your</b> board · legal for the slot · in reach of your max bid · ranked by your number minus what the room will pay</div>
      <div class="tgrid">${R.me.targets.map((t) => `
      <div class="tslot">
        <h5>${esc(t.slot)} · best value for you</h5>
        ${t.cands.length ? t.cands.map((p) => `
          <div class="tc${p.stretch ? ' stretch' : ''}"><span class="nm">${esc(p.name)}${p.byeClash ? `<i class="clash" title="same bye as ${esc(p.byeClash)}">bye ${p.bye} · same as ${esc(p.byeClash.split(' ').pop())}</i>` : ''}${p.stretch ? '<i class="clash st">room price is over your max</i>' : ''}${p.contest === 0 ? '<i class="clash ok">clear path</i>' : p.contest >= 2 ? `<i class="clash ct">${p.contest} hunting · ${esc(p.contestBy.slice(0, 2).join(', '))}</i>` : ''}</span>
            <span class="pr">${money(p.payTo)}<small>you · room ${money(p.mkt)}</small>${edgeHtml(p.youEdge)}</span></div>`).join('')
          : '<div class="tc"><span class="nm" style="color:var(--faint)">nobody left</span></div>'}
      </div>`).join('')}</div>`;
  }

  const T = window.GUIDE_TRENDS;
  function renderTrends() {
    if (!T) { $('trends').innerHTML = ''; return; }
    const POS4 = ['QB', 'RB', 'WR', 'TE'];
    const shareBar = M.POSITIONS.map((p) => {
      const s = T.share[p] || 0, e = T.shareEarly[p] || 0, d = Math.round((s - e) * 100);
      return `<div class="sh"><span class="sp ${posClass(p)}">${p}</span>
        <span class="bar"><i class="${posClass(p)}" style="width:${Math.max(2, s * 100)}%"></i></span>
        <b>${Math.round(s * 100)}%</b><small>${d ? (d > 0 ? '+' : '') + d + ' vs 2017–20' : 'flat'}</small></div>`;
    }).join('');
    const lad = POS4.map((p) => `<tr><td class="l ${posClass(p)}"><b>${p}</b></td>${[1, 2, 3, 5, 8, 12].map((n) =>
      `<td>${T.ladder[p] && T.ladder[p][n] != null ? '$' + T.ladder[p][n] : '—'}</td>`).join('')}</tr>`).join('');
    const th = T.topHeavy, hits = T.dollarHits, k = T.kdst;
    const owners = T.owners.slice().sort((a, b) => Math.abs(b.tilt[b.lean]) - Math.abs(a.tilt[a.lean])).map((o) => {
      const v = o.tilt[o.lean];
      return `<div class="ow"><b>${esc(o.team || o.owner)}</b>${o.team ? `<em>${esc(o.owner)}</em>` : ''}<span class="${v > 0 ? 'pos-edge' : 'neg-edge'}">${v > 0 ? 'chases' : 'avoids'} ${o.lean} ${v > 0 ? '+' : ''}${v}%</span>
        <small>${o.big} pick${o.big === 1 ? '' : 's'} of $50+ · avg $${o.avg}</small></div>`;
    }).join('');
    $('trends').innerHTML = `
      <div class="card">
        <h4>How this room spends · ${T.recent[0]}–${String(T.recent[T.recent.length - 1]).slice(2)} auctions, keepers excluded</h4>
        <div class="tgrid3">
          <div><div class="sub">Share of auction dollars</div>${shareBar}</div>
          <div><div class="sub">What the Nth-priciest pick goes for</div>
            <table class="ladder"><thead><tr><th class="l"></th>${[1, 2, 3, 5, 8, 12].map((n) => `<th>#${n}</th>`).join('')}</tr></thead><tbody>${lad}</tbody></table>
            <div class="fact"><b>K / D/ST:</b> ${Math.round(k.K.one * 100)}% and ${Math.round(k['D/ST'].one * 100)}% went for $1; ${k.K.threePlus + k['D/ST'].threePlus} of ${k.K.n + k['D/ST'].n} ever hit $3.</div></div>
          <div><div class="sub">Shape of the room</div>
            <div class="fact">Top 10 picks take <b>${Math.round(th.top10 * 100)}%</b> of the money, top 20 take <b>${Math.round(th.top20 * 100)}%</b>.</div>
            <div class="fact">Only about <b>${Math.round(th.b30)}</b> players a year land in $30–49 — a thin middle. About ${Math.round(th.b50)} go $50+ and ${Math.round(th.b1)} go for $1.</div>
            <div class="fact"><b>$1 bargains:</b> ${Math.round(hits.QB.top24 * 100)}% of $1 QBs and ${Math.round(hits.TE.top24 * 100)}% of $1 TEs finished top-24; $1 RB/WR just ${Math.round(hits.RB.top24 * 100)}–${Math.round(hits.WR.top24 * 100)}%.</div>
            <div class="fact"><b>$30+ busts:</b> RB ${Math.round(T.bust.RB.rate * 100)}%, WR ${Math.round(T.bust.WR.rate * 100)}% finished outside the top 24.</div></div>
        </div>
        <div class="sub" style="margin-top:10px">Who bids on what · tilt vs league share</div>
        <div class="owners">${owners}</div>
      </div>`;
  }

  function ladderHint(pos) {
    if (pos === 'ALL') return '';
    const needs = needsLine(pos);
    if (!T || !T.ladder[pos]) return needs;
    const l = T.ladder[pos];
    return needs + `<div class="hint small">Past years: ${pos}${[1, 3, 5, 8, 12].filter((n) => l[n] != null)
      .map((n) => ` #${n} ≈ <b>$${l[n]}</b>`).join(' ·')}</div>`;
  }

  /* Everyone who's been sold tonight -- in draft order, or grouped by position
     or by team, each group tallied. Price sits next to ESPN's auction value
     for the same player so overpays and steals read at a glance. */
  function renderDrafted() {
    const picks = ((state && state.picks) || []).slice().sort((a, b) => a.n - b.n)
      .filter((p) => !q || p.name.toLowerCase().includes(q));
    const total = picks.reduce((s, p) => s + (+p.cost || 0), 0);
    $('count').textContent = `${picks.length} drafted · $${total}`;
    const modes = `<div class="dmodes">${[['order', 'Draft order'], ['pos', 'By position'], ['team', 'By team']]
      .map(([m, l]) => `<button type="button" class="dm${dmode === m ? ' on' : ''}" data-m="${m}">${l}</button>`).join('')}</div>`;
    if (!picks.length) { $('board').innerHTML = modes + '<div class="empty">Nobody drafted yet.</div>'; return; }

    const row = (p) => {
      const aav = p.aav ? Math.round(p.aav) : null;
      const d = aav != null ? p.cost - aav : null;
      const dh = d == null ? '' : d > 0 ? `<span class="neg-edge">+$${d}</span>` : d < 0 ? `<span class="pos-edge">−$${Math.abs(d)}</span>` : '<span class="zero-edge">—</span>';
      return `<tr>
        <td class="rk">${p.n}</td>
        <td class="pl"><div class="nm">${esc(p.name)}</div>
          <div class="meta"><span class="pos ${posClass(p.pos)}">${esc(p.pos)}</span>${p.nfl ? `<span>${esc(p.nfl)}</span>` : ''}</div></td>
        <td class="team-cell wide">${esc(p.team)}</td>
        <td class="model">$${p.cost}</td>
        <td class="mkt">${aav != null ? '$' + aav : '—'}</td>
        <td class="edge">${dh}</td>
      </tr>`;
    };
    const head = (label, list) => {
      const t = list.reduce((s, p) => s + p.cost, 0);
      return `<tr class="tier-head"><td colspan="6">${esc(label)} · ${list.length} · $${t} · avg $${Math.round(t / list.length)}</td></tr>`;
    };
    let body = '';
    if (dmode === 'pos') {
      M.POSITIONS.forEach((pos) => { const l = picks.filter((p) => p.pos === pos); if (l.length) body += head(pos, l) + l.map(row).join(''); });
    } else if (dmode === 'team') {
      const order = (state.teams || []).map((t) => t.name);
      order.forEach((tm) => { const l = picks.filter((p) => p.team === tm); if (l.length) body += head(tm, l) + l.map(row).join(''); });
    } else {
      body = picks.map(row).join('');
    }
    $('board').innerHTML = modes + `<table>
      <thead><tr><th class="l">#</th><th class="l">Player</th><th class="l wide">Team</th>
        <th>Paid</th><th>ESPN</th><th>vs</th></tr></thead>
      <tbody>${body}</tbody></table>`;
  }

  function renderBoard() {
    $('expand-btn').hidden = tab === 'DRAFTED';
    if (tab === 'DRAFTED') { $('sort-btn').hidden = true; if (!state) { $('board').innerHTML = '<div class="empty">waiting for the board…</div>'; return; } renderDrafted(); return; }
    if (!R) { $('board').innerHTML = '<div class="empty">waiting for the board…</div>'; return; }
    let rows = [];
    if (tab === 'ALL') {
      rows = R.avail.filter((p) => p.proj > 0 || p.aav > 0);
      if (sortMode === 'you') rows = rows.filter((p) => p.payTo > 0).sort((a, b) => (b.payTo - b.mkt) - (a.payTo - a.mkt) || b.payTo - a.payTo);
      else if (sortMode === 'edge') rows.sort((a, b) => b.edge - a.edge || b.model - a.model);
      else if (sortMode === 'model') rows.sort((a, b) => b.model - a.model || b.proj - a.proj);
      else rows.sort((a, b) => ((a.cons == null) - (b.cons == null)) || (a.cons - b.cons) || (b.model - a.model));   // composite rank
      rows = rows.slice(0, 160);
    } else if (tab === 'ROOKIES' || tab === '2ND YR') {
      const key = tab === 'ROOKIES' ? 'rookie' : 'soph';
      rows = R.avail.filter((p) => p[key] && (p.proj > 0 || p.aav > 0)).sort((a, b) => b.model - a.model || b.proj - a.proj);
    } else if (R.byPos[tab]) {                       // a position tab, in composite order; WATCH is handled below
      rows = R.byPos[tab].filter((p) => p.proj > 0 || p.aav > 0).sort((a, b) => a.compRank - b.compRank);
    }
    let soldHtml = '';
    if (tab === 'WATCH') {
      rows = R.avail.filter((p) => watch.has(p.name)).sort((a, b) => b.model - a.model);
      const sold = ((state && state.picks) || []).filter((p) => watch.has(p.name));
      $('count').textContent = `${rows.length} watching${sold.length ? ` · ${sold.length} sold` : ''}`;
      $('sort-btn').hidden = true;
      soldHtml = sold.length ? `<table class="soldlist"><tbody>${sold.map((p) => `<tr class="sold"><td class="w">★</td><td class="rk">${p.n}</td>
        <td class="pl"><div class="nm">${esc(p.name)}</div><div class="meta"><span class="pos ${posClass(p.pos)}">${esc(p.pos)}</span></div></td>
        <td class="team-cell">sold to ${esc(p.team)}</td><td class="model">$${p.cost}</td></tr>`).join('')}</tbody></table>` : '';
      if (!rows.length) { $('board').innerHTML = soldHtml || '<div class="empty">Tap ★ on any player to watch him here.</div>'; return; }
    }
    if (q) rows = R.avail.filter((p) => p.name.toLowerCase().includes(q)).sort((a, b) => b.model - a.model);
    if (tab !== 'WATCH') $('count').textContent = `${rows.length} available`;
    $('sort-btn').hidden = tab !== 'ALL' || !!q;
    $('sort-btn').textContent = 'Sort: ' + ({ rank: 'Rank', model: 'Model', edge: 'Edge', you: 'You' })[sortMode];
    if (!rows.length) { $('board').innerHTML = '<div class="empty">nobody matches</div>'; return; }
    const byPosView = tab !== 'ALL' && !q;
    let lastTier = 0;
    const body = rows.map((p, i) => {
      let head = '';
      if (byPosView && p.tier > lastTier) {          // composite order can interleave tiers; head each once
        lastTier = p.tier;
        head = `<tr class="tier-head"><td colspan="6">Tier ${p.tier}</td></tr>`;
      }
      const cons = p.cons ? `rank ${p.cons}${p.spread > 8 ? ` <span title="sources disagree by ${p.spread} overall spots">±${p.spread}</span>` : ''} · ${p.nsrc} src` : '';
      const open = isOpen(p.name);
      const you = p.payTo == null ? '' : p.payTo === 0 ? '—' : money(p.payTo);
      // list view: name, position, team, a cross if he's hurt, and the three prices
      return head + `<tr class="row${p.cliff && byPosView ? ' cliff' : ''}${watch.has(p.name) ? ' watched' : ''}${open ? ' open' : ''}" data-n="${esc(p.name)}">
        <td class="w"><button type="button" class="star${watch.has(p.name) ? ' on' : ''}" data-w="${esc(p.name)}" title="Watch list">★</button></td>
        <td class="rk">${byPosView ? p.compRank : i + 1}</td>
        <td class="pl"><div class="plx"><span class="nm">${esc(p.name)}</span>${injFlag(p)}<span class="tag ${posClass(p.pos)}">${esc(p.pos)}${byPosView ? '' : p.compRank}</span>${p.nfl ? `<span class="tag tm">${esc(p.nfl)}</span>` : ''}</div></td>
        <td class="model">${money(p.model)}</td>
        <td class="you${p.payTo > p.model ? ' up' : p.payTo < p.model ? ' down' : ''}">${you}</td>
        <td class="mkt">${money(p.mkt)}${edgeHtml(p.edge)}</td>
      </tr>
      <tr class="det" data-n="${esc(p.name)}"${open ? '' : ' hidden'}><td colspan="6"><div class="det-in">${open ? detailHtml(p) : ''}</div></td></tr>`;
    }).join('');
    $('board').innerHTML = (byPosView ? ladderHint(tab) : '') + `<table class="list">
      <thead><tr><th></th><th class="l">#</th><th class="l">Player</th>
        <th>Model</th><th title="your number: what he's worth to your roster, inside your max">You</th><th>Mkt</th></tr></thead>
      <tbody>${body}</tbody></table>` + soldHtml;
    $('expand-btn').textContent = expandAll ? 'Collapse all' : 'Expand all';
    const wt = document.querySelector('.tab[data-t="WATCH"]'); if (wt) wt.innerHTML = tabLabel('WATCH');
  }

  function renderRecent() {
    if (!R) return;
    $('recent').innerHTML = R.recent.length ? `<h4>Last picks</h4><div class="rl">${R.recent.map((p) =>
      `<span class="rp"><b>${esc(p.name)}</b><i>$${p.cost}</i><em>${esc(p.team)}</em></span>`).join('')}</div>` : '';
  }

  /* ON THE CLOCK. The board publishes the nomination and the bid as it climbs;
     this is the moment the whole page exists for. Everything the model knows
     about the player, compressed to one decision line. */
  let lastClockName = null;
  function renderClock() {
    const box = $('onclock');
    const mini = $('oc-mini');
    // a new name on the clock: retitle the tab, buzz the phone if he's on your list
    const nm = clock && clock.name ? clock.name : null;
    if (nm !== lastClockName) {
      lastClockName = nm;
      document.title = nm ? `⏱ ${nm}${clock.bid ? ' $' + clock.bid : ''} · War Room` : 'War Room';
      if (nm && watch.has(nm)) { try { navigator.vibrate && navigator.vibrate([120, 60, 120]); } catch (e) {} }
    } else if (nm) {
      document.title = `⏱ ${nm}${clock.bid ? ' $' + clock.bid : ''} · War Room`;
    }
    if (!nm) { mini.hidden = true; mini.innerHTML = ''; }
    document.querySelectorAll('#board tr.onclock').forEach((r) => r.classList.remove('onclock'));
    if (!nm) { box.hidden = true; box.innerHTML = ''; return; }
    box.hidden = false;
    const bid = +clock.bid || 0;
    const norm = E.normName;
    const p = R ? R.avail.find((x) => norm(x.name) === norm(clock.name)) : null;
    const meT = (state && state.teams || []).find((t) => t.name === me);
    const meSt = meT ? E.teamState(meT) : null;
    if (!p) {
      box.innerHTML = `<div class="oc-card"><div class="oc-eyebrow"><span class="dot"></span>On the clock</div>
        <div class="oc-name">${esc(clock.name)}</div>
        <div class="oc-sub">${R ? 'just sold — or not in the pool' : 'loading the board…'}</div></div>`;
      return;
    }
    const row = document.querySelector(`#board tr[data-n="${clock.name.replace(/"/g, '&quot;')}"]`);
    if (row) row.classList.add('onclock');
    // who can still raise: needs a max bid ABOVE the current one and a legal slot
    const raisers = (state.teams || []).map((t) => ({ t, st: E.teamState(t) }))
      .filter(({ t, st }) => st.open > 0 && st.maxBid > bid && E.canRoster(t, p.pos).ok)
      .sort((a, b) => b.st.maxBid - a.st.maxBid);
    const meCan = meT ? E.canRoster(meT, p.pos) : { ok: false, why: '' };
    const myMax = meSt ? meSt.maxBid : 0;
    const payTo = p.payTo != null ? p.payTo : Math.min(p.model, myMax);
    const over = payTo - p.model;
    let verdict, cls;
    if (!meCan.ok) { verdict = `You can't roster him — ${esc(meCan.why || 'position full')}`; cls = 'stop'; }
    else if (myMax <= bid) { verdict = `Out of your range — your max is $${myMax}`; cls = 'stop'; }
    else if (bid < payTo) { verdict = `Pay up to <b>$${payTo}</b>${over > 0 ? ` — $${over} over his $${p.model} lineup value, for your seat` : over < 0 ? ` — under his $${p.model} lineup value, for your seat` : ''}`; cls = 'go'; }
    else { verdict = `Past your number — <b>$${payTo}</b> for you${p.model > payTo ? ` (worth $${p.model} to a lineup, less to your roster)` : ''}`; cls = 'stop'; }
    const why = meCan.ok && p.why ? `<div class="oc-why">${esc(p.why)}</div>` : '';
    const alts = R.byPos[p.pos].filter((x) => x !== p && x.vor > 0).slice(0, 3);
    // nine years of their own bidding: who at this table chases this position
    // who needs this position TONIGHT, and how badly -- not what they did in past years
    const needs = (R.posNeeds && R.posNeeds[p.pos]) || [];
    const needOf = (teamName) => needs.find((n) => n.name === teamName);
    const tag = (teamName) => { const n = needOf(teamName); return n ? ' ' + needTag(n, p.pos) : ''; };
    const must = needs.filter((n) => n.degree === 3 && n.name !== me), flexers = needs.filter((n) => n.degree === 2 && n.name !== me);
    const sc = R.scarcity[p.pos];
    box.innerHTML = `<div class="oc-card ${cls}">
      <div class="oc-top">
        <div>
          <div class="oc-eyebrow"><span class="dot"></span>On the clock${watch.has(p.name) ? ' <i class="wflag">★ on your watch list</i>' : ''}</div>
          <div class="oc-name">${esc(p.name)}</div>
          <div class="oc-sub"><span class="pos ${posClass(p.pos)}">${esc(p.pos)}${p.compRank || p.posRank}</span>${p.nfl ? ' · ' + esc(p.nfl) : ''}${p.bye ? ` · bye ${p.bye}` : ''}${p.rookie ? ' · rookie' : p.soph ? ' · 2nd year' : ''} · proj ${p.proj.toFixed(0)} · tier ${p.tier}${p.cliff ? ' · cliff after him' : ''}${p.cons ? ` · rank ${p.cons} (${p.nsrc} src)` : ''}${p.espnPos ? ` · ESPN ${esc(p.pos.replace('/', ''))}${p.espnPos}` : ''}${Object.entries(p.srcPos || {}).map(([l, r]) => ` · ${esc(l)} ${esc(p.pos.replace('/', ''))}${r}${p.srcTier && p.srcTier[l] ? ` T${p.srcTier[l]}` : ''}${p.srcProj && p.srcProj[l] ? ` (${Math.round(p.srcProj[l])} pts)` : ''}`).join('')}${injHtml(p) ? ' · ' + injHtml(p) : ''}</div>
        <div class="oc-sub oc-last">${statLine(p)}</div>${newsHtml(p)}
        </div>
        <div class="oc-bid"><span>current bid</span><b>${bid ? '$' + bid : '—'}</b></div>
      </div>
      <div class="oc-nums">
        <div class="stat big"><b>$${meCan.ok ? payTo : '—'}</b><span>pay up to · you</span></div>
        <div class="stat"><b>$${p.model}</b><span>worth to a lineup</span></div>
        <div class="stat"><b>$${p.mkt}</b><span>room likely pays</span></div>
        <div class="stat"><b class="${p.edge > 0 ? 'pos-edge' : p.edge < 0 ? 'neg-edge' : ''}">${p.edge > 0 ? '+' : ''}$${p.edge}</b><span>edge</span></div>
        <div class="stat"><b>$${myMax}</b><span>your max</span></div>
        <div class="stat"><b>${raisers.length}</b><span>can still raise</span></div>
      </div>
      <div class="oc-verdict">${verdict}</div>${why}
      <div class="oc-foot">
        <span><b>Can raise:</b> ${raisers.length ? raisers.slice(0, 6).map(({ t, st }) => `${esc(t.name)} $${st.maxBid}${tag(t.name)}`).join(' · ') + (raisers.length > 6 ? ` · +${raisers.length - 6}` : '') : 'nobody'}</span>
        <span><b>${esc(p.pos)} market:</b> ${must.length ? `${must.length} need a starter (${must.map((n) => esc(n.name) + (n.starters > 1 ? ' ×' + n.starters : '') + ' $' + n.maxBid).join(', ')})` : 'nobody needs a starter'}${flexers.length ? ` · ${flexers.length} FLEX open` : ''} · ${sc.solid} solid left</span>
        <span><b>Next best:</b> ${alts.length ? alts.map((x) => `${esc(x.name)} $${x.model}${x.payTo != null && x.payTo !== x.model ? ` <i class="yu">you $${x.payTo}</i>` : ''}`).join(' · ') : 'nobody worth paying for'}</span>
      </div>
    </div>`;
    mini.className = 'oc-mini ' + cls;
    mini.innerHTML = `<span class="mn">${esc(p.name)}</span><span class="mb">${bid ? '$' + bid : '—'}</span>
      <span class="mv">you up to <b>$${meCan.ok ? payTo : '—'}</b> · worth $${p.model} · max $${myMax} · ${raisers.length} can raise</span>`;
    mini.hidden = !miniWanted;
  }
  // the mini strip shows only while the big panel is scrolled out of view
  let miniWanted = false;
  if ('IntersectionObserver' in window) {
    new IntersectionObserver((ents) => {
      miniWanted = !ents[0].isIntersecting;
      const mini = $('oc-mini'); if (clock && clock.name && mini.innerHTML) mini.hidden = !miniWanted;
    }, { threshold: 0.05 }).observe($('onclock'));
  }
  $('oc-mini').addEventListener('click', () => { document.documentElement.style.scrollBehavior = 'smooth'; window.scrollTo(0, 0); });

  function renderMeSelect() {
    const names = (state && state.teams || []).map((t) => t.name);
    if (!names.length) return;
    if (!names.includes(me)) me = names[0];
    $('me-select').innerHTML = names.map((n) => `<option${n === me ? ' selected' : ''}>${esc(n)}</option>`).join('');
  }

  function render() {
    R = state ? M.compute(POOL, state, me) : null;
    renderMeSelect(); renderSeat(); renderCockpit(); renderPlan(); renderTargets(); renderTrends(); renderBoard(); renderRecent(); renderClock();
  }

  // sticky offsets: measure the real header + tabs heights (the top bar wraps
  // on a phone) so the tabs and column header stack instead of overlapping
  function measureSticky() {
    const top = document.querySelector('.top'), tabs = $('tabs');
    if (top) document.documentElement.style.setProperty('--topH', top.offsetHeight + 'px');
    if (tabs) document.documentElement.style.setProperty('--tabsH', tabs.offsetHeight + 'px');
  }
  measureSticky();
  window.addEventListener('resize', measureSticky);
  window.addEventListener('load', measureSticky);

  const pill = $('live-pill');
  window.LiveDraft.subscribe((st) => { state = st; pill.className = 'pill live'; pill.textContent = 'Live'; render(); })
    .catch(() => { pill.className = 'pill off'; pill.textContent = 'Offline'; render(); });
  window.LiveDraft.subscribeClock((c) => { clock = c; renderClock(); }).catch(() => {});
  window.LiveDraft.onConnectionChange((up) => {
    pill.className = 'pill ' + (up ? 'live' : 'off'); pill.textContent = up ? 'Live' : 'Reconnecting';
  }).catch(() => {});
  render();
})();
