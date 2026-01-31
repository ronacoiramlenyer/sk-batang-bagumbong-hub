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
   UI STATE (WELCOME / LOGIN / REGISTER)
   ========================= */

document.addEventListener("DOMContentLoaded", () => {
  const welcome = document.getElementById("welcomeScreen");
  const loginForm = document.getElementById("loginForm");
  const registerForm = document.getElementById("registerForm");

  const showLoginBtn = document.getElementById("showLoginBtn");
  const showRegisterBtn = document.getElementById("showRegisterBtn");
  const backFromLogin = document.getElementById("backFromLogin");
  const backFromRegister = document.getElementById("backFromRegister");

  // Initial state
  if (loginForm) loginForm.style.display = "none";
  if (registerForm) registerForm.style.display = "none";

  if (showLoginBtn) {
    showLoginBtn.addEventListener("click", () => {
      welcome.style.display = "none";
      loginForm.style.display = "block";
      registerForm.style.display = "none";
    });
  }

  if (showRegisterBtn) {
    showRegisterBtn.addEventListener("click", () => {
      welcome.style.display = "none";
      registerForm.style.display = "block";
      loginForm.style.display = "none";
    });
  }

  if (backFromLogin) backFromLogin.addEventListener("click", showWelcome);
  if (backFromRegister) backFromRegister.addEventListener("click", showWelcome);

  function showWelcome() {
    welcome.style.display = "block";
    loginForm.style.display = "none";
    registerForm.style.display = "none";
  }
});

/* =========================
   REGISTRATION
   ========================= */

const registerForm = document.getElementById("registerForm");

if (registerForm) {
  registerForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const fullNameInput = document.getElementById("fullName");
    const regEmailInput = document.getElementById("regEmail");
    const regPasswordInput = document.getElementById("regPassword");
    const birthdayInput = document.getElementById("birthday");
    const addressInput = document.getElementById("address");
    const contactNumberInput = document.getElementById("contactNumber");

    const fullName = fullNameInput.value.trim();
    const email = regEmailInput.value.trim();
    const password = regPasswordInput.value;
    const birthday = birthdayInput.value;
    const address = addressInput.value.trim();
    const contactNumber = contactNumberInput.value.trim();

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

    // Fallback UI reset (in case redirect is delayed)
    document.getElementById("registerForm").style.display = "none";
    document.getElementById("welcomeScreen").style.display = "block";

    // Hard redirect
    window.location.assign("dashboard.html");

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
   AUTH PROTECTION (NO AUTO-REDIRECT)
   ========================= */


auth.onAuthStateChanged(async (user) => {
  const path = window.location.pathname;

  // Not logged in → block protected pages
  if (!user) {
    if (path.includes("dashboard.html") || path.includes("admin.html")) {
      window.location.href = "index.html";
    }
    return;
  }

  // Logged in → check role if on admin page
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
  // Run ONLY on dashboard
  if (!user || !window.location.pathname.includes("dashboard.html")) return;

  const avatarInitials = document.getElementById("avatarInitials");
  const welcomeName = document.getElementById("welcomeName");

  if (!avatarInitials || !welcomeName) return;

  try {
    const doc = await db.collection("users").doc(user.uid).get();
    if (!doc.exists) return;

    const data = doc.data();

    // Welcome text
    welcomeName.textContent = `Welcome, ${data.fullName}`;

    // Generate initials
    const initials = data.fullName
      .trim()
      .split(/\s+/)
      .map(word => word[0])
      .slice(0, 2)
      .join("")
      .toUpperCase();

    avatarInitials.textContent = initials || "?";

  } catch (err) {
    console.error("Avatar load error:", err);
  }
});
