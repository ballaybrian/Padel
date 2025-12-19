/* =========================================================
   PADEL WEB APP — Firestore (Cloud) + NO-AD
   - players: groups/{groupId}/players
   - matches (historique): groups/{groupId}/matches
   - match en cours: groups/{groupId}/state/activeMatch
   - scoring: 0/15/30/40 NO-AD (pas d'AV), jeux+sets auto, TB à 6-6 optionnel
========================================================= */

const $ = (id) => document.getElementById(id);
const uid = () => Math.random().toString(16).slice(2) + Date.now().toString(16);
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

/* =========================
   0) Firebase CONFIG (À REMPLIR)
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

/* =========================
   4) Cache local (UI)
========================= */
let PLAYERS = [];
let MATCHES = [];
let activeUnsub = null;
let playersUnsub = null;
let matchesUnsub = null;

/* match courant (copie de activeMatch) */
let match = null;
let undoStack = [];

/* =========================
   5) Routing
========================= */
const routes = {
  "/score": "view-score",
  "/players": "view-players",
  "/ranking": "view-ranking",
  "/history": "view-history",
};

function setActiveRoute() {
  const hash = location.hash.replace("#", "") || "/score";
  const viewId = routes[hash] || routes["/score"];

  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  $(viewId).classList.add("active");

  document.querySelectorAll("[data-route]").forEach(a => {
    const href = a.getAttribute("href").replace("#", "");
    a.classList.toggle("active", href === hash);
  });

  refreshAll();
}
window.addEventListener("hashchange", setActiveRoute);

