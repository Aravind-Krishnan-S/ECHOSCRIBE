/* src/services/ai.service.js
   AI tasks for the processing pipeline. Every task resolves its provider at
   request time from the configured chain for its role (see provider-chain.js);
   no vendor or model name is hard-coded here. */

const { runChain } = require('./provider-chain');
const grounding = require('./grounding');

/** Parse a model's JSON reply, tolerating ```json fences. Throws if unparseable. */
function parseJsonResponse(text) {
    try {
        return JSON.parse(text);
    } catch (parseError) {
        const jsonMatch = String(text).match(/```(?:json)?\s*([\s\S]*?)```/);
        if (jsonMatch) return JSON.parse(jsonMatch[1].trim());
        throw parseError;
    }
}

// --- Clinical SOAP / GROW Summarization (NOTE_SYNTH slot) ---

function normalizeAnalysis(parsedData, mode, text, wordCount) {
    parsedData.wordCount = parsedData.wordCount || wordCount;
    parsedData.originalText = text.trim();

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
}

async function summarizeTranscript(text, lang = 'en', mode = 'Therapy', { chains } = {}) {
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
CRITICAL INSTRUCTION: Pay strict attention to the speaker labels (e.g., "Therapist:", "Patient:", "Mentor:", "Mentee:") in the transcript.
- The "Therapist" or "Mentor" is the professional guiding the session.
- The "Patient" or "Mentee" is the client seeking help.
Do NOT attribute the professional's statements, questions, or guidance to the client.
Do NOT attribute the client's symptoms, experiences, or answers to the professional.
You MUST respond with valid JSON only. No markdown, no code fences, no extra text.
Be thorough but precise. Do not fabricate information not present in the transcript.
If information for a field is not available from the transcript, use "Not discussed" or empty arrays as appropriate.
You must also generate a client-facing communication summary translated into the locale: ${lang}.`;

    const numbered = grounding.numberTranscript(text);
    const sectionKeys = mode === 'Mentoring' ? ['goal', 'reality', 'options', 'way_forward'] : ['subjective', 'objective', 'assessment', 'plan'];
    const sectionGroup = mode === 'Mentoring' ? 'grow' : 'soap';

    const userPrompt = `Analyze the following session transcript and return a STRICT structured note in JSON format.

TRANSCRIPT (numbered turns):
"""
${numbered.prompt}
"""

EVIDENCE RULE: In every "${sectionGroup}" field and in "risk_assessment.notes", end each sentence with the numbers of the turns that support it, for example: "Reports two weeks of poor sleep [T4, T6]." Cite only turns that actually contain the information. Do not write a sentence you cannot cite; if a field has nothing to cite, write "Not discussed".

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
  }
}`;

    const generate = (avoidFamily) => runChain('NOTE_SYNTH', async (adapter) => {
        const reply = await adapter.chatCompletion(systemInstruction, userPrompt, { json: true, temperature: 0.3 });
        return parseJsonResponse(reply);
    }, { chains, avoidFamily });

    // Split each section into cited sentences, strip the markers, then verify with another vendor
    const ground = async (raw, writerFamily, writerModel) => {
        const note = normalizeAnalysis(raw, mode, text, wordCount);
        const sections = {};
        const flat = [];
        for (const key of sectionKeys) {
            const { clean, statements } = grounding.extractStatements(note[sectionGroup][key], numbered.turns.length);
            note[sectionGroup][key] = clean;
            sections[key] = statements;
            statements.forEach(st => flat.push(st));
        }
        if (note.risk_assessment && note.risk_assessment.notes) {
            note.risk_assessment.notes = grounding.extractStatements(note.risk_assessment.notes, numbered.turns.length).clean;
        }
        if (!GROUNDING_ENABLED) return { note, sections, summary: null, verifier: null };

        const verified = await grounding.verifyStatements(flat, numbered.turns, { chains, avoidFamily: writerFamily, avoidModel: writerModel });
        if (verified) flat.forEach((st, k) => Object.assign(st, verified.verdicts[k]));
        else flat.forEach(st => { st.label = 'unverified'; });
        return { note, sections, summary: grounding.summarize(sections), verifier: verified ? verified.provider : null };
    };

    const first = await generate();
    let chosen = { gen: first, grounded: await ground(first.result, first.family, first.model) };
    const cascade = { escalated: false };

    // Verification-gated cascade: too many unsupported sentences -> one retry on a different vendor
    const ratio = chosen.grounded.summary && chosen.grounded.summary.unsupported_ratio;
    if (GROUNDING_ENABLED && ratio !== null && ratio !== undefined && ratio > GROUNDING_GATE) {
        try {
            const second = await generate(first.family);
            const groundedSecond = await ground(second.result, second.family, second.model);
            const ratio2 = groundedSecond.summary && groundedSecond.summary.unsupported_ratio !== null ? groundedSecond.summary.unsupported_ratio : 1;
            cascade.escalated = true;
            cascade.reason = `${Math.round(ratio * 100)}% of sentences unsupported (gate ${Math.round(GROUNDING_GATE * 100)}%)`;
            cascade.candidates = [
                { provider: first.provider, unsupported_ratio: ratio },
                { provider: second.provider, unsupported_ratio: ratio2 },
            ];
            if (ratio2 < ratio) chosen = { gen: second, grounded: groundedSecond };
            cascade.kept = chosen.gen.provider;
        } catch (err) {
            cascade.error = err.message;
        }
    }

    const parsedData = chosen.grounded.note;
    parsedData._provider = chosen.gen.provider;
    parsedData._providerAttempts = chosen.gen.attempts;
    parsedData.grounding = {
        turns: numbered.turns.map(t => ({ id: t.id, role: t.role })),
        sections: chosen.grounded.sections,
        summary: chosen.grounded.summary,
        verifier: chosen.grounded.verifier,
        gate: GROUNDING_GATE,
        cascade,
    };

    if (RISK_SECOND_OPINION) {
        parsedData.risk_assessment.consensus = await secondOpinionRisk(numbered.prompt, mode, parsedData.risk_assessment, chosen.gen.family, chains, chosen.gen.model);
    }
    return parsedData;
}

const GROUNDING_ENABLED = process.env.NOTE_GROUNDING !== 'off';
const GROUNDING_GATE = Math.min(1, Math.max(0, Number(process.env.GROUNDING_GATE ?? 0.2)));
const RISK_SECOND_OPINION = process.env.RISK_SECOND_OPINION !== 'off';

function riskFlag(risk, mode) {
    if (!risk) return false;
    const level = (v) => ['moderate', 'high'].includes(String(v || '').toLowerCase());
    return mode === 'Mentoring'
        ? !!(risk.academic_burnout || level(risk.severe_distress_risk))
        : !!(risk.suicidal_ideation || level(risk.self_harm_risk));
}

/**
 * Independent risk screen by a second vendor. The flag is raised if either model raises it
 * (sensitivity first); disagreement is surfaced as "needs review" rather than resolved silently.
 */
async function secondOpinionRisk(numberedTranscript, mode, primaryRisk, writerFamily, chains, writerModel) {
    const therapy = mode !== 'Mentoring';
    const schema = therapy
        ? '{"suicidal_ideation": false, "self_harm_risk": "low|moderate|high", "evidence_turns": [3, 7], "notes": "one sentence"}'
        : '{"academic_burnout": false, "severe_distress_risk": "low|moderate|high", "evidence_turns": [3, 7], "notes": "one sentence"}';
    const focus = therapy
        ? 'language suggesting suicidal ideation or self-harm by the patient'
        : 'signs of academic burnout or severe distress in the mentee';

    try {
        const { result, provider } = await runChain('VERIFY', async (adapter) => {
            const reply = await adapter.chatCompletion(
                'You screen session transcripts for safety concerns so that a licensed professional can review them. You do not diagnose. Respond with valid JSON only.',
                `Read the numbered transcript and judge only ${focus}. Cite the turns you relied on.\n\nTRANSCRIPT:\n"""\n${numberedTranscript}\n"""\n\nReturn ONLY valid JSON: ${schema}`,
                { json: true, temperature: 0 });
            return parseJsonResponse(reply);
        }, { chains, avoidFamily: writerFamily, avoidModel: writerModel });

        const a = riskFlag(primaryRisk, mode);
        const b = riskFlag(result, mode);
        return {
            second_opinion: result,
            second_provider: provider,
            agree: a === b,
            flagged: a || b,
            needs_review: a !== b,
        };
    } catch (err) {
        return { error: 'Second-opinion screen unavailable: ' + err.message, flagged: riskFlag(primaryRisk, mode), needs_review: true };
    }
}

// --- Speech-to-Text (STT slot) ---

// words=true asks for word timestamps; providers that cannot give them (e.g. Gemini) return plain text
async function transcribeAudio(audioBuffer, mimeType, lang = 'en', { chains, durationSec, words = false } = {}) {
    const { result, provider, attempts } = await runChain('STT', (adapter) =>
        adapter.transcribeAudioBuffer(audioBuffer, mimeType, { lang, words }),
        { chains, timeoutMs: durationSec ? durationSec * 4000 : 0 });
    const text = typeof result === 'string' ? result : (result?.text || '');
    const timed = result && typeof result === 'object' && Array.isArray(result.words) && result.words.length ? result.words : null;
    return { text, words: timed, _provider: provider, _attempts: attempts };
}

// --- Audio Diarization (DIARIZE slot: local pyannote → cloud fallbacks) ---

async function diarizeAudio(audioBuffer, mimeType, lang = 'en', { chains, durationSec, cloudAudio } = {}) {
    const { result, provider, attempts } = await runChain('DIARIZE', async (adapter, pool) => {
        // The local service gets the original recording; cloud models get the compact copy
        const useCloud = cloudAudio && pool.family !== 'pyannote';
        const out = await adapter.diarizeAudioBuffer(useCloud ? cloudAudio.buffer : audioBuffer, useCloud ? cloudAudio.mimeType : mimeType, { lang, numSpeakers: 2 });
        if (!out || !Array.isArray(out.turns) || out.turns.length === 0) {
            throw new Error('Diarization returned no speaker turns');
        }
        return out;
    }, { chains, timeoutMs: durationSec ? durationSec * 10000 : 0 });
    return { turns: result.turns, _provider: provider, _attempts: attempts };
}

// --- Contextual Role Identification (ROLE_LABEL slot) ---

/**
 * Compute contextual signals from diarized turns for smarter role classification.
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

function rolesForMode(sessionMode) {
    if (sessionMode === 'Therapy') {
        return {
            roleA: "Therapist", roleB: "Patient",
            contextDescription: `This is a THERAPY session. The Therapist is a trained mental health professional who:
