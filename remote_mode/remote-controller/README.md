# Presentation Remote (web/phone controller)

Mobile web app that pairs with the desktop **RCCG Display Controller** and lets a
phone or browser drive a presentation over Firebase. The operator enables Remote
Mode in the desktop app, which shows a QR code + 6-character session code; a
device scans the QR (deep link) or types the code here to take control.

Built with Create React App. Backend channel is Firebase **Realtime Database**
(project `multi-displayer`) with anonymous auth.

## How it works

```
Desktop controller  <——Realtime Database——>  This web app (phone/browser)
  writes  /sessions/{CODE}/state             reads  state, pushes commands
  reads   /sessions/{CODE}/commands          writes /sessions/{CODE}/commands, /devices
```

Session node (auto-removed via `onDisconnect` when the desktop drops):

```
/sessions/{CODE}
  meta:     { createdAt, active }
  state:    { activePanel, presentation:{index,total}, slideshow:{…}, video:{…}, updatedAt }
  commands/{pushId}: { action, value, ts }   // consumed + deleted by the desktop
  devices/{pushId}:  { joinedAt }            // presence (connected-device count)
```

Command actions and the session-code contract live in `src/remote.js` and must
match the desktop app's `src/utils/remote.js`.

## One-time Firebase setup (project `multi-displayer`)

1. **Realtime Database** → create a database. Copy its URL (region-specific) into
   `src/firebase.js` **and** the desktop app's `src/vendor/firebase/config.js`
   (`databaseURL`). The default US form is `https://multi-displayer-default-rtdb.firebaseio.com`.
2. **Authentication → Sign-in method** → enable **Anonymous**.
3. Install the CLI once: `npm i -g firebase-tools` and `firebase login`.

## Develop

```
npm install
npm start          # http://localhost:3000  (add ?s=CODE to auto-connect)
```

## Build & deploy (Firebase Hosting + database rules)

```
npm run build
firebase deploy    # hosting + database rules, uses .firebaserc (multi-displayer)
```

After deploy the app is live at `https://multi-displayer.web.app` — the URL the
desktop QR code points to.

## Security

`database.rules.json` denies listing `/sessions` and only allows read/write to
`/sessions/{CODE}` for authenticated (anonymous) users. Security rests on the
unguessable session code + the short-lived session (deleted when the desktop
disconnects). The Firebase web `apiKey` is a public client identifier, not a
secret.
