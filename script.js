import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, doc, getDoc, setDoc, addDoc, onSnapshot, collection, query, where, getDocs, orderBy, updateDoc, deleteDoc, writeBatch } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
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
const views = ['loadingView', 'loginView', 'organizerHomeView', 'joinEventView', 'participantLobbyView', 'participantView', 'checkpointView', 'organizerDashboardView', 'organizerDetailView', 'organizerAdminView', 'organizerTeamsView', 'activityLogView', 'organizerJudgeListView', 'organizerJudgeDetailView'];

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
let activityLogUnsub = null;
let unsubscribeDashboard = null;
let organizerHomeUnsub = null;
let organizerTeamsUnsub = null;
let organizerAdminUnsub = null;
let judgeListUnsub = null;
let dashboardData = null;
let currentJudgeTeamId = null;

onAuthStateChanged(auth, async user => {
    if (participantListenerUnsub) { participantListenerUnsub(); participantListenerUnsub = null; }
    if (activityLogUnsub) { activityLogUnsub(); activityLogUnsub = null; }
    if (unsubscribeDashboard) { unsubscribeDashboard(); unsubscribeDashboard = null; }
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
                const savedEventId = localStorage.getItem('currentEventId-' + user.uid);
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
    if(unsubscribeDashboard) { unsubscribeDashboard(); unsubscribeDashboard = null; }
    try {
        const eventRef = doc(db, "events", currentEventId);
        const eventDoc = await getDoc(eventRef);
        
        if (eventDoc.exists()) {
             const eventData = eventDoc.data();
             
             // Letture statiche estratte dal listener
             const teamsSnapshot = await getDocs(collection(db, `events/${currentEventId}/teams`));
             const checkpointsSnapshot = await getDocs(query(collection(db, `events/${currentEventId}/checkpoints`), orderBy("number")));
             
             dashboardData = {
                checkpoints: checkpointsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })),
                teams: teamsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })),
                submissions: []
            };
            
            // Render iniziale dell'infrastruttura tabellare
            renderOrganizerUI(eventData, dashboardData.teams, dashboardData.checkpoints);
            
            const subQ = query(collection(db, "submissions"), where("eventId", "==", currentEventId));
            unsubscribeDashboard = onSnapshot(subQ, (subSnap) => {
                dashboardData.submissions = subSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                
                // Aggiornamento selettivo dei contenuti
                updateDashboardDOM(dashboardData.teams, dashboardData.checkpoints, dashboardData.submissions);

                if (currentJudgeTeamId) {
                    const t = dashboardData.teams.find(t => t.id === currentJudgeTeamId);
                    const s = dashboardData.submissions.filter(s => s.teamId === currentJudgeTeamId);
                    if (t) renderJudgeDetail(t, dashboardData.checkpoints, s);
                }
            });
        }
    } catch (error) { showModal("Errore Dashboard", error.message); }
}

