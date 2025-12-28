// Padel WebApp (GitHub Pages + Firestore)
// v4 - pages: home / match / players / ranking / history

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getFirestore, doc, collection, getDocs, addDoc, setDoc, deleteDoc, onSnapshot,
  serverTimestamp, updateDoc, writeBatch, runTransaction, query, orderBy, limit
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

// --- Firebase config (ton projet) ---
const firebaseConfig = {
  "apiKey": "AIzaSyCJtTSJMNy1TejenUvyIGgpnlf9eAy3pDU",
  "authDomain": "padel-app-74bfd.firebaseapp.com",
  "projectId": "padel-app-74bfd",
  "storageBucket": "padel-app-74bfd.firebasestorage.app",
  "messagingSenderId": "435264651930",
  "appId": "1:435264651930:web:fc033cf2ca7b4ae3249523"
};
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// --- UI helpers ---
const $ = (id) => document.getElementById(id);

const views = {
  home: $("view-home"),
  match: $("view-match"),
  players: $("view-players"),
  ranking: $("view-ranking"),
  history: $("view-history"),
};

function show(viewName) {
  Object.values(views).forEach(v => v.classList.remove("view--active"));
  views[viewName].classList.add("view--active");
}

function currentGroupId() {
  const el = $("groupId");
  return (el?.value || "club1").trim() || "club1";
}

document.querySelectorAll("[data-goto]").forEach(btn => {
  btn.addEventListener("click", () => show(btn.dataset.goto));
});

$("back-match").addEventListener("click", () => show("home"));
$("back-players").addEventListener("click", () => show("home"));
$("back-ranking").addEventListener("click", () => show("home"));
$("back-history").addEventListener("click", () => show("home"));

// --- Firestore paths ---
const activeMatchRef = () => doc(db, `groups/${currentGroupId()}/state/activeMatch`);
const playersCol = () => collection(db, `groups/${currentGroupId()}/players`);
const historyCol = () => collection(db, `groups/${currentGroupId()}/history`);

// --- Players ---
let playersCache = []; // {id, name, rank}

function playerLabel(p) {
  const r = (p.rank || "").trim();
  return r ? `${p.name} (${r})` : p.name;
}

async function loadPlayers() {
  const snap = await getDocs(playersCol());
  const list = [];
  snap.forEach(d => {
    const data = d.data() || {};
    const name = (data.name || data.nom || "").toString().trim();
    if (!name) return;
    list.push({ id: d.id, name, rank: (data.rank || data.niveau || "").toString().trim() });
  });
  list.sort((a,b) => a.name.localeCompare(b.name));
  playersCache = list;

  // render list
  const wrap = $("playersList");
  wrap.innerHTML = "";
  if (!list.length) {
    wrap.innerHTML = `<div class="muted">Aucun joueur. Ajoute-en un ci-dessus.</div>`;
  } else {
    list.forEach(p => {
      const item = document.createElement("div");
      item.className = "listItem";
      item.innerHTML = `
        <div class="listLeft">
          <div class="listTitle">${p.name}</div>
          <div class="listSub">${p.rank ? `Niveau: ${p.rank}` : "Niveau: —"}</div>
        </div>
      `;
      wrap.appendChild(item);
    });
  }

  // populate selects
  const opts = list.map(p => `<option value="${p.id}">${playerLabel(p)}</option>`).join("");
  ["pA1","pA2","pB1","pB2"].forEach(id => {
    const sel = $(id);
    sel.innerHTML = `<option value="">—</option>` + opts;
  });
}

$("btnReloadPlayers").addEventListener("click", loadPlayers);

$("btnAddPlayer").addEventListener("click", async () => {
  const name = ($("newPlayerName").value || "").trim();
  const rank = ($("newPlayerRank").value || "").trim();
  const msg = $("addPlayerMsg");
  msg.textContent = "";
  if (!name) {
    msg.textContent = "⚠️ Mets un nom.";
    return;
  }
  try {
    await addDoc(playersCol(), {
      name,
      rank: rank || "",
      createdAt: serverTimestamp(),
    });
    $("newPlayerName").value = "";
    $("newPlayerRank").value = "";
    msg.textContent = "✅ Joueur ajouté.";
    await loadPlayers();
  } catch (e) {
    console.error(e);
    msg.textContent = "❌ Impossible d'ajouter (règles Firestore ?).";
  }
});

