import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ref, onValue, push, set, remove, onDisconnect, serverTimestamp,
} from 'firebase/database';
import { db, ensureAuth } from './firebase';
import {
  ACTIONS, normalizeSessionCode, isValidSessionCode, parseSessionParam,
} from './remote';
import './App.css';

const LS_KEY = 'remote.lastCode';

function fmt(t) {
  const s = Number(t);
  if (!Number.isFinite(s) || s <= 0) return '00:00';
  const m = Math.floor(s / 60).toString().padStart(2, '0');
  const sec = Math.floor(s % 60).toString().padStart(2, '0');
  return `${m}:${sec}`;
}

/**
 * Range slider that tracks the finger locally and only sends when released,
 * so dragging doesn't flood the command channel.
 */
function Slider({ label, value, step = 0.01, min = 0, max = 1, format, onCommit }) {
  const [local, setLocal] = useState(value);
  const [dragging, setDragging] = useState(false);
  useEffect(() => { if (!dragging) setLocal(value); }, [value, dragging]);
  const commit = () => { setDragging(false); onCommit(Number(local)); };
  return (
    <div className="slider-row">
      <span className="lbl">{label}</span>
      <input
        type="range" min={min} max={max} step={step} value={local}
        onChange={(e) => { setDragging(true); setLocal(e.target.value); }}
        onPointerUp={commit}
        onTouchEnd={commit}
        onKeyUp={commit}
      />
      {format && <span className="val">{format(Number(local))}</span>}
    </div>
  );
}

// Zoom presets, mirroring src/utils/zoom.js on the desktop.
const ZOOM_PRESETS = {
  fit: { mode: 'contain', scale: 1 },
  fill: { mode: 'cover', scale: 1 },
  native: { mode: 'native', scale: 1 },
};
const DEFAULT_ZOOM = ZOOM_PRESETS.fit;

/**
 * Zoom controls for one screen: Fit / Fill / 100% presets plus a scale slider.
 * `hasFill` is false for YouTube — that screen is a webview the desktop can only
 * transform-scale, so the mode half of a zoom has no meaning there.
 */
function ZoomControls({ zoom, hasFill = true, onChange }) {
  const z = (zoom && typeof zoom === 'object') ? zoom : DEFAULT_ZOOM;
  const mode = z.mode || DEFAULT_ZOOM.mode;
  const scale = Number.isFinite(Number(z.scale)) ? Number(z.scale) : 1;
  const keys = hasFill ? ['fit', 'fill', 'native'] : ['fit'];
  const labels = { fit: 'Fit', fill: 'Fill', native: '100%' };
  const isOn = (k) => mode === ZOOM_PRESETS[k].mode && scale === ZOOM_PRESETS[k].scale;
  return (
    <>
      <div className="row">
        {keys.map((k) => (
          <button
            key={k}
            className={`btn ${isOn(k) ? 'btn-primary' : ''}`}
            onClick={() => onChange(ZOOM_PRESETS[k])}
          >
            {labels[k]}
          </button>
        ))}
      </div>
      <Slider
        label="🔍" min={0.5} max={3} step={0.05} value={scale}
        format={(f) => `${Math.round(f * 100)}%`}
        onCommit={(f) => onChange({ mode, scale: f })}
      />
    </>
  );
}

