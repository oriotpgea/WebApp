import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, addDoc, onSnapshot, collection, query, where, getDocs, orderBy, updateDoc, deleteDoc, writeBatch } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
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
const db = getFirestore(app);
const storage = getStorage(app);

const views = ['loadingView', 'loginView', 'organizerHomeView', 'joinEventView', 'participantLobbyView', 'participantView', 'checkpointView', 'organizerDashboardView', 'organizerDetailView', 'organizerAdminView', 'organizerTeamsView', 'activityLogView'];
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

onAuthStateChanged(auth, async user => {
    if (participantListenerUnsub) { participantListenerUnsub(); participantListenerUnsub = null; }
    if (activityLogUnsub) { activityLogUnsub(); activityLogUnsub = null; }
    if (unsubscribeDashboard) { unsubscribeDashboard(); unsubscribeDashboard = null; }

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
    } catch (error) { 
        showModal("Errore", "Registrazione fallita: " + error.message); 
    } 
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
            
            // --- QUESTA È LA PARTE CHE MANCAVA ---
            eventCard.innerHTML = `
                <div>
                    <h3 class="font-bold text-xl text-green-800">${event.name}</h3>
                    <p class="text-sm text-gray-500">Codice: <span class="font-mono font-bold">${event.joinCode}</span></p>
                </div>
                <div class="flex space-x-2">
                    <button class="manage-event-btn btn btn-primary px-4 py-2">Gestisci</button>
                </div>
            `;
            // -------------------------------------

            // Ora il pulsante esiste, quindi possiamo assegnare il click
            eventCard.querySelector('.manage-event-btn').onclick = () => { 
                currentEventId = doc.id; 
                initOrganizerDashboardView(); 
            };
            
            eventsList.appendChild(eventCard);
        });
        lucide.createIcons();
    }, (error) => {
        // Aggiungiamo questo per vedere se manca l'indice su Firebase
        console.error("Errore caricamento eventi:", error);
    });
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

async function initOrganizerDashboardView() { showView('organizerDashboardView'); setupDashboardListener(); }

async function setupDashboardListener() {
    if(unsubscribeDashboard) { unsubscribeDashboard(); unsubscribeDashboard = null; }
    
    try {
        const eventRef = doc(db, "events", currentEventId);
        const [eventDoc, teamsSnapshot, checkpointsSnapshot, submissionsSnapshot] = await Promise.all([
            getDoc(eventRef),
            getDocs(collection(db, `events/${currentEventId}/teams`)),
            getDocs(query(collection(db, `events/${currentEventId}/checkpoints`), orderBy("number"))),
            getDocs(query(collection(db, "submissions"), where("eventId", "==", currentEventId)))
        ]);

        if (eventDoc.exists()) {
            renderOrganizerUI(
                eventDoc.data(),
                teamsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })),
                checkpointsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })),
                submissionsSnapshot.docs.map(doc => ({id: doc.id, ...doc.data()}))
            );
        }
    } catch (error) { 
        showModal("Errore Dashboard", "Impossibile caricare i dati: " + error.message); 
    }
}

