/* INVENTORY page: stock list, edit item, adjust stock count. */
(function () {
  'use strict';

  const { $, api, peso, esc, toast, Sound, openModal, closeModal } = POS;

  const el = {
    body: $('#inv-body'), empty: $('#inv-empty'), table: $('#inv-table'),
    search: $('#inv-search'), low: $('#inv-low'),
    tItems: $('#t-items'), tPieces: $('#t-pieces'), tCost: $('#t-cost'), tSales: $('#t-sales'),
    tLow: $('#t-low'), tOut: $('#t-out'), tLowBtn: $('#t-low-btn'), tOutBtn: $('#t-out-btn'),
    editModal: $('#edit-modal'), editForm: $('#edit-form'), editBarcode: $('#edit-barcode'),
    eName: $('#e-name'), eCost: $('#e-cost'), eMarkup: $('#e-markup'), ePrice: $('#e-price'),
    eLow: $('#e-low'), eError: $('#edit-error'), eDelete: $('#e-delete'),
    adjModal: $('#adjust-modal'), adjForm: $('#adjust-form'), adjName: $('#adjust-name'),
    aStock: $('#a-stock'), aNote: $('#a-note'), aError: $('#adjust-error'),
  };

  let products = [];
  let outOnly = false;
  let editing = null;
  let adjusting = null;
  let priceTouched = false;
  let previewSeq = 0;

  // ---------- List ----------
  async function load() {
    const q = el.search.value.trim();
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (el.low.checked) params.set('low', '1');
    try {
      const res = await api.get('/api/products?' + params.toString());
      products = res.products;
      renderSummary(res.summary);
      render();
    } catch (e) { toast(e.message, 'error'); }
  }

  function renderSummary(s) {
    el.tItems.textContent = s.items.toLocaleString('en-PH');
    el.tPieces.textContent = s.pieces.toLocaleString('en-PH');
    el.tCost.textContent = peso(s.cost_value);
    el.tSales.textContent = peso(s.sales_value);
    el.tLow.textContent = s.low_count;
    el.tOut.textContent = s.out_count;
  }

  function render() {
    const list = outOnly ? products.filter((p) => p.stock === 0) : products;
    el.empty.hidden = list.length > 0;
    el.table.hidden = list.length === 0;
    el.body.innerHTML = list.map((p) => {
      const cls = p.is_out ? 'out' : (p.is_low ? 'low' : '');
      return '<tr data-id="' + p.id + '">' +
        '<td><div class="p-name">' + esc(p.name) + '</div><div class="p-code">' + esc(p.barcode) + '</div></td>' +
        '<td class="num"><span class="badge ' + cls + '">' + p.stock + '</span></td>' +
        '<td class="num hide-sm">' + peso(p.cost_cents) + '</td>' +
        '<td class="num hide-sm">' + (+p.markup_pct) + '%</td>' +
        '<td class="num"><strong>' + peso(p.price_cents) + '</strong></td>' +
        '<td class="row-actions">' +
        '<button type="button" class="btn small" data-act="adjust">Count</button>' +
        '<button type="button" class="btn small" data-act="edit">Edit</button></td></tr>';
    }).join('');
  }

  let searchTimer = null;
  el.search.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(load, 200); });
  el.low.addEventListener('change', () => { if (!el.low.checked) outOnly = false; load(); });
  el.tLowBtn.addEventListener('click', () => { outOnly = false; el.low.checked = true; load(); });
  el.tOutBtn.addEventListener('click', () => { outOnly = true; el.low.checked = true; load(); });

  el.body.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const p = products.find((x) => String(x.id) === btn.closest('tr').dataset.id);
    if (!p) return;
    if (btn.dataset.act === 'edit') openEdit(p);
    else openAdjust(p);
  });

  // ---------- Edit Item ----------
  function openEdit(p) {
    editing = p;
    priceTouched = false;
    el.editBarcode.textContent = 'Barcode: ' + p.barcode;
    el.eName.value = p.name;
    el.eCost.value = (p.cost_cents / 100).toFixed(2);
    el.eMarkup.value = String(+p.markup_pct);
    el.ePrice.value = (p.price_cents / 100).toFixed(2);
    el.eLow.value = p.low_stock_level;
    el.eError.hidden = true;
    openModal(el.editModal);
  }

  async function previewPrice() {
    if (priceTouched) return;
    const cost = el.eCost.value.trim().replace(/,/g, '');
    const markup = el.eMarkup.value.trim();
    if (cost === '' || markup === '') return;
    const seq = ++previewSeq;
    try {
      const res = await api.post('/api/pricing/preview', { cost, markup_pct: markup, qty: 1 });
      if (seq === previewSeq && !priceTouched) el.ePrice.value = (res.calc.price_cents / 100).toFixed(2);
    } catch (e) { /* wait for valid inputs */ }
  }
  el.eCost.addEventListener('input', previewPrice);
  el.eMarkup.addEventListener('input', previewPrice);
  el.ePrice.addEventListener('input', () => { priceTouched = true; });

  el.editForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!editing) return;
    const body = { name: el.eName.value.trim(), low_stock_level: el.eLow.value.trim() };
    const cost = el.eCost.value.trim().replace(/,/g, '');
    const markup = el.eMarkup.value.trim();
    if (cost !== (editing.cost_cents / 100).toFixed(2)) body.cost = cost;
    if (markup !== String(+editing.markup_pct)) body.markup_pct = markup;
    if (priceTouched) body.price = el.ePrice.value.trim().replace(/,/g, '');
    try {
      await api.patch('/api/products/' + editing.id, body);
      closeModal(el.editModal);
      toast('Changes saved successfully.', 'success');
      await load();
    } catch (err) {
      Sound.error();
      el.eError.textContent = err.message;
      el.eError.hidden = false;
    }
  });

  el.eDelete.addEventListener('click', async () => {
    if (!editing) return;
    if (!window.confirm('Delete "' + editing.name + '"? This cannot be undone.')) return;
    try {
      await api.del('/api/products/' + editing.id);
      closeModal(el.editModal);
      toast('Item deleted.', 'success');
      await load();
    } catch (err) {
      Sound.error();
      el.eError.textContent = err.message;
      el.eError.hidden = false;
    }
  });

  // ---------- Adjust Stock ----------
  function openAdjust(p) {
    adjusting = p;
    el.adjName.textContent = p.name + ' · system stock: ' + p.stock;
    el.aStock.value = p.stock;
    el.aNote.value = '';
    el.aError.hidden = true;
    openModal(el.adjModal);
    setTimeout(() => el.aStock.select(), 60);
  }

  el.adjForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!adjusting) return;
    try {
      await api.post('/api/products/' + adjusting.id + '/adjust', {
        stock: el.aStock.value.trim(), note: el.aNote.value.trim(),
      });
      closeModal(el.adjModal);
      toast('Stock count updated.', 'success');
      await load();
    } catch (err) {
      Sound.error();
      el.aError.textContent = err.message;
      el.aError.hidden = false;
    }
  });

  load();
})();

