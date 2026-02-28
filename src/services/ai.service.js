const { GoogleGenerativeAI } = require('@google/generative-ai');
const { AppError } = require('../middleware/errorHandler');

let genAI = null;

function initGemini(apiKey) {
    genAI = new GoogleGenerativeAI(apiKey);
    return genAI;
}

function ensureGemini() {
    if (!genAI) {
        initGemini(process.env.GEMINI_API_KEY);
    }
    if (!genAI) throw new AppError('Gemini API not initialized. Set GEMINI_API_KEY.', 500);
}

// --- Clinical SOAP Summarization (Gemini) ---

async function summarizeTranscript(text, lang = 'en', mode = 'Therapy', retries = 2) {
    ensureGemini();

    const wordCount = text.trim().split(/\s+/).length;

    const modeConfig = {
        'Therapy': {
            role: "expert clinical documentation specialist trained in SOAP note formatting for mental health counseling sessions",
            structure: `
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
  }`,
            specialTracking: `
  "diagnostic_impressions": ["Possible diagnostic considerations based on presentation"],
  "interventions_used": ["Therapeutic interventions or techniques evident in the session"],
  "medication_changes": ["Any medication-related discussions or changes mentioned"],
  "progress_indicators": ["Signs of progress, improvement, or regression noted"],`
        },
        'Mentoring': {
            role: "higher-education mentoring professional trained in GROW coaching models for university students",
            structure: `
  "grow": {
    "goal": "What the mentee wants to achieve (Goal)",
    "reality": "Current academic/personal situation (Reality)",
    "options": "Brainstormed pathways and alternatives (Options)",
    "way_forward": "Actionable next steps committed to by the mentee (Way Forward)"
  },
  "risk_assessment": {
    "academic_burnout": false,
    "severe_distress_risk": "low",
    "notes": "Brief risk assessment notes based on mentoring context and student well-being"
  }`,
            specialTracking: `
  "skill_progression": ["Skills advancing or needing work"],
  "goal_completion_rate": "Percentage or descriptive rate of past goals achieved",
  "motivational_state": "Mentee's current drive and motivation level",
  "action_items": ["Specific tasks the mentee agreed to do"],`
        }
    };

    const config = modeConfig[mode] || modeConfig['Therapy'];

    const systemInstruction = `You are an ${config.role}. 
You analyze speech transcripts from sessions and produce structured documentation.
The transcript may contain speaker labels like "Counsellor:", "Patient:", "Mentor:", or "Mentee:". Use these to understand the dialogue flow.
You MUST respond with valid JSON only. No markdown, no code fences, no extra text.
Be thorough but precise. Do not fabricate information not present in the transcript.
If information for a field is not available from the transcript, use "Not discussed" or empty arrays as appropriate.
You must also generate a client-facing communication summary translated into the locale: ${lang}.`;

    const userPrompt = `Analyze the following session transcript and return a STRICT structured note in JSON format.

TRANSCRIPT:
"""
${text.trim()}
"""

Return ONLY valid JSON with this exact structure:
{${config.structure}
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
    "instructions_english": "A warm, supportive summary and instructions for the individual to take home, in English.",
    "instructions_translated": "The exact same supportive summary and instructions, translated to language code: ${lang}."
  },${config.specialTracking}
  "emotional_tone": "Primary emotional tone of the session",
  "topics": ["Key topics discussed in the session"],
  "confidence_score": 0.85,
  "counselingStats": {
    "name": "Individual name if mentioned, otherwise Unknown",
    "age": "Individual age if mentioned, otherwise Unknown",
    "presentingProblem": "The main issue described",
    "reasonForCounseling": "Why the individual is seeking help/mentorship",
    "lastMajorProgress": "Any recent positive developments",
    "currentEmotionalState": "One-word emotion descriptor"
  },
  "wordCount": ${wordCount},
  "originalText": ""
}`;

    const model = genAI.getGenerativeModel({
        model: "gemini-2.0-flash",
        systemInstruction,
        generationConfig: {
            temperature: 0.3,
            responseMimeType: "application/json"
        }
    });

    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const result = await model.generateContent(userPrompt);
            const response = await result.response;
            const responseText = response.text();

            let parsedData;
            try {
                parsedData = JSON.parse(responseText);
            } catch (parseError) {
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

            // Normalize missing fields based on mode
            if (mode === 'Therapy') {
                parsedData.soap = parsedData.soap || { subjective: '', objective: '', assessment: '', plan: '' };
                parsedData.risk_assessment = parsedData.risk_assessment || { suicidal_ideation: false, self_harm_risk: 'low', notes: '' };
                parsedData.diagnostic_impressions = parsedData.diagnostic_impressions || [];
                parsedData.interventions_used = parsedData.interventions_used || [];
                parsedData.medication_changes = parsedData.medication_changes || [];
                parsedData.progress_indicators = parsedData.progress_indicators || [];
            } else {
                parsedData.grow = parsedData.grow || { goal: '', reality: '', options: '', way_forward: '' };
                parsedData.risk_assessment = parsedData.risk_assessment || { academic_burnout: false, severe_distress_risk: 'low', notes: '' };
                parsedData.skill_progression = parsedData.skill_progression || [];
                parsedData.action_items = parsedData.action_items || [];
                parsedData.goal_completion_rate = parsedData.goal_completion_rate || 'Unknown';
                parsedData.motivational_state = parsedData.motivational_state || 'Unknown';
            }

            parsedData.auto_booking = parsedData.auto_booking || { needs_follow_up: false, suggested_timeframe: 'None', reason: '' };
            parsedData.referral_form = parsedData.referral_form || { referral_needed: false, specialty_or_service: 'None', reason: '' };
            parsedData.patient_communication = parsedData.patient_communication || { instructions_english: 'No instructions generated.', instructions_translated: 'No translated instructions generated.' };

            parsedData.emotional_tone = parsedData.emotional_tone || 'neutral';
            parsedData.topics = parsedData.topics || parsedData.topicsDetected || [];
            parsedData.confidence_score = parsedData.confidence_score || 0.0;
            parsedData.counselingStats = parsedData.counselingStats || {};

            return parsedData;
        } catch (err) {
            if (attempt < retries) {
                console.warn(`[Gemini Summarize] Attempt ${attempt + 1} failed, retrying... Error: ${err.message}`);
                continue;
            }
            console.error('[Gemini Summarize] All attempts failed:', err.message);
            throw new AppError('Failed to analyze transcript: ' + (err.message || 'Unknown error'), 500);
        }
    }
}

