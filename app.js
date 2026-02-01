/* =========================
   FIREBASE INITIALIZATION
   ========================= */

const firebaseConfig = {
  apiKey: "AIzaSyC95JDUah7EnuqU51vOoqXDsmCSoqk3WkI",
  authDomain: "sk-web-dev-41979.firebaseapp.com",
  projectId: "sk-web-dev-41979",
  storageBucket: "sk-web-dev-41979.firebasestorage.app",
  messagingSenderId: "459204081062",
  appId: "1:459204081062:web:91f475687f25ebe4964b67",
  measurementId: "G-D4QBFK90PM"
};

firebase.initializeApp(firebaseConfig);

const auth = firebase.auth();
const db = firebase.firestore();

/* =========================
   SCREEN STATE MANAGEMENT
   ========================= */

document.addEventListener("DOMContentLoaded", () => {

  // Screens
  const welcomeScreen  = document.getElementById("welcomeScreen");
  const loginScreen    = document.getElementById("loginScreen");
  const registerScreen = document.getElementById("registerScreen");

  // Buttons / Links
  const showLoginBtn     = document.getElementById("showLoginBtn");
  const showRegisterBtn  = document.getElementById("showRegisterBtn");
  const backFromLogin    = document.getElementById("backFromLogin");
  const backFromRegister = document.getElementById("backFromRegister");

  function showScreen(target) {
    [welcomeScreen, loginScreen, registerScreen].forEach(screen => {
      screen?.classList.remove("active");
    });
    target?.classList.add("active");
  }

  // Initial screen
  showScreen(welcomeScreen);

  // Navigation
  showLoginBtn?.addEventListener("click", () => showScreen(loginScreen));
  showRegisterBtn?.addEventListener("click", () => showScreen(registerScreen));
  backFromLogin?.addEventListener("click", () => showScreen(welcomeScreen));
  backFromRegister?.addEventListener("click", () => showScreen(welcomeScreen));
});

/* =========================
   REGISTRATION
   ========================= */

const registerForm = document.getElementById("registerForm");

if (registerForm) {
  registerForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const fullName = fullName.value.trim();
    const email = regEmail.value.trim();
    const password = regPassword.value;
    const birthday = birthday.value;
    const address = address.value.trim();
    const contactNumber = contactNumber.value.trim();

    try {
      const cred = await auth.createUserWithEmailAndPassword(email, password);
      const uid = cred.user.uid;

      await db.collection("users").doc(uid).set({
        fullName,
        email,
        birthday,
        address,
        contactNumber,
        role: "user",
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });

      // App-style navigation still ends with a hard route (for now)
      window.location.href = "dashboard.html";

    } catch (err) {
      alert(err.message);
    }
  });
}

/* =========================
   LOGIN
   ========================= */

const loginForm = document.getElementById("loginForm");

if (loginForm) {
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    try {
      await auth.signInWithEmailAndPassword(
        loginEmail.value.trim(),
        loginPassword.value
      );

      const user = auth.currentUser;
      const doc = await db.collection("users").doc(user.uid).get();

      if (doc.exists && doc.data().role === "admin") {
        window.location.href = "admin.html";
      } else {
        window.location.href = "dashboard.html";
      }

    } catch (err) {
      alert(err.message);
    }
  });
}

/* =========================
   AUTH PROTECTION
   ========================= */

auth.onAuthStateChanged(async (user) => {
  const path = window.location.pathname;

  if (!user) {
    if (path.includes("dashboard.html") || path.includes("admin.html")) {
      window.location.href = "index.html";
    }
    return;
  }

  if (path.includes("admin.html")) {
    const doc = await db.collection("users").doc(user.uid).get();
    if (!doc.exists || doc.data().role !== "admin") {
      window.location.href = "dashboard.html";
    }
  }
});

/* =========================
   LOGOUT
   ========================= */

const logoutBtn = document.getElementById("logoutBtn");

if (logoutBtn) {
  logoutBtn.addEventListener("click", async () => {
    await auth.signOut();
    window.location.href = "index.html";
  });
}

/* =========================
   DASHBOARD AVATAR INITIALS
   ========================= */

auth.onAuthStateChanged(async (user) => {
  if (!user || !window.location.pathname.includes("dashboard.html")) return;

  const avatarInitials = document.getElementById("avatarInitials");
  const welcomeName = document.getElementById("welcomeName");
  if (!avatarInitials || !welcomeName) return;

  const doc = await db.collection("users").doc(user.uid).get();
  if (!doc.exists) return;

  const data = doc.data();

  welcomeName.textContent = `Welcome, ${data.fullName}`;

  avatarInitials.textContent = data.fullName
    .split(/\s+/)
    .map(w => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
});
