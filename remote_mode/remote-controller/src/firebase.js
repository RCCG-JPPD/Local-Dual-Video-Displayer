/**
 * Firebase init for the remote controller web app.
 * Uses Realtime Database (control channel) + anonymous auth.
 *
 * NOTE: keep `databaseURL` in sync with the Realtime Database instance in the
 * Firebase console and with the desktop app (src/vendor/firebase/config.js).
 * The `apiKey` is a public client identifier, not a secret — access is gated by
 * the database security rules + the unguessable session code.
 */
import { initializeApp } from 'firebase/app';
import { getDatabase } from 'firebase/database';
import { getAuth, signInAnonymously } from 'firebase/auth';

const firebaseConfig = {
  apiKey: 'AIzaSyD5K4Sz8GnpQR7CAGjmJAQOyKipcJQ29qI',
  authDomain: 'multi-displayer.firebaseapp.com',
  databaseURL: 'https://multi-displayer-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'multi-displayer',
  storageBucket: 'multi-displayer.firebasestorage.app',
  messagingSenderId: '1061169524977',
  appId: '1:1061169524977:web:9ecda535502c028b00f950',
  measurementId: 'G-X4BVKED9N6',
};

const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
export const auth = getAuth(app);
export const ensureAuth = () => signInAnonymously(auth);
export default app;
