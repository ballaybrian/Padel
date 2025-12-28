
/* ---------- V3 navigation (fix Android/PC: ancien cache + boutons inactifs) ---------- */
(function(){
  const viewMap = { home:'view-home', score:'view-score', players:'view-players', history:'view-history' };

  function setActiveView(key){
    const id = viewMap[key] || viewMap.home;
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const el = document.getElementById(id);
    if (el) el.classList.add('active');
  }

  // global (si jamais tu as encore des onclick="goTo('score')")
  window.goTo = function(target){
    const key = String(target||'home').split('#')[0] || 'home';
    location.hash = key;
    setActiveView(key);
  };

  function initNav(){
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-goto]');
      if(!btn) return;
      const raw = btn.getAttribute('data-goto') || 'home';
      const [key, anchor] = raw.split('#');
      const k = key || 'home';
      location.hash = k;
      setActiveView(k);

      if(anchor){
        const a = document.getElementById(anchor);
        if(a) a.scrollIntoView({behavior:'smooth', block:'start'});
      }
    });

    const first = (location.hash || '#home').replace('#','') || 'home';
    setActiveView(first);

    window.addEventListener('hashchange', () => {
      const k = (location.hash || '#home').replace('#','') || 'home';
      setActiveView(k);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initNav);
  else initNav();
})();


/* =========================================================
   PADEL WEB APP — Firestore (Cloud) + NO-AD
   - players: groups/{groupId}/players
   - matches (historique): groups/{groupId}/matches
   - match en cours: groups/{groupId}/state/activeMatch
   - scoring: 0/15/30/40 NO-AD, jeux+sets auto, TB à 6-6 optionnel
========================================================= */

const $ = (id) => document.getElementById(id);
const uid = () => Math.random().toString(16).slice(2) + Date.now().toString(16);

/* ========= 0) Firebase CONFIG (déjà OK chez toi) ========= */
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

/* ========= 1) Navigation (Accueil) ========= */
window.goTo = function(view){
  document.querySelectorAll(".view").forEach(v => v.classList.add("hidden"));
  const el = document.getElementById(`view-${view}`);
  if (el) el.classList.remove("hidden");
  if (view === "history") listenHistory();
};

/* ========= 2) Group ID ========= */
let GROUP_ID = localStorage.getItem("padel_groupId") || "club1";

function setGroupId(v){
  GROUP_ID = (v || "club1").trim();
  localStorage.setItem("padel_groupId", GROUP_ID);
  if ($("groupId")) $("groupId").value = GROUP_ID;
}

function refPlayers(){ return db.collection(`groups/${GROUP_ID}/players`); }
function refMatches(){ return db.collection(`groups/${GROUP_ID}/matches`); }
function refActive(){ return db.doc(`groups/${GROUP_ID}/state/activeMatch`); }

/* ========= 3) Auth anonyme ========= */
async function ensureAuth(){
  if (auth.currentUser) return auth.currentUser;
  const res = await auth.signInAnonymously();
  return res.user;
}

/* ========= 4) Players ========= */
let playersCache = [];
let unsubPlayers = null;

