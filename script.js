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

const views = ['loadingView', 'loginView', 'organizerHomeView', 'joinEventView', 'participantLobbyView', 'participantView', 'checkpointView', 'organizerDashboardView', 'organizerDetailView', 'organizerAdminView', 'organizerTeamsView', 'galleryView'];
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

onAuthStateChanged(auth, async user => {
    if (participantListenerUnsub) { participantListenerUnsub(); participantListenerUnsub = null; }

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
document.getElementById('loginForm').addEventListener('submit', (e) => { e.preventDefault(); signInWithEmailAndPassword(auth, loginForm.email.value, loginForm.password.value).catch(err => showModal("Errore", "Login fallito: " + err.message)); });
document.getElementById('registerForm').addEventListener('submit', async (e) => { e.preventDefault(); try { const cred = await createUserWithEmailAndPassword(auth, registerForm.email.value, registerForm.password.value); await setDoc(doc(db, "users", cred.user.uid), { role: 'participant' }); } catch (error) { showModal("Errore", "Registrazione fallita: " + error.message); } });

function initOrganizerHomeView(user) {
    const eventsList = document.getElementById('organizerEventsList');
    const q = query(collection(db, "events"), where("organizerId", "==", user.uid), orderBy("creation_time", "desc"));
    onSnapshot(q, (snapshot) => {
        eventsList.innerHTML = snapshot.empty ? `<p class="text-gray-500">Nessun evento creato.</p>` : '';
        snapshot.forEach(doc => {
            const event = doc.data();
            const eventCard = document.createElement('div');
            eventCard.className = 'p-4 bg-white rounded-lg shadow-md flex justify-between items-center';
            eventCard.innerHTML = `<div><h3 class="font-bold text-lg">${event.name}</h3><p class="text-sm text-indigo-600 font-semibold">Codice: ${event.joinCode}</p><p class="text-xs text-gray-500 mt-1">Stato: <span class="font-medium ${event.status === 'active' ? 'text-green-500' : event.status === 'finished' ? 'text-gray-500' : 'text-yellow-500'}">${event.status}</span></p></div><div class="flex items-center space-x-2"><button class="manage-event-btn bg-blue-500 text-white px-3 py-2 rounded-md hover:bg-blue-600 text-sm font-semibold">Gestisci</button><button class="delete-event-btn bg-red-600 text-white p-2 rounded-full hover:bg-red-700"><i data-lucide="trash-2" class="w-4 h-4"></i></button></div>`;
            eventCard.querySelector('.manage-event-btn').onclick = () => { currentEventId = doc.id; initOrganizerDashboardView(); };
            eventCard.querySelector('.delete-event-btn').onclick = () => deleteEvent(doc.id, event.name);
            eventsList.appendChild(eventCard);
        });
        lucide.createIcons();
    });
    showView('organizerHomeView');
}

async function deleteEvent(eventId, eventName) {
    showModal("Conferma Eliminazione", `Sei sicuro di voler eliminare l'evento "${eventName}"? TUTTI i dati verranno cancellati per sempre.`, true, async () => {
        try {
            const batch = writeBatch(db);
            const [checkpointsSnapshot, teamsSnapshot, submissionsSnapshot] = await Promise.all([getDocs(collection(db, `events/${eventId}/checkpoints`)), getDocs(collection(db, `events/${eventId}/teams`)), getDocs(query(collection(db, "submissions"), where("eventId", "==", eventId)))]);
            checkpointsSnapshot.forEach(doc => batch.delete(doc.ref));
            teamsSnapshot.forEach(doc => batch.delete(doc.ref));
            submissionsSnapshot.forEach(doc => batch.delete(doc.ref));
            batch.delete(doc(db, "events", eventId));
            await batch.commit();
            showModal("Successo", `Evento "${eventName}" eliminato.`);
        } catch (error) { showModal("Errore", "Eliminazione fallita: " + error.message); }
    });
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
let unsubscribeDashboard;
async function setupDashboardListener() {
    if (unsubscribeDashboard) unsubscribeDashboard();
    const eventRef = doc(db, "events", currentEventId);
    unsubscribeDashboard = onSnapshot(eventRef, async () => {
        try {
            const [eventDoc, teamsSnapshot, checkpointsSnapshot, submissionsSnapshot] = await Promise.all([
                getDoc(eventRef),
                getDocs(collection(db, `events/${currentEventId}/teams`)),
                getDocs(query(collection(db, `events/${currentEventId}/checkpoints`), orderBy("number"))),
                getDocs(query(collection(db, "submissions"), where("eventId", "==", currentEventId)))
            ]);
            const eventData = eventDoc.data();
            renderOrganizerUI(
                eventData,
                teamsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })),
                checkpointsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })),
                submissionsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))
            );
        } catch (error) { showModal("Errore Dashboard", "Impossibile caricare i dati: " + error.message); }
    });
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
            const eventStartTime = eventData.startTime?.toDate();
            if (eventStartTime && checkpoint.timeBonus > 0) {
                const submissionTime = sub.timestamp.toDate();
                const timeDiffMinutes = (submissionTime - eventStartTime) / 60000;
                if (timeDiffMinutes <= checkpoint.timeBonus) {
                    teamScores[sub.teamId].score += (checkpoint.bonusPoints || 0);
                }
            }
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

    const galleryBtn = document.getElementById('galleryBtn');
    galleryBtn.disabled = eventData.status !== 'finished';
    galleryBtn.title = eventData.status !== 'finished' ? "Disponibile al termine della gara" : "Vedi galleria foto";
    galleryBtn.classList.toggle('opacity-50', eventData.status !== 'finished');
    galleryBtn.classList.toggle('cursor-not-allowed', eventData.status !== 'finished');

    lucide.createIcons();
}

