import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, doc, getDoc, setDoc, addDoc, onSnapshot, collection, query, where, getDocs, orderBy, updateDoc, deleteDoc, writeBatch, limit, startAfter } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js";

const firebaseConfig = {
    apiKey: "AIzaSyB2k1aw2nNA7O5Lw4DhQiNKy_o6VpZ3v4k",
    authDomain: "webapp-e67fe.firebaseapp.com",
    projectId: "webapp-e67fe",
    storageBucket: "webapp-e67fe.firebasestorage.app",
    appId: "1:137078762697:web:654b6e931dbc85ef2c7118"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = initializeFirestore(app, {
    localCache: persistentLocalCache({tabManager: persistentMultipleTabManager()})
});
const storage = getStorage(app);

// Array viste aggiornato con le nuove schermate Giudici
const views = ['loadingView', 'loginView', 'organizerHomeView', 'joinEventView', 'participantLobbyView', 'participantView', 'checkpointView', 'organizerDashboardView', 'organizerDetailView', 'organizerAdminView', 'organizerTeamsView', 'activityLogView', 'organizerJudgeListView', 'organizerJudgeDetailView', 'organizerMapView'];

function showView(viewId) {
    views.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.add('hidden');
    });
    const viewToShow = document.getElementById(viewId);
    if (viewToShow) viewToShow.classList.remove('hidden');
    window.scrollTo(0, 0);
}

let currentEventId = null;
let currentUserRole = null;
let currentUserId = null;
let participantListenerUnsub = null;
let participantSubsUnsub = null;
let activityLogUnsub = null;
let unsubscribeDashboard = null;
let unsubscribeTeams = null;
let unsubscribeCheckpoints = null;
let organizerHomeUnsub = null;
let organizerTeamsUnsub = null;
let organizerAdminUnsub = null;
let judgeListUnsub = null;
let dashboardData = null;
let currentJudgeTeamId = null;
let isDashboardInitialized = false;
let renderTimeout = null;
let mapRenderTimeout = null;
let lastActivityDoc = null;
let leaderboardAnimationFrame = null;
let isFirstActivityLoad = true;

onAuthStateChanged(auth, async user => {
    if (participantListenerUnsub) { participantListenerUnsub(); participantListenerUnsub = null; }
    if (participantSubsUnsub) { participantSubsUnsub(); participantSubsUnsub = null; }
    if (activityLogUnsub) { activityLogUnsub(); activityLogUnsub = null; }
    if (judgeListUnsub) { judgeListUnsub(); judgeListUnsub = null; }

    if (user) {
        currentUserId = user.uid;
        try {
            const userDoc = await getDoc(doc(db, "users", user.uid));
            if (userDoc.exists() && userDoc.data().role === 'organizer') {
                currentUserRole = 'organizer';
                initOrganizerHomeView(user);
            } else {
                currentUserRole = 'participant';
                const userData = userDoc.exists() ? userDoc.data() : {};
                const savedEventId = userData.currentEventId || localStorage.getItem('currentEventId-' + user.uid);
                if (savedEventId) {
                    const eventDoc = await getDoc(doc(db, "events", savedEventId));
                    if (eventDoc.exists()) {
                        currentEventId = savedEventId;
                        const eventStatus = eventDoc.data().status;
                        if (eventStatus === 'active') {
                            initParticipantView(currentUserId);
                        } else if (eventStatus === 'pending') {
                            initParticipantLobbyView();
                        } else { // 'finished'
                            initParticipantView(currentUserId, true);
                        }
                    } else {
                        localStorage.removeItem('currentEventId-' + user.uid);
                        showView('joinEventView');
                    }
                } else {
                    showView('joinEventView');
                }
            }
        } catch (error) {
            showModal("Errore Critico", "Impossibile verificare il tuo ruolo utente. " + error.message, false, () => signOut(auth));
        }
    } else {
        currentUserId = null; currentUserRole = null; currentEventId = null;
        showView('loginView');
    }
});

const modal = document.getElementById('modal');
const modalTitle = document.getElementById('modalTitle');
const modalMessage = document.getElementById('modalMessage');
const modalConfirmBtn = document.getElementById('modalConfirmBtn');
const modalCancelBtn = document.getElementById('modalCancelBtn');
let confirmCallback = null;
function showModal(title, message, showConfirm = false, onConfirm = null) {
    modalTitle.textContent = title;
    modalMessage.textContent = message;
    confirmCallback = onConfirm;
    modalConfirmBtn.classList.toggle('hidden', !showConfirm);
    modalCancelBtn.textContent = showConfirm ? 'Annulla' : 'Chiudi';
    modal.classList.remove('hidden');
}
modalCancelBtn.addEventListener('click', () => modal.classList.add('hidden'));
modalConfirmBtn.addEventListener('click', () => { if (confirmCallback) confirmCallback(); modal.classList.add('hidden'); });

document.getElementById('loginForm').addEventListener('submit', (e) => { 
    e.preventDefault(); 
    signInWithEmailAndPassword(auth, e.target.email.value, e.target.password.value)
    .catch(err => showModal("Errore", "Login fallito: " + err.message)); 
});

document.getElementById('registerForm').addEventListener('submit', async (e) => { 
    e.preventDefault(); 
    try { 
        const cred = await createUserWithEmailAndPassword(auth, e.target.email.value, e.target.password.value); 
        await setDoc(doc(db, "users", cred.user.uid), { role: 'participant' }); 
    } catch (error) { showModal("Errore", "Registrazione fallita: " + error.message); } 
});

function initOrganizerHomeView(user) {
    if (organizerHomeUnsub) organizerHomeUnsub();
    const eventsList = document.getElementById('organizerEventsList');
    const q = query(collection(db, "events"), where("organizerId", "==", user.uid), orderBy("creation_time", "desc"));
    
    organizerHomeUnsub = onSnapshot(q, (snapshot) => {
        eventsList.innerHTML = snapshot.empty ? `<p class="text-gray-500">Nessun evento creato.</p>` : '';
        snapshot.forEach(doc => {
            const event = doc.data();
            const eventCard = document.createElement('div');
            eventCard.className = 'p-4 bg-white rounded-lg shadow-md flex justify-between items-center';
            eventCard.innerHTML = `<div><h3 class="font-bold text-xl text-green-800">${event.name}</h3><p class="text-sm text-gray-500">Codice: <span class="font-mono font-bold">${event.joinCode}</span></p></div><div class="flex space-x-2"><button class="manage-event-btn btn btn-primary px-4 py-2">Gestisci</button></div>`;
            eventCard.querySelector('.manage-event-btn').onclick = () => { currentEventId = doc.id; initOrganizerDashboardView(); };
            eventsList.appendChild(eventCard);
        });
        lucide.createIcons();
    }, (error) => console.error(error));
    showView('organizerHomeView');
}

document.getElementById('createEventForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const eventName = document.getElementById('eventName').value;
    const joinCode = `GARA-${Math.random().toString(36).substr(2, 4).toUpperCase()}`;
    await addDoc(collection(db, "events"), { name: eventName, joinCode: joinCode, organizerId: currentUserId, status: 'pending', creation_time: new Date() });
    e.target.reset();
});

document.getElementById('logout-organizer-home').addEventListener('click', () => signOut(auth));

// --- DASHBOARD & SCORING LOGIC ---

async function initOrganizerDashboardView() { showView('organizerDashboardView'); setupDashboardListener(); }

async function setupDashboardListener() {
    if (isDashboardInitialized) return;
    isDashboardInitialized = true;
    try {
        const eventRef = doc(db, "events", currentEventId);
        const eventDoc = await getDoc(eventRef);
        
        // script.js - All'interno di setupDashboardListener()
        if (eventDoc.exists()) {
            const eventData = eventDoc.data();
            
            dashboardData = {
                eventName: eventData.name, // Inserire qui
                checkpoints: [],
                teams: [],
                submissions: []
            };

            const badge = document.getElementById('dashboardEventStatus');
            if (badge) {
                const st = eventData.status;
                if (st === 'pending') badge.innerHTML = '<span class="bg-yellow-100 text-yellow-800 px-3 py-1 rounded-full text-sm font-bold border border-yellow-200">In Attesa</span>';
                else if (st === 'active') badge.innerHTML = '<span class="bg-green-100 text-green-800 px-3 py-1 rounded-full text-sm font-bold border border-green-200">In Corso</span>';
                else badge.innerHTML = '<span class="bg-gray-100 text-gray-800 px-3 py-1 rounded-full text-sm font-bold border border-gray-300">Terminata</span>';
            }
            
            unsubscribeTeams = onSnapshot(collection(db, `events/${currentEventId}/teams`), (snap) => {
                dashboardData.teams = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                const dashboardView = document.getElementById('organizerDashboardView');
                if (dashboardData.checkpoints.length > 0 && !dashboardView.classList.contains('hidden')) {
                    renderOrganizerUI(eventData, dashboardData.teams, dashboardData.checkpoints);
                    updateDashboardDOM(dashboardData.teams, dashboardData.checkpoints, dashboardData.submissions);
                }
            });

            unsubscribeCheckpoints = onSnapshot(query(collection(db, `events/${currentEventId}/checkpoints`), orderBy("number")), (snap) => {
                dashboardData.checkpoints = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                renderOrganizerUI(eventData, dashboardData.teams, dashboardData.checkpoints);
                const dashboardView = document.getElementById('organizerDashboardView');
                if (!dashboardView.classList.contains('hidden')) {
                    updateDashboardDOM(dashboardData.teams, dashboardData.checkpoints, dashboardData.submissions);
                }
            });
            
            const subQ = query(collection(db, "submissions"), where("eventId", "==", currentEventId));
            unsubscribeDashboard = onSnapshot(subQ, (subSnap) => {
                dashboardData.submissions = subSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                const dashboardView = document.getElementById('organizerDashboardView');
                if (!dashboardView.classList.contains('hidden')) {
                    updateDashboardDOM(dashboardData.teams, dashboardData.checkpoints, dashboardData.submissions);
                }

                const mapView = document.getElementById('organizerMapView');
                if (mapView && !mapView.classList.contains('hidden')) {
                    if (mapRenderTimeout) clearTimeout(mapRenderTimeout);
                        mapRenderTimeout = setTimeout(() => {
                            const checkedTeams = Array.from(document.querySelectorAll('.map-team-cb:checked')).map(cb => cb.value);
                            initMapTeamSelector(true);
                            document.querySelectorAll('.map-team-cb').forEach(cb => {
                                cb.checked = checkedTeams.includes(cb.value);
                            });
                            renderLiveMap();
                        }, 1500);
                }

                if (currentJudgeTeamId) {
                    const t = dashboardData.teams.find(t => t.id === currentJudgeTeamId);
                    const s = dashboardData.submissions.filter(s => s.teamId === currentJudgeTeamId);
                    const isJudgeDetailVisible = !document.getElementById('organizerJudgeDetailView').classList.contains('hidden');
                    if (t && isJudgeDetailVisible) renderJudgeDetail(t, dashboardData.checkpoints, s);
                }
            });
        }
    } catch (error) { showModal("Errore Dashboard", error.message); }
}

