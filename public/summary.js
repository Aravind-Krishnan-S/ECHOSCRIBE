/* ============================================
   EchoScribe — Summary Page Logic
   ============================================ */

(function () {
    'use strict';

    // --- Auth Guard ---
    EchoAuth.guard();

    // --- DOM Refs ---
    const soapS = document.getElementById('soap-s');
    const soapO = document.getElementById('soap-o');
    const soapA = document.getElementById('soap-a');
    const soapP = document.getElementById('soap-p');

    const growG = document.getElementById('grow-g');
    const growR = document.getElementById('grow-r');
    const growO = document.getElementById('grow-o');
    const growW = document.getElementById('grow-w');

    const riskBanner = document.getElementById('risk-banner');
    const riskText = document.getElementById('risk-text');

    const fullTranscript = document.getElementById('full-transcript');

    const pageTitle = document.getElementById('page-title');
    const metaDate = document.getElementById('meta-date');
    const metaPatient = document.getElementById('meta-patient');
    const metaWords = document.getElementById('meta-words');

    const btnBack = document.getElementById('btn-back');
    const btnSave = document.getElementById('btn-save');
    const btnBottomSave = document.getElementById('btn-bottom-save');
    const btnExport = document.getElementById('btn-export');

    // --- Load Data ---
    const raw = localStorage.getItem('echoscribe_summary');
    if (!raw) { window.location.href = '/record.html'; return; }

    let data;
    try { data = JSON.parse(raw); } catch (e) { window.location.href = '/record.html'; return; }

    const activePatientRaw = localStorage.getItem('echoscribe_active_patient');
    const activePatient = activePatientRaw ? JSON.parse(activePatientRaw) : null;

    if (activePatient) {
        metaPatient.textContent = `Patient: ${activePatient.name}`;
    }

    metaDate.textContent = `Date: ${new Date().toLocaleDateString()}`;
    const wordCount = data.wordCount || 0;
    metaWords.textContent = `Words: ${wordCount.toLocaleString()}`;

    // --- Enforce global mode if set, or set global mode based on data ---
    // If the session was mentoring, set global mode to mentoring so CSS hides SOAP and changes colors.
    const isMentoring = !!data.grow || data.sessionMode === 'Mentoring';

    if (isMentoring) {
        document.body.setAttribute('data-mode', 'mentoring'); // override for this page view
        pageTitle.textContent = 'Mentoring Session Note (GROW)';

        const grow = data.grow || {};
        growG.textContent = grow.goal || 'Not documented';
        growR.textContent = grow.reality || 'Not documented';
        growO.textContent = grow.options || 'Not documented';
        growW.textContent = grow.way_forward || 'Not documented';
    } else {
        document.body.setAttribute('data-mode', 'therapy');
        pageTitle.textContent = 'Clinical Session Note (SOAP)';

        const soap = data.soap || {};
        soapS.textContent = soap.subjective || 'Not documented';
        soapO.textContent = soap.objective || 'Not documented';
        soapA.textContent = soap.assessment || 'Not documented';
        soapP.textContent = soap.plan || 'Not documented';
    }

    // --- Original Transcript ---
    let originalText = data.diarizedTranscript || data.originalText || 'No original text available.';

    // Instead of raw text, render it nicely since we have exact roles now
    let htmlContent = '';
    const lines = originalText.split('\n');
    let isInsideSpeech = false;

    lines.forEach(line => {
        if (line.match(/^[A-Za-z0-9 ]+:/)) {
            // It's a speaker role like "Therapist:" or "Patient:"
            if (isInsideSpeech) htmlContent += '</div>\n';
            isInsideSpeech = true;

            let displayRole = line.substring(0, line.length - 1);
            if (activePatient && activePatient.name && (displayRole === 'Patient' || displayRole === 'Mentee')) {
                displayRole = activePatient.name;
            }

            const isAuthority = displayRole === 'Therapist' || displayRole === 'Counsellor' || displayRole === 'Mentor';
            const roleColor = isAuthority ? 'var(--mode-primary)' : 'var(--text-primary)';
            const roleIcon = isAuthority ? (document.body.getAttribute('data-mode') === 'therapy' ? '🩺' : '💡') : '🗣️';

            htmlContent += `<div style="margin-bottom: 1rem;">
                <strong style="color: ${roleColor}; font-family: var(--font-serif); font-size: 1.1rem;">
                    ${roleIcon} ${displayRole}
                </strong><br/>`;
        } else if (line.trim() !== '') {
            htmlContent += `<span style="font-family: var(--font-reading); line-height: 1.6;">${line.trim()}</span><br/>`;
        }
    });

    if (isInsideSpeech) htmlContent += '</div>';

    if (!htmlContent) {
        htmlContent = `<span style="font-family: var(--font-reading);">${originalText}</span>`;
    }

    fullTranscript.innerHTML = htmlContent;

    // --- Risk Assessment ---
    const risk = data.risk_assessment || {};
    const riskLevel = (risk.self_harm_risk || risk.severe_distress_risk || 'low').toLowerCase();

    if (riskLevel === 'high' || risk.suicidal_ideation || risk.academic_burnout) {
        riskBanner.classList.add('active');
        riskText.textContent = isMentoring ? 'High burnout indicator detected. Immediate supportive action recommended.' : 'High risk indicators detected. Immediate clinical review required.';
    } else if (riskLevel === 'moderate') {
        riskBanner.classList.add('active');
        riskBanner.style.background = 'rgba(245, 158, 11, 0.1)';
        riskBanner.style.borderColor = 'var(--warning)';
        riskBanner.querySelector('span').textContent = '⚠️';
        riskBanner.querySelector('h3').style.color = 'var(--warning)';
        riskBanner.querySelector('h3').textContent = 'Moderate Alert';
        riskText.textContent = 'Please monitor this profile for ongoing stress markers.';
    }

    // ==================
    // EVENT LISTENERS
    // ==================

    if (btnBack) {
        btnBack.addEventListener('click', () => {
            window.location.href = '/dashboard.html';
        });
    }

    async function handleSave() {
        if (!activePatient) {
            alert("No active patient selected. Cannot save.");
            return;
        }

        btnSave.disabled = true;
        btnBottomSave.disabled = true;
        btnSave.textContent = '⏳ Saving...';

        try {
            const response = await EchoAuth.authFetch('/api/session', {
                method: 'POST',
                body: JSON.stringify({
                    patientId: activePatient.id,
                    transcript: originalText,
                    summary: isMentoring ? (data.grow?.goal || '') : (data.soap?.subjective || data.summary || ''),
                    analysisJson: data,
                    mode: isMentoring ? 'Mentoring' : 'Therapy'
                }),
            });

            if (response.ok) {
                btnSave.textContent = '✅ Saved';
                btnBottomSave.textContent = '✅ Saved';
            } else {
                throw new Error('Save failed');
            }
        } catch (err) {
            btnSave.textContent = '❌ Error';
            console.error(err);
        } finally {
            setTimeout(() => {
                btnSave.disabled = false;
                btnBottomSave.disabled = false;
                btnSave.textContent = '💾 Save Session';
                btnBottomSave.textContent = '💾 Save Session to Database';
            }, 3000);
        }
    }

    if (btnSave) btnSave.addEventListener('click', handleSave);
    if (btnBottomSave) btnBottomSave.addEventListener('click', handleSave);

    // --- Export Handlers ---

    const btnExportCsv = document.getElementById('btn-export-csv');
    const btnExportJson = document.getElementById('btn-export-json');
    const sessionId = localStorage.getItem('echoscribe_session_id');

    if (btnExport) {
        btnExport.addEventListener('click', async () => {
            if (!sessionId) {
                alert('Please save the session first before exporting as PDF.');
                return;
            }
            try {
                btnExport.disabled = true;
                btnExport.textContent = '⏳ Generating...';
                const res = await EchoAuth.authFetch(`/api/export/pdf/${sessionId}`);
                if (!res.ok) throw new Error('PDF generation failed');
                const blob = await res.blob();
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `echoscribe-session-${sessionId}.pdf`;
                a.click();
                URL.revokeObjectURL(url);
            } catch (err) {
                alert('PDF export failed: ' + err.message);
            } finally {
                btnExport.disabled = false;
                btnExport.textContent = '📥 PDF';
            }
        });
    }

    if (btnExportCsv) {
        btnExportCsv.addEventListener('click', async () => {
            try {
                btnExportCsv.disabled = true;
                btnExportCsv.textContent = '⏳...';
                const res = await EchoAuth.authFetch('/api/export/csv');
                if (!res.ok) throw new Error('CSV export failed');
                const blob = await res.blob();
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'echoscribe-sessions.csv';
                a.click();
                URL.revokeObjectURL(url);
            } catch (err) {
                alert('CSV export failed: ' + err.message);
            } finally {
                btnExportCsv.disabled = false;
                btnExportCsv.textContent = '📊 CSV';
            }
        });
    }

    if (btnExportJson) {
        btnExportJson.addEventListener('click', async () => {
            try {
                btnExportJson.disabled = true;
                btnExportJson.textContent = '⏳...';
                const res = await EchoAuth.authFetch('/api/export/record');
                if (!res.ok) throw new Error('JSON export failed');
                const blob = await res.blob();
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'echoscribe-full-record.json';
                a.click();
                URL.revokeObjectURL(url);
            } catch (err) {
                alert('JSON export failed: ' + err.message);
            } finally {
                btnExportJson.disabled = false;
                btnExportJson.textContent = '📁 JSON';
            }
        });
    }

})();
