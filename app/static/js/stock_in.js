/* STOCK IN page: scan -> cost + markup% -> add to inventory. */
(function () {
  'use strict';

  const { $, api, peso, esc, toast, Sound, Barcode } = POS;
  const HAS_MOUSE = window.matchMedia && window.matchMedia('(pointer: fine)').matches;
  const DEFAULT_MARKUP = $('.stock-grid').dataset.defaultMarkup || '20';
  const LAST_MARKUP_KEY = 'pos_last_markup';

  const f = {
    form: $('#stock-form'), barcode: $('#f-barcode'), lookup: $('#f-lookup'), status: $('#item-status'),
    name: $('#f-name'), cost: $('#f-cost'), markup: $('#f-markup'), qty: $('#f-qty'),
    error: $('#form-error'), save: $('#f-save'),
    price: $('#c-price'), profitEach: $('#c-profit-each'), totalCost: $('#c-total-cost'),
    totalSales: $('#c-total-sales'), totalProfit: $('#c-total-profit'),
    recentList: $('#recent-list'), recentEmpty: $('#recent-empty'),
  };

  let currentCode = null;
  let calcSeq = 0;
  let calcTimer = null;
  let saving = false;

  function lastMarkup() {
    try { return localStorage.getItem(LAST_MARKUP_KEY) || DEFAULT_MARKUP; } catch (e) { return DEFAULT_MARKUP; }
  }
  function rememberMarkup(value) {
    try { localStorage.setItem(LAST_MARKUP_KEY, value); } catch (e) { /* ok */ }
  }

  function setStatus(text, kind) {
    f.status.textContent = text;
    f.status.className = 'item-status ' + (kind || 'muted');
  }

  function showError(msg) {
    f.error.textContent = msg;
    f.error.hidden = !msg;
  }

  // ---------- Calculations ----------
  function clearCalc() {
    [f.price, f.totalCost, f.totalSales, f.totalProfit].forEach((n) => { n.textContent = '—'; });
    f.profitEach.textContent = '';
  }

  function scheduleCalc() {
    clearTimeout(calcTimer);
    calcTimer = setTimeout(runCalc, 120);
  }

  async function runCalc() {
    const cost = f.cost.value.trim().replace(/,/g, '');
    const markup = f.markup.value.trim();
    const qty = parseInt(f.qty.value, 10);
    if (cost === '' || markup === '' || !(qty >= 1)) { clearCalc(); return; }
    const seq = ++calcSeq;
    try {
      const res = await api.post('/api/pricing/preview', { cost, markup_pct: markup, qty });
      if (seq !== calcSeq) return;
      const c = res.calc;
      f.price.textContent = peso(c.price_cents);
      f.profitEach.textContent = 'Profit per unit: ' + peso(c.profit_each_cents);
      f.totalCost.textContent = peso(c.total_cost_cents);
      f.totalSales.textContent = peso(c.total_sales_cents);
      f.totalProfit.textContent = peso(c.total_profit_cents);
      showError('');
    } catch (e) {
      if (seq === calcSeq) clearCalc();
    }
  }

  ['input', 'change'].forEach((ev) => {
    f.cost.addEventListener(ev, scheduleCalc);
    f.markup.addEventListener(ev, scheduleCalc);
    f.qty.addEventListener(ev, scheduleCalc);
  });
  [f.cost, f.markup, f.qty].forEach((n) => n.addEventListener('focus', () => n.select()));

  // ---------- Barcode ----------
  function formStarted() {
    return f.cost.value.trim() !== '' || f.name.value.trim() !== '';
  }

  async function onBarcode(raw) {
    const code = Barcode.normalize(raw);
    if (!code) {
      Sound.error();
      setStatus('Invalid barcode read. Please scan or type again.', 'error');
      return;
    }
    // Same barcode scanned again while filling form = increment qty by 1
    if (code === currentCode && formStarted()) {
      f.qty.value = (parseInt(f.qty.value, 10) || 0) + 1;
      scheduleCalc();
      toast('+1 · ' + f.qty.value + ' units', 'success');
      return;
    }
    await loadCode(code);
  }

  async function loadCode(code) {
    f.barcode.value = code;
    showError('');
    try {
      const data = await api.get('/api/products/by-barcode/' + encodeURIComponent(code));
      currentCode = data.barcode;
      f.barcode.value = data.barcode;
      const p = data.product;
      f.qty.value = '1';
      if (p) {
        f.name.value = p.name;
        f.cost.value = (p.cost_cents / 100).toFixed(2);
        f.markup.value = String(+p.markup_pct);
        setStatus('Already registered: ' + p.name + ' · current stock: ' + p.stock +
                  ' · price: ' + peso(p.price_cents) + '. Enter purchase cost and quantity.', 'known');
        if (HAS_MOUSE) f.cost.focus();
        f.cost.select();
      } else {
        f.name.value = '';
        f.cost.value = '';
        f.markup.value = lastMarkup();
        setStatus('New item. Enter item name and purchase cost.', 'new');
        if (HAS_MOUSE) f.name.focus();
      }
      Sound.ok();
      runCalc();
    } catch (e) {
      Sound.error();
      setStatus(e.message, 'error');
    }
  }

  f.barcode.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const v = f.barcode.value;
      if (v.trim()) onBarcode(v);
    }
  });
  f.lookup.addEventListener('click', () => { if (f.barcode.value.trim()) onBarcode(f.barcode.value); });

  // ---------- Save ----------
  function resetForm() {
    currentCode = null;
    f.barcode.value = '';
    f.name.value = '';
    f.cost.value = '';
    f.markup.value = lastMarkup();
    f.qty.value = '1';
    clearCalc();
    setStatus('Scan the next item.', 'muted');
    showError('');
    if (HAS_MOUSE) f.barcode.focus();
  }

  function addRecent(result) {
    const p = result.product;
    f.recentEmpty.hidden = true;
    const li = document.createElement('li');
    li.className = 'fresh';
    li.innerHTML = '<div><strong>' + esc(p.name) + '</strong>' + (result.is_new ? ' <span class="tag-void" style="background:#fef3c7;color:#92400e">NEW</span>' : '') +
      '<div class="muted small">Price: ' + peso(p.price_cents) + ' · current stock: ' + p.stock + '</div></div>' +
      '<div class="r-plus">+' + result.added_qty + '</div>';
    f.recentList.insertBefore(li, f.recentList.firstChild);
    while (f.recentList.children.length > 8) f.recentList.removeChild(f.recentList.lastChild);
  }

  f.form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (saving) return;
    showError('');

    const code = Barcode.normalize(f.barcode.value);
    if (!code) { showError('Please enter or scan a barcode.'); Sound.error(); f.barcode.focus(); return; }
    if (!f.name.value.trim()) { showError('Please enter the item name.'); Sound.error(); f.name.focus(); return; }
    if (f.cost.value.trim() === '') { showError('Please enter the purchase cost.'); Sound.error(); f.cost.focus(); return; }
    if (f.markup.value.trim() === '') { showError('Please enter the markup percentage.'); Sound.error(); f.markup.focus(); return; }
    const qty = parseInt(f.qty.value, 10);
    if (!(qty >= 1)) { showError('Quantity must be 1 or greater.'); Sound.error(); f.qty.focus(); return; }

    saving = true;
    f.save.disabled = true;
    try {
      const res = await api.post('/api/stock-in', {
        barcode: code,
        name: f.name.value.trim(),
        cost: f.cost.value.trim().replace(/,/g, ''),
        markup_pct: f.markup.value.trim(),
        qty,
      });
      rememberMarkup(f.markup.value.trim());
      Sound.ok();
      toast('Added: ' + res.product.name + ' (+' + res.added_qty + ') · stock: ' + res.product.stock, 'success');
      addRecent(res);
      resetForm();
    } catch (err) {
      Sound.error();
      showError(err.message);
    } finally {
      saving = false;
      f.save.disabled = false;
    }
  });

  // ---------- Init ----------
  f.markup.value = lastMarkup();
  clearCalc();
  initCameraPanel((code) => onBarcode(code));
  POS.listenUsbScanner((code) => onBarcode(code));
  if (HAS_MOUSE) f.barcode.focus();
})();

