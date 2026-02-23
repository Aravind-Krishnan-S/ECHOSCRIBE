const Groq = require('groq-sdk');
const { AppError } = require('../middleware/errorHandler');

let groq = null;

function initGroq(apiKey) {
    groq = new Groq({ apiKey });
    return groq;
}

// --- Clinical SOAP Summarization ---

async function summarizeTranscript(text, lang = 'en', retries = 2) {
    if (!groq) throw new AppError('AI service not initialized', 500);

    const wordCount = text.trim().split(/\s+/).length;

    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const chatCompletion = await groq.chat.completions.create({
                messages: [
                    {
                        role: 'system',
                        content: `You are an expert clinical documentation specialist trained in SOAP note formatting for mental health counseling sessions. 
You analyze speech transcripts from counseling sessions and produce structured clinical documentation.
The transcript may contain speaker labels like "Counsellor:" and "Patient:" (or "Person 1:" / "Person 2:"). Use these to understand the dialogue flow.
You MUST respond with valid JSON only. No markdown, no code fences, no extra text.
Be thorough but clinically precise. Do not fabricate information not present in the transcript.
If information for a field is not available from the transcript, use "Not discussed" or empty arrays as appropriate.
You must also generate a patient-facing communication summary translated into the locale: ${lang}.`
                    },
                    {
                        role: 'user',
                        content: `Analyze the following counseling session transcript and return a STRICT clinical SOAP note in JSON format.

TRANSCRIPT:
"""
${text.trim()}
"""

Return ONLY valid JSON with this exact structure:
{
  "soap": {
    "subjective": "Client's reported symptoms, feelings, concerns, and history as stated in their own words. Include chief complaint and relevant history.",
    "objective": "Observable behaviors, affect, appearance cues noted from speech patterns. Include speech rate, coherence, emotional expression.",
    "assessment": "Clinical assessment of the client's current state, diagnostic impressions, and clinical reasoning. Identify patterns and risk factors.",
    "plan": "Recommended next steps, therapeutic interventions to continue, referrals, and follow-up actions."
  },
  "risk_assessment": {
    "suicidal_ideation": false,
    "self_harm_risk": "low",
    "notes": "Brief risk assessment notes based on transcript content"
  },
  "auto_booking": {
    "needs_follow_up": false,
    "suggested_timeframe": "string (e.g., '2 weeks', 'next Tuesday' or 'None')",
    "reason": "string"
  },
  "referral_form": {
    "referral_needed": false,
    "specialty_or_service": "string",
    "reason": "string"
  },
  "patient_communication": {
    "instructions_english": "A warm, patient-friendly summary and instructions for the patient to take home, in English.",
    "instructions_translated": "The exact same patient-friendly summary and instructions, translated to language code: ${lang}."
  },
  "diagnostic_impressions": ["Possible diagnostic considerations based on presentation"],
  "interventions_used": ["Therapeutic interventions or techniques evident in the session"],
  "medication_changes": ["Any medication-related discussions or changes mentioned"],
  "progress_indicators": ["Signs of progress, improvement, or regression noted"],
  "emotional_tone": "Primary emotional tone of the session",
  "topics": ["Key topics discussed in the session"],
  "confidence_score": 0.85,
  "counselingStats": {
    "name": "Client name if mentioned, otherwise Unknown",
    "age": "Client age if mentioned, otherwise Unknown",
    "presentingProblem": "The main issue described",
    "reasonForCounseling": "Why the client is seeking help",
    "lastMajorProgress": "Any recent positive developments",
    "currentEmotionalState": "One-word emotion descriptor"
  },
  "wordCount": ${wordCount},
  "originalText": ""
}`
                    }
                ],
                model: 'llama-3.3-70b-versatile',
                temperature: 0.3,
                max_tokens: 3000,
                response_format: { type: 'json_object' },
            });

            const responseText = chatCompletion.choices[0]?.message?.content || '';

            let parsedData;
            try {
                parsedData = JSON.parse(responseText);
            } catch (parseError) {
                // Try extracting JSON from code fences if present
                const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
                if (jsonMatch) {
                    parsedData = JSON.parse(jsonMatch[1].trim());
                } else {
                    throw parseError;
                }
            }

            // Ensure required fields
            parsedData.wordCount = parsedData.wordCount || wordCount;
            parsedData.originalText = text.trim();

            // Normalize missing fields
            parsedData.soap = parsedData.soap || { subjective: '', objective: '', assessment: '', plan: '' };
            parsedData.risk_assessment = parsedData.risk_assessment || { suicidal_ideation: false, self_harm_risk: 'low', notes: '' };
            parsedData.auto_booking = parsedData.auto_booking || { needs_follow_up: false, suggested_timeframe: 'None', reason: '' };
            parsedData.referral_form = parsedData.referral_form || { referral_needed: false, specialty_or_service: 'None', reason: '' };
            parsedData.patient_communication = parsedData.patient_communication || { instructions_english: 'No instructions generated.', instructions_translated: 'No translated instructions generated.' };
            parsedData.diagnostic_impressions = parsedData.diagnostic_impressions || [];
            parsedData.interventions_used = parsedData.interventions_used || [];
            parsedData.medication_changes = parsedData.medication_changes || [];
            parsedData.progress_indicators = parsedData.progress_indicators || [];
            parsedData.emotional_tone = parsedData.emotional_tone || 'neutral';
            parsedData.topics = parsedData.topics || parsedData.topicsDetected || [];
            parsedData.confidence_score = parsedData.confidence_score || 0.0;
            parsedData.counselingStats = parsedData.counselingStats || {};

            return parsedData;
        } catch (err) {
            if (attempt < retries) {
                console.warn(`[AI Service] Attempt ${attempt + 1} failed, retrying... Error: ${err.message}`);
                continue;
            }
            throw new AppError('Failed to analyze transcript. Please try again.', 500, err.message);
        }
    }
}

