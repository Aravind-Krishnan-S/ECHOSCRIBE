/* ============================================
   EchoScribe — Patient Profile Logic
   ============================================ */

(function () {
    'use strict';
    EchoAuth.guard();

    const urlParams = new URLSearchParams(window.location.search);
    const patientId = urlParams.get('id');

    if (!patientId) {
        window.location.href = '/dashboard.html';
        return;
    }

    // --- DOM Elements ---
    const patientName = document.getElementById('patient-name');
    const patientAge = document.getElementById('patient-age');
    const patientGender = document.getElementById('patient-gender');
    const patientEmail = document.getElementById('patient-email');
    const patientPhone = document.getElementById('patient-phone');
    const patientAvatar = document.getElementById('patient-avatar');

    const profileContent = document.getElementById('profile-content');
    const btnGenerateProfile = document.getElementById('btn-generate-profile');
    const filterMode = document.getElementById('filter-mode');

    const sessionsList = document.getElementById('sessions-list');
    const sessionsEmpty = document.getElementById('sessions-empty');

    // --- State ---
    let patientData = null;
    let sessionsData = [];
    let emotionsChart = null;
    let activityChart = null;

    // --- Init ---
    async function init() {
        try {
            // 1. Fetch Patient Info
            const pRes = await EchoAuth.authFetch(`/api/patients/${patientId}`);
            if (pRes.ok) {
                patientData = await pRes.json();
                renderPatientInfo();
            }

            // 2. Fetch Sessions
            const sRes = await EchoAuth.authFetch(`/api/patients/${patientId}/sessions`);
            if (sRes.ok) {
                sessionsData = await sRes.json();
                renderSessions();
                renderCharts();
            }

            // 3. Fetch specific Profile if exists
            // We can fetch the longitudinal profile if it exists as a recent session or special row
            // For now, if no automated profile is found, we show the placeholder.

        } catch (err) {
            console.error('Failed to load profile:', err);
        }
    }

    function renderPatientInfo() {
        if (!patientData) return;
        if (patientName) patientName.textContent = patientData.name || 'Unknown';
        if (patientAge) patientAge.textContent = patientData.age ? `🎂 ${patientData.age} years` : '🎂 -- yrs';
        if (patientGender) patientGender.textContent = patientData.gender ? `👤 ${patientData.gender}` : '👤 --';
        if (patientEmail) patientEmail.textContent = patientData.email ? `📧 ${patientData.email}` : '📧 No email';
        if (patientPhone) patientPhone.textContent = patientData.phone ? `📞 ${patientData.phone}` : '📞 No phone';

        if (patientAvatar) {
            const initials = (patientData.name || 'U').split(' ').map(n => n.charAt(0).toUpperCase()).slice(0, 2).join('');
            patientAvatar.textContent = initials;
        }
    }

    function renderSessions() {
        if (!sessionsList || !sessionsEmpty || !filterMode) return;
        const modeFilter = filterMode.value;
        const filtered = sessionsData.filter(s => {
            if (modeFilter === 'all') return true;
            return (s.session_mode || 'Therapy').toLowerCase() === modeFilter;
        });

        sessionsList.innerHTML = '';
        if (filtered.length === 0) {
            sessionsEmpty.style.display = 'block';
            return;
        }

        sessionsEmpty.style.display = 'none';

        filtered.forEach(session => {
            const el = document.createElement('div');
            el.className = 'session-item';

            const modeLabel = session.session_mode || 'Therapy';
            const dateStr = new Date(session.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

            const analysis = session.analysis_json || {};
            const wc = analysis.wordCount || 0;
            const mins = Math.max(1, Math.round(wc / 150));
            const tone = analysis.emotional_tone || 'Neutral';

            el.innerHTML = `
                <div>
                    <div class="session-item-date">${dateStr}</div>
                    <div class="session-item-meta">${mins} min • ${wc} words • Tone: ${tone}</div>
                </div>
                <div style="display: flex; gap: 1rem; align-items: center;">
                    <span class="session-status" style="background: ${modeLabel === 'Mentoring' ? 'var(--mode-mentoring-surface)' : 'var(--mode-therapy-surface)'}; color: ${modeLabel === 'Mentoring' ? 'var(--mode-mentoring-primary)' : 'var(--mode-therapy-primary)'};">${modeLabel}</span>
                    <span style="color: var(--text-tertiary);">→</span>
                </div>
            `;

            el.addEventListener('click', () => {
                localStorage.setItem('echoscribe_summary', JSON.stringify(analysis));
                window.location.href = '/summary.html';
            });

            sessionsList.appendChild(el);
        });
    }

    function renderCharts() {
        if (sessionsData.length === 0) return;

        // Sort chronological
        const sorted = [...sessionsData].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

        const labels = sorted.map((s, i) => `S${i + 1}`);
        const words = sorted.map(s => (s.analysis_json || {}).wordCount || 0);

        // Tone scoring for chart: Negative (-1) to Positive (1)
        const toneScores = sorted.map(s => {
            const tone = ((s.analysis_json || {}).emotional_tone || 'neutral').toLowerCase();
            if (tone.includes('anx') || tone.includes('frust') || tone.includes('sad') || tone.includes('angry')) return -1;
            if (tone.includes('hap') || tone.includes('hope')) return 1;
            return 0;
        });

        // Current mode primary color
        const computedStyle = getComputedStyle(document.body);
        const primaryColor = computedStyle.getPropertyValue('--mode-primary').trim() || '#10B981';

        // 1. Emotions Chart
        const ctxEmo = document.getElementById('emotionsChart');
        if (ctxEmo) {
            if (emotionsChart) emotionsChart.destroy();
            emotionsChart = new Chart(ctxEmo, {
                type: 'line',
                data: {
                    labels,
                    datasets: [{
                        label: 'Emotional Valence',
                        data: toneScores,
                        borderColor: primaryColor,
                        backgroundColor: primaryColor + '22',
                        fill: true,
                        tension: 0.4,
                        pointRadius: 4
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { display: false } },
                    scales: {
                        y: { min: -1.5, max: 1.5, ticks: { callback: v => v === 1 ? 'Positive' : v === -1 ? 'Negative' : v === 0 ? 'Neutral' : '' }, grid: { color: 'rgba(255,255,255,0.05)' } },
                        x: { grid: { display: false } }
                    }
                }
            });
        }

        // 2. Activity Chart
        const ctxAct = document.getElementById('activityChart');
        if (ctxAct) {
            if (activityChart) activityChart.destroy();
            activityChart = new Chart(ctxAct, {
                type: 'bar',
                data: {
                    labels,
                    datasets: [{
                        label: 'Words Captured',
                        data: words,
                        backgroundColor: primaryColor,
                        borderRadius: 4
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { display: false } },
                    scales: {
                        y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' } },
                        x: { grid: { display: false } }
                    }
                }
            });
        }
    }

    // --- Tabs Logic ---
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

            btn.classList.add('active');
            document.getElementById(btn.dataset.tab).classList.add('active');
        });
    });

    // --- New Session ---
    const btnRecordNew = document.getElementById('btn-record-new');
    if (btnRecordNew) {
        btnRecordNew.addEventListener('click', () => {
            localStorage.setItem('echoscribe_active_patient', JSON.stringify(patientData));
            window.location.href = '/record.html';
        });
    }

    // --- Generate Profile ---
    if (btnGenerateProfile) {
        btnGenerateProfile.addEventListener('click', async () => {
            btnGenerateProfile.disabled = true;
            btnGenerateProfile.textContent = '✨ Generating...';
            try {
                const res = await EchoAuth.authFetch(`/api/profile?patientId=${patientId}`);
                if (res.ok) {
                    const profile = await res.json();
                    profileContent.innerHTML = profile.psychological_profile || profile.journey_summary || 'Profile generated but no text format returned.';
                } else {
                    throw new Error('Profile failed');
                }
            } catch (err) {
                alert('Failed to generate profile. Summarize more sessions first.');
            } finally {
                btnGenerateProfile.disabled = false;
                btnGenerateProfile.textContent = '✨ Generate Fresh';
            }
        });
    }

    // --- Filter logic ---
    if (filterMode) filterMode.addEventListener('change', renderSessions);

    // Boot
    init();

})();
