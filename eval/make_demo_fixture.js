/* eval/make_demo_fixture.js — runs the real note pipeline (evidence-linked writing, cross-vendor
   verification, second-opinion risk screen) on a role-played therapy transcript and saves the result
   for the interface screenshot in the paper (eval/screenshot_ui.js). The transcript is invented for
   illustration; the note, citations, labels and risk agreement are genuine model output. */

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
const ai = require('../src/services/ai.service');

const turns = [
    ['Therapist', 'Welcome back. Last time we agreed you would keep a sleep diary. How did that go?'],
    ['Patient', 'I kept it most nights. I am getting about four hours a night since my manager moved the performance review forward to next Friday.'],
    ['Therapist', 'Four hours is very little. What keeps you awake?'],
    ['Patient', 'I go over every mistake I made at work. Then I check my email at two in the morning, which makes it worse.'],
    ['Therapist', 'You mentioned last week that the worry gets heavier at night. Where does it go when it is at its worst?'],
    ['Patient', 'Honestly, a couple of nights I thought everyone would be better off without me. It passes by the morning.'],
    ['Therapist', 'Thank you for telling me. When you have that thought, have you thought about ending your life or about how you would do it?'],
    ['Patient', 'No. No plan, nothing like that. It is more that I feel like a burden. My sister would be devastated, I would never do that to her.'],
    ['Therapist', 'I am glad you told me, and I want us to make a safety plan today, including who you would call. Is that all right?'],
    ['Patient', 'Yes. I would call my sister. She lives ten minutes away.'],
    ['Therapist', 'Good. For sleep, let us try a fixed wind-down: no email after nine, and the breathing exercise from our second session.'],
    ['Patient', 'The breathing helped on Monday. I fell asleep before midnight for the first time in weeks.'],
    ['Therapist', 'That is real progress. Shall we meet again next Tuesday, before the review?'],
    ['Patient', 'Tuesday works. I think having the plan written down will help.'],
];
const transcript = turns.map(([r, t]) => `${r}:\n    ${t}`).join('\n\n');

(async () => {
    const note = await ai.summarizeTranscript(transcript, 'en', 'Therapy');
    note.conversation = {
        // Text-only example: placeholder spans, so the strip lays turns out by words and says so
        turns: turns.map(([role, text], i) => ({ role, start: i, end: i + 1, words: text.split(/\s+/).length })),
        providers: { stt: null, diarization: null, roles: null },
        durationSec: null,
    };
    const session = {
        id: '7d3c2f1a-0000-4000-8000-000000000001',
        created_at: new Date().toISOString(),
        transcript,
        summary: note.soap.subjective,
        analysis_json: note,
        patient_id: '7d3c2f1a-0000-4000-8000-0000000000aa',
        audio_url: null,
        session_mode: 'Therapy',
    };
    const out = path.join(__dirname, 'results', 'demo_session.json');
    fs.writeFileSync(out, JSON.stringify(session, null, 1));
    const g = note.grounding.summary;
    console.log(`writer ${note._provider} | verifier ${note.grounding.verifier} | ${g.supported}/${g.statements} supported, ${g.partial} partial, ${g.unsupported} unsupported`);
    console.log('risk', JSON.stringify({ si: note.risk_assessment.suicidal_ideation, sh: note.risk_assessment.self_harm_risk, agree: note.risk_assessment.consensus?.agree, by: note.risk_assessment.consensus?.second_provider }));
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
