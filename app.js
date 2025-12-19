/* =========================================================
   PADEL WEB APP (localStorage) — Mode simple
   - Match 2v2
   - Scoring: 0/15/30/40 en NO-AD (pas d'AV)
     => à 40-40, le point suivant gagne le jeu
   - Jeux + Sets automatiques
   - Tie-break à 6-6 optionnel (points numériques 0..)
   - Classement: stats + ELO (mis à jour à chaque match)
========================================================= */

const LS_PLAYERS = "padel_players_v2";
const LS_MATCHES = "padel_matches_v2";

const $ = (id) => document.getElementById(id);
const uid = () => Math.random().toString(16).slice(2) + Date.now().toString(16);

function loadPlayers() {
  try { return JSON.parse(localStorage.getItem(LS_PLAYERS)) || []; }
  catch { return []; }
}
function savePlayers(players) {
  localStorage.setItem(LS_PLAYERS, JSON.stringify(players));
}
function loadMatches() {
  try { return JSON.parse(localStorage.getItem(LS_MATCHES)) || []; }
  catch { return []; }
}
function saveMatches(matches) {
  localStorage.setItem(LS_MATCHES, JSON.stringify(matches));
}

function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleString("fr-FR", { year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit" });
}

function clamp(n, a, b){ return Math.max(a, Math.min(b, n)); }

/* -------------------------
   Routing
------------------------- */
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

/* -------------------------
   State: current match
------------------------- */
let match = null;
let undoStack = [];

function resetMatch() {
  match = {
    id: uid(),
    dateISO: new Date().toISOString(),
    teamA: [null, null],
    teamB: [null, null],
    bestOf: Number($("bestOf").value), // 3 or 5
    tiebreak: $("tiebreak").value,     // on/off
    mode: $("mode").value,             // gamesets / tiebreak
    serve: $("serveWho").value,        // A/B

    setsA: 0, setsB: 0,
    gamesA: 0, gamesB: 0,

    // points:
    // - gamesets: 0..3 maps to 0/15/30/40 (NO-AD)
    // - tiebreak: numeric
    pointsA: 0, pointsB: 0,

    finished: false
  };
  undoStack = [];
  renderMatch();
  updateNeedPlayersMsg();
}

function snapshot() {
  undoStack.push(JSON.stringify(match));
  undoStack = undoStack.slice(-80);
}
function undo() {
  if (!undoStack.length) return;
  match = JSON.parse(undoStack.pop());
  renderMatch();
  updateNeedPlayersMsg();
}

/* -------------------------
   UI helpers
------------------------- */
function getPlayerById(id){
  return loadPlayers().find(p => p.id === id) || null;
}

function teamName(teamIds){
  const ps = teamIds.map(getPlayerById).filter(Boolean);
  if (ps.length !== 2) return "—";
  return `${ps[0].name} + ${ps[1].name}`;
}

function setServePill() {
  const A = $("serveA"), B = $("serveB");
  A.style.display = (match.serve === "A") ? "inline-block" : "none";
  B.style.display = (match.serve === "B") ? "inline-block" : "none";
}

function setScoreButtonsEnabled(enabled){
  ["btnPointA","btnPointB","btnUndo","btnFinish"].forEach(id=>{
    const el = document.getElementById(id);
    if (!el) return;
    el.disabled = !enabled;
  });
}

/* -------------------------
   Validation teams
------------------------- */
function validateTeams() {
  const a1 = $("a1").value, a2 = $("a2").value, b1 = $("b1").value, b2 = $("b2").value;
  const ids = [a1,a2,b1,b2].filter(Boolean);

  if (ids.length < 4) return { ok:false, msg:"Choisis 4 joueurs (2 par équipe)." };
  const uniq = new Set(ids);
  if (uniq.size !== 4) return { ok:false, msg:"Chaque joueur doit être unique (pas de doublon)." };
  return { ok:true, msg:"" };
}

/* -------------------------
   Scoring helpers
------------------------- */
function currentSetsToWin() {
  return Math.ceil(match.bestOf / 2);
}

function isTiebreakSet() {
  if (match.mode !== "gamesets") return false;
  if (match.tiebreak !== "on") return false;
  return match.gamesA === 6 && match.gamesB === 6;
}

function winGame(team) {
  if (match.mode !== "gamesets") return;

  if (team === "A") match.gamesA++;
  else match.gamesB++;

  // alternance service par jeu (simple)
  match.serve = (match.serve === "A") ? "B" : "A";

  // set gagné: 6 jeux avec 2 d'écart, ou 7 (7-5 / 7-6)
  const a = match.gamesA, b = match.gamesB;
  const diff = Math.abs(a - b);

  const hasSet =
    ((a >= 6 || b >= 6) && diff >= 2 && a <= 7 && b <= 7) ||
    (a === 7 || b === 7);

  if (hasSet) {
    if (a > b) match.setsA++;
    else match.setsB++;

    match.gamesA = 0;
    match.gamesB = 0;
    match.pointsA = 0;
    match.pointsB = 0;
  }
}

function winSetByTiebreak(team) {
  if (team === "A") match.setsA++;
  else match.setsB++;
  match.gamesA = 0;
  match.gamesB = 0;
  match.pointsA = 0;
  match.pointsB = 0;
}

function checkMatchFinished() {
  const toWin = currentSetsToWin();
  if (match.setsA >= toWin || match.setsB >= toWin) match.finished = true;
}

/* 0/15/30/40 (NO-AD, pas d'AV) */
function pointText(p) {
  if (p <= 0) return "0";
  if (p === 1) return "15";
  if (p === 2) return "30";
  return "40";
}

/* -------------------------
   Add point
------------------------- */
function addPointGamesets(team) {
  // Tie-break de set à 6-6
  if (isTiebreakSet()) {
    if (team === "A") match.pointsA++;
    else match.pointsB++;

    const a = match.pointsA, b = match.pointsB;
    const lead = Math.abs(a - b);

    if ((a >= 7 || b >= 7) && lead >= 2) {
      winSetByTiebreak(a > b ? "A" : "B");
    }
    return;
  }

  // Points classiques NO-AD
  if (team === "A") match.pointsA++;
  else match.pointsB++;

  const a = match.pointsA;
  const b = match.pointsB;

  // Cas avant 40-40 : dès qu'un côté atteint 4 points, il gagne le jeu
  // (0/15/30/40 => 0..3, puis 4 = "point gagnant")
  if (a >= 4 && b <= 3) {
    winGame("A");
    match.pointsA = 0; match.pointsB = 0;
    return;
  }
  if (b >= 4 && a <= 3) {
    winGame("B");
    match.pointsA = 0; match.pointsB = 0;
    return;
  }

  // 40-40 (3-3) -> point décisif : le point suivant gagne le jeu
  if (a === 4 && b === 4) {
    winGame(team);
    match.pointsA = 0; match.pointsB = 0;
  }
}

function addPointTiebreak(team) {
  if (team === "A") match.pointsA++;
  else match.pointsB++;

  const a = match.pointsA, b = match.pointsB;
  const lead = Math.abs(a - b);

  // TB only: 1 manche -> setsA/setsB = 1/0
  if ((a >= 7 || b >= 7) && lead >= 2) {
    match.setsA = a > b ? 1 : 0;
    match.setsB = b > a ? 1 : 0;
    match.finished = true;
  }
}

function addPoint(team) {
  if (!match || match.finished) return;

  const v = validateTeams();
  const players = loadPlayers();
  if (players.length < 4 || !v.ok) {
    $("matchStatus").textContent = v.ok ? "Ajoute au moins 4 joueurs dans la liste." : v.msg;
    updateNeedPlayersMsg();
    return;
  }

  snapshot();

  match.mode = $("mode").value;
  match.bestOf = Number($("bestOf").value);
  match.tiebreak = $("tiebreak").value;
  match.serve = $("serveWho").value;

  if (match.mode === "tiebreak") addPointTiebreak(team);
  else addPointGamesets(team);

  checkMatchFinished();
  renderMatch();
}

/* -------------------------
   ELO update (individual)
------------------------- */
function expectedScore(rA, rB){
  return 1 / (1 + Math.pow(10, (rB - rA)/400));
}
function updateEloAfterMatch(winnerTeam, teamAIds, teamBIds) {
  const players = loadPlayers();
  const teamA = teamAIds.map(id => players.find(p => p.id === id)).filter(Boolean);
  const teamB = teamBIds.map(id => players.find(p => p.id === id)).filter(Boolean);
  if (teamA.length !== 2 || teamB.length !== 2) return;

  const avgA = (teamA[0].elo + teamA[1].elo) / 2;
  const avgB = (teamB[0].elo + teamB[1].elo) / 2;

  const expA = expectedScore(avgA, avgB);
  const expB = expectedScore(avgB, avgA);

  const K = 24;
  const scoreA = (winnerTeam === "A") ? 1 : 0;
  const scoreB = (winnerTeam === "B") ? 1 : 0;

  const deltaA = K * (scoreA - expA);
  const deltaB = K * (scoreB - expB);

  teamA.forEach(p => p.elo = Math.round(p.elo + deltaA));
  teamB.forEach(p => p.elo = Math.round(p.elo + deltaB));

  players.forEach(p => p.elo = clamp(p.elo, 200, 3000));
  savePlayers(players);
}

/* -------------------------
   Save match
------------------------- */
function finishMatch() {
  if (!match) return;

  const v = validateTeams();
  if (!v.ok) { $("matchStatus").textContent = v.msg; return; }

  let winner = null;

  if (match.mode === "tiebreak") {
    if (!match.finished) { $("matchStatus").textContent = "Le tie-break n'est pas terminé."; return; }
    winner = match.setsA > match.setsB ? "A" : "B";
  } else {
    checkMatchFinished();
    if (!match.finished) {
      $("matchStatus").textContent = "Match pas terminé (sets). Continue à marquer des points.";
      return;
    }
    winner = match.setsA > match.setsB ? "A" : "B";
  }

  match.teamA = [$("a1").value, $("a2").value];
  match.teamB = [$("b1").value, $("b2").value];
  match.bestOf = Number($("bestOf").value);
  match.tiebreak = $("tiebreak").value;
  match.mode = $("mode").value;
  match.winner = winner;

  const matches = loadMatches();
  matches.unshift({
    id: match.id,
    dateISO: new Date().toISOString(),
    teamA: match.teamA,
    teamB: match.teamB,
    setsA: match.setsA,
    setsB: match.setsB,
    gamesA: match.gamesA,
    gamesB: match.gamesB,
    pointsA: match.pointsA,
    pointsB: match.pointsB,
    bestOf: match.bestOf,
    tiebreak: match.tiebreak,
    mode: match.mode,
    winner: match.winner
  });
  saveMatches(matches);

  updateEloAfterMatch(winner, match.teamA, match.teamB);

  $("matchStatus").textContent = "✅ Match enregistré !";
  refreshAll();

  setTimeout(() => {
    resetMatch();
    $("matchStatus").textContent = "";
  }, 600);
}

/* -------------------------
   Rendering
------------------------- */
function fillPlayerSelects() {
  const players = loadPlayers().slice().sort((a,b) => a.name.localeCompare(b.name, "fr"));
  const selects = ["a1","a2","b1","b2"].map($);

  selects.forEach(sel => {
    const cur = sel.value;
    sel.innerHTML =
      `<option value="">— choisir —</option>` +
      players.map(p => `<option value="${p.id}">${escapeHtml(p.name)} (N${p.level})</option>`).join("");
    if (players.some(p => p.id === cur)) sel.value = cur;
  });
}

function updateNeedPlayersMsg() {
  const players = loadPlayers();
  const v = validateTeams();
  const need = players.length < 4;

  let msg = "";
  if (need) msg = `Il te faut au moins 4 joueurs enregistrés. Actuellement : ${players.length}.`;
  else if (!v.ok) msg = v.msg;

  $("needPlayersMsg").textContent = msg;
  setScoreButtonsEnabled(!need && v.ok);
}

function renderMatch() {
  if (!match) return;

  const aIds = [$("a1").value, $("a2").value];
  const bIds = [$("b1").value, $("b2").value];

  $("teamAName").textContent = (aIds[0] && aIds[1]) ? teamName(aIds) : "Équipe A";
  $("teamBName").textContent = (bIds[0] && bIds[1]) ? teamName(bIds) : "Équipe B";

  $("setsA").textContent = match.setsA;
  $("setsB").textContent = match.setsB;
  $("gamesA").textContent = match.gamesA;
  $("gamesB").textContent = match.gamesB;

  const inTB = (match.mode === "tiebreak") || isTiebreakSet();

  $("pointsA").textContent = inTB ? match.pointsA : pointText(match.pointsA);
  $("pointsB").textContent = inTB ? match.pointsB : pointText(match.pointsB);

  $("pointsLabelA").textContent = inTB ? "tie-break" : "points";
  $("pointsLabelB").textContent = inTB ? "tie-break" : "points";

  setServePill();

  if (match.finished) {
    const winner = match.setsA > match.setsB ? "A" : "B";
    $("matchStatus").textContent = `🏁 Match terminé (vainqueur : Équipe ${winner}). Clique sur “Terminer & enregistrer”.`;
  }
}

function renderPlayersTable() {
  const tb = $("playersTable").querySelector("tbody");
  const players = loadPlayers().slice().sort((a,b) => a.name.localeCompare(b.name, "fr"));

  tb.innerHTML = players.map(p => `
    <tr>
      <td>${escapeHtml(p.name)}</td>
      <td>N${p.level}</td>
      <td>${p.elo}</td>
      <td>
        <button class="btn ghost" data-edit="${p.id}">Modifier</button>
        <button class="btn danger" data-del="${p.id}">Supprimer</button>
      </td>
    </tr>
  `).join("");

  tb.querySelectorAll("[data-del]").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-del");
      if (!confirm("Supprimer ce joueur ?")) return;
      savePlayers(loadPlayers().filter(p => p.id !== id));
      refreshAll();
    });
  });

  tb.querySelectorAll("[data-edit]").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-edit");
      const p = loadPlayers().find(x => x.id === id);
      if (!p) return;

      const name = prompt("Nom du joueur :", p.name);
      if (!name) return;
      const level = prompt("Niveau (1-5) :", String(p.level));
      const lvl = clamp(Number(level || p.level), 1, 5);

      const players = loadPlayers();
      const idx = players.findIndex(x => x.id === id);
      players[idx] = { ...players[idx], name: name.trim(), level: lvl };
      savePlayers(players);
      refreshAll();
    });
  });
}