// --- Speech-to-Text via Gemini 2.0 Flash ---

async function transcribeWithGemini(audioBuffer, mimeType, lang = 'en') {
    ensureGemini();

    const model = genAI.getGenerativeModel({
        model: "gemini-2.0-flash",
        generationConfig: {
            temperature: 0
        },
        systemInstruction: `
    You are a highly accurate multilingual transcription engine.
    Priority languages in order: Malayalam, English (Indian accent), Hindi.
    Secondary languages: Tamil, Telugu, Bengali, and other Indian languages.
    
    Rules:
    - Transcribe every word exactly as spoken — do not paraphrase or summarise
    - For code-switched speech (Malayalam+English, Hindi+English), preserve the 
      exact language used for each phrase — do not normalise everything to English
    - Proper nouns, names, and technical terms: transcribe phonetically if unsure,
      do not guess anglicised spellings
    - Filler words (um, uh, enna, athe, matlab) should be omitted unless they carry meaning
    - If a word is genuinely inaudible, write [inaudible] — do not guess
    - Do not add punctuation that wasn't implied by the speaker's prosody
    - Output only the transcript text — no labels, no timestamps, no explanation
  `
    });

    const prompt = "Please transcribe this audio exactly as instructed.";

    const audioPart = {
        inlineData: {
            data: audioBuffer.toString('base64'),
            mimeType: mimeType
        }
    };

    try {
        const result = await model.generateContent([prompt, audioPart]);
        const response = await result.response;
        return response.text();
    } catch (err) {
        console.error('[Gemini STT] Full Error:', err.message, err.stack);
        throw new AppError('Gemini transcription failed: ' + (err.message || 'Unknown error'), 500);
    }
}