function calculateScore(teamId, checkpoints, submissions) {
    let score = 0;
    let completed = 0;
    checkpoints.forEach(cp => {
        const sub = submissions.find(s => s.teamId === teamId && s.checkpointId === cp.id);
        
        // Se non c'è submission o è bocciata (rejected), 0 punti
        if (sub && sub.status !== 'rejected') {
            completed++;
            // Logica Selfie: Punti dati se la foto c'è (validazione poi manuale in Sala Giudici)
            if (cp.cpType === 'selfie') {
                score += (cp.points || 0);
            } else {
                // Logica Testo: Controllo stringa esatta
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
    const teamStats = teams.map(team => {
        const stats = calculateScore(team.id, checkpoints, submissions);
        
        checkpoints.forEach(cp => {
            const sub = submissions.find(s => s.teamId === team.id && s.checkpointId === cp.id);
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
                    lucide.createIcons({ root: cell });
                }
            }
        });
        return { ...team, ...stats };
    });

    const leaderboardBody = document.getElementById('leaderboardBody');
    teamStats.sort((a, b) => b.score - a.score);
    
    leaderboardBody.innerHTML = teamStats.map((team, index) => {
        const badge = team.category === 'non-competitive' 
            ? '<span class="ml-2 text-xs bg-gray-200 text-gray-600 px-1 rounded">Ludica</span>' 
            : '<span class="ml-2 text-xs bg-orange-100 text-brand-orange px-1 rounded border border-orange-200">Competitiva</span>';
        return `<tr class="border-b ${index === 0 ? 'bg-yellow-100' : ''}"><td class="p-2 text-center font-bold">${index + 1}</td><td class="p-2">${team.name}${badge}</td><td class="p-2 text-center">${team.completed}/${checkpoints.length}</td><td class="p-2 text-right font-bold">${team.score}</td></tr>`;
    }).join('');
}

// Export CSV aggiornato
document.getElementById('exportCsvBtn').addEventListener('click', () => {
    if (!dashboardData || !dashboardData.teams.length) return;
    const teams = dashboardData.teams;
    const { checkpoints, submissions } = dashboardData;

    const teamStats = teams.map(team => {
        let score = 0;
        let lastCorrectTime = 0;
        const teamSubs = [];
        checkpoints.forEach(cp => {
            const sub = submissions.find(s => s.teamId === team.id && s.checkpointId === cp.id);
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
                        const subTime = sub.timestamp?.toMillis() || 0;
                        if (subTime > lastCorrectTime) lastCorrectTime = subTime;
                    }
                }
            }
            cellText = cellText.replace(/"/g, '""');
            teamSubs.push(`"${cellText}"`);
        });
        return { name: team.name, category: team.category, score, lastCorrectTime, subs: teamSubs };
    });

    teamStats.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        if (a.lastCorrectTime === 0) return 1;
        if (b.lastCorrectTime === 0) return -1;
        return a.lastCorrectTime - b.lastCorrectTime;
    });

    let csvContent = "Squadra;Categoria;" + checkpoints.map(cp => `"#${cp.number} (${cp.cpType})"`).join(";") + ';"ULTIMO ORARIO ESATTO";"TOTALE"\n';
    
    const correctAnswersRow = checkpoints.map(cp => {
        if (cp.cpType === 'selfie') return '"(Foto)"';
        return `"${(cp.correctAnswer || "").replace(/"/g, '""')}"`;
    });
    csvContent += `"RISPOSTE ESATTE";"-";${correctAnswersRow.join(";")};"-";"-"\n`;
    
    teamStats.forEach(t => {
        const catLabel = t.category === 'non-competitive' ? 'Ludico' : 'Competitiva';
        const safeName = t.name.replace(/"/g, '""');
        const formattedTime = t.lastCorrectTime > 0 ? new Date(t.lastCorrectTime).toLocaleTimeString('it-IT') : "-";
        csvContent += `"${safeName}";"${catLabel}";${t.subs.join(";")};"${formattedTime}";"${t.score}"\n`;
    });

    const blob = new Blob(["\uFEFF" + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "classifica.csv";
    document.body.appendChild(link); 
    link.click(); 
    document.body.removeChild(link);
});

document.getElementById('backToOrganizerHome').addEventListener('click', () => { if(unsubscribeDashboard) unsubscribeDashboard(); currentEventId = null; showView('organizerHomeView'); });

// --- SALA GIUDICI ---
document.getElementById('judgeRoomBtn').addEventListener('click', initJudgeRoom);
document.getElementById('backToDashboardFromJudge').addEventListener('click', () => showView('organizerDashboardView'));

async function initJudgeRoom() {
    if(!dashboardData) await setupDashboardListener(); // Assicuriamoci di avere i dati
    showView('organizerJudgeListView');
    renderJudgeList();
}

function renderJudgeList() {
    const { teams, checkpoints, submissions } = dashboardData;
    const tbody = document.getElementById('judgeListBody');

    const stats = teams.map(t => {
        const calc = calculateScore(t.id, checkpoints, submissions);
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
        const team = teams.find(t => t.id === teamId);
        const teamSubs = submissions.filter(s => s.teamId === teamId);
        renderJudgeDetail(team, checkpoints, teamSubs);
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
            const timeA = subA && subA.timestamp ? subA.timestamp.toMillis() : 0;
            const timeB = subB && subB.timestamp ? subB.timestamp.toMillis() : 0;
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
    showView('organizerJudgeDetailView');

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

function startEditCheckpoint(id, data) {
    document.getElementById('editCheckpointId').value = id;
    const form = document.getElementById('addCheckpointForm');
    
    const type = data.cpType || 'text';
    const radio = form.querySelector(`input[name="cpType"][value="${type}"]`);
    if(radio) {
        radio.checked = true;
        radio.dispatchEvent(new Event('change'));
    }

    form.number.value = data.number; 
    form.question.value = data.question;
    form.description.value = data.description || '';
    form.placeholder.value = data.placeholder || '';
    form.correctAnswer.value = data.correctAnswer || ''; 
    form.points.value = data.points;
    
    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.textContent = 'Salva Modifiche';
    submitBtn.classList.replace('btn-secondary', 'btn-primary');
    document.getElementById('cancelEditBtn').classList.remove('hidden');
}

function resetCheckpointForm() {
    const form = document.getElementById('addCheckpointForm');
    form.reset(); document.getElementById('editCheckpointId').value = '';
    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.textContent = 'Aggiungi Punto';
    submitBtn.classList.replace('btn-primary', 'btn-secondary');
    document.getElementById('cancelEditBtn').classList.add('hidden');
    // Reset radio a text
    const radioText = form.querySelector(`input[name="cpType"][value="text"]`);
    if(radioText) {
        radioText.checked = true;
        radioText.dispatchEvent(new Event('change'));
    }
}

document.getElementById('cancelEditBtn').addEventListener('click', resetCheckpointForm);

document.getElementById('addCheckpointForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const cpType = form.querySelector('input[name="cpType"]:checked').value;
    
    const data = {
        number: parseInt(form.number.value),
        question: form.question.value,
        description: form.description.value,
        points: parseInt(form.points.value),
        cpType: cpType
    };

    if (cpType === 'text') {
        data.placeholder = form.placeholder.value;
        data.correctAnswer = form.correctAnswer.value;
    } else {
        data.placeholder = "";
        data.correctAnswer = "";
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
        const docRef = doc(db, `events/${currentEventId}/checkpoints`, finalCheckpointId);
        await updateDoc(docRef, data);
        
        resetCheckpointForm();
        
    } catch(error) { showModal("Errore", "Salvataggio fallito: " + error.message); }
});

document.getElementById('manageCpBtn').addEventListener('click', () => {
    if (organizerAdminUnsub) organizerAdminUnsub();
    showView('organizerAdminView');
    const checkpointsList = document.getElementById('checkpointsList');
    const checkpointsQuery = query(collection(db, `events/${currentEventId}/checkpoints`), orderBy("number"));
    organizerAdminUnsub = onSnapshot(checkpointsQuery, (snapshot) => {
        checkpointsList.innerHTML = snapshot.empty ? '<p>Nessun punto di controllo creato.</p>' : '';
        snapshot.docs.forEach(doc => {
            const cp = doc.data(); const id = doc.id;
            const item = document.createElement('div');
            item.className = 'p-3 bg-gray-100 rounded-md flex justify-between items-center';
            item.innerHTML = `<div><p class="font-bold">#${cp.number} - ${cp.cpType === 'selfie' ? '📷 Selfie' : '📝 Domanda'} (${cp.points} pt.)</p><p class="text-sm text-gray-600">${cp.question}</p></div><div class="flex space-x-2"><button title="Modifica" class="edit-btn p-2 text-blue-600 hover:text-blue-800"><i data-lucide="pencil" class="pointer-events-none"></i></button><button title="Elimina" class="delete-btn p-2 text-red-600 hover:text-red-800"><i data-lucide="trash-2" class="pointer-events-none"></i></button></div>`;
            item.querySelector('.edit-btn').addEventListener('click', () => startEditCheckpoint(id, cp));
            item.querySelector('.delete-btn').addEventListener('click', () => deleteCheckpoint(id));
            checkpointsList.appendChild(item);
        });
        lucide.createIcons();
    });
});
document.getElementById('backToDashboardBtn').addEventListener('click', () => showView('organizerDashboardView'));
async function deleteCheckpoint(id) {
    showModal("Conferma Eliminazione", "Sei sicuro?", true, async () => {
        try { await deleteDoc(doc(db, `events/${currentEventId}/checkpoints`, id)); } catch (error) { showModal("Errore", error.message); }
    });
}

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

    document.getElementById('checkpointDetail').innerHTML = `
        ${imageUrlHtml}
        <h2 class="text-2xl font-bold mb-2 flex items-center">Punto #${checkpoint.number} ${typeLabel}</h2>
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
        deleteButton.onclick = () => deleteSubmission(submission.id, teamId, checkpoint.id);
        
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
             const photoRef = ref(storage, `submissions/${currentEventId}/${teamId}_${checkpointId}.jpg`);
             await uploadBytes(photoRef, compressedFile);
             photoUrl = await getDownloadURL(photoRef);
        }

        const submissionTimestamp = new Date();
        const data = { eventId: currentEventId, teamId, checkpointId, answer, timestamp: submissionTimestamp };
        if(photoUrl) data.photoUrl = photoUrl;

        await addDoc(collection(db, "submissions"), data);
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
function compressImage(file, maxWidth, quality) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (event) => {
            const img = new Image();
            img.src = event.target.result;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width; let height = img.height;
                if (width > maxWidth) { height *= maxWidth / width; width = maxWidth; }
                canvas.width = width; canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                canvas.toBlob((blob) => { resolve(blob); }, 'image/jpeg', quality);
            };
            img.onerror = (error) => reject(error);
        };
        reader.onerror = (error) => reject(error);
    });
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
});
async function initActivityLogView() {
    if (!dashboardData) return;
    if (activityLogUnsub) activityLogUnsub();
    const logContainer = document.getElementById('activityLogContainer');
    logContainer.innerHTML = '<i data-lucide="loader-2" class="w-12 h-12 animate-spin text-green-700 mx-auto"></i>';
    showView('activityLogView');

    const q = query(collection(db, `events/${currentEventId}/activity`), orderBy("timestamp", "desc"));
    activityLogUnsub = onSnapshot(q, (snapshot) => {
         logContainer.innerHTML = '';
         
         if (snapshot.empty) {
             logContainer.innerHTML = '<p class="text-gray-500 text-center py-4">Nessuna attività registrata.</p>';
             return;
         }

         snapshot.forEach(docSnap => {
             const log = docSnap.data();
             const time = log.timestamp ? log.timestamp.toDate().toLocaleTimeString('it-IT') : '-';
             
             const team = dashboardData.teams.find(t => t.id === log.teamId);
             const teamName = team ? team.name : log.teamId;
             
             const cp = dashboardData.checkpoints.find(c => c.id === log.checkpointId);
             const cpNumber = cp ? cp.number : '?';
             
             let actionText = '';
             let correctnessBadge = '';
             
             if (log.type === 'delete') {
                 actionText = '<span class="text-red-600 font-bold">Eliminazione</span>';
             } else {
                 const ans = log.answer || '(Foto)';
                 actionText = `Invio: <span class="font-mono text-gray-700">"${ans}"</span>`;
                 
                 if (cp) {
                     let isCorrect = false;
                     if (cp.cpType === 'selfie') {
                         isCorrect = true;
                     } else if (log.answer && cp.correctAnswer) {
                         isCorrect = log.answer.toLowerCase().trim() === cp.correctAnswer.toLowerCase().trim();
                     }
                     correctnessBadge = isCorrect 
                        ? '<span class="bg-green-100 text-green-800 px-2 py-0.5 rounded text-xs font-bold ml-2">ESATTA</span>' 
                        : '<span class="bg-red-100 text-red-800 px-2 py-0.5 rounded text-xs font-bold ml-2">ERRATA</span>';
                 }
             }
             
             let totalSubs = 0;
             let correctSubs = 0;
             if (team) {
                 const teamSubs = dashboardData.submissions.filter(s => s.teamId === log.teamId && s.status !== 'rejected');
                 totalSubs = teamSubs.length;
                 teamSubs.forEach(sub => {
                     const c = dashboardData.checkpoints.find(x => x.id === sub.checkpointId);
                     if (c) {
                         if (c.cpType === 'selfie') correctSubs++;
                         else if (sub.answer && c.correctAnswer && sub.answer.toLowerCase().trim() === c.correctAnswer.toLowerCase().trim()) correctSubs++;
                     }
                 });
             }

             const div = document.createElement('div');
             div.className = "p-4 border-b bg-white hover:bg-gray-50 flex flex-col md:flex-row justify-between items-start md:items-center rounded-lg shadow-sm mb-3 border border-gray-100 gap-4";
             div.innerHTML = `
                 <div>
                     <p class="font-black text-gray-800 text-lg">${time} - ${teamName}</p>
                     <p class="text-sm text-gray-600 mt-1">Punto #${cpNumber} | ${actionText} ${correctnessBadge}</p>
                 </div>
                 <div class="text-right bg-gray-100 p-2 rounded border border-gray-200 min-w-[120px]">
                     <p class="text-xs text-gray-500 font-bold uppercase mb-1">Status Squadra</p>
                     <p class="font-bold text-sm text-gray-700">Inviate: ${totalSubs}</p>
                     <p class="font-bold text-sm text-green-600">Corrette: ${correctSubs}</p>
                 </div>
             `;
             logContainer.appendChild(div);
         });
         lucide.createIcons();
    });
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
document.getElementById('backToDashboardFromTeams').addEventListener('click', () => showView('organizerDashboardView'));

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
    try {
        const tDoc = await getDoc(doc(db, `events/${currentEventId}/teams`, teamId));
        if(tDoc.exists()) document.getElementById('participant-team-name-display').textContent = `Squadra: ${tDoc.data().name}`;
        document.getElementById('game-finished-banner').classList.toggle('hidden', !isReadOnly);
        
        const subQ = query(collection(db, "submissions"), where("teamId", "==", teamId), where("eventId", "==", currentEventId));
        const cpSnap = await getDocs(query(collection(db, `events/${currentEventId}/checkpoints`), orderBy("number")));
        const checkpoints = cpSnap.docs.map(d=>({id:d.id, ...d.data()}));
        
        onSnapshot(subQ, (snap) => {
            const subs = {}; snap.forEach(d => subs[d.data().checkpointId] = {id:d.id, ...d.data()});
            const grid = document.getElementById('checkpointsGrid');
            grid.innerHTML = '';
            checkpoints.forEach(cp => {
                const sub = subs[cp.id];
                const isDone = !!sub;
                const isSelfie = cp.cpType === 'selfie';

                const card = document.createElement('div');
                // Manteniamo le classi di base, aggiungendo un po' di altezza fissa (h-28) per accomodare l'icona senza sballare il layout
                card.className = `p-3 rounded-lg shadow-md flex flex-col items-center justify-center h-28 border-2 transition-all cursor-pointer transform hover:scale-105 
                    ${isDone ? 'bg-green-500 text-white border-green-600' : 'bg-white text-gray-800 border-gray-100 hover:border-brand-orange'}`;
                
                // Logica Icona: Se è selfie mostriamo la camera. 
                // Se il punto è fatto (sfondo verde), l'icona è bianca, altrimenti è arancione.
                const iconColor = isDone ? 'text-white' : 'text-brand-orange';
                const cameraIcon = isSelfie ? `<i data-lucide="camera" class="w-6 h-6 mb-1 ${iconColor}"></i>` : '<div class="h-6 mb-1"></div>'; // Il div vuoto serve ad allineare i numeri se vuoi che siano tutti alla stessa altezza, altrimenti toglilo.

                card.innerHTML = `
                    ${isSelfie ? cameraIcon : ''}
                    <span class="text-3xl font-black">${cp.number}</span>
                    ${isDone ? '<i data-lucide="check" class="mt-1 w-5 h-5 font-bold"></i>' : ''}
                `;
                
                card.onclick = () => openCheckpoint(cp, teamId, isDone, sub, isReadOnly);
                grid.appendChild(card);
            });
            lucide.createIcons();
            showView('participantView');
        });
    } catch(e) { console.error(e); }
}
async function deleteSubmission(subId, teamId, cpId) {
    showModal("Cancella", "Sicuro?", true, async () => {
        await deleteDoc(doc(db, "submissions", subId));
        await deleteObject(ref(storage, `submissions/${currentEventId}/${teamId}_${cpId}.jpg`)).catch(()=>{});
        showModal("Fatto", "Cancellato.");
        showView('participantView');
    });
}
document.getElementById('backToGrid').addEventListener('click', () => showView('participantView'));
document.getElementById('logout-participant').addEventListener('click', () => { localStorage.removeItem('currentEventId-'+currentUserId); signOut(auth); });
document.getElementById('logout-lobby').addEventListener('click', () => signOut(auth));
document.getElementById('logout-join').addEventListener('click', () => signOut(auth));
document.getElementById('closePhotoModalBtn').addEventListener('click', () => document.getElementById('photoModal').classList.add('hidden'));

function showSubmissionDetail(submission, checkpoint, isCorrect, team) {
     document.getElementById('organizerDetailContent').innerHTML = `<p><strong>Squadra:</strong> ${team.name}</p><p><strong>R:</strong> ${submission.answer}</p><p><strong>Ok:</strong> ${isCorrect}</p>${submission.photoUrl ? `<img src="${submission.photoUrl}" class="w-full rounded">` : ''}`;
     showView('organizerDetailView');
}
document.getElementById('backToOrganizer').addEventListener('click', () => showView('organizerDashboardView'));

// Init
showView('loadingView');
lucide.createIcons();