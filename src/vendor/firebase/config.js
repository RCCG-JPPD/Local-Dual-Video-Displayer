/**
 * Firebase project config for Remote Mode, exposed as a browser global so the
 * controller renderer (context-isolated, no `require`) can read it after the
 * vendored compat <script> tags load. Matches remote_mode/remote-controller/firebase.js.
 *
 * NOTE: `databaseURL` must match the Realtime Database instance created in the
 * Firebase console. The value below is the default (us-central1) form. If the DB
 * was created in another region, replace it with the URL shown in the console,
 * e.g. https://multi-displayer-default-rtdb.europe-west1.firebasedatabase.app
 *
 * The web `apiKey` is a public client identifier, not a secret — access is gated
 * by the Realtime Database security rules + the unguessable session code.
 */
window.FIREBASE_CONFIG = {
  apiKey: 'AIzaSyD5K4Sz8GnpQR7CAGjmJAQOyKipcJQ29qI',
  authDomain: 'multi-displayer.firebaseapp.com',
  databaseURL: 'https://multi-displayer-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'multi-displayer',
  storageBucket: 'multi-displayer.firebasestorage.app',
  messagingSenderId: '1061169524977',
  appId: '1:1061169524977:web:9ecda535502c028b00f950',
  measurementId: 'G-X4BVKED9N6',
};
