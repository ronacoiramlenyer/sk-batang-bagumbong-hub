/* =========================
   FIREBASE INITIALIZATION
   ========================= */

firebase.initializeApp({
  apiKey: "AIzaSyC95JDUah7EnuqU51vOoqXDsmCSoqk3WkI",
  authDomain: "sk-web-dev-41979.firebaseapp.com",
  projectId: "sk-web-dev-41979",
  storageBucket: "sk-web-dev-41979.firebasestorage.app"
});

const auth = firebase.auth();
const db = firebase.firestore();

// Explicitly use durable local storage for the signed-in session so it
// reliably survives a full-page navigation (e.g. index.html -> dashboard.html
// right after login). Without this, some mobile browsers/in-app webviews
// (Messenger/Facebook in-app browser, private browsing, etc.) that restrict
// IndexedDB can silently fail to persist the session across that navigation,
// which looks like "login works, but the next page bounces you back out."
// Falls back to sessionStorage-based persistence — more widely supported —
// if IndexedDB isn't available.
auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch((err) => {
  console.error("LOCAL auth persistence unavailable, falling back to SESSION:", err);
  return auth.setPersistence(firebase.auth.Auth.Persistence.SESSION);
}).catch((err) => {
  console.error("SESSION auth persistence also unavailable:", err);
});

/* =========================
   HTML ESCAPING (XSS PREVENTION)
   Any Firestore-sourced text (names, addresses, messages, event/announcement
   text, etc.) must go through this before being interpolated into an
   innerHTML template — those fields are attacker-controllable and get
   rendered inside other users' (including admins') authenticated sessions.
   ========================= */
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[ch]));
}

/* =========================
   LAST-NAME SORTING
   Simple, explicit rule: split the full name on spaces and treat the
   final word as the last name — used to sort user/registrant lists by
   surname instead of by first name.
   ========================= */
function getLastName(fullName) {
  const parts = String(fullName || "").trim().split(/\s+/);
  return (parts[parts.length - 1] || "").toLowerCase();
}

function sortByLastName(list, getFullName) {
  return list.slice().sort((a, b) =>
    getLastName(getFullName(a)).localeCompare(getLastName(getFullName(b)))
  );
}

/* =========================
   ROLES: user / admin / superadmin
   Super admin is a superset of admin — anywhere "admin" access is
   checked, super admin counts too. A handful of actions (delete user,
   reject an ID application, remove/restore an event registrant) are
   reserved for super admin only, gated separately using
   currentUserRole === "superadmin" — the actual enforcement for those
   lives in firestore.rules; hiding the buttons here is just so a regular
   admin doesn't see a control that would fail.
   ========================= */
function isAdminRole(role) {
  return role === "admin" || role === "superadmin";
}

// Set once the signed-in user's own doc is loaded (see the auth guard
// below) — read by admin-panel render functions to decide whether to show
// the super-admin-only controls.
let currentUserRole = null;

// The auth guard usually sets currentUserRole well before any page-specific
// list renders, but there's no strict ordering guarantee between its own
// Firestore read and another onSnapshot listener's first callback firing.
// Admin list setups call this first so the super-admin-only buttons don't
// flicker missing on a fast page load.
async function ensureCurrentUserRole() {
  if (currentUserRole !== null) return;
  // auth.currentUser is unreliable here — Firebase Auth usually hasn't
  // resolved the persisted session yet at the exact moment a page's script
  // first runs, so checking it directly just found nothing and silently
  // gave up almost every time. waitForUser() actually waits for
  // onAuthStateChanged to fire with the real (or null) user.
  const user = await waitForUser();
  if (!user) return;
  try {
    const doc = await db.collection("users").doc(user.uid).get();
    currentUserRole = doc.exists ? doc.data().role : null;
  } catch (err) {
    console.error("Failed to load current user's role:", err);
  }
}

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
      isAdminRole(role) ? "admin.html" : "dashboard.html";

  } catch (err) {
    loginError.textContent = "Incorrect email or password.";
    loginError.classList.remove("hidden");
  }
});

/* =========================
   FORGOT PASSWORD (index.html)
   ========================= */

const forgotPasswordForm = document.getElementById("forgotPasswordForm");
const forgotPasswordMessage = document.getElementById("forgotPasswordMessage");
const forgotPasswordSubmitBtn = document.getElementById("forgotPasswordSubmitBtn");

forgotPasswordForm?.addEventListener("submit", async (e) => {
  e.preventDefault();

  const email = document.getElementById("forgotPasswordEmail").value.trim();
  forgotPasswordSubmitBtn.disabled = true;

  // Always show the same confirmation regardless of whether the email is
  // registered — prevents using this form to check which emails have
  // accounts (user enumeration).
  try {
    await auth.sendPasswordResetEmail(email);
  } catch (err) {
    console.error("Password reset request failed:", err);
  } finally {
    forgotPasswordMessage.textContent =
      "If an account exists for that email, a password reset link has been sent.";
    forgotPasswordMessage.classList.remove("form-error", "hidden");
    forgotPasswordMessage.classList.add("form-success");
    forgotPasswordSubmitBtn.disabled = false;
  }
});

/* =========================
   REGISTRATION (index.html)
   ========================= */

const registerForm = document.getElementById("registerForm");
const registerError = document.getElementById("registerError");
const registerSubmitBtn = document.getElementById("registerSubmitBtn");
const regPhotoFileInput = document.getElementById("regPhotoFile");
const regPhotoPreview = document.getElementById("regPhotoPreview");
const regIdDocumentFileInput = document.getElementById("regIdDocumentFile");
const regIdDocumentPreview = document.getElementById("regIdDocumentPreview");

let regPhotoDataUrl = null;
let regIdDocumentDataUrl = null;

regPhotoFileInput?.addEventListener("change", () => {
  const file = regPhotoFileInput.files[0];
  if (!file) return;

  openPhotoCropper(file, (dataUrl) => {
    if (!dataUrl) return;
    regPhotoDataUrl = dataUrl;
    regPhotoPreview.src = dataUrl;
    regPhotoPreview.classList.remove("hidden");
  });
});

regIdDocumentFileInput?.addEventListener("change", async () => {
  const file = regIdDocumentFileInput.files[0];
  if (!file) return;

  try {
    // Slightly larger than the profile photo — needs to stay legible
    // for the admin to read printed details on the ID.
    regIdDocumentDataUrl = await compressImageToDataUrl(file, 800, 0.8);
    regIdDocumentPreview.src = regIdDocumentDataUrl;
    regIdDocumentPreview.classList.remove("hidden");
  } catch (err) {
    console.error("ID document processing failed:", err);
    alert("Couldn't process that image. Try a different file.");
  }
});

registerForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  registerError?.classList.add("hidden");

  if (!regPhotoDataUrl) {
    registerError.textContent = "Please upload a photo.";
    registerError.classList.remove("hidden");
    return;
  }

  if (!regIdDocumentDataUrl) {
    registerError.textContent = "Please upload a valid ID.";
    registerError.classList.remove("hidden");
    return;
  }

  registerSubmitBtn.disabled = true;
  registerSubmitBtn.textContent = "Creating Account…";

  try {
    const cred = await auth.createUserWithEmailAndPassword(
      regEmail.value.trim(),
      regPassword.value
    );

    await db.collection("users").doc(cred.user.uid).set({
      fullName: fullName.value.trim(),
      email: regEmail.value.trim(),
      address: regAddress.value.trim(),
      birthdate: regBirthdate.value,
      contactNumber: regContactNumber.value.trim(),
      photoData: regPhotoDataUrl,
      idDocumentData: regIdDocumentDataUrl,
      role: "user",
      idStatus: "pending",
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    window.location.href = "dashboard.html";

  } catch (err) {
    console.error("Registration failed:", err);
    registerError.textContent = err.message;
    registerError.classList.remove("hidden");
  } finally {
    registerSubmitBtn.disabled = false;
    registerSubmitBtn.textContent = "Create Account";
  }
});

/* =========================
   DASHBOARD / ADMIN AUTH GUARD
   ========================= */

// Explicit page lists instead of substring matching — substring checks like
// path.includes("admin.html") only match the literal page "admin.html" and
// silently miss subpages like "admin-manage-events.html".
const pageName = path.split("/").pop();

const ADMIN_ONLY_PAGES = [
  "admin.html",
  "admin-add-events.html",
  "admin-manage-events.html",
  "admin-add-announcement.html",
  "admin-manage-announcements.html",
  "admin-certificate-template.html",
  "admin-id-template.html",
  "admin-manage-id-applications.html",
  "admin-messages.html",
  "admin-manage-users.html"
];

const AUTH_REQUIRED_PAGES = [
  ...ADMIN_ONLY_PAGES,
  "dashboard.html",
  "complete-profile.html",
  "messages.html",
  "profile.html"
];

function isProfileComplete(userData) {
  return !!(
    userData.address &&
    userData.birthdate &&
    userData.contactNumber &&
    userData.photoData &&
    userData.idDocumentData
  );
}

auth.onAuthStateChanged(async (user) => {

  // 🚫 Not logged in
  if (!user) {
    if (AUTH_REQUIRED_PAGES.includes(pageName)) {
      window.location.href = "index.html";
    }
    return;
  }

  const doc = await db.collection("users").doc(user.uid).get();
  if (!doc.exists) {
    // The Firestore profile is gone (e.g. an admin deleted this account)
    // but the browser still has an active Firebase Auth session for it —
    // sign out so this doesn't keep re-triggering. Deleting a user only
    // removes their Firestore doc, not their Auth login (that needs the
    // Admin SDK/Console), so without this, a lingering session here would
    // hit this exact check forever — and if already on index.html,
    // redirecting there again just reloads the same page in an endless loop.
    await auth.signOut();
    if (pageName !== "index.html") {
      window.location.href = "index.html";
    }
    return;
  }

  const userData = doc.data();
  const role = userData.role;
  currentUserRole = role;

  // 🚫 Block non-admins from any admin page
  if (ADMIN_ONLY_PAGES.includes(pageName) && !isAdminRole(role)) {
    window.location.href = "dashboard.html";
    return;
  }

  // 🚫 Incomplete profile — required for ID-relevant pages, not for
  // complete-profile.html itself (or the site would redirect in a loop).
  // Admins are exempt: that page collects the photo/ID needed for a
  // resident's SK Barangay ID application, and admin accounts are created
  // by hand in Firestore rather than through registration, so they never
  // have (or need) that data on file — without this exemption every admin
  // login gets bounced to "Complete Your Profile" instead of the admin panel.
  const needsCompleteProfile = AUTH_REQUIRED_PAGES.includes(pageName) &&
    pageName !== "complete-profile.html" &&
    !isAdminRole(role) &&
    !isProfileComplete(userData);

  if (needsCompleteProfile) {
    window.location.href = "complete-profile.html";
    return;
  }

  // Already complete — no reason to be stuck on the completion page
  if (pageName === "complete-profile.html" && isProfileComplete(userData)) {
    window.location.href = isAdminRole(role) ? "admin.html" : "dashboard.html";
    return;
  }

  // Populate welcome name / avatar initials — element existence check
  // means this works on any page that has them (dashboard, profile).
  const welcomeName = document.getElementById("welcomeName");
  const avatarInitials = document.getElementById("avatarInitials");

  if (welcomeName && avatarInitials) {
    welcomeName.textContent = `Welcome, ${userData.fullName}`;
    avatarInitials.textContent = userData.fullName
      .split(/\s+/)
      .map(w => w[0])
      .slice(0, 2)
      .join("")
      .toUpperCase();

    // Show the user's actual photo as their avatar, Facebook-profile-style,
    // falling back to initials if no photo is on file.
    if (userData.photoData) {
      const avatarCircle = avatarInitials.closest(".avatar-circle");
      if (avatarCircle) {
        avatarCircle.style.backgroundImage = `url(${userData.photoData})`;
        avatarCircle.style.backgroundSize = "cover";
        avatarCircle.style.backgroundPosition = "center";
        avatarInitials.style.display = "none";
      }
    }
  }
});

/* =========================
   COMPLETE PROFILE (complete-profile.html)
   ========================= */

const completeProfileForm = document.getElementById("completeProfileForm");
const completeProfileError = document.getElementById("completeProfileError");
const completeProfileSubmitBtn = document.getElementById("completeProfileSubmitBtn");
const cpPhotoFileInput = document.getElementById("cpPhotoFile");
const cpPhotoPreview = document.getElementById("cpPhotoPreview");
const cpIdDocumentFileInput = document.getElementById("cpIdDocumentFile");
const cpIdDocumentPreview = document.getElementById("cpIdDocumentPreview");

let cpPhotoDataUrl = null;
let cpIdDocumentDataUrl = null;

cpPhotoFileInput?.addEventListener("change", () => {
  const file = cpPhotoFileInput.files[0];
  if (!file) return;

  openPhotoCropper(file, (dataUrl) => {
    if (!dataUrl) return;
    cpPhotoDataUrl = dataUrl;
    cpPhotoPreview.src = dataUrl;
    cpPhotoPreview.classList.remove("hidden");
  });
});

cpIdDocumentFileInput?.addEventListener("change", async () => {
  const file = cpIdDocumentFileInput.files[0];
  if (!file) return;

  try {
    cpIdDocumentDataUrl = await compressImageToDataUrl(file, 800, 0.8);
    cpIdDocumentPreview.src = cpIdDocumentDataUrl;
    cpIdDocumentPreview.classList.remove("hidden");
  } catch (err) {
    console.error("ID document processing failed:", err);
    alert("Couldn't process that image. Try a different file.");
  }
});

// Prefill with whatever's already on file (in case only some fields are missing)
if (completeProfileForm) {
  waitForUser().then(async (user) => {
    if (!user) return;

    try {
      const doc = await db.collection("users").doc(user.uid).get();
      if (!doc.exists) return;

      const data = doc.data();
      if (data.address) {
        cpAddress.value = data.address;
        // Address already on file — changing it now goes through the
        // admin-approval flow (Profile page), not this form.
        cpAddress.readOnly = true;
        cpAddress.title = "To change your address, request it from your Profile page after this.";
      }
      if (data.birthdate) cpBirthdate.value = data.birthdate;
      if (data.contactNumber) cpContactNumber.value = data.contactNumber;
      if (data.photoData) {
        cpPhotoDataUrl = data.photoData;
        cpPhotoPreview.src = data.photoData;
        cpPhotoPreview.classList.remove("hidden");
      }
      if (data.idDocumentData) {
        cpIdDocumentDataUrl = data.idDocumentData;
        cpIdDocumentPreview.src = data.idDocumentData;
        cpIdDocumentPreview.classList.remove("hidden");
      }
    } catch (err) {
      console.error("Failed to prefill profile:", err);
    }
  });
}

completeProfileForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  completeProfileError?.classList.add("hidden");

  const user = auth.currentUser;
  if (!user) return;

  if (!cpPhotoDataUrl) {
    completeProfileError.textContent = "Please upload a photo.";
    completeProfileError.classList.remove("hidden");
    return;
  }

  if (!cpIdDocumentDataUrl) {
    completeProfileError.textContent = "Please upload a valid ID.";
    completeProfileError.classList.remove("hidden");
    return;
  }

  completeProfileSubmitBtn.disabled = true;
  completeProfileSubmitBtn.textContent = "Saving…";

  try {
    await db.collection("users").doc(user.uid).update({
      address: cpAddress.value.trim(),
      birthdate: cpBirthdate.value,
      contactNumber: cpContactNumber.value.trim(),
      photoData: cpPhotoDataUrl,
      idDocumentData: cpIdDocumentDataUrl
    });

    window.location.href = "dashboard.html";
  } catch (err) {
    console.error("Failed to save profile:", err);
    completeProfileError.textContent = "Something went wrong. Please try again.";
    completeProfileError.classList.remove("hidden");
  } finally {
    completeProfileSubmitBtn.disabled = false;
    completeProfileSubmitBtn.textContent = "Save and Continue";
  }
});

/* =========================
   EVENT STATUS HELPERS
   Events auto-transition to "completed" once their date has passed —
   there's no backend scheduler (would need the paid Blaze plan), so this
   runs client-side: whenever the admin event list renders, any past-due
   event gets its status corrected in Firestore. The dashboard also
   applies the same logic when deciding what counts as "upcoming", so
   users never see a stale past event even if no admin has visited
   recently to trigger the Firestore write.
   ========================= */

function todayDateStr() {
  return new Date().toISOString().slice(0, 10);
}

// What the status SHOULD read as right now, given the event's date —
// without mutating anything. "archived" always wins regardless of date.
function getDisplayEventStatus(event) {
  if (event.status === "archived") return "archived";
  if (event.date && event.date < todayDateStr() && event.status !== "completed") {
    return "completed";
  }
  return event.status;
}

// Capacity is optional per event (null/undefined = no limit). registeredCount
// is a denormalized counter on the event doc, incremented atomically in the
// same transaction as each registration (see the Join Event handler) so it
// can't drift out of sync from concurrent joins.
function getCapacityInfo(event) {
  const capacity = event.capacity || null;
  const registeredCount = event.registeredCount || 0;
  return {
    hasLimit: capacity != null,
    capacity,
    registeredCount,
    remaining: capacity != null ? Math.max(0, capacity - registeredCount) : null,
    isFull: capacity != null && registeredCount >= capacity
  };
}

