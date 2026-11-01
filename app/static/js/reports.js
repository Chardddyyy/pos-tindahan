/* REPORTS page: sales, profit, and receipts for a given date. */
(function () {
  'use strict';

  const { $, api, peso, esc, toast, Sound, todayStr } = POS;

  const el = {
    date: $('#r-date'), today: $('#r-today'),
    sales: $('#r-sales'), cost: $('#r-cost'), profit: $('#r-profit'),
    drawer: $('#r-drawer'), changeFund: $('#r-change-fund'),
    count: $('#r-count'), pieces: $('#r-pieces'), voided: $('#r-void'),
    topList: $('#top-list'), topEmpty: $('#top-empty'),
    salesList: $('#sales-list'), salesEmpty: $('#sales-empty'),
  };

  function timeLabel(createdAt) {
    const [h, m] = createdAt.slice(11, 16).split(':').map(Number);
    return ((h % 12) || 12) + ':' + String(m).padStart(2, '0') + ' ' + (h >= 12 ? 'PM' : 'AM');
  }

  async function load() {
    const date = el.date.value || todayStr();
    try {
      const [summary, list] = await Promise.all([
        api.get('/api/reports/summary?date=' + date),
        api.get('/api/sales?date=' + date),
      ]);
      renderSummary(summary.summary, summary.drawer);
      renderSales(list.sales);
    } catch (e) { toast(e.message, 'error'); }
  }

  function renderSummary(s, drawer) {
    el.sales.textContent = peso(s.sales_cents);
    el.cost.textContent = peso(s.cost_cents);
    el.profit.textContent = peso(s.profit_cents);
    if (el.drawer && drawer) el.drawer.textContent = peso(drawer.expected_cash_cents);
    if (el.changeFund && drawer) el.changeFund.textContent = peso(drawer.added_change_cents);
    el.count.textContent = s.sales_count;
    el.pieces.textContent = s.pieces;
    el.voided.textContent = s.void_count;

    el.topEmpty.hidden = s.top_items.length > 0;
    el.topList.innerHTML = s.top_items.map((t) =>
      '<li><strong>' + esc(t.name) + '</strong> <span class="t-meta">· ' + t.qty +
      ' units · ' + peso(t.sales_cents) + '</span></li>').join('');
  }

  function renderSales(sales) {
    el.salesEmpty.hidden = sales.length > 0;
    el.salesList.innerHTML = sales.map((s) => {
      const isVoid = s.status === 'void';
      return '<li class="sale' + (isVoid ? ' void' : '') + '" data-id="' + s.id + '">' +
        '<div class="sale-head"><div><strong>Receipt #' + s.id + '</strong> · ' + timeLabel(s.created_at) +
        (isVoid ? '<span class="tag-void">VOID</span>' : '') + '</div>' +
        '<div><span class="sale-total">' + peso(s.total_cents) + '</span> ' +
        (isVoid ? '' : '<button type="button" class="btn small ghost-danger" data-act="void">Void</button>') +
        '</div></div>' +
        '<ul class="sale-items">' + s.items.map((i) =>
          '<li>' + i.qty + ' × ' + esc(i.name) + ' @ ' + peso(i.price_cents) + ' = ' + peso(i.line_total_cents) + '</li>'
        ).join('') + '</ul>' +
        (s.change_cents > 0 && !isVoid ? '<div class="muted small">Paid: ' + peso(s.cash_cents) + ' · Change: ' + peso(s.change_cents) + '</div>' : '') +
        '</li>';
    }).join('');
  }

  el.salesList.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act="void"]');
    if (!btn) return;
    const id = btn.closest('.sale').dataset.id;
    if (!window.confirm('Void Receipt #' + id + '? Items will be returned to inventory.')) return;
    btn.disabled = true;
    try {
      await api.post('/api/sales/' + id + '/void');
      toast('Receipt #' + id + ' voided. Items returned to inventory.', 'success');
      await load();
    } catch (err) {
      Sound.error();
      toast(err.message, 'error');
      btn.disabled = false;
    }
  });

  el.date.value = todayStr();
  el.date.addEventListener('change', load);
  el.today.addEventListener('click', () => { el.date.value = todayStr(); load(); });
  load();
})();

