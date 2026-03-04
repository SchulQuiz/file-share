// ==========================
// Firebase Imports (CDN)
// ==========================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";

import {
  getAuth,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

import {
  getFirestore,
  collection,
  addDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
  deleteDoc,
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import {
  getStorage,
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js";

// ==========================
// 1) Firebase Config (SETZEN!)
// ==========================
// Firebase Console → Project settings → Your apps → Web app → firebaseConfig
const firebaseConfig = {
  apiKey: "REPLACE_ME",
  authDomain: "REPLACE_ME",
  projectId: "REPLACE_ME",
  storageBucket: "REPLACE_ME",
  messagingSenderId: "REPLACE_ME",
  appId: "REPLACE_ME"
};

// ==========================
// 2) Init
// ==========================
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

const FILES_COLLECTION = "files";
const STORAGE_FOLDER = "public";   // Storage path: public/<filename>

// ==========================
// DOM Helpers
// ==========================
const $ = (id) => document.getElementById(id);

function toast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.style.display = "block";
  clearTimeout(window.__toastT);
  window.__toastT = setTimeout(() => (el.style.display = "none"), 2600);
}

function setFooter(msg) {
  $("footerStatus").textContent = `Status: ${msg}`;
}

function normalizeTags(raw) {
  // "a, b , c" -> ["a","b","c"] (unique, trimmed, length limited)
  const arr = (raw || "")
    .split(",")
    .map(t => t.trim())
    .filter(Boolean)
    .map(t => t.slice(0, 28));

  // unique (case-insensitive)
  const seen = new Set();
  const out = [];
  for (const t of arr) {
    const key = t.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(t);
    }
  }
  return out.slice(0, 12);
}

function formatDate(ts) {
  // Firestore Timestamp -> Date
  if (!ts) return "—";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleString("de-DE", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function safeText(s) {
  return (s ?? "").toString();
}

// ==========================
// Auth Panel Toggle
// ==========================
function openAuthPanel() { $("authPanel").style.display = "block"; }
function closeAuthPanel() { $("authPanel").style.display = "none"; }

$("btnOpenAuth").addEventListener("click", () => {
  const isOpen = $("authPanel").style.display !== "none";
  $("authPanel").style.display = isOpen ? "none" : "block";
});
$("btnCloseAuth").addEventListener("click", closeAuthPanel);

// ==========================
// Auth Actions
// ==========================
$("btnSignup").addEventListener("click", async () => {
  $("signupMsg").textContent = "";
  const email = $("signupEmail").value.trim();
  const pw = $("signupPw").value;
  if (!email || !pw) return ($("signupMsg").textContent = "Bitte Email + Passwort eingeben.");
  try {
    setFooter("Registriere…");
    await createUserWithEmailAndPassword(auth, email, pw);
    $("signupMsg").textContent = "✅ Account erstellt.";
    toast("Account erstellt ✅");
    closeAuthPanel();
  } catch (e) {
    $("signupMsg").textContent = e.message;
  } finally {
    setFooter("bereit");
  }
});

$("btnLogin").addEventListener("click", async () => {
  $("loginMsg").textContent = "";
  const email = $("loginEmail").value.trim();
  const pw = $("loginPw").value;
  if (!email || !pw) return ($("loginMsg").textContent = "Bitte Email + Passwort eingeben.");
  try {
    setFooter("Logge ein…");
    await signInWithEmailAndPassword(auth, email, pw);
    $("loginMsg").textContent = "✅ Eingeloggt.";
    toast("Eingeloggt ✅");
    closeAuthPanel();
  } catch (e) {
    $("loginMsg").textContent = e.message;
  } finally {
    setFooter("bereit");
  }
});

$("btnLogout").addEventListener("click", async () => {
  try {
    setFooter("Logout…");
    await signOut(auth);
    toast("Ausgeloggt");
  } finally {
    setFooter("bereit");
  }
});

// ==========================
// State
// ==========================
let currentUser = null;
let latestDocs = []; // for UI rendering + tag facet
let currentSubjectFilter = "__all__";
let currentTagFilter = "__all__";

// ==========================
// Upload
// ==========================
function setProgress(on, pct = 0, label = "Uploading…") {
  $("progressWrap").style.display = on ? "block" : "none";
  $("progressBarFill").style.width = `${pct}%`;
  $("progressText").textContent = label;
}

$("btnUpload").addEventListener("click", async () => {
  $("uploadMsg").textContent = "";
  if (!currentUser) return toast("Bitte einloggen, um hochzuladen.");

  const subject = $("subjectSelect").value;
  const tags = normalizeTags($("tagsInput").value);
  const file = $("fileInput").files?.[0];

  if (!subject) return ($("uploadMsg").textContent = "Bitte ein Fach auswählen.");
  if (!file) return ($("uploadMsg").textContent = "Bitte eine Datei auswählen.");

  try {
    setFooter("Upload…");
    setProgress(true, 10, "Upload startet…");

    const safeName = `${Date.now()}_${file.name}`.replaceAll("/", "_");
    const storagePath = `${STORAGE_FOLDER}/${safeName}`;
    const fileRef = ref(storage, storagePath);

    // Upload to Storage (ownerUid in metadata for Storage rules)
    setProgress(true, 35, "Datei wird hochgeladen…");
    await uploadBytes(fileRef, file, {
      contentType: file.type || "application/octet-stream",
      customMetadata: {
        ownerUid: currentUser.uid
      }
    });

    // Save metadata to Firestore
    setProgress(true, 75, "Metadaten speichern…");
    await addDoc(collection(db, FILES_COLLECTION), {
      subject,
      tags,
      originalName: file.name,
      storagePath,
      size: file.size,
      contentType: file.type || "application/octet-stream",
      uploaderUid: currentUser.uid,
      uploaderName: currentUser.email || "unknown",
      createdAt: serverTimestamp()
    });

    setProgress(true, 100, "Fertig ✅");
    $("uploadMsg").textContent = "✅ Upload fertig.";
    toast("Upload fertig ✅");

    // reset
    $("fileInput").value = "";
    $("tagsInput").value = "";

    await loadFiles(); // refresh list
  } catch (e) {
    console.error(e);
    $("uploadMsg").textContent = `❌ Upload fehlgeschlagen: ${e.message}`;
    toast("Upload fehlgeschlagen");
  } finally {
    setTimeout(() => setProgress(false), 600);
    setFooter("bereit");
  }
});

// ==========================
// Query + Rendering
// ==========================
$("filterSubject").addEventListener("change", async (e) => {
  currentSubjectFilter = e.target.value;
  // reset tag filter when subject changes (optional, fühlt sich meist besser an)
  currentTagFilter = "__all__";
  $("filterTag").value = "__all__";
  await loadFiles();
});

$("filterTag").addEventListener("change", async (e) => {
  currentTagFilter = e.target.value;
  await loadFiles();
});

$("btnRefresh").addEventListener("click", loadFiles);

async function loadFiles() {
  setFooter("Lade Dateien…");
  $("listMeta").textContent = "Lade…";
  $("emptyState").style.display = "none";
  $("filesGrid").innerHTML = "";

  try {
    // Base query: newest first
    // Optional filters:
    // - subject == X
    // - tags array-contains Y
    let q = query(
      collection(db, FILES_COLLECTION),
      orderBy("createdAt", "desc"),
      limit(60)
    );

    const filters = [];
    if (currentSubjectFilter !== "__all__") {
      filters.push(where("subject", "==", currentSubjectFilter));
    }
    if (currentTagFilter !== "__all__") {
      filters.push(where("tags", "array-contains", currentTagFilter));
    }

    if (filters.length > 0) {
      q = query(
        collection(db, FILES_COLLECTION),
        ...filters,
        orderBy("createdAt", "desc"),
        limit(60)
      );
    }

    const snap = await getDocs(q);
    latestDocs = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    $("listMeta").textContent = `${latestDocs.length} Ergebnis(se) · ${currentSubjectFilter === "__all__" ? "alle Fächer" : currentSubjectFilter}${currentTagFilter === "__all__" ? "" : ` · Tag: ${currentTagFilter}`}`;

    updateTagFacet(latestDocs);

    renderFiles(latestDocs);
  } catch (e) {
    console.error(e);
    $("listMeta").textContent = `❌ Fehler: ${e.message}`;

    // Hinweis: Bei subject+tag kann Firestore einen Index verlangen.
    toast("Wenn Firestore einen Index verlangt: Link in der Console anklicken und Index erstellen.");
  } finally {
    setFooter("bereit");
  }
}

function updateTagFacet(docs) {
  // Fülle Tag-Dropdown dynamisch aus (basierend auf dem aktuell sichtbaren Set)
  const tagsSet = new Set();
  for (const d of docs) {
    (d.tags || []).forEach(t => tagsSet.add(t));
  }
  const tags = Array.from(tagsSet).sort((a, b) => a.localeCompare(b, "de"));

  const sel = $("filterTag");
  const keep = currentTagFilter; // current selection
  sel.innerHTML = `<option value="__all__">Alle Tags</option>` + tags.map(t => `<option>${escapeHtml(t)}</option>`).join("");

  // try to keep selection if possible
  if (keep !== "__all__" && tags.includes(keep)) {
    sel.value = keep;
  } else {
    sel.value = "__all__";
    currentTagFilter = "__all__";
  }
}

function renderFiles(docs) {
  const grid = $("filesGrid");
  grid.innerHTML = "";

  if (!docs || docs.length === 0) {
    $("emptyState").style.display = "block";
    return;
  }

  for (const d of docs) {
    const card = document.createElement("div");
    card.className = "file-card";

    const name = safeText(d.originalName || "Datei");
    const subject = safeText(d.subject || "—");
    const uploader = safeText(d.uploaderName || "unknown");
    const date = formatDate(d.createdAt);

    const canDelete = !!currentUser && d.uploaderUid === currentUser.uid;
    const tags = Array.isArray(d.tags) ? d.tags : [];

    card.innerHTML = `
      <div class="file-top">
        <div>
          <div class="file-name">${escapeHtml(name)}</div>
          <div class="file-meta">${escapeHtml(subject)} · von ${escapeHtml(uploader)} · ${escapeHtml(date)}</div>
        </div>
      </div>

      <div class="badges">
        <span class="badge badge-subject">${escapeHtml(subject)}</span>
        ${tags.map(t => `<span class="badge badge-tag">${escapeHtml(t)}</span>`).join("")}
      </div>

      <div class="file-actions">
        <button class="btn btn-primary" data-action="download" data-id="${d.id}">Download</button>
        ${canDelete ? `<button class="btn btn-danger" data-action="delete" data-id="${d.id}">Löschen</button>` : ``}
      </div>
    `;

    grid.appendChild(card);
  }

  // delegate clicks
  grid.querySelectorAll("button[data-action]").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      const action = e.currentTarget.getAttribute("data-action");
      const id = e.currentTarget.getAttribute("data-id");
      if (action === "download") await downloadByDocId(id);
      if (action === "delete") await deleteByDocId(id);
    });
  });
}