function calculateScore(teamId, checkpoints, submissions, subsMap = null) {
    let score = 0;
    let completed = 0;
    checkpoints.forEach(cp => {
        // Se abbiamo il dizionario cerchiamo lì, altrimenti usiamo il vecchio metodo find
        const sub = subsMap ? subsMap[`${teamId}_${cp.id}`] : submissions.find(s => s.teamId === teamId && s.checkpointId === cp.id);
        
        if (sub && sub.status !== 'rejected') {
            completed++;
            if (cp.cpType === 'selfie') {
                score += (cp.points || 0);
            } else {
                if (cp.correctAnswer && sub.answer && sub.answer.toLowerCase().trim() === cp.correctAnswer.toLowerCase().trim()) {
                    score += (cp.points || 0);
                }
            }
        }
    });
    return { score, completed };
}

function renderOrganizerUI(eventData, teams, checkpoints) {
    const organizerGrid = document.getElementById('organizerGrid');
    let tableHtml = `<thead class="bg-gray-200"><tr><th class="p-3 text-left">Squadra</th>${checkpoints.map(c => `<th class="p-3 text-center w-20">${c.number}<br><span class="text-xs text-gray-500">${c.cpType === 'selfie' ? '📷' : '📝'}</span></th>`).join('')}</tr></thead><tbody>`;
    
    teams.forEach(team => { 
        const isNonComp = team.category === 'non-competitive';
        const nameBadge = isNonComp ? ` <span class="text-xs bg-gray-200 text-gray-600 px-1 rounded">Ludica</span>` : '';
        tableHtml += `<tr class="border-b"><td class="p-3 font-medium">${team.name}${nameBadge}</td>`;
        
        // Generazione ID univoci per le celle, inserimento stato vuoto di default
        checkpoints.forEach(c => {
            tableHtml += `<td id="cell-${team.id}-${c.id}" class="p-3 text-center align-middle cursor-pointer hover:bg-gray-50" onclick="showOrganizerDetail('${team.id}','${c.id}')"><i data-lucide="circle-dashed" class="w-5 h-5 text-gray-400 mx-auto"></i></td>`;
        });
        tableHtml += `</tr>`;
    });
    
    organizerGrid.innerHTML = tableHtml + '</tbody>';
    lucide.createIcons();
    
    window.showOrganizerDetail = (teamId, cpId) => {
        const sub = dashboardData.submissions.find(s => s.teamId === teamId && s.checkpointId === cpId);
        const cp = dashboardData.checkpoints.find(c => c.id === cpId);
        const tm = dashboardData.teams.find(t => t.id === teamId);
        if(sub && cp && tm) {
             const isCorrect = cp.cpType === 'selfie' ? true : (cp.correctAnswer.toLowerCase().trim() === sub.answer.toLowerCase().trim());
             showSubmissionDetail(sub, cp, isCorrect, tm);
        }
    };
}

function updateDashboardDOM(teams, checkpoints, submissions) {
    if (renderTimeout) clearTimeout(renderTimeout);
    renderTimeout = setTimeout(() => {
        executeDashboardDOM(teams, checkpoints, submissions);
    }, 1500);
}

function executeDashboardDOM(teams, checkpoints, submissions) {
    // 1. CREAZIONE DIZIONARIO (HASH MAP) - Risolve Criticità 2
    const subsMap = {};
    submissions.forEach(s => {
        subsMap[`${s.teamId}_${s.checkpointId}`] = s;
    });

    // 2. AGGIORNAMENTO CELLE (Veloce grazie al dizionario)
    let gridChanged = false;
    teams.forEach(team => {
        checkpoints.forEach(cp => {
            const sub = subsMap[`${team.id}_${cp.id}`];
            const cell = document.getElementById(`cell-${team.id}-${cp.id}`);
            if (cell) {
                let iconHtml = '<i data-lucide="circle-dashed" class="w-5 h-5 text-gray-400 mx-auto"></i>';
                if (sub) {
                    if (sub.status === 'rejected') {
                        iconHtml = '<i data-lucide="ban" class="w-5 h-5 text-gray-300 mx-auto"></i>'; 
                    } else if (cp.cpType === 'selfie') {
                        iconHtml = '<i data-lucide="camera" class="w-5 h-5 text-blue-600 mx-auto"></i>';
                    } else {
                        const isCorrect = cp.correctAnswer.toLowerCase().trim() === sub.answer.toLowerCase().trim();
                        iconHtml = isCorrect ? '<i data-lucide="check-circle-2" class="w-6 h-6 text-green-600 mx-auto"></i>' : '<i data-lucide="x-circle" class="w-6 h-6 text-red-500 mx-auto"></i>';
                    }
                }
                if (cell.innerHTML !== iconHtml) {
                    cell.innerHTML = iconHtml;
                    gridChanged = true;
                }
            }
        });
    });
    if (gridChanged) lucide.createIcons({ root: document.getElementById('organizerGrid') });

    // 3. CALCOLO CLASSIFICA
    const teamStats = teams.map(team => {
        const stats = calculateScore(team.id, checkpoints, submissions, subsMap);
        return { ...team, ...stats };
    });

    teamStats.sort((a, b) => b.score - a.score);

    // 4. RENDERING CLASSIFICA (DOM Recycling)
    if (leaderboardAnimationFrame) cancelAnimationFrame(leaderboardAnimationFrame);
    leaderboardAnimationFrame = null;

    const leaderboardBody = document.getElementById('leaderboardBody');
    const existingRows = leaderboardBody.children;

    teamStats.forEach((team, i) => {
        const badge = team.category === 'non-competitive' 
            ? '<span class="ml-2 text-xs bg-gray-200 text-gray-600 px-1 rounded">Ludica</span>' 
            : '<span class="ml-2 text-xs bg-orange-100 text-brand-orange px-1 rounded border border-orange-200">Competitiva</span>';
        
        const rowClass = `border-b ${i === 0 ? 'bg-yellow-100' : ''}`;
        const cellContent = `<td class="p-2 text-center font-bold">${i + 1}</td><td class="p-2"><div class="font-bold">${team.name}${badge}</div><div class="text-xs text-gray-500">${team.email || ''}</div></td><td class="p-2 text-center">${team.completed}/${checkpoints.length}</td><td class="p-2 text-right font-bold">${team.score}</td>`;

        if (existingRows[i]) {
            if (existingRows[i].className !== rowClass) existingRows[i].className = rowClass;
            if (existingRows[i].innerHTML !== cellContent) existingRows[i].innerHTML = cellContent;
        } else {
            const tr = document.createElement('tr');
            tr.className = rowClass;
            tr.innerHTML = cellContent;
            leaderboardBody.appendChild(tr);
        }
    });

    while (existingRows.length > teamStats.length) {
        leaderboardBody.removeChild(leaderboardBody.lastChild);
    }
}

