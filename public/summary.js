/* ============================================
   EchoScribe — Summary Page Logic (Dual Mode)
   Supports Therapy (SOAP) and Mentoring (GROW)
   ============================================ */

(function () {
    'use strict';

    // --- Auth Guard ---
    EchoAuth.guard();

    // --- Theme ---
    function initTheme() {
        const saved = localStorage.getItem('echoscribe_theme') || 'dark';
        document.documentElement.setAttribute('data-theme', saved);
        const toggle = document.getElementById('theme-toggle');
        if (toggle) toggle.textContent = saved === 'dark' ? '🌙' : '☀️';
    }
    function toggleTheme() {
        const current = document.documentElement.getAttribute('data-theme');
        const next = current === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem('echoscribe_theme', next);
        const toggle = document.getElementById('theme-toggle');
        if (toggle) toggle.textContent = next === 'dark' ? '🌙' : '☀️';
    }
    initTheme();

    // --- Mode Detection ---
    const isMentoring = typeof EchoMode !== 'undefined' && EchoMode.getMode() === 'mentoring';
    const currentMode = isMentoring ? 'Mentoring' : 'Therapy';

    // --- DOM Refs ---
    // SOAP
    const soapSubjective = document.getElementById('soap-subjective');
    const soapObjective = document.getElementById('soap-objective');
    const soapAssessment = document.getElementById('soap-assessment');
    const soapPlan = document.getElementById('soap-plan');
    // GROW
    const growGoal = document.getElementById('grow-goal');
    const growReality = document.getElementById('grow-reality');
    const growOptions = document.getElementById('grow-options');
    const growWayforward = document.getElementById('grow-wayforward');
    // Sections
    const soapSection = document.getElementById('soap-section');
    const growSection = document.getElementById('grow-section');
    // Risk
    const riskBanner = document.getElementById('risk-banner');
    const riskIcon = document.getElementById('risk-icon');
    const riskText = document.getElementById('risk-text');
    const riskSI = document.getElementById('risk-si');
    const riskSHLevel = document.getElementById('risk-sh-level');
    const riskNotes = document.getElementById('risk-notes');
    // Confidence
    const confidenceFill = document.getElementById('confidence-fill');
    const confidenceValue = document.getElementById('confidence-value');
    // Lists
    const diagnosticList = document.getElementById('diagnostic-list');
    const interventionsPills = document.getElementById('interventions-pills');
    const medicationList = document.getElementById('medication-list');
    const progressList = document.getElementById('progress-list');
    // Stats
    const statWords = document.getElementById('stat-words');
    const statDuration = document.getElementById('stat-duration');
    const statTopics = document.getElementById('stat-topics');
    const statSentiment = document.getElementById('stat-sentiment');
    // Topics
    const topicsSection = document.getElementById('topics-section');
    const topicsPills = document.getElementById('topics-pills');
    // Transcript
    const originalTranscript = document.getElementById('original-transcript');
    // Buttons
    const btnCopySummary = document.getElementById('btn-copy-summary');
    const btnSave = document.getElementById('btn-save');
    const btnExportPdf = document.getElementById('btn-export-pdf');
    const btnExportCsv = document.getElementById('btn-export-csv');
    const btnExportJson = document.getElementById('btn-export-json');
    const btnAnalyzeProfile = document.getElementById('btn-analyze-profile');
    const btnLogout = document.getElementById('btn-logout');
    const btnInsights = document.getElementById('btn-insights');
    // History & Modal
    const historyList = document.getElementById('history-list');
    const profileModal = document.getElementById('profile-modal');
    const modalClose = document.getElementById('modal-close');
    const modalContent = document.getElementById('modal-content');
    // Card
    const cardName = document.getElementById('card-name');
    const cardLvl = document.getElementById('card-lvl');
    const cardProblem = document.getElementById('card-problem');
    const cardReason = document.getElementById('card-reason');
    const cardProgress = document.getElementById('card-progress');
    const cardMood = document.getElementById('card-mood');
    const cardAvatar = document.getElementById('card-avatar');
    // Toast
    const toast = document.getElementById('toast');
    const toastMessage = document.getElementById('toast-message');
    let toastTimeout = null;
    let lastSavedSessionId = localStorage.getItem('echoscribe_session_id') || null;
    let fullPatientData = null;

    // --- Active Patient for Insights ---
    const activePatientData = localStorage.getItem('echoscribe_active_patient');
    const activePatient = activePatientData ? JSON.parse(activePatientData) : null;
    if (activePatient && btnInsights) {
        btnInsights.href = `/patient.html?id=${activePatient.id}`;
        btnInsights.style.display = 'inline-flex';
    }

    // --- Mode-Aware UI Setup ---
    const pageTitle = document.getElementById('page-title');
    const copyLabel = document.getElementById('copy-label');
    const diagnosticTitle = document.getElementById('diagnostic-title');
    const interventionsTitle = document.getElementById('interventions-title');
    const progressTitle = document.getElementById('progress-title');
    const medicationCard = document.getElementById('medication-card');
    const cardFooter = document.getElementById('card-footer');
    const labelProblem = document.getElementById('label-problem');
    const labelReason = document.getElementById('label-reason');
    const riskLabel1 = document.getElementById('risk-label-1');
    const riskLabel2 = document.getElementById('risk-label-2');
    const compositionTitle = document.getElementById('composition-title');

    if (isMentoring) {
        pageTitle.textContent = 'Academic Mentoring GROW Note';
        document.querySelector('.summary-page-icon').textContent = '🎓';
        copyLabel.textContent = 'Copy GROW';
        diagnosticTitle.textContent = 'Key Observations';
        interventionsTitle.textContent = 'Skills & Focus Areas';
        progressTitle.textContent = 'Action Items';
        if (medicationCard) medicationCard.style.display = 'none';
        soapSection.style.display = 'none';
        growSection.style.display = 'block';
        cardFooter.textContent = '"Growth begins at the edge of your comfort zone."';
        labelProblem.textContent = 'Challenge';
        labelReason.textContent = 'Objective';
        riskLabel1.textContent = 'Academic Burnout:';
        riskLabel2.textContent = 'Severe Distress:';
        compositionTitle.textContent = 'GROW Composition';
    } else {
        soapSection.style.display = 'block';
        growSection.style.display = 'none';
    }

    // --- Load Data ---
    const raw = localStorage.getItem('echoscribe_summary');
    if (!raw) { window.location.href = '/record.html'; return; }

    let data;
    try { data = JSON.parse(raw); } catch (e) { window.location.href = '/record.html'; return; }

    // --- Fetch full patient data for communications ---
    async function fetchFullPatientData() {
        if (!activePatient || !activePatient.id) return;
        try {
            const res = await EchoAuth.authFetch(`/api/patients/${activePatient.id}?mode=${currentMode}`);
            if (res.ok) {
                fullPatientData = await res.json();
                if (fullPatientData.email || fullPatientData.phone) {
                    const sendBtn = document.getElementById('btn-send-patient-instructions');
                    if (sendBtn) sendBtn.style.display = 'block';
                }
            }
        } catch (err) {
            console.error('Failed to fetch full patient data:', err);
        }
    }
    fetchFullPatientData();

    // --- Render SOAP or GROW ---
    if (isMentoring) {
        const grow = data.grow || {};
        growGoal.textContent = grow.goal || 'Not documented';
        growReality.textContent = grow.reality || 'Not documented';
        growOptions.textContent = grow.options || 'Not documented';
        growWayforward.textContent = grow.way_forward || 'Not documented';
    } else {
        const soap = data.soap || {};
        soapSubjective.textContent = soap.subjective || 'Not documented';
        soapObjective.textContent = soap.objective || 'Not documented';
        soapAssessment.textContent = soap.assessment || 'Not documented';
        soapPlan.textContent = soap.plan || 'Not documented';

        // Backward compatibility: legacy summary format
        if (!data.soap && data.summary) {
            soapSubjective.textContent = data.summary;
            soapObjective.textContent = data.analysis || 'N/A';
            soapAssessment.textContent = data.sentimentExplanation || 'N/A';
            soapPlan.textContent = 'Upgrade to SOAP format for full clinical notes.';
        }
    }

    // --- Risk Assessment ---
    const risk = data.risk_assessment || {};
    if (isMentoring) {
        const burnout = risk.academic_burnout;
        const distressLevel = (risk.severe_distress_risk || 'low').toLowerCase();

        if (burnout || distressLevel === 'high') {
            riskBanner.style.display = 'flex';
            riskBanner.className = 'risk-banner risk-high';
            riskIcon.textContent = '🚨';
            riskText.textContent = 'HIGH DISTRESS — Immediate attention recommended';
        } else if (distressLevel === 'moderate') {
            riskBanner.style.display = 'flex';
            riskBanner.className = 'risk-banner risk-moderate';
            riskIcon.textContent = '⚠️';
            riskText.textContent = 'MODERATE DISTRESS — Monitor closely';
        }

        riskSI.textContent = burnout ? 'YES' : 'No';
        riskSI.className = 'risk-badge ' + (burnout ? 'risk-badge-high' : 'risk-badge-low');
        riskSHLevel.textContent = distressLevel.charAt(0).toUpperCase() + distressLevel.slice(1);
        riskSHLevel.className = 'risk-badge risk-badge-' + distressLevel;
    } else {
        const riskLevel = (risk.self_harm_risk || 'low').toLowerCase();

        if (riskLevel === 'high' || risk.suicidal_ideation) {
            riskBanner.style.display = 'flex';
            riskBanner.className = 'risk-banner risk-high';
            riskIcon.textContent = '🚨';
            riskText.textContent = 'HIGH RISK — Immediate attention recommended';
        } else if (riskLevel === 'moderate') {
            riskBanner.style.display = 'flex';
            riskBanner.className = 'risk-banner risk-moderate';
            riskIcon.textContent = '⚠️';
            riskText.textContent = 'MODERATE RISK — Monitor closely';
        }

        riskSI.textContent = risk.suicidal_ideation ? 'YES' : 'No';
        riskSI.className = 'risk-badge ' + (risk.suicidal_ideation ? 'risk-badge-high' : 'risk-badge-low');
        riskSHLevel.textContent = riskLevel.charAt(0).toUpperCase() + riskLevel.slice(1);
        riskSHLevel.className = 'risk-badge risk-badge-' + riskLevel;
    }
    riskNotes.textContent = risk.notes || 'No additional notes.';

    // --- Confidence Score ---
    const confidence = Math.round((data.confidence_score || 0) * 100);
    confidenceFill.style.width = confidence + '%';
    confidenceValue.textContent = confidence + '%';
    if (confidence >= 80) confidenceFill.style.background = 'linear-gradient(90deg, #00e676, #69f0ae)';
    else if (confidence >= 50) confidenceFill.style.background = 'linear-gradient(90deg, #ffc107, #ffca28)';
    else confidenceFill.style.background = 'linear-gradient(90deg, #ff4d6a, #ff6b8a)';

    // --- Diagnostic Impressions / Key Observations ---
    const diagnostics = data.diagnostic_impressions || [];
    if (diagnostics.length > 0) {
        diagnosticList.innerHTML = '';
        diagnostics.forEach(d => {
            const li = document.createElement('li');
            li.textContent = d;
            diagnosticList.appendChild(li);
        });
    } else {
        diagnosticList.innerHTML = `<li>${isMentoring ? 'No key observations noted.' : 'No diagnostic impressions noted.'}</li>`;
    }

    // --- Interventions / Skills ---
    const interventions = data.interventions_used || [];
    interventionsPills.innerHTML = '';
    if (interventions.length > 0) {
        interventions.forEach(i => {
            const pill = document.createElement('span');
            pill.className = 'topic-pill';
            pill.textContent = i;
            interventionsPills.appendChild(pill);
        });
    } else {
        interventionsPills.innerHTML = '<span style="color:#718096; font-style:italic;">None identified</span>';
    }

    // --- Medication Changes (Therapy only) ---
    if (!isMentoring) {
        const meds = data.medication_changes || [];
        if (meds.length > 0 && !(meds.length === 1 && meds[0].toLowerCase().includes('none'))) {
            medicationList.innerHTML = '';
            meds.forEach(m => {
                const li = document.createElement('li');
                li.textContent = m;
                medicationList.appendChild(li);
            });
        } else {
            medicationList.innerHTML = '<li>No medication changes discussed.</li>';
        }
    }

    // --- Progress Indicators / Action Items ---
    const progress = data.progress_indicators || [];
    if (progress.length > 0) {
        progressList.innerHTML = '';
        progress.forEach(p => {
            const li = document.createElement('li');
            li.textContent = p;
            progressList.appendChild(li);
        });
    } else {
        progressList.innerHTML = `<li>${isMentoring ? 'No action items noted.' : 'No specific progress indicators noted.'}</li>`;
    }

    // --- Auto-Booking ---
    const booking = data.auto_booking || {};
    const bookingNeeded = document.getElementById('booking-needed');
    if (bookingNeeded) {
        bookingNeeded.textContent = booking.needs_follow_up ? 'Yes' : 'No';
        bookingNeeded.style.background = booking.needs_follow_up ? 'rgba(237, 100, 166, 0.2)' : 'rgba(255, 255, 255, 0.1)';
        bookingNeeded.style.color = booking.needs_follow_up ? '#ed64a6' : '#fff';
        document.getElementById('booking-timeframe').textContent = booking.suggested_timeframe || 'None';
        document.getElementById('booking-reason').textContent = booking.reason || 'No follow-up discussed.';
        if (booking.needs_follow_up) {
            document.getElementById('btn-create-booking').style.display = 'block';
            document.getElementById('btn-reschedule-booking').style.display = 'block';
        }
    }

    // --- Referral ---
    const referral = data.referral_form || {};
    const referralNeeded = document.getElementById('referral-needed');
    if (referralNeeded) {
        referralNeeded.textContent = referral.referral_needed ? 'Yes' : 'No';
        referralNeeded.style.background = referral.referral_needed ? 'rgba(237, 100, 166, 0.2)' : 'rgba(255, 255, 255, 0.1)';
        referralNeeded.style.color = referral.referral_needed ? '#ed64a6' : '#fff';
        document.getElementById('referral-specialty').textContent = referral.specialty_or_service || 'None';
        document.getElementById('referral-reason').textContent = referral.reason || 'No referral necessary.';
        if (referral.referral_needed) document.getElementById('btn-create-referral').style.display = 'block';
    }

    // --- Patient Communication ---
    const comm = data.patient_communication || {};
    const commEnglish = document.getElementById('comm-english');
    if (commEnglish) {
        commEnglish.textContent = comm.instructions_english || 'None generated.';
        document.getElementById('comm-translated').textContent = comm.instructions_translated || 'None generated.';
    }

    // --- Emotional Tone & Stats ---
    const tone = data.emotional_tone || data.sentiment || 'neutral';
    const toneConfig = {
        positive: { emoji: '😊', color: '#00e676', bg: 'rgba(0, 230, 118, 0.15)' },
        negative: { emoji: '😟', color: '#ff4d6a', bg: 'rgba(255, 77, 106, 0.15)' },
        neutral: { emoji: '😐', color: '#8892b0', bg: 'rgba(136, 146, 176, 0.15)' },
        mixed: { emoji: '🤔', color: '#ffc107', bg: 'rgba(255, 193, 7, 0.15)' },
        anxious: { emoji: '😰', color: '#ffa726', bg: 'rgba(255, 167, 38, 0.15)' },
        hopeful: { emoji: '🌟', color: '#4fc3f7', bg: 'rgba(79, 195, 247, 0.15)' },
        frustrated: { emoji: '😤', color: '#ef5350', bg: 'rgba(239, 83, 80, 0.15)' },
        sad: { emoji: '😢', color: '#7986cb', bg: 'rgba(121, 134, 203, 0.15)' },
        motivated: { emoji: '🔥', color: '#ff7043', bg: 'rgba(255, 112, 67, 0.15)' },
        curious: { emoji: '🧐', color: '#26c6da', bg: 'rgba(38, 198, 218, 0.15)' },
    };
    const toneLower = tone.toLowerCase();
    const tc = toneConfig[toneLower] || toneConfig.neutral;
    statSentiment.textContent = tc.emoji + ' ' + tone.charAt(0).toUpperCase() + tone.slice(1);
    statSentiment.style.background = tc.bg;
    statSentiment.style.color = tc.color;

    // --- Stats ---
    const wc = data.wordCount || 0;
    statWords.textContent = wc.toLocaleString();
    const minutes = Math.floor(wc / 150);
    const seconds = Math.round((wc % 150) / 2.5);
    statDuration.textContent = minutes > 0 ? minutes + 'm ' + seconds + 's' : seconds + 's';

    // --- Topics ---
    const topics = data.topics || data.topicsDetected || [];
    if (topics.length > 0) {
        topicsSection.style.display = 'block';
        statTopics.textContent = topics.length;
        topicsPills.innerHTML = '';
        topics.forEach(t => {
            const pill = document.createElement('span');
            pill.className = 'topic-pill';
            pill.textContent = t;
            topicsPills.appendChild(pill);
        });
    } else {
        statTopics.textContent = '0';
    }

    // --- Counseling / Mentee Card ---
    const stats = data.counselingStats || {};
    cardName.textContent = stats.name !== 'Unknown' ? stats.name : (activePatient ? activePatient.name : 'Client');
    cardLvl.textContent = Math.floor(wc / 100) + 1;
    cardProblem.textContent = stats.presentingProblem || (isMentoring ? 'N/A' : 'N/A');
    cardReason.textContent = stats.reasonForCounseling || (isMentoring ? 'N/A' : 'N/A');
    cardProgress.textContent = stats.lastMajorProgress || 'None yet';
    cardMood.textContent = stats.currentEmotionalState || 'Neutral';

    const avatars = {
        'Anxious': '😰', 'Hopeful': '🌟', 'Frustrated': '😤', 'Happy': '😊',
        'Sad': '😢', 'Confused': '😵', 'Neutral': '👤', 'Angry': '😠',
        'Motivated': '🔥', 'Curious': '🧐',
    };
    let avatar = '👤';
    const emotion = (stats.currentEmotionalState || '').toLowerCase();
    if (emotion.includes('anx')) avatar = avatars['Anxious'];
    else if (emotion.includes('hope')) avatar = avatars['Hopeful'];
    else if (emotion.includes('frust')) avatar = avatars['Frustrated'];
    else if (emotion.includes('hap') || emotion.includes('joy')) avatar = avatars['Happy'];
    else if (emotion.includes('sad')) avatar = avatars['Sad'];
    else if (emotion.includes('ang')) avatar = avatars['Angry'];
    else if (emotion.includes('motiv')) avatar = avatars['Motivated'];
    else if (emotion.includes('curio')) avatar = avatars['Curious'];
    cardAvatar.textContent = avatar;

    // --- Charts ---
    renderCharts(data);

    // --- Original Transcript ---
    let originalText = data.originalText || data.diarizedTranscript || 'No original text available.';
    if (activePatient && activePatient.name) {
        const roleToReplace = isMentoring ? /\bMentee:/g : /\bPatient:/g;
        originalText = originalText.replace(roleToReplace, `${activePatient.name}:`);
    }
    originalTranscript.textContent = originalText;

    // --- History ---
    fetchHistory();

    // ==================
    // EVENT LISTENERS
    // ==================

    // Theme toggle
    const themeToggle = document.getElementById('theme-toggle');
    if (themeToggle) themeToggle.addEventListener('click', toggleTheme);
    if (btnLogout) btnLogout.addEventListener('click', () => EchoAuth.logout());

    // Copy Note (SOAP or GROW)
    if (btnCopySummary) {
        btnCopySummary.addEventListener('click', function () {
            let copyText = '';
            if (isMentoring) {
                copyText = '🎓 ECHOSCRIBE — ACADEMIC GROW NOTE\n';
                copyText += '='.repeat(40) + '\n\n';
                copyText += '🎯 GOAL:\n' + (growGoal.innerText || '') + '\n\n';
                copyText += '🌍 REALITY:\n' + (growReality.innerText || '') + '\n\n';
                copyText += '🛤️ OPTIONS:\n' + (growOptions.innerText || '') + '\n\n';
                copyText += '🚀 WAY FORWARD:\n' + (growWayforward.innerText || '') + '\n\n';
                const distress = (risk.severe_distress_risk || 'low');
                copyText += '🛡️ RISK: Burnout=' + (risk.academic_burnout ? 'YES' : 'No') + ', Distress=' + distress + '\n';
            } else {
                copyText = '🩺 ECHOSCRIBE — CLINICAL SOAP NOTE\n';
                copyText += '='.repeat(40) + '\n\n';
                copyText += '📝 SUBJECTIVE:\n' + (soapSubjective.innerText || '') + '\n\n';
                copyText += '🔍 OBJECTIVE:\n' + (soapObjective.innerText || '') + '\n\n';
                copyText += '📊 ASSESSMENT:\n' + (soapAssessment.innerText || '') + '\n\n';
                copyText += '📋 PLAN:\n' + (soapPlan.innerText || '') + '\n\n';
                const riskLevel = (risk.self_harm_risk || 'low');
                copyText += '🛡️ RISK: Self-harm=' + riskLevel + ', SI=' + (risk.suicidal_ideation ? 'YES' : 'No') + '\n';
            }
            copyText += '💡 Emotional Tone: ' + tone + '\n';
            copyText += '📊 Words: ' + wc + ' | Confidence: ' + confidence + '%\n';

            navigator.clipboard.writeText(copyText).then(function () {
                showToast('✅ Note copied to clipboard!');
            }).catch(function () {
                showToast('⚠️ Failed to copy');
            });
        });
    }

    // Save Session
    if (btnSave) {
        btnSave.addEventListener('click', async function () {
            btnSave.disabled = true;
            btnSave.innerHTML = '<span class="btn-icon">⏳</span> Saving...';

            // Update data with potential edits
            if (isMentoring) {
                if (!data.grow) data.grow = {};
                data.grow.goal = growGoal.innerText || '';
                data.grow.reality = growReality.innerText || '';
                data.grow.options = growOptions.innerText || '';
                data.grow.way_forward = growWayforward.innerText || '';
            } else {
                if (!data.soap) data.soap = {};
                data.soap.subjective = soapSubjective.innerText || '';
                data.soap.objective = soapObjective.innerText || '';
                data.soap.assessment = soapAssessment.innerText || '';
                data.soap.plan = soapPlan.innerText || '';
            }

            try {
                const summaryField = isMentoring
                    ? (data.grow?.goal || '')
                    : (data.soap?.subjective || data.summary || '');

                const body = {
                    transcript: originalText,
                    summary: summaryField,
                    analysisJson: data,
                    mode: currentMode,
                };
                if (activePatient) body.patientId = activePatient.id;

                const response = await EchoAuth.authFetch('/api/session', {
                    method: 'POST',
                    body: JSON.stringify(body),
                });

                if (response.ok) {
                    const result = await response.json();
                    lastSavedSessionId = result.data?.[0]?.id;
                    if (lastSavedSessionId) {
                        localStorage.setItem('echoscribe_session_id', lastSavedSessionId);
                    }
                    showToast('✅ Session Saved!');
                    fetchHistory();
                } else {
                    throw new Error('Save failed');
                }
            } catch (err) {
                showToast('❌ Failed to save session.');
                console.error(err);
            } finally {
                btnSave.innerHTML = '<span class="btn-icon">💾</span> Save Session';
                btnSave.disabled = false;
            }
        });
    }

    // Export PDF
    if (btnExportPdf) {
        btnExportPdf.addEventListener('click', async function () {
            if (!lastSavedSessionId) {
                showToast('💾 Please save the session first to export PDF.');
                return;
            }
            try {
                btnExportPdf.disabled = true;
                btnExportPdf.innerHTML = '<span class="btn-icon">⏳</span> Generating...';
                const response = await EchoAuth.authFetch(`/api/export/pdf/${lastSavedSessionId}`);
                if (!response.ok) throw new Error('PDF export failed');
                const blob = await response.blob();
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `echoscribe-session-${lastSavedSessionId}.pdf`;
                a.click();
                URL.revokeObjectURL(url);
                showToast('📄 PDF exported!');
            } catch (err) {
                showToast('❌ PDF export failed.');
                console.error(err);
            } finally {
                btnExportPdf.innerHTML = '<span class="btn-icon">📄</span> Export PDF';
                btnExportPdf.disabled = false;
            }
        });
    }

    // Export CSV
    if (btnExportCsv) {
        btnExportCsv.addEventListener('click', async function () {
            try {
                const response = await EchoAuth.authFetch('/api/export/csv');
                if (!response.ok) throw new Error('CSV export failed');
                const blob = await response.blob();
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'echoscribe-sessions.csv';
                a.click();
                URL.revokeObjectURL(url);
                showToast('📊 CSV exported!');
            } catch (err) {
                showToast('❌ CSV export failed.');
                console.error(err);
            }
        });
    }

    // Export JSON
    if (btnExportJson) {
        btnExportJson.addEventListener('click', async function () {
            try {
                const response = await EchoAuth.authFetch('/api/export/record');
                if (!response.ok) throw new Error('JSON export failed');
                const blob = await response.blob();
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'echoscribe-full-record.json';
                a.click();
                URL.revokeObjectURL(url);
                showToast('📁 JSON exported!');
            } catch (err) {
                showToast('❌ JSON export failed.');
                console.error(err);
            }
        });
    }

    // Analyze Profile — Modal
    if (btnAnalyzeProfile) {
        btnAnalyzeProfile.addEventListener('click', async function () {
            btnAnalyzeProfile.disabled = true;
            btnAnalyzeProfile.textContent = 'Analyzing...';
            profileModal.classList.add('active');
            modalContent.innerHTML = '<p style="color:#a0aec0; text-align:center; padding:2rem;">⏳ Generating longitudinal analysis...</p>';

            try {
                const response = await EchoAuth.authFetch(`/api/profile?mode=${currentMode}`);
                const profileData = await response.json();

                if (response.ok) {
                    renderProfileModal(profileData);
                } else {
                    modalContent.innerHTML = `<p style="color:#ff6b8a;">Analysis failed: ${profileData.error || profileData.message}</p>`;
                }
            } catch (err) {
                console.error(err);
                modalContent.innerHTML = '<p style="color:#ff6b8a;">Failed to analyze profile. Please try again.</p>';
            } finally {
                btnAnalyzeProfile.textContent = 'Analyze Profile';
                btnAnalyzeProfile.disabled = false;
            }
        });
    }

    // Modal close
    if (modalClose) modalClose.addEventListener('click', () => profileModal.classList.remove('active'));
    if (profileModal) profileModal.addEventListener('click', (e) => {
        if (e.target === profileModal) profileModal.classList.remove('active');
    });

    // ==================
    // HELPER FUNCTIONS
    // ==================

    function renderCharts(data) {
        const topics = data.topics || data.topicsDetected || [];
        const chartColors = ['#6c63ff', '#a78bfa', '#f472b6', '#4fd1c5', '#ffc107', '#00e676', '#ff4d6a', '#8892b0'];

        // Topics Chart
        const ctxTopics = document.getElementById('topicsChart').getContext('2d');
        new Chart(ctxTopics, {
            type: 'bar',
            data: {
                labels: topics.length > 0 ? topics : ['No topics'],
                datasets: [{
                    label: 'Relevance',
                    data: topics.map(() => 1),
                    backgroundColor: topics.map((_, i) => chartColors[i % chartColors.length] + '99'),
                    borderColor: topics.map((_, i) => chartColors[i % chartColors.length]),
                    borderWidth: 1,
                    borderRadius: 6,
                }]
            },
            options: {
                responsive: true,
                plugins: { legend: { display: false } },
                scales: {
                    y: { beginAtZero: true, ticks: { display: false }, grid: { color: 'rgba(255,255,255,0.05)' } },
                    x: { ticks: { color: '#8892b0', font: { size: 10 } }, grid: { display: false } },
                },
            }
        });

        // Session Composition Doughnut (adapts for SOAP/GROW)
        const ctxSentiment = document.getElementById('sentimentChart').getContext('2d');
        let sections;
        if (isMentoring) {
            const grow = data.grow || {};
            sections = [
                { label: 'Goal', value: (grow.goal || '').split(' ').length },
                { label: 'Reality', value: (grow.reality || '').split(' ').length },
                { label: 'Options', value: (grow.options || '').split(' ').length },
                { label: 'Way Forward', value: (grow.way_forward || '').split(' ').length },
            ];
        } else {
            const soap = data.soap || {};
            sections = [
                { label: 'Subjective', value: (soap.subjective || '').split(' ').length },
                { label: 'Objective', value: (soap.objective || '').split(' ').length },
                { label: 'Assessment', value: (soap.assessment || '').split(' ').length },
                { label: 'Plan', value: (soap.plan || '').split(' ').length },
            ];
        }

        new Chart(ctxSentiment, {
            type: 'doughnut',
            data: {
                labels: sections.map(s => s.label),
                datasets: [{
                    data: sections.map(s => s.value || 1),
                    backgroundColor: ['#6c63ff', '#4fd1c5', '#f472b6', '#ffc107'],
                }]
            },
            options: {
                responsive: true,
                cutout: '70%',
                plugins: {
                    legend: { position: 'bottom', labels: { color: '#a0aec0', padding: 12, font: { size: 11 } } },
                },
            }
        });
    }

    function renderProfileModal(data) {
        const trend = data.emotional_trend || 'stable';
        const trendClasses = { improving: 'improving', stable: 'stable', declining: 'declining' };
        const trendEmojis = { improving: '📈', stable: '➡️', declining: '📉' };
        const score = data.treatment_effectiveness_score || 0;

        let scoreColor = '#ff4d6a';
        if (score >= 70) scoreColor = '#00e676';
        else if (score >= 40) scoreColor = '#ffc107';

        let html = '';
        const effectivenessLabel = isMentoring ? 'Mentoring Effectiveness' : 'Treatment Effectiveness';

        // Journey Summary
        html += `<div class="modal-section">
            <div class="modal-section-title">🗺️ ${isMentoring ? 'Mentee Journey' : 'Client Journey'}</div>
            <p class="modal-section-text">${data.journey_summary || 'Not enough data for journey analysis.'}</p>
        </div>`;

        // Emotional Trend
        html += `<div class="modal-section">
            <div class="modal-section-title">💡 Emotional Trend</div>
            <span class="modal-trend ${trendClasses[trend] || 'stable'}">
                ${trendEmojis[trend] || '➡️'} ${trend.charAt(0).toUpperCase() + trend.slice(1)}
            </span>
        </div>`;

        // Risk Trend
        if (data.risk_trend) {
            html += `<div class="modal-section">
                <div class="modal-section-title">🛡️ Risk Trend</div>
                <p class="modal-section-text">${data.risk_trend}</p>
            </div>`;
        }

        // Recurring Themes
        if (data.recurring_themes && data.recurring_themes.length > 0) {
            html += `<div class="modal-section">
                <div class="modal-section-title">🔄 Recurring Themes</div>
                <div class="modal-pills">
                    ${data.recurring_themes.map(t => `<span class="modal-pill">${t}</span>`).join('')}
                </div>
            </div>`;
        }

        // Persistent Challenges
        if (data.persistent_challenges) {
            html += `<div class="modal-section">
                <div class="modal-section-title">⚡ Persistent Challenges</div>
                <p class="modal-section-text">${data.persistent_challenges}</p>
            </div>`;
        }

        // Recommended Focus
        if (data.recommended_focus && data.recommended_focus.length > 0) {
            html += `<div class="modal-section">
                <div class="modal-section-title">🎯 Recommended Focus</div>
                <ul style="list-style:none; padding:0; display:flex; flex-direction:column; gap:0.4rem;">
                    ${data.recommended_focus.map(f => `<li style="color:#cbd5e0; font-size:0.9rem;">▸ ${f}</li>`).join('')}
                </ul>
            </div>`;
        }

        // Psychological/Academic Profile
        if (data.psychological_profile) {
            html += `<div class="modal-section">
                <div class="modal-section-title">🧠 ${isMentoring ? 'Academic Profile' : 'Psychological Profile'}</div>
                <p class="modal-section-text">${data.psychological_profile}</p>
            </div>`;
        }

        // Effectiveness Score
        html += `<div class="modal-section">
            <div class="modal-section-title">📊 ${effectivenessLabel}</div>
            <div class="modal-score">
                <div class="modal-score-bar">
                    <div class="modal-score-fill" style="width:${score}%; background:${scoreColor};"></div>
                </div>
                <span class="modal-score-label" style="color:${scoreColor};">${score}%</span>
            </div>
        </div>`;

        // Charts for trends
        if (data.emotional_trend_data || data.topic_frequency) {
            html += '<div class="modal-charts-grid">';
            if (data.emotional_trend_data && data.emotional_trend_data.length > 0) {
                html += `<div class="modal-chart-box">
                    <div class="modal-chart-title">Emotional Trend</div>
                    <canvas id="modalEmotionChart"></canvas>
                </div>`;
            }
            if (data.topic_frequency && data.topic_frequency.length > 0) {
                html += `<div class="modal-chart-box">
                    <div class="modal-chart-title">Topic Frequency</div>
                    <canvas id="modalTopicChart"></canvas>
                </div>`;
            }
            html += '</div>';
        }

        modalContent.innerHTML = html;

        // Render modal charts after DOM insertion
        setTimeout(() => {
            if (data.emotional_trend_data && data.emotional_trend_data.length > 0) {
                const ctx = document.getElementById('modalEmotionChart');
                if (ctx) {
                    new Chart(ctx, {
                        type: 'line',
                        data: {
                            labels: data.emotional_trend_data.map(d => 'S' + d.session),
                            datasets: [{
                                label: 'Emotional Score',
                                data: data.emotional_trend_data.map(d => d.score),
                                borderColor: '#a78bfa',
                                backgroundColor: 'rgba(167, 139, 250, 0.1)',
                                fill: true,
                                tension: 0.4,
                                pointRadius: 4,
                                pointBackgroundColor: '#a78bfa',
                            }]
                        },
                        options: {
                            responsive: true,
                            plugins: { legend: { display: false } },
                            scales: {
                                y: { ticks: { color: '#8892b0' }, grid: { color: 'rgba(255,255,255,0.05)' } },
                                x: { ticks: { color: '#8892b0' }, grid: { display: false } },
                            }
                        }
                    });
                }
            }
            if (data.topic_frequency && data.topic_frequency.length > 0) {
                const ctx = document.getElementById('modalTopicChart');
                if (ctx) {
                    new Chart(ctx, {
                        type: 'bar',
                        data: {
                            labels: data.topic_frequency.map(d => d.topic),
                            datasets: [{
                                data: data.topic_frequency.map(d => d.count),
                                backgroundColor: '#4fd1c599',
                                borderColor: '#4fd1c5',
                                borderWidth: 1,
                                borderRadius: 4,
                            }]
                        },
                        options: {
                            responsive: true,
                            indexAxis: 'y',
                            plugins: { legend: { display: false } },
                            scales: {
                                x: { ticks: { color: '#8892b0' }, grid: { color: 'rgba(255,255,255,0.05)' } },
                                y: { ticks: { color: '#8892b0', font: { size: 10 } }, grid: { display: false } },
                            }
                        }
                    });
                }
            }
        }, 100);
    }

    async function fetchHistory() {
        try {
            const response = await EchoAuth.authFetch(`/api/history?mode=${currentMode}`);
            const history = await response.json();

            if (history && history.length > 0) {
                historyList.innerHTML = '';
                history.forEach(item => {
                    const div = document.createElement('div');
                    div.className = 'session-item';
                    const date = new Date(item.created_at).toLocaleDateString();
                    const analysis = item.analysis_json || {};
                    const rk = isMentoring
                        ? (analysis.risk_assessment?.severe_distress_risk || 'low')
                        : (analysis.risk_assessment?.self_harm_risk || 'low');
                    const emo = analysis.counselingStats?.currentEmotionalState || analysis.emotional_tone || 'Unknown';

                    div.innerHTML = `
                        <div style="display:flex; justify-content:space-between; font-size:0.9rem; color:#e2e8f0; font-weight:600;">
                            <span>${date}</span>
                            <span style="display:flex; gap:0.5rem; align-items:center;">
                                <span class="risk-badge risk-badge-${rk}" style="font-size:0.7rem; padding:0.15rem 0.5rem;">${rk.toUpperCase()}</span>
                                <span>${emo}</span>
                            </span>
                        </div>
                        <div style="font-size:0.8rem; color:#a0aec0; margin-top:0.3rem;">
                            ${(item.summary || '').substring(0, 60)}...
                        </div>
                    `;
                    div.addEventListener('click', () => {
                        localStorage.setItem('echoscribe_summary', JSON.stringify(item.analysis_json));
                        lastSavedSessionId = item.id;
                        localStorage.setItem('echoscribe_session_id', item.id);
                        window.location.reload();
                    });
                    historyList.appendChild(div);
                });
            } else {
                historyList.innerHTML = '<p style="color:#718096; font-style:italic;">No saved sessions found.</p>';
            }
        } catch (err) {
            console.error('Failed to fetch history', err);
        }
    }

    // --- Communications ---
    async function sendCommsMessage(type, content) {
        if (!fullPatientData) {
            showToast('⚠️ No patient contact info available.');
            return;
        }

        const body = {
            patientId: fullPatientData.id,
            patientEmail: fullPatientData.email,
            patientPhone: fullPatientData.phone,
            type: type,
            content: content
        };

        try {
            const res = await EchoAuth.authFetch('/api/communications/send', {
                method: 'POST',
                body: JSON.stringify(body)
            });

            const result = await res.json();
            if (res.ok && result.success) {
                showToast(`✅ ${result.message}`);
            } else {
                showToast(`❌ ${result.message || 'Failed to send communication'}`);
            }
        } catch (err) {
            showToast(`❌ Error: ${err.message}`);
        }
    }

    // --- Communication Button Listeners ---
    const btnSendInstructions = document.getElementById('btn-send-patient-instructions');
    if (btnSendInstructions) {
        btnSendInstructions.addEventListener('click', () => {
            const english = document.getElementById('comm-english').textContent;
            const translated = document.getElementById('comm-translated').textContent;
            const content = `[English]\n${english}\n\n[Translated]\n${translated}`;
            sendCommsMessage('Patient Instructions', content);
        });
    }

    const btnCreateBooking = document.getElementById('btn-create-booking');
    if (btnCreateBooking) {
        btnCreateBooking.addEventListener('click', () => {
            const timeframe = document.getElementById('booking-timeframe').textContent;
            const reason = document.getElementById('booking-reason').textContent;
            const content = `Scheduled follow-up in ${timeframe}. Reason: ${reason}. Please let us know if you need to reschedule.`;
            sendCommsMessage('Follow-up Confirmation', content);
        });
    }

    const btnRescheduleBooking = document.getElementById('btn-reschedule-booking');
    if (btnRescheduleBooking) {
        btnRescheduleBooking.addEventListener('click', () => {
            const currentBooking = document.getElementById('booking-timeframe').textContent;
            const content = `Request to manage/reschedule follow-up (current: ${currentBooking}). Please contact our office.`;
            sendCommsMessage('Reschedule/Follow-up Management', content);
        });
    }

    const btnCreateReferral = document.getElementById('btn-create-referral');
    if (btnCreateReferral) {
        btnCreateReferral.addEventListener('click', () => {
            const specialty = document.getElementById('referral-specialty').textContent;
            const reason = document.getElementById('referral-reason').textContent;
            const content = `A referral form has been generated for ${specialty}. Reason: ${reason}.`;
            sendCommsMessage('Referral Notice', content);
        });
    }

    function showToast(message) {
        toastMessage.textContent = message;
        toast.style.display = 'block';
        toast.offsetHeight;
        toast.classList.add('show');
        if (toastTimeout) clearTimeout(toastTimeout);
        toastTimeout = setTimeout(function () {
            toast.classList.remove('show');
            setTimeout(function () { toast.style.display = 'none'; }, 400);
        }, 2500);
    }

})();
