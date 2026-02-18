/* ============================================
   VoiceScribe — Summary Page Logic
   ============================================ */

(function () {
    'use strict';

    const summaryText = document.getElementById('summary-text');
    const keyPointsList = document.getElementById('key-points-list');
    const analysisText = document.getElementById('analysis-text');
    const sentimentExplanation = document.getElementById('sentiment-explanation');
    const statWords = document.getElementById('stat-words');
    const statDuration = document.getElementById('stat-duration');
    const statTopics = document.getElementById('stat-topics');
    const statSentiment = document.getElementById('stat-sentiment');
    const topicsSection = document.getElementById('topics-section');
    const topicsPills = document.getElementById('topics-pills');
    const originalTranscript = document.getElementById('original-transcript');
    const btnCopySummary = document.getElementById('btn-copy-summary');
    const toast = document.getElementById('toast');
    const toastMessage = document.getElementById('toast-message');

    let toastTimeout = null;

    // --- Load Data ---
    const raw = localStorage.getItem('voicescribe_summary');

    if (!raw) {
        window.location.href = '/';
        return;
    }

    let data;
    try {
        data = JSON.parse(raw);
    } catch (e) {
        window.location.href = '/';
        return;
    }

    // --- Render Summary ---
    summaryText.textContent = data.summary || 'No summary available.';

    // --- Render Key Points ---
    if (data.keyPoints && data.keyPoints.length > 0) {
        keyPointsList.innerHTML = '';
        data.keyPoints.forEach(function (point) {
            const li = document.createElement('li');
            li.textContent = point;
            keyPointsList.appendChild(li);
        });
    } else {
        keyPointsList.innerHTML = '<li>No key points extracted.</li>';
    }

    // --- Render Analysis ---
    analysisText.textContent = data.analysis || 'No detailed analysis available.';

    // --- Render Sentiment ---
    const sentiment = (data.sentiment || 'neutral').toLowerCase();
    const sentimentConfig = {
        positive: { emoji: '😊', color: '#00e676', bg: 'rgba(0, 230, 118, 0.15)' },
        negative: { emoji: '😟', color: '#ff4d6a', bg: 'rgba(255, 77, 106, 0.15)' },
        neutral: { emoji: '😐', color: '#8892b0', bg: 'rgba(136, 146, 176, 0.15)' },
        mixed: { emoji: '🤔', color: '#ffc107', bg: 'rgba(255, 193, 7, 0.15)' }
    };

    const sc = sentimentConfig[sentiment] || sentimentConfig.neutral;
    statSentiment.textContent = sc.emoji + ' ' + sentiment.charAt(0).toUpperCase() + sentiment.slice(1);
    statSentiment.style.background = sc.bg;
    statSentiment.style.color = sc.color;

    sentimentExplanation.textContent = data.sentimentExplanation || 'No sentiment details available.';

    // --- Render Stats ---
    const wc = data.wordCount || 0;
    statWords.textContent = wc.toLocaleString();

    // Estimate duration: ~150 words per minute average speaking rate
    const minutes = Math.floor(wc / 150);
    const seconds = Math.round((wc % 150) / 2.5);
    if (minutes > 0) {
        statDuration.textContent = minutes + 'm ' + seconds + 's';
    } else {
        statDuration.textContent = seconds + 's';
    }

    // --- Render Topics ---
    if (data.topicsDetected && data.topicsDetected.length > 0) {
        topicsSection.style.display = 'block';
        statTopics.textContent = data.topicsDetected.length;
        topicsPills.innerHTML = '';
        data.topicsDetected.forEach(function (topic) {
            const pill = document.createElement('span');
            pill.className = 'topic-pill';
            pill.textContent = topic;
            topicsPills.appendChild(pill);
        });
    } else {
        statTopics.textContent = '0';
    }

    // --- Render Original Transcript ---
    originalTranscript.textContent = data.originalText || 'No original text available.';

    // --- Copy Summary ---
    btnCopySummary.addEventListener('click', function () {
        let copyText = '📝 SPEECH SUMMARY\n\n';
        copyText += '💡 Summary:\n' + (data.summary || '') + '\n\n';

        if (data.keyPoints && data.keyPoints.length > 0) {
            copyText += '🎯 Key Points:\n';
            data.keyPoints.forEach(function (p, i) {
                copyText += '  ' + (i + 1) + '. ' + p + '\n';
            });
            copyText += '\n';
        }

        copyText += '🔍 Analysis:\n' + (data.analysis || '') + '\n\n';
        copyText += '💭 Sentiment: ' + (data.sentiment || 'neutral') + '\n';
        copyText += '📊 Words: ' + wc + '\n';

        navigator.clipboard.writeText(copyText).then(function () {
            showToast('✅ Summary copied to clipboard!');
        }).catch(function () {
            showToast('⚠️ Failed to copy');
        });
    });

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

})();