// Export CSV
document.getElementById('exportCsvBtn').addEventListener('click', () => {
    if (!dashboardData || !dashboardData.teams.length) return;
    const teams = dashboardData.teams;
    const { checkpoints, submissions } = dashboardData;

    // 1. HASH MAP O(1)
    const subsMap = {};
    submissions.forEach(s => {
        subsMap[`${s.teamId}_${s.checkpointId}`] = s;
    });

    // 2. CALCOLO DATI
    const teamStats = teams.map(team => {
        let score = 0;
        let lastCorrectTime = 0;
        const teamSubs = [];
        checkpoints.forEach(cp => {
            const sub = subsMap[`${team.id}_${cp.id}`];
            let cellText = "-";

            if (sub) {
                if (sub.status === 'rejected') {
                    cellText = "ANNULLATO";
                } else {
                    cellText = sub.answer || "(Foto)";
                    let isCorrect = false;
                    
                    if (cp.cpType === 'selfie') {
                        isCorrect = true;
                    } else {
                        if (sub.answer.toLowerCase().trim() === cp.correctAnswer.toLowerCase().trim()) {
                            isCorrect = true;
                        }
                    }
                    
                    if (isCorrect) {
                        score += cp.points;
                        const subTime = sub.timestamp ? (typeof sub.timestamp.toMillis === 'function' ? sub.timestamp.toMillis() : sub.timestamp.toDate().getTime()) : 0;
                        if (subTime > lastCorrectTime) lastCorrectTime = subTime;
                    }
                }
            }
            cellText = cellText.replace(/"/g, '""');
            teamSubs.push(`"${cellText}"`);
        });
        return { name: team.name, category: team.category, score, lastCorrectTime, subs: teamSubs };
    });

    // 3. SEPARAZIONE ARRAY
    const competitive = teamStats.filter(t => t.category !== 'non-competitive');
    const nonCompetitive = teamStats.filter(t => t.category === 'non-competitive');

    // 4. ORDINAMENTO CONDIZIONALE
    competitive.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        if (a.lastCorrectTime === 0) return 1;
        if (b.lastCorrectTime === 0) return -1;
        return a.lastCorrectTime - b.lastCorrectTime;
    });

    // 5. DOPPIO DOWNLOAD CSV
    const correctAnswersRow = checkpoints.map(cp => {
        if (cp.cpType === 'selfie') return '"(Foto)"';
        return `"${(cp.correctAnswer || "").replace(/"/g, '""')}"`;
    });

    // CSV COMPETITIVA
    let csvCompetitive = "Squadra;Categoria;" + checkpoints.map(cp => `"#${cp.number} (${cp.cpType})"`).join(";") + ';"ULTIMO ORARIO ESATTO";"TOTALE"\n';
    csvCompetitive += `"RISPOSTE ESATTE";"-";${correctAnswersRow.join(";")};"-";"-"\n`;
    competitive.forEach(t => {
        const safeName = t.name.replace(/"/g, '""');
        const formattedTime = t.lastCorrectTime > 0 ? new Date(t.lastCorrectTime).toLocaleTimeString('it-IT') : "-";
        csvCompetitive += `"${safeName}";"Competitiva";${t.subs.join(";")};"${formattedTime}";"${t.score}"\n`;
    });

    const blobCompetitive = new Blob(["\uFEFF" + csvCompetitive], { type: 'text/csv;charset=utf-8;' });
    setTimeout(() => {
        const linkCompetitive = document.createElement("a");
        linkCompetitive.href = URL.createObjectURL(blobCompetitive);
        linkCompetitive.download = "classifica_competitiva.csv";
        document.body.appendChild(linkCompetitive);
        linkCompetitive.click();
        document.body.removeChild(linkCompetitive);
    }, 0);

    // CSV LUDICA
    let csvLudica = "Squadra;Categoria;" + checkpoints.map(cp => `"#${cp.number} (${cp.cpType})"`).join(";") + ';"ULTIMO ORARIO ESATTO";"TOTALE"\n';
    csvLudica += `"RISPOSTE ESATTE";"-";${correctAnswersRow.join(";")};"-";"-"\n`;
    nonCompetitive.forEach(t => {
        const safeName = t.name.replace(/"/g, '""');
        const formattedTime = t.lastCorrectTime > 0 ? new Date(t.lastCorrectTime).toLocaleTimeString('it-IT') : "-";
        csvLudica += `"${safeName}";"Ludica";${t.subs.join(";")};"${formattedTime}";"${t.score}"\n`;
    });

    const blobLudica = new Blob(["\uFEFF" + csvLudica], { type: 'text/csv;charset=utf-8;' });
    setTimeout(() => {
        const linkLudica = document.createElement("a");
        linkLudica.href = URL.createObjectURL(blobLudica);
        linkLudica.download = "risultati_ludica.csv";
        document.body.appendChild(linkLudica);
        linkLudica.click();
        document.body.removeChild(linkLudica);
    }, 500);

    // 6. EXPORT HTML
    const eventName = dashboardData.eventName || "Orienteering Challenge";
    const exportDate = new Date().toLocaleDateString('it-IT', { 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });

    let htmlContent = `<!DOCTYPE html>
<html lang="it">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Risultati ${eventName}</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@700;900&family=Roboto:wght@400;500;700&display=swap" rel="stylesheet">
    <style>
        :root {
            --font-body: 'Roboto', sans-serif;
            --font-heading: 'Montserrat', sans-serif;
            --brand-green: #FF0099;
            --brand-orange: #2E7D32;
        }
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: var(--font-body);
            background: #f9fafb;
            color: #1f2937;
            padding: 2rem;
            line-height: 1.6;
        }
        .container {
            max-width: 1200px;
            margin: 0 auto;
        }
        header {
            background: white;
            padding: 2rem;
            border-radius: 0.75rem;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
            margin-bottom: 2rem;
            border-left: 4px solid var(--brand-green);
        }
        h1 {
            font-family: var(--font-heading);
            font-weight: 900;
            color: var(--brand-green);
            font-size: 2rem;
            margin-bottom: 0.5rem;
        }
        .subtitle {
            color: #6b7280;
            font-size: 0.95rem;
        }
        h2 {
            font-family: var(--font-heading);
            font-weight: 700;
            font-size: 1.5rem;
            margin: 2rem 0 1rem 0;
            color: #111827;
        }
        .section {
            background: white;
            padding: 1.5rem;
            border-radius: 0.75rem;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
            margin-bottom: 2rem;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            font-size: 0.9rem;
        }
        thead {
            background: #f3f4f6;
        }
        th {
            padding: 0.75rem;
            text-align: left;
            font-weight: 700;
            color: #374151;
            border-bottom: 2px solid #e5e7eb;
        }
        th.center { text-align: center; }
        th.right { text-align: right; }
        td {
            padding: 0.75rem;
            border-bottom: 1px solid #f3f4f6;
        }
        td.center { text-align: center; }
        td.right { text-align: right; }
        tr:hover {
            background: #f9fafb;
        }
        .podium-1 {
            background: #fef3c7 !important;
            font-weight: 700;
        }
        .podium-2 {
            background: #f3f4f6 !important;
            font-weight: 600;
        }
        .podium-3 {
            background: #fef3e7 !important;
            font-weight: 600;
        }
        .badge {
            display: inline-block;
            padding: 0.25rem 0.75rem;
            border-radius: 0.375rem;
            font-size: 0.75rem;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.025em;
        }
        .badge-competitive {
            background: #ffedd5;
            color: var(--brand-orange);
            border: 1px solid #fed7aa;
        }
        .badge-ludica {
            background: #e5e7eb;
            color: #4b5563;
            border: 1px solid #d1d5db;
        }
        .position {
            font-weight: 700;
            color: #6b7280;
            font-size: 1.1rem;
        }
        .score {
            font-weight: 700;
            font-size: 1.1rem;
        }
        @media print {
            body { background: white; padding: 0; }
            .section { box-shadow: none; page-break-inside: avoid; }
            @page { margin: 1.5cm; }
        }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1>${eventName}</h1>
            <p class="subtitle">Risultati finali — Esportato il ${exportDate}</p>
        </header>

        <div class="section">
            <h2>🏆 Classifica Competitiva</h2>
            <table>
                <thead>
                    <tr>
                        <th style="width: 60px;" class="center">Pos.</th>
                        <th>Squadra</th>
                        <th class="center">Categoria</th>
                        <th class="center">Ultimo Orario</th>
                        <th class="right" style="width: 100px;">Punteggio</th>
                    </tr>
                </thead>
                <tbody>`;

    competitive.forEach((t, i) => {
        const formattedTime = t.lastCorrectTime > 0 ? new Date(t.lastCorrectTime).toLocaleTimeString('it-IT') : "-";
        let rowClass = '';
        if (i === 0) rowClass = 'podium-1';
        else if (i === 1) rowClass = 'podium-2';
        else if (i === 2) rowClass = 'podium-3';
        
        htmlContent += `
                    <tr class="${rowClass}">
                        <td class="center position">${i + 1}</td>
                        <td>${t.name}</td>
                        <td class="center"><span class="badge badge-competitive">Competitiva</span></td>
                        <td class="center">${formattedTime}</td>
                        <td class="right score">${t.score}</td>
                    </tr>`;
    });

    htmlContent += `
                </tbody>
            </table>
        </div>

        <div class="section">
            <h2>🎮 Risultati Ludica</h2>
            <table>
                <thead>
                    <tr>
                        <th>Squadra</th>
                        <th class="center">Categoria</th>
                        <th class="center">Ultimo Orario</th>
                        <th class="right" style="width: 100px;">Punteggio</th>
                    </tr>
                </thead>
                <tbody>`;

    nonCompetitive.forEach(t => {
        const formattedTime = t.lastCorrectTime > 0 ? new Date(t.lastCorrectTime).toLocaleTimeString('it-IT') : "-";
        htmlContent += `
                    <tr>
                        <td>${t.name}</td>
                        <td class="center"><span class="badge badge-ludica">Ludica</span></td>
                        <td class="center">${formattedTime}</td>
                        <td class="right score">${t.score}</td>
                    </tr>`;
    });

    htmlContent += `
                </tbody>
            </table>
        </div>
    </div>
</body>
</html>`;

    const blobHtml = new Blob([htmlContent], { type: 'text/html;charset=utf-8;' });
    setTimeout(() => {
        const linkHtml = document.createElement("a");
        linkHtml.href = URL.createObjectURL(blobHtml);
        linkHtml.download = "risultati_completi.html";
        document.body.appendChild(linkHtml);
        linkHtml.click();
        document.body.removeChild(linkHtml);
    }, 1000);
});

document.getElementById('backToOrganizerHome').addEventListener('click', () => { 
    isDashboardInitialized = false;
    if(unsubscribeDashboard) { unsubscribeDashboard(); unsubscribeDashboard = null; }
    if(unsubscribeTeams) { unsubscribeTeams(); unsubscribeTeams = null; }
    if(unsubscribeCheckpoints) { unsubscribeCheckpoints(); unsubscribeCheckpoints = null; }
    currentEventId = null; 
    showView('organizerHomeView'); 
});

// --- SALA GIUDICI ---
document.getElementById('judgeRoomBtn').addEventListener('click', initJudgeRoom);
document.getElementById('backToDashboardFromJudge').addEventListener('click', () => {
    showView('organizerDashboardView');
    if (dashboardData) updateDashboardDOM(dashboardData.teams, dashboardData.checkpoints, dashboardData.submissions);
});

async function initJudgeRoom() {
    if(!dashboardData) await setupDashboardListener(); // Assicuriamoci di avere i dati
    showView('organizerJudgeListView');
    renderJudgeList();
}

function renderJudgeList() {
    const { teams, checkpoints, submissions } = dashboardData;
    const tbody = document.getElementById('judgeListBody');

    const subsMap = {};
    submissions.forEach(s => {
        subsMap[`${s.teamId}_${s.checkpointId}`] = s;
    });

    const stats = teams.map(t => {
        const calc = calculateScore(t.id, checkpoints, submissions, subsMap);
        const subsCount = submissions.filter(s => s.teamId === t.id && s.status !== 'rejected').length;
        return { ...t, ...calc, subsCount };
    }).sort((a,b) => b.score - a.score);

    tbody.innerHTML = stats.map((t, i) => {
        const badge = t.category === 'non-competitive' 
            ? '<span class="ml-2 text-xs bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full">Ludica</span>' 
            : '<span class="ml-2 text-xs bg-orange-100 text-brand-orange px-2 py-0.5 rounded-full border border-orange-200">Competitiva</span>';
        return `
        <tr class="hover:bg-purple-50 transition-colors">
            <td class="p-4 font-bold text-gray-500">#${i+1}</td>
            <td class="p-4 font-bold text-gray-800 text-lg">${t.name}${badge}</td>
            <td class="p-4 text-center"><span class="bg-gray-100 text-gray-700 px-2 py-1 rounded font-mono">${t.subsCount}</span></td>
            <td class="p-4 text-right font-black text-brand-green text-xl">${t.score}</td>
            <td class="p-4 text-center">
                <button onclick="openJudgeDetail('${t.id}')" class="btn btn-secondary px-4 py-2 text-sm shadow-sm">Esamina</button>
            </td>
        </tr>
    `}).join('');
    
    window.openJudgeDetail = (teamId) => {
        currentJudgeTeamId = teamId;
        const team = dashboardData.teams.find(t => t.id === teamId);
        const teamSubs = dashboardData.submissions.filter(s => s.teamId === teamId);
        showView('organizerJudgeDetailView');
        renderJudgeDetail(team, dashboardData.checkpoints, teamSubs);
    };
}

document.getElementById('backToJudgeList').addEventListener('click', () => showView('organizerJudgeListView'));

document.getElementById('judgeSortOrder').addEventListener('change', () => {
    if (currentJudgeTeamId && dashboardData) {
        const team = dashboardData.teams.find(t => t.id === currentJudgeTeamId);
        const teamSubs = dashboardData.submissions.filter(s => s.teamId === currentJudgeTeamId);
        renderJudgeDetail(team, dashboardData.checkpoints, teamSubs);
    }
});

function renderJudgeDetail(team, checkpoints, teamSubs) {
    document.getElementById('judgeTeamName').textContent = "Squadra: " + team.name;
    const grid = document.getElementById('judgeGrid');
    grid.innerHTML = '';

    const sortOrder = document.getElementById('judgeSortOrder').value;
    let displayCheckpoints = checkpoints.filter(cp => teamSubs.some(s => s.checkpointId === cp.id));

    if (sortOrder === 'timeDesc' || sortOrder === 'timeAsc') {
        displayCheckpoints.sort((a, b) => {
            const subA = teamSubs.find(s => s.checkpointId === a.id);
            const subB = teamSubs.find(s => s.checkpointId === b.id);
            const timeA = subA && subA.timestamp ? (typeof subA.timestamp.toMillis === 'function' ? subA.timestamp.toMillis() : subA.timestamp.toDate().getTime()) : 0;
            const timeB = subB && subB.timestamp ? (typeof subB.timestamp.toMillis === 'function' ? subB.timestamp.toMillis() : subB.timestamp.toDate().getTime()) : 0;
            return sortOrder === 'timeDesc' ? timeB - timeA : timeA - timeB;
        });
    } else {
        displayCheckpoints.sort((a, b) => a.number - b.number);
    }

    displayCheckpoints.forEach(cp => {
        const sub = teamSubs.find(s => s.checkpointId === cp.id);
        const isRejected = sub.status === 'rejected';
        const isSelfie = cp.cpType === 'selfie';
        let isCorrect = false;
        
        if(isSelfie) isCorrect = true; 
        else isCorrect = (sub.answer.toLowerCase().trim() === cp.correctAnswer.toLowerCase().trim());

        const timeString = sub.timestamp ? sub.timestamp.toDate().toLocaleTimeString('it-IT') : '-';

        const card = document.createElement('div');
        card.className = `p-4 rounded-lg shadow border-2 flex flex-col ${isRejected ? 'bg-gray-100 border-gray-300 opacity-75' : 'bg-white border-purple-100'}`;
        
        card.innerHTML = `
            <div class="flex justify-between items-start mb-3">
                <span class="font-bold text-purple-700">Punto #${cp.number} (${isSelfie ? 'Selfie' : 'Testo'})</span>
                <div class="text-right">
                    <span class="font-bold block ${isCorrect ? 'text-green-600' : 'text-red-500'}">${cp.points} pt</span>
                    <span class="text-xs text-gray-500 font-mono">${timeString}</span>
                </div>
            </div>
            
            <div class="mb-3 bg-gray-50 p-2 rounded text-sm text-gray-700 italic">"${cp.question}"</div>
            
            ${sub.photoUrl ? `<img src="${sub.photoUrl}" class="w-full h-48 object-cover rounded-md mb-3 border border-gray-200 cursor-pointer" onclick="window.open('${sub.photoUrl}', '_blank')">` : ''}
            
            ${!isSelfie ? `
                <div class="mb-2">
                    <p class="text-xs text-gray-500 uppercase font-bold">Risposta Data</p>
                    <p class="font-mono text-lg ${isCorrect ? 'text-green-700' : 'text-red-600'}">${sub.answer}</p>
                </div>
                <div class="mb-4">
                    <p class="text-xs text-gray-500 uppercase font-bold">Risposta Esatta</p>
                    <p class="font-mono text-sm text-gray-800">${cp.correctAnswer}</p>
                </div>
            ` : ''}

            <div class="mt-auto pt-4 border-t flex justify-end">
                ${isRejected 
                    ? `<button onclick="toggleSubStatus('${sub.id}', null)" class="text-green-600 font-bold text-sm hover:underline flex items-center"><i data-lucide="refresh-ccw" class="w-4 h-4 mr-1"></i> RIPRISTINA</button>`
                    : `<button onclick="toggleSubStatus('${sub.id}', 'rejected')" class="text-red-500 font-bold text-sm hover:underline flex items-center"><i data-lucide="ban" class="w-4 h-4 mr-1"></i> BOCCIA PROVA</button>`
                }
            </div>
        `;
        grid.appendChild(card);
    });
    lucide.createIcons();

    window.toggleSubStatus = async (subId, newStatus) => {
        try {
            const ref = doc(db, "submissions", subId);
            if(newStatus) await updateDoc(ref, { status: newStatus });
            else {
                const currentData = (await getDoc(ref)).data();
                const newData = { ...currentData };
                delete newData.status;
                await setDoc(ref, newData);
            }
        } catch(e) { console.error("Update failed", e); }
    };
}


// --- GESTIONE ADMIN CHECKPOINT ---
const typeRadios = document.querySelectorAll('input[name="cpType"]');
const textFields = document.getElementById('text-only-fields');
const lblQuestion = document.getElementById('lbl-question');

if(typeRadios.length > 0) {
    typeRadios.forEach(radio => {
        radio.addEventListener('change', (e) => {
            if (e.target.value === 'selfie') {
                textFields.classList.add('hidden');
                lblQuestion.textContent = "Istruzioni Selfie (Cosa fotografare?)";
                document.getElementById('cp-correctAnswer').removeAttribute('required');
            } else {
                textFields.classList.remove('hidden');
                lblQuestion.textContent = "Domanda / Indizio";
                document.getElementById('cp-correctAnswer').setAttribute('required', 'true');
            }
        });
    });
}

let adminCheckpointsData = [];

function renderAdminMapMarkers() {
    const smallContainer = document.getElementById('cpMapExistingMarkers');
    const largeContainer = document.getElementById('mapPickerExistingMarkers');
    if (!smallContainer || !largeContainer) return;
    
    smallContainer.innerHTML = '';
    largeContainer.innerHTML = '';
    
    const currentEditId = document.getElementById('editCheckpointId').value;
    
    adminCheckpointsData.forEach(cp => {
        if (cp.id === currentEditId || !cp.mapX || !cp.mapY) return;
        
        const createMarker = (size, isLarge) => {
            const m = document.createElement('div');
            m.className = 'absolute transform -translate-x-1/2 -translate-y-1/2 bg-gray-800 rounded-full border border-white shadow flex items-center justify-center text-white font-bold opacity-70';
            m.style.left = `${cp.mapX}%`;
            m.style.top = `${cp.mapY}%`;
            m.style.width = size;
            m.style.height = size;
            m.style.fontSize = isLarge ? '12px' : '9px';
            m.textContent = cp.number;
            return m;
        };
        
        smallContainer.appendChild(createMarker('18px', false));
        largeContainer.appendChild(createMarker('24px', true));
    });
}

function startEditCheckpoint(id, data) {
    document.getElementById('editCheckpointId').value = id;
    const form = document.getElementById('addCheckpointForm');
    
    const type = data.cpType || 'text';
    const radio = form.querySelector(`input[name="cpType"][value="${type}"]`);
    if(radio) { radio.checked = true; radio.dispatchEvent(new Event('change')); }

    form.number.value = data.number; 
    form.name.value = data.name || '';
    form.question.value = data.question;
    form.description.value = data.description || '';
    form.placeholder.value = data.placeholder || '';
    form.correctAnswer.value = data.correctAnswer || ''; 
    form.points.value = data.points;
    form.mapX.value = data.mapX || '';
    form.mapY.value = data.mapY || '';

    const pin = document.getElementById('cpMapPin');
    if (data.mapX && data.mapY) {
        document.getElementById('lbl-mapX').textContent = data.mapX.toFixed(2);
        document.getElementById('lbl-mapY').textContent = data.mapY.toFixed(2);
        pin.style.left = `${data.mapX}%`;
        pin.style.top = `${data.mapY}%`;
        pin.classList.remove('hidden');
    } else {
        document.getElementById('lbl-mapX').textContent = '-';
        document.getElementById('lbl-mapY').textContent = '-';
        pin.classList.add('hidden');
    }
    
    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.textContent = 'Salva Modifiche';
    submitBtn.classList.replace('btn-secondary', 'btn-primary');
    document.getElementById('cancelEditBtn').classList.remove('hidden');
    renderAdminMapMarkers();
}

function resetCheckpointForm() {
    const form = document.getElementById('addCheckpointForm');
    form.reset(); 
    document.getElementById('editCheckpointId').value = '';
    document.getElementById('cp-mapX').value = '';
    document.getElementById('cp-mapY').value = '';
    document.getElementById('lbl-mapX').textContent = '-';
    document.getElementById('lbl-mapY').textContent = '-';
    document.getElementById('cpMapPin').classList.add('hidden');

    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.textContent = 'Aggiungi Punto';
    submitBtn.classList.replace('btn-primary', 'btn-secondary');
    document.getElementById('cancelEditBtn').classList.add('hidden');
    const radioText = form.querySelector(`input[name="cpType"][value="text"]`);
    if(radioText) { radioText.checked = true; radioText.dispatchEvent(new Event('change')); }
    renderAdminMapMarkers();
}

document.getElementById('cancelEditBtn').addEventListener('click', resetCheckpointForm);

document.getElementById('addCheckpointForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const cpType = form.querySelector('input[name="cpType"]:checked').value;
    
    const data = {
        number: parseInt(form.number.value),
        name: form.name.value.trim(),
        question: form.question.value,
        description: form.description.value,
        points: parseInt(form.points.value),
        cpType: cpType
    };

    if (form.mapX.value && form.mapY.value) {
        data.mapX = parseFloat(form.mapX.value);
        data.mapY = parseFloat(form.mapY.value);
    } else {
        data.mapX = null; data.mapY = null;
    }

    if (cpType === 'text') {
        data.placeholder = form.placeholder.value;
        data.correctAnswer = form.correctAnswer.value;
    } else {
        data.placeholder = ""; data.correctAnswer = "";
    }

    const checkpointId = document.getElementById('editCheckpointId').value;
    const imageFile = form.image.files[0];
    
    try {
        let finalCheckpointId = checkpointId;
        if (!checkpointId) {
            const tempDoc = await addDoc(collection(db, `events/${currentEventId}/checkpoints`), data);
            finalCheckpointId = tempDoc.id;
        }
        if (imageFile) {
            const imageRef = ref(storage, `checkpoints/${currentEventId}/${finalCheckpointId}.jpg`);
            await uploadBytes(imageRef, imageFile);
            data.imageUrl = await getDownloadURL(imageRef);
        }
        await updateDoc(doc(db, `events/${currentEventId}/checkpoints`, finalCheckpointId), data);
        resetCheckpointForm();
    } catch(error) { showModal("Errore", "Salvataggio fallito: " + error.message); }
});