function renderOrganizerUI(eventData, teams, checkpoints, submissions) {
    const organizerGrid = document.getElementById('organizerGrid');
    let tableHtml = `<thead class="bg-gray-200"><tr><th class="p-3 text-left">Squadra</th>${checkpoints.map(c => `<th class="p-3 text-center w-20">${c.number}</th>`).join('')}</tr></thead><tbody>`;
    teams.forEach(team => { tableHtml += `<tr class="border-b"><td class="p-3 font-medium">${team.name}</td>${checkpoints.map(c => `<td id="cell-${team.id}-${c.id}" class="p-3 text-center align-middle"><i data-lucide="circle-dashed" class="w-5 h-5 text-gray-400 mx-auto"></i></td>`).join('')}</tr>`; });
    organizerGrid.innerHTML = tableHtml + '</tbody>';
    const teamScores = {};
    teams.forEach(team => { teamScores[team.id] = { name: team.name, score: 0, completed: 0 }; });
    
    submissions.forEach(sub => {
        if (!sub.teamId || !teamScores[sub.teamId]) return;
        const checkpoint = checkpoints.find(c => c.id === sub.checkpointId);

        teamScores[sub.teamId].completed++;
        if (!checkpoint || typeof checkpoint.correctAnswer === 'undefined') return;

        const isCorrect = checkpoint.correctAnswer.toLowerCase().trim() === sub.answer.toLowerCase().trim();
        if (isCorrect) { 
            teamScores[sub.teamId].score += (checkpoint.points || 0);
        }
        const cell = document.getElementById(`cell-${sub.teamId}-${sub.checkpointId}`);
        if (cell) {
            cell.innerHTML = `<div class="flex flex-col items-center cursor-pointer" title="Clicca per i dettagli">
                ${isCorrect ? '<i data-lucide="check-circle-2" class="w-6 h-6 text-green-600 mx-auto"></i>' : '<i data-lucide="x-circle" class="w-6 h-6 text-red-500 mx-auto"></i>'}
                <i data-lucide="camera" class="w-4 h-4 text-gray-400 hover:text-blue-500 mt-1"></i>
            </div>`;
            cell.querySelector('div').addEventListener('click', () => showSubmissionDetail(sub, checkpoint, isCorrect, teams.find(t => t.id === sub.teamId)));
        }
    });
    const leaderboardBody = document.getElementById('leaderboardBody');
    const sortedTeams = Object.values(teamScores).sort((a, b) => b.score - a.score);
    leaderboardBody.innerHTML = sortedTeams.map((team, index) => `<tr class="border-b ${index === 0 ? 'bg-yellow-100' : ''}"><td class="p-2 text-center font-bold">${index + 1}</td><td class="p-2">${team.name}</td><td class="p-2 text-center">${team.completed}/${checkpoints.length}</td><td class="p-2 text-right font-bold">${team.score}</td></tr>`).join('');
    
    lucide.createIcons();
}

document.getElementById('exportCsvBtn').addEventListener('click', () => { /* ... logica futura ... */ });
document.getElementById('backToOrganizerHome').addEventListener('click', () => { if(unsubscribeDashboard) unsubscribeDashboard(); currentEventId = null; showView('organizerHomeView'); });

document.getElementById('startEventBtn').addEventListener('click', () => {
    showModal("Conferma Avvio", "Sei sicuro di voler avviare la gara? Verrà registrato l'orario di inizio per i bonus a tempo.", true, async () => {
        if(!currentEventId) return;
        await updateDoc(doc(db, "events", currentEventId), { status: 'active', startTime: new Date() });
        showModal("Successo", "Evento avviato!");
    });
});
document.getElementById('finishEventBtn').addEventListener('click', () => {
    showModal("Conferma Termine", "Sei sicuro di voler terminare la gara?", true, async () => {
        if(!currentEventId) return;
        await updateDoc(doc(db, "events", currentEventId), { status: 'finished' });
        showModal("Successo", "Evento terminato!");
    });
});

document.getElementById('activityLogBtn').addEventListener('click', () => initActivityLogView());
document.getElementById('backToDashboardFromLog').addEventListener('click', () => {
    if (activityLogUnsub) {
        activityLogUnsub();
        activityLogUnsub = null;
    }
    showView('organizerDashboardView');
});