document.getElementById('exportCsvBtn').addEventListener('click', () => { /* ... unchanged ... */ });
document.getElementById('backToOrganizerHome').addEventListener('click', () => { if (unsubscribeDashboard) unsubscribeDashboard(); currentEventId = null; showView('organizerHomeView'); });

document.getElementById('startEventBtn').addEventListener('click', () => {
    showModal("Conferma Avvio", "Sei sicuro di voler avviare la gara? Verrà registrato l'orario di inizio per i bonus a tempo.", true, async () => {
        if (!currentEventId) return;
        await updateDoc(doc(db, "events", currentEventId), { status: 'active', startTime: new Date() });
        showModal("Successo", "Evento avviato!");
    });
});
document.getElementById('finishEventBtn').addEventListener('click', () => {
    showModal("Conferma Termine", "Sei sicuro di voler terminare la gara?", true, async () => {
        if (!currentEventId) return;
        await updateDoc(doc(db, "events", currentEventId), { status: 'finished' });
        showModal("Successo", "Evento terminato!");
    });
});

document.getElementById('galleryBtn').addEventListener('click', async () => {
    const galleryGrid = document.getElementById('galleryGrid');
    galleryGrid.innerHTML = '<i data-lucide="loader-2" class="w-16 h-16 animate-spin text-indigo-600 mx-auto col-span-full"></i>';
    lucide.createIcons();
    showView('galleryView');
    try {
        const teamsQuery = collection(db, `events/${currentEventId}/teams`);
        const checkpointsQuery = query(collection(db, `events/${currentEventId}/checkpoints`));
        const submissionsQuery = query(collection(db, "submissions"), where("eventId", "==", currentEventId), orderBy("timestamp", "desc"));

        const [teamsSnapshot, checkpointsSnapshot, submissionsSnapshot] = await Promise.all([getDocs(teamsQuery), getDocs(checkpointsQuery), getDocs(submissionsQuery)]);

        const teamsMap = new Map();
        teamsSnapshot.forEach(doc => teamsMap.set(doc.id, doc.data().name));
        const checkpointsMap = new Map();
        checkpointsSnapshot.forEach(doc => checkpointsMap.set(doc.id, doc.data().number));

        galleryGrid.innerHTML = '';
        if (submissionsSnapshot.empty) {
            galleryGrid.innerHTML = '<p class="col-span-full text-center">Nessuna foto inviata durante questo evento.</p>';
            return;
        }
        submissionsSnapshot.forEach(doc => {
            const sub = doc.data();
            const checkpointNumber = checkpointsMap.get(sub.checkpointId) || '?';
            const teamName = teamsMap.get(sub.teamId) || 'Squadra Sconosciuta';
            const imgCard = document.createElement('div');
            imgCard.className = 'bg-white p-2 rounded-lg shadow-md';
            imgCard.innerHTML = `<img src="${sub.photoUrl}" class="w-full h-48 object-cover rounded-md" alt="Foto di squadra"><div class="mt-1 text-xs"><p class="font-semibold text-gray-800">${teamName}</p><p class="text-gray-500">Punto #${checkpointNumber}</p></div>`;
            galleryGrid.appendChild(imgCard);
        });
    } catch (error) {
        galleryGrid.innerHTML = '';
        showModal("Errore Galleria", "Impossibile caricare le foto. Potrebbe mancare un indice nel database. Controlla la console per sviluppatori (CTRL+SHIFT+I) per un link per crearlo. Dettagli: " + error.message);
    }
});
document.getElementById('backToDashboardFromGallery').addEventListener('click', () => showView('organizerDashboardView'));