async function deleteCheckpoint(id) {
    showModal("Elimina Punto", "Sei sicuro di voler eliminare questo punto di controllo? La rimozione non cancellerà le risposte già inviate dalle squadre per questo punto.", true, async () => {
        try {
            await deleteDoc(doc(db, `events/${currentEventId}/checkpoints`, id));
            await deleteObject(ref(storage, `checkpoints/${currentEventId}/${id}.jpg`)).catch(()=>{});
        } catch (error) {
            showModal("Errore", error.message);
        }
    });
}

document.getElementById('manageCpBtn').addEventListener('click', async () => {
    if (organizerAdminUnsub) organizerAdminUnsub();
    showView('organizerAdminView');
    
    const eventDoc = await getDoc(doc(db, "events", currentEventId));
    const eventData = eventDoc.data();
    const mapUrl = eventData.mapUrl || null;
    
    const statusText = document.getElementById('eventMapStatus');
    const selectorContainer = document.getElementById('cpMapSelectorContainer');
    const mapImage = document.getElementById('cpMapImage');

    if (mapUrl) {
        statusText.innerHTML = `<a href="${mapUrl}" target="_blank" class="text-blue-600 underline">Mappa attiva</a>`;
        mapImage.src = mapUrl;
        selectorContainer.classList.remove('hidden');
    } else {
        statusText.textContent = "Nessuna mappa associata.";
        selectorContainer.classList.add('hidden');
    }

    const checkpointsList = document.getElementById('checkpointsList');
    const checkpointsQuery = query(collection(db, `events/${currentEventId}/checkpoints`), orderBy("number"));
    organizerAdminUnsub = onSnapshot(checkpointsQuery, (snapshot) => {
        checkpointsList.innerHTML = snapshot.empty ? '<p>Nessun punto di controllo creato.</p>' : '';
        adminCheckpointsData = [];
        snapshot.docs.forEach(doc => {
            const cp = doc.data(); 
            const id = doc.id;
            adminCheckpointsData.push({ id, ...cp });
            const item = document.createElement('div');
            item.className = 'p-3 bg-gray-100 rounded-md flex justify-between items-center';
            const locIcon = (cp.mapX && cp.mapY) ? '<i data-lucide="map-pin" class="w-4 h-4 text-green-600 inline ml-2"></i>' : '';
            const cpName = cp.name ? ` - ${cp.name}` : '';
            item.innerHTML = `<div><p class="font-bold">#${cp.number}${cpName} - ${cp.cpType === 'selfie' ? '📷 Selfie' : '📝 Domanda'} (${cp.points} pt.) ${locIcon}</p><p class="text-sm text-gray-600">${cp.question}</p></div><div class="flex space-x-2"><button title="Modifica" class="edit-btn p-2 text-blue-600 hover:text-blue-800"><i data-lucide="pencil" class="pointer-events-none"></i></button><button title="Elimina" class="delete-btn p-2 text-red-600 hover:text-red-800"><i data-lucide="trash-2" class="pointer-events-none"></i></button></div>`;
            item.querySelector('.edit-btn').addEventListener('click', () => startEditCheckpoint(id, cp));
            item.querySelector('.delete-btn').addEventListener('click', () => deleteCheckpoint(id));
            checkpointsList.appendChild(item);
        });
        renderAdminMapMarkers();
        lucide.createIcons();
    });
});