export default function App() {
  const [code, setCode] = useState(null);      // active session once connected
  const [input, setInput] = useState('');       // code-entry field
  const [phase, setPhase] = useState('enter');  // enter | connecting | connected | invalid
  const [state, setState] = useState(null);     // live snapshot from the desktop
  const [error, setError] = useState('');
  const [slideNum, setSlideNum] = useState(''); // jump-to-slide field
  const [ytInput, setYtInput] = useState('');   // YouTube link field
  const [webInput, setWebInput] = useState(''); // web address field
  const cleanupRef = useRef(null);

  const teardown = useCallback(() => {
    if (cleanupRef.current) { cleanupRef.current(); cleanupRef.current = null; }
  }, []);

  const connect = useCallback(async (raw) => {
    const c = normalizeSessionCode(raw);
    if (!isValidSessionCode(c)) {
      setError('Enter the 6-character code shown on the presentation.');
      return;
    }
    setError('');
    setPhase('connecting');
    try {
      await ensureAuth();
    } catch (e) {
      setError('Could not sign in: ' + e.message);
      setPhase('enter');
      return;
    }

    teardown();
    const metaRef = ref(db, `sessions/${c}/meta`);
    const stateRef = ref(db, `sessions/${c}/state`);
    const deviceRef = push(ref(db, `sessions/${c}/devices`));

    let joined = false;
    const offMeta = onValue(
      metaRef,
      (snap) => {
        const meta = snap.val();
        if (!meta || !meta.active) {
          setState(null);
          setPhase('invalid');
          setError(joined
            ? 'Remote Mode is off on the presentation — you\'ll reconnect automatically when it\'s turned back on.'
            : "That code isn't active — check the presentation screen.");
          return;
        }
        // (Re)join. Also fires when the desktop re-enables Remote Mode with
        // the same per-run code (e.g. after changing displays): the phone
        // reconnects automatically instead of staying on the ended screen.
        joined = true;
        setCode(c);
        setError('');
        setPhase('connected');
        try { localStorage.setItem(LS_KEY, c); } catch (_) {}
        set(deviceRef, { joinedAt: serverTimestamp() }).catch(() => {});
        onDisconnect(deviceRef).remove(); // auto-clear presence if phone drops
      },
      (err) => { setError('Connection error: ' + err.message); setPhase('enter'); },
    );

    const offState = onValue(stateRef, (snap) => setState(snap.val()));

    cleanupRef.current = () => {
      offMeta();
      offState();
      try { remove(deviceRef); } catch (_) {}
    };
  }, [teardown]);

  // On first load: sign in, then auto-connect from ?s=CODE or offer the last code.
  useEffect(() => {
    ensureAuth().catch((e) => setError('Could not sign in: ' + e.message));
    const fromUrl = parseSessionParam(window.location.search);
    let last = null;
    try { last = localStorage.getItem(LS_KEY); } catch (_) {}
    if (fromUrl) { setInput(fromUrl); connect(fromUrl); }
    else if (last) { setInput(last); }
    return () => teardown();
  }, [connect, teardown]);

  const disconnect = useCallback(() => {
    teardown();
    setCode(null);
    setState(null);
    setError('');
    setPhase('enter');
  }, [teardown]);

  const send = useCallback((action, value) => {
    if (!code) return;
    const cmdRef = push(ref(db, `sessions/${code}/commands`));
    set(cmdRef, { action, value: value == null ? null : value, ts: serverTimestamp() }).catch(() => {});
    if (navigator.vibrate) navigator.vibrate(10);
  }, [code]);

  // ── Entry / connecting / invalid screens ──
  if (phase !== 'connected') {
    const busy = phase === 'connecting';
    return (
      <div className="screen">
        <div className="card enter-card">
          <div className="brand">📺 Presentation Remote</div>
          <p className="sub">
            {phase === 'invalid'
              ? (error || 'Session unavailable.')
              : 'Enter the code shown on the presentation, or scan its QR code.'}
          </p>
          <input
            className="code-input"
            value={input}
            onChange={(e) => setInput(normalizeSessionCode(e.target.value))}
            onKeyDown={(e) => { if (e.key === 'Enter') connect(input); }}
            placeholder="ABC123"
            inputMode="text"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            maxLength={6}
            disabled={busy}
          />
          {error && phase !== 'invalid' && <div className="err">{error}</div>}
          <button className="btn btn-primary big" onClick={() => connect(input)} disabled={busy}>
            {busy ? 'Connecting…' : 'Connect'}
          </button>
        </div>
      </div>
    );
  }

  // ── Connected: live state + full controls ──
  const s = state || {};
  const activePanel = s.activePanel || 'previews';
  const pres = s.presentation || { index: 0, total: 0 };
  const slide = s.slideshow || { index: 0, total: 0, playing: false, zoom: DEFAULT_ZOOM };
  const video = s.video || {
    playing: false, index: -1, playlistLength: 0, title: '',
    currentTime: 0, duration: 0, volume: 1, zoom: DEFAULT_ZOOM, playlist: [],
  };
  const yt = s.youtube || { url: '', muted: false, volume: 1, zoom: DEFAULT_ZOOM };
  const web = s.web || { url: '' };
  const excel = s.excel || { sheets: [], active: 0 };
  const camera = s.camera || { live: false, visible: true, zoom: DEFAULT_ZOOM };
  const ocr = s.ocr || { running: false, lastText: '' };
  const playlist = Array.isArray(video.playlist) ? video.playlist : [];
  const sheets = Array.isArray(excel.sheets) ? excel.sheets : [];

  // Older desktops don't publish roles — then show every section.
  const show = (k) => !s.roles || !!s.roles[k];
  const isActive = (panel) => activePanel === panel;

  const goSlide = () => {
    const n = parseInt(slideNum, 10);
    if (Number.isFinite(n) && n >= 1 && n <= pres.total) {
      send(ACTIONS.presGoto, n - 1);
      setSlideNum('');
    }
  };
  const loadYt = () => {
    const v = ytInput.trim();
    if (v) { send(ACTIONS.ytLoad, v); setYtInput(''); }
  };
  const goWeb = () => {
    const v = webInput.trim();
    if (v) { send(ACTIONS.webLoad, v); setWebInput(''); }
  };

  return (
    <div className="screen connected">
      <header className="topbar">
        <span className="dot" /> Connected · <strong>{code}</strong>
        <button className="btn btn-ghost link" onClick={disconnect}>Disconnect</button>
      </header>

      <div className="statusline">
        {activePanel === 'presentation' && (
          <>📽️ {pres.total ? `Slide ${pres.index + 1} / ${pres.total}` : 'No slides loaded'}</>
        )}
        {activePanel === 'slideshow' && (
          <>🖼️ {slide.total ? `Image ${slide.index + 1} / ${slide.total}` : 'No slideshow'} · {slide.playing ? 'Playing' : 'Paused'}</>
        )}
        {activePanel === 'localvideo' && (
          <>🎬 {video.title || 'No video'} · {fmt(video.currentTime)} / {fmt(video.duration)} · {video.playing ? 'Playing' : 'Paused'}</>
        )}
        {activePanel === 'youtube' && <>▶️ {yt.url || 'YouTube'}</>}
        {activePanel === 'web' && <>🌐 {web.url || 'Web page'}</>}
        {activePanel === 'excel' && <>📊 {sheets[excel.active] || 'Spreadsheet'}</>}
        {activePanel === 'camera' && (
          <>📷 {camera.live ? 'Camera ON AIR' : 'Camera off'}{ocr.running ? ' · reading lyrics' : ''}</>
        )}
        {!['presentation', 'slideshow', 'localvideo', 'youtube', 'web', 'excel', 'camera'].includes(activePanel) && (
          <>On screen: {activePanel}</>
        )}
      </div>

      {show('camera') && (
        <section className={`group ${isActive('camera') ? 'active-group' : ''}`}>
          <h3>📷 Camera</h3>
          <div className="row">
            <button className="btn big" onClick={() => send(ACTIONS.camLive)}>
              {camera.live ? '⏹ Camera off' : '▶ Camera on air'}
            </button>
            <button className="btn big" onClick={() => send(ACTIONS.camReset)}>🚨 Clear screen</button>
          </div>
          <div className="row">
            <button className="btn" onClick={() => send(ACTIONS.ocrOn)} disabled={ocr.running}>
              ▶ Lyrics on
            </button>
            <button className="btn" onClick={() => send(ACTIONS.ocrOff)} disabled={!ocr.running}>
              ⏹ Lyrics off
            </button>
          </div>
          {ocr.lastText && <div className="statusline">🎤 {ocr.lastText}</div>}
          <ZoomControls zoom={camera.zoom} onChange={(z) => send(ACTIONS.camZoom, z)} />
        </section>
      )}

      {show('presentation') && (
        <section className={`group ${isActive('presentation') ? 'active-group' : ''}`}>
          <h3>📽️ Slides</h3>
          <div className="row">
            <button className="btn big" onClick={() => send(ACTIONS.presPrev)}>◀ Prev</button>
            <button className="btn big" onClick={() => send(ACTIONS.presBlank)}>⬛ Blank</button>
            <button className="btn big" onClick={() => send(ACTIONS.presNext)}>Next ▶</button>
          </div>
          {pres.total > 1 && (
            <div className="field">
              <input
                className="text-input num-input"
                type="number" inputMode="numeric" min="1" max={pres.total}
                placeholder="#" value={slideNum}
                onChange={(e) => setSlideNum(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') goSlide(); }}
              />
              <button className="btn" onClick={goSlide}>Go to slide (1–{pres.total})</button>
            </div>
          )}
        </section>
      )}

      {show('slideshow') && (
        <section className={`group ${isActive('slideshow') ? 'active-group' : ''}`}>
          <h3>🖼️ Slideshow</h3>
          <div className="row">
            <button className="btn big" onClick={() => send(ACTIONS.slidePrev)}>◀ Prev</button>
            <button className="btn big" onClick={() => send(ACTIONS.slidePlayPause)}>⏯ Play/Pause</button>
            <button className="btn big" onClick={() => send(ACTIONS.slideNext)}>Next ▶</button>
          </div>
          <ZoomControls zoom={slide.zoom} onChange={(z) => send(ACTIONS.slideZoom, z)} />
        </section>
      )}

      {show('video') && (
        <section className={`group ${isActive('localvideo') ? 'active-group' : ''}`}>
          <h3>🎬 Video</h3>
          {playlist.length > 0 && (
            <div className="field">
              <select
                className="select"
                value={video.index >= 0 ? video.index : ''}
                onChange={(e) => send(ACTIONS.videoGoto, Number(e.target.value))}
              >
                <option value="" disabled>Choose a video…</option>
                {playlist.map((t, i) => <option key={i} value={i}>{t}</option>)}
              </select>
            </div>
          )}
          <div className="row">
            <button className="btn big" onClick={() => send(ACTIONS.videoPrev)}>⏮ Prev</button>
            <button className="btn big" onClick={() => send(ACTIONS.videoPlayPause)}>⏯ Play/Pause</button>
            <button className="btn big" onClick={() => send(ACTIONS.videoNext)}>Next ⏭</button>
          </div>
          <div className="row">
            <button className="btn" onClick={() => send(ACTIONS.videoStop)}>⏹ Stop</button>
          </div>
          {video.duration > 0 && (
            <Slider
              label="⏱" step={0.001}
              value={video.duration ? video.currentTime / video.duration : 0}
              format={(f) => `${fmt(f * video.duration)} / ${fmt(video.duration)}`}
              onCommit={(f) => send(ACTIONS.videoSeek, f)}
            />
          )}
          <Slider
            label="🔊"
            value={Number.isFinite(Number(video.volume)) ? Number(video.volume) : 1}
            format={(f) => `${Math.round(f * 100)}%`}
            onCommit={(f) => send(ACTIONS.videoVolume, f)}
          />
          <ZoomControls zoom={video.zoom} onChange={(z) => send(ACTIONS.videoZoom, z)} />
        </section>
      )}

      {show('youtube') && (
        <section className={`group ${isActive('youtube') ? 'active-group' : ''}`}>
          <h3>▶️ YouTube</h3>
          <div className="field">
            <input
              className="text-input"
              placeholder={yt.url || 'YouTube link or video ID'}
              value={ytInput}
              onChange={(e) => setYtInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') loadYt(); }}
              autoCapitalize="off" autoCorrect="off" spellCheck={false}
            />
            <button className="btn" onClick={loadYt}>Load</button>
          </div>
          <div className="row">
            <button className="btn big" onClick={() => send(ACTIONS.ytPlay)}>▶ Play</button>
            <button className="btn big" onClick={() => send(ACTIONS.ytPause)}>⏸ Pause</button>
            <button className="btn big" onClick={() => send(ACTIONS.ytMute)}>
              {yt.muted ? '🔈 Unmute' : '🔇 Mute'}
            </button>
          </div>
          <Slider
            label="🔊"
            value={Number.isFinite(Number(yt.volume)) ? Number(yt.volume) : 1}
            format={(f) => `${Math.round(f * 100)}%`}
            onCommit={(f) => send(ACTIONS.ytVolume, f)}
          />
          <ZoomControls zoom={yt.zoom} hasFill={false} onChange={(z) => send(ACTIONS.ytZoom, z)} />
        </section>
      )}

      {show('web') && (
        <section className={`group ${isActive('web') ? 'active-group' : ''}`}>
          <h3>🌐 Web Page</h3>
          <div className="field">
            <input
              className="text-input"
              placeholder={web.url || 'example.com'}
              value={webInput}
              onChange={(e) => setWebInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') goWeb(); }}
              inputMode="url" autoCapitalize="off" autoCorrect="off" spellCheck={false}
            />
            <button className="btn" onClick={goWeb}>Go</button>
          </div>
          <div className="row">
            <button className="btn" onClick={() => send(ACTIONS.webBack)}>◀ Back</button>
            <button className="btn" onClick={() => send(ACTIONS.webReload)}>⟳ Reload</button>
            <button className="btn" onClick={() => send(ACTIONS.webFwd)}>Fwd ▶</button>
          </div>
        </section>
      )}

      {show('excel') && sheets.length > 1 && (
        <section className={`group ${isActive('excel') ? 'active-group' : ''}`}>
          <h3>📊 Spreadsheet</h3>
          <div className="field">
            <select
              className="select"
              value={excel.active || 0}
              onChange={(e) => send(ACTIONS.excelSheet, Number(e.target.value))}
            >
              {sheets.map((n, i) => <option key={i} value={i}>{n}</option>)}
            </select>
          </div>
        </section>
      )}

      <footer className="foot">Codes give full control while active. Keep this code private.</footer>
    </div>
  );
}