// --- Match: score formatting ---
function labelPoint(points, inTb) {
  if (inTb) return String(points);
  if (points === 0) return "0";
  if (points === 1) return "15";
  if (points === 2) return "30";
  return "40";
}

function isTbSet(mode, tiebreak, gamesA, gamesB) {
  return mode === "gamesets" && !!tiebreak && gamesA === 6 && gamesB === 6;
}

function setsToWin(bestOf) {
  return Math.floor((bestOf + 1) / 2);
}

// --- Live listener ---
let unsubActive = null;

function attachActiveListener() {
  if (unsubActive) unsubActive();
  unsubActive = onSnapshot(activeMatchRef(), (snap) => {
    if (!snap.exists()) {
      $("status").value = "NO MATCH";
      renderScore(null);
      return;
    }
    const m = snap.data();
    $("status").value = m.status || "LIVE";
    renderScore(m);
  }, (err) => {
    console.error(err);
    $("status").value = "ERROR";
  });
}

function renderScore(m) {
  const empty = !m;
  const pointsA = empty ? 0 : (m.pointsA ?? 0);
  const pointsB = empty ? 0 : (m.pointsB ?? 0);
  const gamesA = empty ? 0 : (m.gamesA ?? 0);
  const gamesB = empty ? 0 : (m.gamesB ?? 0);
  const setsA  = empty ? 0 : (m.setsA ?? 0);
  const setsB  = empty ? 0 : (m.setsB ?? 0);
  const mode = empty ? "gamesets" : (m.mode || "gamesets");
  const tiebreak = empty ? true : (m.tiebreak ?? true);

  const inTb = (mode === "tiebreak") || isTbSet(mode, tiebreak, gamesA, gamesB);

  $("setsA").textContent = setsA;
  $("setsB").textContent = setsB;
  $("gamesA").textContent = gamesA;
  $("gamesB").textContent = gamesB;
  $("pointsA").textContent = labelPoint(pointsA, inTb);
  $("pointsB").textContent = labelPoint(pointsB, inTb);

  // team names
  const aNames = (m?.teamA || []).map(id => playersCache.find(p => p.id === id)?.name).filter(Boolean);
  const bNames = (m?.teamB || []).map(id => playersCache.find(p => p.id === id)?.name).filter(Boolean);
  $("teamAName").textContent = aNames.length ? aNames.join(" + ") : "Équipe A";
  $("teamBName").textContent = bNames.length ? bNames.join(" + ") : "Équipe B";

  // serve badge
  const serve = m?.serve || "A";
  $("badgeServeA").hidden = serve !== "A";
  $("badgeServeB").hidden = serve !== "B";

  // enable buttons
  const live = (m?.status || "") === "LIVE";
  $("btnPointA").disabled = !live;
  $("btnPointB").disabled = !live;
  $("btnUndo").disabled = !live;
  $("btnDone").disabled = !live && (m?.status !== "DONE");
  $("btnArchive").disabled = !m || (m?.status !== "DONE");
}

// --- Start / Stop ---
$("btnStart").addEventListener("click", async () => {
  const gid = currentGroupId();

  // Must have at least 4 players selected (for now)
  const teamA = [ $("pA1").value, $("pA2").value ].filter(Boolean);
  const teamB = [ $("pB1").value, $("pB2").value ].filter(Boolean);

  if (teamA.length < 1 || teamB.length < 1) {
    alert("Choisis au moins 1 joueur dans chaque équipe (A1 et B1).");
    return;
  }

  const bestOf = Number($("bestOf").value || 3);
  const tiebreak = $("tiebreak").value === "true";
  const mode = $("mode").value || "gamesets";
  const serve = $("serve").value || "A";

  await setDoc(activeMatchRef(), {
    status: "LIVE",
    mode,
    tiebreak,
    bestOf,
    serve,
    teamA,
    teamB,
    pointsA: 0, pointsB: 0,
    gamesA: 0, gamesB: 0,
    setsA: 0, setsB: 0,
    undo: [],
    updatedAt: Date.now(),
    createdAt: serverTimestamp(),
  });
});