document.getElementById('eventMapUpload').addEventListener('change', (e) => {
    document.getElementById('uploadEventMapBtn').classList.toggle('hidden', !e.target.files[0]);
});

document.getElementById('uploadEventMapBtn').addEventListener('click', async () => {
    const file = document.getElementById('eventMapUpload').files[0];
    if (!file) return;
    try {
        document.getElementById('uploadEventMapBtn').textContent = "Caricamento...";
        const mapRef = ref(storage, `maps/${currentEventId}.jpg`);
        await uploadBytes(mapRef, file);
        const url = await getDownloadURL(mapRef);
        await updateDoc(doc(db, "events", currentEventId), { mapUrl: url });
        document.getElementById('eventMapUpload').value = "";
        document.getElementById('uploadEventMapBtn').classList.add('hidden');
        document.getElementById('uploadEventMapBtn').textContent = "Carica";
        document.getElementById('manageCpBtn').click(); 
    } catch (e) { showModal("Errore", e.message); }
});

function updateMapCoordinates(e) {
    const img = e.currentTarget.querySelector('img');
    if (!img) return;
    const rect = img.getBoundingClientRect();
    
    if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) return;

    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    
    document.getElementById('cp-mapX').value = x;
    document.getElementById('cp-mapY').value = y;
    document.getElementById('lbl-mapX').textContent = x.toFixed(2);
    document.getElementById('lbl-mapY').textContent = y.toFixed(2);
    
    const pinSmall = document.getElementById('cpMapPin');
    pinSmall.style.left = `${x}%`;
    pinSmall.style.top = `${y}%`;
    pinSmall.classList.remove('hidden');

    const pinLarge = document.getElementById('mapPickerPin');
    pinLarge.style.left = `${x}%`;
    pinLarge.style.top = `${y}%`;
    pinLarge.classList.remove('hidden');
}

document.getElementById('cpMapArea').addEventListener('click', updateMapCoordinates);
document.getElementById('mapPickerArea').addEventListener('click', updateMapCoordinates);

document.getElementById('expandMapBtn').addEventListener('click', () => {
    const modal = document.getElementById('mapPickerModal');
    document.getElementById('mapPickerImage').src = document.getElementById('cpMapImage').src;
    
    const currentX = document.getElementById('cp-mapX').value;
    const currentY = document.getElementById('cp-mapY').value;
    const pinLarge = document.getElementById('mapPickerPin');
    
    if (currentX && currentY) {
        pinLarge.style.left = `${currentX}%`;
        pinLarge.style.top = `${currentY}%`;
        pinLarge.classList.remove('hidden');
    } else {
        pinLarge.classList.add('hidden');
    }
    
    modal.classList.remove('hidden');
    lucide.createIcons();
});

document.getElementById('closeMapPickerBtn').addEventListener('click', () => {
    document.getElementById('mapPickerModal').classList.add('hidden');
});

// --- GESTIONE PARTECIPANTE ---

