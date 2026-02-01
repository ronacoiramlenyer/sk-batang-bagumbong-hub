/* =========================
   FIREBASE INITIALIZATION
   ========================= */

firebase.initializeApp({
  apiKey: "AIzaSyC95JDUah7EnuqU51vOoqXDsmCSoqk3WkI",
  authDomain: "sk-web-dev-41979.firebaseapp.com",
  projectId: "sk-web-dev-41979"
});

const auth = firebase.auth();
const db = firebase.firestore();

/* =========================
   PAGE DETECTION
   ========================= */

const path = window.location.pathname;

/* =========================
   LOGIN PAGE (index.html)
   ========================= */

const loginForm = document.getElementById("loginForm");
const loginError = document.getElementById("loginError");

loginForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  loginError?.classList.add("hidden");

  try {
    const cred = await auth.signInWithEmailAndPassword(
      loginEmail.value.trim(),
      loginPassword.value
    );

    const doc = await db.collection("users").doc(cred.user.uid).get();
    const role = doc.exists ? doc.data().role : "user";

    window.location.href =
      role === "admin" ? "admin.html" : "dashboard.html";

  } catch (err) {
    loginError.textContent = "Incorrect email or password.";
    loginError.classList.remove("hidden");
  }
});

/* =========================
   REGISTRATION (index.html)
   ========================= */

const registerForm = document.getElementById("registerForm");

registerForm?.addEventListener("submit", async (e) => {
  e.preventDefault();

  try {
    const cred = await auth.createUserWithEmailAndPassword(
      regEmail.value.trim(),
      regPassword.value
    );

    await db.collection("users").doc(cred.user.uid).set({
      fullName: fullName.value.trim(),
      email: regEmail.value.trim(),
      role: "user",
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    window.location.href = "dashboard.html";

  } catch (err) {
    alert(err.message);
  }
});

/* =========================
   DASHBOARD / ADMIN AUTH GUARD
   ========================= */

auth.onAuthStateChanged(async (user) => {

  // 🚫 Not logged in
  if (!user) {
    if (path.includes("dashboard.html") || path.includes("admin.html")) {
      window.location.href = "index.html";
    }
    return;
  }

  const doc = await db.collection("users").doc(user.uid).get();
  if (!doc.exists) {
    window.location.href = "index.html";
    return;
  }

  const role = doc.data().role;

  // 🚫 Block user from admin
  if (path.includes("admin.html") && role !== "admin") {
    window.location.href = "dashboard.html";
    return;
  }

  // Populate dashboard UI
  if (path.includes("dashboard.html")) {
    const welcomeName = document.getElementById("welcomeName");
    const avatarInitials = document.getElementById("avatarInitials");

    if (welcomeName && avatarInitials) {
      welcomeName.textContent = `Welcome, ${doc.data().fullName}`;
      avatarInitials.textContent = doc.data().fullName
        .split(/\s+/)
        .map(w => w[0])
        .slice(0, 2)
        .join("")
        .toUpperCase();
    }
  }
});

/* =========================
   LOGOUT (dashboard/admin)
   ========================= */

const logoutBtn = document.getElementById("logoutBtn");

logoutBtn?.addEventListener("click", async () => {
  await auth.signOut();
  window.location.href = "index.html";
});
