const { GoogleGenerativeAI } = require('@google/generative-ai');
const { AppError } = require('../middleware/errorHandler');
const { geminiPool } = require('./gemini-pool');
const fallback = require('./groq-fallback');

// Legacy single-key init — now delegates to the pool
function initGemini(apiKeyOrKeys) {
    const keys = Array.isArray(apiKeyOrKeys) ? apiKeyOrKeys : [apiKeyOrKeys];
    geminiPool.init(keys);
}

function ensureGemini() {
    if (geminiPool.getStatus().totalKeys === 0) {
        // Fallback: discover all Gemini keys from env
        const keys = [];
        const seen = new Set();
        // Comma-separated
        (process.env.GEMINI_API_KEYS || '').split(',').forEach(k => {
            const t = k.trim(); if (t && !seen.has(t)) { seen.add(t); keys.push(t); }
        });
        // Single key
        const single = (process.env.GEMINI_API_KEY || '').trim();
        if (single && !seen.has(single)) { seen.add(single); keys.push(single); }
        // Numbered keys (1_GEMINI_API_KEY, etc.)
        Object.keys(process.env).forEach(envKey => {
            if (/gemini_api_key/i.test(envKey) && envKey !== 'GEMINI_API_KEY' && envKey !== 'GEMINI_API_KEYS') {
                const t = process.env[envKey]?.trim();
                if (t && !seen.has(t)) { seen.add(t); keys.push(t); }
            }
        });
        if (keys.length === 0) throw new AppError('No Gemini API keys found. Set GEMINI_API_KEY, GEMINI_API_KEYS, or numbered keys like 1_GEMINI_API_KEY.', 500);
        geminiPool.init(keys);
    }
}

function getModel(modelName = 'gemini-2.0-flash') {
    ensureGemini();
    return geminiPool.getModel(modelName);
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

    const model = geminiPool.getModel({
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
            parsedData._provider = 'Gemini 2.0 Flash';

            geminiPool.reportSuccess();
            return parsedData;
        } catch (err) {
            geminiPool.reportError(err.message || '');
            if (attempt < retries) {
                console.warn(`[Gemini Summarize] Attempt ${attempt + 1} failed, retrying... Error: ${err.message}`);
                continue;
            }

            // --- FALLBACK: Groq Llama 3.3 ---
            if (fallback.isAvailable()) {
                console.warn('[Summarize] All Gemini attempts failed. Falling back to Groq Llama 3.3...');
                try {
                    const groqResponse = await fallback.chatCompletion(systemInstruction, userPrompt, true);
                    let parsedData = JSON.parse(groqResponse);
                    parsedData.wordCount = parsedData.wordCount || wordCount;
                    parsedData.originalText = text.trim();
                    parsedData._provider = 'Groq Llama 3.3';
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
                    parsedData.topics = parsedData.topics || [];
                    parsedData.confidence_score = parsedData.confidence_score || 0.0;
                    parsedData.counselingStats = parsedData.counselingStats || {};
                    return parsedData;
                } catch (groqErr) {
                    console.error('[Groq Fallback] Also failed:', groqErr.message);
                }
            }

            console.error('[Summarize] All providers failed:', err.message);
            throw new AppError('Failed to analyze transcript: ' + (err.message || 'Unknown error'), 500);
        }
    }
}

// --- Speech-to-Text via Gemini 2.0 Flash ---