async function openCheckpoint(checkpoint, teamId, isCompleted, submission, isReadOnly = false) {
    showView('checkpointView');
    
    let imageUrlHtml = checkpoint.imageUrl ? `<div class="bg-gray-200 rounded-lg mb-4"><img src="${checkpoint.imageUrl}" alt="Immagine del punto" class="w-full h-48 object-contain rounded-lg"></div>` : '';

    const isSelfie = checkpoint.cpType === 'selfie';
    const typeLabel = isSelfie ? '<span class="bg-orange-100 text-orange-800 px-2 py-1 rounded text-xs font-bold uppercase ml-2">Selfie</span>' : '<span class="bg-blue-100 text-blue-800 px-2 py-1 rounded text-xs font-bold uppercase ml-2">Domanda</span>';

    // Riquadro risposta di esempio
    let exampleHtml = (!isSelfie && checkpoint.placeholder) ? `
        <div class="mt-4 bg-blue-50 border-l-4 border-blue-500 p-3 rounded-r shadow-sm">
            <p class="text-xs font-bold text-blue-800 uppercase mb-1">Risposta di esempio</p>
            <p class="font-mono text-gray-700">${checkpoint.placeholder}</p>
        </div>
    ` : '';

    const titleText = checkpoint.name ? `${checkpoint.name} #${checkpoint.number}` : `Punto #${checkpoint.number}`;
    document.getElementById('checkpointDetail').innerHTML = `
        ${imageUrlHtml}
        <h2 class="text-2xl font-bold mb-2 flex items-center">${titleText} ${typeLabel}</h2>
        <p class="text-lg bg-gray-100 p-4 rounded-md font-medium text-gray-800 shadow-inner">${checkpoint.question}</p>
        ${exampleHtml}
    `;

    // Riquadro "Lo sapevi che..."
    const descBox = document.getElementById('checkpointDescriptionBox');
    if (checkpoint.description) {
        descBox.innerHTML = `
            <h3 class="text-xl font-bold text-brand-orange mb-3 flex items-center"><i data-lucide="info" class="w-6 h-6 mr-2"></i>Lo sapevi che...</h3>
            <div class="bg-orange-50 p-4 rounded-lg border border-orange-200 text-gray-700 leading-relaxed shadow-sm">
                ${checkpoint.description.replace(/\n/g, '<br>')}
            </div>
        `;
        descBox.classList.remove('hidden');
    } else {
        descBox.classList.add('hidden');
    }

    document.getElementById('checkpointIdInput').value = checkpoint.id;
    document.getElementById('teamIdInput').value = teamId;
    document.getElementById('checkpointTypeInput').value = checkpoint.cpType || 'text';

    const textContainer = document.getElementById('text-input-container');
    const photoContainer = document.getElementById('photo-input-container');
    const answerInput = document.getElementById('answer');
    const photoInput = document.getElementById('photo');

    if (isSelfie) {
        textContainer.classList.add('hidden');
        photoContainer.classList.remove('hidden');
        answerInput.required = false;
        photoInput.required = true;
    } else {
        textContainer.classList.remove('hidden');
        photoContainer.classList.add('hidden');
        answerInput.required = true;
        photoInput.required = false;
        answerInput.placeholder = "Scrivi qui la tua risposta...";
    }

    const submitButton = document.getElementById('submissionForm').querySelector('button[type="submit"]');
    const deleteButton = document.getElementById('deleteSubmissionBtn');

    if (isCompleted) {
        if(isSelfie) {
             document.getElementById('photo-preview-container').innerHTML = `<p class="mt-4 font-bold text-green-600">Selfie inviato:</p><img src="${submission.photoUrl}" class="mt-2 rounded-md max-w-sm w-full border-4 border-green-100" />`;
             photoInput.classList.add('hidden');
        } else {
             answerInput.value = submission.answer;
             answerInput.disabled = true;
        }
        submitButton.classList.add('hidden');
        deleteButton.classList.toggle('hidden', isReadOnly);
        deleteButton.onclick = () => deleteSubmission(submission.id, submission.photoUrl);
        
        if(submission.status === 'rejected') {
            document.getElementById('checkpointDetail').insertAdjacentHTML('beforeend', `<div class="mt-4 bg-red-100 text-red-800 p-3 rounded font-bold border border-red-300">⚠️ QUESTA RISPOSTA È STATA ANNULLATA DAI GIUDICI.</div>`);
        }

    } else {
        answerInput.value = ''; 
        answerInput.disabled = isReadOnly; 
        photoInput.value = '';
        if(isSelfie) {
            photoInput.classList.remove('hidden');
             document.getElementById('photo-preview-container').innerHTML = '';
        }
        submitButton.classList.toggle('hidden', isReadOnly);
        deleteButton.classList.add('hidden');
        submitButton.disabled = false; 
        submitButton.textContent = 'Invia Risposta';
    }

    lucide.createIcons();
}

document.getElementById('submissionForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitButton = e.target.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    submitButton.innerHTML = `<i data-lucide="loader-2" class="animate-spin mr-2"></i> Invio...`;
    
    const teamId = document.getElementById('teamIdInput').value;
    const checkpointId = document.getElementById('checkpointIdInput').value;
    const cpType = document.getElementById('checkpointTypeInput').value;
    
    let answer = cpType === 'selfie' ? "(SELFIE)" : document.getElementById('answer').value;
    const photoFile = document.getElementById('photo').files[0];

    if (cpType === 'selfie' && !photoFile) { 
        showModal("Errore", "Il Selfie è obbligatorio!"); 
        submitButton.disabled = false; return; 
    }

    try {
        let photoUrl = null;
        if (photoFile) {
             const compressedFile = await compressImage(photoFile, 1024, 0.7);
             const photoRef = ref(storage, `submissions/${currentEventId}/${teamId}_${checkpointId}_${Date.now()}.jpg`);
             await uploadBytes(photoRef, compressedFile);
             photoUrl = await getDownloadURL(photoRef);
        }

        const submissionTimestamp = new Date();
        const data = { eventId: currentEventId, teamId, checkpointId, answer, timestamp: submissionTimestamp };
        if(photoUrl) data.photoUrl = photoUrl;

        const submissionId = teamId + "_" + checkpointId;
        await setDoc(doc(db, "submissions", submissionId), data);
        await addDoc(collection(db, `events/${currentEventId}/activity`), {
            type: 'submit', teamId, checkpointId, answer, photoUrl, timestamp: submissionTimestamp
        });
        
        showModal("Successo", "Risposta inviata!");
        showView('participantView');
    } catch (error) { 
        submitButton.disabled = false; 
        submitButton.innerHTML = `INVIA RISPOSTA`;
        if (error.code === 'storage/retry-limit-exceeded' || !navigator.onLine) {
            showModal("Connessione Assente", "Spostati in un'area con segnale e clicca nuovamente su INVIA. I tuoi dati non sono stati cancellati.");
        } else {
            showModal("Errore", error.message); 
        }
    }
});

// Helper e Utility
async function compressImage(file, maxWidth, quality) {
    const options = {
        maxSizeMB: 1,
        maxWidthOrHeight: maxWidth,
        useWebWorker: true
    };
    try {
        return await imageCompression(file, options);
    } catch (error) {
        console.error("Errore di compressione:", error);
        throw error;
    }
}

// Altri listener standard
document.getElementById('startEventBtn').addEventListener('click', () => {
    showModal("Conferma Avvio", "Sicuro?", true, async () => {
        if(!currentEventId) return;
        await updateDoc(doc(db, "events", currentEventId), { status: 'active', startTime: new Date() });
        showModal("Successo", "Evento avviato!");
    });
});
document.getElementById('finishEventBtn').addEventListener('click', () => {
    showModal("Conferma Termine", "Sicuro?", true, async () => {
        if(!currentEventId) return;
        await updateDoc(doc(db, "events", currentEventId), { status: 'finished' });
        showModal("Successo", "Evento terminato!");
    });
});
document.getElementById('activityLogBtn').addEventListener('click', () => initActivityLogView());
document.getElementById('backToDashboardFromLog').addEventListener('click', () => {
    if (activityLogUnsub) { activityLogUnsub(); activityLogUnsub = null; }
    showView('organizerDashboardView');
    if (dashboardData) updateDashboardDOM(dashboardData.teams, dashboardData.checkpoints, dashboardData.submissions);
});
async function initActivityLogView(isLoadMore = false) {
    if (!dashboardData) return;
    const logContainer = document.getElementById('activityLogContainer');
    
    if (!isLoadMore) {
        if (activityLogUnsub) activityLogUnsub();
        logContainer.innerHTML = '<i data-lucide="loader-2" class="w-12 h-12 animate-spin text-green-700 mx-auto"></i>';
        lastActivityDoc = null;
        showView('activityLogView');
    }

    let q;
    if (lastActivityDoc) {
        q = query(collection(db, `events/${currentEventId}/activity`), orderBy("timestamp", "desc"), startAfter(lastActivityDoc), limit(20));
    } else {
        q = query(collection(db, `events/${currentEventId}/activity`), orderBy("timestamp", "desc"), limit(20));
    }

    const snapshot = await getDocs(q);
    if (!isLoadMore) logContainer.innerHTML = '';
    
    if (snapshot.empty && !isLoadMore) {
        logContainer.innerHTML = '<p class="text-gray-500 text-center py-4">Nessuna attività registrata.</p>';
        return;
    }

    lastActivityDoc = snapshot.docs[snapshot.docs.length - 1];

    snapshot.forEach(docSnap => {
        const log = docSnap.data();
        const time = log.timestamp ? log.timestamp.toDate().toLocaleTimeString('it-IT') : '-';
        const team = dashboardData.teams.find(t => t.id === log.teamId);
        const teamName = team ? team.name : log.teamId;
        const cp = dashboardData.checkpoints.find(c => c.id === log.checkpointId);
        
        let cpNumber = '?';
        let iconHtml = '<i data-lucide="circle-dashed" class="w-6 h-6 text-gray-400"></i>';
        let detailHtml = `Risposta: ${log.answer || '(Nessuna)'}`;

        if (cp) {
            cpNumber = cp.number;
            if (cp.cpType === 'selfie') {
                iconHtml = '<i data-lucide="camera" class="w-6 h-6 text-blue-600"></i>';
                detailHtml = `Foto inviata`;
            } else {
                const givenAnswer = log.answer ? log.answer.toLowerCase().trim() : '';
                const correctAnswer = cp.correctAnswer ? cp.correctAnswer.toLowerCase().trim() : '';
                const isCorrect = givenAnswer === correctAnswer;
                
                iconHtml = isCorrect 
                    ? '<i data-lucide="check-circle-2" class="w-6 h-6 text-green-600"></i>' 
                    : '<i data-lucide="x-circle" class="w-6 h-6 text-red-500"></i>';
                
                detailHtml = `Data: <span class="font-mono text-gray-800">${log.answer}</span> <br><span class="text-xs text-gray-500">Esatta: ${cp.correctAnswer}</span>`;
            }
        }

        const div = document.createElement('div');
        div.className = "p-3 border-b bg-white rounded-lg shadow-sm mb-3 border border-gray-100 flex items-center justify-between";
        div.innerHTML = `
            <div class="flex items-center gap-4">
                <div class="flex-shrink-0 bg-gray-50 p-2 rounded-full border border-gray-200">${iconHtml}</div>
                <div>
                    <p class="font-bold text-gray-800">${time} - ${teamName}</p>
                    <p class="text-sm text-gray-600">Punto #${cpNumber} | ${detailHtml}</p>
                </div>
            </div>
        `;
        logContainer.appendChild(div);
    });
    
    // Gestione visibilità tasto "Carica Altri"
    const loadMoreBtn = document.getElementById('loadMoreActivityBtn');
    if (snapshot.docs.length < 20) loadMoreBtn.classList.add('hidden');
    else loadMoreBtn.classList.remove('hidden');

    lucide.createIcons();
}
document.getElementById('manageTeamsBtn').addEventListener('click', () => {
    if (organizerTeamsUnsub) organizerTeamsUnsub();
    showView('organizerTeamsView');
    const teamsList = document.getElementById('teamsList');
    organizerTeamsUnsub = onSnapshot(query(collection(db, `events/${currentEventId}/teams`), orderBy('name')), (snapshot) => {
        teamsList.innerHTML = snapshot.empty ? '<p>Nessuna squadra.</p>' : '';
        snapshot.forEach(doc => {
            const data = doc.data();
            teamsList.innerHTML += `<div class="p-4 bg-gray-50 rounded mb-2"><p class="font-bold">${data.name}</p><p class="text-xs">${data.email || ''}</p></div>`;
        });
    });
});
document.getElementById('backToDashboardFromTeams').addEventListener('click', () => {
    showView('organizerDashboardView');
    if (dashboardData) updateDashboardDOM(dashboardData.teams, dashboardData.checkpoints, dashboardData.submissions);
});
document.getElementById('backToDashboardBtn').addEventListener('click', () => {
    if (organizerAdminUnsub) organizerAdminUnsub();
    showView('organizerDashboardView');
    if (dashboardData) updateDashboardDOM(dashboardData.teams, dashboardData.checkpoints, dashboardData.submissions);
});