// --- Strict Role Identification via Gemini ---

async function identifyRoles(mergedTranscript, sessionMode = 'Therapy') {
    ensureGemini();

    let roleA, roleB;
    if (sessionMode === 'Therapy') {
        roleA = "Therapist"; roleB = "Patient";
    } else if (sessionMode === 'Mentoring') {
        roleA = "Mentor"; roleB = "Mentee";
    } else {
        roleA = "Counsellor"; roleB = "Patient";
    }

    const model = genAI.getGenerativeModel({
        model: "gemini-2.0-flash",
        generationConfig: {
            temperature: 0.1,
            responseMimeType: "application/json"
        }
    });

    const prompt = `You are a transcript analyst. Below is a conversation transcript with two speakers labelled speaker_0 and speaker_1. Based on the content, identify which speaker is the ${roleA} and which is the ${roleB}.

[ROLE_A] = ${roleA}
[ROLE_B] = ${roleB}

Reply with ONLY valid JSON mapping the exact speaker keys to the literal role names. Do NOT use any other labels. Ensure you map both speakers.
Example format:
{ "speaker_0": "${roleA}", "speaker_1": "${roleB}" }

TRANSCRIPT:
"""
${mergedTranscript}
"""`;

    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const jsonText = response.text();
        return JSON.parse(jsonText);
    } catch (err) {
        console.error('[Gemini Role ID] Error:', err.message);
        return { "speaker_0": roleA, "speaker_1": roleB };
    }
}

// --- Longitudinal Profile Analysis (Gemini) ---

