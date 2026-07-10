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

export default function App() {
  const [code, setCode] = useState(null);      // active session once connected
  const [input, setInput] = useState('');       // code-entry field
  const [phase, setPhase] = useState('enter');  // enter | connecting | connected | invalid
  const [state, setState] = useState(null);     // live snapshot from the desktop
  const [error, setError] = useState('');
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

  // ── Connected: live state + controls ──
  const s = state || {};
  const activePanel = s.activePanel || 'previews';
  const pres = s.presentation || { index: 0, total: 0 };
  const slide = s.slideshow || { index: 0, total: 0, playing: false };
  const video = s.video || { playing: false, index: -1, playlistLength: 0, title: '', currentTime: 0, duration: 0 };

  const isActive = (panel) => activePanel === panel;

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
        {!['presentation', 'slideshow', 'localvideo'].includes(activePanel) && (
          <>On screen: {activePanel}</>
        )}
      </div>

      <section className={`group ${isActive('presentation') ? 'active-group' : ''}`}>
        <h3>📽️ Slides</h3>
        <div className="row">
          <button className="btn big" onClick={() => send(ACTIONS.presPrev)}>◀ Prev</button>
          <button className="btn big" onClick={() => send(ACTIONS.presBlank)}>⬛ Blank</button>
          <button className="btn big" onClick={() => send(ACTIONS.presNext)}>Next ▶</button>
        </div>
      </section>

      <section className={`group ${isActive('slideshow') ? 'active-group' : ''}`}>
        <h3>🖼️ Slideshow</h3>
        <div className="row">
          <button className="btn big" onClick={() => send(ACTIONS.slidePrev)}>◀ Prev</button>
          <button className="btn big" onClick={() => send(ACTIONS.slidePlayPause)}>⏯ Play/Pause</button>
          <button className="btn big" onClick={() => send(ACTIONS.slideNext)}>Next ▶</button>
        </div>
      </section>

      <section className={`group ${isActive('localvideo') ? 'active-group' : ''}`}>
        <h3>🎬 Video</h3>
        <div className="row">
          <button className="btn big" onClick={() => send(ACTIONS.videoPrev)}>⏮ Prev</button>
          <button className="btn big" onClick={() => send(ACTIONS.videoPlayPause)}>⏯ Play/Pause</button>
          <button className="btn big" onClick={() => send(ACTIONS.videoNext)}>Next ⏭</button>
        </div>
        <div className="row">
          <button className="btn" onClick={() => send(ACTIONS.videoStop)}>⏹ Stop</button>
        </div>
      </section>

      <footer className="foot">Codes give full control while active. Keep this code private.</footer>
    </div>
  );
}