document.getElementById('refreshDashboardBtn').addEventListener('click', async () => {
    const icon = document.querySelector('#refreshDashboardBtn i');
    icon.classList.add('animate-spin');
    if (dashboardData) executeDashboardDOM(dashboardData.teams, dashboardData.checkpoints, dashboardData.submissions);
    setTimeout(() => icon.classList.remove('animate-spin'), 500);
});
// Toggle Password
document.querySelectorAll('.toggle-password').forEach(btn => {
    btn.addEventListener('click', () => {
        const input = document.getElementById(btn.getAttribute('data-target'));
        input.type = input.type === 'password' ? 'text' : 'password';
        lucide.createIcons();
    });
});
document.getElementById('joinEventForm').addEventListener('submit', async (e) => { 
    e.preventDefault();
    const btn = e.target.querySelector('button'); btn.disabled = true;
    try {
        const joinCode = document.getElementById('joinCode').value.toUpperCase();
        const teamName = document.getElementById('teamName').value.trim();
        // Recupera la categoria scelta dal radio button
        const category = e.target.querySelector('input[name="joinCategory"]:checked').value;
        const q = query(collection(db, "events"), where("joinCode", "==", joinCode));
        const snap = await getDocs(q);
        if(snap.empty) throw new Error("Codice errato.");
        currentEventId = snap.docs[0].id;
        const eventData = snap.docs[0].data();
        if(eventData.status === 'finished') throw new Error("Gara finita.");
        const teamRef = doc(db, `events/${currentEventId}/teams`, currentUserId);
        await setDoc(teamRef, { 
            name: teamName, 
            uid: currentUserId, 
            email: auth.currentUser.email,
            category: category
        });
        await updateDoc(doc(db, "users", currentUserId), { currentEventId: currentEventId });
        localStorage.setItem('currentEventId-' + currentUserId, currentEventId);
        initParticipantLobbyView();
    } catch (e) { showModal("Errore", e.message); btn.disabled = false; }
});
function initParticipantLobbyView() { 
    if (participantListenerUnsub) participantListenerUnsub();
    participantListenerUnsub = onSnapshot(doc(db, "events", currentEventId), (doc) => {
        if(doc.exists()){
            const st = doc.data().status;
            document.getElementById('lobbyEventName').textContent = doc.data().name;
            if(st === 'active') initParticipantView(currentUserId);
            else if(st === 'finished') initParticipantView(currentUserId, true);
            else showView('participantLobbyView');
        }
    });
}
async function initParticipantView(teamId, isReadOnly=false) {
    if (participantListenerUnsub) participantListenerUnsub();
    if (participantSubsUnsub) participantSubsUnsub();
    
    participantListenerUnsub = onSnapshot(doc(db, "events", currentEventId), (docSnap) => {
        if (docSnap.exists()) {
            const isFinished = docSnap.data().status === 'finished';
            const banner = document.getElementById('game-finished-banner');
            if (banner) banner.classList.toggle('hidden', !isFinished);
            const submitBtn = document.querySelector('#submissionForm button[type="submit"]');
            if (submitBtn) submitBtn.classList.toggle('hidden', isFinished);
        }
    });
    try {
        const tDoc = await getDoc(doc(db, `events/${currentEventId}/teams`, teamId));
        if(tDoc.exists()) document.getElementById('participant-team-name-display').textContent = `Squadra: ${tDoc.data().name}`;
        document.getElementById('game-finished-banner').classList.toggle('hidden', !isReadOnly);
        
        const subQ = query(collection(db, "submissions"), where("teamId", "==", teamId), where("eventId", "==", currentEventId));
        const cpSnap = await getDocs(query(collection(db, `events/${currentEventId}/checkpoints`), orderBy("number")));
        const checkpoints = cpSnap.docs.map(d=>({id:d.id, ...d.data()}));
        
        let currentSubs = {};
        const grid = document.getElementById('checkpointsGrid');
        grid.innerHTML = '';

        checkpoints.forEach(cp => {
            const card = document.createElement('div');
            card.id = `cp-card-${cp.id}`;
            card.className = 'p-3 rounded-lg shadow-md flex flex-col items-center justify-center h-28 border-2 transition-all cursor-pointer transform hover:scale-105 bg-white text-gray-800 border-gray-100 hover:border-brand-orange';
            card.innerHTML = `
                <div id="cp-icon-${cp.id}">${cp.cpType === 'selfie' ? '<i data-lucide="camera" class="w-6 h-6 mb-1 text-brand-orange"></i>' : '<div class="h-6 mb-1"></div>'}</div>
                <span class="text-3xl font-black">${cp.number}</span>
                <div id="cp-check-${cp.id}"></div>
            `;
            card.onclick = () => openCheckpoint(cp, teamId, !!currentSubs[cp.id], currentSubs[cp.id], isReadOnly);
            grid.appendChild(card);
        });
        lucide.createIcons({ root: grid });
        showView('participantView');

        participantSubsUnsub = onSnapshot(subQ, (snap) => {
            console.log("Esecuzione listener sottomissioni"); // Inserisci questa riga per il test
            currentSubs = {};
            snap.forEach(d => currentSubs[d.data().checkpointId] = {id:d.id, ...d.data()});

            checkpoints.forEach(cp => {
                const isDone = !!currentSubs[cp.id];
                const card = document.getElementById(`cp-card-${cp.id}`);
                const iconContainer = document.getElementById(`cp-icon-${cp.id}`);
                const checkContainer = document.getElementById(`cp-check-${cp.id}`);

                if (!card) return;

                if (isDone) {
                    card.className = 'p-3 rounded-lg shadow-md flex flex-col items-center justify-center h-28 border-2 transition-all cursor-pointer transform hover:scale-105 bg-green-500 text-white border-green-600';
                    iconContainer.innerHTML = cp.cpType === 'selfie' ? '<i data-lucide="camera" class="w-6 h-6 mb-1 text-white"></i>' : '<div class="h-6 mb-1"></div>';
                    checkContainer.innerHTML = '<i data-lucide="check" class="mt-1 w-5 h-5 font-bold"></i>';
                } else {
                    card.className = 'p-3 rounded-lg shadow-md flex flex-col items-center justify-center h-28 border-2 transition-all cursor-pointer transform hover:scale-105 bg-white text-gray-800 border-gray-100 hover:border-brand-orange';
                    iconContainer.innerHTML = cp.cpType === 'selfie' ? '<i data-lucide="camera" class="w-6 h-6 mb-1 text-brand-orange"></i>' : '<div class="h-6 mb-1"></div>';
                    checkContainer.innerHTML = '';
                }
            });
            lucide.createIcons({ root: grid });
        });
    } catch(e) { console.error(e); }
}
async function deleteSubmission(subId, photoUrl) {
    showModal("Cancella", "Sicuro?", true, async () => {
        await deleteDoc(doc(db, "submissions", subId));
        if (photoUrl) {
            await deleteObject(ref(storage, photoUrl)).catch(()=>{});
        }
        showModal("Fatto", "Cancellato.");
        showView('participantView');
    });
}
document.getElementById('backToGrid').addEventListener('click', () => showView('participantView'));
document.getElementById('logout-participant').addEventListener('click', () => { signOut(auth); });
document.getElementById('logout-lobby').addEventListener('click', () => signOut(auth));
document.getElementById('logout-join').addEventListener('click', () => signOut(auth));
document.getElementById('closePhotoModalBtn').addEventListener('click', () => document.getElementById('photoModal').classList.add('hidden'));