async function initActivityLogView() {
    if (activityLogUnsub) activityLogUnsub();
    
    const logContainer = document.getElementById('activityLogContainer');
    logContainer.innerHTML = '<i data-lucide="loader-2" class="w-12 h-12 animate-spin text-green-700 mx-auto"></i>';
    lucide.createIcons();
    showView('activityLogView');

    try {
        const [teamsSnapshot, checkpointsSnapshot] = await Promise.all([
            getDocs(collection(db, `events/${currentEventId}/teams`)),
            getDocs(collection(db, `events/${currentEventId}/checkpoints`))
        ]);

        const teamsMap = new Map();
        teamsSnapshot.forEach(doc => teamsMap.set(doc.id, doc.data()));
        const checkpointsMap = new Map();
        checkpointsSnapshot.forEach(doc => checkpointsMap.set(doc.id, doc.data()));

        const q = query(collection(db, `events/${currentEventId}/activity`), orderBy("timestamp", "desc"));
        
        activityLogUnsub = onSnapshot(q, (snapshot) => {
            if (snapshot.empty) {
                logContainer.innerHTML = '<p class="text-center text-gray-500">Nessuna attività registrata per questo evento.</p>';
                return;
            }

            logContainer.innerHTML = '';
            snapshot.forEach(doc => {
                const log = doc.data();
                const team = teamsMap.get(log.teamId);
                const checkpoint = checkpointsMap.get(log.checkpointId);
                
                const time = log.timestamp.toDate().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                const teamName = team ? team.name : 'Squadra Sconosciuta';
                const checkpointNumber = checkpoint ? checkpoint.number : '?';

                const logElement = document.createElement('div');
                logElement.className = 'p-4 border rounded-lg flex items-start space-x-4';

                if (log.type === 'submit') {
                    const isCorrect = checkpoint && checkpoint.correctAnswer.toLowerCase().trim() === log.answer.toLowerCase().trim();
                    logElement.innerHTML = `
                        <div>${isCorrect ? '<i data-lucide="check-circle-2" class="w-6 h-6 text-green-600"></i>' : '<i data-lucide="x-circle" class="w-6 h-6 text-red-500"></i>'}</div>
                        <div class="flex-grow">
                            <p class="font-bold">${time} - ${teamName} <span class="font-normal text-gray-600">ha risposto al punto #${checkpointNumber}</span></p>
                            <p class="text-lg">Risposta: <span class="font-semibold">${log.answer}</span></p>
                        </div>
                        <button class="show-photo-btn p-2 hover:bg-gray-200 rounded-full" data-url="${log.photoUrl}">
                            <i data-lucide="camera" class="w-6 h-6 text-gray-600"></i>
                        </button>
                    `;
                } else if (log.type === 'delete') {
                    logElement.classList.add('bg-gray-50');
                    logElement.innerHTML = `
                        <div><i data-lucide="trash-2" class="w-6 h-6 text-gray-500"></i></div>
                        <div class="flex-grow">
                            <p class="font-bold">${time} - ${teamName} <span class="font-normal text-gray-600">ha cancellato la risposta per il punto #${checkpointNumber}</span></p>
                            <p class="text-gray-500 italic">Risposta precedente: "${log.answer}"</p>
                        </div>
                    `;
                }
                logContainer.appendChild(logElement);
            });
            
            document.querySelectorAll('.show-photo-btn').forEach(btn => {
                btn.onclick = (e) => showPhotoModal(e.currentTarget.dataset.url);
            });

            lucide.createIcons();
        });

    } catch (error) {
        logContainer.innerHTML = '';
        showModal("Errore Log", "Impossibile caricare il log delle attività. Dettagli: " + error.message);
    }
}

const photoModal = document.getElementById('photoModal');
const modalImage = document.getElementById('modalImage');
document.getElementById('closePhotoModalBtn').addEventListener('click', () => photoModal.classList.add('hidden'));

function showPhotoModal(imageUrl) {
    modalImage.src = imageUrl;
    photoModal.classList.remove('hidden');
}