/* =========================
   6) Helpers
========================= */
function escapeHtml(s){
  return String(s || "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function getPlayerById(id){
  return PLAYERS.find(p => p.id === id) || null;
}

function teamName(ids){
  const ps = (ids || []).map(getPlayerById).filter(Boolean);
  if (ps.length !== 2) return "—";
  return `${ps[0].name} + ${ps[1].name}`;
}

function formatDate(ts){
  const d = new Date(ts);
  return d.toLocaleString("fr-FR", { year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit" });
}

function setServePill() {
  if (!match) return;
  const A = $("serveA"), B = $("serveB");
  A.style.display = (match.serve === "A") ? "inline-block" : "none";
  B.style.display = (match.serve === "B") ? "inline-block" : "none";
}

function setScoreButtonsEnabled(enabled){
  ["btnPointA","btnPointB","btnUndo","btnFinish","btnArchive","btnStopCloud"].forEach(id=>{
    const el = document.getElementById(id);
    if (!el) return;
    el.disabled = !enabled;
  });
}

/* =========================
   7) Validation équipes
========================= */
function validateTeamsUI() {
  const a1 = $("a1").value, a2 = $("a2").value, b1 = $("b1").value, b2 = $("b2").value;
  const ids = [a1,a2,b1,b2].filter(Boolean);
  if (ids.length < 4) return { ok:false, msg:"Choisis 4 joueurs (2 par équipe)." };
  const uniq = new Set(ids);
  if (uniq.size !== 4) return { ok:false, msg:"Chaque joueur doit être unique (pas de doublon)." };
  return { ok:true, msg:"" };
}

/* =========================
   8) Scoring (NO-AD)
========================= */
function setsToWin(bestOf){ return Math.ceil(bestOf / 2); }

function isTiebreakSet(m){
  if (m.mode !== "gamesets") return false;
  if (m.tiebreak !== true) return false;
  return m.gamesA === 6 && m.gamesB === 6;
}

function pointText(p) {
  if (p <= 0) return "0";
  if (p === 1) return "15";
  if (p === 2) return "30";
  return "40";
}

function winSet(m, winner){ // winner: "A"|"B"
  if (winner === "A") m.setsA++;
  else m.setsB++;
  m.gamesA = 0; m.gamesB = 0;
  m.pointsA = 0; m.pointsB = 0;
}

function winGame(m, winner){ // winner: "A"|"B"
  if (winner === "A") m.gamesA++;
  else m.gamesB++;

  // alternance service par jeu (simple)
  m.serve = (m.serve === "A") ? "B" : "A";

  const a = m.gamesA, b = m.gamesB;
  const diff = Math.abs(a - b);
  const hasSet =
    ((a >= 6 || b >= 6) && diff >= 2 && a <= 7 && b <= 7) ||
    (a === 7 || b === 7);

  if (hasSet) winSet(m, a > b ? "A" : "B");
}

function applyPoint(m, team){ // team: "A"|"B"
  // TB set à 6-6
  if (isTiebreakSet(m)) {
    if (team === "A") m.pointsA++;
    else m.pointsB++;
    const lead = Math.abs(m.pointsA - m.pointsB);
    if ((m.pointsA >= 7 || m.pointsB >= 7) && lead >= 2) {
      winSet(m, m.pointsA > m.pointsB ? "A" : "B");
    }
    return;
  }

  // NO-AD 0/15/30/40, point décisif à 40-40
  if (team === "A") m.pointsA++;
  else m.pointsB++;

  const a = m.pointsA, b = m.pointsB;

  // avant 40-40
  if (a >= 4 && b <= 3) {
    winGame(m, "A");
    m.pointsA = 0; m.pointsB = 0;
    return;
  }
  if (b >= 4 && a <= 3) {
    winGame(m, "B");
    m.pointsA = 0; m.pointsB = 0;
    return;
  }

  // 40-40 -> point décisif (quand on arrive à 4-4)
  if (a === 4 && b === 4) {
    winGame(m, team);
    m.pointsA = 0; m.pointsB = 0;
  }
}

/* =========================
   9) Cloud: Démarrer / Stop / Point / Undo / Finish / Archive
========================= */
function makeActivePayloadFromUI(){
  return {
    id: uid(),
    status: "LIVE",
    createdAt: Date.now(),
    updatedAt: Date.now(),

    teamA: [$("a1").value, $("a2").value],
    teamB: [$("b1").value, $("b2").value],

    bestOf: Number($("bestOf").value),
    tiebreak: $("tiebreak").value === "on",
    mode: $("mode").value,     // gamesets / tiebreak
    serve: $("serveWho").value,

    setsA: 0, setsB: 0,
    gamesA: 0, gamesB: 0,
    pointsA: 0, pointsB: 0,

    undo: []
  };
}

async function startCloudMatch(){
  const v = validateTeamsUI();
  if (!v.ok) { $("needPlayersMsg").textContent = v.msg; return; }

  await ensureAuth();
  const payload = makeActivePayloadFromUI();
  await refActive().set(payload, { merge: false });
  $("matchStatus").textContent = "✅ Match LIVE créé dans Firestore. Ta montre peut scorer.";
}

async function stopCloudMatch(){
  await ensureAuth();
  await refActive().delete().catch(()=>{});
  $("matchStatus").textContent = "🛑 activeMatch supprimé.";
}

async function txUpdatePoint(team){
  await ensureAuth();

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(refActive());
    if (!snap.exists) throw new Error("Aucun match LIVE.");
    const m = snap.data();

    if (m.status !== "LIVE") throw new Error("Match non LIVE.");

    // undo stack (limité)
    const undo = Array.isArray(m.undo) ? m.undo : [];
    const snapshot = {
      setsA:m.setsA, setsB:m.setsB,
      gamesA:m.gamesA, gamesB:m.gamesB,
      pointsA:m.pointsA, pointsB:m.pointsB,
      serve:m.serve,
      updatedAt:m.updatedAt
    };
    undo.push(snapshot);
    while (undo.length > 50) undo.shift();

    // apply point
    applyPoint(m, team);

    const finished = (m.setsA >= setsToWin(m.bestOf) || m.setsB >= setsToWin(m.bestOf));
    m.status = finished ? "DONE" : "LIVE";
    m.updatedAt = Date.now();
    m.undo = undo;

    tx.set(refActive(), m, { merge: true });
  });
}

async function txUndo(){
  await ensureAuth();

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(refActive());
    if (!snap.exists) throw new Error("Aucun match.");
    const m = snap.data();

    const undo = Array.isArray(m.undo) ? m.undo : [];
    if (!undo.length) return;

    const prev = undo.pop();
    tx.set(refActive(), {
      setsA: prev.setsA, setsB: prev.setsB,
      gamesA: prev.gamesA, gamesB: prev.gamesB,
      pointsA: prev.pointsA, pointsB: prev.pointsB,
      serve: prev.serve,
      status: "LIVE",
      updatedAt: Date.now(),
      undo
    }, { merge: true });
  });
}