async function transcribeWithGemini(audioBuffer, mimeType, lang = 'en') {
    ensureGemini();

    const model = geminiPool.getModel({
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
        geminiPool.reportSuccess();
        return { text: response.text(), _provider: 'Gemini 2.0 Flash' };
    } catch (err) {
        geminiPool.reportError(err.message || '');

        // --- FALLBACK: Deepgram Nova-2 ---
        if (fallback.isDeepgramAvailable()) {
            console.warn('[Transcribe] Gemini failed. Falling back to Deepgram Nova-2...');
            try {
                const dgText = await fallback.transcribeAudioBuffer(audioBuffer, mimeType, lang);
                return { text: dgText, _provider: 'Deepgram Nova-2' };
            } catch (dgErr) {
                console.error('[Deepgram Fallback] Also failed:', dgErr.message);
            }
        }

        console.error('[Gemini STT] Full Error:', err.message, err.stack);
        throw new AppError('Gemini transcription failed: ' + (err.message || 'Unknown error'), 500);
    }
}

// --- Contextual Role Identification ---

/**
 * Compute contextual signals from Deepgram turns for smarter role classification.
 * Inspired by clinical NLP research:
 *  - Therapists/Mentors: ask more questions, use guiding language, shorter turns
 *  - Patients/Mentees: share personal narratives, longer turns, emotional language
 */
function computeSpeakerStats(turns) {
    const stats = {};

    turns.forEach(turn => {
        const spkId = turn.speaker;
        if (!stats[spkId]) {
            stats[spkId] = {
                totalWords: 0,
                totalTime: 0,
                turnCount: 0,
                questionCount: 0,
                clinicalTerms: 0,
                guidingPhrases: 0,
                emotionalPhrases: 0,
                firstTurnIndex: Infinity,
                text: ''
            };
        }
        const s = stats[spkId];
        const text = turn.text || '';
        const words = text.trim().split(/\s+/).length;

        s.totalWords += words;
        s.totalTime += (turn.end || 0) - (turn.start || 0);
        s.turnCount++;
        s.text += text + ' ';
        if (s.firstTurnIndex > turns.indexOf(turn)) s.firstTurnIndex = turns.indexOf(turn);

        // Count questions (? or question starters)
        s.questionCount += (text.match(/\?/g) || []).length;
        const qStarters = /\b(how|what|when|where|why|can you|could you|do you|have you|tell me|would you|are you|is there|did you)\b/gi;
        s.questionCount += (text.match(qStarters) || []).length;

        // Clinical/professional vocabulary (therapist/mentor markers)
        const clinicalWords = /\b(session|treatment|therapy|therapeutic|diagnosis|assessment|progress|intervention|coping|strategy|strategies|goals?|objectives?|homework|assignment|exercise|mindfulness|cognitive|behavioral|healing|recovery|resilience|support|referral|medication|dosage|schedule|follow.?up|appointment|check.?in|review|evaluation|reflect|explore|process|boundaries|self.?care|skills?|techniques?|resources?|action.?plan|timeline|milestones?|curriculum|academic|semester|coursework|research|professor|faculty|advisor|gpa|enrollment)\b/gi;
        s.clinicalTerms += (text.match(clinicalWords) || []).length;

        // Guiding/directing language (professional markers)
        const guidingPhrases = /\b(let's|I'd like|I suggest|I recommend|I want you to|try to|consider|it sounds like|what I'm hearing|I notice|I sense|from what you've said|let me|perhaps|it seems|have you considered|one option|another approach|we could|shall we|let's focus|how about|moving forward)\b/gi;
        s.guidingPhrases += (text.match(guidingPhrases) || []).length;

        // Emotional/personal language (patient/mentee markers)
        const emotionalPhrases = /\b(I feel|I felt|I'm feeling|I've been|I can't|I don't know|it hurts|I'm scared|I'm worried|I'm anxious|I'm stressed|I'm afraid|I'm sad|I'm angry|I'm confused|my family|my partner|my boss|my mother|my father|my friend|happened to me|I went through|I experienced|I struggle|I suffer|I need help|I'm lost|I cry|nightmare|panic|depression|anxiety|lonely|hopeless|overwhelmed|frustrated|my life|my problem|my issue)\b/gi;
        s.emotionalPhrases += (text.match(emotionalPhrases) || []).length;
    });

    return stats;
}

async function identifyRoles(mergedTranscript, sessionMode = 'Therapy', turns = []) {
    ensureGemini();

    let roleA, roleB, contextDescription;
    if (sessionMode === 'Therapy') {
        roleA = "Therapist"; roleB = "Patient";
        contextDescription = `This is a THERAPY session. The Therapist is a trained mental health professional who:
- Asks probing questions to understand the patient's state
- Uses clinical language and therapeutic techniques (CBT, reflective listening, etc.)
- Guides the conversation with structured interventions
- Speaks in shorter, directed turns
- Often starts the session by checking in or setting the agenda

The Patient is the individual seeking help who:
- Shares personal experiences, emotions, and struggles
- Speaks in longer narrative turns about their life
- Uses emotional and personal language ("I feel", "I can't", etc.)
- Responds to the therapist's questions and prompts`;
    } else if (sessionMode === 'Mentoring') {
        roleA = "Mentor"; roleB = "Mentee";
        contextDescription = `This is an ACADEMIC MENTORING session. The Mentor is a university faculty/senior who:
- Guides academic and professional development
- Asks about goals, progress, and challenges
- Provides advice about coursework, research, career paths
- Sets action items and follow-up tasks
- Uses academic vocabulary (semester, GPA, coursework, thesis, etc.)

The Mentee is the student seeking guidance who:
- Shares academic struggles and personal challenges
- Asks for advice and direction
- Discusses their goals, uncertainties, and progress
- Reports on previous action items`;
    } else {
        roleA = "Counsellor"; roleB = "Patient";
        contextDescription = `This is a COUNSELLING session. The Counsellor guides the conversation.`;
    }

    // Compute contextual signals from Deepgram turns
    let contextualAnalysis = '';
    if (turns.length > 0) {
        const stats = computeSpeakerStats(turns);
        const speakers = Object.keys(stats).sort((a, b) => a - b);

        contextualAnalysis = '\n\nSPEAKER ANALYSIS (from audio processing):\n';
        speakers.forEach(spkId => {
            const s = stats[spkId];
            const avgWordsPerTurn = s.turnCount > 0 ? Math.round(s.totalWords / s.turnCount) : 0;
            contextualAnalysis += `
speaker_${spkId}:
  - Total speaking time: ${s.totalTime.toFixed(1)}s
  - Total words: ${s.totalWords}
  - Number of turns: ${s.turnCount}
  - Avg words/turn: ${avgWordsPerTurn}
  - Questions asked: ${s.questionCount}
  - Clinical/professional terms used: ${s.clinicalTerms}
  - Guiding/directing phrases: ${s.guidingPhrases}
  - Emotional/personal phrases: ${s.emotionalPhrases}
  - Spoke first: ${s.firstTurnIndex === 0 ? 'YES' : 'NO'}
`;
        });

        contextualAnalysis += `
INTERPRETATION GUIDE:
- The ${roleA} typically: asks MORE questions, uses MORE clinical/guiding terms, speaks in SHORTER turns, often speaks FIRST
- The ${roleB} typically: uses MORE emotional/personal phrases, speaks in LONGER narrative turns, answers questions
- Higher question count + clinical terms + guiding phrases = likely ${roleA}
- Higher emotional phrases + longer turns = likely ${roleB}
`;
    }

    const model = geminiPool.getModel({
        model: "gemini-2.0-flash",
        generationConfig: {
            temperature: 0.1,
            responseMimeType: "application/json"
        }
    });

    const prompt = `You are an expert clinical transcript analyst specializing in speaker role identification.

CONTEXT:
${contextDescription}

TASK:
Analyze the transcript below and determine which speaker (speaker_0 or speaker_1) is the ${roleA} and which is the ${roleB}.
${contextualAnalysis}
Use ALL available evidence:
1. Content analysis (what each person says)
2. Speaking patterns (questions vs. narratives)
3. Vocabulary (clinical vs. emotional language)
4. Turn structure (who guides vs. who follows)
5. Statistical signals provided above

Reply with ONLY valid JSON mapping speaker keys to roles:
{ "speaker_0": "${roleA}" or "${roleB}", "speaker_1": "${roleA}" or "${roleB}" }

IMPORTANT: You MUST assign exactly one ${roleA} and one ${roleB}. Both roles must be used.

TRANSCRIPT:
"""
${mergedTranscript}
"""`;

    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const jsonText = response.text();
        const parsed = JSON.parse(jsonText);
        geminiPool.reportSuccess();

        // Validate: ensure both roles are assigned
        const roles = Object.values(parsed);
        if (!roles.includes(roleA) || !roles.includes(roleB)) {
            console.warn('[RoleID] Invalid role mapping, fixing...', parsed);
            return { "speaker_0": roleA, "speaker_1": roleB };
        }

        console.log(`[RoleID] Classification result: speaker_0=${parsed.speaker_0}, speaker_1=${parsed.speaker_1}`);
        return parsed;
    } catch (err) {
        geminiPool.reportError(err.message || '');

        // --- FALLBACK: Groq Llama 3.3 ---
        if (fallback.isAvailable()) {
            console.warn('[RoleID] Gemini failed. Falling back to Groq...');
            try {
                const groqResp = await fallback.chatCompletion(
                    'You are a clinical transcript analyst. Reply with ONLY valid JSON.',
                    prompt, true
                );
                return JSON.parse(groqResp);
            } catch (groqErr) {
                console.error('[Groq RoleID Fallback] Also failed:', groqErr.message);
            }
        }

        console.error('[RoleID] All providers failed:', err.message);
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

    const model = geminiPool.getModel({
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
        geminiPool.reportError(err.message || '');

        // --- FALLBACK: Groq Llama 3.3 ---
        if (fallback.isAvailable()) {
            console.warn('[Profile] Gemini failed. Falling back to Groq Llama 3.3...');
            try {
                const groqResp = await fallback.chatCompletion(
                    systemMsg,
                    `${userMsgFocus}\n\nSESSION HISTORY:\n${sessionSummaries}\n\nReturn ONLY valid JSON:\n${jsonSchema}`,
                    true
                );
                return JSON.parse(groqResp);
            } catch (groqErr) {
                console.error('[Groq Profile Fallback] Also failed:', groqErr.message);
            }
        }

        console.error('[Profile] All providers failed:', err.message);
        throw new AppError('Profile generation failed: ' + (err.message || 'Unknown error'), 500);
    }
}

// --- LLM-based Speaker Diarization (Gemini) ---

async function diarizeTranscript(rawText) {
    ensureGemini();

    const model = geminiPool.getModel({
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
        geminiPool.reportError(e.message || '');

        // --- FALLBACK: Groq Llama 3.3 ---
        if (fallback.isAvailable()) {
            console.warn('[Diarize] Gemini failed. Falling back to Groq...');
            try {
                const diarizePrompt = `Split this conversation transcript into speaker turns.\n\nRAW TRANSCRIPT:\n"""\n${rawText}\n"""\n\nReturn ONLY valid JSON: { "turns": [{ "speaker": 1, "text": "..." }, ...] }`;
                const groqResp = await fallback.chatCompletion(
                    'You are an expert at analyzing conversation transcripts. Identify speaker turns. Reply with valid JSON only.',
                    diarizePrompt, true
                );
                const parsed = JSON.parse(groqResp);
                return parsed.turns || [];
            } catch (groqErr) {
                console.error('[Groq Diarize Fallback] Also failed:', groqErr.message);
            }
        }

        console.error('[Diarize] All providers failed:', e.message);
        return [{ speaker: 1, text: rawText }];
    }
}

module.exports = { initGemini, summarizeTranscript, generateProfile, transcribeWithGemini, identifyRoles, diarizeTranscript };