document.getElementById('joinEventForm').addEventListener('submit', async (e) => { 
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
        const joinCode = document.getElementById('joinCode').value.toUpperCase();
        const teamName = document.getElementById('teamName').value;
        const q = query(collection(db, "events"), where("joinCode", "==", joinCode));
        const eventSnapshot = await getDocs(q);
        if(eventSnapshot.empty) { throw new Error("Codice evento non valido."); }
        
        currentEventId = eventSnapshot.docs[0].id;
        const eventData = eventSnapshot.docs[0].data();

        if (eventData.status === 'finished') { throw new Error("Questo evento è già concluso."); }
        
        await setDoc(doc(db, `events/${currentEventId}/teams`, currentUserId), { name: teamName, uid: currentUserId }, { merge: true });
        
        localStorage.setItem('currentEventId-' + currentUserId, currentEventId);
        initParticipantLobbyView();

    } catch (error) {
        showModal("Errore", error.message);
        btn.disabled = false;
    }
});

function initParticipantLobbyView() { 
    if (participantListenerUnsub) participantListenerUnsub();
    const eventDocRef = doc(db, "events", currentEventId);
    participantListenerUnsub = onSnapshot(eventDocRef, (docSnap) => {
        if (docSnap.exists()) {
            const eventData = docSnap.data();
            document.getElementById('lobbyEventName').textContent = eventData.name;
            if (eventData.status === 'active') { 
                if (participantListenerUnsub) { participantListenerUnsub(); participantListenerUnsub = null; }
                initParticipantView(currentUserId); 
            } 
            else if (eventData.status === 'pending') { 
                showView('participantLobbyView'); 
            } 
            else { 
                if (participantListenerUnsub) { participantListenerUnsub(); participantListenerUnsub = null; }
                initParticipantView(currentUserId, true); 
            }
        } else {
            if (participantListenerUnsub) { participantListenerUnsub(); participantListenerUnsub = null; }
            showModal("Errore", "L'evento a cui eri iscritto è stato cancellato.", false, () => signOut(auth));
        }
    }, (error) => { console.error("Lobby listener error:", error); });
}

document.getElementById('logout-join').addEventListener('click', () => signOut(auth));
document.getElementById('logout-lobby').addEventListener('click', () => signOut(auth));
document.getElementById('logout-participant').addEventListener('click', async () => {
    const eventDoc = await getDoc(doc(db, "events", currentEventId));
    if(eventDoc.exists() && eventDoc.data().status === 'finished') {
        showModal("Sei sicuro di voler uscire?", "Uscendo ora non potrai più rientrare per vedere le tue risposte. L'evento è concluso.", true, () => {
            localStorage.removeItem('currentEventId-' + currentUserId);
            signOut(auth);
        });
    } else {
        localStorage.removeItem('currentEventId-' + currentUserId);
        signOut(auth);
    }
});

async function initParticipantView(teamId, isReadOnly = false) { 
    if (participantListenerUnsub) participantListenerUnsub();
    
    const eventDocRef = doc(db, "events", currentEventId);
    participantListenerUnsub = onSnapshot(eventDocRef, (docSnap) => {
        if (docSnap.exists() && docSnap.data().status === 'finished' && !isReadOnly) {
            showModal("Gara Terminata!", "L'organizzatore ha concluso la gara. Puoi ancora vedere le tue risposte, ma non puoi più inviarne di nuove.", false);
            initParticipantView(teamId, true); 
        }
    });

    try {
        document.getElementById('game-finished-banner').classList.toggle('hidden', !isReadOnly);
        const teamDoc = await getDoc(doc(db, `events/${currentEventId}/teams`, teamId));
        if(teamDoc.exists()) { document.getElementById('participant-team-name-display').textContent = `Squadra: ${teamDoc.data().name}`; }
        const checkpointsQuery = query(collection(db, `events/${currentEventId}/checkpoints`), orderBy("number"));
        const submissionsQuery = query(collection(db, "submissions"), where("teamId", "==", teamId), where("eventId", "==", currentEventId));
        const checkpointsSnapshot = await getDocs(checkpointsQuery);
        const checkpoints = checkpointsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        
        onSnapshot(submissionsQuery, (snapshot) => {
            const submissions = {};
            snapshot.forEach(doc => { submissions[doc.data().checkpointId] = { id: doc.id, ...doc.data() }; });
            const checkpointsGrid = document.getElementById('checkpointsGrid');
            checkpointsGrid.innerHTML = '';
            checkpoints.forEach(checkpoint => {
                const submission = submissions[checkpoint.id];
                const isCompleted = !!submission;
                const card = document.createElement('div');
                card.className = `p-4 rounded-lg shadow-md flex flex-col items-center justify-center transition-all ${isCompleted ? 'bg-green-500 text-white' : 'bg-white'} ${!isReadOnly ? 'cursor-pointer hover:bg-gray-100' : 'cursor-default'}`;
                card.innerHTML = `<span class="text-4xl font-bold">${checkpoint.number}</span><span class="text-sm mt-1">${isCompleted ? 'Completato' : 'Da visitare'}</span>${isCompleted ? '<i data-lucide="check-circle" class="w-6 h-6 mt-2"></i>' : '<i data-lucide="map-pin" class="w-6 h-6 mt-2"></i>'}`;
                if (!isReadOnly || isCompleted) {
                   card.addEventListener('click', () => openCheckpoint(checkpoint, teamId, isCompleted, submission, isReadOnly));
                }
                checkpointsGrid.appendChild(card);
            });
            lucide.createIcons();
            showView('participantView');
        }, (error) => { console.error("Game submissions listener error:", error); });
    } catch (error) {
         showModal("Errore Critico", "Impossibile caricare i dati della gara. Dettagli: " + error.message, false, () => signOut(auth));
    }
}

