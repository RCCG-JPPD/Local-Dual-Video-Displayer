/**
 * Lyric OCR engine.
 *
 * Reads a rectangle of one physical screen (the lyrics software's output) on a
 * timer, recognises the text, and reports the handful of lines that actually
 * changed. Runs entirely in the main process:
 *
 *  - `desktopCapturer` is a main-process API, and cropping with `nativeImage`
 *    here means only the small lyric region is ever handed to Tesseract;
 *  - tesseract.js's node build runs recognition on a `worker_threads` worker,
 *    so a slow read cannot stutter the camera screen's compositor;
 *  - a renderer would have to load the wasm over `file://` under
 *    contextIsolation, which is exactly the fragile path this avoids.
 *
 * Everything decision-shaped lives in the pure helpers in src/utils/ocr.js and
 * is unit-tested there; this file is deliberately thin plumbing around them.
 */

const path = require('path');
const { regionToPixels, cleanOcrText, reduceOcr, normalizeOcr, EMPTY_OCR_STATE } = require('../utils/ocr');

// Language data we ship, so the app reads lyrics with no network at all.
// tesseract.js would otherwise fetch the model from a CDN on first use, which
// is not something to discover at a concert.
const TESSDATA_DIR = path.join(__dirname, '..', 'vendor', 'tessdata');

/**
 * Rewrite a path that points inside app.asar to its unpacked twin.
 *
 * The Tesseract worker script, its wasm and the language data are all read by
 * plain filesystem calls that do not understand asar, so package.json unpacks
 * them and this maps the resolved paths across. A no-op in development.
 */
function unpacked(p) {
  return typeof p === 'string' ? p.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1') : p;
}

class OcrEngine {
  /**
   * @param {{onText: function(string): void, onStatus: function(object): void}} callbacks
   */
  constructor({ onText, onStatus } = {}) {
    this.onText = onText || (() => {});
    this.onStatus = onStatus || (() => {});

    this.cfg = normalizeOcr(null);
    this.worker = null;
    this.workerPromise = null;
    this.timer = null;
    this.running = false;
    this.busy = false; // re-entrancy guard: never stack reads
    this.state = EMPTY_OCR_STATE;
    this.last = { text: '', confidence: 0, at: 0, error: '' };
  }

  /** What the controller's tuning readout shows. */
  getState() {
    return {
      running: this.running,
      lastText: this.last.text,
      lastConfidence: this.last.confidence,
      lastAt: this.last.at,
      error: this.last.error,
      outputToScreen: this.cfg.outputToScreen,
    };
  }

  _report(patch = {}) {
    this.last = { ...this.last, ...patch };
    this.onStatus(this.getState());
  }

  /**
   * Create the Tesseract worker, once.
   *
   * `langPath` + `gzip: false` point at the model we ship; `cacheMethod: 'none'`
   * stops tesseract.js writing a copy back into the app directory, which is
   * read-only inside a packaged build.
   */
  async _getWorker() {
    if (this.worker) return this.worker;
    if (this.workerPromise) return this.workerPromise;

    this.workerPromise = (async () => {
      const { createWorker } = require('tesseract.js');
      const corePath = unpacked(path.dirname(require.resolve('tesseract.js-core/package.json')));
      const workerPath = unpacked(require.resolve('tesseract.js/src/worker-script/node/index.js'));

      const worker = await createWorker('eng', 1, {
        workerPath,
        corePath,
        langPath: unpacked(TESSDATA_DIR),
        gzip: false,        // we ship the model uncompressed
        cacheMethod: 'none',
        logger: () => {},
      });
      await worker.setParameters({ tessedit_pageseg_mode: String(this.cfg.psm) });
      this.worker = worker;
      this.workerPromise = null;
      return worker;
    })().catch((err) => {
      this.workerPromise = null;
      throw err;
    });

    return this.workerPromise;
  }

  /** Start (or restart) the read loop. */
  start(settings) {
    this.cfg = normalizeOcr(settings);
    if (this.running) {
      this._report({ error: '' });
      return;
    }
    this.running = true;
    this.state = EMPTY_OCR_STATE;
    this._report({ error: '' });
    this._schedule(0);
  }

  /** Stop reading and release the Tesseract worker. */
  stop() {
    this.running = false;
    clearTimeout(this.timer);
    this.timer = null;
    const worker = this.worker;
    this.worker = null;
    if (worker) Promise.resolve(worker.terminate()).catch(() => {});
    this._report({ error: '' });
  }