- Asks probing questions to understand the patient's state
- Uses clinical language and therapeutic techniques (CBT, reflective listening, etc.)
- Guides the conversation with structured interventions
- Speaks in shorter, directed turns
- Often starts the session by checking in or setting the agenda

The Patient is the individual seeking help who:
- Shares personal experiences, emotions, and struggles
- Speaks in longer narrative turns about their life
- Uses emotional and personal language ("I feel", "I can't", etc.)
- Responds to the therapist's questions and prompts`,
        };
    }
    if (sessionMode === 'Mentoring') {
        return {
            roleA: "Mentor", roleB: "Mentee",
            contextDescription: `This is an ACADEMIC MENTORING session. The Mentor is a university faculty/senior who:
- Guides academic and professional development
- Asks about goals, progress, and challenges
- Provides advice about coursework, research, career paths
- Sets action items and follow-up tasks
- Uses academic vocabulary (semester, GPA, coursework, thesis, etc.)

The Mentee is the student seeking guidance who:
- Shares academic struggles and personal challenges
- Asks for advice and direction
- Discusses their goals, uncertainties, and progress
- Reports on previous action items`,
        };
    }
    return {
        roleA: "Counsellor", roleB: "Patient",
        contextDescription: `This is a COUNSELLING session. The Counsellor guides the conversation.`,
    };
}