$("btnStop").addEventListener("click", async () => {
  if (!confirm("Supprimer le match actif ?")) return;
  await deleteDoc(activeMatchRef());
});

// --- +1 point / Undo / Done ---
// IMPORTANT: même logique que la montre (transactions)
async function txAddPoint(team) {
  await runTransaction(db, async (tx) => {
    const ref = activeMatchRef();
    const snap = await tx.get(ref);
    if (!snap.exists()) return;

    const m = snap.data();
    if ((m.status || "") !== "LIVE") return;

    let pointsA = Number(m.pointsA || 0);
    let pointsB = Number(m.pointsB || 0);
    let gamesA = Number(m.gamesA || 0);
    let gamesB = Number(m.gamesB || 0);
    let setsA  = Number(m.setsA || 0);
    let setsB  = Number(m.setsB || 0);

    const bestOf = Number(m.bestOf || 3);
    const mode = m.mode || "gamesets";
    const tiebreak = (m.tiebreak ?? true);

    const undo = Array.isArray(m.undo) ? [...m.undo] : [];
    undo.push({ setsA, setsB, gamesA, gamesB, pointsA, pointsB });
    while (undo.length > 50) undo.shift();

    const winSet = (winnerA) => {
      if (winnerA) setsA++; else setsB++;
      gamesA = 0; gamesB = 0;
      pointsA = 0; pointsB = 0;
    };

    const winGame = (winnerA) => {
      if (winnerA) gamesA++; else gamesB++;
      const diff = Math.abs(gamesA - gamesB);
      const hasSet = (((gamesA >= 6 || gamesB >= 6) && diff >= 2 && gamesA <= 7 && gamesB <= 7) ||
                      (gamesA === 7 || gamesB === 7));
      if (hasSet) winSet(gamesA > gamesB);
    };

    if (mode === "tiebreak") {
      if (team === "A") pointsA++; else pointsB++;
      tx.update(ref, { pointsA, pointsB, updatedAt: Date.now(), undo });
      return;
    }

    if (isTbSet(mode, tiebreak, gamesA, gamesB)) {
      if (team === "A") pointsA++; else pointsB++;
      const lead = Math.abs(pointsA - pointsB);
      if ((pointsA >= 7 || pointsB >= 7) && lead >= 2) winSet(pointsA > pointsB);
    } else {
      if (team === "A") pointsA++; else pointsB++;

      if (pointsA >= 4 && pointsB <= 3) { winGame(true); pointsA = 0; pointsB = 0; }
      else if (pointsB >= 4 && pointsA <= 3) { winGame(false); pointsA = 0; pointsB = 0; }
      else if (pointsA === 4 && pointsB === 4) { winGame(team === "A"); pointsA = 0; pointsB = 0; }
    }

    const finished = (setsA >= setsToWin(bestOf) || setsB >= setsToWin(bestOf));
    tx.update(ref, {
      pointsA, pointsB, gamesA, gamesB, setsA, setsB,
      status: finished ? "DONE" : "LIVE",
      updatedAt: Date.now(),
      undo
    });
  });
}

async function txUndo() {
  await runTransaction(db, async (tx) => {
    const ref = activeMatchRef();
    const snap = await tx.get(ref);
    if (!snap.exists()) return;
    const m = snap.data();
    const undo = Array.isArray(m.undo) ? [...m.undo] : [];
    if (!undo.length) return;
    const prev = undo.pop();
    tx.update(ref, {
      setsA: prev.setsA, setsB: prev.setsB,
      gamesA: prev.gamesA, gamesB: prev.gamesB,
      pointsA: prev.pointsA, pointsB: prev.pointsB,
      updatedAt: Date.now(),
      undo
    });
  });
}

async function txDone() {
  await updateDoc(activeMatchRef(), { status: "DONE", updatedAt: Date.now() });
}

