/* ============================================
   EchoScribe — Groq Whisper Recording Engine
   with Voice-Based Speaker Diarization
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
    const btnInsights = document.getElementById('btn-insights');
    if (btnInsights) {
        btnInsights.href = `/patient.html?id=${activePatient.id}`;
    }
    const btnRecord = document.getElementById('btn-record');
    const btnUpload = document.getElementById('btn-upload');
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
    const browserWarning = document.getElementById('browser-warning');
    const toast = document.getElementById('toast');
    const toastMessage = document.getElementById('toast-message');
    const userGreeting = document.getElementById('user-greeting');
    const audioFileInput = document.getElementById('audio-file-input');
    const uploadProgress = document.getElementById('upload-progress');
    const uploadProgressBar = document.getElementById('upload-progress-bar');
    const uploadProgressText = document.getElementById('upload-progress-text');

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

    // State
    let mediaRecorder = null; // Used for live chunks
    let fullRecorder = null;  // Used for continuous Deepgram recording
    let audioStream = null;
    let isRecording = false;
    let isSummarizing = false;
    let isUploading = false;
    let toastTimeout = null;

    let fullAudioChunks = []; // Stores the unbroken recording

    // Speaker diarization state (now just flat text blocks during live)
    let speakerSegments = [];      // { speaker: 1|2, text, start, end }
    let chunkStartTime = 0;
    let recordingStartTime = 0;
    let chunkQueue = [];
    let isProcessingChunk = false;
    let hasTwoSpeakers = false;

    // Periodic recording state
    let chunkInterval = null;
    const CHUNK_DURATION_MS = 12000;

    // --- Check MediaRecorder support ---
    if (!window.MediaRecorder) {
        browserWarning.style.display = 'flex';
        browserWarning.querySelector('span:last-child').innerHTML =
            'Your browser does not support audio recording. Please use <strong>Google Chrome</strong> or <strong>Microsoft Edge</strong>.';
        btnRecord.disabled = true;
        btnRecord.style.opacity = '0.4';
        btnRecord.style.cursor = 'not-allowed';
        return;
    }

    // =============================================
    //  RECORDING
    // =============================================

    async function startRecording() {
        try {
            audioStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    channelCount: 1,
                    sampleRate: 16000,
                    echoCancellation: true,
                    noiseSuppression: true,
                }
            });
        } catch (err) {
            console.error('[EchoScribe] Mic access error:', err);
            if (err.name === 'NotAllowedError') {
                showToast('🚫 Microphone permission denied. Please allow access.');
            } else {
                showToast('🎤 No microphone found. Please connect a microphone.');
            }
            return;
        }

        // Reset state
        speakerSegments = [];
        chunkStartTime = 0;
        recordingStartTime = Date.now();
        chunkQueue = [];
        isProcessingChunk = false;
        hasTwoSpeakers = false;
        fullAudioChunks = [];

        transcriptBox.innerHTML = '';
        placeholder.style.display = 'inline';

        // Determine best MIME type
        const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
            ? 'audio/webm;codecs=opus'
            : MediaRecorder.isTypeSupported('audio/webm')
                ? 'audio/webm'
                : 'audio/mp4';

        // 1. Continuous Recorder for Deepgram
        fullRecorder = new MediaRecorder(audioStream, { mimeType });
        fullRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) fullAudioChunks.push(event.data);
        };
        fullRecorder.start();

        // 2. Fragmented Recorder for Live Visual Feedback (Groq Whisper)
        let audioChunks = [];
        function createLiveRecorder() {
            const recorder = new MediaRecorder(audioStream, { mimeType });

            recorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    audioChunks.push(event.data);
                }
            };

            recorder.onstop = () => {
                if (audioChunks.length > 0) {
                    const blob = new Blob(audioChunks, { type: mimeType });
                    const elapsed = (Date.now() - recordingStartTime) / 1000;
                    queueChunkForTranscription(blob, chunkStartTime, elapsed);
                    chunkStartTime = elapsed;
                    audioChunks = [];
                }
            };

            return recorder;
        }

        mediaRecorder = createLiveRecorder();
        mediaRecorder.start();
        isRecording = true;
        updateUI(true);
        updateSummarizeButton();
        showToast('🎤 Recording started');

        // Periodically restart live recorder to send chunks for visual feedback
        chunkInterval = setInterval(() => {
            if (mediaRecorder && mediaRecorder.state === 'recording') {
                mediaRecorder.stop();
                audioChunks = [];
                setTimeout(() => {
                    if (isRecording && audioStream && audioStream.active) {
                        mediaRecorder = createLiveRecorder();
                        mediaRecorder.start();
                    }
                }, 100);
            }
        }, CHUNK_DURATION_MS);
    }

    async function stopRecording() {
        isRecording = false;

        if (chunkInterval) {
            clearInterval(chunkInterval);
            chunkInterval = null;
        }

        // Stop live feedback recorder
        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
            mediaRecorder.stop();
        }

        // Stop full continuous recorder
        if (fullRecorder && fullRecorder.state !== 'inactive') {
            fullRecorder.stop();
        }

        if (audioStream) {
            audioStream.getTracks().forEach(track => track.stop());
            audioStream = null;
        }

        updateUI(false);
        updateSummarizeButton();
        showToast('⏹️ Recording Stopped. Processing full audio through Deepgram...');

        // Wait a tiny bit for the fullRecorder's ondataavailable to flush the final chunks
        setTimeout(processFullRecordingWithDeepgram, 500);
    }

    // =============================================
    //  DEEPGRAM FULL AUDIO PROCESSING
    // =============================================

    async function processFullRecordingWithDeepgram() {
        if (fullAudioChunks.length === 0) {
            showToast('⚠️ No audio recorded.');
            return;
        }

        // Create the unbroken Blob
        const ext = fullAudioChunks[0].type.includes('webm') ? 'webm' : 'mp4';
        const finalBlob = new Blob(fullAudioChunks, { type: fullAudioChunks[0].type });
        const file = new File([finalBlob], `recording.${ext}`, { type: finalBlob.type });

        statusText.textContent = 'Diarizing with Deepgram...';
        recordIcon.classList.add('pulse');
        btnRecord.disabled = true;
        btnUpload.disabled = true;
        btnClear.disabled = true;

        const formData = new FormData();
        formData.append('audio', file);

        const fullLang = langSelect.value;
        const lang = fullLang.split('-')[0];
        formData.append('language', lang);

        try {
            const response = await EchoAuth.authFetch('/api/transcribe-audio', {
                method: 'POST',
                body: formData,
            });

            if (!response.ok) {
                throw new Error('Deepgram processing failed');
            }

            const data = await response.json();

            // Clear the messy live segments and replace with perfect Deepgram turns
            speakerSegments = [];
            let foundTwoSpeakers = false;

            if (data.turns && data.turns.length > 0) {
                foundTwoSpeakers = data.turns.some(t => t.speaker === 2);
                data.turns.forEach(turn => {
                    speakerSegments.push({
                        speaker: turn.speaker,
                        text: turn.text,
                        start: turn.start || 0,
                        end: turn.end || 0
                    });
                });
            } else if (data.text) {
                speakerSegments.push({ speaker: 1, text: data.text, start: 0, end: 0 });
            }

            hasTwoSpeakers = foundTwoSpeakers;
            renderTranscript();
            updateWordCount(getFullTranscriptText());

            showToast(`✅ Deepgram Diarization Complete!`);

        } catch (err) {
            console.error('[EchoScribe] Deepgram Error:', err);
            showToast('⚠️ Deepgram Processing Failed. Kept live transcript.');
        } finally {
            statusText.textContent = 'Ready';
            recordIcon.classList.remove('pulse');
            btnRecord.disabled = false;
            btnUpload.disabled = false;
            btnClear.disabled = false;
            updateSummarizeButton();
        }
    }

    // =============================================
    //  CHUNK PROCESSING & TRANSCRIPTION
    // =============================================

    function queueChunkForTranscription(blob, startOffset, endOffset) {
        chunkQueue.push({ blob, startOffset, endOffset });
        processNextChunk();
    }

    async function processNextChunk() {
        if (isProcessingChunk || chunkQueue.length === 0) return;
        isProcessingChunk = true;

        const { blob, startOffset } = chunkQueue.shift();

        try {
            await sendChunkForTranscription(blob, startOffset);
        } catch (err) {
            console.error('[EchoScribe] Chunk transcription error:', err);
        }

        isProcessingChunk = false;
        if (chunkQueue.length > 0) {
            processNextChunk();
        } else {
            updateSummarizeButton();
        }
    }

    async function sendChunkForTranscription(blob, startOffset) {
        const formData = new FormData();
        const ext = blob.type.includes('webm') ? 'webm' : 'mp4';
        formData.append('audio', blob, `chunk.${ext}`);

        const fullLang = langSelect.value;
        const lang = fullLang.split('-')[0];
        formData.append('language', lang);

        // Flag to tell backend this is just a quick visual feedback chunk
        formData.append('live', 'true');

        statusText.textContent = 'Transcribing...';

        try {
            const response = await EchoAuth.authFetch('/api/transcribe-audio', {
                method: 'POST',
                body: formData,
            });

            if (!response.ok) {
                let errMsg = 'Transcription failed';
                try {
                    const err = await response.json();
                    errMsg = err.error || errMsg;
                } catch (_) {
                    errMsg = `Server error (${response.status})`;
                }
                throw new Error(errMsg);
            }

            const data = await response.json();

            if (data.segments && data.segments.length > 0) {
                data.segments.forEach(seg => {
                    const adjustedStart = seg.start + startOffset;
                    const adjustedEnd = seg.end + startOffset;

                    // Live chunks just get appended under "Live Recording" (Speaker 0 placeholder)
                    speakerSegments.push({
                        speaker: 0,
                        text: seg.text,
                        start: adjustedStart,
                        end: adjustedEnd
                    });
                });
            } else if (data.text && data.text.trim()) {
                const adjustedStart = startOffset;
                const adjustedEnd = (Date.now() - recordingStartTime) / 1000;

                speakerSegments.push({
                    speaker: 0,
                    text: data.text.trim(),
                    start: adjustedStart,
                    end: adjustedEnd
                });
            }

            renderTranscript();
            updateWordCount(getFullTranscriptText());

            statusText.textContent = isRecording ? 'Recording' : 'Ready';
        } catch (err) {
            console.error('[EchoScribe] Transcription error:', err);
            showToast('⚠️ Transcription: ' + err.message);
            statusText.textContent = isRecording ? 'Recording' : 'Ready';
        }
    }

    // =============================================
    //  TRANSCRIPT RENDERING
    // =============================================

    function getFullTranscriptText() {
        return speakerSegments.map(seg =>
            `Person ${seg.speaker}: ${seg.text}`
        ).join('\n');
    }

    function getPlainText() {
        return speakerSegments.map(seg => seg.text).join(' ');
    }

    function renderTranscript() {
        if (speakerSegments.length === 0) {
            placeholder.style.display = 'inline';
            transcriptBox.innerHTML = '';
            transcriptBox.appendChild(placeholder);
            return;
        }

        placeholder.style.display = 'none';

        // Group consecutive segments by same speaker
        const grouped = [];
        let current = null;

        speakerSegments.forEach(seg => {
            if (current && current.speaker === seg.speaker) {
                current.text += ' ' + seg.text;
                current.end = seg.end;
            } else {
                if (current) grouped.push(current);
                current = { ...seg };
            }
        });
        if (current) grouped.push(current);

        let html = '';
        grouped.forEach(group => {
            let speakerClass = group.speaker === 0 ? 'speaker-0' : (group.speaker === 1 ? 'speaker-1' : 'speaker-2');
            let label = group.identifiedRole || (group.speaker === 0 ? 'Live Processing...' : `Person ${group.speaker}`);
            let roleIcon = label === 'Counsellor' ? '🩺' : label === 'Patient' ? '🗣️' : (group.speaker === 0 ? '🎙️' : '👤');

            // Re-map colors safely
            if (group.speaker === 0) speakerClass = 'speaker-1'; // fallback visually for live text

            const timestamp = formatTime(group.start);

            html += `<div class="speaker-block ${speakerClass}">`;
            html += `<div class="speaker-header">`;
            html += `<span class="speaker-label">${roleIcon} ${escapeHtml(label)}</span>`;
            html += `<span class="speaker-time">${timestamp}</span>`;
            html += `</div>`;
            html += `<div class="speaker-text">${escapeHtml(group.text)}</div>`;
            html += `</div>`;
        });

        transcriptBox.innerHTML = html;
        transcriptBox.scrollTop = transcriptBox.scrollHeight;
    }

    function renderTranscriptWithRoles() {
        if (speakerSegments.length === 0) return;

        placeholder.style.display = 'none';

        const grouped = [];
        let current = null;

        speakerSegments.forEach(seg => {
            if (current && current.speaker === seg.speaker) {
                current.text += ' ' + seg.text;
                current.end = seg.end;
                current.identifiedRole = seg.identifiedRole || current.identifiedRole;
            } else {
                if (current) grouped.push(current);
                current = { ...seg };
            }
        });
        if (current) grouped.push(current);

        let html = '';
        grouped.forEach(group => {
            let speakerClass = group.speaker === 0 ? 'speaker-0' : (group.speaker === 1 ? 'speaker-1' : 'speaker-2');
            let label = group.identifiedRole || (group.speaker === 0 ? 'Live Processing...' : `Person ${group.speaker}`);
            let roleIcon = label === 'Counsellor' ? '🩺' : label === 'Patient' ? '🗣️' : (group.speaker === 0 ? '🎙️' : '👤');

            // Re-map colors safely
            if (group.speaker === 0) speakerClass = 'speaker-1'; // fallback visually for live text

            const timestamp = formatTime(group.start);

            html += `<div class="speaker-block ${speakerClass}">`;
            html += `<div class="speaker-header">`;
            html += `<span class="speaker-label">${roleIcon} ${escapeHtml(label)}</span>`;
            html += `<span class="speaker-time">${timestamp}</span>`;
            html += `</div>`;
            html += `<div class="speaker-text">${escapeHtml(group.text)}</div>`;
            html += `</div>`;
        });

        transcriptBox.innerHTML = html;
        transcriptBox.scrollTop = transcriptBox.scrollHeight;
    }

    function formatTime(seconds) {
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return `${m}:${s.toString().padStart(2, '0')}`;
    }

    // =============================================
    //  UI HELPERS
    // =============================================

    function updateWordCount(text) {
        const trimmed = text.trim();
        const count = trimmed ? trimmed.split(/\s+/).length : 0;
        wordCount.textContent = count + (count === 1 ? ' word' : ' words');
    }

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

    function updateSummarizeButton() {
        const hasText = speakerSegments.length > 0;
        const canSummarize = hasText && !isRecording && !isSummarizing;
        btnSummarize.disabled = !canSummarize;
    }

    // =============================================
    //  SUMMARIZE + SPEAKER IDENTIFICATION
    // =============================================

    async function summarizeTranscript() {
        const rawTranscript = getFullTranscriptText();
        if (!rawTranscript.trim()) {
            showToast('📝 No transcript to analyze');
            return;
        }

        if (isRecording) {
            showToast('⏹️ Please stop recording first');
            return;
        }

        isSummarizing = true;
        updateSummarizeButton();

        summarizeIcon.style.display = 'none';
        summarizeSpinner.style.display = 'inline-block';
        summarizeLabel.textContent = 'Identifying speakers...';
        showToast('🔍 Identifying Counsellor & Patient from voice + content...');

        try {
            // Step 1: LLM identifies Counsellor/Patient from content
            let labeledTranscript = rawTranscript;
            try {
                const idResponse = await EchoAuth.authFetch('/api/identify-speakers', {
                    method: 'POST',
                    body: JSON.stringify({ transcript: rawTranscript }),
                });

                if (idResponse.ok) {
                    const roles = await idResponse.json();
                    const p1Label = roles.person1_role || 'Person 1';
                    const p2Label = roles.person2_role || 'Person 2';

                    labeledTranscript = rawTranscript
                        .replace(/^Person 1:/gm, `${p1Label}:`)
                        .replace(/^Person 2:/gm, `${p2Label}:`);

                    speakerSegments.forEach(seg => {
                        seg.identifiedRole = seg.speaker === 1 ? p1Label : p2Label;
                    });
                    renderTranscriptWithRoles();

                    showToast(`✅ Person 1 → ${p1Label}, Person 2 → ${p2Label}`);
                }
            } catch (idErr) {
                console.warn('[EchoScribe] Speaker ID failed, using Person labels:', idErr);
            }

            // Step 2: SOAP analysis
            summarizeLabel.textContent = 'Analyzing...';
            showToast('✨ Generating clinical SOAP note...');

            const selectedLanguage = document.getElementById('lang-select').value;
            const response = await EchoAuth.authFetch('/api/summarize', {
                method: 'POST',
                body: JSON.stringify({
                    text: labeledTranscript,
                    patientId: activePatient ? activePatient.id : undefined,
                    language: selectedLanguage
                }),
            });

            if (!response.ok) {
                const errData = await response.json();
                throw new Error(errData.error || 'Server error');
            }

            const data = await response.json();

            data.diarizedTranscript = labeledTranscript;
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

    // =============================================
    //  UTILITIES
    // =============================================

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

    function clearTranscript() {
        speakerSegments = [];
        pitchSamples = [];
        speakerProfiles = {
            speaker1: { pitches: [], avgPitch: 0 },
            speaker2: { pitches: [], avgPitch: 0 },
        };
        hasTwoSpeakers = false;
        transcriptBox.innerHTML = '';
        placeholder.style.display = 'inline';
        transcriptBox.appendChild(placeholder);
        updateWordCount('');
        updateSummarizeButton();
        showToast('🗑️ Transcript cleared');
    }

    function copyTranscript() {
        const text = getFullTranscriptText();
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

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // =============================================
    //  FILE UPLOAD HANDLER
    // =============================================

    function triggerUpload() {
        if (isRecording || isUploading) {
            showToast('⚠️ Stop recording first or wait for upload to finish');
            return;
        }
        audioFileInput.click();
    }

    async function handleFileUpload(file) {
        if (!file) return;

        // Validate file size (4.5MB max — Vercel serverless limit)
        if (file.size > 4.5 * 1024 * 1024) {
            showToast('⚠️ File too large. Max 4.5MB for cloud deployment. Try a shorter clip.');
            return;
        }

        isUploading = true;
        btnUpload.disabled = true;
        btnRecord.disabled = true;
        uploadProgress.style.display = 'block';
        uploadProgressBar.style.width = '10%';
        uploadProgressText.textContent = `Uploading ${file.name}...`;
        showToast(`📁 Uploading ${file.name}...`);

        // Clear existing transcript
        speakerSegments = [];
        speakerProfiles = { speaker1: { pitches: [], avgPitch: 0 }, speaker2: { pitches: [], avgPitch: 0 } };
        hasTwoSpeakers = false;

        const formData = new FormData();
        formData.append('audio', file);

        const fullLang = langSelect.value;
        const lang = fullLang.split('-')[0];
        formData.append('language', lang);

        uploadProgressBar.style.width = '30%';
        uploadProgressText.textContent = 'Sending to Groq Whisper...';

        try {
            const response = await EchoAuth.authFetch('/api/transcribe-audio', {
                method: 'POST',
                body: formData,
            });

            uploadProgressBar.style.width = '70%';
            uploadProgressText.textContent = 'Processing transcription...';

            if (!response.ok) {
                let errMsg = 'Transcription failed';
                try {
                    const err = await response.json();
                    errMsg = err.error || errMsg;
                } catch (_) {
                    if (response.status === 413) {
                        errMsg = 'File too large for server. Try a shorter/smaller audio file.';
                    } else {
                        errMsg = `Server error (${response.status})`;
                    }
                }
                throw new Error(errMsg);
            }

            const data = await response.json();

            uploadProgressBar.style.width = '90%';
            uploadProgressText.textContent = 'Processing speaker segments...';

            const rawText = data.text || '';
            if (!rawText.trim()) {
                throw new Error('No speech detected in the audio file.');
            }

            // Since we switched to Deepgram, the backend returns accurately diarized 'turns' automatically!
            if (data.turns && data.turns.length > 0) {
                hasTwoSpeakers = data.turns.some(t => t.speaker === 2);
                data.turns.forEach(turn => {
                    speakerSegments.push({
                        speaker: turn.speaker,
                        text: turn.text,
                        start: turn.start || 0,
                        end: turn.end || 0,
                        avgPitch: turn.avgPitch || 0,
                    });
                });
            } else {
                // Fallback — single block
                speakerSegments.push({ speaker: 1, text: rawText, start: 0, end: 0, avgPitch: 0 });
            }

            uploadProgressBar.style.width = '100%';
            uploadProgressText.textContent = 'Done!';

            renderTranscript();
            updateWordCount(getFullTranscriptText());
            updateSummarizeButton();

            showToast(`✅ Transcribed ${file.name} — ${speakerSegments.length} segments`);

        } catch (err) {
            console.error('[EchoScribe] Upload error:', err);
            showToast('⚠️ Upload: ' + err.message);
        } finally {
            isUploading = false;
            btnUpload.disabled = false;
            btnRecord.disabled = false;
            setTimeout(() => {
                uploadProgress.style.display = 'none';
                uploadProgressBar.style.width = '0%';
            }, 1500);
            updateSummarizeButton();
        }
    }

    // --- Event Listeners ---
    btnRecord.addEventListener('click', function () {
        if (isRecording) {
            stopRecording();
        } else {
            startRecording();
        }
    });

    if (btnUpload) btnUpload.addEventListener('click', triggerUpload);
    if (audioFileInput) audioFileInput.addEventListener('change', (e) => {
        if (e.target.files[0]) {
            handleFileUpload(e.target.files[0]);
            e.target.value = ''; // Reset so same file can be re-selected
        }
    });

    btnClear.addEventListener('click', clearTranscript);
    btnCopy.addEventListener('click', copyTranscript);
    btnSummarize.addEventListener('click', summarizeTranscript);
    if (btnLogout) btnLogout.addEventListener('click', () => EchoAuth.logout());
    if (themeToggle) themeToggle.addEventListener('click', toggleTheme);

    document.addEventListener('keydown', function (e) {
        if (e.code === 'Space' && e.target === document.body) {
            e.preventDefault();
            btnRecord.click();
        }
    });

})();