/**
 * Label the two diarized speakers with session roles.
 * Never throws: if every ROLE_LABEL provider fails, returns the default mapping.
 * @returns {Promise<{ roleMap: object, _provider: string }>}
 */
async function identifyRoles(mergedTranscript, sessionMode = 'Therapy', turns = [], { chains } = {}) {
    const { roleA, roleB, contextDescription } = rolesForMode(sessionMode);
    const defaultMap = { "speaker_0": roleA, "speaker_1": roleB };

    // Compute the eight contextual signals from the diarized turns
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

    const prompt = `You are an expert clinical transcript analyst specializing in speaker role identification.

CONTEXT:
${contextDescription}

TASK:
Analyze the transcript below and determine which speaker (speaker_0 or speaker_1) is the ${roleA} and which is the ${roleB}.
${contextualAnalysis}
Use ALL available evidence:
1. Content analysis (what each person says - this is the most important factor)
2. Speaking patterns (questions vs. narratives)
3. Turn structure (who guides vs. who follows)
4. Statistical signals provided above (NOTE: These signals only count English words. If the transcript is in Malayalam or another language, these will be 0. Rely entirely on the translated meaning of the transcript).

Reply with ONLY valid JSON mapping speaker keys to roles:
{ "speaker_0": "${roleA}" or "${roleB}", "speaker_1": "${roleA}" or "${roleB}" }

IMPORTANT: You MUST assign exactly one ${roleA} and one ${roleB}. Both roles must be used.

TRANSCRIPT:
"""
${mergedTranscript}
"""`;

    try {
        const { result, provider } = await runChain('ROLE_LABEL', async (adapter) => {
            const reply = await adapter.chatCompletion(
                'You are a clinical transcript analyst. Reply with ONLY valid JSON.',
                prompt, { json: true, temperature: 0.1 }
            );
            const parsed = parseJsonResponse(reply);
            const roles = Object.values(parsed);
            if (!roles.includes(roleA) || !roles.includes(roleB)) {
                throw new Error(`Invalid role mapping: ${JSON.stringify(parsed)}`);
            }
            return parsed;
        }, { chains });

        console.log(`[RoleID] ${provider}: speaker_0=${result.speaker_0}, speaker_1=${result.speaker_1}`);
        return { roleMap: result, _provider: provider };
    } catch (err) {
        console.error('[RoleID] All providers failed, using default mapping:', err.message);
        return { roleMap: defaultMap, _provider: 'Default mapping (all providers failed)' };
    }
}

