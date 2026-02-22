/* ============================================
   EchoScribe — Speech-to-Text Engine (Groq Whisper)
   ============================================
   Records audio via MediaRecorder, sends chunks to
   the server /api/transcribe-audio endpoint which
   uses Groq Whisper for transcription.
   ============================================ */

(function () {
    'use strict';

    // --- Auth Guard ---
    EchoAuth.guard();

    // --- Patient Enforcement ---
    const activePatientData = localStorage.getItem('echoscribe_active_patient');
    if (!activePatientData) {
        window.location.href = '/dashboard';
        return;
    }
    const activePatient = JSON.parse(activePatientData);
    const patientBanner = document.getElementById('active-patient-banner');
    if (patientBanner) {
        patientBanner.textContent = `👤 Patient: ${activePatient.name}`;
    }

    // --- DOM Elements ---
    const btnRecord = document.getElementById('btn-record');
    const btnClear = document.getElementById('btn-clear');
    const btnCopy = document.getElementById('btn-copy');
    const btnSummarize = document.getElementById('btn-summarize');
    const btnLogout = document.getElementById('btn-logout');
    const themeToggle = document.getElementById('theme-toggle');
    const summarizeIcon = document.getElementById('summarize-icon');
    const summarizeLabel = document.getElementById('summarize-label');
    const summarizeSpinner = document.getElementById('summarize-spinner');
    const transcriptBox = document.getElementById('transcript-box');
    const placeholder = document.getElementById('placeholder');
    const statusIndicator = document.getElementById('status-indicator');
    const statusText = document.getElementById('status-text');
    const recordIcon = document.getElementById('record-icon');
    const recordLabel = document.getElementById('record-label');
    const wordCount = document.getElementById('word-count');
    const langSelect = document.getElementById('lang-select');
    const toast = document.getElementById('toast');
    const toastMessage = document.getElementById('toast-message');
    const userGreeting = document.getElementById('user-greeting');

    // --- User Greeting ---
    const user = EchoAuth.getUser();
    if (user && userGreeting) {
        userGreeting.textContent = `Logged in as ${user.email}`;
    }

    // --- Theme ---
    function initTheme() {
        const saved = localStorage.getItem('echoscribe_theme') || 'dark';
        document.documentElement.setAttribute('data-theme', saved);
        if (themeToggle) themeToggle.textContent = saved === 'dark' ? '🌙' : '☀️';
    }

    function toggleTheme() {
        const current = document.documentElement.getAttribute('data-theme');
        const next = current === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem('echoscribe_theme', next);
        themeToggle.textContent = next === 'dark' ? '🌙' : '☀️';
    }

    initTheme();

    // --- State ---
    let mediaStream = null;
    let mediaRecorder = null;
    let isRecording = false;
    let isSummarizing = false;
    let finalTranscript = '';
    let toastTimeout = null;
    let recordingInterval = null;
    let audioChunks = [];
    let isTranscribing = false;

    // --- Language map (ISO code from select → Whisper 2-letter code) ---
    function getWhisperLang() {
        const val = langSelect.value; // e.g. 'en-US', 'hi-IN'
        return val.split('-')[0]; // 'en', 'hi', 'es', etc.
    }

    // --- Start Recording ---
    async function startRecording() {
        try {
            mediaStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    channelCount: 1,
                    sampleRate: 16000,
                    echoCancellation: true,
                    noiseSuppression: true,
                },
            });
        } catch (err) {
            console.error('[EchoScribe] Mic access error:', err);
            if (err.name === 'NotAllowedError') {
                showToast('🚫 Microphone permission denied. Please allow access.');
            } else if (err.name === 'NotFoundError') {
                showToast('🎤 No microphone found. Please connect a microphone.');
            } else {
                showToast('⚠️ Could not access microphone: ' + err.message);
            }
            return;
        }

        // Determine supported MIME type
        const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
            ? 'audio/webm;codecs=opus'
            : MediaRecorder.isTypeSupported('audio/webm')
                ? 'audio/webm'
                : 'audio/ogg';

        mediaRecorder = new MediaRecorder(mediaStream, { mimeType });

        audioChunks = [];

        mediaRecorder.ondataavailable = (event) => {
            if (event.data && event.data.size > 0) {
                audioChunks.push(event.data);
            }
        };

        mediaRecorder.onstop = () => {
            // When recorder stops (either from interval or manual stop), send accumulated audio
            if (audioChunks.length > 0) {
                const audioBlob = new Blob(audioChunks, { type: mimeType });
                audioChunks = [];
                sendAudioForTranscription(audioBlob);
            }
        };

        // Start recording
        mediaRecorder.start();
        isRecording = true;
        updateUI(true);
        updateSummarizeButton();
        showToast('🎤 Recording started — powered by Groq Whisper');

        // Every 5 seconds, stop + restart recorder to send a chunk
        recordingInterval = setInterval(() => {
            if (mediaRecorder && mediaRecorder.state === 'recording') {
                mediaRecorder.stop(); // triggers onstop → sends chunk
                // Restart after a brief delay
                setTimeout(() => {
                    if (isRecording && mediaStream && mediaStream.active) {
                        audioChunks = [];
                        mediaRecorder = new MediaRecorder(mediaStream, { mimeType });
                        mediaRecorder.ondataavailable = (event) => {
                            if (event.data && event.data.size > 0) {
                                audioChunks.push(event.data);
                            }
                        };
                        mediaRecorder.onstop = () => {
                            if (audioChunks.length > 0) {
                                const blob = new Blob(audioChunks, { type: mimeType });
                                audioChunks = [];
                                sendAudioForTranscription(blob);
                            }
                        };
                        mediaRecorder.start();
                    }
                }, 100);
            }
        }, 5000);
    }

    // --- Stop Recording ---
    function stopRecording() {
        isRecording = false;

        if (recordingInterval) {
            clearInterval(recordingInterval);
            recordingInterval = null;
        }

        if (mediaRecorder && mediaRecorder.state === 'recording') {
            try {
                mediaRecorder.stop(); // final chunk
            } catch (e) { /* ignore */ }
        }

        if (mediaStream) {
            mediaStream.getTracks().forEach(t => t.stop());
            mediaStream = null;
        }

        mediaRecorder = null;
        updateUI(false);
        updateSummarizeButton();
        showToast('⏹️ Recording stopped');
    }

    // --- Send Audio to Server for Transcription ---
    async function sendAudioForTranscription(audioBlob) {
        if (isTranscribing) return; // skip if still processing previous chunk
        if (audioBlob.size < 1000) return; // skip tiny chunks (silence)

        isTranscribing = true;
        statusText.textContent = 'Transcribing...';

        try {
            const formData = new FormData();
            formData.append('audio', audioBlob, 'recording.webm');
            formData.append('language', getWhisperLang());

            const response = await EchoAuth.authFetch('/api/transcribe-audio', {
                method: 'POST',
                body: formData,
            });

            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                console.error('[EchoScribe] Transcription error:', errData);
                // Don't show toast for every chunk error, just log
                return;
            }

            const data = await response.json();
            if (data.text && data.text.trim()) {
                finalTranscript += data.text.trim() + ' ';
                updateTranscriptDisplay(finalTranscript, '');
                updateWordCount(finalTranscript);
                updateSummarizeButton();
            }
        } catch (err) {
            console.error('[EchoScribe] Transcription fetch error:', err);
        } finally {
            isTranscribing = false;
            if (isRecording) {
                statusText.textContent = 'Recording';
            } else {
                statusText.textContent = 'Ready';
            }
        }
    }

    // --- Update Transcript Display ---
    function updateTranscriptDisplay(finalText, interimText) {
        placeholder.style.display = 'none';

        let html = '';

        if (finalText) {
            html += escapeHtml(finalText);
        }

        if (interimText) {
            html += '<span class="interim-text">' + escapeHtml(interimText) + '</span>';
        }

        if (!finalText && !interimText) {
            placeholder.style.display = 'inline';
            return;
        }

        transcriptBox.innerHTML = html;
        transcriptBox.scrollTop = transcriptBox.scrollHeight;
    }

    // --- Update Word Count ---
    function updateWordCount(text) {
        const trimmed = text.trim();
        const count = trimmed ? trimmed.split(/\s+/).length : 0;
        wordCount.textContent = count + (count === 1 ? ' word' : ' words');
    }

    // --- Update UI State ---
    function updateUI(recording) {
        if (recording) {
            btnRecord.classList.add('recording');
            recordIcon.textContent = '⏹️';
            recordLabel.textContent = 'Stop Recording';
            statusIndicator.classList.remove('status-idle');
            statusIndicator.classList.add('status-recording');
            statusText.textContent = 'Recording';
        } else {
            btnRecord.classList.remove('recording');
            recordIcon.textContent = '🎤';
            recordLabel.textContent = 'Start Recording';
            statusIndicator.classList.remove('status-recording');
            statusIndicator.classList.add('status-idle');
            statusText.textContent = 'Ready';
        }
    }

    // --- Update Summarize Button State ---
    function updateSummarizeButton() {
        const hasText = finalTranscript.trim().length > 0;
        const canSummarize = hasText && !isRecording && !isSummarizing;
        btnSummarize.disabled = !canSummarize;
    }

    // --- Summarize with AI ---
    async function summarizeTranscript() {
        const text = finalTranscript.trim();
        if (!text) {
            showToast('📝 No transcript to analyze');
            return;
        }

        if (isRecording) {
            showToast('⏹️ Please stop recording first');
            return;
        }

        isSummarizing = true;
        updateSummarizeButton();

        // Show loading state
        summarizeIcon.style.display = 'none';
        summarizeSpinner.style.display = 'inline-block';
        summarizeLabel.textContent = 'Analyzing...';
        showToast('✨ Generating clinical SOAP note with AI...');

        try {
            const response = await EchoAuth.authFetch('/api/summarize', {
                method: 'POST',
                body: JSON.stringify({ text: text, patientId: activePatient.id }),
            });

            if (!response.ok) {
                const errData = await response.json();
                throw new Error(errData.error || 'Server error');
            }

            const data = await response.json();

            // Store in localStorage and navigate
            localStorage.setItem('echoscribe_summary', JSON.stringify(data));
            if (data.sessionId) {
                localStorage.setItem('echoscribe_session_id', data.sessionId);
            }
            if (data.saved) {
                showToast('✅ Session saved automatically');
            }
            setTimeout(() => { window.location.href = '/summary'; }, 500);

        } catch (err) {
            console.error('[EchoScribe] Analyze error:', err);
            showToast('⚠️ ' + err.message);
        } finally {
            isSummarizing = false;
            summarizeIcon.style.display = 'inline';
            summarizeSpinner.style.display = 'none';
            summarizeLabel.textContent = 'Analyze (SOAP)';
            updateSummarizeButton();
        }
    }

    // --- Show Toast ---
    function showToast(message) {
        toastMessage.textContent = message;
        toast.style.display = 'block';
        toast.offsetHeight;
        toast.classList.add('show');

        if (toastTimeout) clearTimeout(toastTimeout);

        toastTimeout = setTimeout(function () {
            toast.classList.remove('show');
            setTimeout(function () {
                toast.style.display = 'none';
            }, 400);
        }, 2500);
    }

    // --- Clear Transcript ---
    function clearTranscript() {
        finalTranscript = '';
        transcriptBox.innerHTML = '';
        placeholder.style.display = 'inline';
        transcriptBox.appendChild(placeholder);
        updateWordCount('');
        updateSummarizeButton();
        showToast('🗑️ Transcript cleared');
    }

    // --- Copy to Clipboard ---
    function copyTranscript() {
        const text = finalTranscript.trim();
        if (!text) {
            showToast('📋 Nothing to copy');
            return;
        }

        navigator.clipboard.writeText(text).then(function () {
            showToast('✅ Copied to clipboard!');
        }).catch(function () {
            const textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.select();
            try {
                document.execCommand('copy');
                showToast('✅ Copied to clipboard!');
            } catch (e) {
                showToast('⚠️ Failed to copy');
            }
            document.body.removeChild(textarea);
        });
    }

    // --- Escape HTML ---
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // --- Event Listeners ---
    btnRecord.addEventListener('click', function () {
        if (isRecording) {
            stopRecording();
        } else {
            startRecording();
        }
    });

    btnClear.addEventListener('click', clearTranscript);
    btnCopy.addEventListener('click', copyTranscript);
    btnSummarize.addEventListener('click', summarizeTranscript);
    if (btnLogout) btnLogout.addEventListener('click', () => EchoAuth.logout());
    if (themeToggle) themeToggle.addEventListener('click', toggleTheme);

    langSelect.addEventListener('change', function () {
        if (isRecording) {
            showToast('🌐 Language will apply to next recording chunk');
        }
    });

    document.addEventListener('keydown', function (e) {
        if (e.code === 'Space' && e.target === document.body) {
            e.preventDefault();
            btnRecord.click();
        }
    });

})();
