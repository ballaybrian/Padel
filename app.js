/* =========================================================
   PADEL WEB APP — PHONE = ENGINE, WATCH = REMOTE
   - active match: groups/{gid}/state/activeMatch
   - actions:     groups/{gid}/state/activeMatch/actions/{id}
   - lock:        groups/{gid}/state/processorLock
========================================================= */

const $ = (id) => document.getElementById(id);
const uid = () => Math.random().toString(16).slice(2) + Date.now().toString(16);

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

let GROUP_ID = localStorage.getItem("padel_groupId") || "club1";
let CLIENT_ID = localStorage.getItem("padel_clientId") || uid();
localStorage.setItem("padel_clientId", CLIENT_ID);

function refActive() { return db.doc(`groups/${GROUP_ID}/state/activeMatch`); }
function refActions() { return refActive().collection("actions"); }
function refLock() { return db.doc(`groups/${GROUP_ID}/state/processorLock`); }

function log(s){
  const el = $("log");
  el.textContent = (s + "\n" + el.textContent).slice(0, 5000);
}

function setGroupId(v){
  GROUP_ID = (v || "club1").trim();
  localStorage.setItem("padel_groupId", GROUP_ID);
  $("gLbl").textContent = GROUP_ID;
  $("groupId").value = GROUP_ID;
}

// ---------- AUTH ----------
async function ensureAuth(){
  if (auth.currentUser) return auth.currentUser;
  const res = await auth.signInAnonymously();
  return res.user;
}

// ---------- SCORING (NO-AD + TB) ----------
function setsToWin(bestOf){ return Math.floor((bestOf + 1) / 2); }

function isTbSet(mode, tiebreak, gamesA, gamesB){
  return (mode === "gamesets" && !!tiebreak && gamesA === 6 && gamesB === 6);
}

function winGame(state, winnerA){
  if (winnerA) state.gamesA++; else state.gamesB++;

  const diff = Math.abs(state.gamesA - state.gamesB);
  const hasSet =
    ((state.gamesA >= 6 || state.gamesB >= 6) && diff >= 2 && state.gamesA <= 7 && state.gamesB <= 7) ||
    (state.gamesA === 7 || state.gamesB === 7);

  if (hasSet) winSet(state, state.gamesA > state.gamesB);
}

function winSet(state, winnerA){
  if (winnerA) state.setsA++; else state.setsB++;
  state.gamesA = 0; state.gamesB = 0;
  state.pointsA = 0; state.pointsB = 0;
}

function applyAddPoint(state, team){
  const mode = state.mode || "gamesets";
  const tiebreak = !!state.tiebreak;

  if (mode === "tiebreak"){
    if (team === "A") state.pointsA++; else state.pointsB++;
    return;
  }

  // TB in set at 6-6
  if (isTbSet(mode, tiebreak, state.gamesA, state.gamesB)){
    if (team === "A") state.pointsA++; else state.pointsB++;
    const lead = Math.abs(state.pointsA - state.pointsB);
    if ((state.pointsA >= 7 || state.pointsB >= 7) && lead >= 2){
      winSet(state, state.pointsA > state.pointsB);
    }
    return;
  }

  // NO-AD classic points (0/15/30/40)
  if (team === "A") state.pointsA++; else state.pointsB++;

  if (state.pointsA >= 4 && state.pointsB <= 3){
    winGame(state, true); state.pointsA = 0; state.pointsB = 0;
  } else if (state.pointsB >= 4 && state.pointsA <= 3){
    winGame(state, false); state.pointsA = 0; state.pointsB = 0;
  } else if (state.pointsA === 4 && state.pointsB === 4){
    // 40-40 point décisif (NO-AD)
    winGame(state, team === "A"); state.pointsA = 0; state.pointsB = 0;
  }
}

function snapshotToState(snap){
  const d = snap.data() || {};
  return {
    status: d.status || "LIVE",
    mode: d.mode || "gamesets",
    tiebreak: d.tiebreak ?? true,
    bestOf: d.bestOf || 3,

    pointsA: d.pointsA || 0,
    pointsB: d.pointsB || 0,
    gamesA: d.gamesA || 0,
    gamesB: d.gamesB || 0,
    setsA: d.setsA || 0,
    setsB: d.setsB || 0,

    undo: Array.isArray(d.undo) ? d.undo : []
  };
}

// ---------- LOCK (lease) ----------
async function tryAcquireLock(){
  const now = Date.now();
  const leaseMs = 25_000; // 25s lease
  const lockRef = refLock();

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(lockRef);
    const cur = snap.exists ? (snap.data() || {}) : {};
    const expiresAt = cur.expiresAt || 0;
    const owner = cur.owner || null;

    const free = (expiresAt < now) || (owner === CLIENT_ID);

    if (!free) return false;

    tx.set(lockRef, {
      owner: CLIENT_ID,
      expiresAt: now + leaseMs,
      updatedAt: now
    }, { merge: true });

    return true;
  });
}

let lockTimer = null;
let haveLock = false;