// --- Longitudinal Profile Analysis (PROFILE_GEN slot) ---

async function generateProfile(sessions, { chains } = {}) {
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

    const userPrompt = `${userMsgFocus}

SESSION HISTORY:
${sessionSummaries}

Return ONLY valid JSON:
${jsonSchema}`;

    const { result, provider } = await runChain('PROFILE_GEN', async (adapter) => {
        const reply = await adapter.chatCompletion(systemMsg, userPrompt, { json: true, temperature: 0.3 });
        return parseJsonResponse(reply);
    }, { chains });

    result._provider = provider;
    return result;
}

// --- LLM-based Speaker Diarization of plain text (ROLE_LABEL slot) ---

async function diarizeTranscript(rawText, { chains } = {}) {
    const systemPrompt = `You are an expert at analyzing conversation transcripts. Given a raw transcript of a conversation between TWO people, identify speaker turns and split the text into alternating speakers.

Rules:
- There are exactly 2 speakers: "Person 1" and "Person 2"
- Person 1 is whoever speaks first
- Identify speaker changes by analyzing: question-answer patterns, topic shifts, response cues, greetings, conversational flow
- Each turn should contain what one person says before the other person responds
- Do NOT merge multiple turns from different speakers
- Do NOT fabricate or modify the text — use the exact words from the transcript
- If unsure about a split point, make your best guess based on conversational logic

You MUST respond with valid JSON only.`;

    const userPrompt = `Split this conversation transcript into speaker turns. Identify where one person stops speaking and the other responds.

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
}`;

    try {
        const { result } = await runChain('ROLE_LABEL', async (adapter) => {
            const reply = await adapter.chatCompletion(systemPrompt, userPrompt, { json: true, temperature: 0.1 });
            return parseJsonResponse(reply).turns || [];
        }, { chains });
        return result;
    } catch (err) {
        console.error('[Diarize] All providers failed:', err.message);
        return [{ speaker: 1, text: rawText }];
    }
}

module.exports = {
    summarizeTranscript,
    transcribeAudio,
    diarizeAudio,
    identifyRoles,
    generateProfile,
    diarizeTranscript,
    computeSpeakerStats,
};
