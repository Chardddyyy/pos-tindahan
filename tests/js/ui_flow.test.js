/* Buong pagsubok ng mga pahina gamit ang jsdom at totoong server:
   stock in -> benta -> bawas ng stock -> imbentaryo -> ulat -> void.
   Patakbuhin: node ui_flow.test.js   (kailangan ng jsdom at python3) */
const assert = require('assert');
const path = require('path');
const { spawn } = require('child_process');
const { JSDOM } = require('jsdom');

const PORT = 5077;
const BASE = 'http://127.0.0.1:' + PORT;
const COKE = '4800016644801';
const NOODLES = '4800361019613';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, what, timeout = 4000) {
  const start = Date.now();
  for (;;) {
    let value;
    try { value = fn(); } catch (e) { value = null; }
    if (value) return value;
    if (Date.now() - start > timeout) throw new Error('Natapos ang oras habang hinihintay: ' + what);
    await sleep(25);
  }
}

async function openPage(url) {
  const dom = await JSDOM.fromURL(BASE + url, {
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    beforeParse(win) {
      win.fetch = (u, o) => fetch(new URL(u, win.location.href), o);
      win.confirm = () => true;
      win.__errors = [];
      win.addEventListener('error', (e) => win.__errors.push(e.message));
    },
  });
  const win = dom.window;
  if (win.document.readyState !== 'complete') await new Promise((r) => win.addEventListener('load', r));
  await sleep(150);
  return win;
}

