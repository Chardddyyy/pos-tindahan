/* Sinusubok ang lohika ng camera scanner (walang totoong camera):
   - check digit / UPC-A / UPC-E
   - confirmation ng magkasunod na basa
   - hindi pagbibilang nang paulit-ulit habang nasa harap pa ang item
   Patakbuhin: node scanner_logic.test.js   (kailangan ng jsdom: npm install) */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const JS_DIR = path.join(__dirname, '..', '..', 'app', 'static', 'js');

function makeWindow() {
  const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only', url: 'http://localhost/' });
  const win = dom.window;
  let t = 0;
  Object.defineProperty(win, 'performance', { value: { now: () => t }, configurable: true });
  win.__setTime = (ms) => { t = ms; };
  // pekeng library ng camera (hindi ginagamit sa test na ito)
  win.Html5Qrcode = function () {};
  win.Html5QrcodeSupportedFormats = { EAN_13: 0, EAN_8: 1, UPC_A: 2, UPC_E: 3, CODE_128: 4, CODE_39: 5 };
  win.eval(fs.readFileSync(path.join(JS_DIR, 'common.js'), 'utf8'));
  win.eval(fs.readFileSync(path.join(JS_DIR, 'scanner.js'), 'utf8'));
  return win;
}

let passed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log('  ok  ' + name); }
  catch (e) { console.error('  FAIL ' + name + '\n', e); process.exitCode = 1; }
}

const win = makeWindow();
const { Barcode } = win.POS;

console.log('Barcode');
test('tamang EAN-13 at EAN-8', () => {
  assert.strictEqual(Barcode.normalize('4800016644801'), '4800016644801');
  assert.strictEqual(Barcode.normalize('96385074'), '96385074');
});
test('maling check digit = null', () => {
  assert.strictEqual(Barcode.normalize('4800016644802'), null);
  assert.strictEqual(Barcode.normalize('96385075'), null);
});
test('UPC-A at UPC-E ay nagiging EAN-13 (kapareho ng server)', () => {
  assert.strictEqual(Barcode.normalize('036000291452'), '0036000291452');
  assert.strictEqual(Barcode.normalize('04252614'), '0042100005264');
  assert.strictEqual(Barcode.normalize('042100005264'), '0042100005264');
});
test('Code128/39 text ay pinapayagan, may space ay nililinis', () => {
  assert.strictEqual(Barcode.normalize(' TINAPAY-1\n'), 'TINAPAY-1');
  assert.strictEqual(Barcode.normalize('   '), null);
});

console.log('Camera confirmation');
function scannerWith(win) {
  const scans = [];
  const s = new win.CameraScanner({ readerId: 'reader', onScan: (c) => scans.push(c), onStatus: () => {} });
  return { s, scans };
}
const COKE = '4800016644801';
const NOODLES = '4800361019613';

test('isang basa lang ay hindi tinatanggap', () => {
  const w = makeWindow(); const { s, scans } = scannerWith(w);
  w.__setTime(0); s._handleRead(COKE);
  assert.deepStrictEqual(scans, []);
});
test('dalawang magkasunod na pareho = isang scan', () => {
  const w = makeWindow(); const { s, scans } = scannerWith(w);
  w.__setTime(0); s._handleRead(COKE);
  w.__setTime(70); s._handleRead(COKE);
  assert.deepStrictEqual(scans, [COKE]);
});
test('nasa harap pa ng camera nang matagal = isang beses lang', () => {
  const w = makeWindow(); const { s, scans } = scannerWith(w);
  for (let t = 0; t <= 5000; t += 70) { w.__setTime(t); s._handleRead(COKE); }
  assert.deepStrictEqual(scans, [COKE]);
});
test('inilayo at ibinalik ang parehong item = bibilangin ulit', () => {
  const w = makeWindow(); const { s, scans } = scannerWith(w);
  w.__setTime(0); s._handleRead(COKE); w.__setTime(70); s._handleRead(COKE);
  // 1 segundong walang basa, tapos bumalik
  w.__setTime(1200); s._handleRead(COKE); w.__setTime(1270); s._handleRead(COKE);
  assert.deepStrictEqual(scans, [COKE, COKE]);
});
test('nagpalit ng item = bibilangin agad ang bago', () => {
  const w = makeWindow(); const { s, scans } = scannerWith(w);
  w.__setTime(0); s._handleRead(COKE); w.__setTime(70); s._handleRead(COKE);
  w.__setTime(200); s._handleRead(NOODLES); w.__setTime(270); s._handleRead(NOODLES);
  assert.deepStrictEqual(scans, [COKE, NOODLES]);
});
test('maling basa (mali ang check digit) ay hindi kailanman tinatanggap', () => {
  const w = makeWindow(); const { s, scans } = scannerWith(w);
  for (let t = 0; t < 2000; t += 70) { w.__setTime(t); s._handleRead('4800016644802'); }
  assert.deepStrictEqual(scans, []);
});
test('salitan ng magkaibang basa (A,B,A,B) ay hindi tinatanggap', () => {
  const w = makeWindow(); const { s, scans } = scannerWith(w);
  [COKE, NOODLES, COKE, NOODLES, COKE].forEach((c, i) => { w.__setTime(i * 70); s._handleRead(c); });
  assert.deepStrictEqual(scans, []);
});
test('maling basa sa pagitan ay sumisira sa confirmation', () => {
  const w = makeWindow(); const { s, scans } = scannerWith(w);
  w.__setTime(0); s._handleRead(COKE);
  w.__setTime(70); s._handleRead('4800016644802');   // maling basa
  w.__setTime(140); s._handleRead(COKE);
  assert.deepStrictEqual(scans, []);
  w.__setTime(210); s._handleRead(COKE);
  assert.deepStrictEqual(scans, [COKE]);
});
test('Code128 (walang check digit) ay kailangan ng 3 magkasunod', () => {
  const w = makeWindow(); const { s, scans } = scannerWith(w);
  w.__setTime(0); s._handleRead('TINAPAY1');
  w.__setTime(70); s._handleRead('TINAPAY1');
  assert.deepStrictEqual(scans, []);
  w.__setTime(140); s._handleRead('TINAPAY1');
  assert.deepStrictEqual(scans, ['TINAPAY1']);
});
test('UPC-A na nabasa ay dumarating bilang EAN-13', () => {
  const w = makeWindow(); const { s, scans } = scannerWith(w);
  w.__setTime(0); s._handleRead('036000291452'); w.__setTime(70); s._handleRead('036000291452');
  assert.deepStrictEqual(scans, ['0036000291452']);
});
test('mabagal na magkasunod (lampas 900ms) ay hindi pinagsasama', () => {
  const w = makeWindow(); const { s, scans } = scannerWith(w);
  w.__setTime(0); s._handleRead(COKE); w.__setTime(1500); s._handleRead(COKE);
  assert.deepStrictEqual(scans, []);
});

console.log('\n' + passed + ' test ang pasado');
