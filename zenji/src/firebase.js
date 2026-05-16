// Firebase initialization and helpers
import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged } from "firebase/auth";
import { initializeFirestore, collection, doc, addDoc, setDoc, getDoc, getDocs, query, where, onSnapshot, orderBy, serverTimestamp, deleteDoc, updateDoc, increment, runTransaction } from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";

const firebaseConfig = {
  apiKey: "AIzaSyBHQTSozJkETnhJgCnvnVfxGMGTFOqWHs4",
  authDomain: "knowji-app.firebaseapp.com",
  projectId: "knowji-app",
  storageBucket: "knowji-app.firebasestorage.app",
  messagingSenderId: "955631398050",
  appId: "1:955631398050:web:929f017de5963dac1cfbfb",
  measurementId: "G-988ZKN17ZF"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = initializeFirestore(app, {
  experimentalAutoDetectLongPolling: true,
  useFetchStreams: false,
});
const functions = getFunctions(app, "us-central1");
const googleProvider = new GoogleAuthProvider();

export {
  app,
  auth,
  db,
  functions,
  googleProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  collection,
  doc,
  addDoc,
  setDoc,
  getDoc,
  getDocs,
  query,
  where,
  onSnapshot,
  orderBy,
  serverTimestamp,
  deleteDoc,
  updateDoc,
  increment,
  runTransaction,
  httpsCallable,
};