async function startLockLoop(){
  if (lockTimer) clearInterval(lockTimer);

  async function tick(){
    try{
      const ok = await tryAcquireLock();
      haveLock = !!ok;
      $("lockLbl").textContent = haveLock ? "OK" : "NO";
    }catch(e){
      haveLock = false;
      $("lockLbl").textContent = "ERR";
    }
  }

  await tick();
  lockTimer = setInterval(tick, 10_000);
}

// ---------- ACTION PROCESSOR ----------
function startActionProcessor(){
  // écoute des actions (order by createdAt)
  refActions().orderBy("createdAt", "asc").onSnapshot(async (snap) => {
    if (!haveLock) return;
    const changes = snap.docChanges().filter(c => c.type === "added");
    for (const ch of changes){
      const actionDoc = ch.doc;
      const action = actionDoc.data() || {};
      await processOneAction(actionDoc.ref, action).catch(e => log("ERR action: " + e.message));
    }
  });
}

async function processOneAction(actionRef, action){
  const type = action.type;
  const team = action.team;

  await db.runTransaction(async (tx) => {
    if (!haveLock) return;

    const s = await tx.get(refActive());
    if (!s.exists) return;

    const state = snapshotToState(s);

    // push undo
    state.undo.push({
      setsA: state.setsA, setsB: state.setsB,
      gamesA: state.gamesA, gamesB: state.gamesB,
      pointsA: state.pointsA, pointsB: state.pointsB
    });
    while (state.undo.length > 50) state.undo.shift();

    if (type === "ADD_POINT"){
      if (state.status !== "LIVE") return;
      applyAddPoint(state, team === "B" ? "B" : "A");
    } else if (type === "UNDO"){
      if (state.status !== "LIVE") return;
      const prev = state.undo.pop();
      if (!prev) return;
      state.setsA = prev.setsA; state.setsB = prev.setsB;
      state.gamesA = prev.gamesA; state.gamesB = prev.gamesB;
      state.pointsA = prev.pointsA; state.pointsB = prev.pointsB;
    } else if (type === "FIN"){
      state.status = "DONE";
    } else if (type === "RESUME"){
      state.status = "LIVE";
    }

    // finish match if sets reached
    const win = setsToWin(state.bestOf || 3);
    if (state.setsA >= win || state.setsB >= win) state.status = "DONE";

    tx.update(refActive(), {
      status: state.status,
      mode: state.mode,
      tiebreak: state.tiebreak,
      bestOf: state.bestOf,

      pointsA: state.pointsA, pointsB: state.pointsB,
      gamesA: state.gamesA, gamesB: state.gamesB,
      setsA: state.setsA, setsB: state.setsB,

      undo: state.undo,
      updatedAt: Date.now()
    });

    // delete processed action
    tx.delete(actionRef);
  });

  log(`OK ${action.type}${action.team ? " "+action.team : ""} (${action.source || "?"})`);
}

// ---------- UI bind ----------
function renderScore(snap){
  if (!snap.exists){
    $("statusLine").textContent = "NO MATCH";
    $("scoreA").textContent = "0";
    $("scoreB").textContent = "0";
    $("setsGamesA").textContent = "Sets 0 • Jeux 0";
    $("setsGamesB").textContent = "Sets 0 • Jeux 0";
    return;
  }
  const d = snap.data() || {};
  const inTb = (d.mode === "tiebreak") || (d.tiebreak && d.mode === "gamesets" && d.gamesA === 6 && d.gamesB === 6);

  const lbl = (p) => inTb ? String(p||0) : ["0","15","30","40"][Math.min(3, p||0)];

  $("statusLine").textContent = `Status: ${d.status||"?"} • mode:${d.mode||"?"} • tb:${d.tiebreak}`;
  $("scoreA").textContent = lbl(d.pointsA||0);
  $("scoreB").textContent = lbl(d.pointsB||0);
  $("setsGamesA").textContent = `Sets ${d.setsA||0} • Jeux ${d.gamesA||0}`;
  $("setsGamesB").textContent = `Sets ${d.setsB||0} • Jeux ${d.gamesB||0}`;
}

async function start(){
  setGroupId(GROUP_ID);
  await ensureAuth();

  $("btnGroup").onclick = async () => {
    setGroupId($("groupId").value);
    location.reload();
  };

  $("btnStart").onclick = async () => {
    await refActive().set({
      status: "LIVE",
      mode: "gamesets",
      tiebreak: true,
      bestOf: 3,
      pointsA: 0, pointsB: 0,
      gamesA: 0, gamesB: 0,
      setsA: 0, setsB: 0,
      undo: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    }, { merge: true });
    log("Match LIVE initialisé");
  };

  $("btnLive").onclick = () => refActive().update({ status: "LIVE", updatedAt: Date.now() });
  $("btnDone").onclick = () => refActive().update({ status: "DONE", updatedAt: Date.now() });

  refActive().onSnapshot(renderScore);

  await startLockLoop();
  startActionProcessor();
}

start();
