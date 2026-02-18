require('dotenv').config();
const express = require('express');
const path = require('path');
const Groq = require('groq-sdk');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Initialize Groq
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

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
                    content: `You are an expert speech analyst and summarizer. You analyze speech transcripts and provide comprehensive, well-structured summaries. Always respond with valid JSON only — no markdown, no code fences, no extra text.`
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
  "analysis": "A detailed 4-6 sentence analysis covering the main themes, arguments, tone, and notable aspects of the speech. Be thorough and insightful.",
  "sentiment": "positive" or "negative" or "neutral" or "mixed",
  "sentimentExplanation": "A clear explanation of why this sentiment was detected, referencing specific parts of the speech",
  "topicsDetected": ["topic1", "topic2", "topic3"],
  "wordCount": ${wordCount}
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
                    wordCount: wordCount
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

app.listen(PORT, () => {
    console.log(`✅ VoiceScribe server running at http://localhost:${PORT}`);
});
