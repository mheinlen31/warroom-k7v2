/* War Room UI. Read-only. State comes from the board's live room; every
   render recomputes the model from scratch so nothing is ever stale. */
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const POOL = (window.GUIDE_PLAYERS || {}).players || [];
  const M = window.GuideModel;
  const TABS = ['ALL', 'QB', 'RB', 'WR', 'TE', 'K', 'D/ST'];
  const posClass = (p) => 'pos-' + String(p).replace('/', '');

  let me = localStorage.getItem('sfg-me') || 'Silent Pugios';
  let tab = localStorage.getItem('sfg-tab') || 'ALL';
  if (!TABS.includes(tab)) tab = 'ALL';
  let q = '';
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

  function renderBoard() {
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
    $('board').innerHTML = `<table>
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
    renderMeSelect(); renderCockpit(); renderTargets(); renderBoard(); renderRecent();
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
