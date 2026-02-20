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
    const btnSave = document.getElementById('btn-save');
    const btnAnalyzeProfile = document.getElementById('btn-analyze-profile');
    const historyList = document.getElementById('history-list');

    // Card Elements
    const cardName = document.getElementById('card-name');
    const cardLvl = document.getElementById('card-lvl');
    const cardProblem = document.getElementById('card-problem');
    const cardReason = document.getElementById('card-reason');
    const cardProgress = document.getElementById('card-progress');
    const cardMood = document.getElementById('card-mood');
    const cardAvatar = document.getElementById('card-avatar');

    const toast = document.getElementById('toast');
    const toastMessage = document.getElementById('toast-message');

    let toastTimeout = null;
    let charts = {}; // Store chart instances

    // User ID (Pseudo-Auth)
    let userId = localStorage.getItem('voicescribe_user_id');
    if (!userId) {
        userId = 'user_' + Math.random().toString(36).substr(2, 9);
        localStorage.setItem('voicescribe_user_id', userId);
    }

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

    // --- Render Card Data ---
    const stats = data.counselingStats || {};
    cardName.textContent = stats.name !== 'Unknown' ? stats.name : 'Seeker';
    // Calculate "Level" based on word count / 100 (Gamification)
    cardLvl.textContent = Math.floor(wc / 100) + 1;
    cardProblem.textContent = stats.presentingProblem || 'N/A';
    cardReason.textContent = stats.reasonForCounseling || 'N/A';
    cardProgress.textContent = stats.lastMajorProgress || 'None yet';
    cardMood.textContent = stats.currentEmotionalState || 'Neutral';

    // Dynamic Avatar based on emotion
    const avatars = {
        'Anxious': '😰', 'Hopeful': '🌟', 'Frustrated': '😤', 'Happy': '😊',
        'Sad': '😢', 'Confused': '😵', 'Neutral': '👤', 'Angry': '😠'
    };
    // Simple fuzzy match for avatar
    let avatar = '👤';
    const emotion = (stats.currentEmotionalState || '').toLowerCase();
    if (emotion.includes('anx')) avatar = avatars['Anxious'];
    else if (emotion.includes('hope')) avatar = avatars['Hopeful'];
    else if (emotion.includes('frust')) avatar = avatars['Frustrated'];
    else if (emotion.includes('hap') || emotion.includes('joy')) avatar = avatars['Happy'];
    else if (emotion.includes('sad')) avatar = avatars['Sad'];
    else if (emotion.includes('ang')) avatar = avatars['Angry'];
    cardAvatar.textContent = avatar;

    // --- Render Charts ---
    renderCharts(data);

    // --- Render Original Transcript ---
    originalTranscript.textContent = data.originalText || 'No original text available.';

    // --- Fetch History ---
    fetchHistory();

    // --- Event Listeners ---

    // Copy Summary
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

    // Save Session
    btnSave.addEventListener('click', async function () {
        btnSave.disabled = true;
        btnSave.innerHTML = '<span class="btn-icon">⏳</span> Saving...';

        try {
            const response = await fetch('/api/session', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userId: userId,
                    transcript: data.originalText,
                    summary: data.summary,
                    analysisJson: data
                })
            });

            if (response.ok) {
                showToast('✅ Session Saved!');
                fetchHistory(); // Refresh history
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

    // Analyze Profile
    btnAnalyzeProfile.addEventListener('click', async function () {
        btnAnalyzeProfile.disabled = true;
        btnAnalyzeProfile.textContent = 'Analyzing...';

        try {
            const response = await fetch(`/api/profile/${userId}`);
            const profileData = await response.json();

            if (response.ok) {
                // Show modal or alert with profile data (For now, simple alert)
                alert(`📊 PROFILE ANALYSIS\n\nProgress: ${profileData.overallProgress}\n\nFocus: ${profileData.recommendedFocus}`);
            } else {
                alert('Analysis failed: ' + profileData.message);
            }
        } catch (err) { console.error(err); alert('Failed to analyze profile.'); }
        finally {
            btnAnalyzeProfile.textContent = 'Analyze Profile';
            btnAnalyzeProfile.disabled = false;
        }
    });

    // --- Helper Functions ---

    function renderCharts(data) {
        // Topics Chart (Bar)
        const ctxTopics = document.getElementById('topicsChart').getContext('2d');
        // Mocking some "count" data for topics if not present, usually you'd aggregate history
        // For a single session, we just show 1 for each topic
        new Chart(ctxTopics, {
            type: 'bar',
            data: {
                labels: data.topicsDetected,
                datasets: [{
                    label: 'Relevance',
                    data: data.topicsDetected.map(() => 1), // Dummy value for presence
                    backgroundColor: 'rgba(75, 192, 192, 0.5)',
                    borderColor: 'rgba(75, 192, 192, 1)',
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                plugins: { legend: { display: false } },
                scales: { y: { beginAtZero: true, ticks: { display: false } } }
            }
        });

        // Sentiment Chart (Doughnut)
        const ctxSentiment = document.getElementById('sentimentChart').getContext('2d');
        const sentimentScore = { 'positive': 100, 'neutral': 50, 'negative': 20, 'mixed': 60 }[sentiment] || 50;

        new Chart(ctxSentiment, {
            type: 'doughnut',
            data: {
                labels: ['Positive', 'Negative', 'Neutral'],
                datasets: [{
                    data: sentiment === 'positive' ? [1, 0, 0] :
                        sentiment === 'negative' ? [0, 1, 0] :
                            sentiment === 'neutral' ? [0, 0, 1] : [0.5, 0, 0.5],
                    backgroundColor: ['#00e676', '#ff4d6a', '#8892b0']
                }]
            },
            options: {
                responsive: true,
                cutout: '70%',
                plugins: { legend: { position: 'bottom', labels: { color: '#fff' } } }
            }
        });
    }

    async function fetchHistory() {
        try {
            const response = await fetch(`/api/history/${userId}`);
            const history = await response.json();

            if (history && history.length > 0) {
                historyList.innerHTML = '';
                history.forEach(item => {
                    const div = document.createElement('div');
                    div.className = 'session-item';
                    const date = new Date(item.created_at).toLocaleDateString();
                    div.innerHTML = `
                        <div style="display:flex; justify-content:space-between; font-size:0.9rem; color:#e2e8f0; font-weight:600;">
                            <span>${date}</span>
                            <span>${item.analysis_json.counselingStats?.currentEmotionalState || 'Unknown'}</span>
                        </div>
                        <div style="font-size:0.8rem; color:#a0aec0; margin-top:0.3rem;">
                            ${item.summary.substring(0, 60)}...
                        </div>
                    `;
                    div.addEventListener('click', () => {
                        // Load this session into view
                        localStorage.setItem('voicescribe_summary', JSON.stringify(item.analysis_json));
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
