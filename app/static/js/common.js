/* Shared utilities for all pages: API, currency, audio, toast, barcode validation, USB scanner. */
(function (global) {
  'use strict';

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  // ---------- Currency and text ----------
  function peso(cents) {
    const n = Number(cents || 0) / 100;
    return '₱' + n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  function todayStr() {
    const d = new Date();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }

  // ---------- API ----------
  class ApiError extends Error {
    constructor(message, status, code, details) {
      super(message);
      this.status = status;
      this.code = code;
      this.details = details;
    }
  }

  async function request(method, url, body) {
    let res;
    try {
      res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (e) {
      throw new ApiError('No connection to POS server. Is the server running and connected?', 0, 'network');
    }
    let data = null;
    try { data = await res.json(); } catch (e) { /* no JSON */ }
    if (!res.ok || !data || data.ok === false) {
      throw new ApiError(
        (data && data.error) || 'Something went wrong. Please try again.',
        res.status, data && data.code, data && data.details
      );
    }
    return data;
  }


  const api = {
    get: (url) => request('GET', url),
    post: (url, body) => request('POST', url, body || {}),
    patch: (url, body) => request('PATCH', url, body || {}),
    del: (url) => request('DELETE', url),
  };

  // ---------- Barcode (kapareho ng app/barcode.py) ----------
  const Barcode = {
    clean(raw) {
      return String(raw == null ? '' : raw).replace(/[^\x21-\x7E]/g, '');
    },

    isNumeric(code) { return /^\d+$/.test(code); },

    checkDigit(digits) {
      const body = digits.slice(0, -1);
      let total = 0;
      for (let i = 0; i < body.length; i++) {
        const digit = Number(body[body.length - 1 - i]);
        total += digit * (i % 2 === 0 ? 3 : 1);
      }
      return (10 - (total % 10)) % 10;
    },

    validChecksum(digits) {
      return Number(digits[digits.length - 1]) === Barcode.checkDigit(digits);
    },

    upceToUpca(u) {
      const ns = u[0], d = u.slice(1, 7), check = u[7], last = d[5];
      let body;
      if ('012'.includes(last)) body = ns + d.slice(0, 2) + last + '0000' + d.slice(2, 5);
      else if (last === '3') body = ns + d.slice(0, 3) + '00000' + d.slice(3, 5);
      else if (last === '4') body = ns + d.slice(0, 4) + '00000' + d[4];
      else body = ns + d.slice(0, 5) + '0000' + last;
      return body + check;
    },

    /**
     * Ibinabalik ang malinis na barcode, o null kung mali ang pagkabasa.
     * UPC-A / UPC-E ay ginagawang EAN-13 (parehong patakaran sa server).
     */
    normalize(raw) {
      const code = Barcode.clean(raw);
      if (!code) return null;
      if (!Barcode.isNumeric(code)) return code.length <= 64 ? code : null;
      if (code.length === 12) {
        const ean = '0' + code;
        return Barcode.validChecksum(ean) ? ean : null;
      }
      if (code.length === 13) return Barcode.validChecksum(code) ? code : null;
      if (code.length === 8) {
        if (Barcode.validChecksum(code)) return code;
        if ('01'.includes(code[0])) {
          const ean = '0' + Barcode.upceToUpca(code);
          if (Barcode.validChecksum(ean)) return ean;
        }
        return null;
      }
      return code; // ibang haba (sariling label ng tindahan)
    },
  };

  // ---------- Toast ----------
  function toast(message, kind) {
    let box = $('#toasts');
    if (!box) {
      box = document.createElement('div');
      box.id = 'toasts';
      box.setAttribute('aria-live', 'polite');
      document.body.appendChild(box);
    }
    const el = document.createElement('div');
    el.className = 'toast ' + (kind || 'info');
    el.textContent = message;
    box.appendChild(el);
    while (box.children.length > 3) box.removeChild(box.firstChild);
    setTimeout(() => {
      el.classList.add('hide');
      setTimeout(() => el.remove(), 300);
    }, kind === 'error' ? 4500 : 2500);
  }

  // ---------- Tunog at vibrate ----------
  const Sound = (function () {
    let ctx = null;
    function context() {
      if (!ctx) {
        const AC = global.AudioContext || global.webkitAudioContext;
        if (!AC) return null;
        try { ctx = new AC(); } catch (e) { return null; }
      }
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    }
    function tone(freq, start, length, volume) {
      const c = context();
      if (!c) return;
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = 'square';
      osc.frequency.value = freq;
      gain.gain.value = volume;
      osc.connect(gain);
      gain.connect(c.destination);
      osc.start(c.currentTime + start);
      osc.stop(c.currentTime + start + length);
    }
    return {
      unlock() { context(); },
      ok() { tone(1800, 0, 0.09, 0.12); if (navigator.vibrate) navigator.vibrate(50); },
      error() {
        tone(300, 0, 0.14, 0.15);
        tone(220, 0.16, 0.2, 0.15);
        if (navigator.vibrate) navigator.vibrate([120, 60, 120]);
      },
    };
  })();
  document.addEventListener('click', () => Sound.unlock(), { once: true });

  // ---------- Modal (walang <dialog> para gumana sa lumang cellphone) ----------
  function openModal(el) {
    el.hidden = false;
    document.body.classList.add('modal-open');
    const first = el.querySelector('[data-autofocus]') || el.querySelector('input, button');
    if (first) setTimeout(() => first.focus(), 30);
  }
  function closeModal(el) {
    el.hidden = true;
    if (!$$('.modal').some((m) => !m.hidden)) document.body.classList.remove('modal-open');
  }
  document.addEventListener('click', (e) => {
    const closer = e.target.closest('[data-close-modal]');
    if (closer) closeModal(closer.closest('.modal'));
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') $$('.modal').forEach((m) => { if (!m.hidden) closeModal(m); });
  });

  // ---------- USB / Bluetooth barcode scanner ----------
  /* Ang USB scanner ay parang keyboard: mabilis na tina-type ang barcode at Enter.
     Kapag may naka-focus na input, ang input mismo ang humahawak.
     Dito, sinasalo ang scan kapag WALANG naka-focus na input. */
  function listenUsbScanner(onScan) {
    let buffer = '';
    let lastKeyAt = 0;
    document.addEventListener('keydown', (e) => {
      const t = e.target;
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' ||
                           t.tagName === 'SELECT' || t.isContentEditable);
      if (typing || e.ctrlKey || e.altKey || e.metaKey) return;
      const now = Date.now();
      if (now - lastKeyAt > 80) buffer = '';
      lastKeyAt = now;
      if (e.key === 'Enter') {
        if (buffer.length >= 4) { e.preventDefault(); const code = buffer; buffer = ''; onScan(code); }
        buffer = '';
      } else if (e.key.length === 1) {
        buffer += e.key;
      }
    });
  }

  global.POS = { $, $$, peso, esc, todayStr, api, ApiError, Barcode, toast, Sound,
                 openModal, closeModal, listenUsbScanner };
})(window);