async function openCheckpoint(checkpoint, teamId, isCompleted, submission, isReadOnly = false) {
    showView('checkpointView');
    let imageUrlHtml = checkpoint.imageUrl ? `<div class="bg-gray-200 rounded-lg mb-4"><img src="${checkpoint.imageUrl}" alt="Immagine del punto" class="w-full h-48 object-contain rounded-lg"></div>` : '';
    document.getElementById('checkpointDetail').innerHTML = `${imageUrlHtml}<h2 class="text-2xl font-bold mb-4">Punto #${checkpoint.number}</h2><p class="text-lg bg-gray-100 p-4 rounded-md">${checkpoint.question}</p>`;
    document.getElementById('checkpointIdInput').value = checkpoint.id;
    document.getElementById('teamIdInput').value = teamId;
    const answerInput = document.getElementById('answer');
    const photoInput = document.getElementById('photo');
    const submitButton = document.getElementById('submissionForm').querySelector('button[type="submit"]');
    const deleteButton = document.getElementById('deleteSubmissionBtn');
    if (isCompleted) {
        answerInput.value = submission.answer;
        answerInput.disabled = true;
        photoInput.classList.add('hidden');
        submitButton.classList.add('hidden');
        deleteButton.classList.toggle('hidden', isReadOnly);
        deleteButton.onclick = () => deleteSubmission(submission.id, teamId, checkpoint.id);
        document.getElementById('photo-preview-container').innerHTML = `<p class="mt-4">Foto inviata:</p><img src="${submission.photoUrl}" class="mt-2 rounded-md max-w-sm w-full" />`;
    } else {
        answerInput.value = ''; answerInput.disabled = isReadOnly; photoInput.value = '';
        photoInput.classList.toggle('hidden', isReadOnly); submitButton.classList.toggle('hidden', isReadOnly);
        deleteButton.classList.add('hidden');
        submitButton.disabled = false; submitButton.textContent = 'Invia Risposta';
        document.getElementById('photo-preview-container').innerHTML = '';
    }
}

async function deleteSubmission(submissionId, teamId, checkpointId) {
    showModal("Conferma Cancellazione", "Sei sicuro di voler cancellare la tua risposta? Potrai inviarne una nuova.", true, async () => {
        try {
            const submissionRef = doc(db, "submissions", submissionId);
            const submissionDoc = await getDoc(submissionRef);

            if (submissionDoc.exists()) {
                const subData = submissionDoc.data();
                await addDoc(collection(db, `events/${currentEventId}/activity`), {
                    type: 'delete',
                    teamId: teamId,
                    checkpointId: checkpointId,
                    answer: subData.answer,
                    timestamp: new Date()
                });
            }

            const photoRef = ref(storage, `submissions/${currentEventId}/${teamId}_${checkpointId}.jpg`);
            await deleteDoc(submissionRef);
            await deleteObject(photoRef);
            showModal("Successo", "Risposta cancellata. Ora puoi inviarne una nuova.");
            showView('participantView');
        } catch(error) { showModal("Errore", "Cancellazione fallita: " + error.message); }
    });
}