function escapeHtml(s){
  return String(s||"").replace(/[&<>"']/g, (m)=>({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[m]));
}

function renderPlayersSelects(){
  const options = [`<option value="">— choisir —</option>`]
    .concat(playersCache.map(p => `<option value="${p.id}">${escapeHtml(p.name)} (N${p.level})</option>`))
    .join("");

  ["a1","a2","b1","b2"].forEach(id => {
    const sel = $(id);
    if (sel) sel.innerHTML = options;
  });
}

function renderPlayersList(){
  const box = $("playersList");
  if (!box) return;

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

async function addPlayer(){
  const name = ($("playerName")?.value || "").trim();
  const level = parseInt($("playerLevel")?.value || "4", 10);
  if (!name) return;

  await refPlayers().add({ name, level, createdAt: Date.now() });
  $("playerName").value = "";
}

/* ========= 5) Match + scoring ========= */
let activeMatchCache = null;
let unsubActive = null;

function fmtPoint(p, inTb){
  if (inTb) return String(p||0);
  return ["0","15","30","40"][Math.min(3, p||0)];
}

function setsToWin(bestOf){ return Math.floor((bestOf + 1) / 2); }
function isTbSet(m){ return (m.mode === "gamesets" && !!m.tiebreak && m.gamesA === 6 && m.gamesB === 6); }

function renderActive(){
  const m = activeMatchCache;

  if (!m){
    if ($("statusText")) $("statusText").textContent = "Aucun activeMatch";
    if ($("lockText")) $("lockText").textContent = "Lock: —";
    if ($("teamAName")) $("teamAName").textContent = "Équipe A";
    if ($("teamBName")) $("teamBName").textContent = "Équipe B";
    ["setsA","setsB","gamesA","gamesB","pointsA","pointsB"].forEach(id=>{
      const el=$(id); if (el) el.textContent="0";
    });
    if ($("watchInfo")) $("watchInfo").textContent = "Démarre un match pour activer la montre.";
    wireButtonsEnabled();
    return;
  }

  if ($("statusText")) $("statusText").textContent = `activeMatch: ${m.status || "?"}`;
  if ($("lockText")) $("lockText").textContent = `Lock: OK`;

  const aNames = [m.a1Name, m.a2Name].filter(Boolean).join(" + ");
  const bNames = [m.b1Name, m.b2Name].filter(Boolean).join(" + ");
  if ($("teamAName")) $("teamAName").textContent = aNames || "Équipe A";
  if ($("teamBName")) $("teamBName").textContent = bNames || "Équipe B";

  const inTb = (m.mode === "tiebreak") || (isTbSet(m));
  if ($("setsA")) $("setsA").textContent = String(m.setsA || 0);
  if ($("setsB")) $("setsB").textContent = String(m.setsB || 0);
  if ($("gamesA")) $("gamesA").textContent = String(m.gamesA || 0);
  if ($("gamesB")) $("gamesB").textContent = String(m.gamesB || 0);
  if ($("pointsA")) $("pointsA").textContent = fmtPoint(m.pointsA || 0, inTb);
  if ($("pointsB")) $("pointsB").textContent = fmtPoint(m.pointsB || 0, inTb);

  if ($("watchInfo")) $("watchInfo").textContent = "LIVE : tu peux scorer sur la montre (+A/+B) et UNDO au centre.";
  wireButtonsEnabled();
}

function wireButtonsEnabled(){
  const live = activeMatchCache?.status === "LIVE";
  if ($("btnPointA")) $("btnPointA").disabled = !live;
  if ($("btnPointB")) $("btnPointB").disabled = !live;
  if ($("btnUndo")) $("btnUndo").disabled = !live;
  if ($("btnFinish")) $("btnFinish").disabled = !activeMatchCache;
  if ($("btnArchive")) $("btnArchive").disabled = !activeMatchCache;
}

async function startMatch(){
  const ids = {
    a1: $("a1")?.value || "",
    a2: $("a2")?.value || "",
    b1: $("b1")?.value || "",
    b2: $("b2")?.value || "",
  };
  const all = Object.values(ids).filter(Boolean);
  const uniq = new Set(all);

  if (all.length !== 4 || uniq.size !== 4){
    if ($("hintStart")) $("hintStart").textContent = "⚠️ Choisis 4 joueurs différents (2 par équipe).";
    return;
  }

  const byId = Object.fromEntries(playersCache.map(p => [p.id, p]));
  const bestOf = parseInt($("bestOf")?.value || "3", 10);
  const mode = $("mode")?.value || "gamesets";
  const tiebreak = ($("tiebreak")?.value || "true") === "true";
  const server = $("server")?.value || "A";

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
  };

  await refActive().set(payload, { merge:false });
  if ($("hintStart")) $("hintStart").textContent = "✅ Match démarré !";
}

async function stopMatch(){
  await refActive().delete().catch(()=>{});
  if ($("hintStart")) $("hintStart").textContent = "Match arrêté (activeMatch supprimé).";
}

async function txAddPoint(team){
  await db.runTransaction(async (tx)=>{
    const snap = await tx.get(refActive());
    if (!snap.exists) return;

    const m = snap.data();
    if (m.status !== "LIVE") return;

    let pointsA = m.pointsA || 0;
    let pointsB = m.pointsB || 0;
    let gamesA = m.gamesA || 0;
    let gamesB = m.gamesB || 0;
    let setsA = m.setsA || 0;
    let setsB = m.setsB || 0;

    const undo = Array.isArray(m.undo) ? m.undo.slice(0) : [];
    undo.push({ pointsA, pointsB, gamesA, gamesB, setsA, setsB, status: m.status });
    while (undo.length > 60) undo.shift();

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

    if (m.mode === "tiebreak" || isTbSet({ ...m, gamesA, gamesB })) {
      if (team === "A") pointsA++; else pointsB++;
      const lead = Math.abs(pointsA - pointsB);

      if (isTbSet({ ...m, gamesA, gamesB })) {
        if ((pointsA >= 7 || pointsB >= 7) && lead >= 2) winSet(pointsA > pointsB);
      }
    } else {
      if (team === "A") pointsA++; else pointsB++;

      if (pointsA >= 4 && pointsB <= 3) winGame(true);
      else if (pointsB >= 4 && pointsA <= 3) winGame(false);
      else if (pointsA === 4 && pointsB === 4) winGame(team === "A"); // NO-AD
    }

    const finished = (setsA >= setsToWin(bestOf) || setsB >= setsToWin(bestOf));

    tx.update(refActive(), {
      pointsA, pointsB,
      gamesA, gamesB,
      setsA, setsB,
      status: finished ? "DONE" : "LIVE",
      updatedAt: Date.now(),
      undo
    });
  });
}

async function txUndo(){
  await db.runTransaction(async (tx)=>{
    const snap = await tx.get(refActive());
    if (!snap.exists) return;

    const m = snap.data();
    if (m.status !== "LIVE") return;

    const undo = Array.isArray(m.undo) ? m.undo.slice(0) : [];
    if (!undo.length) return;

    const prev = undo.pop();

    tx.update(refActive(), {
      pointsA: prev.pointsA || 0,
      pointsB: prev.pointsB || 0,
      gamesA: prev.gamesA || 0,
      gamesB: prev.gamesB || 0,
      setsA: prev.setsA || 0,
      setsB: prev.setsB || 0,
      status: prev.status || "LIVE",
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
    archiveId: id,
    archivedAt: Date.now()
  });

  await refActive().delete().catch(()=>{});
}

/* ========= 6) Historique ========= */
let unsubHistory = null;

function listenHistory(){
  const box = $("historyList");
  if (!box) return;

  if (unsubHistory) { unsubHistory(); unsubHistory = null; }

  unsubHistory = refMatches().orderBy("archivedAt","desc").limit(50).onSnapshot((snap)=>{
    if (snap.empty){
      box.innerHTML = `<div class="muted">Aucun match archivé</div>`;
      return;
    }
    box.innerHTML = snap.docs.map(d=>{
      const m = d.data() || {};
      const a = [m.a1Name,m.a2Name].filter(Boolean).join(" + ") || "Équipe A";
      const b = [m.b1Name,m.b2Name].filter(Boolean).join(" + ") || "Équipe B";
      const when = m.archivedAt ? new Date(m.archivedAt).toLocaleString() : "";
      return `
        <div class="item">
          <div>
            <b>${escapeHtml(a)}</b> vs <b>${escapeHtml(b)}</b>
            <div class="muted">Sets ${m.setsA||0}-${m.setsB||0} • Jeux ${m.gamesA||0}-${m.gamesB||0}</div>
          </div>
          <div class="muted">${when}</div>
        </div>
      `;
    }).join("");
  });
}

/* ========= 7) Boot ========= */
async function boot(){
  setGroupId(GROUP_ID);
  await ensureAuth();

  // groupId input
  const gid = $("groupId");
  if (gid){
    gid.value = GROUP_ID;
    gid.addEventListener("change", (e)=>{
      setGroupId(e.target.value);
      // re-subscribe
      if (unsubPlayers) {unsubPlayers(); unsubPlayers=null;}
      if (unsubActive) {unsubActive(); unsubActive=null;}
      boot(); // relance
    });
  }

  // players subscription
  unsubPlayers = refPlayers().orderBy("createdAt","asc").onSnapshot((snap)=>{
    playersCache = snap.docs.map(d => ({ id:d.id, ...d.data() }));
    renderPlayersSelects();
    renderPlayersList();
  });

  // activeMatch subscription
  unsubActive = refActive().onSnapshot((snap)=>{
    activeMatchCache = snap.exists ? snap.data() : null;
    renderActive();
  });

  // buttons
  $("btnAddPlayer")?.addEventListener("click", addPlayer);

  $("btnStart")?.addEventListener("click", startMatch);
  $("btnStop")?.addEventListener("click", stopMatch);

  $("btnPointA")?.addEventListener("click", ()=>txAddPoint("A"));
  $("btnPointB")?.addEventListener("click", ()=>txAddPoint("B"));

  $("btnUndo")?.addEventListener("click", txUndo);
  $("btnFinish")?.addEventListener("click", txFinish);
  $("btnArchive")?.addEventListener("click", archiveMatch);

  // start on home
  goTo("home");
}

document.addEventListener("DOMContentLoaded", boot);
