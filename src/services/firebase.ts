import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, User } from 'firebase/auth';
import { getFirestore, doc, getDoc, setDoc, collection, query, where, getDocs, onSnapshot, deleteDoc } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const FIREBASE_PLACEHOLDER_MARKERS = ['remixed-', 'your-', 'example', 'demo'];

function hasRealFirebaseValue(value: unknown) {
  if (typeof value !== 'string') return false;
  const normalized = value.trim().toLowerCase();
  return (
    normalized.length > 0 &&
    !FIREBASE_PLACEHOLDER_MARKERS.some((marker) => normalized.includes(marker))
  );
}

export const isFirebaseConfigured = [
  firebaseConfig.projectId,
  firebaseConfig.appId,
  firebaseConfig.apiKey,
  firebaseConfig.authDomain,
  firebaseConfig.firestoreDatabaseId,
].every(hasRealFirebaseValue);

// Initialize Firebase SDK
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

// Auth Helpers
export const signInWithGoogle = () => signInWithPopup(auth, googleProvider);
export const logout = () => auth.signOut();

if (import.meta.env.DEV && !isFirebaseConfigured) {
  console.warn(
    'Firebase đang dùng cấu hình mẫu trong firebase-applet-config.json. Đăng nhập và đồng bộ cloud sẽ chưa hoạt động cho đến khi bạn thay bằng config thật.',
  );
}

export { 
  onAuthStateChanged, 
  doc, 
  getDoc, 
  setDoc, 
  collection, 
  query, 
  where, 
  getDocs, 
  onSnapshot,
  deleteDoc
};

export type { User };