document.getElementById('backToGrid').addEventListener('click', () => showView('participantView'));
document.getElementById('submissionForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitButton = e.target.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    submitButton.innerHTML = `<i data-lucide="loader-2" class="animate-spin mr-2"></i> Caricamento...`;
    lucide.createIcons();
    const teamId = document.getElementById('teamIdInput').value;
    const checkpointId = document.getElementById('checkpointIdInput').value;
    const answer = document.getElementById('answer').value;
    const photoFile = document.getElementById('photo').files[0];
    if (!photoFile) { showModal("Errore", "Devi caricare una foto!"); submitButton.disabled = false; submitButton.textContent = 'Invia Risposta'; return; }
    try {
        const eventDoc = await getDoc(doc(db, "events", currentEventId));
        if (eventDoc.data().status === 'finished') { throw new Error("La gara è terminata. Non è più possibile inviare risposte."); }
        
        const photoRef = ref(storage, `submissions/${currentEventId}/${teamId}_${checkpointId}.jpg`);
        await uploadBytes(photoRef, photoFile);
        const photoUrl = await getDownloadURL(photoRef);
        const submissionTimestamp = new Date();

        await addDoc(collection(db, "submissions"), { eventId: currentEventId, teamId, checkpointId, answer, photoUrl, timestamp: submissionTimestamp });

        await addDoc(collection(db, `events/${currentEventId}/activity`), {
            type: 'submit',
            teamId: teamId,
            checkpointId: checkpointId,
            answer: answer,
            photoUrl: photoUrl,
            timestamp: submissionTimestamp
        });
        showModal("Successo", "Risposta inviata con successo!");
        showView('participantView');
    } catch (error) { showModal("Errore", "Invio fallito: " + error.message); submitButton.disabled = false; submitButton.textContent = 'Invia Risposta';}
});

function showSubmissionDetail(submission, checkpoint, isCorrect, team) {
     document.getElementById('organizerDetailContent').innerHTML = `<p><strong>Squadra:</strong> ${team.name}</p><p><strong>Risposta Data:</strong> ${submission.answer}</p><p><strong>Risposta Corretta:</strong> ${checkpoint.correctAnswer}</p><p><strong>Punteggio Assegnato:</strong> ${isCorrect ? (checkpoint.points || 0) : 0}</p><p class="mt-4"><strong>Foto:</strong></p><img src="${submission.photoUrl}" alt="Foto sottomessa" class="mt-2 rounded-lg w-full max-w-lg">`;
     showView('organizerDetailView');
}

document.getElementById('backToOrganizer').addEventListener('click', () => showView('organizerDashboardView'));
document.getElementById('manageCpBtn').addEventListener('click', () => initOrganizerAdmin());
document.getElementById('manageTeamsBtn').addEventListener('click', () => initOrganizerTeamsView());

async function initOrganizerTeamsView() {
    if (organizerTeamsUnsub) organizerTeamsUnsub();
    showView('organizerTeamsView');
    const teamsList = document.getElementById('teamsList');
    organizerTeamsUnsub = onSnapshot(query(collection(db, `events/${currentEventId}/teams`)), (snapshot) => {
        teamsList.innerHTML = snapshot.empty ? '<p>Ancora nessuna squadra iscritta.</p>' : '';
        snapshot.forEach(doc => {
            const item = document.createElement('div');
            item.className = 'p-3 bg-gray-100 rounded-md flex justify-between items-center';
            item.innerHTML = `<p class="font-medium">${doc.data().name}</p>`;
            teamsList.appendChild(item);
        });
    });
}
document.getElementById('backToDashboardFromTeams').addEventListener('click', () => showView('organizerDashboardView'));

