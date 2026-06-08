import { initializeApp, getApps } from 'firebase/app';
import { getDatabase } from 'firebase/database';
import { getAuth } from 'firebase/auth';

const firebaseConfig = {
  apiKey: "AIzaSyDy0FiBW8ssI90vfiwn-YrUqWkwS21LGh8",
  authDomain: "canonical-req-8605.firebaseapp.com",
  databaseURL: "https://canonical-req-8605-default-rtdb.firebaseio.com",
  projectId: "canonical-req-8605",
  storageBucket: "canonical-req-8605.firebasestorage.app",
  messagingSenderId: "766623656782",
  appId: "1:766623656782:web:deebc20e0fdebf2e594c1f",
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
export const db = getDatabase(app);
export const auth = getAuth(app);
