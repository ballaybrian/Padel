/* =========================================================
   PADEL WEB APP — Firestore + NO-AD + Watch Actions (Option 3)
   - players: groups/{gid}/players
   - activeMatch: groups/{gid}/state/activeMatch
   - actions: groups/{gid}/state/activeMatch/actions
========================================================= */

const $ = (id) => document.getElementById(id);
const uid = () => Math.random().toString(16).slice(2) + Date.now().toString(16);
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

/* =========================
   0) Firebase CONFIG
========================= */
const firebaseConfig = {
  apiKey: "AIzaSyCJtTSJMNy1TejenUvyIGgpnlf9eAy3pDU",
  authDomain: "padel-app-74bfd.firebaseapp.com",
  projectId: "padel-app-74bfd",
  storageBucket: "padel-app-74bfd.firebasestorage.app",
  messagingSenderId: "435264651930",
  appId: "1:435264651930:web:fc033cf2ca7b4ae3249523"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const auth = firebase.auth();

/* =========================
   1) Group ID
========================= */
let GROUP_ID = localStorage.getItem("padel_groupId") || "club1";
function setGroupId(v){
  GROUP_ID = (v || "club1").trim();
  localStorage.setItem("padel_groupId", GROUP_ID);
  $("groupId").value = GROUP_ID;
  stopAllListeners();
  boot(); // relance tout avec le nouveau groupId
}

/* =========================
   2) Auth anonyme
========================= */
async function ensureAuth(){
  if (auth.currentUser) return auth.currentUser;
  const res = await auth.signInAnonymously();
  return res.user;
}

/* =========================
   3) Refs
========================= */
const refPlayers = () => db.collection(`groups/${GROUP_ID}/players`);
const refMatches = () => db.collection(`groups/${GROUP_ID}/matches`);
const refActive  = () => db.doc(`groups/${GROUP_ID}/state/activeMatch`);
const refActions = () => db.collection(`groups/${GROUP_ID}/state/activeMatch/actions`);

/* =========================
   4) UI helpers
========================= */
function setTab(view){
  document.querySelectorAll(".tab").forEach(b => b.classList.remove("active"));
  document.querySelector(`.tab[data-view="${view}"]`).classList.add("active");

  document.querySelectorAll(".view").forEach(v => v.classList.add("hidden"));
  $(`view-${view}`).classList.remove("hidden");
}

function fmtPoint(p, inTb){
  if (inTb) return String(p);
  if (p === 0) return "0";
  if (p === 1) return "15";
  if (p === 2) return "30";
  return "40";
}

/* =========================
   5) State local (render)
========================= */
let playersCache = [];
let activeMatchCache = null;

function renderPlayersSelects(){
  const options = [`<option value="">— choisir —</option>`]
    .concat(playersCache.map(p => `<option value="${p.id}">${escapeHtml(p.name)} (N${p.level})</option>`))
    .join("");

  ["a1","a2","b1","b2"].forEach(id => {
    $(id).innerHTML = options;
  });
}

function renderPlayersList(){
  const box = $("playersList");
  if (!playersCache.length){
    box.innerHTML = `<div class="muted">Aucun joueur</div>`;
    return;
  }
  box.innerHTML = playersCache.map(p => `
    <div class="item">
      <div><b>${escapeHtml(p.name)}</b> <span class="muted">(N${p.level})</span></div>
      <button class="danger" data-del="${p.id}">Supprimer</button>
    </div>
  `).join("");

  box.querySelectorAll("[data-del]").forEach(btn => {
    btn.addEventListener("click", async () => {
      await refPlayers().doc(btn.dataset.del).delete();
    });
  });
}

function renderActive(){
  const m = activeMatchCache;

  if (!m){
    $("statusText").textContent = "Aucun activeMatch";
    $("lockText").textContent = "Lock: —";
    $("teamAName").textContent = "Équipe A";
    $("teamBName").textContent = "Équipe B";
    $("setsA").textContent = "0"; $("setsB").textContent = "0";
    $("gamesA").textContent = "0"; $("gamesB").textContent = "0";
    $("pointsA").textContent = "0"; $("pointsB").textContent = "0";
    $("watchInfo").textContent = "Aucun match. Démarre un match pour activer la montre.";
    return;
  }

  $("statusText").textContent = `activeMatch: ${m.status || "?"}`;
  $("lockText").textContent = `Lock: ${m.lockOwner ? "OK" : "NO"}`;

  const aNames = [m.a1Name, m.a2Name].filter(Boolean).join(" + ");
  const bNames = [m.b1Name, m.b2Name].filter(Boolean).join(" + ");
  $("teamAName").textContent = aNames || "Équipe A";
  $("teamBName").textContent = bNames || "Équipe B";

  $("setsA").textContent = String(m.setsA || 0);
  $("setsB").textContent = String(m.setsB || 0);
  $("gamesA").textContent = String(m.gamesA || 0);
  $("gamesB").textContent = String(m.gamesB || 0);

  const inTb = (m.mode === "tiebreak") || (m.tiebreak && (m.gamesA === 6 && m.gamesB === 6) && m.mode === "gamesets");
  $("pointsA").textContent = fmtPoint(m.pointsA || 0, inTb);
  $("pointsB").textContent = fmtPoint(m.pointsB || 0, inTb);

  $("watchInfo").textContent = "Match LIVE créé dans Firestore. La montre peut scorer.";
}

function escapeHtml(s){
  return String(s||"").replace(/[&<>"']/g, (m)=>({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[m]));
}

/* =========================
   6) Listeners (players + activeMatch + actions)
========================= */
let unsubPlayers = null;
let unsubActive = null;
let unsubActions = null;

function stopAllListeners(){
  if (unsubPlayers) {unsubPlayers(); unsubPlayers=null;}
  if (unsubActive)  {unsubActive();  unsubActive=null;}
  if (unsubActions) {unsubActions(); unsubActions=null;}
}

async function boot(){
  await ensureAuth();

  // Players live
  unsubPlayers = refPlayers().orderBy("createdAt","asc").onSnapshot((snap)=>{
    playersCache = snap.docs.map(d => ({id:d.id, ...d.data()}));
    renderPlayersSelects();
    renderPlayersList();
  });

  // activeMatch live
  unsubActive = refActive().onSnapshot((snap)=>{
    activeMatchCache = snap.exists ? snap.data() : null;
    renderActive();
    wireButtonsEnabled();
  });

  // IMPORTANT: moteur actions (Option 3)
  // => on écoute /actions et on applique le score
  unsubActions = refActions().orderBy("createdAt","asc").onSnapshot(async (snap)=>{
    for (const change of snap.docChanges()){
      if (change.type !== "added") continue;
      const actionDoc = change.doc;
      const a = actionDoc.data() || {};
      try{
        if (a.type === "POINT") await txAddPoint(a.team);
        if (a.type === "UNDO")  await txUndo();
        if (a.type === "FINISH") await txFinish();
      } finally {
        // on supprime l’action pour éviter re-traitement
        await actionDoc.ref.delete().catch(()=>{});
      }
    }
  });
}

/* =========================
   7) Start / Stop match
========================= */
async function startMatch(){
  const ids = {
    a1: $("a1").value,
    a2: $("a2").value,
    b1: $("b1").value,
    b2: $("b2").value,
  };
  const all = Object.values(ids).filter(Boolean);
  const uniq = new Set(all);

  if (all.length !== 4 || uniq.size !== 4){
    $("hintStart").textContent = "⚠️ Choisis 4 joueurs différents (2 par équipe).";
    return;
  }

  const byId = Object.fromEntries(playersCache.map(p => [p.id, p]));

  const bestOf = parseInt($("bestOf").value,10);
  const mode = $("mode").value;
  const tiebreak = $("tiebreak").value === "true";
  const server = $("server").value;

  const payload = {
    status: "LIVE",
    mode,
    tiebreak,
    bestOf,
    server,
    pointsA: 0, pointsB: 0,
    gamesA: 0, gamesB: 0,
    setsA: 0, setsB: 0,
    undo: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),

    a1Id: ids.a1, a2Id: ids.a2, b1Id: ids.b1, b2Id: ids.b2,
    a1Name: byId[ids.a1]?.name || "",
    a2Name: byId[ids.a2]?.name || "",
    b1Name: byId[ids.b1]?.name || "",
    b2Name: byId[ids.b2]?.name || "",

    // lock simple (pour éviter 2 webapp en même temps)
    lockOwner: auth.currentUser?.uid || "",
    lockAt: Date.now(),
  };

  await refActive().set(payload, { merge:false });
  $("hintStart").textContent = "✅ Match démarré !";
}

async function stopMatch(){
  await refActive().delete().catch(()=>{});
  $("hintStart").textContent = "Match supprimé (activeMatch effacé).";
}

/* =========================
   8) Score logic (NO-AD)
========================= */
const setsToWin = (bestOf) => Math.floor((bestOf + 1) / 2);
const isTbSet = (m) => (m.mode === "gamesets" && m.tiebreak && m.gamesA === 6 && m.gamesB === 6);

async function txAddPoint(team){
  if (team !== "A" && team !== "B") return;

  await db.runTransaction(async (tx)=>{
    const snap = await tx.get(refActive());
    if (!snap.exists) return;
    const m = snap.data();
    if (m.status !== "LIVE") return;

    // lock check : seul l’onglet "owner" traite
    if (m.lockOwner && m.lockOwner !== auth.currentUser?.uid) return;

    let pointsA = (m.pointsA||0), pointsB = (m.pointsB||0);
    let gamesA = (m.gamesA||0), gamesB = (m.gamesB||0);
    let setsA = (m.setsA||0), setsB = (m.setsB||0);
    const undo = Array.isArray(m.undo) ? m.undo.slice(0) : [];
    undo.push({ pointsA, pointsB, gamesA, gamesB, setsA, setsB });
    while (undo.length > 50) undo.shift();

    const bestOf = m.bestOf || 3;

    function winSet(winnerA){
      if (winnerA) setsA++; else setsB++;
      gamesA = 0; gamesB = 0;
      pointsA = 0; pointsB = 0;
    }

    function winGame(winnerA){
      if (winnerA) gamesA++; else gamesB++;
      pointsA = 0; pointsB = 0;

      const diff = Math.abs(gamesA - gamesB);
      const hasSet =
        ((gamesA >= 6 || gamesB >= 6) && diff >= 2 && gamesA <= 7 && gamesB <= 7) ||
        (gamesA === 7 || gamesB === 7);
      if (hasSet) winSet(gamesA > gamesB);
    }

    if (m.mode === "tiebreak"){
      if (team === "A") pointsA++; else pointsB++;
      tx.update(refActive(), { pointsA, pointsB, updatedAt: Date.now(), undo });
      return;
    }

    // tie-break à 6-6
    if (isTbSet(m)){
      if (team === "A") pointsA++; else pointsB++;
      const lead = Math.abs(pointsA - pointsB);
      if ((pointsA >= 7 || pointsB >= 7) && lead >= 2){
        winSet(pointsA > pointsB);
      }
    } else {
      // NO-AD : 0/15/30/40, à 40-40 -> point décisif
      if (team === "A") pointsA++; else pointsB++;

      if (pointsA >= 4 && pointsB <= 3) winGame(true);
      else if (pointsB >= 4 && pointsA <= 3) winGame(false);
      else if (pointsA === 4 && pointsB === 4) winGame(team === "A");
    }

    const finished = (setsA >= setsToWin(bestOf) || setsB >= setsToWin(bestOf));
    tx.update(refActive(), {
      pointsA, pointsB, gamesA, gamesB, setsA, setsB,
      status: finished ? "DONE" : "LIVE",
      updatedAt: Date.now(),
      undo,
      lockOwner: auth.currentUser?.uid || "",
      lockAt: Date.now()
    });
  });
}

async function txUndo(){
  await db.runTransaction(async (tx)=>{
    const snap = await tx.get(refActive());
    if (!snap.exists) return;
    const m = snap.data();
    if (m.status !== "LIVE") return;
    if (m.lockOwner && m.lockOwner !== auth.currentUser?.uid) return;

    const undo = Array.isArray(m.undo) ? m.undo.slice(0) : [];
    if (!undo.length) return;
    const prev = undo.pop();

    tx.update(refActive(), {
      pointsA: prev.pointsA, pointsB: prev.pointsB,
      gamesA: prev.gamesA, gamesB: prev.gamesB,
      setsA: prev.setsA, setsB: prev.setsB,
      updatedAt: Date.now(),
      undo
    });
  });
}

async function txFinish(){
  await refActive().update({ status:"DONE", updatedAt: Date.now() });
}

async function archiveMatch(){
  const snap = await refActive().get();
  if (!snap.exists) return;
  const m = snap.data();
  const id = uid();
  await refMatches().doc(id).set({
    ...m,
    archivedAt: Date.now(),
    archiveId: id
  });
  await refActive().delete().catch(()=>{});
}

/* =========================
   9) Players CRUD
========================= */
async function addPlayer(){
  const name = $("playerName").value.trim();
  const level = parseInt($("playerLevel").value,10);
  if (!name) return;

  await refPlayers().add({ name, level, createdAt: Date.now() });
  $("playerName").value = "";
}

/* =========================
   10) History render
========================= */
let unsubHistory = null;
function listenHistory(){
  if (unsubHistory) {unsubHistory(); unsubHistory=null;}
  unsubHistory = refMatches().orderBy("archivedAt","desc").limit(30).onSnapshot((snap)=>{
    const box = $("historyList");
    if (snap.empty){
      box.innerHTML = `<div class="muted">Aucun match archivé</div>`;
      return;
    }
    box.innerHTML = snap.docs.map(d=>{
      const m = d.data();
      const a = [m.a1Name,m.a2Name].filter(Boolean).join(" + ");
      const b = [m.b1Name,m.b2Name].filter(Boolean).join(" + ");
      return `
        <div class="item">
          <div>
            <b>${escapeHtml(a)}</b> vs <b>${escapeHtml(b)}</b>
            <div class="muted">Score final: ${m.setsA||0}-${m.setsB||0} (jeux ${m.gamesA||0}-${m.gamesB||0})</div>
          </div>
          <div class="muted">${new Date(m.archivedAt||0).toLocaleString()}</div>
        </div>
      `;
    }).join("");
  });
}

/* =========================
   11) Buttons enable
========================= */
function wireButtonsEnabled(){
  const live = activeMatchCache?.status === "LIVE";
  $("btnPointA").disabled = !live;
  $("btnPointB").disabled = !live;
  $("btnUndo").disabled = !live;
  $("btnFinish").disabled = !activeMatchCache;
  $("btnArchive").disabled = !activeMatchCache;
}

/* =========================
   12) UI wiring
========================= */
function sendWatchAction(type, team=null){
  // optionnel: si tu veux piloter depuis web comme la montre
  return refActions().add({ type, team, source:"web", createdAt: Date.now() });
}

function init(){
  // tabs
  document.querySelectorAll(".tab").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      setTab(btn.dataset.view);
      if (btn.dataset.view === "history") listenHistory();
    });
  });

  // group id
  $("groupId").value = GROUP_ID;
  $("groupId").addEventListener("change", (e)=>setGroupId(e.target.value));

  // match
  $("btnStart").addEventListener("click", startMatch);
  $("btnStop").addEventListener("click", stopMatch);

  // points (web direct)
  $("btnPointA").addEventListener("click", ()=>txAddPoint("A"));
  $("btnPointB").addEventListener("click", ()=>txAddPoint("B"));

  $("btnUndo").addEventListener("click", txUndo);
  $("btnFinish").addEventListener("click", txFinish);
  $("btnArchive").addEventListener("click", archiveMatch);

  // players
  $("btnAddPlayer").addEventListener("click", addPlayer);

  boot();
}

// start
document.addEventListener("DOMContentLoaded", init);
