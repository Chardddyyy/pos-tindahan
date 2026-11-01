/* Camera barcode scanner.

   Paano tinitiyak na tama ang basa (accuracy):
   1. Native BarcodeDetector ng browser ang gamit kung meron (Chrome sa Android) -
      mas mabilis at mas tumpak kaysa sa JavaScript decoder.
   2. Mga barcode lang ng tindahan ang binabasa (EAN/UPC/Code128/Code39) kaya
      walang "multo" na basa mula sa ibang pattern.
   3. CHECK DIGIT: ang mga EAN-13/EAN-8/UPC ay may check digit. Kapag mali, itinatapon ang basa.
   4. CONFIRMATION: kailangang pareho ang basa nang 2 magkasunod na frame (3 para sa
      Code128/39 na walang check digit) bago tanggapin.
   5. Isang beses lang bibilangin ang isang scan: kailangang ilayo muna ang item sa
      camera (o magpalit ng item) bago mabilang ulit. Hindi tuloy-tuloy ang dagdag.
   6. HD (1280x720) at tuloy-tuloy na autofocus; may torch (flashlight) kung kaya ng phone.
   7. May tunog at vibrate sa bawat tanggap na scan.
*/
(function (global) {
  'use strict';

  const { Barcode, Sound, $ } = global.POS;

  const CONFIRM_NUMERIC = 2;     // bilang ng magkasunod na parehong basa (may check digit)
  const CONFIRM_TEXT = 3;        // para sa Code128/Code39 na walang check digit
  const CONFIRM_WINDOW_MS = 900; // pinakamatagal na pagitan ng magkasunod na basa
  const REARM_GAP_MS = 700;      // gaano katagal mawala sa camera bago pwedeng bilangin ulit

  class CameraScanner {
    constructor(opts) {
      this.readerId = opts.readerId;
      this.onScan = opts.onScan;
      this.onStatus = opts.onStatus || function () {};
      this.html5 = null;
      this.running = false;
      this.torch = null;
      this._pending = null;       // { code, count, lastAt }
      this._locked = null;        // { code, lastAt } - nabilang na at nasa harap pa ng camera
      this._lastBadStatusAt = 0;
    }

    static async listCameras() {
      try { return await Html5Qrcode.getCameras(); } catch (e) { return []; }
    }

    async start(deviceId) {
      if (this.running) return;
      if (!global.isSecureContext) throw new CameraError('insecure');
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new CameraError('unsupported');
      }

      const F = Html5QrcodeSupportedFormats;
      this.html5 = new Html5Qrcode(this.readerId, {
        formatsToSupport: [F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E, F.CODE_128, F.CODE_39],
        useBarCodeDetectorIfSupported: true,
        verbose: false,
      });

      const video = { width: { ideal: 1280 }, height: { ideal: 720 },
                      advanced: [{ focusMode: 'continuous' }] };
      if (deviceId) video.deviceId = { exact: deviceId };
      else video.facingMode = { ideal: 'environment' };

      this._pending = null;
      this._locked = null;

      try {
        await this.html5.start(
          { facingMode: 'environment' },
          {
            fps: 15,
            videoConstraints: video,
            // malapad na kahon: mas madaling basahin ang mahabang barcode
            qrbox: (w, h) => ({ width: Math.floor(w * 0.92), height: Math.floor(Math.max(h * 0.45, 80)) }),
            disableFlip: true,
          },
          (text) => this._handleRead(text),
          () => {} // walang nabasa sa frame na ito - normal
        );
      } catch (err) {
        this.html5 = null;
        throw CameraError.from(err);
      }

      this.running = true;
      this._setupTorch();
      try { await this.html5.applyVideoConstraints({ advanced: [{ focusMode: 'continuous' }] }); }
      catch (e) { /* hindi suportado ng phone - ok lang */ }
    }

    async stop() {
      if (!this.html5) return;
      const h = this.html5;
      this.html5 = null;
      this.running = false;
      this.torch = null;
      try { await h.stop(); } catch (e) { /* tapos na */ }
      try { h.clear(); } catch (e) { /* ok */ }
    }

    _setupTorch() {
      try {
        const t = this.html5.getRunningTrackCameraCapabilities().torchFeature();
        this.torch = t && t.isSupported() ? t : null;
      } catch (e) { this.torch = null; }
    }

    get hasTorch() { return !!this.torch; }

    async toggleTorch() {
      if (!this.torch) return false;
      const next = !this.torch.value();
      await this.torch.apply(next);
      return next;
    }

    /** Pinoproseso ang bawat basa ng camera. */
    _handleRead(text) {
      const now = performance.now();
      const cleaned = Barcode.clean(text);
      if (!cleaned) return;

      const code = Barcode.normalize(cleaned);
      if (code === null) {
        // Mali ang check digit = maling basa. Huwag tanggapin.
        this._pending = null;
        if (now - this._lastBadStatusAt > 1500) {
          this._lastBadStatusAt = now;
          this.onStatus('Hindi malinaw ang basa. Ilapit nang konti at itapat nang diretso.', 'warn');
        }
        return;
      }

      // Nabilang na ito at nasa harap pa rin ng camera -> huwag bilangin ulit
      if (this._locked && this._locked.code === code) {
        if (now - this._locked.lastAt <= REARM_GAP_MS) {
          this._locked.lastAt = now;
          return;
        }
        this._locked = null; // nawala sandali, pwede nang bilangin ulit
      }

      // Confirmation: kailangan ng magkasunod na parehong basa
      const needed = Barcode.isNumeric(cleaned) ? CONFIRM_NUMERIC : CONFIRM_TEXT;
      if (this._pending && this._pending.code === code && now - this._pending.lastAt <= CONFIRM_WINDOW_MS) {
        this._pending.count += 1;
        this._pending.lastAt = now;
      } else {
        this._pending = { code, count: 1, lastAt: now };
      }
      if (this._pending.count < needed) return;

      this._pending = null;
      this._locked = { code, lastAt: now };
      Sound.ok();
      this.onScan(code);
    }
  }

  class CameraError extends Error {
    constructor(kind, original) {
      super(kind);
      this.kind = kind;
      this.original = original;
    }
    static from(err) {
      const name = (err && (err.name || '')) + ' ' + (typeof err === 'string' ? err : (err && err.message) || '');
      if (/NotAllowed|Permission/i.test(name)) return new CameraError('denied', err);
      if (/NotFound|DevicesNotFound|Requested device not found/i.test(name)) return new CameraError('notfound', err);
      if (/NotReadable|TrackStart|in use/i.test(name)) return new CameraError('busy', err);
      return new CameraError('other', err);
    }
    get friendly() {
      switch (this.kind) {
        case 'insecure':
          return 'Camera requires an "https://" connection or localhost. Run: python run.py --https to access camera from mobile devices.';
        case 'unsupported': return 'Camera is not supported on this browser. Please use Google Chrome.';
        case 'denied': return 'Camera permission denied. Tap the lock icon in the address bar > Permissions > Camera > Allow, then try again.';
        case 'notfound': return 'No camera found on this device.';
        case 'busy': return 'Camera is currently in use by another application. Please close other apps and try again.';
        default: return 'Could not open camera. Please refresh the page and try again.';
      }
    }
  }

  /**
   * Wire camera panel (templates/_camera.html) to CameraScanner.
   * Returns { scanner, flash(ok|bad), setStatus, open, close }.
   */
  function initCameraPanel(onScan) {
    const toggle = $('#cam-toggle');
    const select = $('#cam-select');
    const torchBtn = $('#cam-torch');
    const wrap = $('#reader-wrap');
    const flashEl = $('#reader-flash');
    const statusEl = $('#cam-status');
    const IDLE = 'Camera is off. You can also use a USB barcode scanner or type the barcode.';

    function setStatus(msg, kind) {
      statusEl.textContent = msg;
      statusEl.className = 'cam-status ' + (kind || 'muted');
    }

    function flash(kind) {
      flashEl.className = 'reader-flash ' + kind;
      setTimeout(() => { flashEl.className = 'reader-flash'; }, 350);
    }

    const scanner = new CameraScanner({
      readerId: 'reader',
      onScan: (code) => { flash('ok'); onScan(code); },
      onStatus: setStatus,
    });

    function remembered() {
      try { return localStorage.getItem('pos_camera') || ''; } catch (e) { return ''; }
    }
    function remember(id) {
      try { localStorage.setItem('pos_camera', id || ''); } catch (e) { /* ok */ }
    }

    async function open() {
      toggle.disabled = true;
      setStatus('Starting camera...', 'muted');
      wrap.hidden = false;
      try {
        let id = select.value || remembered() || undefined;
        try { await scanner.start(id); }
        catch (e) {
          if (id && e.kind === 'notfound') { remember(''); await scanner.start(undefined); }
          else throw e;
        }
        const cams = await CameraScanner.listCameras();
        if (cams.length > 1) {
          select.innerHTML = cams.map((c, i) =>
            '<option value="' + POS.esc(c.id) + '">' + POS.esc(c.label || ('Camera ' + (i + 1))) + '</option>').join('');
          const current = scanner.html5.getRunningTrackSettings().deviceId;
          if (current) select.value = current;
          select.hidden = false;
        }
        torchBtn.hidden = !scanner.hasTorch;
        toggle.textContent = 'Close Camera';
        toggle.classList.remove('primary');
        setStatus('Ready. Align barcode within the box.', 'ok');
      } catch (e) {
        wrap.hidden = true;
        setStatus(e.friendly || 'Could not open camera.', 'error');
        POS.Sound.error();
      } finally {
        toggle.disabled = false;
      }
    }

    async function close() {
      await scanner.stop();
      wrap.hidden = true;
      torchBtn.hidden = true;
      toggle.textContent = 'Start Camera';
      toggle.classList.add('primary');
      setStatus(IDLE, 'muted');
    }

    toggle.addEventListener('click', () => (scanner.running ? close() : open()));

    select.addEventListener('change', async () => {
      remember(select.value);
      await scanner.stop();
      await open();
    });

    torchBtn.addEventListener('click', async () => {
      try {
        const on = await scanner.toggleTorch();
        torchBtn.classList.toggle('active', on);
      } catch (e) { POS.toast('Flashlight could not be toggled.', 'error'); }
    });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden && scanner.running) close();
    });
    window.addEventListener('pagehide', () => { if (scanner.running) scanner.stop(); });

    setStatus(IDLE, 'muted');
    return { scanner, flash, setStatus, open, close };
  }


  global.CameraScanner = CameraScanner;
  global.initCameraPanel = initCameraPanel;
})(window);