function computeStats() {
  const players = loadPlayers();
  const matches = loadMatches();

  const stats = {};
  players.forEach(p => {
    stats[p.id] = { id:p.id, name:p.name, level:p.level, elo:p.elo, matches:0, wins:0, losses:0 };
  });

  matches.forEach(m => {
    const a = m.teamA || [];
    const b = m.teamB || [];
    const winner = m.winner;

    [...a, ...b].forEach(pid => { if (stats[pid]) stats[pid].matches++; });

    const winIds = (winner === "A") ? a : b;
    const loseIds = (winner === "A") ? b : a;

    winIds.forEach(pid => { if (stats[pid]) stats[pid].wins++; });
    loseIds.forEach(pid => { if (stats[pid]) stats[pid].losses++; });
  });

  return Object.values(stats).map(s => ({
    ...s,
    winrate: s.matches ? (s.wins / s.matches) : 0
  }));
}

function renderRanking() {
  const tb = $("rankingTable").querySelector("tbody");
  const sort = $("rankingSort").value;
  const q = ($("rankingSearch").value || "").trim().toLowerCase();

  let rows = computeStats().filter(r => r.name.toLowerCase().includes(q));

  const sorters = {
    elo: (a,b) => b.elo - a.elo,
    wins: (a,b) => b.wins - a.wins || b.elo - a.elo,
    winrate: (a,b) => b.winrate - a.winrate || b.matches - a.matches,
    matches: (a,b) => b.matches - a.matches || b.wins - a.wins,
    level: (a,b) => b.level - a.level || b.elo - a.elo,
  };
  rows.sort(sorters[sort] || sorters.elo);

  tb.innerHTML = rows.map((r, i) => `
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

function matchScoreLabel(m) {
  if (m.mode === "tiebreak") return `Tie-break ${m.pointsA ?? "?"}-${m.pointsB ?? "?"}`;
  let s = `${m.setsA}-${m.setsB} (BO${m.bestOf})`;
  if ((m.gamesA ?? 0) || (m.gamesB ?? 0)) s += ` | jeux ${m.gamesA}-${m.gamesB}`;
  if ((m.pointsA ?? 0) || (m.pointsB ?? 0)) s += ` | TB ${m.pointsA}-${m.pointsB}`;
  return s;
}

function renderMatches() {
  const tb = $("matchesTable").querySelector("tbody");
  const matches = loadMatches();

  tb.innerHTML = matches.map(m => {
    const aName = teamName(m.teamA || []);
    const bName = teamName(m.teamB || []);
    const win = (m.winner === "A") ? "Équipe A" : "Équipe B";
    return `
      <tr>
        <td>${formatDate(m.dateISO)}</td>
        <td>${escapeHtml(aName)}</td>
        <td>${escapeHtml(bName)}</td>
        <td>${escapeHtml(matchScoreLabel(m))}</td>
        <td>${win}</td>
        <td><button class="btn danger" data-delmatch="${m.id}">Supprimer</button></td>
      </tr>
    `;
  }).join("");

  tb.querySelectorAll("[data-delmatch]").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-delmatch");
      if (!confirm("Supprimer ce match ?")) return;
      saveMatches(loadMatches().filter(m => m.id !== id));
      refreshAll();
    });
  });
}

/* -------------------------
   Players actions
------------------------- */
function addPlayer() {
  const name = ($("playerName").value || "").trim();
  const level = Number($("playerLevel").value || "3");
  if (!name) return;

  const players = loadPlayers();
  players.push({ id: uid(), name, level: clamp(level, 1, 5), elo: 1000 });
  savePlayers(players);

  $("playerName").value = "";
  refreshAll();
}

function seedPlayers() {
  const players = loadPlayers();
  if (players.length) {
    if (!confirm("Des joueurs existent déjà. Ajouter quand même des exemples ?")) return;
  }
  const samples = [
    ["Alex Martin", 3],
    ["Brian Dupont", 4],
    ["Chloé Bernard", 2],
    ["David Leroy", 3],
    ["Emma Petit", 1],
    ["Fares Diallo", 5],
  ];
  savePlayers(players.concat(samples.map(([name, level]) => ({ id: uid(), name, level, elo: 1000 }))));
  refreshAll();
}

/* -------------------------
   Utilities
------------------------- */
function escapeHtml(s){
  return String(s || "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

/* -------------------------
   Refresh
------------------------- */
function refreshAll() {
  fillPlayerSelects();
  updateNeedPlayersMsg();
  renderPlayersTable();
  renderRanking();
  renderMatches();
  if (match) renderMatch();
}

/* -------------------------
   Events
------------------------- */
function wireEvents() {
  $("btnStart").addEventListener("click", () => {
    resetMatch();
    $("matchStatus").textContent = "";
  });

  $("btnPointA").addEventListener("click", () => addPoint("A"));
  $("btnPointB").addEventListener("click", () => addPoint("B"));

  $("btnUndo").addEventListener("click", () => undo());
  $("btnFinish").addEventListener("click", () => finishMatch());

  $("btnAddPlayer").addEventListener("click", addPlayer);
  $("playerName").addEventListener("keydown", (e) => { if (e.key === "Enter") addPlayer(); });
  $("btnSeed").addEventListener("click", seedPlayers);

  $("rankingSort").addEventListener("change", renderRanking);
  $("rankingSearch").addEventListener("input", renderRanking);

  $("serveWho").addEventListener("change", () => {
    if (!match) return;
    match.serve = $("serveWho").value;
    renderMatch();
  });

  ["a1","a2","b1","b2","bestOf","tiebreak","mode"].forEach(id => {
    $(id).addEventListener("change", () => {
      updateNeedPlayersMsg();
      if (match) {
        match.bestOf = Number($("bestOf").value);
        match.tiebreak = $("tiebreak").value;
        match.mode = $("mode").value;
        renderMatch();
      }
    });
  });

  $("btnClearMatches").addEventListener("click", () => {
    if (!confirm("Supprimer tout l'historique des matchs ?")) return;
    saveMatches([]);
    refreshAll();
  });
}

/* -------------------------
   Init
------------------------- */
function init() {
  if (!loadPlayers()) savePlayers([]);
  resetMatch();
  wireEvents();
  setActiveRoute();
  refreshAll();
}
init();