async function finishDone(){
  await ensureAuth();
  await refActive().set({ status:"DONE", updatedAt: Date.now() }, { merge:true });
}

async function archiveMatch(){
  await ensureAuth();
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(refActive());
    if (!snap.exists) throw new Error("Aucun match.");
    const m = snap.data();

    if (m.status !== "DONE") throw new Error("Le match n'est pas DONE.");

    const winner = (m.setsA > m.setsB) ? "A" : "B";
    const matchId = m.id || uid();

    tx.set(refMatches().doc(matchId), {
      ...m,
      winner,
      archivedAt: Date.now()
    }, { merge: false });

    // on passe activeMatch en ARCHIVED (ou delete si tu préfères)
    tx.set(refActive(), { status:"ARCHIVED", updatedAt: Date.now() }, { merge:true });
  });

  $("matchStatus").textContent = "📦 Match archivé dans Historique.";
}

/* =========================
   10) Render
========================= */
function fillPlayerSelects() {
  const players = PLAYERS.slice().sort((a,b) => a.name.localeCompare(b.name, "fr"));
  ["a1","a2","b1","b2"].forEach(id => {
    const sel = $(id);
    const cur = sel.value;
    sel.innerHTML =
      `<option value="">— choisir —</option>` +
      players.map(p => `<option value="${p.id}">${escapeHtml(p.name)} (N${p.level})</option>`).join("");
    if (players.some(p => p.id === cur)) sel.value = cur;
  });
}

function updateNeedPlayersMsg() {
  const v = validateTeamsUI();
  $("needPlayersMsg").textContent = v.ok ? "" : v.msg;
}

function renderMatch() {
  if (!match) {
    $("cloudStatus").value = "Aucun activeMatch";
    setScoreButtonsEnabled(false);
    $("btnStartCloud").disabled = false;
    return;
  }

  $("cloudStatus").value = `activeMatch: ${match.status}`;
  $("btnStartCloud").disabled = true;

  const aIds = match.teamA || [];
  const bIds = match.teamB || [];

  $("teamAName").textContent = (aIds[0] && aIds[1]) ? teamName(aIds) : "Équipe A";
  $("teamBName").textContent = (bIds[0] && bIds[1]) ? teamName(bIds) : "Équipe B";

  $("setsA").textContent = match.setsA ?? 0;
  $("setsB").textContent = match.setsB ?? 0;
  $("gamesA").textContent = match.gamesA ?? 0;
  $("gamesB").textContent = match.gamesB ?? 0;

  const inTB = (match.mode === "tiebreak") || isTiebreakSet(match);
  $("pointsA").textContent = inTB ? (match.pointsA ?? 0) : pointText(match.pointsA ?? 0);
  $("pointsB").textContent = inTB ? (match.pointsB ?? 0) : pointText(match.pointsB ?? 0);
  $("pointsLabelA").textContent = inTB ? "tie-break" : "points";
  $("pointsLabelB").textContent = inTB ? "tie-break" : "points";

  setServePill();

  const canPlay = (match.status === "LIVE");
  setScoreButtonsEnabled(canPlay || match.status === "DONE");
  $("btnArchive").disabled = !(match.status === "DONE");

  if (match.status === "DONE") {
    $("matchStatus").textContent = "🏁 Match DONE (tu peux archiver).";
  } else if (match.status === "ARCHIVED") {
    $("matchStatus").textContent = "📦 Match archivé.";
  }
}

function matchScoreLabel(m) {
  if (m.mode === "tiebreak") return `Tie-break ${m.pointsA ?? "?"}-${m.pointsB ?? "?"}`;
  let s = `${m.setsA}-${m.setsB} (BO${m.bestOf})`;
  if ((m.gamesA ?? 0) || (m.gamesB ?? 0)) s += ` | jeux ${m.gamesA}-${m.gamesB}`;
  if ((m.pointsA ?? 0) || (m.pointsB ?? 0)) s += ` | TB ${m.pointsA}-${m.pointsB}`;
  return s;
}