/* =========================
   GENERIC COLLAPSIBLE CARD TOGGLE
   Any card with class "collapsible-card" containing a
   [data-role="toggle-card"] header will expand/collapse on tap.
   Buttons inside the card's body are unaffected since they live
   outside the header region.
   ========================= */

document.addEventListener("click", (e) => {
  const header = e.target.closest('[data-role="toggle-card"]');
  if (!header) return;

  const card = header.closest(".collapsible-card");
  if (!card) return;

  card.classList.toggle("expanded");
});


/* =========================
   AUTH HELPER
   ========================= */

function waitForUser() {
  return new Promise((resolve) => {
    const unsubscribe = auth.onAuthStateChanged((user) => {
      unsubscribe();
      resolve(user);
    });
  });
}

/* =========================
   LOGOUT (dashboard/admin)
   ========================= */

const logoutBtn = document.getElementById("logoutBtn");

logoutBtn?.addEventListener("click", async () => {
  await auth.signOut();
  window.location.href = "index.html";
});


/* =========================
   ADMIN – CREATE EVENT
   ========================= */

const createEventForm = document.getElementById("createEventForm");

if (createEventForm) {
  createEventForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const titleInput = document.getElementById("eventTitle");
    const descriptionInput = document.getElementById("eventDescription");
    const dateInput = document.getElementById("eventDate");
    const timeInput = document.getElementById("eventTime");
    const locationInput = document.getElementById("eventLocation");
    const capacityInput = document.getElementById("eventCapacity");

    const title = titleInput.value.trim();
    const description = descriptionInput.value.trim();
    const date = dateInput.value;
    const time = timeInput.value;
    const location = locationInput.value.trim();
    // Blank = no limit. A capacity of 0 or less doesn't make sense, so
    // treat it the same as "no limit" rather than an event no one can join.
    const capacityRaw = parseInt(capacityInput.value, 10);
    const capacity = (capacityInput.value.trim() && capacityRaw > 0) ? capacityRaw : null;

    if (!title || !date || !time || !location) {
      alert("Please complete all required fields.");
      return;
    }

    try {
      const user = auth.currentUser;
      if (!user) {
        alert("You must be logged in as admin.");
        return;
      }

      await db.collection("events").add({
        title,
        description,
        date,
        time,
        location,
        capacity,
        registeredCount: 0,
        createdBy: user.uid,
        status: "upcoming",
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });

      // Reset form
      createEventForm.reset();
      alert("Event created successfully.");

    } catch (err) {
      console.error("Create event error:", err);
      alert(err.message);
    }
  });
}


/* =========================
   CERTIFICATE TEMPLATE (ADMIN UPLOAD)
   ========================= */

// Stored as a base64 data URL in a single Firestore document — avoids
// needing Firebase Storage (which requires the paid Blaze plan).
// Firestore documents cap at 1MB, so the source image needs to stay small.
const CERT_TEMPLATE_DOC = db.collection("settings").doc("certificateTemplate");
const CERT_TEMPLATE_MAX_BYTES = 650 * 1024; // ~650KB, leaves room for base64 overhead

const templatePreview = document.getElementById("templatePreview");
const noTemplateText = document.getElementById("noTemplateText");
const templateUploadForm = document.getElementById("templateUploadForm");
const templateFileInput = document.getElementById("templateFile");

let cachedTemplateDataUrl = null;

async function loadTemplatePreview() {
  if (!templatePreview) return;

  try {
    const doc = await CERT_TEMPLATE_DOC.get();
    if (doc.exists && doc.data().imageData) {
      cachedTemplateDataUrl = doc.data().imageData;
      templatePreview.src = cachedTemplateDataUrl;
      templatePreview.classList.remove("hidden");
      noTemplateText?.classList.add("hidden");
    } else {
      cachedTemplateDataUrl = null;
      templatePreview.classList.add("hidden");
      noTemplateText?.classList.remove("hidden");
    }
  } catch (err) {
    console.error("Failed to load template:", err);
    cachedTemplateDataUrl = null;
    templatePreview.classList.add("hidden");
    noTemplateText?.classList.remove("hidden");
  }
}

if (templatePreview) {
  loadTemplatePreview();
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Resizes an image file down to maxDimension on its longest side and
// re-encodes as JPEG at the given quality, returning a data URL. Used to
// keep uploaded photos small enough to store inline in a Firestore doc
// (no Firebase Storage available on the free plan).
function compressImageToDataUrl(file, maxDimension = 500, quality = 0.75) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        let { width, height } = img;

        if (width > height && width > maxDimension) {
          height = Math.round((height * maxDimension) / width);
          width = maxDimension;
        } else if (height > maxDimension) {
          width = Math.round((width * maxDimension) / height);
          height = maxDimension;
        }

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);

        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

/* =========================
   PHOTO CROPPER (shared modal — index.html, complete-profile.html, profile.html)
   Square, drag-to-reposition + zoom crop step for face/profile photos, so
   the final photo is consistently square (2x2-ID-photo-style) and the
   person can make sure their whole face is visible regardless of how the
   original photo was framed. Not used for "Valid ID" document uploads —
   those stay as full, uncropped photos of the ID itself.
   ========================= */

const photoCropModal = document.getElementById("photoCropModal");
const photoCropViewport = document.getElementById("photoCropViewport");
const photoCropImage = document.getElementById("photoCropImage");
const photoCropZoom = document.getElementById("photoCropZoom");
const photoCropConfirmBtn = document.getElementById("photoCropConfirmBtn");
const photoCropCancelBtn = document.getElementById("photoCropCancelBtn");

const PHOTO_CROP_VIEWPORT_SIZE = 280;
const PHOTO_CROP_OUTPUT_SIZE = 500;

let photoCropState = null; // { naturalWidth, naturalHeight, minScale, scale, offsetX, offsetY, onCropped }

function clampPhotoCropOffsets() {
  const { naturalWidth, naturalHeight, scale } = photoCropState;
  const renderedWidth = naturalWidth * scale;
  const renderedHeight = naturalHeight * scale;
  const minOffsetX = Math.min(0, PHOTO_CROP_VIEWPORT_SIZE - renderedWidth);
  const minOffsetY = Math.min(0, PHOTO_CROP_VIEWPORT_SIZE - renderedHeight);
  photoCropState.offsetX = Math.min(0, Math.max(minOffsetX, photoCropState.offsetX));
  photoCropState.offsetY = Math.min(0, Math.max(minOffsetY, photoCropState.offsetY));
}

function renderPhotoCropTransform() {
  const { naturalWidth, naturalHeight, scale, offsetX, offsetY } = photoCropState;
  photoCropImage.style.width = `${naturalWidth * scale}px`;
  photoCropImage.style.height = `${naturalHeight * scale}px`;
  photoCropImage.style.transform = `translate(${offsetX}px, ${offsetY}px)`;
}