  /**
   * Apply new settings without dropping the loop.
   * A changed page-seg mode has to reach the live worker, not just the config.
   */
  update(settings) {
    const next = normalizeOcr(settings);
    const psmChanged = next.psm !== this.cfg.psm;
    this.cfg = next;
    if (psmChanged && this.worker) {
      Promise.resolve(this.worker.setParameters({ tessedit_pageseg_mode: String(next.psm) }))
        .catch(() => {});
    }
    if (next.enabled && !this.running) this.start(next);
    if (!next.enabled && this.running) this.stop();
    this._report({});
  }

  /**
   * Read the region once and report it, without starting the loop or touching
   * what is on screen. This is how the operator aims the region during setup.
   */
  async readOnce(settings) {
    if (settings) this.cfg = normalizeOcr(settings);
    try {
      const { text, confidence } = await this._read();
      this._report({ text, confidence, at: Date.now(), error: '' });
      return { text, confidence };
    } catch (err) {
      this._report({ error: describeOcrError(err), at: Date.now() });
      return { text: '', confidence: 0 };
    }
  }

  /**
   * Chain the next read with setTimeout rather than setInterval, so the
   * interval is measured BETWEEN reads. With setInterval a read slower than
   * the interval would queue up behind itself and fall further behind forever.
   */
  _schedule(delay) {
    clearTimeout(this.timer);
    if (!this.running) return;
    this.timer = setTimeout(() => this._tick(), Math.max(0, delay));
  }

  async _tick() {
    if (!this.running) return;
    if (this.busy) { this._schedule(this.cfg.intervalMs); return; }

    this.busy = true;
    try {
      const { text, confidence } = await this._read();
      const { state, emit } = reduceOcr(this.state, { text, confidence }, this.cfg);
      this.state = state;
      this._report({ text, confidence, at: Date.now(), error: '' });
      // `emit === null` means nothing changed - leave the caption alone. An
      // empty string is a real instruction to clear it.
      if (emit !== null && this.cfg.outputToScreen) this.onText(emit);
    } catch (err) {
      // A failed read must never kill the loop: a screen can be briefly
      // unavailable (locked, resolution change, display asleep) and recover.
      this._report({ error: describeOcrError(err), at: Date.now() });
    } finally {
      this.busy = false;
      this._schedule(this.cfg.intervalMs);
    }
  }

  /** Capture the configured screen, crop to the region, and recognise it. */
  async _read() {
    const { desktopCapturer, screen } = require('electron');

    // Capture at the source screen's own resolution: lyric text needs the
    // pixels, and a downscaled thumbnail is what makes OCR guess.
    const target = this.cfg.displayId === null
      ? screen.getPrimaryDisplay()
      : screen.getAllDisplays().find(d => d.id === this.cfg.displayId);
    if (!target) throw new Error('The screen chosen for lyrics is no longer connected.');

    const thumbnailSize = {
      width: Math.round(target.size.width),
      height: Math.round(target.size.height),
    };
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize });
    const source = sources.find(s => Number(s.display_id) === target.id) || sources[0];
    if (!source) throw new Error('No screen could be captured. Check screen-recording permission.');

    const image = source.thumbnail;
    if (image.isEmpty()) throw new Error('The screen capture came back empty.');

    const crop = image.crop(regionToPixels(this.cfg.region, image.getSize()));
    const worker = await this._getWorker();
    const { data } = await worker.recognize(crop.toPNG());

    return {
      text: cleanOcrText(data.text, this.cfg.maxChars),
      confidence: Number.isFinite(Number(data.confidence)) ? Number(data.confidence) : 0,
    };
  }
}

/** Turn an engine failure into something an operator can act on. */
function describeOcrError(err) {
  const msg = (err && err.message) || String(err);
  if (/permission|denied|TCC/i.test(msg)) {
    return 'Screen recording permission is required to read lyrics.';
  }
  if (/ENOENT|traineddata/i.test(msg)) {
    return 'Language data missing — reinstall the app.';
  }
  return msg;
}

module.exports = OcrEngine;
// Exported for unit tests: both are pure, and `unpacked` in particular only
// ever misbehaves inside a packaged app, where it is hardest to notice.
module.exports.unpacked = unpacked;
module.exports.describeOcrError = describeOcrError;
