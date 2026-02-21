require('dotenv').config();
const express = require('express');
const path = require('path');
const Groq = require('groq-sdk');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Initialize Groq
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Initialize Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// Serve index.html at root
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// POST /api/summarize — Summarize transcript with Groq (llama-3.3-70b-versatile)
app.post('/api/summarize', async (req, res) => {
    try {
        const { text } = req.body;

        if (!text || text.trim().length === 0) {
            return res.status(400).json({ error: 'No transcript text provided.' });
        }

        const wordCount = text.trim().split(/\s+/).length;

        const chatCompletion = await groq.chat.completions.create({
            messages: [
                {
                    role: 'system',
                    content: `You are an expert counseling speech analyst. You analyze speech transcripts from counseling sessions or personal reflections. 
                    You must extract key counseling metrics and provide a comprehensive summary.
                    Always respond with valid JSON only — no markdown, no code fences, no extra text.`
                },
                {
                    role: 'user',
                    content: `Analyze the following speech transcript and return a structured JSON response.

TRANSCRIPT:
"""
${text.trim()}
"""

Return ONLY valid JSON with this exact structure:
{
  "summary": "A concise 2-3 sentence summary capturing the core message of the speech",
  "keyPoints": ["Key point 1", "Key point 2", "Key point 3", "...more if applicable"],
  "analysis": "A detailed 4-6 sentence analysis covering the main themes, arguments, tone, and notable aspects of the speech.",
  "sentiment": "positive" or "negative" or "neutral" or "mixed",
  "sentimentExplanation": "A clear explanation of why this sentiment was detected, referencing specific parts of the speech",
  "topicsDetected": ["topic1", "topic2", "topic3"],
  "wordCount": ${wordCount},
  "counselingStats": {
    "name": "User's Name (if mentioned, otherwise 'Unknown')",
    "age": "User's Age (if mentioned, otherwise 'Unknown')",
    "presentingProblem": "The main issue or challenge described",
    "reasonForCounseling": "Why the user is seeking help or speaking now",
    "lastMajorProgress": "Any mentioned improvement, breakthrough, or positive step",
    "currentEmotionalState": "One word emotion (e.g., Anxious, Hopeful, Frustrated)"
  }
}`
                }
            ],
            model: 'llama-3.3-70b-versatile',
            temperature: 0.3,
            max_tokens: 2048,
            response_format: { type: 'json_object' }
        });

        const responseText = chatCompletion.choices[0]?.message?.content || '';

        // Parse the JSON response
        let parsedData;
        try {
            parsedData = JSON.parse(responseText);
        } catch (parseError) {
            console.error('[Groq] JSON parse error:', parseError.message);
            // Try extracting JSON from code fences if present
            const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
            if (jsonMatch) {
                parsedData = JSON.parse(jsonMatch[1].trim());
            } else {
                parsedData = {
                    summary: responseText,
                    keyPoints: [],
                    analysis: '',
                    sentiment: 'neutral',
                    sentimentExplanation: 'Could not determine sentiment.',
                    topicsDetected: [],
                    wordCount: wordCount,
                    counselingStats: {
                         name: "Unknown",
                         age: "Unknown",
                         presentingProblem: "Analysis Failed",
                         reasonForCounseling: "N/A",
                         lastMajorProgress: "N/A",
                         currentEmotionalState: "Neutral"
                    }
                };
            }
        }

        // Ensure wordCount and originalText are present
        parsedData.wordCount = parsedData.wordCount || wordCount;
        parsedData.originalText = text.trim();

        res.json(parsedData);

    } catch (err) {
        console.error('[Groq] API Error:', err.message);
        res.status(500).json({
            error: 'Failed to summarize. Please try again.',
            details: err.message
        });
    }
});

// POST /api/session — Save session to Supabase
app.post('/api/session', async (req, res) => {
    try {
        const { userId, transcript, summary, analysisJson } = req.body;

        const { data, error } = await supabase
            .from('sessions')
            .insert([
                { user_id: userId, transcript, summary, analysis_json: analysisJson }
            ])
            .select();

        if (error) throw error;

        res.json({ success: true, data });
    } catch (err) {
        console.error('[Supabase] Save Error:', err.message);
        res.status(500).json({ error: 'Failed to save session.', details: err.message });
    }
});

// GET /api/history/:userId — Fetch user history
app.get('/api/history/:userId', async (req, res) => {
    try {
        const { userId } = req.params;

        const { data, error } = await supabase
            .from('sessions')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false });

        if (error) throw error;

        res.json(data);
    } catch (err) {
        console.error('[Supabase] History Error:', err.message);
        res.status(500).json({ error: 'Failed to fetch history.', details: err.message });
    }
});

// GET /api/profile/:userId — Generate aggregated profile analysis
app.get('/api/profile/:userId', async (req, res) => {
    try {
        const { userId } = req.params;

        // Fetch last 10 sessions to prevent context overflow
        const { data: sessions, error } = await supabase
            .from('sessions')
            .select('analysis_json, created_at')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(10);

        if (error) throw error;

        if (!sessions || sessions.length === 0) {
            return res.status(404).json({ message: 'No sessions found for this user.' });
        }

        // Prepare data for Groq
        const sessionSummaries = sessions.map((s, i) => {
            const stats = s.analysis_json.counselingStats || {};
            return `Session ${i + 1} (${new Date(s.created_at).toLocaleDateString()}):
            - Problem: ${stats.presentingProblem}
            - Progress: ${stats.lastMajorProgress}
            - Emotion: ${stats.currentEmotionalState}
            - Sentiment: ${s.analysis_json.sentiment}
            - Topics: ${s.analysis_json.topicsDetected.join(', ')}`;
        }).join('\n\n');

        const chatCompletion = await groq.chat.completions.create({
            messages: [
                {
                    role: 'system',
                    content: `You are an expert counseling supervisor. You analyze multiple past sessions of a client to build a comprehensive profile and track progress.`
                },
                {
                    role: 'user',
                    content: `Analyze the following history of counseling sessions for a user and provide a stacked analysis.

HISTORY:
${sessionSummaries}

Return valid JSON:
{
  "overallProgress": "Summary of user's journey and improvements over time.",
  "recurringThemes": ["Theme 1", "Theme 2"],
  "persistentChallenges": "Issues that keep coming up.",
  "psychologicalProfile": "A brief behavioral/psychological profile of the user.",
  "recommendedFocus": "What the user should focus on next."
}`
                }
            ],
            model: 'llama-3.3-70b-versatile',
            temperature: 0.3
        });

        // Safe JSON parsing
        const responseText = chatCompletion.choices[0]?.message?.content || '';
        let profileAnalysis;
        try {
             const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
             if (jsonMatch) {
                 profileAnalysis = JSON.parse(jsonMatch[1].trim());
             } else {
                 profileAnalysis = JSON.parse(responseText);
             }
        } catch (e) {
            profileAnalysis = { overallProgress: responseText };
        }

        res.json(profileAnalysis);

    } catch (err) {
        console.error('[Profile Analysis] Error:', err.message);
        res.status(500).json({ error: 'Failed to generate profile.', details: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`✅ EchoScribe server running at http://localhost:${PORT}`);
});
