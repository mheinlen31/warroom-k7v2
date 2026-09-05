/* War Room UI. Read-only. State comes from the board's live room; every
   render recomputes the model from scratch so nothing is ever stale. */
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const POOL = (window.GUIDE_PLAYERS || {}).players || [];
  const M = window.GuideModel;
  const TABS = ['ALL', 'QB', 'RB', 'WR', 'TE', 'K', 'D/ST', 'DRAFTED'];
  const posClass = (p) => 'pos-' + String(p).replace('/', '');

  let me = localStorage.getItem('sfg-me') || 'Silent Pugios';
  let tab = localStorage.getItem('sfg-tab') || 'ALL';
  if (!TABS.includes(tab)) tab = 'ALL';
  let q = '';
  let dmode = localStorage.getItem('sfg-dmode') || 'order';   // drafted view: order | pos | team
  let state = null;
  let R = null;   // last model result

  // ---- tabs ----
  $('tabs').innerHTML = TABS.map((t) =>
    `<button class="tab${t === tab ? ' on' : ''}" data-t="${t}">${t}</button>`).join('');
  $('tabs').addEventListener('click', (e) => {
    const b = e.target.closest('.tab'); if (!b) return;
    tab = b.dataset.t; localStorage.setItem('sfg-tab', tab);
    [...$('tabs').children].forEach((x) => x.classList.toggle('on', x.dataset.t === tab));
    renderBoard();
  });
  $('q').addEventListener('input', () => { q = $('q').value.trim().toLowerCase(); renderBoard(); });
  $('board').addEventListener('click', (e) => {
    const b = e.target.closest('.dm'); if (!b) return;
    dmode = b.dataset.m; try { localStorage.setItem('sfg-dmode', dmode); } catch (err) { /* private mode */ }
    renderBoard();
  });
  $('me-select').addEventListener('change', () => {
    me = $('me-select').value; localStorage.setItem('sfg-me', me); render();
  });

  const money = (n) => '$' + Math.round(n);
  const edgeHtml = (e) => e > 0 ? `<span class="pos-edge">+$${e}</span>`
    : e < 0 ? `<span class="neg-edge">−$${Math.abs(e)}</span>` : '<span class="zero-edge">—</span>';
  const injHtml = (p) => !p.inj ? '' : p.inj === 'QUESTIONABLE'
    ? '<span class="inj q">Q</span>' : `<span class="inj">${esc(p.inj[0] + p.inj.slice(1, 3).toLowerCase())}</span>`;

  function renderCockpit() {
    if (!R) return;
    const L = R.league, me_ = R.me;
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
        </div>
      </div>`;
    const scar = `
      <div class="card">
        <h4>Scarcity · solid starters left / open starter slots</h4>
        <div class="scar">${M.POSITIONS.map((pos) => { const s = R.scarcity[pos]; return `
          <div class="sc ${s.label}">
            <div class="p ${posClass(pos)}">${pos}</div>
            <div class="n">${s.solid}<small> / ${Math.round(s.demand)}</small></div>
            <div class="l">${s.label}</div>
          </div>`; }).join('')}</div>
      </div>`;
    $('cockpit').innerHTML = seat + league + scar;
  }

  function renderTargets() {
    if (!R || !R.me || !R.me.targets.length) { $('targets').innerHTML = ''; return; }
    $('targets').innerHTML = `<div class="tgrid">${R.me.targets.map((t) => `
      <div class="tslot">
        <h5>${esc(t.slot)} · best value left</h5>
        ${t.cands.length ? t.cands.map((p) => `
          <div class="tc"><span class="nm">${esc(p.name)}</span>
            <span class="pr">${money(p.model)}<small>mkt ${money(p.mkt)}</small></span></div>`).join('')
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
      return `<div class="ow"><b>${esc(o.owner)}</b><span class="${v > 0 ? 'pos-edge' : 'neg-edge'}">${v > 0 ? 'chases' : 'avoids'} ${o.lean} ${v > 0 ? '+' : ''}${v}%</span>
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
    if (!T || !T.ladder[pos] || pos === 'ALL') return '';
    const l = T.ladder[pos];
    return `<div class="hint">In this league ${pos}${[1, 3, 5, 8, 12].filter((n) => l[n] != null)
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
    if (tab === 'DRAFTED') { if (!state) { $('board').innerHTML = '<div class="empty">waiting for the board…</div>'; return; } renderDrafted(); return; }
    if (!R) { $('board').innerHTML = '<div class="empty">waiting for the board…</div>'; return; }
    let rows;
    if (tab === 'ALL') {
      rows = R.avail.filter((p) => p.proj > 0 || p.aav > 0).sort((a, b) => b.model - a.model || b.proj - a.proj).slice(0, 160);
    } else {
      rows = R.byPos[tab].filter((p) => p.proj > 0 || p.aav > 0);
    }
    if (q) rows = R.avail.filter((p) => p.name.toLowerCase().includes(q)).sort((a, b) => b.model - a.model);
    $('count').textContent = `${rows.length} available`;
    if (!rows.length) { $('board').innerHTML = '<div class="empty">nobody matches</div>'; return; }
    const byPosView = tab !== 'ALL' && !q;
    let lastTier = 0;
    const body = rows.map((p, i) => {
      let head = '';
      if (byPosView && p.tier !== lastTier) {
        lastTier = p.tier;
        head = `<tr class="tier-head"><td colspan="8">Tier ${p.tier}</td></tr>`;
      }
      const cons = p.cons ? `cons ${p.cons}${p.spread > 8 ? ` <span title="rankers disagree">±${p.spread}</span>` : ''}` : '';
      return head + `<tr class="${p.cliff && byPosView ? 'cliff' : ''}">
        <td class="rk">${byPosView ? p.posRank : i + 1}</td>
        <td class="pl"><div class="nm">${esc(p.name)}</div>
          <div class="meta"><span class="pos ${posClass(p.pos)}">${esc(p.pos)}${byPosView ? '' : p.posRank}</span>
            ${p.nfl ? `<span>${esc(p.nfl)}</span>` : ''}${injHtml(p)}${cons ? `<span>${cons}</span>` : ''}</div></td>
        <td class="proj wide">${p.proj ? p.proj.toFixed(0) : '—'}</td>
        <td class="model">${money(p.model)}</td>
        <td class="mkt">${money(p.mkt)}</td>
        <td class="edge">${edgeHtml(p.edge)}</td>
        <td class="bid wide${p.bidders <= 2 ? ' few' : ''}">${p.bidders}</td>
      </tr>`;
    }).join('');
    $('board').innerHTML = (byPosView ? ladderHint(tab) : '') + `<table>
      <thead><tr><th class="l">#</th><th class="l">Player</th><th class="wide">Proj</th>
        <th>Model</th><th>Mkt</th><th>Edge</th><th class="wide">Bidders</th></tr></thead>
      <tbody>${body}</tbody></table>`;
  }

  function renderRecent() {
    if (!R) return;
    $('recent').innerHTML = R.recent.length ? `<h4>Last picks</h4><div class="rl">${R.recent.map((p) =>
      `<span class="rp"><b>${esc(p.name)}</b><i>$${p.cost}</i><em>${esc(p.team)}</em></span>`).join('')}</div>` : '';
  }

  function renderMeSelect() {
    const names = (state && state.teams || []).map((t) => t.name);
    if (!names.length) return;
    if (!names.includes(me)) me = names[0];
    $('me-select').innerHTML = names.map((n) => `<option${n === me ? ' selected' : ''}>${esc(n)}</option>`).join('');
  }

  function render() {
    R = state ? M.compute(POOL, state, me) : null;
    renderMeSelect(); renderCockpit(); renderTargets(); renderTrends(); renderBoard(); renderRecent();
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
  window.LiveDraft.onConnectionChange((up) => {
    pill.className = 'pill ' + (up ? 'live' : 'off'); pill.textContent = up ? 'Live' : 'Reconnecting';
  }).catch(() => {});
  render();
})();
