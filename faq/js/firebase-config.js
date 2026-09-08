// Web app config for the SAME Firebase project backlog-tracker uses
// (backlog-tracker-e4ed2) — deliberately identical to
// backlog-tracker/public/js/firebase-config.js. This public help center
// reads faqCategories/faqArticles from that project's Firestore so that
// editing an article on the backlog-tracker "FAQ Center" admin page is
// what keeps this page's content live — there's no separate copy of the
// content to fall out of sync.
//
// These values are not secret (they identify the project, not authorize
// access — Firestore security is enforced by firestore.rules), so it's
// normal for them to live in a committed file like this one. If
// backlog-tracker's config ever changes, mirror the change here too.
export const firebaseConfig = {
  apiKey: "AIzaSyDzG5MzavLWyKU7NXfTPskuWbFYFlc5W3g",
  authDomain: "backlog-tracker-e4ed2.firebaseapp.com",
  projectId: "backlog-tracker-e4ed2",
  storageBucket: "backlog-tracker-e4ed2.firebasestorage.app",
  messagingSenderId: "410903316373",
  appId: "1:410903316373:web:8477a9848cb41ad3c7589c",
};
