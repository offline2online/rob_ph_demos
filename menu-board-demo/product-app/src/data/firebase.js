import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getFunctions } from 'firebase/functions';

// Same project/config as menu-board-demo/hq-admin.html (lines 1447-1456) —
// this page reads/writes the same live `items` collection, so it must
// connect to the same Firestore project, not a mirrored copy.
const firebaseConfig = {
  apiKey: 'AIzaSyDrUKPNep2uxbZjYJ4i0vImdG7Xn_UuSXo',
  authDomain: 'rob-ph-demos.firebaseapp.com',
  projectId: 'rob-ph-demos',
  storageBucket: 'rob-ph-demos.firebasestorage.app',
  messagingSenderId: '199417645406',
  appId: '1:199417645406:web:0e7a54d00083b41ea9e7cf',
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const functions = getFunctions(app);
export const MB = 'menuboard';
export const ITEMS_COLL = 'items';
export const STOCK_COLL_NAME = 'stock';