async function downloadByDocId(docId) {
  try {
    setFooter("Hole Download-Link…");
    const docRef = doc(db, FILES_COLLECTION, docId);
    const snap = await getDoc(docRef);
    if (!snap.exists()) return toast("Datei nicht gefunden.");

    const data = snap.data();
    const url = await getDownloadURL(ref(storage, data.storagePath));
    window.open(url, "_blank", "noopener");
  } catch (e) {
    console.error(e);
    toast(`Download fehlgeschlagen: ${e.message}`);
  } finally {
    setFooter("bereit");
  }
}

async function deleteByDocId(docId) {
  if (!currentUser) return toast("Bitte einloggen.");
  const ok = confirm("Wirklich löschen? (Datei + Eintrag werden entfernt)");
  if (!ok) return;

  try {
    setFooter("Lösche…");
    const docRef = doc(db, FILES_COLLECTION, docId);
    const snap = await getDoc(docRef);
    if (!snap.exists()) return toast("Datei nicht gefunden.");

    const data = snap.data();
    if (data.uploaderUid !== currentUser.uid) {
      return toast("Du darfst nur deine eigenen Dateien löschen.");
    }

    await deleteObject(ref(storage, data.storagePath));
    await deleteDoc(docRef);

    toast("Gelöscht ✅");
    await loadFiles();
  } catch (e) {
    console.error(e);
    toast(`Löschen fehlgeschlagen: ${e.message}`);
  } finally {
    setFooter("bereit");
  }
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// ==========================
// Auth State Observer
// ==========================
onAuthStateChanged(auth, async (user) => {
  currentUser = user || null;

  if (currentUser) {
    $("userPill").textContent = `Eingeloggt: ${currentUser.email || currentUser.uid}`;
    $("userPill").classList.remove("pill-muted");
    $("btnLogout").style.display = "inline-block";
    $("uploadPanel").style.display = "block";
    $("btnOpenAuth").textContent = "Account";
  } else {
    $("userPill").textContent = "Öffentlicher Modus";
    $("userPill").classList.add("pill-muted");
    $("btnLogout").style.display = "none";
    $("uploadPanel").style.display = "none";
    $("btnOpenAuth").textContent = "Login / Upload";
  }

  await loadFiles();
});

// Initial
setFooter("bereit");