function showSubmissionDetail(submission, checkpoint, isCorrect, team) {
     document.getElementById('organizerDetailContent').innerHTML = `<p><strong>Squadra:</strong> ${team.name}</p><p><strong>R:</strong> ${submission.answer}</p><p><strong>Ok:</strong> ${isCorrect}</p>${submission.photoUrl ? `<img src="${submission.photoUrl}" class="w-full rounded">` : ''}`;
     showView('organizerDetailView');
}
document.getElementById('backToOrganizer').addEventListener('click', () => {
    showView('organizerDashboardView');
    if (dashboardData) updateDashboardDOM(dashboardData.teams, dashboardData.checkpoints, dashboardData.submissions);
});

// Init
showView('loadingView');
lucide.createIcons();

document.getElementById('backToDashboardFromMap').addEventListener('click', () => {
    showView('organizerDashboardView');
    if (dashboardData) updateDashboardDOM(dashboardData.teams, dashboardData.checkpoints, dashboardData.submissions);
});

document.getElementById('liveMapBtn').addEventListener('click', async () => {
    showView('organizerMapView');
    if (!dashboardData) return;
    
    const eventDoc = await getDoc(doc(db, "events", currentEventId));
    const mapUrl = eventDoc.data().mapUrl;
    
    const container = document.getElementById('liveMapContainer');
    const sidebar = document.getElementById('liveMapSidebar');
    const noData = document.getElementById('liveMapNoData');
    
    if (!mapUrl) {
        container.classList.add('hidden');
        sidebar.classList.add('hidden');
        noData.classList.remove('hidden');
        return;
    }
    
    container.classList.remove('hidden');
    sidebar.classList.remove('hidden');
    noData.classList.add('hidden');
    document.getElementById('liveMapBase').src = mapUrl;
    
    initMapTeamSelector();
    renderLiveMap();
});

function initMapTeamSelector(preserveSelection = false) {
    const selector = document.getElementById('mapTeamSelector');
    selector.innerHTML = '';
    if (!dashboardData) return;

    const { teams, checkpoints, submissions } = dashboardData;

    const subsMap = {};
    submissions.forEach(s => {
        subsMap[`${s.teamId}_${s.checkpointId}`] = s;
    });

    const teamStats = teams.map(team => {
        const stats = calculateScore(team.id, checkpoints, submissions, subsMap);
        return { ...team, score: stats.score };
    }).sort((a,b) => b.score - a.score);

    const colors = ['#ef4444', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];

    teamStats.forEach((t, i) => {
        const color = colors[i % colors.length];
        const div = document.createElement('div');
        div.className = "flex items-center p-2 hover:bg-white rounded border border-transparent hover:border-gray-200 transition-colors cursor-pointer bg-white shadow-sm";
        div.innerHTML = `
            <input type="checkbox" id="map-team-${t.id}" value="${t.id}" data-color="${color}" class="map-team-cb w-4 h-4 mr-3 cursor-pointer text-teal-600 focus:ring-teal-500 rounded" ${(!preserveSelection && i < 3) ? 'checked' : ''}>
            <label for="map-team-${t.id}" class="flex-grow cursor-pointer font-bold text-sm text-gray-700 truncate" title="${t.name}">#${i+1} ${t.name} <br><span class="text-xs text-gray-500 font-normal">${t.score} pt</span></label>
            <div class="w-4 h-4 rounded-full border shadow-sm" style="background-color: ${color}"></div>
        `;
        selector.appendChild(div);
    });

    document.querySelectorAll('.map-team-cb').forEach(cb => {
        cb.addEventListener('change', renderMapPaths);
    });
}

function renderLiveMap() {
    if (!dashboardData || document.getElementById('organizerMapView').classList.contains('hidden')) return;
    
    const staticContainer = document.getElementById('liveMapStaticMarkers');
    staticContainer.innerHTML = '';
    
    const { checkpoints } = dashboardData;

    checkpoints.forEach(cp => {
        if (!cp.mapX || !cp.mapY) return;
        
        const marker = document.createElement('div');
        marker.className = 'absolute transform -translate-x-1/2 -translate-y-1/2 rounded-full border border-white shadow flex items-center justify-center font-bold text-white bg-gray-800 opacity-80';
        marker.style.left = `${cp.mapX}%`;
        marker.style.top = `${cp.mapY}%`;
        marker.style.width = '18px';
        marker.style.height = '18px';
        marker.style.zIndex = '1';
        marker.style.fontSize = '11px';
        marker.textContent = cp.number;
        
        staticContainer.appendChild(marker);
    });

    renderMapPaths();
}

function renderMapPaths() {
    if (!dashboardData) return;
    const pathsContainer = document.getElementById('liveMapPaths');
    pathsContainer.innerHTML = '';

    const selectedCheckboxes = Array.from(document.querySelectorAll('.map-team-cb:checked'));
    if (selectedCheckboxes.length === 0) return;

    const { checkpoints, submissions } = dashboardData;

    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.style.position = "absolute";
    svg.style.top = "0";
    svg.style.left = "0";
    svg.style.width = "100%";
    svg.style.height = "100%";
    svg.style.pointerEvents = "none";
    svg.style.overflow = "visible";
    
    const htmlOverlay = document.createElement('div');
    htmlOverlay.className = "absolute top-0 left-0 w-full h-full pointer-events-none";

    selectedCheckboxes.forEach(cb => {
        const teamId = cb.value;
        const color = cb.getAttribute('data-color');
        const team = dashboardData.teams.find(t => t.id === teamId);
        if(!team) return;
        
        const validSubs = [];
        checkpoints.forEach(cp => {
            if (!cp.mapX || !cp.mapY) return;
            const sub = submissions.find(s => s.teamId === teamId && s.checkpointId === cp.id && s.status !== 'rejected');
            if (sub) {
                const subTime = sub.timestamp ? (typeof sub.timestamp.toMillis === 'function' ? sub.timestamp.toMillis() : sub.timestamp.toDate().getTime()) : 0;
                validSubs.push({ cp, time: subTime });
            }
        });

        validSubs.sort((a, b) => a.time - b.time);

        if (validSubs.length > 0) {
            for(let i = 0; i < validSubs.length - 1; i++) {
                const start = validSubs[i].cp;
                const end = validSubs[i+1].cp;
                const line = document.createElementNS(svgNS, "line");
                line.setAttribute("x1", `${start.mapX}%`);
                line.setAttribute("y1", `${start.mapY}%`);
                line.setAttribute("x2", `${end.mapX}%`);
                line.setAttribute("y2", `${end.mapY}%`);
                line.setAttribute("stroke", color);
                line.setAttribute("stroke-width", "4");
                line.setAttribute("stroke-dasharray", "12,4");
                line.setAttribute("opacity", "1");
                svg.appendChild(line);
            }

            const last = validSubs[validSubs.length - 1].cp;
            const labelDiv = document.createElement('div');
            labelDiv.className = 'absolute transform -translate-x-1/2 -translate-y-full pb-3 z-30 transition-all';
            labelDiv.style.left = `${last.mapX}%`;
            labelDiv.style.top = `${last.mapY}%`;
            labelDiv.innerHTML = `<div style="background-color:${color}" class="text-white text-xs font-bold px-2 py-1 rounded shadow-lg border-2 border-white whitespace-nowrap">${team.name}</div>
            <div class="absolute bottom-1 left-1/2 transform -translate-x-1/2 w-4 h-4 rounded-full border-2 border-white shadow-md" style="background-color:${color}"></div>`;
            htmlOverlay.appendChild(labelDiv);
        }
    });

    pathsContainer.appendChild(svg);
    pathsContainer.appendChild(htmlOverlay);
}

document.getElementById('syncMapBtn').addEventListener('click', () => {
    const icon = document.querySelector('#syncMapBtn i');
    icon.classList.add('animate-spin');
    
    if (dashboardData) {
        const checkedTeams = Array.from(document.querySelectorAll('.map-team-cb:checked')).map(cb => cb.value);
        initMapTeamSelector(true);
        document.querySelectorAll('.map-team-cb').forEach(cb => {
            cb.checked = checkedTeams.includes(cb.value);
        });
        renderLiveMap();
    }
    setTimeout(() => icon.classList.remove('animate-spin'), 500);
});

document.getElementById('toggleFullscreenBtn').addEventListener('click', () => {
    const container = document.getElementById('liveMapContainer');
    if (!document.fullscreenElement) {
        if (container.requestFullscreen) {
            container.requestFullscreen().catch(err => console.error(err));
        } else if (container.webkitRequestFullscreen) {
            container.webkitRequestFullscreen();
        }
    } else {
        if (document.exitFullscreen) {
            document.exitFullscreen();
        } else if (document.webkitExitFullscreen) {
            document.webkitExitFullscreen();
        }
    }
});

document.addEventListener('fullscreenchange', () => {
    const btn = document.getElementById('toggleFullscreenBtn');
    if (document.fullscreenElement) {
        btn.innerHTML = '<i data-lucide="minimize" class="w-5 h-5 pointer-events-none"></i>';
    } else {
        btn.innerHTML = '<i data-lucide="maximize" class="w-5 h-5 pointer-events-none"></i>';
    }
    lucide.createIcons();
});

document.addEventListener('webkitfullscreenchange', () => {
    const btn = document.getElementById('toggleFullscreenBtn');
    if (document.webkitFullscreenElement) {
        btn.innerHTML = '<i data-lucide="minimize" class="w-5 h-5 pointer-events-none"></i>';
    } else {
        btn.innerHTML = '<i data-lucide="maximize" class="w-5 h-5 pointer-events-none"></i>';
    }
    lucide.createIcons();
});

document.getElementById('loadMoreActivityBtn').addEventListener('click', () => initActivityLogView(true));

document.getElementById('refreshActivityLogBtn').addEventListener('click', () => {
    const icon = document.querySelector('#refreshActivityLogBtn i');
    icon.classList.add('animate-spin');
    initActivityLogView(false).then(() => icon.classList.remove('animate-spin'));
});