// --- Speech-to-Text via Groq Whisper ---

async function transcribeAudio(filePath, lang = 'en') {
    if (!groq) throw new AppError('AI service not initialized', 500);

    const fs = require('fs');

    // Map language codes to ensure correct ISO 639-1 format
    const langMap = {
        'en': 'en', 'hi': 'hi', 'ml': 'ml', 'ta': 'ta',
        'es': 'es', 'fr': 'fr', 'de': 'de', 'ja': 'ja',
        'ko': 'ko', 'zh': 'zh', 'pt': 'pt', 'ar': 'ar',
    };
    const whisperLang = langMap[lang] || lang;

    // Language-specific prompts improve accuracy by conditioning the model
    const langPrompts = {
        'en': 'This is a counseling session conversation in English between a counselor and a patient.',
        'hi': 'यह एक परामर्श सत्र है। काउंसलर और मरीज़ हिंदी में बात कर रहे हैं।',
        'ml': 'ഇത് ഒരു കൗൺസിലിംഗ് സെഷൻ ആണ്. കൗൺസിലറും രോഗിയും മലയാളത്തിൽ സംസാരിക്കുന്നു.',
        'ta': 'இது ஒரு ஆலோசனை அமர்வு. ஆலோசகரும் நோயாளியும் தமிழில் பேசுகிறார்கள்.',
    };
    const prompt = langPrompts[whisperLang] || `This is a counseling session conversation in the selected language.`;

    // Use whisper-large-v3 for best multilingual accuracy (not turbo)
    const transcription = await groq.audio.transcriptions.create({
        file: fs.createReadStream(filePath),
        model: 'whisper-large-v3',
        language: whisperLang,
        prompt: prompt,
        response_format: 'verbose_json',
        timestamp_granularities: ['segment'],
    });

    // Return segments with timestamps for speaker diarization
    const segments = (transcription.segments || []).map(seg => ({
        start: seg.start,
        end: seg.end,
        text: (seg.text || '').trim(),
    }));

    return {
        text: transcription.text || '',
        segments,
    };
}

// --- Speaker Identification via LLM ---

async function identifySpeakers(diarizedTranscript) {
    if (!groq) throw new AppError('AI service not initialized', 500);

    const chatCompletion = await groq.chat.completions.create({
        messages: [
            {
                role: 'system',
                content: `You are an expert at analyzing counseling session transcripts. Given a transcript with "Person 1" and "Person 2" labels, determine which person is the Therapist and which is the Patient.

Clues to identify the Therapist:
- Asks open-ended questions ("How does that make you feel?", "Tell me more about...")
- Uses therapeutic language ("I hear you", "Let's explore that")
- Guides the conversation, summarizes, reflects
- Uses professional/clinical terminology

Clues to identify the Patient:
- Describes personal experiences, feelings, problems
- Responds to questions rather than asking clinical ones
- Shares emotional content, concerns, symptoms
- Seeks advice or help

You MUST respond with valid JSON only.`
            },
            {
                role: 'user',
                content: `Analyze this counseling transcript and identify which person is the Therapist and which is the Patient.

TRANSCRIPT:
"""
${diarizedTranscript}
"""

Return ONLY valid JSON:
{
  "person1_role": "Therapist" or "Patient",
  "person2_role": "Therapist" or "Patient",
  "confidence": 0.0 to 1.0,
  "reasoning": "Brief explanation of why"
}`
            }
        ],
        model: 'llama-3.3-70b-versatile',
        temperature: 0.1,
        max_tokens: 500,
        response_format: { type: 'json_object' },
    });

    const responseText = chatCompletion.choices[0]?.message?.content || '';
    try {
        return JSON.parse(responseText);
    } catch (e) {
        return { person1_role: 'Person 1', person2_role: 'Person 2', confidence: 0, reasoning: 'Could not determine roles' };
    }
}

