/* Pahina ng BENTA (POS): scan -> bilihan -> bayad -> bawas sa stock. */
(function () {
  'use strict';

  const { $, api, peso, esc, toast, Sound, Barcode, openModal, closeModal } = POS;
  const STORAGE_KEY = 'pos_cart_v1';
  const HAS_MOUSE = window.matchMedia && window.matchMedia('(pointer: fine)').matches;

  const el = {
    scanForm: $('#scan-form'), scanInput: $('#scan-input'), suggestions: $('#suggestions'),
    lastScan: $('#last-scan'), lastName: $('#last-name'), lastPrice: $('#last-price'), lastInfo: $('#last-info'),
    cartList: $('#cart-list'), cartEmpty: $('#cart-empty'), cartTotal: $('#cart-total'),
    cartCount: $('#cart-count'), clearCart: $('#clear-cart'), payBtn: $('#pay-btn'),
    payModal: $('#pay-modal'), payStep: $('#pay-step'), doneStep: $('#done-step'),
    payTotal: $('#pay-total'), payCount: $('#pay-count'), payCash: $('#pay-cash'),
    quickCash: $('#quick-cash'), changeBox: $('#change-box'), changeLabel: $('#change-label'),
    changeAmount: $('#change-amount'), payError: $('#pay-error'), payConfirm: $('#pay-confirm'),
    doneReceipt: $('#done-receipt'), doneTotal: $('#done-total'), doneChange: $('#done-change'),
    newSale: $('#new-sale'),
    changeBreakdownWrapper: $('#change-breakdown-wrapper'),
    changeBreakdownChips: $('#change-breakdown-chips'),
    shortChangeBanner: $('#short-change-banner'),
    posAddChangeBtn: $('#pos-add-change-btn'),
    posReplenishPanel: $('#pos-replenish-panel'),
    posReplenishClose: $('#pos-replenish-close'),
    posRepAmount: $('#pos-rep-amount'),
    posRepSubmit: $('#pos-rep-submit'),
    posRepMsg: $('#pos-rep-msg'),
  };

  // cart: [{ id, barcode, name, price_cents, stock, qty }]
  let cart = [];
  let flashId = null;
  let paying = false;

  // ---------- Cart storage (hindi mawawala kapag na-refresh) ----------
  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cart)); } catch (e) { /* ok */ }
  }
  function load() {
    try {
      const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      if (Array.isArray(data)) {
        cart = data.filter((i) => i && i.id && i.barcode && i.qty > 0 && i.price_cents >= 0);
      }
    } catch (e) { cart = []; }
  }

  function totalCents() { return cart.reduce((s, i) => s + i.price_cents * i.qty, 0); }
  function pieces() { return cart.reduce((s, i) => s + i.qty, 0); }

  // ---------- Render ----------
  function render() {
    const has = cart.length > 0;
    el.cartEmpty.hidden = has;
    el.cartList.hidden = !has;
    el.clearCart.hidden = !has;
    el.payBtn.disabled = !has;
    el.cartTotal.textContent = peso(totalCents());
    el.cartCount.textContent = pieces() + ' units · ' + cart.length + ' items';

    el.cartList.innerHTML = cart.map((i) => {
      const atMax = i.qty >= i.stock;
      return '<li class="cart-item' + (i.id === flashId ? ' flash' : '') + '" data-id="' + i.id + '">' +
        '<div><div class="ci-name">' + esc(i.name) + '</div>' +
        '<div class="ci-sub">' + peso(i.price_cents) + ' each · stock: ' + i.stock +
        (atMax ? ' <span class="ci-low">(max stock reached)</span>' : '') + '</div></div>' +
        '<div class="ci-total">' + peso(i.price_cents * i.qty) + '</div>' +
        '<div class="stepper">' +
        '<button type="button" data-act="dec" aria-label="Decrease">−</button>' +
        '<input type="text" inputmode="numeric" value="' + i.qty + '" data-act="qty" aria-label="Quantity">' +
        '<button type="button" data-act="inc" aria-label="Increase">+</button></div>' +
        '<button type="button" class="ci-remove" data-act="remove">Remove</button>' +
        '</li>';
    }).join('');
    flashId = null;
  }

  function showLast(name, priceText, info, isError) {
    el.lastScan.hidden = false;
    el.lastScan.classList.toggle('error', !!isError);
    el.lastName.textContent = name;
    el.lastPrice.textContent = priceText;
    el.lastInfo.textContent = info || '';
  }

  function refocus() {
    if (HAS_MOUSE && el.payModal.hidden) el.scanInput.focus();
  }

  // ---------- Add to Cart ----------
  function addProduct(p, qty) {
    if (p.stock <= 0) {
      Sound.error();
      toast('Out of stock: ' + p.name, 'error');
      showLast(p.name, 'OUT OF STOCK', 'No stock remaining. Cannot add.', true);
      return false;
    }
    const existing = cart.find((i) => i.id === p.id);
    const wanted = (existing ? existing.qty : 0) + qty;
    let finalQty = wanted;
    if (wanted > p.stock) {
      finalQty = p.stock;
      Sound.error();
      toast('Stock limit reached for ' + p.name + ' (max: ' + p.stock + ')', 'warn');
    }
    if (existing) {
      Object.assign(existing, { name: p.name, price_cents: p.price_cents, stock: p.stock, qty: finalQty });
    } else {
      cart.push({ id: p.id, barcode: p.barcode, name: p.name, price_cents: p.price_cents, stock: p.stock, qty: finalQty });
    }
    flashId = p.id;
    save();
    render();
    showLast(p.name, peso(p.price_cents), 'In cart: ' + finalQty + ' · Stock: ' + p.stock);
    return true;
  }

  async function addByCode(raw) {
    const code = Barcode.normalize(raw);
    if (!code) {
      Sound.error();
      toast('Invalid barcode read. Please try again.', 'error');
      return;
    }
    try {
      const data = await api.get('/api/products/by-barcode/' + encodeURIComponent(code));
      if (!data.product) {
        Sound.error();
        toast('Barcode ' + code + ' is not registered. Please stock it in first.', 'error');
        showLast('Item Not Registered', code, 'Go to "Stock In" to register this item.', true);
        return;
      }
      addProduct(data.product, 1);
    } catch (e) {
      Sound.error();
      toast(e.message, 'error');
    }
  }


  // ---------- Input / hanap ----------
  function hideSuggestions() { el.suggestions.hidden = true; el.suggestions.innerHTML = ''; }

  function showSuggestions(products) {
    if (!products.length) { hideSuggestions(); return; }
    el.suggestions.innerHTML = products.slice(0, 6).map((p) =>
      '<li><button type="button" data-id="' + p.id + '"><span>' + esc(p.name) +
      '</span><span class="s-meta">' + peso(p.price_cents) + ' · stock ' + p.stock + '</span></button></li>'
    ).join('');
    el.suggestions._products = products;
    el.suggestions.hidden = false;
  }

  async function handleInput(raw) {
    const text = raw.trim();
    if (!text) return;
    if (/^\d{6,}$/.test(text.replace(/\s/g, ''))) { await addByCode(text); return; }
    try {
      const res = await api.get('/api/products?q=' + encodeURIComponent(text));
      if (res.products.length === 1) addProduct(res.products[0], 1);
      else if (res.products.length > 1) showSuggestions(res.products);
      else { Sound.error(); toast('No items found matching "' + text + '".', 'error'); }
    } catch (e) { Sound.error(); toast(e.message, 'error'); }
  }

  el.scanForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const raw = el.scanInput.value;
    el.scanInput.value = '';
    hideSuggestions();
    await handleInput(raw);
    refocus();
  });

  let typingTimer = null;
  el.scanInput.addEventListener('input', () => {
    clearTimeout(typingTimer);
    const text = el.scanInput.value.trim();
    if (text.length < 2 || /^[\d\s]+$/.test(text)) { hideSuggestions(); return; }
    typingTimer = setTimeout(async () => {
      try {
        const res = await api.get('/api/products?q=' + encodeURIComponent(text));
        if (el.scanInput.value.trim() === text) showSuggestions(res.products);
      } catch (e) { /* silent while typing */ }
    }, 200);
  });

  el.suggestions.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-id]');
    if (!btn) return;
    const p = (el.suggestions._products || []).find((x) => String(x.id) === btn.dataset.id);
    if (p) addProduct(p, 1);
    el.scanInput.value = '';
    hideSuggestions();
    refocus();
  });

  // ---------- Cart modifications ----------
  function setQty(id, qty) {
    const item = cart.find((i) => i.id === id);
    if (!item) return;
    if (!Number.isFinite(qty) || qty < 1) qty = 1;
    if (qty > item.stock) {
      qty = item.stock;
      Sound.error();
      toast('Stock limit reached for ' + item.name + ' (max: ' + item.stock + ')', 'warn');
    }
    item.qty = qty;
    save();
    render();
  }

  el.cartList.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn || btn.dataset.act === 'qty') return;
    const li = btn.closest('.cart-item');
    const id = Number(li.dataset.id);
    const item = cart.find((i) => i.id === id);
    if (!item) return;
    if (btn.dataset.act === 'inc') setQty(id, item.qty + 1);
    else if (btn.dataset.act === 'dec') setQty(id, item.qty - 1);
    else if (btn.dataset.act === 'remove') {
      cart = cart.filter((i) => i.id !== id);
      save();
      render();
    }
  });

  el.cartList.addEventListener('change', (e) => {
    if (e.target.dataset.act !== 'qty') return;
    const id = Number(e.target.closest('.cart-item').dataset.id);
    setQty(id, parseInt(e.target.value, 10));
  });
  el.cartList.addEventListener('focusin', (e) => {
    if (e.target.dataset.act === 'qty') e.target.select();
  });
  el.cartList.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.dataset.act === 'qty') { e.preventDefault(); e.target.blur(); refocus(); }
  });

  el.clearCart.addEventListener('click', () => {
    if (cart.length && window.confirm('Clear all items from the cart?')) {
      cart = [];
      save();
      render();
      refocus();
    }
  });

  // Fetch updated prices and stock from server
  async function refreshCart() {
    if (!cart.length) return;
    const results = await Promise.all(cart.map((i) =>
      api.get('/api/products/by-barcode/' + encodeURIComponent(i.barcode)).catch(() => null)));
    let changed = false;
    const next = [];
    cart.forEach((item, idx) => {
      const r = results[idx];
      if (!r) { next.push(item); return; }
      const p = r.product;
      if (!p || p.stock <= 0) { changed = true; return; }
      let qty = item.qty;
      if (qty > p.stock) { qty = p.stock; changed = true; }
      if (p.price_cents !== item.price_cents) changed = true;
      next.push({ id: p.id, barcode: p.barcode, name: p.name, price_cents: p.price_cents, stock: p.stock, qty });
    });
    cart = next;
    save();
    render();
    if (changed) toast('Prices or stock levels updated for some items.', 'warn');
  }

  // ---------- Checkout ----------
  function parseCash(text) {
    const cleaned = String(text || '').replace(/[₱,\s]/g, '');
    if (cleaned === '') return null;
    const n = Number(cleaned);
    if (!Number.isFinite(n) || n < 0) return NaN;
    return Math.round(n * 100);
  }

  function quickAmounts(totalCents) {
    const total = totalCents / 100;
    const bills = [20, 50, 100, 200, 500, 1000].filter((b) => b >= total);
    if (!bills.length) {
      const k = Math.ceil(total / 1000) * 1000;
      bills.push(k, k + 1000);
    }
    return bills.slice(0, 4);
  }

  const DENOM_BREAKDOWN = [
    { type: 'bill', label: '₱1,000 bill', cents: 100000, icon: '💵' },
    { type: 'bill', label: '₱500 bill', cents: 50000, icon: '💵' },
    { type: 'bill', label: '₱200 bill', cents: 20000, icon: '💵' },
    { type: 'bill', label: '₱100 bill', cents: 10000, icon: '💵' },
    { type: 'bill', label: '₱50 bill', cents: 5000, icon: '💵' },
    { type: 'bill', label: '₱20 bill', cents: 2000, icon: '💵' },
    { type: 'coin', label: '₱10 coin', cents: 1000, icon: '🪙' },
    { type: 'coin', label: '₱5 coin', cents: 500, icon: '🪙' },
    { type: 'coin', label: '₱1 coin', cents: 100, icon: '🪙' },
    { type: 'coin', label: '25¢ coin', cents: 25, icon: '🪙' },
  ];

  function calcChangeBreakdown(cents) {
    if (!cents || cents <= 0) return [];
    let rem = cents;
    const res = [];
    for (const d of DENOM_BREAKDOWN) {
      if (rem >= d.cents) {
        const count = Math.floor(rem / d.cents);
        rem %= d.cents;
        res.push({ ...d, count });
      }
    }
    return res;
  }

  function renderChangeBreakdown(changeCents) {
    if (!el.changeBreakdownWrapper) return;
    if (changeCents <= 0) {
      el.changeBreakdownWrapper.hidden = true;
      if (el.shortChangeBanner) el.shortChangeBanner.hidden = true;
      return;
    }
    const list = calcChangeBreakdown(changeCents);
    if (!list.length) {
      el.changeBreakdownWrapper.hidden = true;
      if (el.shortChangeBanner) el.shortChangeBanner.hidden = true;
      return;
    }
    el.changeBreakdownChips.innerHTML = list.map((b) =>
      '<span class="breakdown-chip ' + b.type + '">' + b.icon + ' ' + b.count + ' × ' + b.label + '</span>'
    ).join('');
    el.changeBreakdownWrapper.hidden = false;
    if (el.shortChangeBanner) el.shortChangeBanner.hidden = false;
  }

  function updateChange() {
    const total = totalCents();
    const cash = parseCash(el.payCash.value);
    el.changeBox.classList.remove('short', 'ok');
    el.payError.hidden = true;
    if (Number.isNaN(cash)) {
      el.changeLabel.textContent = 'Invalid amount';
      el.changeAmount.textContent = '—';
      el.changeBox.classList.add('short');
      el.payConfirm.disabled = true;
      renderChangeBreakdown(0);
    } else if (cash === null) {
      el.changeLabel.textContent = 'Change (exact payment)';
      el.changeAmount.textContent = peso(0);
      el.payConfirm.disabled = false;
      renderChangeBreakdown(0);
    } else if (cash < total) {
      el.changeLabel.textContent = 'Remaining amount due';
      el.changeAmount.textContent = peso(total - cash);
      el.changeBox.classList.add('short');
      el.payConfirm.disabled = true;
      renderChangeBreakdown(0);
    } else {
      const change = cash - total;
      el.changeLabel.textContent = 'Change';
      el.changeAmount.textContent = peso(change);
      el.changeBox.classList.add('ok');
      el.payConfirm.disabled = false;
      renderChangeBreakdown(change);
    }
  }

  async function openPay() {
    if (!cart.length || !el.payModal.hidden) return;
    el.payBtn.disabled = true;
    await refreshCart();
    el.payBtn.disabled = !cart.length;
    if (!cart.length) return;

    el.payStep.hidden = false;
    el.doneStep.hidden = true;
    if (el.posReplenishPanel) el.posReplenishPanel.hidden = true;
    if (el.shortChangeBanner) el.shortChangeBanner.hidden = true;
    if (el.changeBreakdownWrapper) el.changeBreakdownWrapper.hidden = true;
    el.payTotal.textContent = peso(totalCents());
    el.payCount.textContent = pieces() + ' units · ' + cart.length + ' items';
    el.payCash.value = '';
    el.quickCash.innerHTML = '<button type="button" class="btn" data-cash="exact">Exact</button>' +
      quickAmounts(totalCents()).map((b) =>
        '<button type="button" class="btn" data-cash="' + b + '">₱' + b.toLocaleString('en-PH') + '</button>').join('');
    updateChange();
    openModal(el.payModal);
  }

  el.payBtn.addEventListener('click', openPay);
  el.payCash.addEventListener('input', updateChange);
  el.payCash.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); if (!el.payConfirm.disabled) confirmPay(); }
  });
  el.quickCash.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-cash]');
    if (!btn) return;
    el.payCash.value = btn.dataset.cash === 'exact' ? (totalCents() / 100).toFixed(2) : btn.dataset.cash;
    updateChange();
    el.payCash.focus();
  });

  // Short on change replenishment actions inside checkout
  if (el.posAddChangeBtn) {
    el.posAddChangeBtn.addEventListener('click', () => {
      if (!el.posReplenishPanel) return;
      el.posReplenishPanel.hidden = !el.posReplenishPanel.hidden;
      if (!el.posReplenishPanel.hidden && el.posRepAmount) el.posRepAmount.focus();
    });
  }

  if (el.posReplenishClose) {
    el.posReplenishClose.addEventListener('click', () => {
      if (el.posReplenishPanel) el.posReplenishPanel.hidden = true;
    });
  }

  document.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-pos-add]');
    if (!chip || !el.posRepAmount) return;
    const addVal = Number(chip.dataset.posAdd);
    const curr = parseCash(el.posRepAmount.value) || 0;
    el.posRepAmount.value = ((curr + addVal * 100) / 100).toFixed(2);
    el.posRepAmount.focus();
  });

  if (el.posRepSubmit) {
    el.posRepSubmit.addEventListener('click', async () => {
      const amtCents = parseCash(el.posRepAmount.value);
      if (!amtCents || amtCents <= 0) {
        Sound.error();
        toast('Please enter a valid replenishment amount.', 'error');
        return;
      }
      const catRadio = document.querySelector('input[name="pos-rep-type"]:checked');
      const category = catRadio ? catRadio.value : 'coins';
      const catLabel = category === 'coins' ? 'Coins' : category === 'bills' ? 'Paper Bills' : 'Mixed';
      try {
        await api.post('/api/drawer/movements', {
          kind: 'add_change',
          category,
          amount: amtCents / 100,
          note: 'Replenished during checkout for customer change',
        });
        Sound.ok();
        toast('Added ' + peso(amtCents) + ' (' + catLabel + ') to cash drawer!', 'ok');
        el.posRepAmount.value = '';
        if (el.posReplenishPanel) el.posReplenishPanel.hidden = true;
      } catch (err) {
        Sound.error();
        toast(err.message, 'error');
      }
    });
  }

  async function confirmPay() {
    if (paying || !cart.length) return;
    paying = true;
    el.payConfirm.disabled = true;
    el.payError.hidden = true;
    const cashText = el.payCash.value.trim();
    try {
      const res = await api.post('/api/sales/checkout', {
        items: cart.map((i) => ({ product_id: i.id, qty: i.qty })),
        cash: cashText === '' ? null : cashText.replace(/[₱,\s]/g, ''),
      });
      const sale = res.sale;
      Sound.ok();
      el.doneReceipt.textContent = 'Receipt #' + sale.id;
      el.doneTotal.textContent = peso(sale.total_cents);
      el.doneChange.textContent = peso(sale.change_cents);
      el.payStep.hidden = true;
      el.doneStep.hidden = false;
      cart = [];
      save();
      render();
      el.lastScan.hidden = true;
      setTimeout(() => el.newSale.focus(), 50);
    } catch (e) {
      Sound.error();
      el.payError.textContent = e.message;
      el.payError.hidden = false;
      if (e.code === 'insufficient_stock' || e.code === 'unknown_product') {
        await refreshCart();
        el.payTotal.textContent = peso(totalCents());
        if (!cart.length) closeModal(el.payModal);
      }
      updateChange();
      el.payError.hidden = false;
    } finally {
      paying = false;
    }
  }

  el.payConfirm.addEventListener('click', confirmPay);
  el.newSale.addEventListener('click', () => { closeModal(el.payModal); refocus(); });

  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-close-modal]')) setTimeout(refocus, 0);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'F2') { e.preventDefault(); openPay(); }
  });

  // ---------- Simula ----------
  load();
  render();
  refreshCart();

  initCameraPanel((code) => addByCode(code));
  POS.listenUsbScanner((code) => addByCode(code));
  if (HAS_MOUSE) el.scanInput.focus();
})();