$("btnPointA").addEventListener("click", () => txAddPoint("A"));
$("btnPointB").addEventListener("click", () => txAddPoint("B"));
$("btnUndo").addEventListener("click", () => txUndo());
$("btnDone").addEventListener("click", () => txDone());

// --- Archive ---
$("btnArchive").addEventListener("click", async () => {
  const ref = activeMatchRef();
  const snap = await (await import("https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js")).getDoc(ref);
  if (!snap.exists()) return;
  const m = snap.data();
  if ((m.status || "") !== "DONE") return;

  await addDoc(historyCol(), {
    ...m,
    archivedAt: serverTimestamp(),
  });
  await deleteDoc(ref);
  alert("Archivé ✅");
});

// --- Ranking & History rendering (simple) ---
async function refreshHistory() {
  const wrap = $("historyList");
  wrap.innerHTML = "";
  const q = query(historyCol(), orderBy("archivedAt","desc"), limit(30));
  const snap = await getDocs(q);
  if (snap.empty) {
    wrap.innerHTML = `<div class="muted">Aucun match archivé.</div>`;
    return;
  }
  snap.forEach(d => {
    const m = d.data() || {};
    const aNames = (m.teamA || []).map(id => playersCache.find(p => p.id===id)?.name).filter(Boolean).join(" + ") || "Équipe A";
    const bNames = (m.teamB || []).map(id => playersCache.find(p => p.id===id)?.name).filter(Boolean).join(" + ") || "Équipe B";
    const item = document.createElement("div");
    item.className="listItem";
    item.innerHTML = `
      <div class="listLeft">
        <div class="listTitle">${aNames}  vs  ${bNames}</div>
        <div class="listSub">Sets ${m.setsA ?? 0}-${m.setsB ?? 0} • Jeux ${m.gamesA ?? 0}-${m.gamesB ?? 0}</div>
      </div>
      <div class="listSub">${m.status || ""}</div>
    `;
    wrap.appendChild(item);
  });
}

async function refreshRanking() {
  const table = $("rankingTable");
  table.innerHTML = "";
  const snap = await getDocs(query(historyCol(), orderBy("archivedAt","desc"), limit(100)));

  const stats = new Map(); // playerId -> {name, played, won}
  const addStat = (pid, won) => {
    const p = playersCache.find(x=>x.id===pid);
    const name = p?.name || pid;
    const s = stats.get(pid) || { name, played:0, won:0 };
    s.played++;
    if (won) s.won++;
    stats.set(pid, s);
  };

  snap.forEach(d => {
    const m = d.data() || {};
    const aWon = (m.setsA ?? 0) > (m.setsB ?? 0);
    (m.teamA || []).forEach(pid => addStat(pid, aWon));
    (m.teamB || []).forEach(pid => addStat(pid, !aWon));
  });

  const rows = Array.from(stats.values())
    .sort((a,b) => (b.won - a.won) || (b.played - a.played) || a.name.localeCompare(b.name));

  if (!rows.length) {
    table.innerHTML = `<div class="muted">Pas assez de matchs archivés pour un classement.</div>`;
    return;
  }

  rows.forEach((r, idx) => {
    const item = document.createElement("div");
    item.className="listItem";
    const pct = r.played ? Math.round((r.won / r.played)*100) : 0;
    item.innerHTML = `
      <div class="listLeft">
        <div class="listTitle">#${idx+1} • ${r.name}</div>
        <div class="listSub">Victoires: ${r.won} / ${r.played} ( ${pct}% )</div>
      </div>
      <div class="listSub"></div>
    `;
    table.appendChild(item);
  });
}

// refresh when entering pages
["match","players","history","ranking"].forEach(v => {
  const obs = new MutationObserver(() => {
    if (views[v].classList.contains("view--active")) {
      if (v === "players") loadPlayers();
      if (v === "history") refreshHistory();
      if (v === "ranking") refreshRanking();
      if (v === "match") { loadPlayers().then(attachActiveListener); }
    }
  });
  obs.observe(views[v], { attributes:true, attributeFilter:["class"] });
});

// initial
show("home");
