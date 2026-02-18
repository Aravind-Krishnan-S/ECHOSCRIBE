/* ============================================
   VoiceScribe — Speech Recognition Engine
   ============================================ */

(function () {
    'use strict';

    // --- DOM Elements ---
    const btnRecord = document.getElementById('btn-record');
    const btnClear = document.getElementById('btn-clear');
    const btnCopy = document.getElementById('btn-copy');
    const btnSummarize = document.getElementById('btn-summarize');
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

    // --- State ---
    let recognition = null;
    let isRecording = false;
    let isSummarizing = false;
    let finalTranscript = '';
    let toastTimeout = null;

    // --- Browser Compatibility Check ---
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
        browserWarning.style.display = 'flex';
        btnRecord.disabled = true;
        btnRecord.style.opacity = '0.4';
        btnRecord.style.cursor = 'not-allowed';
        return;
    }

    // --- Initialize Speech Recognition ---
    function createRecognition() {
        const rec = new SpeechRecognition();
        rec.continuous = true;
        rec.interimResults = true;
        rec.lang = langSelect.value;
        rec.maxAlternatives = 1;

        rec.onstart = function () {
            console.log('[VoiceScribe] Recognition started');
        };

        rec.onresult = function (event) {
            let interimTranscript = '';

            for (let i = event.resultIndex; i < event.results.length; i++) {
                const transcript = event.results[i][0].transcript;
                if (event.results[i].isFinal) {
                    finalTranscript += transcript + ' ';
                } else {
                    interimTranscript += transcript;
                }
            }

            updateTranscriptDisplay(finalTranscript, interimTranscript);
            updateWordCount(finalTranscript + interimTranscript);
            updateSummarizeButton();
        };

        rec.onerror = function (event) {
            console.error('[VoiceScribe] Error:', event.error);

            switch (event.error) {
                case 'not-allowed':
                    showToast('🚫 Microphone permission denied. Please allow access.');
                    stopRecording();
                    break;
                case 'no-speech':
                    console.log('[VoiceScribe] No speech detected, will auto-restart...');
                    break;
                case 'audio-capture':
                    showToast('🎤 No microphone found. Please connect a microphone.');
                    stopRecording();
                    break;
                case 'network':
                    showToast('🌐 Network error. Speech recognition requires an internet connection in some browsers.');
                    stopRecording();
                    break;
                case 'aborted':
                    break;
                default:
                    showToast('⚠️ Error: ' + event.error);
                    break;
            }
        };

        rec.onend = function () {
            console.log('[VoiceScribe] Recognition ended');
            if (isRecording) {
                try {
                    rec.start();
                    console.log('[VoiceScribe] Auto-restarted');
                } catch (e) {
                    console.error('[VoiceScribe] Auto-restart failed:', e);
                    stopRecording();
                }
            }
        };

        return rec;
    }

    // --- Start Recording ---
    function startRecording() {
        finalTranscript = '';
        recognition = createRecognition();

        try {
            recognition.start();
            isRecording = true;
            updateUI(true);
            updateSummarizeButton();
            showToast('🎤 Recording started');
        } catch (e) {
            console.error('[VoiceScribe] Start failed:', e);
            showToast('⚠️ Could not start recording. Please try again.');
        }
    }

    // --- Stop Recording ---
    function stopRecording() {
        isRecording = false;

        if (recognition) {
            try {
                recognition.stop();
            } catch (e) {
                // Ignore
            }
            recognition = null;
        }

        updateUI(false);
        updateSummarizeButton();
        showToast('⏹️ Recording stopped');
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

    // --- Summarize with Gemini ---
    async function summarizeTranscript() {
        const text = finalTranscript.trim();
        if (!text) {
            showToast('📝 No transcript to summarize');
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
        summarizeLabel.textContent = 'Summarizing...';
        showToast('✨ Analyzing your speech with AI...');

        try {
            const response = await fetch('/api/summarize', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: text })
            });

            if (!response.ok) {
                const errData = await response.json();
                throw new Error(errData.error || 'Server error');
            }

            const data = await response.json();

            // Store in localStorage and navigate
            localStorage.setItem('voicescribe_summary', JSON.stringify(data));
            window.location.href = 'summary.html';

        } catch (err) {
            console.error('[VoiceScribe] Summarize error:', err);
            showToast('⚠️ ' + err.message);
        } finally {
            isSummarizing = false;
            summarizeIcon.style.display = 'inline';
            summarizeSpinner.style.display = 'none';
            summarizeLabel.textContent = 'Summarize';
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

    langSelect.addEventListener('change', function () {
        if (isRecording) {
            stopRecording();
            setTimeout(function () {
                startRecording();
            }, 300);
            showToast('🌐 Language changed to ' + langSelect.options[langSelect.selectedIndex].text);
        }
    });

    document.addEventListener('keydown', function (e) {
        if (e.code === 'Space' && e.target === document.body) {
            e.preventDefault();
            btnRecord.click();
        }
    });

})();