async function initOrganizerAdmin() {
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
            item.innerHTML = `<div><p class="font-bold">Punto #${cp.number} (${cp.points} pt.)</p><p class="text-sm text-gray-600">Q: ${cp.question} / A: ${cp.correctAnswer}</p></div><div class="flex space-x-2"><button title="Modifica" class="edit-btn p-2 text-blue-600 hover:text-blue-800"><i data-lucide="pencil" class="pointer-events-none"></i></button><button title="Elimina" class="delete-btn p-2 text-red-600 hover:text-red-800"><i data-lucide="trash-2" class="pointer-events-none"></i></button></div>`;
            item.querySelector('.edit-btn').addEventListener('click', () => startEditCheckpoint(id, cp));
            item.querySelector('.delete-btn').addEventListener('click', () => deleteCheckpoint(id));
            checkpointsList.appendChild(item);
        });
        lucide.createIcons();
    });
}

async function deleteCheckpoint(id) {
    showModal("Conferma Eliminazione", "Sei sicuro di voler eliminare questo punto di controllo? L'azione è irreversibile.", true, async () => {
        try { await deleteDoc(doc(db, `events/${currentEventId}/checkpoints`, id)); } catch (error) { showModal("Errore", "Eliminazione fallita: " + error.message); }
    });
}

function startEditCheckpoint(id, data) {
    document.getElementById('editCheckpointId').value = id;
    const form = document.getElementById('addCheckpointForm');
    form.number.value = data.number; form.question.value = data.question;
    form.correctAnswer.value = data.correctAnswer; form.points.value = data.points;
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
}

document.getElementById('cancelEditBtn').addEventListener('click', resetCheckpointForm);
document.getElementById('addCheckpointForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const data = {
        number: parseInt(form.number.value),
        question: form.question.value,
        correctAnswer: form.correctAnswer.value,
        points: parseInt(form.points.value)
    };
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

document.getElementById('backToDashboardBtn').addEventListener('click', () => showView('organizerDashboardView'));

// --- NUOVA LOGICA: Toggle Password ---
document.querySelectorAll('.toggle-password').forEach(btn => {
    btn.addEventListener('click', (e) => {
        // Trova l'input associato
        const inputId = btn.getAttribute('data-target');
        const input = document.getElementById(inputId);
        const icon = btn.querySelector('svg') || btn.querySelector('i'); // Supporto per Lucide renderizzato o raw
        
        if (input.type === 'password') {
            input.type = 'text';
            // Cambia icona in eye-off (rimuovi eye, aggiungi eye-off)
            // Nota: Lucide sostituisce i tag <i> con <svg>, quindi gestiamo attributi
            if(icon) icon.setAttribute('data-lucide', 'eye-off');
        } else {
            input.type = 'password';
            if(icon) icon.setAttribute('data-lucide', 'eye');
        }
        lucide.createIcons(); // Rerenderizza le icone
    });
});

// --- FIX REFRESH: Gestione corretta rotazione icona ---
const refreshBtn = document.getElementById('refreshDashboardBtn');
if(refreshBtn) {
    refreshBtn.addEventListener('click', () => {
        // 1. Avvia rotazione
        const iconStart = refreshBtn.querySelector('svg') || refreshBtn.querySelector('i');
        if(iconStart) iconStart.classList.add('animate-spin');
        
        setupDashboardListener().then(() => {
            setTimeout(() => {
                // 2. Cerca di nuovo l'icona (perché Lucide potrebbe averla rigenerata)
                const iconEnd = refreshBtn.querySelector('svg') || refreshBtn.querySelector('i');
                if(iconEnd) iconEnd.classList.remove('animate-spin');
            }, 500); 
        });
    });
}

showView('loadingView');
lucide.createIcons();