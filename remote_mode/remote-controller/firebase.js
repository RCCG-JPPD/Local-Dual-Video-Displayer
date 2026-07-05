// ⚠️ The app's actual Firebase init lives in src/firebase.js — Create React App
// only allows imports from inside src/, so this root file is kept for reference /
// the Firebase console snippet only. Edit src/firebase.js to change behavior.
//
// Remote Mode uses the Realtime Database (control channel) + anonymous auth,
// not Analytics.
export const firebaseConfig = {
  apiKey: 'AIzaSyD5K4Sz8GnpQR7CAGjmJAQOyKipcJQ29qI',
  authDomain: 'multi-displayer.firebaseapp.com',
  databaseURL: 'https://multi-displayer-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'multi-displayer',
  storageBucket: 'multi-displayer.firebasestorage.app',
  messagingSenderId: '1061169524977',
  appId: '1:1061169524977:web:9ecda535502c028b00f950',
  measurementId: 'G-X4BVKED9N6',
};