function renderPlayersTable() {
  const tb = $("playersTable").querySelector("tbody");
  const players = PLAYERS.slice().sort((a,b) => a.name.localeCompare(b.name, "fr"));

  tb.innerHTML = players.map(p => `
    <tr>
      <td>${escapeHtml(p.name)}</td>
      <td>N${p.level}</td>
      <td>${p.elo}</td>
      <td>
        <button class="btn danger" data-del="${p.id}">Supprimer</button>
      </td>
    </tr>
  `).join("");

  tb.querySelectorAll("[data-del]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-del");
      if (!confirm("Supprimer ce joueur ?")) return;
      await ensureAuth();
      await refPlayers().doc(id).delete();
    });
  });
}

function computeStats() {
  const stats = {};
  PLAYERS.forEach(p => {
    stats[p.id] = { id:p.id, name:p.name, level:p.level, elo:p.elo, matches:0, wins:0, losses:0 };
  });

  MATCHES.forEach(m => {
    const a = m.teamA || [];
    const b = m.teamB || [];
    const winner = m.winner;

    [...a, ...b].forEach(pid => { if (stats[pid]) stats[pid].matches++; });

    const winIds = (winner === "A") ? a : b;
    const loseIds = (winner === "A") ? b : a;

    winIds.forEach(pid => { if (stats[pid]) stats[pid].wins++; });
    loseIds.forEach(pid => { if (stats[pid]) stats[pid].losses++; });
  });

  return Object.values(stats).map(s => ({ ...s, winrate: s.matches ? (s.wins/s.matches) : 0 }));
}

function renderRanking() {
  const tb = $("rankingTable").querySelector("tbody");
  const sort = $("rankingSort").value;
  const q = ($("rankingSearch").value || "").trim().toLowerCase();

  let rows = computeStats().filter(r => r.name.toLowerCase().includes(q));
  const sorters = {
    elo: (a,b) => (b.elo||0) - (a.elo||0),
    wins: (a,b) => b.wins - a.wins || (b.elo||0)-(a.elo||0),
    winrate: (a,b) => b.winrate - a.winrate || b.matches - a.matches,
    matches: (a,b) => b.matches - a.matches || b.wins - a.wins,
    level: (a,b) => b.level - a.level || (b.elo||0)-(a.elo||0),
  };
  rows.sort(sorters[sort] || sorters.elo);

  tb.innerHTML = rows.map((r,i)=>`
    <tr>
      <td>${i+1}</td>
      <td>${escapeHtml(r.name)}</td>
      <td>N${r.level}</td>
      <td>${r.elo}</td>
      <td>${r.matches}</td>
      <td>${r.wins}</td>
      <td>${r.losses}</td>
      <td>${Math.round(r.winrate*100)}%</td>
    </tr>
  `).join("");
}

function renderMatches() {
  const tb = $("matchesTable").querySelector("tbody");
  tb.innerHTML = MATCHES
    .slice()
    .sort((a,b)=> (b.archivedAt||0)-(a.archivedAt||0))
    .map(m => `
      <tr>
        <td>${formatDate(m.archivedAt || m.updatedAt || m.createdAt || Date.now())}</td>
        <td>${escapeHtml(teamName(m.teamA||[]))}</td>
        <td>${escapeHtml(teamName(m.teamB||[]))}</td>
        <td>${escapeHtml(matchScoreLabel(m))}</td>
        <td>${m.winner === "A" ? "Équipe A" : "Équipe B"}</td>
        <td><button class="btn danger" data-delmatch="${m.id}">Supprimer</button></td>
      </tr>
    `).join("");

  tb.querySelectorAll("[data-delmatch]").forEach(btn=>{
    btn.addEventListener("click", async ()=>{
      const id = btn.getAttribute("data-delmatch");
      if (!confirm("Supprimer ce match ?")) return;
      await ensureAuth();
      await refMatches().doc(id).delete();
    });
  });
}

/* =========================
   11) Firestore listeners
========================= */
function stopListeners(){
  if (activeUnsub) activeUnsub(); activeUnsub = null;
  if (playersUnsub) playersUnsub(); playersUnsub = null;
  if (matchesUnsub) matchesUnsub(); matchesUnsub = null;
}