function type(win, selector, value) {
  const input = win.document.querySelector(selector);
  input.value = value;
  input.dispatchEvent(new win.Event('input', { bubbles: true }));
  input.dispatchEvent(new win.Event('change', { bubbles: true }));
}
function press(win, selector, key) {
  win.document.querySelector(selector).dispatchEvent(
    new win.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}
function click(win, selector) { win.document.querySelector(selector).click(); }
const text = (win, selector) => win.document.querySelector(selector).textContent.trim();
const api = async (url, opts) => (await fetch(BASE + url, opts)).json();

async function main() {
  const server = spawn('python3', [path.join(__dirname, 'serve_test_app.py'), String(PORT)], { stdio: 'inherit' });
  try {
    await waitFor(async () => true, 'start');
    for (let i = 0; i < 100; i++) {
      try { await fetch(BASE + '/api/products'); break; } catch (e) { await sleep(100); }
    }

    // ---------- 1. MAG-STOCK ----------
    console.log('Mag-stock');
    let win = await openPage('/stock-in');
    assert.strictEqual(win.__errors.length, 0, 'May JS error: ' + win.__errors.join(' | '));

    type(win, '#f-barcode', COKE);
    press(win, '#f-barcode', 'Enter');
    await waitFor(() => text(win, '#item-status').startsWith('Bagong item'), 'status bagong item');
    console.log('  ok  bagong barcode = "Bagong item"');

    type(win, '#f-name', 'Coke 1.5L');
    type(win, '#f-cost', '50');
    type(win, '#f-markup', '20');
    type(win, '#f-qty', '10');
    await waitFor(() => text(win, '#c-price') === '₱60.00', 'presyo ng benta');
    assert.strictEqual(text(win, '#c-total-cost'), '₱500.00');
    assert.strictEqual(text(win, '#c-total-sales'), '₱600.00');
    assert.strictEqual(text(win, '#c-total-profit'), '₱100.00');
    console.log('  ok  lumabas ang presyo ₱60, puhunan ₱500, benta ₱600, kita ₱100');

    win.document.querySelector('#stock-form').dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));
    await waitFor(() => win.document.querySelectorAll('#recent-list li').length === 1, 'recent list');
    assert.strictEqual(win.document.querySelector('#f-barcode').value, '', 'nag-reset ang form');
    let p = (await api('/api/products/by-barcode/' + COKE)).product;
    assert.strictEqual(p.stock, 10);
    assert.strictEqual(p.price_cents, 6000);
    console.log('  ok  derecho sa stock: 10 piraso, presyo ₱60');

    // pangalawang item
    type(win, '#f-barcode', NOODLES);
    press(win, '#f-barcode', 'Enter');
    await waitFor(() => text(win, '#item-status').startsWith('Bagong item'), 'status 2');
    type(win, '#f-name', 'Lucky Me Pancit Canton');
    type(win, '#f-cost', '9.50');
    type(win, '#f-qty', '20');
    await waitFor(() => text(win, '#c-price') === '₱12.00', 'presyo 12');
    win.document.querySelector('#stock-form').dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));
    await waitFor(() => win.document.querySelectorAll('#recent-list li').length === 2, 'recent 2');

    // re-scan ng kilalang item: na-prefill + dagdag na isa kapag ni-scan ulit
    type(win, '#f-barcode', COKE);
    press(win, '#f-barcode', 'Enter');
    await waitFor(() => text(win, '#item-status').startsWith('Nasa listahan na'), 'kilalang item');
    assert.strictEqual(win.document.querySelector('#f-cost').value, '50.00');
    assert.strictEqual(win.document.querySelector('#f-name').value, 'Coke 1.5L');
    type(win, '#f-barcode', COKE);
    press(win, '#f-barcode', 'Enter');
    await waitFor(() => win.document.querySelector('#f-qty').value === '2', 'qty 2 sa re-scan');
    console.log('  ok  kilalang item: na-prefill; re-scan = +1 sa dami');

    // maling barcode
    type(win, '#f-barcode', '4800016644802');
    press(win, '#f-barcode', 'Enter');
    await waitFor(() => text(win, '#item-status').startsWith('Mali ang pagkabasa'), 'mali ang barcode');
    console.log('  ok  maling barcode ay tinanggihan');
    win.close();

    // ---------- 2. BENTA ----------
    console.log('Benta');
    win = await openPage('/');
    assert.strictEqual(win.__errors.length, 0, 'May JS error: ' + win.__errors.join(' | '));
    assert.ok(win.document.querySelector('#pay-btn').disabled);

    async function scan(code) {
      type(win, '#scan-input', code);
      win.document.querySelector('#scan-form').dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));
      await sleep(120);
    }

    await scan(COKE);
    await waitFor(() => text(win, '#last-price') === '₱60.00', 'huling na-scan');
    console.log('  ok  na-scan ang Coke: lumabas ang presyo ₱60.00');
    await scan(COKE);
    await scan(COKE);                                   // 3 beses i-scan = 3 piraso
    await waitFor(() => win.document.querySelector('.cart-item input').value === '3', 'qty 3');
    assert.strictEqual(win.document.querySelectorAll('.cart-item').length, 1);
    await scan(NOODLES);
    await waitFor(() => win.document.querySelectorAll('.cart-item').length === 2, '2 item');
    // i-type ang dami ng pancit canton: 5
    const qtyInput = win.document.querySelectorAll('.cart-item input')[1];
    qtyInput.value = '5';
    qtyInput.dispatchEvent(new win.Event('change', { bubbles: true }));
    await waitFor(() => text(win, '#cart-total') === '₱240.00', 'total 240');   // 3*60 + 5*12
    console.log('  ok  3 beses na scan + 5 na tinype: total ₱240.00 (3×60 + 5×12)');

    // hindi pwedeng lampas sa stock
    const qty2 = win.document.querySelectorAll('.cart-item input')[1];
    qty2.value = '999';
    qty2.dispatchEvent(new win.Event('change', { bubbles: true }));
    await waitFor(() => win.document.querySelectorAll('.cart-item input')[1].value === '20', 'hanggang stock');
    qty2.value = '5';
    win.document.querySelectorAll('.cart-item input')[1].value = '5';
    win.document.querySelectorAll('.cart-item input')[1].dispatchEvent(new win.Event('change', { bubbles: true }));
    await waitFor(() => text(win, '#cart-total') === '₱240.00', 'balik sa 240');
    console.log('  ok  hindi nalalampasan ang stock (999 -> 20)');

    // hindi pa naka-stock
    await scan('4800016644825');
    await waitFor(() => text(win, '#last-name') === 'Item Not Registered', 'hindi pa nasa listahan');
    console.log('  ok  barcode na wala sa stock ay may babala');

    // bayad
    click(win, '#pay-btn');
    await waitFor(() => !win.document.querySelector('#pay-modal').hidden, 'bayad modal');
    assert.strictEqual(text(win, '#pay-total'), '₱240.00');
    type(win, '#pay-cash', '200');
    assert.ok(win.document.querySelector('#pay-confirm').disabled, 'kulang ang bayad');
    assert.strictEqual(text(win, '#change-label'), 'Remaining amount due');
    type(win, '#pay-cash', '500');
    assert.strictEqual(text(win, '#change-amount'), '₱260.00');
    click(win, '#pay-confirm');
    await waitFor(() => !win.document.querySelector('#done-step').hidden, 'tapos na');
    assert.strictEqual(text(win, '#done-total'), '₱240.00');
    assert.strictEqual(text(win, '#done-change'), '₱260.00');

    assert.strictEqual(win.document.querySelectorAll('.cart-item').length, 0, 'nalinis ang bilihan');
    console.log('  ok  bayad ₱500: sukli ₱260.00, nalinis ang bilihan');

    p = (await api('/api/products/by-barcode/' + COKE)).product;
    const n = (await api('/api/products/by-barcode/' + NOODLES)).product;
    assert.strictEqual(p.stock, 7, 'Coke: 10 - 3');
    assert.strictEqual(n.stock, 15, 'Pancit Canton: 20 - 5');
    console.log('  ok  nabawasan ang stock: Coke 10 -> 7, Pancit Canton 20 -> 15');
    win.close();

    // ---------- 3. IMBENTARYO ----------
    console.log('Imbentaryo');
    win = await openPage('/inventory');
    assert.strictEqual(win.__errors.length, 0, 'May JS error: ' + win.__errors.join(' | '));
    await waitFor(() => win.document.querySelectorAll('#inv-body tr').length === 2, '2 row');
    assert.strictEqual(text(win, '#t-pieces'), '22');
    assert.strictEqual(text(win, '#t-items'), '2');
    console.log('  ok  2 item, 22 piraso ang natira');

    win.document.querySelector('#inv-body tr [data-act="adjust"]').click();
    await waitFor(() => !win.document.querySelector('#adjust-modal').hidden, 'adjust modal');
    type(win, '#a-stock', '0');
    win.document.querySelector('#adjust-form').dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));
    await waitFor(() => win.document.querySelector('#t-out').textContent === '1', 'ubos na = 1');
    console.log('  ok  naitama ang stock sa 0, lumabas sa "Ubos na"');

    win.document.querySelector('#inv-body tr [data-act="edit"]').click();
    await waitFor(() => !win.document.querySelector('#edit-modal').hidden, 'edit modal');
    type(win, '#e-markup', '30');
    await waitFor(() => win.document.querySelector('#e-price').value === '65.00', 'presyo = 50 + 30%');
    win.document.querySelector('#edit-form').dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));
    await waitFor(() => win.document.querySelector('#edit-modal').hidden, 'sarado ang edit');
    const edited = (await api('/api/products?q=coke')).products[0];
    assert.strictEqual(edited.markup_pct, 30);
    assert.strictEqual(edited.price_cents, 6500, 'na-save ang bagong presyo');
    console.log('  ok  binago ang kita% 20 -> 30: presyo ₱60 -> ₱65 (na-save sa database)');
    win.close();

    // ---------- 4. ULAT ----------
    console.log('Ulat');
    win = await openPage('/reports');
    assert.strictEqual(win.__errors.length, 0, 'May JS error: ' + win.__errors.join(' | '));
    await waitFor(() => text(win, '#r-sales') === '₱240.00', 'benta ngayon');
    assert.strictEqual(text(win, '#r-cost'), '₱197.50');      // 3*50 + 5*9.50
    assert.strictEqual(text(win, '#r-profit'), '₱42.50');
    assert.strictEqual(win.document.querySelectorAll('#sales-list .sale').length, 1);
    console.log('  ok  benta ₱240.00, puhunan ₱197.50, kita ₱42.50');

    win.document.querySelector('[data-act="void"]').click();
    await waitFor(() => text(win, '#r-sales') === '₱0.00', 'na-void');
    await waitFor(() => text(win, '#r-void') === '1', 'bilang ng void');
    // Ang Coke ay itinama sa 0 sa Imbentaryo; ang na-void na 3 piraso ay bumalik -> 3
    const after = (await api('/api/products?q=coke')).products[0];
    assert.strictEqual(after.stock, 3, 'bumalik ang 3 pirasong na-void');
    const noodles = (await api('/api/products?q=pancit')).products[0];
    assert.strictEqual(noodles.stock, 20, 'bumalik ang 5 pirasong pancit canton (15 -> 20)');
    console.log('  ok  na-void ang benta at bumalik ang stock (Coke 0 -> 3, Pancit Canton 15 -> 20)');
    win.close();

    console.log('\nPasado ang buong daloy ng UI.');
  } finally {
    server.kill();
  }
}

main().then(() => process.exit(process.exitCode || 0)).catch((e) => {
  console.error('\nFAIL:', e.message);
  process.exit(1);
});
