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
const registerError = document.getElementById("registerError");
const registerSubmitBtn = document.getElementById("registerSubmitBtn");
const regPhotoFileInput = document.getElementById("regPhotoFile");
const regPhotoPreview = document.getElementById("regPhotoPreview");

let regPhotoDataUrl = null;

regPhotoFileInput?.addEventListener("change", async () => {
  const file = regPhotoFileInput.files[0];
  if (!file) return;

  try {
    regPhotoDataUrl = await compressImageToDataUrl(file);
    regPhotoPreview.src = regPhotoDataUrl;
    regPhotoPreview.classList.remove("hidden");
  } catch (err) {
    console.error("Photo processing failed:", err);
    alert("Couldn't process that photo. Try a different image.");
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
  "admin-messages.html"
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
    userData.photoData
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
    window.location.href = "index.html";
    return;
  }

  const userData = doc.data();
  const role = userData.role;

  // 🚫 Block non-admins from any admin page
  if (ADMIN_ONLY_PAGES.includes(pageName) && role !== "admin") {
    window.location.href = "dashboard.html";
    return;
  }

  // 🚫 Incomplete profile — required for ID-relevant pages, not for
  // complete-profile.html itself (or the site would redirect in a loop).
  const needsCompleteProfile = AUTH_REQUIRED_PAGES.includes(pageName) &&
    pageName !== "complete-profile.html" &&
    !isProfileComplete(userData);

  if (needsCompleteProfile) {
    window.location.href = "complete-profile.html";
    return;
  }

  // Already complete — no reason to be stuck on the completion page
  if (pageName === "complete-profile.html" && isProfileComplete(userData)) {
    window.location.href = role === "admin" ? "admin.html" : "dashboard.html";
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

let cpPhotoDataUrl = null;

cpPhotoFileInput?.addEventListener("change", async () => {
  const file = cpPhotoFileInput.files[0];
  if (!file) return;

  try {
    cpPhotoDataUrl = await compressImageToDataUrl(file);
    cpPhotoPreview.src = cpPhotoDataUrl;
    cpPhotoPreview.classList.remove("hidden");
  } catch (err) {
    console.error("Photo processing failed:", err);
    alert("Couldn't process that photo. Try a different image.");
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
      if (data.address) cpAddress.value = data.address;
      if (data.birthdate) cpBirthdate.value = data.birthdate;
      if (data.contactNumber) cpContactNumber.value = data.contactNumber;
      if (data.photoData) {
        cpPhotoDataUrl = data.photoData;
        cpPhotoPreview.src = data.photoData;
        cpPhotoPreview.classList.remove("hidden");
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

  completeProfileSubmitBtn.disabled = true;
  completeProfileSubmitBtn.textContent = "Saving…";

  try {
    await db.collection("users").doc(user.uid).update({
      address: cpAddress.value.trim(),
      birthdate: cpBirthdate.value,
      contactNumber: cpContactNumber.value.trim(),
      photoData: cpPhotoDataUrl
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

    const title = titleInput.value.trim();
    const description = descriptionInput.value.trim();
    const date = dateInput.value;
    const time = timeInput.value;
    const location = locationInput.value.trim();

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
    URL.revokeObjectURL(link.href);
  }, "image/png");
}

function safeFilenamePart(text) {
  return (text || "certificate").trim().replace(/\s+/g, "_").replace(/[^\w-]/g, "");
}


/* =========================
   ID CARD GENERATION (TEMPLATE + PHOTO + TEXT OVERLAY)
   ========================= */

const ID_TEMPLATE_DOC = db.collection("settings").doc("idTemplate");

// Same idea as CERT_TEXT_CONFIG — percentages of the template's width/height,
// so it scales with whatever size template gets uploaded. Adjust these once
// a real ID template exists and text/photo placement needs fine-tuning.
const ID_TEXT_CONFIG = {
  name:      { xPct: 0.5, yPct: 0.62, fontPct: 0.032, weight: "bold",   color: "#1c1c1c" },
  address:   { xPct: 0.5, yPct: 0.70, fontPct: 0.020, weight: "normal", color: "#333333" },
  birthdate: { xPct: 0.5, yPct: 0.76, fontPct: 0.018, weight: "normal", color: "#333333" },
  contact:   { xPct: 0.5, yPct: 0.82, fontPct: 0.018, weight: "normal", color: "#333333" },
  idNumber:  { xPct: 0.5, yPct: 0.90, fontPct: 0.020, weight: "bold",   color: "#1c1c1c" }
};

// Photo placement, also as a fraction of the template's dimensions
// (box position + size, not just a point).
const ID_PHOTO_CONFIG = { xPct: 0.5, yPct: 0.30, widthPct: 0.30, heightPct: 0.30 };

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
    const boxWidth = ID_PHOTO_CONFIG.widthPct * canvas.width;
    const boxHeight = ID_PHOTO_CONFIG.heightPct * canvas.height;
    const boxX = ID_PHOTO_CONFIG.xPct * canvas.width - boxWidth / 2;
    const boxY = ID_PHOTO_CONFIG.yPct * canvas.height - boxHeight / 2;

    // Cover-fit the photo into its box without distorting aspect ratio
    const photoRatio = photoImg.naturalWidth / photoImg.naturalHeight;
    const boxRatio = boxWidth / boxHeight;
    let sx = 0, sy = 0, sw = photoImg.naturalWidth, sh = photoImg.naturalHeight;

    if (photoRatio > boxRatio) {
      sw = sh * boxRatio;
      sx = (photoImg.naturalWidth - sw) / 2;
    } else {
      sh = sw / boxRatio;
      sy = (photoImg.naturalHeight - sh) / 2;
    }

    ctx.drawImage(photoImg, sx, sy, sw, sh, boxX, boxY, boxWidth, boxHeight);
  }

  function drawLine(text, cfg) {
    if (!text) return;
    const fontSize = Math.round(cfg.fontPct * canvas.width);
    ctx.font = `${cfg.weight} ${fontSize}px system-ui, sans-serif`;
    ctx.fillStyle = cfg.color;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, cfg.xPct * canvas.width, cfg.yPct * canvas.height);
  }

  drawLine(fullName, ID_TEXT_CONFIG.name);
  drawLine(address, ID_TEXT_CONFIG.address);
  drawLine(birthdate, ID_TEXT_CONFIG.birthdate);
  drawLine(contactNumber, ID_TEXT_CONFIG.contact);
  drawLine(idNumber, ID_TEXT_CONFIG.idNumber);

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
              <h3>${announcement.title}</h3>
              ${announcement.pinned ? '<span class="status-badge status-ongoing">PINNED</span>' : ""}
            </div>
            <span class="collapsible-chevron">▾</span>
          </div>

          <div class="collapsible-body">
            <p class="announcement-text">${announcement.body}</p>
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
          <p class="announcement-text">${announcement.body}</p>
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
    .orderBy("createdAt", "desc")
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

        const card = document.createElement("div");
        card.className = "event-card admin-card collapsible-card";

        card.innerHTML = `
          <div class="collapsible-header" data-role="toggle-card">
            <div class="collapsible-header-text">
              <h3>${event.title}</h3>
              <span class="status-badge status-${event.status}">${event.status.toUpperCase()}</span>
            </div>
            <span class="collapsible-chevron">▾</span>
          </div>

          <div class="collapsible-body">
            <p class="event-meta">
              ${event.date} • ${event.time}
            </p>
            <p class="event-meta">
              📍 ${event.location}
            </p>

            <div class="admin-actions horizontal">
              <button class="icon-btn status"
              data-id="${doc.id}"
              data-status="${event.status}"
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
                data-title="${event.title}"
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
      await db.collection("events").doc(editingEventId).update({
        title: editTitle.value.trim(),
        description: editDescription.value.trim(),
        date: editDate.value,
        time: editTime.value,
        location: editLocation.value
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

let activeRegistrantsEventId = null;
let activeRegistrantsEventData = null;
let registrantsUnsubscribe = null;

// Open modal + live-listen to registrants for this event
document.addEventListener("click", async (e) => {
  const btn = e.target.closest(".icon-btn.registrants");
  if (!btn) return;

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

      if (snapshot.empty) {
        registrantsList.innerHTML =
          '<p class="dashboard-subtext">No registrants yet.</p>';
        return;
      }

      snapshot.forEach((doc) => {
        const reg = doc.data();

        const row = document.createElement("div");
        row.className = "registrant-row";
        row.innerHTML = `
          <div class="registrant-info">
            <strong>${reg.fullName || "Unknown"}</strong>
            <span class="event-meta">${reg.email || ""}</span>
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
              data-fullname="${reg.fullName || ""}"
              ${reg.attended ? "" : "disabled"}
              title="${reg.attended ? "Generate certificate" : "Mark attended first"}">
              🎓 Certificate
            </button>
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
  db.collection("conversations")
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
  db.collection("conversations")
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
   ADMIN – MESSAGES (admin-messages.html)
   ========================= */

const conversationsList = document.getElementById("conversationsList");
const chatThreadModal = document.getElementById("chatThreadModal");
const chatThreadUserName = document.getElementById("chatThreadUserName");
const adminChatThread = document.getElementById("adminChatThread");
const adminChatSendForm = document.getElementById("adminChatSendForm");
const adminChatMessageInput = document.getElementById("adminChatMessageInput");
const closeChatThreadModal = document.getElementById("closeChatThreadModal");

let activeConversationUserId = null;
let activeConversationUnsubscribe = null;

if (conversationsList) {
  db.collection("conversations")
    .orderBy("lastMessageAt", "desc")
    .onSnapshot((snapshot) => {

      conversationsList.innerHTML = "";

      if (snapshot.empty) {
        conversationsList.innerHTML =
          '<p class="dashboard-subtext">No conversations yet.</p>';
        return;
      }

      snapshot.forEach((doc) => {
        const convo = doc.data();
        const name = convo.userFullName || "Unknown";
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

        row.innerHTML = `
          <div class="convo-avatar">${initials || "?"}</div>
          <div class="convo-body">
            <div class="convo-top-line">
              <span class="convo-name">${name}</span>
              ${convo.unreadByAdmin ? '<span class="convo-dot"></span>' : ""}
            </div>
            <p class="convo-preview">${convo.lastMessageText || ""}</p>
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

// Open a conversation thread
document.addEventListener("click", (e) => {
  const card = e.target.closest('[data-role="open-conversation"]');
  if (!card) return;

  activeConversationUserId = card.dataset.id;
  chatThreadUserName.textContent = card.dataset.name || "Conversation";
  adminChatThread.innerHTML = '<p class="dashboard-subtext">Loading…</p>';
  chatThreadModal?.classList.remove("hidden");

  const conversationRef = db.collection("conversations").doc(activeConversationUserId);

  // Mark as read by admin on open
  conversationRef.set({ unreadByAdmin: false }, { merge: true }).catch((err) => {
    console.error("Failed to mark conversation read:", err);
  });

  if (activeConversationUnsubscribe) activeConversationUnsubscribe();

  activeConversationUnsubscribe = conversationRef.collection("messages")
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
  if (activeConversationUnsubscribe) {
    activeConversationUnsubscribe();
    activeConversationUnsubscribe = null;
  }
  activeConversationUserId = null;
});

adminChatSendForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!activeConversationUserId) return;

  const text = adminChatMessageInput.value.trim();
  if (!text) return;

  const admin = auth.currentUser;
  const sendBtn = adminChatSendForm.querySelector("button[type='submit']");
  sendBtn.disabled = true;

  try {
    const conversationRef = db.collection("conversations").doc(activeConversationUserId);

    await conversationRef.collection("messages").add({
      senderId: admin.uid,
      senderRole: "admin",
      text,
      sentAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    await conversationRef.set({
      lastMessageText: text,
      lastMessageAt: firebase.firestore.FieldValue.serverTimestamp(),
      unreadByUser: true,
      unreadByAdmin: false
    }, { merge: true });

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

if (idApplicationsList) {
  // Regular users only — admins don't go through ID approval themselves.
  db.collection("users")
    .where("role", "==", "user")
    .onSnapshot((snapshot) => {

      idApplicationsList.innerHTML = "";

      // Only show users who've completed their profile (have ID-relevant data)
      const applicants = snapshot.docs.filter((doc) => {
        const u = doc.data();
        return u.address && u.birthdate && u.contactNumber && u.photoData;
      });

      if (applicants.length === 0) {
        idApplicationsList.innerHTML =
          '<p class="dashboard-subtext">No completed applicant profiles yet.</p>';
        return;
      }

      applicants.forEach((doc) => {
        const app = doc.data();
        const status = app.idStatus || "pending";

        const card = document.createElement("div");
        card.className = "event-card admin-card collapsible-card";

        card.innerHTML = `
          <div class="collapsible-header" data-role="toggle-card">
            <div class="collapsible-header-text">
              ${app.photoData ? `<img class="id-app-thumb" src="${app.photoData}" alt="${app.fullName || ""}">` : ""}
              <h3>${app.fullName || "Unknown"}</h3>
              <span class="status-badge ${idStatusBadgeClass(status)}">${status.toUpperCase()}</span>
            </div>
            <span class="collapsible-chevron">▾</span>
          </div>

          <div class="collapsible-body">
            <p class="event-meta">${app.address || ""}</p>
            <p class="event-meta">🎂 ${app.birthdate || ""} · 📞 ${app.contactNumber || ""}</p>
            ${app.idNumber ? `<p class="event-meta"><strong>${app.idNumber}</strong></p>` : ""}

            <div class="admin-actions horizontal">
              <button class="icon-btn status"
                data-role="approve-id" data-id="${doc.id}"
                ${status !== "pending" ? "disabled" : ""}
                title="Approve">
                ✅
                <span>Approve</span>
              </button>

              <button class="icon-btn archive"
                data-role="reject-id" data-id="${doc.id}"
                ${status !== "pending" ? "disabled" : ""}
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
    }, (err) => {
      console.error("Failed to load ID applicants:", err);
      idApplicationsList.innerHTML =
        '<p class="dashboard-subtext">Failed to load applicants.</p>';
    });
}

// Assigns the next serial ID number (e.g. SK-2026-0007) using a
// transaction against a shared counter doc, so concurrent approvals
// can't collide on the same number. Targets the user's own profile doc.
async function assignIdNumber(userId) {
  const counterRef = db.collection("settings").doc("idCounter");
  const userRef = db.collection("users").doc(userId);
  const admin = auth.currentUser;

  return db.runTransaction(async (tx) => {
    const counterDoc = await tx.get(counterRef);
    const lastNumber = counterDoc.exists ? (counterDoc.data().lastNumber || 0) : 0;
    const nextNumber = lastNumber + 1;
    const year = new Date().getFullYear();
    const idNumber = `SK-${year}-${String(nextNumber).padStart(4, "0")}`;

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

// Approve / Reject
document.addEventListener("click", async (e) => {
  const btn = e.target.closest('[data-role="approve-id"], [data-role="reject-id"]');
  if (!btn || btn.disabled) return;

  const userId = btn.dataset.id;
  const isApprove = btn.dataset.role === "approve-id";

  if (!isApprove && !confirm("Reject this applicant?")) return;

  try {
    if (isApprove) {
      await assignIdNumber(userId);
    } else {
      const admin = auth.currentUser;
      await db.collection("users").doc(userId).update({
        idStatus: "rejected",
        idReviewedBy: admin.uid,
        idReviewedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    }
  } catch (err) {
    console.error("Failed to update applicant status:", err);
    alert("Failed to update status.");
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

async function refreshMyRegistrations() {
  const user = auth.currentUser;
  if (!user) return;

  const snap = await db.collection("registrations")
    .where("userId", "==", user.uid)
    .get();

  myRegisteredEventIds = new Set(snap.docs.map((d) => d.data().eventId));
}

if (userEventList) {
  waitForUser().then(async (user) => {
    if (!user) return;

    await refreshMyRegistrations();

    db.collection("events")
      .where("status", "in", ["upcoming", "ongoing"])
      .onSnapshot((snapshot) => {

        userEventList.innerHTML = "";

        if (snapshot.empty) {
          userEventList.innerHTML =
            '<p class="dashboard-subtext">No upcoming events.</p>';
          return;
        }

        snapshot.forEach((doc) => {
          const event = doc.data();
          const isJoined = myRegisteredEventIds.has(doc.id);

          const card = document.createElement("div");
          card.className = "event-card";

          card.innerHTML = `
            <h3>${event.title}</h3>
            <p class="event-meta">
              📅 ${event.date} · 🕒 ${event.time}<br>
              📍 ${event.location}
            </p>

            <button type="button"
              class="action-card small"
              data-id="${doc.id}"
              ${isJoined ? "disabled" : ""}>
              ${isJoined ? "Joined ✓" : "Join Event"}
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

    // Deterministic ID (eventId_userId) — a second write attempt on an
    // existing registration is blocked by security rules (only admins
    // can update a registration), which prevents duplicate joins.
    const registrationId = `${eventId}_${user.uid}`;

    await db.collection("registrations").doc(registrationId).set({
      eventId,
      userId: user.uid,
      fullName: userData.fullName || "",
      email: userData.email || user.email || "",
      attended: false,
      registeredAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    myRegisteredEventIds.add(eventId);
    btn.textContent = "Joined ✓";
  } catch (err) {
    console.error("Registration failed:", err);
    alert("Could not register. You may already be registered, or something went wrong.");
    btn.disabled = false;
    btn.textContent = "Join Event";
  }
});


/* =========================
   USER – MESSAGES (messages.html)
   ========================= */

const chatThread = document.getElementById("chatThread");
const chatSendForm = document.getElementById("chatSendForm");
const chatMessageInput = document.getElementById("chatMessageInput");

function renderMessageBubbles(container, messages, myRole) {
  container.innerHTML = "";

  if (messages.length === 0) {
    container.innerHTML = '<p class="dashboard-subtext">No messages yet. Say hello!</p>';
    return;
  }

  messages.forEach((msg) => {
    const bubble = document.createElement("div");
    const isMine = msg.senderRole === myRole;
    bubble.className = `chat-bubble ${isMine ? "chat-bubble-mine" : "chat-bubble-theirs"}`;
    bubble.textContent = msg.text;
    container.appendChild(bubble);
  });

  container.scrollTop = container.scrollHeight;
}

if (chatThread) {
  waitForUser().then((user) => {
    if (!user) return;

    const conversationRef = db.collection("conversations").doc(user.uid);

    // Mark as read by the user on open
    conversationRef.set({ unreadByUser: false }, { merge: true }).catch((err) => {
      console.error("Failed to mark conversation read:", err);
    });

    conversationRef.collection("messages")
      .orderBy("sentAt", "asc")
      .onSnapshot((snapshot) => {
        const messages = snapshot.docs.map((d) => d.data());
        renderMessageBubbles(chatThread, messages, "user");
      }, (err) => {
        console.error("Failed to load messages:", err);
        chatThread.innerHTML = '<p class="dashboard-subtext">Failed to load messages.</p>';
      });

    chatSendForm?.addEventListener("submit", async (e) => {
      e.preventDefault();

      const text = chatMessageInput.value.trim();
      if (!text) return;

      const sendBtn = chatSendForm.querySelector("button[type='submit']");
      sendBtn.disabled = true;

      try {
        let userFullName = "";
        try {
          const userDoc = await db.collection("users").doc(user.uid).get();
          userFullName = userDoc.exists ? (userDoc.data().fullName || "") : "";
        } catch (err) {
          console.error("Failed to fetch name for conversation meta:", err);
        }

        await conversationRef.collection("messages").add({
          senderId: user.uid,
          senderRole: "user",
          text,
          sentAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        await conversationRef.set({
          userId: user.uid,
          userFullName,
          lastMessageText: text,
          lastMessageAt: firebase.firestore.FieldValue.serverTimestamp(),
          unreadByAdmin: true,
          unreadByUser: false
        }, { merge: true });

        chatMessageInput.value = "";
      } catch (err) {
        console.error("Failed to send message:", err);
        alert("Couldn't send that message. Please try again.");
      } finally {
        sendBtn.disabled = false;
      }
    });
  });
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

    db.collection("conversations").doc(user.uid)
      .onSnapshot((doc) => {
        const unread = doc.exists && doc.data().unreadByUser;
        if (unread) {
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

if (idApplicationStatusEl) {
  waitForUser().then(async (user) => {
    if (!user) return;

    try {
      const userDoc = await db.collection("users").doc(user.uid).get();
      if (!userDoc.exists) return;

      const data = userDoc.data();
      const status = data.idStatus || "pending"; // profile-complete users default to pending
      myIdApplicationData = data;

      let actionHtml = "";
      if (status === "approved") {
        actionHtml = `<button type="button" class="quick-access-action" data-role="download-id">Download</button>`;
      }

      idApplicationStatusEl.innerHTML = `
        <div class="status-row-left">
          <span class="quick-access-icon">🪪</span>
          <span class="quick-access-label">SK ID: ${status.toUpperCase()}</span>
          ${data.idNumber ? `<span class="dashboard-subtext">${data.idNumber}</span>` : ""}
        </div>
        ${actionHtml}
      `;
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
        <h3>${event.title}</h3>
        <p class="event-meta">📅 ${event.date || ""}</p>
        <button type="button"
          class="action-card small"
          data-role="download-certificate"
          data-fullname="${reg.fullName || ""}"
          data-eventtitle="${event.title || ""}"
          data-eventdate="${event.date || ""}">
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