async function startListeners(){
  await ensureAuth();
  stopListeners();

  playersUnsub = refPlayers().onSnapshot((qs)=>{
    PLAYERS = qs.docs.map(d => ({ id:d.id, ...d.data() }));
    fillPlayerSelects();
    renderPlayersTable();
    renderRanking();
    updateNeedPlayersMsg();
  });

  matchesUnsub = refMatches().onSnapshot((qs)=>{
    MATCHES = qs.docs.map(d => ({ id:d.id, ...d.data() }));
    renderMatches();
    renderRanking();
  });

  activeUnsub = refActive().onSnapshot((doc)=>{
    match = doc.exists ? doc.data() : null;
    renderMatch();
  });

  $("cloudStatus").value = "Connecté";
}

/* =========================
   12) Actions joueurs
========================= */
async function addPlayer() {
  const name = ($("playerName").value || "").trim();
  const level = Number($("playerLevel").value || "3");
  if (!name) return;

  await ensureAuth();
  const id = uid();
  await refPlayers().doc(id).set({ name, level: clamp(level,1,5), elo: 1000, createdAt: Date.now() });

  $("playerName").value = "";
}

async function seedPlayers() {
  await ensureAuth();
  const samples = [
    ["Alex Martin", 3],
    ["Brian Dupont", 4],
    ["Chloé Bernard", 2],
    ["David Leroy", 3],
    ["Emma Petit", 1],
    ["Fares Diallo", 5],
  ];
  const batch = db.batch();
  samples.forEach(([name, level])=>{
    const id = uid();
    batch.set(refPlayers().doc(id), { name, level, elo: 1000, createdAt: Date.now() });
  });
  await batch.commit();
}

/* =========================
   13) Refresh
========================= */
function refreshAll(){
  fillPlayerSelects();
  updateNeedPlayersMsg();
  renderPlayersTable();
  renderRanking();
  renderMatches();
  renderMatch();
}

/* =========================
   14) Events
========================= */
function wireEvents(){
  $("groupId").value = GROUP_ID;
  $("groupId").addEventListener("change", async ()=>{
    setGroupId($("groupId").value);
    await startListeners();
    $("matchStatus").textContent = `Group changé: ${GROUP_ID}`;
  });

  $("btnAddPlayer").addEventListener("click", addPlayer);
  $("playerName").addEventListener("keydown", (e)=>{ if (e.key==="Enter") addPlayer(); });
  $("btnSeed").addEventListener("click", seedPlayers);

  $("rankingSort").addEventListener("change", renderRanking);
  $("rankingSearch").addEventListener("input", renderRanking);

  ["a1","a2","b1","b2","bestOf","tiebreak","mode","serveWho"].forEach(id=>{
    $(id).addEventListener("change", updateNeedPlayersMsg);
  });

  $("btnStartCloud").addEventListener("click", startCloudMatch);
  $("btnStopCloud").addEventListener("click", stopCloudMatch);

  $("btnPointA").addEventListener("click", ()=> txUpdatePoint("A").catch(e => $("matchStatus").textContent = e.message));
  $("btnPointB").addEventListener("click", ()=> txUpdatePoint("B").catch(e => $("matchStatus").textContent = e.message));
  $("btnUndo").addEventListener("click", ()=> txUndo().catch(e => $("matchStatus").textContent = e.message));
  $("btnFinish").addEventListener("click", ()=> finishDone().catch(e => $("matchStatus").textContent = e.message));
  $("btnArchive").addEventListener("click", ()=> archiveMatch().catch(e => $("matchStatus").textContent = e.message));

  $("btnClearMatches").addEventListener("click", async ()=>{
    if (!confirm("Supprimer tout l'historique ?")) return;
    await ensureAuth();
    const qs = await refMatches().get();
    const batch = db.batch();
    qs.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();
  });
}

/* =========================
   15) Init
========================= */
async function init(){
  setGroupId(GROUP_ID);
  wireEvents();
  setActiveRoute();

  try {
    await ensureAuth();
    await startListeners();
  } catch (e) {
    $("cloudStatus").value = "Erreur Firebase";
    $("matchStatus").textContent = "⚠️ Firebase non configuré (firebaseConfig).";
    console.error(e);
  }
}
init();
