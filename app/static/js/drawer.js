/* Cash Drawer & Denomination Counter */
(function () {
  'use strict';

  const { $, api, peso, esc, toast, Sound, openModal, closeModal } = POS;

  const BILL_LIST = [
    { code: '1000', label: '₱1,000 Bill', cents: 100000 },
    { code: '500', label: '₱500 Bill', cents: 50000 },
    { code: '200', label: '₱200 Bill', cents: 20000 },
    { code: '100', label: '₱100 Bill', cents: 10000 },
    { code: '50', label: '₱50 Bill', cents: 5000 },
    { code: '20', label: '₱20 Bill', cents: 2000 },
  ];

  const COIN_LIST = [
    { code: '20', label: '₱20 Coin', cents: 2000 },
    { code: '10', label: '₱10 Coin', cents: 1000 },
    { code: '5', label: '₱5 Coin', cents: 500 },
    { code: '1', label: '₱1 Coin', cents: 100 },
    { code: '0.25', label: '25¢ Coin', cents: 25 },
  ];

  const el = {
    date: $('#d-date'),
    todayBtn: $('#d-today'),
    openReplenishBtn: $('#open-replenish-btn'),

    // KPI Tiles
    kpiExpected: $('#kpi-expected'),
    kpiExpectedSub: $('#kpi-expected-sub'),
    kpiSales: $('#kpi-sales'),
    kpiSalesSub: $('#kpi-sales-sub'),
    kpiAddedChange: $('#kpi-added-change'),
    kpiChangeBreakdown: $('#kpi-change-breakdown'),
    kpiCounted: $('#kpi-counted'),
    kpiVariance: $('#kpi-variance'),
    tileAudit: $('#tile-audit'),

    // Denomination summary bar
    sumBills: $('#sum-bills'),
    countBillsPcs: $('#count-bills-pcs'),
    sumCoins: $('#sum-coins'),
    countCoinsPcs: $('#count-coins-pcs'),
    sumGrand: $('#sum-grand'),
    countTotalPcs: $('#count-total-pcs'),

    // Grids
    billsGrid: $('#bills-grid'),
    coinsGrid: $('#coins-grid'),
    clearCountBtn: $('#clear-count-btn'),
    saveCountBtn: $('#save-count-btn'),
    countNote: $('#count-note'),
    countSaveStatus: $('#count-save-status'),

    // Replenish form
    replenishForm: $('#replenish-form'),
    replenishAmount: $('#replenish-amount'),
    replenishNote: $('#replenish-note'),

    // Movements list
    movementsEmpty: $('#movements-empty'),
    movementsList: $('#movements-list'),

    // Modal
    quickReplenishModal: $('#quick-replenish-modal'),
    modalReplenishForm: $('#modal-replenish-form'),
    modalRepAmount: $('#modal-rep-amount'),
    modalRepNote: $('#modal-rep-note'),
    modalRepError: $('#modal-rep-error'),
  };

  let drawerData = null;
  let billCounts = {};
  let coinCounts = {};

  function todayStr() {
    return new Date().toISOString().slice(0, 10);
  }

  function parseCash(text) {
    const cleaned = String(text || '').replace(/[₱,\s]/g, '');
    if (cleaned === '') return null;
    const n = Number(cleaned);
    if (!Number.isFinite(n) || n < 0) return NaN;
    return Math.round(n * 100);
  }

  // ---------- Build Denomination Rows ----------
  function initGrids() {
    el.billsGrid.innerHTML = BILL_LIST.map((b) => {
      billCounts[b.code] = 0;
      return `
        <div class="denom-row" data-type="bill" data-code="${b.code}">
          <div class="denom-label">
            <span class="denom-icon">💵</span>
            <strong>${b.label}</strong>
          </div>
          <div class="stepper denom-stepper">
            <button type="button" data-step="-1" aria-label="Decrease">−</button>
            <input type="number" min="0" step="1" inputmode="numeric" value="0" data-code="${b.code}" data-type="bill">
            <button type="button" data-step="1" aria-label="Increase">+</button>
          </div>
          <div class="denom-subtotal" id="subtotal-bill-${b.code}">₱0.00</div>
        </div>
      `;
    }).join('');

    el.coinsGrid.innerHTML = COIN_LIST.map((c) => {
      coinCounts[c.code] = 0;
      return `
        <div class="denom-row" data-type="coin" data-code="${c.code}">
          <div class="denom-label">
            <span class="denom-icon">🪙</span>
            <strong>${c.label}</strong>
          </div>
          <div class="stepper denom-stepper">
            <button type="button" data-step="-1" aria-label="Decrease">−</button>
            <input type="number" min="0" step="1" inputmode="numeric" value="0" data-code="${c.code}" data-type="coin">
            <button type="button" data-step="1" aria-label="Increase">+</button>
          </div>
          <div class="denom-subtotal" id="subtotal-coin-${c.code.replace('.', '_')}">₱0.00</div>
        </div>
      `;
    }).join('');
  }

  // ---------- Calculate and Update Display ----------
  function recalculate() {
    let billsCents = 0;
    let coinsCents = 0;
    let billsPcs = 0;
    let coinsPcs = 0;

    BILL_LIST.forEach((b) => {
      const qty = Math.max(0, parseInt(billCounts[b.code], 10) || 0);
      billCounts[b.code] = qty;
      const sub = qty * b.cents;
      billsCents += sub;
      billsPcs += qty;
      const subEl = $(`#subtotal-bill-${b.code}`);
      if (subEl) subEl.textContent = peso(sub);
    });

    COIN_LIST.forEach((c) => {
      const qty = Math.max(0, parseInt(coinCounts[c.code], 10) || 0);
      coinCounts[c.code] = qty;
      const sub = qty * c.cents;
      coinsCents += sub;
      coinsPcs += qty;
      const subEl = $(`#subtotal-coin-${c.code.replace('.', '_')}`);
      if (subEl) subEl.textContent = peso(sub);
    });

    const grandCents = billsCents + coinsCents;
    const totalPcs = billsPcs + coinsPcs;

    el.sumBills.textContent = peso(billsCents);
    el.countBillsPcs.textContent = `${billsPcs} pcs`;

    el.sumCoins.textContent = peso(coinsCents);
    el.countCoinsPcs.textContent = `${coinsPcs} pcs`;

    el.sumGrand.textContent = peso(grandCents);
    el.countTotalPcs.textContent = `${totalPcs} total pcs`;

    return { billsCents, coinsCents, grandCents, billsPcs, coinsPcs, totalPcs };
  }

  // ---------- Load Drawer Summary & Movements ----------
  async function loadData() {
    const day = el.date.value || todayStr();
    try {
      const res = await api.get('/api/drawer?date=' + encodeURIComponent(day));
      drawerData = res;
      renderSummary(res.summary);
      renderMovements(res.movements || []);
    } catch (e) {
      toast('Failed to load drawer data: ' + e.message, 'error');
    }
  }

  function renderSummary(summary) {
    if (!summary) return;

    el.kpiExpected.textContent = peso(summary.expected_cash_cents);
    el.kpiExpectedSub.textContent = `Sales: ${peso(summary.sales_cash_cents)} · Replenished: ${peso(summary.added_change_cents)}`;

    el.kpiSales.textContent = peso(summary.sales_cash_cents);
    el.kpiSalesSub.textContent = `${summary.sales_count} paid transactions`;

    el.kpiAddedChange.textContent = peso(summary.added_change_cents);
    const bd = summary.added_change_breakdown || {};
    el.kpiChangeBreakdown.textContent = `Coins: ${peso(bd.coins_cents || 0)} · Bills: ${peso(bd.bills_cents || 0)}`;

    if (summary.latest_count) {
      el.kpiCounted.textContent = peso(summary.latest_count.total_cents);
      const diff = summary.variance_cents;
      el.tileAudit.classList.remove('good', 'warn', 'danger');

      if (diff === 0) {
        el.tileAudit.classList.add('good');
        el.kpiVariance.textContent = '✔ Balanced (Exact match)';
        el.kpiVariance.className = 'tile-sub ok';
      } else if (diff > 0) {
        el.tileAudit.classList.add('good');
        el.kpiVariance.textContent = `▲ +${peso(diff)} Over`;
        el.kpiVariance.className = 'tile-sub ok';
      } else {
        el.tileAudit.classList.add('danger');
        el.kpiVariance.textContent = `▼ -${peso(Math.abs(diff))} Short`;
        el.kpiVariance.className = 'tile-sub short';
      }

      // Pre-fill fields if empty and not edited yet
      const curTotal = recalculate().grandCents;
      if (curTotal === 0 && summary.latest_count.denominations) {
        const d = summary.latest_count.denominations;
        if (d.bills) {
          Object.entries(d.bills).forEach(([code, val]) => {
            billCounts[code] = val;
            const input = $(`input[data-code="${code}"][data-type="bill"]`);
            if (input) input.value = val;
          });
        }
        if (d.coins) {
          Object.entries(d.coins).forEach(([code, val]) => {
            coinCounts[code] = val;
            const input = $(`input[data-code="${code}"][data-type="coin"]`);
            if (input) input.value = val;
          });
        }
        recalculate();
      }
    } else {
      el.kpiCounted.textContent = '—';
      el.kpiVariance.textContent = 'No physical count recorded';
      el.kpiVariance.className = 'tile-sub muted small';
    }
  }

  function renderMovements(list) {
    if (!list || !list.length) {
      el.movementsEmpty.hidden = false;
      el.movementsList.hidden = true;
      return;
    }
    el.movementsEmpty.hidden = true;
    el.movementsList.hidden = false;

    el.movementsList.innerHTML = list.map((m) => {
      const isAdd = m.kind === 'add_change' || m.kind === 'initial_float';
      const kindLabel = m.kind === 'add_change' ? 'Change Fund Replenished' :
        m.kind === 'initial_float' ? 'Starting Float' : 'Cash Withdrawal';
      const catBadge = m.category === 'coins' ? '<span class="badge coin-badge">🪙 Coins</span>' :
        m.category === 'bills' ? '<span class="badge bill-badge">💵 Paper Bills</span>' :
          '<span class="badge mixed-badge">Mixed</span>';

      const timeStr = m.created_at ? m.created_at.slice(11, 16) : '';

      return `
        <li class="movement-item">
          <div class="movement-main">
            <div class="movement-title">
              <strong>${kindLabel}</strong>
              ${catBadge}
            </div>
            <div class="movement-meta muted small">
              <span>${timeStr}</span>
              ${m.note ? `<span>· ${esc(m.note)}</span>` : ''}
            </div>
          </div>
          <div class="movement-amount ${isAdd ? 'ok' : 'short'}">
            ${isAdd ? '+' : '-'}${peso(m.amount_cents)}
          </div>
        </li>
      `;
    }).join('');
  }

  // ---------- Denomination Grid Stepper / Input Events ----------
  function handleGridEvents(gridEl) {
    gridEl.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-step]');
      if (!btn) return;
      const row = btn.closest('.denom-row');
      const type = row.dataset.type;
      const code = row.dataset.code;
      const step = parseInt(btn.dataset.step, 10);
      const input = row.querySelector('input');

      let current = type === 'bill' ? (billCounts[code] || 0) : (coinCounts[code] || 0);
      current = Math.max(0, current + step);

      if (type === 'bill') billCounts[code] = current;
      else coinCounts[code] = current;

      input.value = current;
      recalculate();
    });

    gridEl.addEventListener('input', (e) => {
      const input = e.target.closest('input[type="number"]');
      if (!input) return;
      const row = input.closest('.denom-row');
      const type = row.dataset.type;
      const code = row.dataset.code;
      const val = Math.max(0, parseInt(input.value, 10) || 0);

      if (type === 'bill') billCounts[code] = val;
      else coinCounts[code] = val;

      recalculate();
    });

    gridEl.addEventListener('focusin', (e) => {
      if (e.target.matches('input[type="number"]')) e.target.select();
    });
  }

  handleGridEvents(el.billsGrid);
  handleGridEvents(el.coinsGrid);

  // ---------- Reset Counts ----------
  el.clearCountBtn.addEventListener('click', () => {
    if (!window.confirm('Reset all bill and coin count inputs to 0?')) return;
    Object.keys(billCounts).forEach((k) => billCounts[k] = 0);
    Object.keys(coinCounts).forEach((k) => coinCounts[k] = 0);
    document.querySelectorAll('.denom-row input').forEach((inp) => inp.value = '0');
    recalculate();
  });

  // ---------- Save Count Audit ----------
  el.saveCountBtn.addEventListener('click', async () => {
    const { grandCents } = recalculate();
    const note = el.countNote.value.trim();

    try {
      el.saveCountBtn.disabled = true;
      const res = await api.post('/api/drawer/counts', {
        counts: {
          bills: billCounts,
          coins: coinCounts,
        },
        note,
      });

      Sound.ok();
      toast(`Saved physical cash count: ${peso(grandCents)}`, 'ok');
      renderSummary(res.summary);
      el.countNote.value = '';
    } catch (e) {
      Sound.error();
      toast('Failed to save count: ' + e.message, 'error');
    } finally {
      el.saveCountBtn.disabled = false;
    }
  });

  // ---------- Replenish Change Fund Form (Card) ----------
  el.replenishForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const amountCents = parseCash(el.replenishAmount.value);
    if (!amountCents || amountCents <= 0) {
      Sound.error();
      toast('Please enter a valid amount to replenish.', 'error');
      return;
    }

    const catRadio = document.querySelector('input[name="replenish-type"]:checked');
    const category = catRadio ? catRadio.value : 'coins';
    const note = el.replenishNote.value.trim();

    try {
      const res = await api.post('/api/drawer/movements', {
        kind: 'add_change',
        category,
        amount: amountCents / 100,
        note: note || 'Change fund replenishment',
      });

      Sound.ok();
      const catLabel = category === 'coins' ? 'Coins' : category === 'bills' ? 'Paper Bills' : 'Mixed';
      toast(`Successfully inserted ${peso(amountCents)} (${catLabel}) to register!`, 'ok');
      el.replenishAmount.value = '';
      el.replenishNote.value = '';
      loadData();
    } catch (err) {
      Sound.error();
      toast(err.message, 'error');
    }
  });

  // Quick chip buttons inside replenish card
  document.addEventListener('click', (e) => {
    const chip = e.target.closest('#replenish-card [data-add]');
    if (!chip) return;
    const addVal = Number(chip.dataset.add);
    const curr = parseCash(el.replenishAmount.value) || 0;
    el.replenishAmount.value = ((curr + addVal * 100) / 100).toFixed(2);
    el.replenishAmount.focus();
  });

  // ---------- Quick Replenish Modal ----------
  if (el.openReplenishBtn) {
    el.openReplenishBtn.addEventListener('click', () => {
      el.modalRepAmount.value = '';
      el.modalRepNote.value = '';
      el.modalRepError.hidden = true;
      openModal(el.quickReplenishModal);
    });
  }

  // Quick chip buttons inside modal
  document.addEventListener('click', (e) => {
    const chip = e.target.closest('#quick-replenish-modal [data-add]');
    if (!chip) return;
    const addVal = Number(chip.dataset.add);
    const curr = parseCash(el.modalRepAmount.value) || 0;
    el.modalRepAmount.value = ((curr + addVal * 100) / 100).toFixed(2);
    el.modalRepAmount.focus();
  });

  if (el.modalReplenishForm) {
    el.modalReplenishForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const amountCents = parseCash(el.modalRepAmount.value);
      if (!amountCents || amountCents <= 0) {
        el.modalRepError.textContent = 'Please enter a valid amount.';
        el.modalRepError.hidden = false;
        return;
      }

      const catRadio = document.querySelector('input[name="modal-rep-type"]:checked');
      const category = catRadio ? catRadio.value : 'coins';
      const note = el.modalRepNote.value.trim();

      try {
        await api.post('/api/drawer/movements', {
          kind: 'add_change',
          category,
          amount: amountCents / 100,
          note: note || 'Change fund replenishment',
        });
        Sound.ok();
        toast(`Inserted ${peso(amountCents)} to cash drawer!`, 'ok');
        closeModal(el.quickReplenishModal);
        loadData();
      } catch (err) {
        Sound.error();
        el.modalRepError.textContent = err.message;
        el.modalRepError.hidden = false;
      }
    });
  }

  // ---------- Date Selection ----------
  el.date.value = todayStr();
  el.date.addEventListener('change', loadData);
  el.todayBtn.addEventListener('click', () => {
    el.date.value = todayStr();
    loadData();
  });

  // ---------- Init ----------
  initGrids();
  recalculate();
  loadData();
})();