document.getElementById('joinEventForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
        const joinCode = document.getElementById('joinCode').value.toUpperCase();
        const teamName = document.getElementById('teamName').value;
        const q = query(collection(db, "events"), where("joinCode", "==", joinCode));
        const eventSnapshot = await getDocs(q);
        if (eventSnapshot.empty) { throw new Error("Codice evento non valido."); }

        currentEventId = eventSnapshot.docs[0].id;
        const eventData = eventSnapshot.docs[0].data();

        if (eventData.status === 'finished') { throw new Error("Questo evento è già concluso."); }

        await setDoc(doc(db, `events/${currentEventId}/teams`, currentUserId), { name: teamName }, { merge: true });

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
    if (eventDoc.exists() && eventDoc.data().status === 'finished') {
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
        if (teamDoc.exists()) { document.getElementById('participant-team-name-display').textContent = `Squadra: ${teamDoc.data().name}`; }
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
    const submitButton = submissionForm.querySelector('button[type="submit"]');
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
            const photoRef = ref(storage, `submissions/${currentEventId}/${teamId}_${checkpointId}.jpg`);
            await deleteDoc(submissionRef);
            await deleteObject(photoRef);
            showModal("Successo", "Risposta cancellata. Ora puoi inviarne una nuova.");
            showView('participantView');
        } catch (error) { showModal("Errore", "Cancellazione fallita: " + error.message); }
    });
}
document.getElementById('backToGrid').addEventListener('click', () => showView('participantView'));
document.getElementById('submissionForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitButton = submissionForm.querySelector('button[type="submit"]');
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
        await addDoc(collection(db, "submissions"), { eventId: currentEventId, teamId, checkpointId, answer, photoUrl, timestamp: new Date() });
        showModal("Successo", "Risposta inviata con successo!");
        showView('participantView');
    } catch (error) { showModal("Errore", "Invio fallito: " + error.message); submitButton.disabled = false; submitButton.textContent = 'Invia Risposta'; }
});
function showSubmissionDetail(submission, checkpoint, isCorrect, team) {
    document.getElementById('organizerDetailContent').innerHTML = `<p><strong>Squadra:</strong> ${team.name}</p><p><strong>Risposta Data:</strong> ${submission.answer}</p><p><strong>Risposta Corretta:</strong> ${checkpoint.correctAnswer}</p><p><strong>Punteggio Assegnato:</strong> ${isCorrect ? (checkpoint.points || 0) : 0}</p><p class="mt-4"><strong>Foto:</strong></p><img src="${submission.photoUrl}" alt="Foto sottomessa" class="mt-2 rounded-lg w-full max-w-lg">`;
    showView('organizerDetailView');
}
document.getElementById('backToOrganizer').addEventListener('click', () => showView('organizerDashboardView'));
document.getElementById('manageCpBtn').addEventListener('click', () => initOrganizerAdmin());
document.getElementById('manageTeamsBtn').addEventListener('click', () => initOrganizerTeamsView());
async function initOrganizerTeamsView() {
    showView('organizerTeamsView');
    const teamsList = document.getElementById('teamsList');
    onSnapshot(query(collection(db, `events/${currentEventId}/teams`)), (snapshot) => {
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
    showView('organizerAdminView');
    const checkpointsList = document.getElementById('checkpointsList');
    const checkpointsQuery = query(collection(db, `events/${currentEventId}/checkpoints`), orderBy("number"));
    onSnapshot(checkpointsQuery, (snapshot) => {
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
    form.timeBonus.value = data.timeBonus || '';
    form.bonusPoints.value = data.bonusPoints || '';
    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.textContent = 'Salva Modifiche';
    submitBtn.classList.replace('bg-green-600', 'bg-yellow-500');
    submitBtn.classList.replace('hover:bg-green-700', 'hover:bg-yellow-600');
    document.getElementById('cancelEditBtn').classList.remove('hidden');
}
function resetCheckpointForm() {
    const form = document.getElementById('addCheckpointForm');
    form.reset(); document.getElementById('editCheckpointId').value = '';
    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.textContent = 'Aggiungi Punto';
    submitBtn.classList.replace('bg-yellow-500', 'bg-green-600');
    submitBtn.classList.replace('hover:bg-yellow-600', 'hover:bg-green-700');
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
        points: parseInt(form.points.value),
        timeBonus: parseInt(form.timeBonus.value) || 0,
        bonusPoints: parseInt(form.bonusPoints.value) || 0
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
    } catch (error) { showModal("Errore", "Salvataggio fallito: " + error.message); }
});
document.getElementById('backToDashboardBtn').addEventListener('click', () => showView('organizerDashboardView'));

showView('loadingView');
lucide.createIcons();