// Opens the crop modal for `file`; calls onCropped(dataUrl) with the final
// square JPEG once the person confirms. Never calls back if they cancel.
function openPhotoCropper(file, onCropped) {
  if (!photoCropModal) {
    // Page doesn't have the crop modal (shouldn't happen for the three
    // pages this is wired up on) — fail safe by skipping cropping.
    onCropped(null);
    return;
  }

  const reader = new FileReader();
  reader.onerror = () => alert("Couldn't read that file. Try again.");
  reader.onload = () => {
    const img = new Image();
    img.onerror = () => alert("Couldn't load that image. Try a different file.");
    img.onload = () => {
      const minScale = PHOTO_CROP_VIEWPORT_SIZE / Math.min(img.naturalWidth, img.naturalHeight);
      photoCropState = {
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight,
        minScale,
        scale: minScale,
        offsetX: (PHOTO_CROP_VIEWPORT_SIZE - img.naturalWidth * minScale) / 2,
        offsetY: (PHOTO_CROP_VIEWPORT_SIZE - img.naturalHeight * minScale) / 2,
        onCropped
      };
      clampPhotoCropOffsets();
      photoCropImage.src = reader.result;
      photoCropZoom.value = 100;
      renderPhotoCropTransform();
      photoCropModal.classList.remove("hidden");
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}

photoCropZoom?.addEventListener("input", () => {
  if (!photoCropState) return;

  const zoomFactor = photoCropZoom.value / 100; // slider 100..300 -> 1x..3x
  const centerX = PHOTO_CROP_VIEWPORT_SIZE / 2;
  const centerY = PHOTO_CROP_VIEWPORT_SIZE / 2;
  // Keep whatever point is currently at the viewport's center anchored
  // there while the zoom level changes, instead of zooming from a corner.
  const oldScale = photoCropState.scale;
  const imageCenterX = (centerX - photoCropState.offsetX) / oldScale;
  const imageCenterY = (centerY - photoCropState.offsetY) / oldScale;

  photoCropState.scale = photoCropState.minScale * zoomFactor;
  photoCropState.offsetX = centerX - imageCenterX * photoCropState.scale;
  photoCropState.offsetY = centerY - imageCenterY * photoCropState.scale;
  clampPhotoCropOffsets();
  renderPhotoCropTransform();
});

let photoCropDragging = false;
let photoCropDragStart = { x: 0, y: 0 };
let photoCropDragOrigin = { x: 0, y: 0 };

function photoCropPointerDown(x, y) {
  if (!photoCropState) return;
  photoCropDragging = true;
  photoCropDragStart = { x, y };
  photoCropDragOrigin = { x: photoCropState.offsetX, y: photoCropState.offsetY };
}

function photoCropPointerMove(x, y) {
  if (!photoCropDragging || !photoCropState) return;
  photoCropState.offsetX = photoCropDragOrigin.x + (x - photoCropDragStart.x);
  photoCropState.offsetY = photoCropDragOrigin.y + (y - photoCropDragStart.y);
  clampPhotoCropOffsets();
  renderPhotoCropTransform();
}

function photoCropPointerUp() {
  photoCropDragging = false;
}

photoCropViewport?.addEventListener("mousedown", (e) => {
  e.preventDefault();
  photoCropPointerDown(e.clientX, e.clientY);
});
document.addEventListener("mousemove", (e) => photoCropPointerMove(e.clientX, e.clientY));
document.addEventListener("mouseup", photoCropPointerUp);

photoCropViewport?.addEventListener("touchstart", (e) => {
  const t = e.touches[0];
  photoCropPointerDown(t.clientX, t.clientY);
}, { passive: true });
document.addEventListener("touchmove", (e) => {
  if (!photoCropDragging) return;
  const t = e.touches[0];
  photoCropPointerMove(t.clientX, t.clientY);
}, { passive: true });
document.addEventListener("touchend", photoCropPointerUp);

photoCropCancelBtn?.addEventListener("click", () => {
  photoCropModal?.classList.add("hidden");
  photoCropState = null;
});

photoCropConfirmBtn?.addEventListener("click", () => {
  if (!photoCropState) return;

  const { scale, offsetX, offsetY, onCropped } = photoCropState;
  const sx = -offsetX / scale;
  const sy = -offsetY / scale;
  const sSize = PHOTO_CROP_VIEWPORT_SIZE / scale;

  const canvas = document.createElement("canvas");
  canvas.width = PHOTO_CROP_OUTPUT_SIZE;
  canvas.height = PHOTO_CROP_OUTPUT_SIZE;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(photoCropImage, sx, sy, sSize, sSize, 0, 0, PHOTO_CROP_OUTPUT_SIZE, PHOTO_CROP_OUTPUT_SIZE);

  const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
  photoCropModal.classList.add("hidden");
  photoCropState = null;
  onCropped(dataUrl);
});

templateUploadForm?.addEventListener("submit", async (e) => {
  e.preventDefault();

  const file = templateFileInput.files[0];
  if (!file) {
    alert("Please choose an image file.");
    return;
  }

  if (file.size > CERT_TEMPLATE_MAX_BYTES) {
    alert(
      `That image is too large (${Math.round(file.size / 1024)}KB). ` +
      `Please use an image under ${Math.round(CERT_TEMPLATE_MAX_BYTES / 1024)}KB — ` +
      `try compressing it or reducing its dimensions first.`
    );
    return;
  }

  const submitBtn = templateUploadForm.querySelector("button[type='submit']");
  submitBtn.disabled = true;
  submitBtn.textContent = "Uploading…";

  try {
    const dataUrl = await readFileAsDataUrl(file);

    await CERT_TEMPLATE_DOC.set({
      imageData: dataUrl,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    await loadTemplatePreview();
    alert("Template uploaded. This is now used for every generated certificate.");
    templateUploadForm.reset();
  } catch (err) {
    console.error("Template upload failed:", err);
    alert("Upload failed: " + err.message);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Upload Template";
  }
});


/* =========================
   CERTIFICATE GENERATION (CANVAS OVERLAY)
   ========================= */

// Text placement, expressed as a fraction of the template's width/height
// so it scales with whatever image size is uploaded. If a new template
// changes where the blank areas are, these are the only values to adjust.
const CERT_TEXT_CONFIG = {
  name:  { xPct: 0.5, yPct: 0.45, fontPct: 0.045, weight: "bold",   color: "#1c1c1c" },
  event: { xPct: 0.5, yPct: 0.55, fontPct: 0.026, weight: "normal", color: "#333333" },
  date:  { xPct: 0.5, yPct: 0.62, fontPct: 0.018, weight: "normal", color: "#555555" }
};

function loadImageFromUrl(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

async function getCertificateTemplateImage() {
  // Use the cached copy if we already have it (e.g. admin just loaded the
  // upload page), otherwise fetch the template doc fresh.
  let dataUrl = cachedTemplateDataUrl;

  if (!dataUrl) {
    const doc = await CERT_TEMPLATE_DOC.get();
    if (!doc.exists || !doc.data().imageData) {
      throw new Error("No certificate template has been uploaded yet.");
    }
    dataUrl = doc.data().imageData;
  }

  return loadImageFromUrl(dataUrl);
}

async function generateCertificateCanvas({ fullName, eventTitle, eventDate }) {
  const img = await getCertificateTemplateImage();

  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;

  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);

  function drawLine(text, cfg) {
    const fontSize = Math.round(cfg.fontPct * canvas.width);
    ctx.font = `${cfg.weight} ${fontSize}px system-ui, sans-serif`;
    ctx.fillStyle = cfg.color;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, cfg.xPct * canvas.width, cfg.yPct * canvas.height);
  }

  drawLine(fullName || "Participant", CERT_TEXT_CONFIG.name);
  drawLine(eventTitle || "", CERT_TEXT_CONFIG.event);
  drawLine(eventDate ? `Given on ${eventDate}` : "", CERT_TEXT_CONFIG.date);

  return canvas;
}

function downloadCanvasAsPng(canvas, filename) {
  canvas.toBlob((blob) => {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    // Revoking immediately can race with the browser handing the file off
    // to its download manager (seen in the wild as "nothing downloads" on
    // some desktop browsers) — give it a beat first.
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }, "image/png");
}

function safeFilenamePart(text) {
  return (text || "certificate").trim().replace(/\s+/g, "_").replace(/[^\w-]/g, "");
}

/* =========================
   CSV EXPORT
   ========================= */

function csvCellDate(timestamp) {
  if (!timestamp || !timestamp.toDate) return "";
  return timestamp.toDate().toLocaleString();
}

function downloadCsv(filename, headers, rows) {
  const escapeCell = (val) => {
    const str = (val === undefined || val === null) ? "" : String(val);
    if (/[",\n]/.test(str)) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  };

  const lines = [headers.map(escapeCell).join(",")];
  rows.forEach((row) => {
    lines.push(row.map(escapeCell).join(","));
  });

  // Leading BOM so Excel opens UTF-8 CSVs correctly instead of mangling accents.
  const csvContent = "\uFEFF" + lines.join("\r\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // See downloadCanvasAsPng — revoking immediately can race with the
  // browser actually starting the download.
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}


/* =========================
   ID CARD GENERATION (TEMPLATE + PHOTO + TEXT OVERLAY)
   ========================= */

const ID_TEMPLATE_DOC = db.collection("settings").doc("idTemplate");

// Percentages of the template's width/height, so it scales with whatever
// size template gets uploaded. Colors are sampled directly from the actual
// uploaded template: navy matches the chairperson signature-block text,
// orange matches the "KATIPUNAN NG KABATAAN" banner.
const ID_THEME_NAVY = "#083D63";
const ID_THEME_ORANGE = "#FA8F2F";

const ID_TEXT_CONFIG = {
  name:      { xPct: 0.5, yPct: 0.60,  fontPct: 0.050, minFontPct: 0.026, maxWidthPct: 0.86, weight: "bold",   color: ID_THEME_NAVY },
  address:   { xPct: 0.5, yPct: 0.645, fontPct: 0.021, minFontPct: 0.014, maxWidthPct: 0.88, weight: "normal", color: ID_THEME_NAVY, label: "Address: " },
  birthdate: { xPct: 0.5, yPct: 0.660, fontPct: 0.021, minFontPct: 0.014, maxWidthPct: 0.88, weight: "normal", color: ID_THEME_NAVY, label: "Birthdate: " },
  contact:   { xPct: 0.5, yPct: 0.674, fontPct: 0.021, minFontPct: 0.014, maxWidthPct: 0.88, weight: "normal", color: ID_THEME_NAVY, label: "Contact: " },
  idNumber:  { xPct: 0.5, yPct: 0.703, fontPct: 0.025, minFontPct: 0.018, maxWidthPct: 0.7,  weight: "bold",   color: ID_THEME_NAVY, label: "ID No. " }
};

// Photo placement: a circle (center + diameter, as fractions of the
// template's dimensions), with an outline drawn with a drop shadow so it
// reads as floating above the card rather than flat against it.
const ID_PHOTO_CONFIG = {
  xPct: 0.5, yPct: 0.42, diameterPct: 0.45,
  outlineColor: ID_THEME_ORANGE, outlineWidthPct: 0.014,
  shadowColor: "rgba(0,0,0,0.35)", shadowBlurPct: 0.02, shadowOffsetYPct: 0.008
};

async function generateIdCardCanvas({ photoDataUrl, fullName, address, birthdate, contactNumber, idNumber }) {
  const doc = await ID_TEMPLATE_DOC.get();
  if (!doc.exists || !doc.data().imageData) {
    throw new Error("No ID template has been uploaded yet.");
  }

  const templateImg = await loadImageFromUrl(doc.data().imageData);

  const canvas = document.createElement("canvas");
  canvas.width = templateImg.naturalWidth;
  canvas.height = templateImg.naturalHeight;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(templateImg, 0, 0);

  if (photoDataUrl) {
    const photoImg = await loadImageFromUrl(photoDataUrl);
    const diameter = ID_PHOTO_CONFIG.diameterPct * canvas.width;
    const radius = diameter / 2;
    const cx = ID_PHOTO_CONFIG.xPct * canvas.width;
    const cy = ID_PHOTO_CONFIG.yPct * canvas.height;

    // Cover-fit (crop to a square) so the photo isn't distorted inside the circle
    const photoRatio = photoImg.naturalWidth / photoImg.naturalHeight;
    let sx = 0, sy = 0, sw = photoImg.naturalWidth, sh = photoImg.naturalHeight;
    if (photoRatio > 1) {
      sw = sh;
      sx = (photoImg.naturalWidth - sw) / 2;
    } else {
      sh = sw;
      sy = (photoImg.naturalHeight - sh) / 2;
    }

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(photoImg, sx, sy, sw, sh, cx - radius, cy - radius, diameter, diameter);
    ctx.restore();

    // Outline drawn separately (outside the clip) with a drop shadow.
    ctx.save();
    ctx.shadowColor = ID_PHOTO_CONFIG.shadowColor;
    ctx.shadowBlur = ID_PHOTO_CONFIG.shadowBlurPct * canvas.width;
    ctx.shadowOffsetY = ID_PHOTO_CONFIG.shadowOffsetYPct * canvas.height;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.lineWidth = ID_PHOTO_CONFIG.outlineWidthPct * canvas.width;
    ctx.strokeStyle = ID_PHOTO_CONFIG.outlineColor;
    ctx.stroke();
    ctx.restore();
  }

  // Draws text centered at cfg's position, shrinking the font (down to
  // minFontPct) if it would otherwise overflow maxWidthPct of the card —
  // keeps a long name/address from spilling off the edge.
  function drawFittedText(text, cfg) {
    if (!text) return;
    const maxWidth = (cfg.maxWidthPct ?? 0.86) * canvas.width;
    const minFontSize = Math.round((cfg.minFontPct ?? cfg.fontPct) * canvas.width);
    let fontSize = Math.round(cfg.fontPct * canvas.width);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    let width;
    do {
      ctx.font = `${cfg.weight} ${fontSize}px system-ui, sans-serif`;
      width = ctx.measureText(text).width;
      if (width <= maxWidth || fontSize <= minFontSize) break;
      fontSize -= 1;
    } while (true);
    ctx.fillStyle = cfg.color;
    ctx.fillText(text, cfg.xPct * canvas.width, cfg.yPct * canvas.height);
  }

  drawFittedText(fullName, ID_TEXT_CONFIG.name);
  drawFittedText(address ? ID_TEXT_CONFIG.address.label + address : "", ID_TEXT_CONFIG.address);
  drawFittedText(birthdate ? ID_TEXT_CONFIG.birthdate.label + birthdate : "", ID_TEXT_CONFIG.birthdate);
  drawFittedText(contactNumber ? ID_TEXT_CONFIG.contact.label + contactNumber : "", ID_TEXT_CONFIG.contact);
  drawFittedText(idNumber ? ID_TEXT_CONFIG.idNumber.label + idNumber : "", ID_TEXT_CONFIG.idNumber);

  return canvas;
}


/* =========================
   ID TEMPLATE (ADMIN UPLOAD)
   ========================= */

const idTemplatePreview = document.getElementById("idTemplatePreview");
const noIdTemplateText = document.getElementById("noIdTemplateText");
const idTemplateUploadForm = document.getElementById("idTemplateUploadForm");
const idTemplateFileInput = document.getElementById("idTemplateFile");

async function loadIdTemplatePreview() {
  if (!idTemplatePreview) return;

  try {
    const doc = await ID_TEMPLATE_DOC.get();
    if (doc.exists && doc.data().imageData) {
      idTemplatePreview.src = doc.data().imageData;
      idTemplatePreview.classList.remove("hidden");
      noIdTemplateText?.classList.add("hidden");
    } else {
      idTemplatePreview.classList.add("hidden");
      noIdTemplateText?.classList.remove("hidden");
    }
  } catch (err) {
    console.error("Failed to load ID template:", err);
    idTemplatePreview.classList.add("hidden");
    noIdTemplateText?.classList.remove("hidden");
  }
}

if (idTemplatePreview) {
  loadIdTemplatePreview();
}

idTemplateUploadForm?.addEventListener("submit", async (e) => {
  e.preventDefault();

  const file = idTemplateFileInput.files[0];
  if (!file) {
    alert("Please choose an image file.");
    return;
  }

  if (file.size > CERT_TEMPLATE_MAX_BYTES) {
    alert(
      `That image is too large (${Math.round(file.size / 1024)}KB). ` +
      `Please use an image under ${Math.round(CERT_TEMPLATE_MAX_BYTES / 1024)}KB.`
    );
    return;
  }

  const submitBtn = idTemplateUploadForm.querySelector("button[type='submit']");
  submitBtn.disabled = true;
  submitBtn.textContent = "Uploading…";

  try {
    const dataUrl = await readFileAsDataUrl(file);

    await ID_TEMPLATE_DOC.set({
      imageData: dataUrl,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    await loadIdTemplatePreview();
    alert("ID template uploaded.");
    idTemplateUploadForm.reset();
  } catch (err) {
    console.error("ID template upload failed:", err);
    alert("Upload failed: " + err.message);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Upload Template";
  }
});


/* =========================
   ADMIN – CREATE ANNOUNCEMENT
   ========================= */

const createAnnouncementForm = document.getElementById("createAnnouncementForm");

if (createAnnouncementForm) {
  createAnnouncementForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const titleInput = document.getElementById("announcementTitle");
    const bodyInput = document.getElementById("announcementBody");
    const pinnedInput = document.getElementById("announcementPinned");

    const title = titleInput.value.trim();
    const body = bodyInput.value.trim();
    const pinned = pinnedInput.checked;

    if (!title || !body) {
      alert("Please complete all required fields.");
      return;
    }

    try {
      const user = auth.currentUser;
      if (!user) {
        alert("You must be logged in as admin.");
        return;
      }

      await db.collection("announcements").add({
        title,
        body,
        pinned,
        createdBy: user.uid,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });

      createAnnouncementForm.reset();
      alert("Announcement posted successfully.");

    } catch (err) {
      console.error("Create announcement error:", err);
      alert(err.message);
    }
  });
}


/* =========================
   ADMIN – RENDER ANNOUNCEMENTS (READ/EDIT/DELETE)
   ========================= */

const adminAnnouncementList = document.getElementById("adminAnnouncementList");

function formatAnnouncementDate(timestamp) {
  if (!timestamp || !timestamp.toDate) return "Just now";
  return timestamp.toDate().toLocaleDateString(undefined, {
    year: "numeric", month: "short", day: "numeric"
  });
}

if (adminAnnouncementList) {
  db.collection("announcements")
    .orderBy("createdAt", "desc")
    .onSnapshot((snapshot) => {

      adminAnnouncementList.innerHTML = "";

      if (snapshot.empty) {
        adminAnnouncementList.innerHTML =
          '<p class="dashboard-subtext">No announcements yet.</p>';
        return;
      }

      // Stable sort: pinned first, otherwise keep createdAt desc order
      const docs = snapshot.docs.slice().sort((a, b) => {
        const aPinned = a.data().pinned ? 1 : 0;
        const bPinned = b.data().pinned ? 1 : 0;
        return bPinned - aPinned;
      });

      docs.forEach((doc) => {
        const announcement = doc.data();

        const card = document.createElement("div");
        card.className = "event-card admin-card collapsible-card";

        card.innerHTML = `
          <div class="collapsible-header" data-role="toggle-card">
            <div class="collapsible-header-text">
              <h3>${escapeHtml(announcement.title)}</h3>
              ${announcement.pinned ? '<span class="status-badge status-ongoing">PINNED</span>' : ""}
            </div>
            <span class="collapsible-chevron">▾</span>
          </div>

          <div class="collapsible-body">
            <p class="announcement-text">${escapeHtml(announcement.body)}</p>
            <p class="event-meta">Posted ${formatAnnouncementDate(announcement.createdAt)}</p>

            <div class="admin-actions horizontal">
              <button class="icon-btn edit"
                data-id="${doc.id}"
                title="Edit Announcement">
                ✏️
                <span>Edit</span>
              </button>

              <button class="icon-btn archive"
                data-id="${doc.id}"
                title="Delete Announcement"
                data-role="delete-announcement">
                🗑️
                <span>Delete</span>
              </button>
            </div>
          </div>
        `;

        adminAnnouncementList.appendChild(card);
      });
    });
}


/* =========================
   ADMIN – EDIT ANNOUNCEMENT
   ========================= */

const editAnnouncementModal = document.getElementById("editAnnouncementModal");
const editAnnouncementForm = document.getElementById("editAnnouncementForm");
const closeEditAnnouncementModal = document.getElementById("closeEditAnnouncementModal");

let editingAnnouncementId = null;

document.addEventListener("click", async (e) => {
  const btn = e.target.closest(".icon-btn.edit");
  if (!btn || !adminAnnouncementList || !adminAnnouncementList.contains(btn)) return;

  editingAnnouncementId = btn.dataset.id;

  try {
    const doc = await db.collection("announcements").doc(editingAnnouncementId).get();
    if (!doc.exists) return;

    const data = doc.data();

    editAnnouncementTitle.value = data.title || "";
    editAnnouncementBody.value = data.body || "";
    editAnnouncementPinned.checked = !!data.pinned;

    editAnnouncementModal.classList.remove("hidden");
  } catch (err) {
    console.error("Failed to load announcement for editing", err);
  }
});

closeEditAnnouncementModal?.addEventListener("click", () => {
  editAnnouncementModal.classList.add("hidden");
  editingAnnouncementId = null;
});

editAnnouncementForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!editingAnnouncementId) return;

  try {
    await db.collection("announcements").doc(editingAnnouncementId).update({
      title: editAnnouncementTitle.value.trim(),
      body: editAnnouncementBody.value.trim(),
      pinned: editAnnouncementPinned.checked
    });

    editAnnouncementModal.classList.add("hidden");
    editingAnnouncementId = null;
  } catch (err) {
    alert("Failed to save changes.");
    console.error(err);
  }
});


/* =========================
   ADMIN – DELETE ANNOUNCEMENT
   ========================= */

const deleteAnnouncementModal = document.getElementById("deleteAnnouncementModal");
const confirmDeleteAnnouncementBtn = document.getElementById("confirmDeleteAnnouncementBtn");
const cancelDeleteAnnouncementBtn = document.getElementById("cancelDeleteAnnouncementBtn");

let deletingAnnouncementId = null;

document.addEventListener("click", (e) => {
  const btn = e.target.closest('[data-role="delete-announcement"]');
  if (!btn) return;

  deletingAnnouncementId = btn.dataset.id;
  deleteAnnouncementModal.classList.remove("hidden");
});

cancelDeleteAnnouncementBtn?.addEventListener("click", () => {
  deleteAnnouncementModal.classList.add("hidden");
  deletingAnnouncementId = null;
});

confirmDeleteAnnouncementBtn?.addEventListener("click", async () => {
  if (!deletingAnnouncementId) return;

  try {
    await db.collection("announcements").doc(deletingAnnouncementId).delete();

    deleteAnnouncementModal.classList.add("hidden");
    deletingAnnouncementId = null;
  } catch (err) {
    alert("Failed to delete announcement.");
    console.error(err);
  }
});


/* =========================
   USER DASHBOARD – RENDER ANNOUNCEMENTS
   ========================= */

const announcementList = document.getElementById("announcementList");

if (announcementList) {
  db.collection("announcements")
    .orderBy("createdAt", "desc")
    .onSnapshot((snapshot) => {

      announcementList.innerHTML = "";

      if (snapshot.empty) {
        announcementList.innerHTML =
          '<p class="dashboard-subtext">No announcements yet.</p>';
        return;
      }

      const docs = snapshot.docs.slice().sort((a, b) => {
        const aPinned = a.data().pinned ? 1 : 0;
        const bPinned = b.data().pinned ? 1 : 0;
        return bPinned - aPinned;
      });

      docs.forEach((doc) => {
        const announcement = doc.data();

        const card = document.createElement("div");
        card.className = "announcement-card";

        card.innerHTML = `
          <p class="announcement-text">${escapeHtml(announcement.body)}</p>
          <span class="announcement-date">Posted ${formatAnnouncementDate(announcement.createdAt)}</span>
        `;

        announcementList.appendChild(card);
      });
    });
}


/* =========================
   ADMIN – RENDER EVENTS (READ ONLY)
   ========================= */

const adminEventList = document.getElementById("adminEventList");

if (adminEventList) {
  db.collection("events")
    .orderBy("date", "desc")
    .onSnapshot((snapshot) => {

      // Clear list
      adminEventList.innerHTML = "";

      if (snapshot.empty) {
        adminEventList.innerHTML =
          '<p class="dashboard-subtext">No events yet.</p>';
        return;
      }

      snapshot.forEach((doc) => {
        const event = doc.data();
        const displayStatus = getDisplayEventStatus(event);
        const capacityInfo = getCapacityInfo(event);

        // Auto-correct the stored status once its date has passed.
        // Self-limiting: once status is actually "completed" in Firestore,
        // this condition stops matching, so it won't loop.
        if (displayStatus === "completed" && event.status !== "completed") {
          db.collection("events").doc(doc.id).update({ status: "completed" })
            .catch((err) => console.error("Auto-complete failed:", err));
        }

        const card = document.createElement("div");
        card.className = "event-card admin-card collapsible-card";

        card.innerHTML = `
          <div class="collapsible-header" data-role="toggle-card">
            <div class="collapsible-header-text">
              <h3>${escapeHtml(event.title)}</h3>
              <span class="status-badge status-${displayStatus}">${displayStatus.toUpperCase()}</span>
              ${capacityInfo.isFull ? '<span class="status-badge status-full">FULL</span>' : ""}
            </div>
            <span class="collapsible-chevron">▾</span>
          </div>

          <div class="collapsible-body">
            <p class="event-meta">
              ${escapeHtml(event.date)} • ${escapeHtml(event.time)}
            </p>
            <p class="event-meta">
              📍 ${escapeHtml(event.location)}
            </p>
            ${capacityInfo.hasLimit ? `
              <p class="event-meta">
                👥 ${capacityInfo.registeredCount} / ${capacityInfo.capacity} registered
              </p>
            ` : ""}

            <div class="admin-actions horizontal">
              <button class="icon-btn status"
              data-id="${doc.id}"
              data-status="${displayStatus}"
              title="Change Status">
                ⏳
                <span>Status</span>
              </button>

              <button class="icon-btn edit"
                data-id="${doc.id}"
                title="Edit Event">
                ✏️
                <span>Edit</span>
              </button>

              <button class="icon-btn archive"
                data-id="${doc.id}"
                title="Archive Event">
                🗄️
                <span>Archive</span>
              </button>

              <button class="icon-btn registrants"
                data-id="${doc.id}"
                data-title="${escapeHtml(event.title)}"
                title="View Registrants">
                🧾
                <span>Registrants</span>
              </button>
            </div>
          </div>
        `;

        adminEventList.appendChild(card);
      });
    });
}







/* =========================
   ADMIN – EVENT STATUS MANAGEMENT (EXPLICIT)
   ========================= */
/* =========================
   ADMIN – STATUS MODAL LOGIC
   ========================= */

const statusModal = document.getElementById("statusModal");
const currentStatusText = document.getElementById("currentStatusText");
const closeStatusModal = document.getElementById("closeStatusModal");

let activeEventId = null;

// Open modal
document.addEventListener("click", (e) => {
  const btn = e.target.closest(".icon-btn.status");
  if (!btn) return;

  activeEventId = btn.dataset.id;
  const currentStatus = btn.dataset.status;

  currentStatusText.textContent =
    "Current status: " + currentStatus.toUpperCase();

  statusModal.classList.remove("hidden");
});

// Close modal
if (closeStatusModal) {
  closeStatusModal.addEventListener("click", () => {
    statusModal.classList.add("hidden");
    activeEventId = null;
  });
}

// Select new status
document.addEventListener("click", async (e) => {
  const option = e.target.closest(".status-option");
  if (!option || !activeEventId) return;

  const newStatus = option.dataset.status;

  try {
    await db.collection("events").doc(activeEventId).update({
      status: newStatus
    });

    statusModal.classList.add("hidden");
    activeEventId = null;
  } catch (err) {
    alert("Failed to update status.");
    console.error(err);
  }
});




/* =========================
   ADMIN – EDIT EVENT LOGIC
   ========================= */

const editEventModal = document.getElementById("editEventModal");
const editEventForm = document.getElementById("editEventForm");
const closeEditModal = document.getElementById("closeEditModal");

let editingEventId = null;

// Open Edit Modal
document.addEventListener("click", async (e) => {
  const btn = e.target.closest(".icon-btn.edit");
  if (!btn || !adminEventList || !adminEventList.contains(btn)) return;

  editingEventId = btn.dataset.id;

  try {
    const doc = await db.collection("events").doc(editingEventId).get();
    if (!doc.exists) return;

    const data = doc.data();

    editTitle.value = data.title || "";
    editDescription.value = data.description || "";
    editDate.value = data.date || "";
    editTime.value = data.time || "";
    editLocation.value = data.location || "";
    editCapacity.value = data.capacity || "";

    editEventModal.classList.remove("hidden");
  } catch (err) {
    console.error("Failed to load event for editing", err);
  }
});

// Close Edit Modal
if (closeEditModal) {
  closeEditModal.addEventListener("click", () => {
    editEventModal.classList.add("hidden");
    editingEventId = null;
  });
}

// Save Changes
if (editEventForm) {
  editEventForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!editingEventId) return;

    try {
      const editCapacityRaw = parseInt(editCapacity.value, 10);
      const editCapacityValue = (editCapacity.value.trim() && editCapacityRaw > 0) ? editCapacityRaw : null;

      await db.collection("events").doc(editingEventId).update({
        title: editTitle.value.trim(),
        description: editDescription.value.trim(),
        date: editDate.value,
        time: editTime.value,
        location: editLocation.value,
        capacity: editCapacityValue
      });

      editEventModal.classList.add("hidden");
      editingEventId = null;
    } catch (err) {
      alert("Failed to save changes.");
      console.error(err);
    }
  });
}


/* =========================
   ADMIN – ARCHIVE EVENT
   ========================= */

const archiveEventModal = document.getElementById("archiveEventModal");
const confirmArchiveBtn = document.getElementById("confirmArchiveBtn");
const cancelArchiveBtn = document.getElementById("cancelArchiveBtn");

let archivingEventId = null;

// Open Archive Modal
document.addEventListener("click", (e) => {
  const btn = e.target.closest(".icon-btn.archive");
  if (!btn || !adminEventList || !adminEventList.contains(btn)) return;

  archivingEventId = btn.dataset.id;
  archiveEventModal.classList.remove("hidden");
});

// Cancel Archive
if (cancelArchiveBtn) {
  cancelArchiveBtn.addEventListener("click", () => {
    archiveEventModal.classList.add("hidden");
    archivingEventId = null;
  });
}

// Confirm Archive
if (confirmArchiveBtn) {
  confirmArchiveBtn.addEventListener("click", async () => {
    if (!archivingEventId) return;

    try {
      await db.collection("events").doc(archivingEventId).update({
        status: "archived"
      });

      archiveEventModal.classList.add("hidden");
      archivingEventId = null;
    } catch (err) {
      alert("Failed to archive event.");
      console.error(err);
    }
  });
}



/* =========================
   ADMIN – REGISTRANTS / ATTENDANCE
   ========================= */

const registrantsModal = document.getElementById("registrantsModal");
const registrantsList = document.getElementById("registrantsList");
const registrantsEventTitle = document.getElementById("registrantsEventTitle");
const closeRegistrantsModal = document.getElementById("closeRegistrantsModal");
const printRegistrantsBtn = document.getElementById("printRegistrantsBtn");
const generateAllCertificatesBtn = document.getElementById("generateAllCertificatesBtn");
const exportRegistrantsBtn = document.getElementById("exportRegistrantsBtn");

let activeRegistrantsEventId = null;
let activeRegistrantsEventData = null;
let activeRegistrantsData = [];
let registrantsUnsubscribe = null;

// Open modal + live-listen to registrants for this event
document.addEventListener("click", async (e) => {
  const btn = e.target.closest(".icon-btn.registrants");
  if (!btn) return;

  await ensureCurrentUserRole();

  activeRegistrantsEventId = btn.dataset.id;
  activeRegistrantsEventData = null;

  if (registrantsEventTitle) {
    registrantsEventTitle.textContent = btn.dataset.title || "";
  }
  if (registrantsList) {
    registrantsList.innerHTML = '<p class="dashboard-subtext">Loading…</p>';
  }
  registrantsModal?.classList.remove("hidden");

  // Fetch the full event doc once (need date + title for certificates)
  try {
    const eventDoc = await db.collection("events").doc(activeRegistrantsEventId).get();
    activeRegistrantsEventData = eventDoc.exists ? eventDoc.data() : null;
  } catch (err) {
    console.error("Failed to load event details:", err);
  }

  if (registrantsUnsubscribe) registrantsUnsubscribe();

  registrantsUnsubscribe = db.collection("registrations")
    .where("eventId", "==", activeRegistrantsEventId)
    .onSnapshot((snapshot) => {
      if (!registrantsList) return;
      registrantsList.innerHTML = "";

      activeRegistrantsData = snapshot.docs.map((d) => d.data());

      if (snapshot.empty) {
        registrantsList.innerHTML =
          '<p class="dashboard-subtext">No registrants yet.</p>';
        return;
      }

      const sortedDocs = sortByLastName(snapshot.docs, (doc) => doc.data().fullName);

      sortedDocs.forEach((doc) => {
        const reg = doc.data();

        const row = document.createElement("div");
        row.className = "registrant-row";

        if (reg.removed) {
          row.innerHTML = `
            <div class="registrant-info">
              <strong>${escapeHtml(reg.fullName || "Unknown")}</strong>
              <span class="status-badge status-full">REMOVED</span>
              ${reg.removedReason ? `<span class="event-meta">${escapeHtml(reg.removedReason)}</span>` : ""}
            </div>
            <div class="registrant-actions">
              ${currentUserRole === "superadmin" ? `
                <button type="button"
                  class="cert-btn"
                  data-role="restore-registrant"
                  data-id="${doc.id}"
                  data-fullname="${escapeHtml(reg.fullName || "Unknown")}"
                  title="Restore to this event">
                  ↩️ Restore
                </button>
              ` : '<span class="dashboard-subtext">Only a super admin can restore</span>'}
            </div>
          `;
          registrantsList.appendChild(row);
          return;
        }

        row.innerHTML = `
          <div class="registrant-info">
            <strong>${escapeHtml(reg.fullName || "Unknown")}</strong>
            <span class="event-meta">${escapeHtml(reg.email || "")}</span>
          </div>
          <div class="registrant-actions">
            <label class="attendance-toggle">
              <input type="checkbox"
                class="attendance-checkbox"
                data-id="${doc.id}"
                ${reg.attended ? "checked" : ""}>
              Attended
            </label>
            <button type="button"
              class="cert-btn"
              data-role="generate-certificate"
              data-fullname="${escapeHtml(reg.fullName || "")}"
              ${reg.attended ? "" : "disabled"}
              title="${reg.attended ? "Generate certificate" : "Mark attended first"}">
              🎓 Certificate
            </button>
            ${currentUserRole === "superadmin" ? `
              <button type="button"
                class="cert-btn"
                data-role="remove-registrant"
                data-id="${doc.id}"
                data-userid="${reg.userId || ""}"
                data-fullname="${escapeHtml(reg.fullName || "Unknown")}"
                title="Remove from event">
                🚫 Remove
              </button>
            ` : ""}
          </div>
        `;

        registrantsList.appendChild(row);
      });
    }, (err) => {
      console.error("Failed to load registrants:", err);
      if (registrantsList) {
        registrantsList.innerHTML =
          '<p class="dashboard-subtext">Failed to load registrants.</p>';
      }
    });
});

// Close modal
closeRegistrantsModal?.addEventListener("click", () => {
  registrantsModal?.classList.add("hidden");
  if (registrantsUnsubscribe) {
    registrantsUnsubscribe();
    registrantsUnsubscribe = null;
  }
  activeRegistrantsEventId = null;
  activeRegistrantsEventData = null;
});

// Toggle attendance
document.addEventListener("change", async (e) => {
  const checkbox = e.target.closest(".attendance-checkbox");
  if (!checkbox) return;

  const registrationId = checkbox.dataset.id;
  const attended = checkbox.checked;

  try {
    await db.collection("registrations").doc(registrationId).update({
      attended,
      checkedInAt: attended
        ? firebase.firestore.FieldValue.serverTimestamp()
        : null
    });
  } catch (err) {
    console.error("Failed to update attendance:", err);
    alert("Failed to update attendance.");
    checkbox.checked = !attended; // revert on failure
  }
});

// Print registrant list
printRegistrantsBtn?.addEventListener("click", () => {
  window.print();
});

// Export registrant list to CSV
exportRegistrantsBtn?.addEventListener("click", async () => {
  if (activeRegistrantsData.length === 0) {
    alert("No registrants to export.");
    return;
  }

  const eventTitle = activeRegistrantsEventData?.title || "event";
  const originalLabel = exportRegistrantsBtn.textContent;
  exportRegistrantsBtn.disabled = true;
  exportRegistrantsBtn.textContent = "Exporting…";

  try {
    // Address/contact live on the user doc, not the registration itself —
    // fetched fresh here (rather than relying on a snapshot taken at join
    // time) so the export reflects their current details.
    const userDocs = await Promise.all(
      activeRegistrantsData.map((reg) =>
        reg.userId ? db.collection("users").doc(reg.userId).get().catch(() => null) : Promise.resolve(null)
      )
    );

    const rows = activeRegistrantsData.map((reg, i) => {
      const userDoc = userDocs[i];
      const userData = userDoc && userDoc.exists ? userDoc.data() : {};
      return [
        reg.fullName || "",
        reg.email || "",
        userData?.address || "",
        userData?.contactNumber || "",
        reg.attended ? "Yes" : "No",
        csvCellDate(reg.registeredAt),
        reg.attended ? csvCellDate(reg.checkedInAt) : ""
      ];
    });

    downloadCsv(
      `Registrants-${safeFilenamePart(eventTitle)}.csv`,
      ["Full Name", "Email", "Address", "Contact Number", "Attended", "Registered At", "Checked In At"],
      rows
    );
  } catch (err) {
    console.error("Failed to export registrants:", err);
    alert("Failed to export registrants. Please try again.");
  } finally {
    exportRegistrantsBtn.disabled = false;
    exportRegistrantsBtn.textContent = originalLabel;
  }
});

// Generate a single certificate
document.addEventListener("click", async (e) => {
  const btn = e.target.closest('[data-role="generate-certificate"]');
  if (!btn || btn.disabled) return;
  if (!activeRegistrantsEventData) {
    alert("Event details aren't loaded yet — try again in a moment.");
    return;
  }

  const fullName = btn.dataset.fullname;
  const originalLabel = btn.innerHTML;
  btn.disabled = true;
  btn.textContent = "Generating…";

  try {
    const canvas = await generateCertificateCanvas({
      fullName,
      eventTitle: activeRegistrantsEventData.title,
      eventDate: activeRegistrantsEventData.date
    });
    downloadCanvasAsPng(canvas, `Certificate-${safeFilenamePart(fullName)}.png`);
  } catch (err) {
    console.error("Certificate generation failed:", err);
    alert("Couldn't generate the certificate. Has a template been uploaded yet? (Admin Panel → Certificates)");
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalLabel;
  }
});

/* =========================
   ADMIN – REMOVE REGISTRANT
   Frees up their slot (decrements the event's registeredCount if it has a
   capacity limit) and sends them a message via the existing SK-office
   thread system explaining why, so they can reply if they want it
   reconsidered — reuses the messaging feature that already exists rather
   than building a separate notification path.
   ========================= */

const removeRegistrantModal = document.getElementById("removeRegistrantModal");
const removeRegistrantName = document.getElementById("removeRegistrantName");
const removeRegistrantReason = document.getElementById("removeRegistrantReason");
const confirmRemoveRegistrantBtn = document.getElementById("confirmRemoveRegistrantBtn");
const cancelRemoveRegistrantBtn = document.getElementById("cancelRemoveRegistrantBtn");

let removingRegistration = null; // { registrationId, userId, fullName }

document.addEventListener("click", (e) => {
  const btn = e.target.closest('[data-role="remove-registrant"]');
  if (!btn) return;

  removingRegistration = {
    registrationId: btn.dataset.id,
    userId: btn.dataset.userid,
    fullName: btn.dataset.fullname
  };

  const eventTitle = activeRegistrantsEventData?.title || "this event";
  removeRegistrantName.textContent = removingRegistration.fullName;
  removeRegistrantReason.value =
    `We're unable to confirm you're a resident of Barangay 171 Bagumbong based on the ID on file, so we've removed your registration for "${eventTitle}". If you believe this is a mistake, please reply here with additional proof of residency and we'll take another look.`;

  removeRegistrantModal?.classList.remove("hidden");
});

cancelRemoveRegistrantBtn?.addEventListener("click", () => {
  removeRegistrantModal?.classList.add("hidden");
  removingRegistration = null;
});

confirmRemoveRegistrantBtn?.addEventListener("click", async () => {
  if (!removingRegistration || !activeRegistrantsEventId) return;

  const reason = removeRegistrantReason.value.trim();
  if (!reason) {
    alert("Please enter a reason — it's sent to them as the message.");
    return;
  }
  if (!removingRegistration.userId) {
    alert("Couldn't find this registrant's account — try reopening the registrants list.");
    return;
  }

  const admin = auth.currentUser;
  confirmRemoveRegistrantBtn.disabled = true;

  try {
    let adminFullName = "SK Office";
    try {
      const adminDoc = await db.collection("users").doc(admin.uid).get();
      adminFullName = adminDoc.exists ? (adminDoc.data().fullName || "SK Office") : "SK Office";
    } catch (err) {
      console.error("Failed to fetch admin name:", err);
    }

    const eventTitle = activeRegistrantsEventData?.title || "Event";
    const threadRef = db.collection("threads").doc();
    const messageRef = threadRef.collection("messages").doc();

    const batch = db.batch();
    // Soft-removed (not deleted) so an admin can Restore them later — the
    // rules only let an admin flip this, so it can't be undone just by the
    // resident re-clicking "Join Event".
    batch.update(db.collection("registrations").doc(removingRegistration.registrationId), {
      removed: true,
      removedReason: reason,
      removedBy: admin.uid,
      removedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    batch.update(db.collection("events").doc(activeRegistrantsEventId), {
      registeredCount: firebase.firestore.FieldValue.increment(-1)
    });
    batch.set(threadRef, {
      userId: removingRegistration.userId,
      userFullName: removingRegistration.fullName,
      subject: `Registration Removed – ${eventTitle}`,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      lastMessageText: reason,
      lastMessageAt: firebase.firestore.FieldValue.serverTimestamp(),
      unreadByAdmin: false,
      unreadByUser: true
    });
    batch.set(messageRef, {
      senderId: admin.uid,
      senderRole: "admin",
      senderName: adminFullName,
      text: reason,
      sentAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    await batch.commit();

    removeRegistrantModal?.classList.add("hidden");
    removingRegistration = null;
  } catch (err) {
    console.error("Failed to remove registrant:", err);
    alert("Failed to remove this registrant. Please try again.");
  } finally {
    confirmRemoveRegistrantBtn.disabled = false;
  }
});

// Restore a previously-removed registrant. Runs as a transaction against
// the event doc for the same reason the original join does — re-checks
// capacity fresh, since other people may have joined in the meantime.
document.addEventListener("click", async (e) => {
  const btn = e.target.closest('[data-role="restore-registrant"]');
  if (!btn || btn.disabled) return;
  if (!activeRegistrantsEventId) return;

  if (!confirm(`Restore ${btn.dataset.fullname} to this event?`)) return;

  btn.disabled = true;
  btn.textContent = "Restoring…";

  try {
    const eventRef = db.collection("events").doc(activeRegistrantsEventId);
    const registrationRef = db.collection("registrations").doc(btn.dataset.id);

    await db.runTransaction(async (tx) => {
      const eventDoc = await tx.get(eventRef);
      if (!eventDoc.exists) throw new Error("EVENT_NOT_FOUND");

      const capacityInfo = getCapacityInfo(eventDoc.data());
      if (capacityInfo.isFull) throw new Error("EVENT_FULL");

      tx.update(eventRef, { registeredCount: capacityInfo.registeredCount + 1 });
      tx.update(registrationRef, {
        removed: false,
        removedReason: firebase.firestore.FieldValue.delete(),
        removedBy: firebase.firestore.FieldValue.delete(),
        removedAt: firebase.firestore.FieldValue.delete()
      });
    });
  } catch (err) {
    console.error("Failed to restore registrant:", err);
    if (err.message === "EVENT_FULL") {
      alert("This event is at capacity right now — free up a slot first, or raise the limit, then try again.");
    } else {
      alert("Failed to restore this registrant. Please try again.");
    }
    btn.disabled = false;
    btn.textContent = "↩️ Restore";
  }
});

// Bulk-generate certificates for every attended registrant of this event
generateAllCertificatesBtn?.addEventListener("click", async () => {
  if (!activeRegistrantsEventId || !activeRegistrantsEventData) {
    alert("Event details aren't loaded yet — try again in a moment.");
    return;
  }

  let snap;
  try {
    snap = await db.collection("registrations")
      .where("eventId", "==", activeRegistrantsEventId)
      .where("attended", "==", true)
      .get();
  } catch (err) {
    console.error("Failed to load attended registrants:", err);
    alert("Couldn't load the attended registrant list.");
    return;
  }

  if (snap.empty) {
    alert("No attended registrants yet — mark attendance first.");
    return;
  }

  generateAllCertificatesBtn.disabled = true;
  generateAllCertificatesBtn.textContent = `Generating 0/${snap.docs.length}…`;

  try {
    for (let i = 0; i < snap.docs.length; i++) {
      const reg = snap.docs[i].data();
      const canvas = await generateCertificateCanvas({
        fullName: reg.fullName,
        eventTitle: activeRegistrantsEventData.title,
        eventDate: activeRegistrantsEventData.date
      });
      downloadCanvasAsPng(canvas, `Certificate-${safeFilenamePart(reg.fullName)}.png`);
      generateAllCertificatesBtn.textContent = `Generating ${i + 1}/${snap.docs.length}…`;
      // Small stagger so the browser doesn't block multiple rapid downloads
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  } catch (err) {
    console.error("Bulk certificate generation failed:", err);
    alert("Something went wrong partway through. Check the browser console — some certificates may not have generated. Has a template been uploaded yet?");
  } finally {
    generateAllCertificatesBtn.disabled = false;
    generateAllCertificatesBtn.textContent = "Generate All Certificates";
  }
});


/* =========================
   ADMIN – OVERVIEW STATS ROLLUP
   ========================= */

const statUpcomingEvents = document.getElementById("statUpcomingEvents");
const statTotalRegistrations = document.getElementById("statTotalRegistrations");
const statTotalAttended = document.getElementById("statTotalAttended");
const statPendingApplicants = document.getElementById("statPendingApplicants");
const statApprovedApplicants = document.getElementById("statApprovedApplicants");
const statUnreadMessages = document.getElementById("statUnreadMessages");

if (statUpcomingEvents) {
  db.collection("events")
    .where("status", "in", ["upcoming", "ongoing"])
    .onSnapshot((snapshot) => {
      statUpcomingEvents.textContent = snapshot.size;
    }, (err) => console.error("Overview: events count failed:", err));
}

if (statTotalRegistrations) {
  db.collection("registrations").onSnapshot((snapshot) => {
    statTotalRegistrations.textContent = snapshot.size;

    let attended = 0;
    snapshot.forEach((doc) => {
      if (doc.data().attended) attended++;
    });
    if (statTotalAttended) statTotalAttended.textContent = attended;
  }, (err) => console.error("Overview: registrations count failed:", err));
}

if (statPendingApplicants || statApprovedApplicants) {
  db.collection("users")
    .where("role", "==", "user")
    .onSnapshot((snapshot) => {
      let pending = 0;
      let approved = 0;

      snapshot.forEach((doc) => {
        const u = doc.data();
        const hasCompleteProfile = u.address && u.birthdate && u.contactNumber && u.photoData;
        if (!hasCompleteProfile) return;

        const status = u.idStatus || "pending";
        if (status === "approved") approved++;
        else if (status === "pending") pending++;
      });

      if (statPendingApplicants) statPendingApplicants.textContent = pending;
      if (statApprovedApplicants) statApprovedApplicants.textContent = approved;
    }, (err) => console.error("Overview: applicant counts failed:", err));
}

if (statUnreadMessages) {
  db.collection("threads")
    .where("unreadByAdmin", "==", true)
    .onSnapshot((snapshot) => {
      statUnreadMessages.textContent = snapshot.size;
    }, (err) => console.error("Overview: unread messages count failed:", err));
}


/* =========================
   ADMIN – UNREAD MESSAGES BADGE
   ========================= */

const adminUnreadBadge = document.getElementById("adminUnreadBadge");

if (adminUnreadBadge) {
  db.collection("threads")
    .where("unreadByAdmin", "==", true)
    .onSnapshot((snapshot) => {
      if (snapshot.size > 0) {
        adminUnreadBadge.textContent = snapshot.size;
        adminUnreadBadge.classList.remove("hidden");
      } else {
        adminUnreadBadge.classList.add("hidden");
      }
    }, (err) => {
      console.error("Failed to load unread count:", err);
    });
}


/* =========================
   ADMIN – PENDING PROFILE CHANGE REQUEST BADGE
   ========================= */

const adminAddressRequestBadge = document.getElementById("adminAddressRequestBadge");

if (adminAddressRequestBadge) {
  db.collection("profileChangeRequests")
    .where("status", "==", "pending")
    .onSnapshot((snapshot) => {
      if (snapshot.size > 0) {
        adminAddressRequestBadge.textContent = snapshot.size;
        adminAddressRequestBadge.classList.remove("hidden");
      } else {
        adminAddressRequestBadge.classList.add("hidden");
      }
    }, (err) => {
      console.error("Failed to load pending profile change request count:", err);
    });
}


/* =========================
   ADMIN – USERS DIRECTORY (admin-manage-users.html)
   ========================= */

const usersList = document.getElementById("usersList");
const userTabPendingCount = document.getElementById("userTabPendingCount");
const userTabApprovedCount = document.getElementById("userTabApprovedCount");
let usersTab = "pending";

// Staff accounts (admin/superadmin) are always considered "approved" here —
// they don't go through ID review, so they'd never otherwise leave Pending.
function isApprovedUserDoc(doc) {
  const u = doc.data();
  return isAdminRole(u.role) || u.idStatus === "approved";
}

if (usersList) {
  let cachedUsers = [];
  let pendingProfileRequestsByUser = new Map();

  document.querySelectorAll(".admin-tab-btn").forEach((tabBtn) => {
    tabBtn.addEventListener("click", () => {
      usersTab = tabBtn.dataset.tab;
      document.querySelectorAll(".admin-tab-btn").forEach((b) => b.classList.remove("active"));
      tabBtn.classList.add("active");
      renderUsersList();
    });
  });

  function renderUsersList() {
    if (cachedUsers.length === 0) {
      usersList.innerHTML = '<p class="dashboard-subtext">No users yet.</p>';
      if (userTabPendingCount) userTabPendingCount.textContent = "";
      if (userTabApprovedCount) userTabApprovedCount.textContent = "";
      return;
    }

    const approvedCount = cachedUsers.filter(isApprovedUserDoc).length;
    const pendingCount = cachedUsers.length - approvedCount;
    if (userTabPendingCount) userTabPendingCount.textContent = `(${pendingCount})`;
    if (userTabApprovedCount) userTabApprovedCount.textContent = `(${approvedCount})`;

    const visibleUsers = cachedUsers.filter((doc) =>
      usersTab === "approved" ? isApprovedUserDoc(doc) : !isApprovedUserDoc(doc)
    );

    usersList.innerHTML = "";

    if (visibleUsers.length === 0) {
      usersList.innerHTML = `<p class="dashboard-subtext">No ${usersTab} users.</p>`;
      return;
    }

    visibleUsers.forEach((doc) => {
      const u = doc.data();
      const pendingRequest = pendingProfileRequestsByUser.get(doc.id);
      const idStatus = u.idStatus || "pending";
      const requested = pendingRequest ? (pendingRequest.requested || {}) : null;

      const card = document.createElement("div");
      card.className = "event-card admin-card collapsible-card";

      const fullNameSafe = escapeHtml(u.fullName || "");

      card.innerHTML = `
        <div class="collapsible-header" data-role="toggle-card">
          <div class="collapsible-header-text">
            ${u.photoData ? `<img class="id-app-thumb" src="${u.photoData}" alt="${fullNameSafe}">` : ""}
            <h3>${u.fullName ? fullNameSafe : "Unknown"}</h3>
            ${!isAdminRole(u.role) ? `
              <span class="status-badge ${idStatusBadgeClass(idStatus)}">${idStatus.toUpperCase()}</span>
            ` : ""}
            ${pendingRequest ? '<span class="status-badge status-archived">CHANGE REQUEST</span>' : ""}
          </div>
          <span class="collapsible-chevron">▾</span>
        </div>

        <div class="collapsible-body">
          <p class="event-meta">${escapeHtml(u.email || "")}</p>
          <p class="event-meta">${escapeHtml(u.address || "No address on file")}</p>
          <p class="event-meta">🎂 ${escapeHtml(u.birthdate || "")} · 📞 ${escapeHtml(u.contactNumber || "")}</p>
          ${u.idNumber ? `<p class="event-meta"><strong>${escapeHtml(u.idNumber)}</strong></p>` : ""}

          ${u.idDocumentData ? `
            <p class="event-meta">Submitted ID:</p>
            <img src="${u.idDocumentData}" alt="ID for ${fullNameSafe}"
              style="width:100%; height:auto; max-height:200px; object-fit:contain; border-radius:10px; margin-bottom:10px;">
          ` : ""}

          ${pendingRequest ? `
            <p class="event-meta"><strong>Requested changes:</strong></p>
            ${requested.fullName && requested.fullName !== u.fullName ? `<p class="dashboard-subtext">Name: ${escapeHtml(u.fullName || "—")} → <strong>${escapeHtml(requested.fullName)}</strong></p>` : ""}
            ${requested.birthdate && requested.birthdate !== u.birthdate ? `<p class="dashboard-subtext">Birthdate: ${escapeHtml(u.birthdate || "—")} → <strong>${escapeHtml(requested.birthdate)}</strong></p>` : ""}
            ${requested.contactNumber && requested.contactNumber !== u.contactNumber ? `<p class="dashboard-subtext">Contact: ${escapeHtml(u.contactNumber || "—")} → <strong>${escapeHtml(requested.contactNumber)}</strong></p>` : ""}
            ${requested.address && requested.address !== u.address ? `<p class="dashboard-subtext">Address: ${escapeHtml(u.address || "—")} → <strong>${escapeHtml(requested.address)}</strong></p>` : ""}

            ${pendingRequest.proofPhotoData ? `
              <p class="event-meta" style="margin-top:8px;">Proof submitted:</p>
              <img src="${pendingRequest.proofPhotoData}" alt="Proof for ${fullNameSafe}"
                style="width:100%; height:auto; max-height:200px; object-fit:contain; border-radius:10px; margin-bottom:10px;">
            ` : ""}

            <div class="admin-actions horizontal">
              <button class="icon-btn status"
                data-role="approve-profile-change" data-id="${doc.id}"
                title="Approve Changes">
                ✅
                <span>Approve</span>
              </button>
              <button class="icon-btn archive"
                data-role="reject-profile-change" data-id="${doc.id}"
                title="Reject Changes">
                ❌
                <span>Reject</span>
              </button>
            </div>
          ` : ""}

          ${currentUserRole === "superadmin" && !isAdminRole(u.role) ? `
            <div class="admin-actions horizontal">
              <button class="icon-btn archive"
                data-role="delete-user" data-id="${doc.id}" data-name="${fullNameSafe}"
                title="Delete User">
                🗑️
                <span>Delete User</span>
              </button>
            </div>
          ` : ""}
        </div>
      `;

      usersList.appendChild(card);
    });
  }

  ensureCurrentUserRole().then(() => {
    db.collection("users")
      .onSnapshot((snapshot) => {
        cachedUsers = sortByLastName(snapshot.docs, (doc) => doc.data().fullName);
        renderUsersList();
      }, (err) => {
        console.error("Failed to load users:", err);
        usersList.innerHTML = '<p class="dashboard-subtext">Failed to load users.</p>';
      });
  });

  db.collection("profileChangeRequests")
    .where("status", "==", "pending")
    .onSnapshot((snapshot) => {
      pendingProfileRequestsByUser = new Map(
        snapshot.docs.map((d) => [d.id, d.data()])
      );
      renderUsersList();
    }, (err) => {
      console.error("Failed to load profile change requests:", err);
    });

  const exportUsersBtn = document.getElementById("exportUsersBtn");
  exportUsersBtn?.addEventListener("click", () => {
    if (cachedUsers.length === 0) {
      alert("No users to export.");
      return;
    }

    const rows = cachedUsers.map((doc) => {
      const u = doc.data();
      return [
        u.fullName || "",
        u.email || "",
        u.role || "user",
        u.address || "",
        u.birthdate || "",
        u.contactNumber || "",
        isAdminRole(u.role) ? "" : (u.idStatus || "pending"),
        u.idNumber || "",
        csvCellDate(u.createdAt)
      ];
    });

    downloadCsv(
      `Users-${new Date().toISOString().slice(0, 10)}.csv`,
      ["Full Name", "Email", "Role", "Address", "Birthdate", "Contact Number", "ID Status", "ID Number", "Created At"],
      rows
    );
  });
}


/* =========================
   ADMIN – DELETE USER (admin-manage-users.html)
   Removes the user's Firestore profile/app data only — it does not touch
   their Firebase Authentication account (the client SDK can't delete
   another user's login; that needs the Admin SDK or the Firebase Console).
   ========================= */

const deleteUserModal = document.getElementById("deleteUserModal");
const deleteUserNameEl = document.getElementById("deleteUserName");
const confirmDeleteUserBtn = document.getElementById("confirmDeleteUserBtn");
const cancelDeleteUserBtn = document.getElementById("cancelDeleteUserBtn");

let deletingUserId = null;

document.addEventListener("click", (e) => {
  const btn = e.target.closest('[data-role="delete-user"]');
  if (!btn) return;

  deletingUserId = btn.dataset.id;
  if (deleteUserNameEl) deleteUserNameEl.textContent = btn.dataset.name || "this user";
  deleteUserModal?.classList.remove("hidden");
});

cancelDeleteUserBtn?.addEventListener("click", () => {
  deleteUserModal?.classList.add("hidden");
  deletingUserId = null;
});

confirmDeleteUserBtn?.addEventListener("click", async () => {
  if (!deletingUserId) return;

  confirmDeleteUserBtn.disabled = true;

  try {
    await db.collection("users").doc(deletingUserId).delete();

    // Best-effort cleanup of any pending profile change request tied to
    // this user — not required for the deletion to succeed.
    db.collection("profileChangeRequests").doc(deletingUserId).delete().catch(() => {});

    deleteUserModal?.classList.add("hidden");
    deletingUserId = null;
  } catch (err) {
    alert("Failed to delete user.");
    console.error(err);
  } finally {
    confirmDeleteUserBtn.disabled = false;
  }
});

// Approve / Reject a profile change request
document.addEventListener("click", async (e) => {
  const btn = e.target.closest('[data-role="approve-profile-change"], [data-role="reject-profile-change"]');
  if (!btn) return;

  const userId = btn.dataset.id;
  const isApprove = btn.dataset.role === "approve-profile-change";
  const admin = auth.currentUser;

  if (!isApprove && !confirm("Reject this profile change request?")) return;

  try {
    if (isApprove) {
      const requestDoc = await db.collection("profileChangeRequests").doc(userId).get();
      if (!requestDoc.exists) return;
      const requested = requestDoc.data().requested || {};

      const batch = db.batch();
      batch.update(db.collection("users").doc(userId), {
        fullName: requested.fullName,
        birthdate: requested.birthdate,
        contactNumber: requested.contactNumber,
        address: requested.address
      });
      batch.update(db.collection("profileChangeRequests").doc(userId), {
        status: "approved",
        reviewedBy: admin.uid,
        reviewedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      await batch.commit();
    } else {
      await db.collection("profileChangeRequests").doc(userId).update({
        status: "rejected",
        reviewedBy: admin.uid,
        reviewedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    }
  } catch (err) {
    console.error("Failed to update profile change request:", err);
    alert("Failed to update the request.");
  }
});


/* =========================
   ADMIN – MESSAGES (admin-messages.html)
   ========================= */

const conversationsList = document.getElementById("conversationsList");
const chatThreadModal = document.getElementById("chatThreadModal");
const chatThreadUserName = document.getElementById("chatThreadUserName");
const adminChatThread = document.getElementById("adminChatThread");
const adminChatSendForm = document.getElementById("adminChatSendForm");
const adminChatMessageInput = document.getElementById("adminChatMessageInput");
const closeChatThreadModal = document.getElementById("closeChatThreadModal");

let activeThreadId = null;
let activeThreadUnsubscribe = null;

if (conversationsList) {
  db.collection("threads")
    .orderBy("lastMessageAt", "desc")
    .onSnapshot((snapshot) => {

      conversationsList.innerHTML = "";

      if (snapshot.empty) {
        conversationsList.innerHTML =
          '<p class="dashboard-subtext">No conversations yet.</p>';
        return;
      }

      snapshot.forEach((doc) => {
        const thread = doc.data();
        const name = thread.userFullName || "Unknown";
        const initials = name
          .split(/\s+/)
          .map(w => w[0])
          .slice(0, 2)
          .join("")
          .toUpperCase();

        const row = document.createElement("div");
        row.className = "convo-row";
        row.setAttribute("data-role", "open-conversation");
        row.setAttribute("data-id", doc.id);
        row.setAttribute("data-name", name);
        row.setAttribute("data-subject", thread.subject || "Conversation");

        row.innerHTML = `
          <div class="convo-avatar">${escapeHtml(initials || "?")}</div>
          <div class="convo-body">
            <div class="convo-top-line">
              <span class="convo-name">${escapeHtml(thread.subject || "Conversation")}</span>
              <span class="convo-time">${formatRelativeTime(thread.lastMessageAt)}</span>
              ${thread.unreadByAdmin ? '<span class="convo-dot"></span>' : ""}
            </div>
            <p class="convo-preview">${escapeHtml(name)} · ${escapeHtml(thread.lastMessageText || "No messages yet")}</p>
          </div>
        `;

        conversationsList.appendChild(row);
      });
    }, (err) => {
      console.error("Failed to load conversations:", err);
      conversationsList.innerHTML =
        '<p class="dashboard-subtext">Failed to load conversations.</p>';
    });
}

// Open a thread
document.addEventListener("click", (e) => {
  const card = e.target.closest('[data-role="open-conversation"]');
  if (!card) return;

  activeThreadId = card.dataset.id;
  const subject = card.dataset.subject || "Conversation";
  const name = card.dataset.name || "Unknown";
  chatThreadUserName.textContent = `${subject} — from ${name}`;
  adminChatThread.innerHTML = '<p class="dashboard-subtext">Loading…</p>';
  chatThreadModal?.classList.remove("hidden");

  const threadRef = db.collection("threads").doc(activeThreadId);

  // Mark as read by admin on open
  threadRef.update({ unreadByAdmin: false }).catch((err) => {
    console.error("Failed to mark thread read:", err);
  });

  if (activeThreadUnsubscribe) activeThreadUnsubscribe();

  activeThreadUnsubscribe = threadRef.collection("messages")
    .orderBy("sentAt", "asc")
    .onSnapshot((snapshot) => {
      const messages = snapshot.docs.map((d) => d.data());
      renderMessageBubbles(adminChatThread, messages, "admin");
    }, (err) => {
      console.error("Failed to load thread:", err);
      adminChatThread.innerHTML = '<p class="dashboard-subtext">Failed to load messages.</p>';
    });
});

closeChatThreadModal?.addEventListener("click", () => {
  chatThreadModal?.classList.add("hidden");
  if (activeThreadUnsubscribe) {
    activeThreadUnsubscribe();
    activeThreadUnsubscribe = null;
  }
  activeThreadId = null;
});

adminChatSendForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!activeThreadId) return;

  const text = adminChatMessageInput.value.trim();
  if (!text) return;

  const admin = auth.currentUser;
  const sendBtn = adminChatSendForm.querySelector("button[type='submit']");
  sendBtn.disabled = true;

  try {
    const threadRef = db.collection("threads").doc(activeThreadId);

    let adminFullName = "SK Office";
    try {
      const adminDoc = await db.collection("users").doc(admin.uid).get();
      adminFullName = adminDoc.exists ? (adminDoc.data().fullName || "SK Office") : "SK Office";
    } catch (err) {
      console.error("Failed to fetch admin name for message:", err);
    }

    await threadRef.collection("messages").add({
      senderId: admin.uid,
      senderRole: "admin",
      senderName: adminFullName,
      text,
      sentAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    await threadRef.update({
      lastMessageText: text,
      lastMessageAt: firebase.firestore.FieldValue.serverTimestamp(),
      unreadByUser: true,
      unreadByAdmin: false
    });

    adminChatMessageInput.value = "";
  } catch (err) {
    console.error("Failed to send message:", err);
    alert("Couldn't send that message. Please try again.");
  } finally {
    sendBtn.disabled = false;
  }
});


/* =========================
   ADMIN – SK ID APPROVALS
   ========================= */

const idApplicationsList = document.getElementById("idApplicationsList");

function idStatusBadgeClass(status) {
  if (status === "approved") return "status-upcoming";
  if (status === "rejected") return "status-archived";
  return "status-ongoing";
}

const idTabPendingCount = document.getElementById("idTabPendingCount");
const idTabApprovedCount = document.getElementById("idTabApprovedCount");
let idApplicationsTab = "pending"; // "pending" (includes rejected — still needs attention) or "approved"
let cachedIdApplicants = [];

function renderIdApplicationsList() {
  if (cachedIdApplicants.length === 0) {
    idApplicationsList.innerHTML =
      '<p class="dashboard-subtext">No completed applicant profiles yet.</p>';
    idTabPendingCount.textContent = "";
    idTabApprovedCount.textContent = "";
    return;
  }

  const pendingCount = cachedIdApplicants.filter((doc) => (doc.data().idStatus || "pending") !== "approved").length;
  const approvedCount = cachedIdApplicants.length - pendingCount;
  idTabPendingCount.textContent = `(${pendingCount})`;
  idTabApprovedCount.textContent = `(${approvedCount})`;

  const applicants = sortByLastName(
    cachedIdApplicants.filter((doc) => {
      const status = doc.data().idStatus || "pending";
      return idApplicationsTab === "approved" ? status === "approved" : status !== "approved";
    }),
    (doc) => doc.data().fullName
  );

  idApplicationsList.innerHTML = "";

  if (applicants.length === 0) {
    idApplicationsList.innerHTML =
      `<p class="dashboard-subtext">No ${idApplicationsTab} applicants.</p>`;
    return;
  }

  applicants.forEach((doc) => {
        const app = doc.data();
        const status = app.idStatus || "pending";

        const card = document.createElement("div");
        card.className = "event-card admin-card collapsible-card";

        const appNameSafe = escapeHtml(app.fullName || "");

        card.innerHTML = `
          <div class="collapsible-header" data-role="toggle-card">
            <div class="collapsible-header-text">
              ${app.photoData ? `<img class="id-app-thumb" src="${app.photoData}" alt="${appNameSafe}">` : ""}
              <h3>${app.fullName ? appNameSafe : "Unknown"}</h3>
              <span class="status-badge ${idStatusBadgeClass(status)}">${status.toUpperCase()}</span>
            </div>
            <span class="collapsible-chevron">▾</span>
          </div>

          <div class="collapsible-body">
            <p class="event-meta">${escapeHtml(app.address || "")}</p>
            <p class="event-meta">🎂 ${escapeHtml(app.birthdate || "")} · 📞 ${escapeHtml(app.contactNumber || "")}</p>
            ${app.idNumber ? `<p class="event-meta"><strong>${escapeHtml(app.idNumber)}</strong></p>` : ""}

            ${app.idDocumentData ? `
              <p class="event-meta">Submitted ID (verify against details above):</p>
              <img class="id-app-photo" src="${app.idDocumentData}" alt="Submitted ID for ${appNameSafe}"
                style="width:100%; height:auto; max-height:220px; object-fit:contain; border-radius:10px; margin-bottom:10px;">
            ` : ""}

            ${status === "rejected" && app.idRejectionReason ? `
              <p class="event-meta"><strong>Rejection reason sent:</strong> ${escapeHtml(app.idRejectionReason)}</p>
            ` : ""}

            <div class="admin-actions horizontal">
              <button class="icon-btn status"
                data-role="approve-id" data-id="${doc.id}"
                ${status === "approved" ? "disabled" : ""}
                title="${status === "rejected" ? "Approve (reverses the rejection)" : "Approve"}">
                ✅
                <span>Approve</span>
              </button>

              <button class="icon-btn archive"
                data-role="reject-id" data-id="${doc.id}" data-fullname="${appNameSafe}"
                ${status === "rejected" ? "disabled" : ""}
                title="Reject">
                ❌
                <span>Reject</span>
              </button>

              <button class="icon-btn edit"
                data-role="generate-id" data-id="${doc.id}"
                ${status !== "approved" ? "disabled" : ""}
                title="${status === "approved" ? "Generate ID" : "Approve first"}">
                🪪
                <span>Generate ID</span>
              </button>
            </div>
          </div>
        `;

    idApplicationsList.appendChild(card);
  });
}

if (idApplicationsList) {
  document.querySelectorAll(".admin-tab-btn").forEach((tabBtn) => {
    tabBtn.addEventListener("click", () => {
      idApplicationsTab = tabBtn.dataset.tab;
      document.querySelectorAll(".admin-tab-btn").forEach((b) => b.classList.remove("active"));
      tabBtn.classList.add("active");
      renderIdApplicationsList();
    });
  });

  // Regular users only — admins don't go through ID approval themselves.
  ensureCurrentUserRole().then(() => {
    db.collection("users")
      .where("role", "==", "user")
      .onSnapshot((snapshot) => {
        // Only cache users who've completed their profile (have ID-relevant data)
        cachedIdApplicants = snapshot.docs.filter((doc) => {
          const u = doc.data();
          return u.address && u.birthdate && u.contactNumber && u.photoData && u.idDocumentData;
        });
        renderIdApplicationsList();
      }, (err) => {
        console.error("Failed to load ID applicants:", err);
        idApplicationsList.innerHTML =
          '<p class="dashboard-subtext">Failed to load applicants.</p>';
      });
  });
}

// Turns a sequential counter (1, 2, 3, ...) into a 6-digit code that doesn't
// look sequential — e.g. counter 7 becomes "700006", not "000007" — without
// giving up the counter's atomicity guarantee. This is a fixed multiplicative
// permutation over 0..899999 (SCRAMBLE_MULTIPLIER is coprime with
// SCRAMBLE_RANGE), so distinct counters always map to distinct codes; there's
// no collision risk to check for, and no separate uniqueness lookup needed.
const ID_SCRAMBLE_MULTIPLIER = 700001;
const ID_SCRAMBLE_RANGE = 900000;
function scrambleIdCounter(counter) {
  const scrambled = ((counter - 1) * ID_SCRAMBLE_MULTIPLIER) % ID_SCRAMBLE_RANGE;
  return String(scrambled + 100000);
}

// Assigns the next ID number using a transaction against a shared counter
// doc, so concurrent approvals can't collide on the same number. Targets
// the user's own profile doc.
async function assignIdNumber(userId) {
  const counterRef = db.collection("settings").doc("idCounter");
  const userRef = db.collection("users").doc(userId);
  const admin = auth.currentUser;

  return db.runTransaction(async (tx) => {
    const counterDoc = await tx.get(counterRef);
    const lastNumber = counterDoc.exists ? (counterDoc.data().lastNumber || 0) : 0;
    const nextNumber = lastNumber + 1;
    const year = new Date().getFullYear();
    const idNumber = `SK-${year}-${scrambleIdCounter(nextNumber)}`;

    tx.set(counterRef, { lastNumber: nextNumber }, { merge: true });
    tx.update(userRef, {
      idNumber,
      idStatus: "approved",
      idReviewedBy: admin.uid,
      idReviewedAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    return idNumber;
  });
}

// Approve (also used to reverse a rejection — assigns/reassigns an ID
// number and marks approved regardless of the previous status).
document.addEventListener("click", async (e) => {
  const btn = e.target.closest('[data-role="approve-id"]');
  if (!btn || btn.disabled) return;

  try {
    await assignIdNumber(btn.dataset.id);
  } catch (err) {
    console.error("Failed to approve applicant:", err);
    alert("Failed to update status.");
  }
});

/* =========================
   ADMIN – REJECT ID APPLICATION (with reason + automatic message)
   Mirrors the event-removal flow: a required, editable reason gets sent
   as a message via the existing SK-office thread system, so the resident
   can reply — and, unlike the old immediate-confirm() version, rejection
   is reversible: the Approve button stays enabled afterward.
   ========================= */

const rejectIdModal = document.getElementById("rejectIdModal");
const rejectIdName = document.getElementById("rejectIdName");
const rejectIdReason = document.getElementById("rejectIdReason");
const confirmRejectIdBtn = document.getElementById("confirmRejectIdBtn");
const cancelRejectIdBtn = document.getElementById("cancelRejectIdBtn");

let rejectingApplicantId = null;

document.addEventListener("click", (e) => {
  const btn = e.target.closest('[data-role="reject-id"]');
  if (!btn || btn.disabled) return;

  rejectingApplicantId = btn.dataset.id;
  rejectIdName.textContent = btn.dataset.fullname || "this applicant";
  rejectIdReason.value =
    "We're unable to confirm you're a resident of Barangay 171 Bagumbong based on the ID submitted, so your SK Barangay ID application has been rejected. If you believe this is a mistake, please reply here with additional proof of residency — you can also resubmit a corrected photo/ID from your Profile page.";

  rejectIdModal?.classList.remove("hidden");
});

cancelRejectIdBtn?.addEventListener("click", () => {
  rejectIdModal?.classList.add("hidden");
  rejectingApplicantId = null;
});

confirmRejectIdBtn?.addEventListener("click", async () => {
  if (!rejectingApplicantId) return;

  const reason = rejectIdReason.value.trim();
  if (!reason) {
    alert("Please enter a reason — it's sent to them as the message.");
    return;
  }

  const admin = auth.currentUser;
  confirmRejectIdBtn.disabled = true;

  try {
    let adminFullName = "SK Office";
    let applicantFullName = "";
    try {
      const [adminDoc, applicantDoc] = await Promise.all([
        db.collection("users").doc(admin.uid).get(),
        db.collection("users").doc(rejectingApplicantId).get()
      ]);
      adminFullName = adminDoc.exists ? (adminDoc.data().fullName || "SK Office") : "SK Office";
      applicantFullName = applicantDoc.exists ? (applicantDoc.data().fullName || "") : "";
    } catch (err) {
      console.error("Failed to fetch names for rejection message:", err);
    }

    const threadRef = db.collection("threads").doc();
    const messageRef = threadRef.collection("messages").doc();

    const batch = db.batch();
    batch.update(db.collection("users").doc(rejectingApplicantId), {
      idStatus: "rejected",
      idRejectionReason: reason,
      idReviewedBy: admin.uid,
      idReviewedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    batch.set(threadRef, {
      userId: rejectingApplicantId,
      userFullName: applicantFullName,
      subject: "SK ID Application Rejected",
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      lastMessageText: reason,
      lastMessageAt: firebase.firestore.FieldValue.serverTimestamp(),
      unreadByAdmin: false,
      unreadByUser: true
    });
    batch.set(messageRef, {
      senderId: admin.uid,
      senderRole: "admin",
      senderName: adminFullName,
      text: reason,
      sentAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    await batch.commit();

    rejectIdModal?.classList.add("hidden");
    rejectingApplicantId = null;
  } catch (err) {
    console.error("Failed to reject applicant:", err);
    alert("Failed to reject this applicant. Please try again.");
  } finally {
    confirmRejectIdBtn.disabled = false;
  }
});

// Generate ID card for an approved applicant
document.addEventListener("click", async (e) => {
  const btn = e.target.closest('[data-role="generate-id"]');
  if (!btn || btn.disabled) return;

  const userId = btn.dataset.id;
  const originalLabel = btn.innerHTML;
  btn.disabled = true;
  btn.textContent = "Generating…";

  try {
    const doc = await db.collection("users").doc(userId).get();
    if (!doc.exists) return;
    const app = doc.data();

    const canvas = await generateIdCardCanvas({
      photoDataUrl: app.photoData,
      fullName: app.fullName,
      address: app.address,
      birthdate: app.birthdate,
      contactNumber: app.contactNumber,
      idNumber: app.idNumber
    });
    downloadCanvasAsPng(canvas, `SK-ID-${app.idNumber || safeFilenamePart(app.fullName)}.png`);
  } catch (err) {
    console.error("ID generation failed:", err);
    alert("Couldn't generate the ID. Has the ID template been uploaded yet? (Admin Panel → SK ID → ID Template)");
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalLabel;
  }
});


/* =========================
   USER DASHBOARD – RENDER EVENTS
   ========================= */

const userEventList = document.getElementById("userEventList");

let myRegisteredEventIds = new Set();
let myRemovedEventIds = new Set();

async function refreshMyRegistrations() {
  const user = auth.currentUser;
  if (!user) return;

  const snap = await db.collection("registrations")
    .where("userId", "==", user.uid)
    .get();

  myRegisteredEventIds = new Set();
  myRemovedEventIds = new Set();
  snap.docs.forEach((d) => {
    const data = d.data();
    // A removed registration is deliberately not re-joinable by clicking
    // Join Event again (only an admin's Restore can undo it) — kept out
    // of myRegisteredEventIds so the UI can show that distinctly instead
    // of a clickable button that would just fail.
    if (data.removed) myRemovedEventIds.add(data.eventId);
    else myRegisteredEventIds.add(data.eventId);
  });
}

// Residents can't join any event until their SK ID application is
// approved (admins are exempt — they don't go through that process).
// Enforced both here (for a clear message instead of a dead click) and,
// authoritatively, in firestore.rules on the registration create itself.
let myIdApprovedOrAdmin = false;

if (userEventList) {
  waitForUser().then(async (user) => {
    if (!user) return;

    try {
      const userDoc = await db.collection("users").doc(user.uid).get();
      const userData = userDoc.exists ? userDoc.data() : {};
      myIdApprovedOrAdmin = isAdminRole(userData.role) || userData.idStatus === "approved";
    } catch (err) {
      console.error("Failed to load ID approval status:", err);
    }

    await refreshMyRegistrations();

    db.collection("events")
      .where("status", "in", ["upcoming", "ongoing"])
      .onSnapshot((snapshot) => {

        userEventList.innerHTML = "";

        // Client-side filter + sort — avoids needing a composite Firestore
        // index (an 'in' query + orderBy on a different field requires one),
        // and doubles as a safety net so a past-due event never shows as
        // "upcoming" here even if no admin has visited recently to trigger
        // the Firestore status correction.
        const docs = snapshot.docs
          .filter((d) => getDisplayEventStatus(d.data()) !== "completed")
          .sort((a, b) => (b.data().date || "").localeCompare(a.data().date || ""));

        if (docs.length === 0) {
          userEventList.innerHTML =
            '<p class="dashboard-subtext">No upcoming events.</p>';
          return;
        }

        docs.forEach((doc) => {
          const event = doc.data();
          const isJoined = myRegisteredEventIds.has(doc.id);
          const isRemoved = myRemovedEventIds.has(doc.id);
          const capacityInfo = getCapacityInfo(event);
          const isFull = capacityInfo.isFull && !isJoined;
          // Only gates NEW joins — already-joined people keep showing
          // "Joined ✓" above regardless of their current ID status, so
          // this never touches existing registrants.
          const needsApproval = !isJoined && !myIdApprovedOrAdmin;

          const card = document.createElement("div");
          card.className = "event-card";

          let buttonLabel = "Join Event";
          if (isJoined) buttonLabel = "Joined ✓";
          else if (isRemoved) buttonLabel = "Removed";
          else if (needsApproval) buttonLabel = "ID approval required";
          else if (isFull) buttonLabel = "Full";

          card.innerHTML = `
            <h3>${escapeHtml(event.title)}</h3>
            <p class="event-meta">
              📅 ${escapeHtml(event.date)} · 🕒 ${escapeHtml(event.time)}<br>
              📍 ${escapeHtml(event.location)}
            </p>
            ${isRemoved ? `
              <p class="event-meta">
                👥 You were removed from this event — see Messages for why, or reply there to have it reconsidered.
              </p>
            ` : ""}
            ${needsApproval && !isRemoved ? `
              <p class="event-meta">
                👥 Your SK Barangay ID needs to be approved before you can join events — check your Profile page.
              </p>
            ` : ""}
            ${capacityInfo.hasLimit && !isJoined && !isRemoved && !needsApproval ? `
              <p class="event-meta">
                ${isFull ? "👥 Event full" : `👥 ${capacityInfo.remaining} slot${capacityInfo.remaining === 1 ? "" : "s"} left`}
              </p>
            ` : ""}

            <button type="button"
              class="action-card small"
              data-id="${doc.id}"
              ${isJoined || isFull || isRemoved || needsApproval ? "disabled" : ""}>
              ${buttonLabel}
            </button>
          `;

          userEventList.appendChild(card);
        });
      });
  });
}

// Join Event click handler
document.addEventListener("click", async (e) => {
  const btn = e.target.closest(".action-card.small[data-id]");
  if (!btn || btn.disabled) return;
  if (!userEventList || !userEventList.contains(btn)) return;

  const eventId = btn.dataset.id;
  const user = auth.currentUser;
  if (!user) return;

  btn.disabled = true;
  btn.textContent = "Joining…";

  try {
    const userDoc = await db.collection("users").doc(user.uid).get();
    const userData = userDoc.exists ? userDoc.data() : {};

    // Belt-and-suspenders re-check (the button's disabled state already
    // covers the normal case) — the actual enforcement is the Firestore
    // rule on the registration create itself.
    if (!isAdminRole(userData.role) && userData.idStatus !== "approved") {
      alert("Your SK Barangay ID needs to be approved before you can join events.");
      btn.disabled = false;
      btn.textContent = "ID approval required";
      return;
    }

    // Deterministic ID (eventId_userId) — a second write attempt on an
    // existing registration is blocked by security rules (only admins
    // can update a registration), which prevents duplicate joins.
    const registrationId = `${eventId}_${user.uid}`;
    const eventRef = db.collection("events").doc(eventId);
    const registrationRef = db.collection("registrations").doc(registrationId);

    // Reading the event's registeredCount and bumping it inside the same
    // transaction as creating the registration is what makes the capacity
    // limit race-proof — if two people go for the last slot at once,
    // Firestore serializes the transactions so only one can succeed; the
    // other re-reads the now-full count and hits the capacity check below.
    await db.runTransaction(async (tx) => {
      const eventDoc = await tx.get(eventRef);
      if (!eventDoc.exists) throw new Error("EVENT_NOT_FOUND");

      const capacityInfo = getCapacityInfo(eventDoc.data());
      if (capacityInfo.isFull) throw new Error("EVENT_FULL");

      tx.update(eventRef, { registeredCount: capacityInfo.registeredCount + 1 });
      tx.set(registrationRef, {
        eventId,
        userId: user.uid,
        fullName: userData.fullName || "",
        email: userData.email || user.email || "",
        attended: false,
        registeredAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    });

    myRegisteredEventIds.add(eventId);
    btn.textContent = "Joined ✓";
  } catch (err) {
    console.error("Registration failed:", err);
    if (err.message === "EVENT_FULL") {
      alert("Sorry, this event just reached its participant limit.");
      btn.textContent = "Full";
    } else {
      alert("Could not register. You may already be registered, or something went wrong.");
      btn.disabled = false;
      btn.textContent = "Join Event";
    }
  }
});


/* =========================
   USER – MESSAGES (messages.html)
   Thread-based: a user can have multiple named conversations, each with
   its own subject, shown as a list — tapping one opens its messages.
   ========================= */

const threadsList = document.getElementById("threadsList");
const newThreadBtn = document.getElementById("newThreadBtn");
const newThreadModal = document.getElementById("newThreadModal");
const newThreadForm = document.getElementById("newThreadForm");
const newThreadSubjectInput = document.getElementById("newThreadSubject");
const closeNewThreadModal = document.getElementById("closeNewThreadModal");

const userChatThreadModal = document.getElementById("userChatThreadModal");
const userChatThreadSubject = document.getElementById("userChatThreadSubject");
const userChatThread = document.getElementById("userChatThread");
const userChatSendForm = document.getElementById("userChatSendForm");
const userChatMessageInput = document.getElementById("userChatMessageInput");
const closeUserChatThreadModal = document.getElementById("closeUserChatThreadModal");

// Clock time for an individual message bubble — just the time if sent
// today, otherwise a short date + time.
function formatMessageTime(timestamp) {
  if (!timestamp || !timestamp.toDate) return "Sending…";

  const date = timestamp.toDate();
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();

  if (isToday) {
    return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }

  const isThisYear = date.getFullYear() === now.getFullYear();
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: isThisYear ? undefined : "numeric"
  }) + " " + date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

// Relative time for thread list previews — "5m ago", "Yesterday", etc.
function formatRelativeTime(timestamp) {
  if (!timestamp || !timestamp.toDate) return "Just now";

  const date = timestamp.toDate();
  const now = new Date();
  const diffMin = Math.floor((now - date) / 60000);

  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;

  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;

  const diffDay = Math.floor(diffHr / 24);
  if (diffDay === 1) return "Yesterday";
  if (diffDay < 7) return `${diffDay}d ago`;

  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function renderMessageBubbles(container, messages, myRole) {
  container.innerHTML = "";

  if (messages.length === 0) {
    container.innerHTML = '<p class="dashboard-subtext">No messages yet. Say hello!</p>';
    return;
  }

  messages.forEach((msg) => {
    const isMine = msg.senderRole === myRole;
    const label = isMine ? "You" : (msg.senderName || (msg.senderRole === "admin" ? "SK Office" : "Unknown"));

    const wrapper = document.createElement("div");
    wrapper.className = `chat-bubble-wrapper ${isMine ? "chat-bubble-wrapper-mine" : "chat-bubble-wrapper-theirs"}`;

    const nameLabel = document.createElement("span");
    nameLabel.className = "chat-sender-name";
    nameLabel.textContent = label;

    const bubble = document.createElement("div");
    bubble.className = `chat-bubble ${isMine ? "chat-bubble-mine" : "chat-bubble-theirs"}`;
    bubble.textContent = msg.text;

    const timeLabel = document.createElement("span");
    timeLabel.className = "chat-timestamp";
    timeLabel.textContent = formatMessageTime(msg.sentAt);

    wrapper.appendChild(nameLabel);
    wrapper.appendChild(bubble);
    wrapper.appendChild(timeLabel);
    container.appendChild(wrapper);
  });

  container.scrollTop = container.scrollHeight;
}

let activeUserThreadId = null;
let activeUserThreadUnsubscribe = null;

function openUserThread(threadId, subject) {
  activeUserThreadId = threadId;
  userChatThreadSubject.textContent = subject || "Conversation";
  userChatThread.innerHTML = '<p class="dashboard-subtext">Loading…</p>';
  userChatThreadModal?.classList.remove("hidden");

  const threadRef = db.collection("threads").doc(threadId);

  threadRef.update({ unreadByUser: false }).catch((err) => {
    console.error("Failed to mark thread read:", err);
  });

  if (activeUserThreadUnsubscribe) activeUserThreadUnsubscribe();

  activeUserThreadUnsubscribe = threadRef.collection("messages")
    .orderBy("sentAt", "asc")
    .onSnapshot((snapshot) => {
      const messages = snapshot.docs.map((d) => d.data());
      renderMessageBubbles(userChatThread, messages, "user");
    }, (err) => {
      console.error("Failed to load thread messages:", err);
      userChatThread.innerHTML = '<p class="dashboard-subtext">Failed to load messages.</p>';
    });
}

if (threadsList) {
  waitForUser().then((user) => {
    if (!user) return;

    db.collection("threads")
      .where("userId", "==", user.uid)
      .onSnapshot((snapshot) => {
        threadsList.innerHTML = "";

        if (snapshot.empty) {
          threadsList.innerHTML = '<p class="dashboard-subtext">No conversations yet.</p>';
          return;
        }

        const docs = snapshot.docs.slice().sort((a, b) =>
          (b.data().lastMessageAt?.toMillis?.() || 0) - (a.data().lastMessageAt?.toMillis?.() || 0)
        );

        docs.forEach((doc) => {
          const thread = doc.data();

          const row = document.createElement("div");
          row.className = "convo-row";
          row.setAttribute("data-role", "open-user-thread");
          row.setAttribute("data-id", doc.id);
          row.setAttribute("data-subject", thread.subject || "Conversation");

          row.innerHTML = `
            <div class="convo-avatar">💬</div>
            <div class="convo-body">
              <div class="convo-top-line">
                <span class="convo-name">${escapeHtml(thread.subject || "Conversation")}</span>
                <span class="convo-time">${formatRelativeTime(thread.lastMessageAt)}</span>
                ${thread.unreadByUser ? '<span class="convo-dot"></span>' : ""}
              </div>
              <p class="convo-preview">${escapeHtml(thread.lastMessageText || "No messages yet")}</p>
            </div>
          `;

          threadsList.appendChild(row);
        });
      }, (err) => {
        console.error("Failed to load threads:", err);
        threadsList.innerHTML = '<p class="dashboard-subtext">Failed to load conversations.</p>';
      });
  });
}

threadsList?.addEventListener("click", (e) => {
  const row = e.target.closest('[data-role="open-user-thread"]');
  if (!row) return;
  openUserThread(row.dataset.id, row.dataset.subject);
});

newThreadBtn?.addEventListener("click", () => {
  newThreadSubjectInput.value = "";
  newThreadModal?.classList.remove("hidden");
});

closeNewThreadModal?.addEventListener("click", () => {
  newThreadModal?.classList.add("hidden");
});

newThreadForm?.addEventListener("submit", async (e) => {
  e.preventDefault();

  const user = auth.currentUser;
  if (!user) return;

  const subject = newThreadSubjectInput.value.trim();
  if (!subject) return;

  const submitBtn = newThreadForm.querySelector("button[type='submit']");
  submitBtn.disabled = true;

  try {
    let userFullName = "";
    try {
      const userDoc = await db.collection("users").doc(user.uid).get();
      userFullName = userDoc.exists ? (userDoc.data().fullName || "") : "";
    } catch (err) {
      console.error("Failed to fetch name for new thread:", err);
    }

    const threadRef = await db.collection("threads").add({
      userId: user.uid,
      userFullName,
      subject,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      lastMessageText: "",
      lastMessageAt: firebase.firestore.FieldValue.serverTimestamp(),
      unreadByAdmin: false,
      unreadByUser: false
    });

    newThreadModal?.classList.add("hidden");
    openUserThread(threadRef.id, subject);
  } catch (err) {
    console.error("Failed to start conversation:", err);
    alert("Couldn't start that conversation. Please try again.");
  } finally {
    submitBtn.disabled = false;
  }
});

closeUserChatThreadModal?.addEventListener("click", () => {
  userChatThreadModal?.classList.add("hidden");
  if (activeUserThreadUnsubscribe) {
    activeUserThreadUnsubscribe();
    activeUserThreadUnsubscribe = null;
  }
  activeUserThreadId = null;
});

userChatSendForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!activeUserThreadId) return;

  const user = auth.currentUser;
  if (!user) return;

  const text = userChatMessageInput.value.trim();
  if (!text) return;

  const sendBtn = userChatSendForm.querySelector("button[type='submit']");
  sendBtn.disabled = true;

  try {
    let userFullName = "";
    try {
      const userDoc = await db.collection("users").doc(user.uid).get();
      userFullName = userDoc.exists ? (userDoc.data().fullName || "") : "";
    } catch (err) {
      console.error("Failed to fetch name for message:", err);
    }

    const threadRef = db.collection("threads").doc(activeUserThreadId);

    await threadRef.collection("messages").add({
      senderId: user.uid,
      senderRole: "user",
      senderName: userFullName || "You",
      text,
      sentAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    await threadRef.update({
      lastMessageText: text,
      lastMessageAt: firebase.firestore.FieldValue.serverTimestamp(),
      unreadByAdmin: true,
      unreadByUser: false
    });

    userChatMessageInput.value = "";
  } catch (err) {
    console.error("Failed to send message:", err);
    alert("Couldn't send that message. Please try again.");
  } finally {
    sendBtn.disabled = false;
  }
});


/* =========================
   USER DASHBOARD – COVER BANNER (user-uploaded)
   ========================= */

const dashboardBanner = document.getElementById("dashboardBanner");
const changeBannerBtn = document.getElementById("changeBannerBtn");
const bannerFileInput = document.getElementById("bannerFileInput");

if (dashboardBanner) {
  waitForUser().then(async (user) => {
    if (!user) return;

    try {
      const doc = await db.collection("users").doc(user.uid).get();
      if (doc.exists && doc.data().bannerData) {
        dashboardBanner.style.backgroundImage = `url(${doc.data().bannerData})`;
      }
    } catch (err) {
      console.error("Failed to load banner:", err);
    }
  });
}

changeBannerBtn?.addEventListener("click", () => {
  bannerFileInput?.click();
});

bannerFileInput?.addEventListener("change", async () => {
  const file = bannerFileInput.files[0];
  if (!file) return;

  const user = auth.currentUser;
  if (!user) return;

  changeBannerBtn.textContent = "…";

  try {
    // Banners are wider than a profile photo but the same technique applies —
    // resize + re-encode so it stays well under the Firestore doc size cap.
    const bannerDataUrl = await compressImageToDataUrl(file, 900, 0.75);

    await db.collection("users").doc(user.uid).update({
      bannerData: bannerDataUrl
    });

    dashboardBanner.style.backgroundImage = `url(${bannerDataUrl})`;
  } catch (err) {
    console.error("Banner upload failed:", err);
    alert("Couldn't update your cover photo. Please try again.");
  } finally {
    changeBannerBtn.textContent = "📷";
  }
});


/* =========================
   USER DASHBOARD – MOTIVATIONAL QUOTE (read-only)
   ========================= */

const statusWidget = document.getElementById("statusWidget");

const MOTIVATIONAL_QUOTES = [
"Your age does not limit the impact you can make.",
"Be young, be bold, be a force for good.",
"Your ideas can inspire change in your community.",
"Leadership begins when you choose to take action.",
"Don't wait for change — be part of making it happen.",
"Your talents are gifts meant to be shared.",
"Every young person has the power to make a difference.",
"Believe in yourself, then help others believe in themselves.",
"Stand up, speak out, and make your voice count.",
"Your future is built by what you do today.",
"Be the youth who inspires others to dream bigger.",
"Success is not just about achievement — it's about impact.",
"Lead by example, even when no one is watching.",
"Your community needs your energy, ideas, and courage.",
"Turn your passion into purpose.",
"Learn today, lead tomorrow, serve always.",
"Don't underestimate what young minds can accomplish.",
"Every good action creates a ripple of change.",
"Use your time, talent, and voice to uplift others.",
"Strong communities begin with young people who care.",
"Your dreams can become your community's inspiration.",
"Choose courage over comfort.",
"Be a reason someone believes in a better tomorrow.",
"Start where you are, use what you have, and make a difference.",
"Young minds. Brave hearts. Better communities.",
"Your potential is greater than your doubts.",
"Make your youth count — create, serve, and lead.",
"Change begins with one person deciding to care.",
"Don't just be a member of the community — help shape it.",
"The future belongs to those who prepare for it today.",
"Your small act of kindness may become someone's biggest hope.",
"Rise together, grow together, succeed together.",
"Be proud of where you come from and help make it better.",
"Leadership is not a position; it is a choice to serve.",
"Your generation has the power to write a new story.",
"Dream with ambition, act with courage, serve with compassion.",
"Make your voice heard, but let your actions speak louder.",
"One young person with purpose can inspire an entire community.",
"Your future is waiting — start building it today.",
"Be the spark that inspires positive change."
];

if (statusWidget) {
  const quote = MOTIVATIONAL_QUOTES[Math.floor(Math.random() * MOTIVATIONAL_QUOTES.length)];
  statusWidget.innerHTML = `
    <span class="status-display-text">💭 ${quote}</span>
  `;
}


/* =========================
   USER DASHBOARD – MESSAGES HEADER ICON
   ========================= */

const messagesHeaderBtn = document.getElementById("messagesHeaderBtn");
const messagesHeaderBadge = document.getElementById("messagesHeaderBadge");
const avatarBtn = document.getElementById("avatarBtn");
const profileHeaderBtn = document.getElementById("profileHeaderBtn");

avatarBtn?.addEventListener("click", () => {
  window.location.href = "profile.html";
});

profileHeaderBtn?.addEventListener("click", () => {
  window.location.href = "profile.html";
});

if (messagesHeaderBtn) {
  messagesHeaderBtn.addEventListener("click", () => {
    window.location.href = "messages.html";
  });

  waitForUser().then((user) => {
    if (!user) return;

    db.collection("threads")
      .where("userId", "==", user.uid)
      .where("unreadByUser", "==", true)
      .onSnapshot((snapshot) => {
        if (snapshot.size > 0) {
          messagesHeaderBadge.textContent = "";
          messagesHeaderBadge.classList.remove("hidden");
        } else {
          messagesHeaderBadge.classList.add("hidden");
        }
      }, (err) => {
        console.error("Failed to load message status:", err);
      });
  });
}


/* =========================
   USER DASHBOARD – SK ID STATUS
   ========================= */

const idApplicationStatusEl = document.getElementById("idApplicationStatus");
let myIdApplicationData = null;

// Rejection is reversible on the resident's end too: resubmitting a new
// photo/ID here flips idStatus back to 'pending' (allowed by a narrow
// self-update rule that only fires from 'rejected', see firestore.rules),
// putting them back in the admin's review queue without needing an admin
// to do anything first.
function renderIdApplicationStatus(data) {
  const status = data.idStatus || "pending"; // profile-complete users default to pending
  myIdApplicationData = data;

  let actionHtml = "";
  if (status === "approved") {
    actionHtml = `<button type="button" class="quick-access-action" data-role="download-id">Download</button>`;
  }

  const resubmitHtml = status === "rejected" ? `
    <div style="margin-top:14px;">
      ${data.idRejectionReason ? `<p class="dashboard-subtext"><strong>Reason:</strong> ${escapeHtml(data.idRejectionReason)}</p>` : ""}
      <p class="dashboard-subtext">
        You can reply in Messages about this, or resubmit a corrected photo
        and ID below to be reviewed again.
      </p>

      <label>Photo</label>
      <p class="dashboard-subtext">
        2x2 ID-style photo — square, plain background, your whole face
        clearly visible. You'll be able to crop it after choosing a file.
      </p>
      <input id="idResubmitPhotoFile" type="file" accept="image/png, image/jpeg">
      <img id="idResubmitPhotoPreview" class="template-preview hidden" alt="Photo preview">

      <label>Valid ID</label>
      <input id="idResubmitDocFile" type="file" accept="image/png, image/jpeg">
      <img id="idResubmitDocPreview" class="template-preview hidden" alt="ID preview">

      <div id="idResubmitError" class="form-error hidden"></div>

      <button type="button" id="idResubmitBtn" class="submit-btn" style="margin-top:10px;">
        Resubmit for Review
      </button>
    </div>
  ` : "";

  idApplicationStatusEl.innerHTML = `
    <div class="status-row-left">
      <span class="quick-access-icon">🪪</span>
      <span class="quick-access-label">SK ID: ${status.toUpperCase()}</span>
      ${data.idNumber ? `<span class="dashboard-subtext">${escapeHtml(data.idNumber)}</span>` : ""}
    </div>
    ${actionHtml}
    ${resubmitHtml}
  `;

  if (status !== "rejected") return;

  let resubmitPhotoDataUrl = null;
  let resubmitDocDataUrl = null;

  document.getElementById("idResubmitPhotoFile").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;

    openPhotoCropper(file, (dataUrl) => {
      if (!dataUrl) return;
      resubmitPhotoDataUrl = dataUrl;
      const preview = document.getElementById("idResubmitPhotoPreview");
      preview.src = dataUrl;
      preview.classList.remove("hidden");
    });
  });

  document.getElementById("idResubmitDocFile").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      resubmitDocDataUrl = await compressImageToDataUrl(file, 800, 0.8);
      const preview = document.getElementById("idResubmitDocPreview");
      preview.src = resubmitDocDataUrl;
      preview.classList.remove("hidden");
    } catch (err) {
      console.error("ID processing failed:", err);
      alert("Couldn't process that image. Try a different file.");
    }
  });

  document.getElementById("idResubmitBtn").addEventListener("click", async () => {
    const errorEl = document.getElementById("idResubmitError");
    errorEl.classList.add("hidden");

    if (!resubmitPhotoDataUrl || !resubmitDocDataUrl) {
      errorEl.textContent = "Please upload both a photo and a valid ID.";
      errorEl.classList.remove("hidden");
      return;
    }

    const user = auth.currentUser;
    if (!user) return;

    const btn = document.getElementById("idResubmitBtn");
    btn.disabled = true;
    btn.textContent = "Submitting…";

    try {
      await db.collection("users").doc(user.uid).update({
        idStatus: "pending",
        photoData: resubmitPhotoDataUrl,
        idDocumentData: resubmitDocDataUrl
      });

      const refreshedDoc = await db.collection("users").doc(user.uid).get();
      renderIdApplicationStatus(refreshedDoc.data());
    } catch (err) {
      console.error("Resubmission failed:", err);
      errorEl.textContent = "Something went wrong. Please try again.";
      errorEl.classList.remove("hidden");
      btn.disabled = false;
      btn.textContent = "Resubmit for Review";
    }
  });
}

if (idApplicationStatusEl) {
  waitForUser().then(async (user) => {
    if (!user) return;

    try {
      const userDoc = await db.collection("users").doc(user.uid).get();
      if (!userDoc.exists) return;

      renderIdApplicationStatus(userDoc.data());
    } catch (err) {
      console.error("Failed to load ID status:", err);
      idApplicationStatusEl.innerHTML =
        '<p class="dashboard-subtext">Couldn\'t load status.</p>';
    }
  });
}

// Download the generated ID from the dashboard
document.addEventListener("click", async (e) => {
  const btn = e.target.closest('[data-role="download-id"]');
  if (!btn || btn.disabled || !myIdApplicationData) return;

  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Generating…";

  try {
    const canvas = await generateIdCardCanvas({
      photoDataUrl: myIdApplicationData.photoData,
      fullName: myIdApplicationData.fullName,
      address: myIdApplicationData.address,
      birthdate: myIdApplicationData.birthdate,
      contactNumber: myIdApplicationData.contactNumber,
      idNumber: myIdApplicationData.idNumber
    });
    downloadCanvasAsPng(canvas, `SK-ID-${myIdApplicationData.idNumber || safeFilenamePart(myIdApplicationData.fullName)}.png`);
  } catch (err) {
    console.error("ID generation failed:", err);
    alert("Couldn't generate your ID yet. The template may not be ready — please check back later.");
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
});


/* =========================
   PROFILE – DETAILS (locked, request-to-change with proof)
   ========================= */

const profileDetailsSection = document.getElementById("profileDetailsSection");

function renderProfileDisplay(current) {
  profileDetailsSection.innerHTML = `
    <p class="event-meta"><strong>Name:</strong> ${escapeHtml(current.fullName || "Not set")}</p>
    <p class="event-meta"><strong>Birthdate:</strong> ${escapeHtml(current.birthdate || "Not set")}</p>
    <p class="event-meta"><strong>Contact:</strong> ${escapeHtml(current.contactNumber || "Not set")}</p>
    <p class="event-meta"><strong>Address:</strong> ${escapeHtml(current.address || "Not set")}</p>
    <button type="button" class="action-card small" data-role="request-profile-change">
      Request a Change
    </button>
  `;
}

function renderProfilePending(current, requested) {
  profileDetailsSection.innerHTML = `
    <p class="dashboard-subtext">Your requested changes are pending admin approval:</p>
    <p class="event-meta"><strong>Name:</strong> ${escapeHtml(requested.fullName || current.fullName || "")}</p>
    <p class="event-meta"><strong>Birthdate:</strong> ${escapeHtml(requested.birthdate || current.birthdate || "")}</p>
    <p class="event-meta"><strong>Contact:</strong> ${escapeHtml(requested.contactNumber || current.contactNumber || "")}</p>
    <p class="event-meta"><strong>Address:</strong> ${escapeHtml(requested.address || current.address || "")}</p>
  `;
}

function renderProfileRequestForm(current) {
  const esc = escapeHtml;

  profileDetailsSection.innerHTML = `
    <form id="profileChangeRequestForm" class="admin-form">
      <label>Full Name</label>
      <input id="pcrFullName" value="${esc(current.fullName)}" required>

      <label>Birthdate</label>
      <input id="pcrBirthdate" type="date" value="${esc(current.birthdate)}" required>

      <label>Contact Number</label>
      <input id="pcrContactNumber" type="tel" value="${esc(current.contactNumber)}" required>

      <label>Address</label>
      <input id="pcrAddress" value="${esc(current.address)}" required>

      <label>Proof (valid ID or a recent photo showing your details)</label>
      <input id="pcrProofFile" type="file" accept="image/png, image/jpeg" required>
      <img id="pcrProofPreview" class="template-preview hidden" alt="Proof preview">

      <div id="profileChangeRequestError" class="form-error hidden"></div>

      <button type="submit" id="pcrSubmitBtn" class="submit-btn">Submit Request</button>
      <span id="pcrCancelBtn" class="back-link">Cancel</span>
    </form>
  `;

  let proofDataUrl = null;

  document.getElementById("pcrProofFile").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      proofDataUrl = await compressImageToDataUrl(file, 800, 0.8);
      const preview = document.getElementById("pcrProofPreview");
      preview.src = proofDataUrl;
      preview.classList.remove("hidden");
    } catch (err) {
      console.error("Proof processing failed:", err);
      alert("Couldn't process that image. Try a different file.");
    }
  });

  document.getElementById("pcrCancelBtn").addEventListener("click", () => {
    renderProfileDisplay(current);
  });

  document.getElementById("profileChangeRequestForm").addEventListener("submit", async (e) => {
    e.preventDefault();

    const errorEl = document.getElementById("profileChangeRequestError");
    errorEl.classList.add("hidden");

    const user = auth.currentUser;
    if (!user) return;

    if (!proofDataUrl) {
      errorEl.textContent = "Please upload proof (a valid ID or recent photo).";
      errorEl.classList.remove("hidden");
      return;
    }

    const submitBtn = document.getElementById("pcrSubmitBtn");
    submitBtn.disabled = true;
    submitBtn.textContent = "Submitting…";

    const requested = {
      fullName: document.getElementById("pcrFullName").value.trim(),
      birthdate: document.getElementById("pcrBirthdate").value,
      contactNumber: document.getElementById("pcrContactNumber").value.trim(),
      address: document.getElementById("pcrAddress").value.trim()
    };

    try {
      await db.collection("profileChangeRequests").doc(user.uid).set({
        userId: user.uid,
        current,
        requested,
        proofPhotoData: proofDataUrl,
        status: "pending",
        requestedAt: firebase.firestore.FieldValue.serverTimestamp()
      });

      renderProfilePending(current, requested);
    } catch (err) {
      console.error("Failed to submit profile change request:", err);
      errorEl.textContent = "Something went wrong. Please try again.";
      errorEl.classList.remove("hidden");
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Submit Request";
    }
  });
}

if (profileDetailsSection) {
  waitForUser().then(async (user) => {
    if (!user) return;

    try {
      const [userDoc, requestDoc] = await Promise.all([
        db.collection("users").doc(user.uid).get(),
        db.collection("profileChangeRequests").doc(user.uid).get()
      ]);

      const current = userDoc.exists ? {
        fullName: userDoc.data().fullName || "",
        birthdate: userDoc.data().birthdate || "",
        contactNumber: userDoc.data().contactNumber || "",
        address: userDoc.data().address || ""
      } : { fullName: "", birthdate: "", contactNumber: "", address: "" };

      if (requestDoc.exists && requestDoc.data().status === "pending") {
        renderProfilePending(current, requestDoc.data().requested || {});
      } else {
        renderProfileDisplay(current);
      }

      profileDetailsSection.addEventListener("click", (e) => {
        const btn = e.target.closest('[data-role="request-profile-change"]');
        if (!btn) return;
        renderProfileRequestForm(current);
      });
    } catch (err) {
      console.error("Failed to load profile details:", err);
      profileDetailsSection.innerHTML = '<p class="dashboard-subtext">Couldn\'t load profile details.</p>';
    }
  });
}


/* =========================
   USER DASHBOARD – MY CERTIFICATES
   ========================= */

const myCertificatesList = document.getElementById("myCertificatesList");

if (myCertificatesList) {
  waitForUser().then(async (user) => {
    if (!user) return;

    let snap;
    try {
      snap = await db.collection("registrations")
        .where("userId", "==", user.uid)
        .where("attended", "==", true)
        .get();
    } catch (err) {
      console.error("Failed to load certificates:", err);
      myCertificatesList.innerHTML =
        '<p class="dashboard-subtext">Couldn\'t load certificates.</p>';
      return;
    }

    if (snap.empty) {
      myCertificatesList.innerHTML =
        '<p class="dashboard-subtext">No certificates yet.</p>';
      return;
    }

    myCertificatesList.innerHTML = "";

    for (const doc of snap.docs) {
      const reg = doc.data();

      let event = { title: "Event", date: "" };
      try {
        const eventDoc = await db.collection("events").doc(reg.eventId).get();
        if (eventDoc.exists) event = eventDoc.data();
      } catch (err) {
        console.error("Failed to load event for certificate:", err);
      }

      const card = document.createElement("div");
      card.className = "event-card";
      card.innerHTML = `
        <h3>${escapeHtml(event.title)}</h3>
        <p class="event-meta">📅 ${escapeHtml(event.date || "")}</p>
        <button type="button"
          class="action-card small"
          data-role="download-certificate"
          data-fullname="${escapeHtml(reg.fullName || "")}"
          data-eventtitle="${escapeHtml(event.title || "")}"
          data-eventdate="${escapeHtml(event.date || "")}">
          Download Certificate
        </button>
      `;

      myCertificatesList.appendChild(card);
    }
  });
}

// Download a certificate from the user dashboard
document.addEventListener("click", async (e) => {
  const btn = e.target.closest('[data-role="download-certificate"]');
  if (!btn || btn.disabled) return;

  const fullName = btn.dataset.fullname;
  const eventTitle = btn.dataset.eventtitle;
  const eventDate = btn.dataset.eventdate;

  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Generating…";

  try {
    const canvas = await generateCertificateCanvas({ fullName, eventTitle, eventDate });
    downloadCanvasAsPng(canvas, `Certificate-${safeFilenamePart(fullName)}.png`);
  } catch (err) {
    console.error("Certificate download failed:", err);
    alert("The certificate template isn't ready yet. Please check back later.");
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
});


/* =========================
   ADMIN PREVIEW MODE
   ========================= */

const backToAdminBtn = document.getElementById("backToAdminBtn");

const urlParams = new URLSearchParams(window.location.search);
const isAdminPreview = urlParams.get("preview") === "admin";

if (isAdminPreview && backToAdminBtn) {
  backToAdminBtn.style.display = "block";

  backToAdminBtn.addEventListener("click", () => {
    window.location.href = "admin.html";
  });
}