async function generateProfile(sessions) {
    ensureGemini();

    let therapyCount = 0;
    let mentoringCount = 0;

    const sessionSummaries = sessions.map((s, i) => {
        const analysis = s.analysis_json || {};
        const stats = analysis.counselingStats || {};
        const soap = analysis.soap || {};
        const grow = analysis.grow || {};
        const risk = analysis.risk_assessment || {};
        const isMentoring = s.session_mode === 'Mentoring';

        if (isMentoring) {
            mentoringCount++;
            return `Session ${i + 1} (${new Date(s.created_at).toLocaleDateString()}) - Mentoring:
- Goal: ${grow.goal || 'N/A'}
- Reality: ${grow.reality || 'N/A'}
- Problem/Focus: ${stats.presentingProblem || 'N/A'}
- Progress: ${stats.lastMajorProgress || 'N/A'}
- Emotion: ${stats.currentEmotionalState || 'N/A'}
- Motivational State: ${analysis.motivational_state || 'N/A'}
- Burnout Risk: ${risk.academic_burnout ? 'High' : 'Low'}
- Topics: ${(analysis.topics || []).join(', ') || 'N/A'}
- Skills Working On: ${(analysis.skill_progression || []).join(', ') || 'N/A'}
- Action Items: ${(analysis.action_items || []).join(', ') || 'N/A'}
- Notes: ${risk.notes || 'N/A'}`;
        } else {
            therapyCount++;
            return `Session ${i + 1} (${new Date(s.created_at).toLocaleDateString()}) - Therapy:
- Subjective: ${soap.subjective || 'N/A'}
- Assessment: ${soap.assessment || 'N/A'}
- Problem: ${stats.presentingProblem || 'N/A'}
- Progress: ${stats.lastMajorProgress || 'N/A'}
- Emotion: ${stats.currentEmotionalState || 'N/A'}
- Emotional Tone: ${analysis.emotional_tone || 'N/A'}
- Risk Level: ${risk.self_harm_risk || 'N/A'}
- Topics: ${(analysis.topics || []).join(', ') || 'N/A'}
- Medications: ${(analysis.medication_changes || []).join(', ') || 'None'}
- Interventions: ${(analysis.interventions_used || []).join(', ') || 'N/A'}
- Notes: ${risk.notes || 'N/A'}`;
        }
    }).join('\n\n');

    const dominantMode = mentoringCount > therapyCount ? 'Mentoring' : 'Therapy';

    const systemMsg = dominantMode === 'Therapy'
        ? `You are an expert clinical supervisor analyzing longitudinal counseling data. You identify patterns, assess progress, and provide evidence-based recommendations. Respond with valid JSON only.`
        : `You are an expert higher-education mentor advising on longitudinal student progression. You identify academic patterns, assess skill mastery, evaluate burnout risks, and provide strategic action-oriented recommendations. Respond with valid JSON only.`;

    const userMsgFocus = dominantMode === 'Therapy'
        ? `Analyze the following chronological history of counseling sessions and generate a comprehensive longitudinal client profile.`
        : `Analyze the following chronological history of mentoring sessions and generate a comprehensive longitudinal student profile.`;

    const jsonSchema = dominantMode === 'Therapy'
        ? `{
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
        : `{
  "journey_summary": "Comprehensive narrative of the student's academic and personal progression.",
  "recurring_themes": ["Theme 1", "Theme 2"],
  "emotional_trend": "improving|stable|declining",
  "emotional_trend_data": [{"session": 1, "score": 5, "label": "Stressed"}, ...],
  "risk_trend": "Description of burnout or distress risk over time",
  "risk_trend_data": [{"session": 1, "level": "low"}, ...],
  "topic_frequency": [{"topic": "time management", "count": 5}, ...],
  "persistent_challenges": "Academic or personal issues that keep recurring",
  "recommended_focus": ["Specific actionable recommendations for skill building"],
  "treatment_effectiveness_score": 65,
  "psychological_profile": "Brief profile of the student's motivational and behavioral state"
}`;

    const model = genAI.getGenerativeModel({
        model: "gemini-2.0-flash",
        systemInstruction: systemMsg,
        generationConfig: {
            temperature: 0.3,
            responseMimeType: "application/json"
        }
    });

    try {
        const result = await model.generateContent(`${userMsgFocus}

SESSION HISTORY:
${sessionSummaries}

Return ONLY valid JSON:
${jsonSchema}`);

        const response = await result.response;
        const responseText = response.text();

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
    } catch (err) {
        console.error('[Gemini Profile] Error:', err.message);
        throw new AppError('Profile generation failed: ' + (err.message || 'Unknown error'), 500);
    }
}

// --- LLM-based Speaker Diarization (Gemini) ---

async function diarizeTranscript(rawText) {
    ensureGemini();

    const model = genAI.getGenerativeModel({
        model: "gemini-2.0-flash",
        systemInstruction: `You are an expert at analyzing conversation transcripts. Given a raw transcript of a conversation between TWO people, identify speaker turns and split the text into alternating speakers.

Rules:
- There are exactly 2 speakers: "Person 1" and "Person 2"
- Person 1 is whoever speaks first
- Identify speaker changes by analyzing: question-answer patterns, topic shifts, response cues, greetings, conversational flow
- Each turn should contain what one person says before the other person responds
- Do NOT merge multiple turns from different speakers
- Do NOT fabricate or modify the text — use the exact words from the transcript
- If unsure about a split point, make your best guess based on conversational logic

You MUST respond with valid JSON only.`,
        generationConfig: {
            temperature: 0.1,
            responseMimeType: "application/json"
        }
    });

    try {
        const result = await model.generateContent(`Split this conversation transcript into speaker turns. Identify where one person stops speaking and the other responds.

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
}`);

        const response = await result.response;
        const responseText = response.text();
        const parsed = JSON.parse(responseText);
        return parsed.turns || [];
    } catch (e) {
        console.error('[Gemini Diarize] Error:', e.message);
        return [{ speaker: 1, text: rawText }];
    }
}

module.exports = { initGemini, summarizeTranscript, generateProfile, transcribeWithGemini, identifyRoles, diarizeTranscript };