// --- Longitudinal Profile Analysis ---

async function generateProfile(sessions) {
    if (!groq) throw new AppError('AI service not initialized', 500);

    const sessionSummaries = sessions.map((s, i) => {
        const analysis = s.analysis_json || {};
        const stats = analysis.counselingStats || {};
        const soap = analysis.soap || {};
        const risk = analysis.risk_assessment || {};

        return `Session ${i + 1} (${new Date(s.created_at).toLocaleDateString()}):
- Subjective: ${soap.subjective || 'N/A'}
- Assessment: ${soap.assessment || 'N/A'}
- Problem: ${stats.presentingProblem || 'N/A'}
- Progress: ${stats.lastMajorProgress || 'N/A'}
- Emotion: ${stats.currentEmotionalState || 'N/A'}
- Emotional Tone: ${analysis.emotional_tone || 'N/A'}
- Risk Level: ${risk.self_harm_risk || 'N/A'}
- Topics: ${(analysis.topics || []).join(', ') || 'N/A'}
- Medications: ${(analysis.medication_changes || []).join(', ') || 'None'}
- Interventions: ${(analysis.interventions_used || []).join(', ') || 'N/A'}`;
    }).join('\n\n');

    const chatCompletion = await groq.chat.completions.create({
        messages: [
            {
                role: 'system',
                content: `You are an expert clinical supervisor analyzing longitudinal counseling data. You identify patterns, assess progress, and provide evidence-based recommendations. Respond with valid JSON only.`
            },
            {
                role: 'user',
                content: `Analyze the following chronological history of counseling sessions and generate a comprehensive longitudinal client profile.

SESSION HISTORY:
${sessionSummaries}

Return ONLY valid JSON:
{
  "journey_summary": "Comprehensive narrative of the client's therapeutic journey across all sessions.",
  "recurring_themes": ["Theme 1", "Theme 2"],
  "emotional_trend": "improving|stable|declining",
  "emotional_trend_data": [{"session": 1, "score": 5, "label": "Anxious"}, ...],
  "risk_trend": "Description of how risk levels have changed over time",
  "risk_trend_data": [{"session": 1, "level": "low"}, ...],
  "topic_frequency": [{"topic": "anxiety", "count": 5}, ...],
  "persistent_challenges": "Issues that keep recurring across sessions",
  "recommended_focus": ["Specific actionable recommendations"],
  "treatment_effectiveness_score": 65,
  "psychological_profile": "Brief behavioral/psychological profile of the client"
}`
            }
        ],
        model: 'llama-3.3-70b-versatile',
        temperature: 0.3,
        max_tokens: 3000,
        response_format: { type: 'json_object' },
    });

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
        profileAnalysis = { journey_summary: responseText, error: 'Partial parse' };
    }

    return profileAnalysis;
}

// --- LLM-based Speaker Diarization ---

async function diarizeTranscript(rawText) {
    if (!groq) throw new AppError('AI service not initialized', 500);

    const chatCompletion = await groq.chat.completions.create({
        messages: [
            {
                role: 'system',
                content: `You are an expert at analyzing conversation transcripts. Given a raw transcript of a conversation between TWO people, identify speaker turns and split the text into alternating speakers.

Rules:
- There are exactly 2 speakers: "Person 1" and "Person 2"
- Person 1 is whoever speaks first
- Identify speaker changes by analyzing: question-answer patterns, topic shifts, response cues, greetings, conversational flow
- Each turn should contain what one person says before the other person responds
- Do NOT merge multiple turns from different speakers
- Do NOT fabricate or modify the text — use the exact words from the transcript
- If unsure about a split point, make your best guess based on conversational logic

You MUST respond with valid JSON only.`
            },
            {
                role: 'user',
                content: `Split this conversation transcript into speaker turns. Identify where one person stops speaking and the other responds.

RAW TRANSCRIPT:
"""
${rawText}
"""

Return ONLY valid JSON in this format:
{
  "turns": [
    { "speaker": 1, "text": "exact text from person 1" },
    { "speaker": 2, "text": "exact text from person 2" },
    { "speaker": 1, "text": "exact text from person 1" }
  ]
}`
            }
        ],
        model: 'llama-3.3-70b-versatile',
        temperature: 0.1,
        max_tokens: 4000,
        response_format: { type: 'json_object' },
    });

    const responseText = chatCompletion.choices[0]?.message?.content || '';
    try {
        const parsed = JSON.parse(responseText);
        return parsed.turns || [];
    } catch (e) {
        // Fallback: return entire text as single speaker
        return [{ speaker: 1, text: rawText }];
    }
}

module.exports = { initGroq, summarizeTranscript, generateProfile, transcribeAudio, identifySpeakers, diarizeTranscript };
