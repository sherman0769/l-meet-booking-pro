// lib/firebase.ts

import { initializeApp } from "firebase/app";
import { initializeFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyDFWp6b0-ynPyujQjlH-zXOh8iKL4i56aU",
  authDomain: "l-meet-booking-pro.firebaseapp.com",
  projectId: "l-meet-booking-pro",
  storageBucket: "l-meet-booking-pro.firebasestorage.app",
  messagingSenderId: "611253035637",
  appId: "1:611253035637:web:b80d880dd2e9a96cb44e3c"
};

// 初始化 Firebase
const app = initializeApp(firebaseConfig);

// 初始化 Firestore (強制使用 Long Polling)
export const db = initializeFirestore(app, {
  experimentalForceLongPolling: true,
});
