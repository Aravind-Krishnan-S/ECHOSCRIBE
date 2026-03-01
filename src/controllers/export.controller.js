const PDFDocument = require('pdfkit');
const { Parser } = require('json2csv');
const dbService = require('../services/db.service');
const { AppError, asyncHandler } = require('../middleware/errorHandler');

// ─── PDF HELPER FUNCTIONS ───

function addHeader(doc, title, subtitle) {
    doc.fontSize(22).font('Helvetica-Bold').fillColor('#1a56db').text('EchoScribe', { align: 'center' });
    doc.moveDown(0.1);
    doc.fontSize(14).font('Helvetica-Bold').fillColor('#1a202c').text(title, { align: 'center' });
    doc.moveDown(0.2);
    doc.fontSize(9).font('Helvetica').fillColor('#718096').text(subtitle, { align: 'center' });
    doc.moveDown(0.4);
    doc.strokeColor('#cbd5e0').lineWidth(0.5).moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).stroke();
    doc.moveDown(0.6);
}

function addSection(doc, title, color = '#1a202c') {
    doc.fontSize(13).font('Helvetica-Bold').fillColor(color).text(title);
    doc.moveDown(0.2);
}

function addField(doc, label, value) {
    if (!value || value === 'Not discussed') return;
    doc.fontSize(10).font('Helvetica-Bold').fillColor('#2d3748').text(label + ': ', { continued: true });
    doc.font('Helvetica').fillColor('#4a5568').text(String(value), { lineGap: 2 });
    doc.moveDown(0.2);
}

function addParagraph(doc, text) {
    doc.fontSize(10).font('Helvetica').fillColor('#4a5568').text(text || 'Not documented', { lineGap: 3 });
    doc.moveDown(0.4);
}

function addBulletList(doc, items, label) {
    if (!items || items.length === 0) return;
    addSection(doc, label);
    items.forEach(item => {
        doc.fontSize(10).font('Helvetica').fillColor('#4a5568').text('  \u2022 ' + item, { lineGap: 2 });
    });
    doc.moveDown(0.4);
}

function addDivider(doc) {
    doc.strokeColor('#e2e8f0').lineWidth(0.3).moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).stroke();
    doc.moveDown(0.4);
}

// GET /api/export/pdf/:sessionId
const exportPdf = asyncHandler(async (req, res) => {
    const { sessionId } = req.params;
    const userId = req.user.id;

    // Try without mode constraint since export links don't always have mode
    const client = dbService.getAuthClient(req.supabaseToken);
    const { data: session, error } = await client
        .from('sessions')
        .select('*')
        .eq('id', sessionId)
        .eq('user_id', userId)
        .single();

    if (error || !session) {
        throw new AppError('Session not found.', 404);
    }

    const analysis = session.analysis_json || {};
    const risk = analysis.risk_assessment || {};
    const stats = analysis.counselingStats || {};
    const comms = analysis.patient_communication || {};
    const booking = analysis.auto_booking || {};
    const referral = analysis.referral_form || {};
    const isMentoring = session.session_mode === 'Mentoring';
    const provider = analysis._provider || 'Unknown';

    const doc = new PDFDocument({ margin: 50, size: 'A4' });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=echoscribe-session-${sessionId}.pdf`);
    doc.pipe(res);

    // ─── Cover Header ───
    const noteType = isMentoring ? 'Academic Mentoring GROW Note' : 'Clinical Session SOAP Note';
    const dateStr = new Date(session.created_at).toLocaleString();
    addHeader(doc, noteType, `Date: ${dateStr}  |  Client: ${stats.name || 'Unknown'}  |  AI Confidence: ${((analysis.confidence_score || 0) * 100).toFixed(0)}%  |  Provider: ${provider}`);

    // ─── Client Info ───
    addSection(doc, 'Client Information');
    addField(doc, 'Name', stats.name);
    addField(doc, 'Age', stats.age);
    addField(doc, 'Presenting Problem', stats.presentingProblem);
    addField(doc, 'Reason for Counseling', stats.reasonForCounseling);
    addField(doc, 'Current Emotional State', stats.currentEmotionalState);
    addField(doc, 'Last Major Progress', stats.lastMajorProgress);
    addField(doc, 'Emotional Tone', analysis.emotional_tone);
    addField(doc, 'AI Provider', provider);
    addDivider(doc);

    // ─── SOAP / GROW Notes ───
    if (isMentoring) {
        const grow = analysis.grow || {};
        addSection(doc, 'G \u2014 Goal', '#2b6cb0');
        addParagraph(doc, grow.goal);
        addSection(doc, 'R \u2014 Reality', '#2b6cb0');
        addParagraph(doc, grow.reality);
        addSection(doc, 'O \u2014 Options', '#2b6cb0');
        addParagraph(doc, grow.options);
        addSection(doc, 'W \u2014 Way Forward', '#2b6cb0');
        addParagraph(doc, grow.way_forward);
    } else {
        const soap = analysis.soap || {};
        addSection(doc, 'S \u2014 Subjective', '#2b6cb0');
        addParagraph(doc, soap.subjective);
        addSection(doc, 'O \u2014 Objective', '#2b6cb0');
        addParagraph(doc, soap.objective);
        addSection(doc, 'A \u2014 Assessment', '#2b6cb0');
        addParagraph(doc, soap.assessment);
        addSection(doc, 'P \u2014 Plan', '#2b6cb0');
        addParagraph(doc, soap.plan);
    }
    addDivider(doc);

    // ─── Risk Assessment ───
    addSection(doc, 'Risk Assessment', '#c53030');
    if (isMentoring) {
        addField(doc, 'Academic Burnout', risk.academic_burnout ? 'YES \u2014 FLAGGED' : 'No');
        addField(doc, 'Severe Distress Risk', (risk.severe_distress_risk || 'low').toUpperCase());
    } else {
        addField(doc, 'Suicidal Ideation', risk.suicidal_ideation ? 'YES \u2014 FLAGGED' : 'No');
        addField(doc, 'Self-Harm Risk', (risk.self_harm_risk || 'low').toUpperCase());
    }
    addField(doc, 'Notes', risk.notes);
    addDivider(doc);

    // ─── Clinical Details (Therapy) / Mentoring Details ───
    if (isMentoring) {
        addBulletList(doc, analysis.skill_progression, 'Skill Progression');
        addBulletList(doc, analysis.action_items, 'Action Items');
        addField(doc, 'Goal Completion Rate', analysis.goal_completion_rate);
        addField(doc, 'Motivational State', analysis.motivational_state);
    } else {
        addBulletList(doc, analysis.diagnostic_impressions, 'Diagnostic Impressions');
        addBulletList(doc, analysis.interventions_used, 'Interventions Used');
        addBulletList(doc, analysis.medication_changes, 'Medication Changes');
        addBulletList(doc, analysis.progress_indicators, 'Progress Indicators');
    }

    // ─── Topics ───
    if (analysis.topics && analysis.topics.length > 0) {
        addBulletList(doc, analysis.topics, 'Topics Discussed');
    }
    addDivider(doc);

    // ─── Follow-Up & Referral ───
    addSection(doc, 'Follow-Up & Referral');
    addField(doc, 'Needs Follow-Up', booking.needs_follow_up ? 'Yes' : 'No');
    addField(doc, 'Suggested Timeframe', booking.suggested_timeframe);
    addField(doc, 'Follow-Up Reason', booking.reason);
    addField(doc, 'Referral Needed', referral.referral_needed ? 'Yes' : 'No');
    addField(doc, 'Specialty/Service', referral.specialty_or_service);
    addField(doc, 'Referral Reason', referral.reason);
    addDivider(doc);

    // ─── Patient Communication ───
    addSection(doc, 'Patient Communication (Take-Home)');
    if (comms.instructions_english) {
        doc.fontSize(10).font('Helvetica-Bold').fillColor('#2d3748').text('English:');
        addParagraph(doc, comms.instructions_english);
    }
    if (comms.instructions_translated && comms.instructions_translated !== comms.instructions_english) {
        doc.fontSize(10).font('Helvetica-Bold').fillColor('#2d3748').text('Translated:');
        addParagraph(doc, comms.instructions_translated);
    }
    addDivider(doc);

    // ─── Session Metadata ───
    addSection(doc, 'Session Metadata');
    addField(doc, 'Session ID', sessionId);
    addField(doc, 'Mode', session.session_mode);
    addField(doc, 'Word Count', analysis.wordCount);
    addField(doc, 'AI Confidence', ((analysis.confidence_score || 0) * 100).toFixed(0) + '%');
    addField(doc, 'AI Provider', provider);
    addField(doc, 'Date', dateStr);

    // ─── Footer ───
    doc.moveDown(1);
    doc.fontSize(8).font('Helvetica').fillColor('#a0aec0')
        .text('Generated by EchoScribe \u2014 AI-assisted clinical documentation. This is not a substitute for clinical judgment.', { align: 'center' });
    doc.text('Analysis powered by ' + provider, { align: 'center' });

    doc.end();
});

// GET /api/export/csv
const exportCsv = asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const sessions = await dbService.getHistory(req.supabaseToken, userId, req.query.mode || 'Therapy');

    if (!sessions || sessions.length === 0) {
        throw new AppError('No sessions to export.', 404);
    }

    const rows = sessions.map((s) => {
        const a = s.analysis_json || {};
        const soap = a.soap || {};
        const grow = a.grow || {};
        const stats = a.counselingStats || {};
        const risk = a.risk_assessment || {};
        const isM = s.session_mode === 'Mentoring';

        return {
            date: new Date(s.created_at).toISOString(),
            mode: s.session_mode || 'Therapy',
            ai_provider: a._provider || 'Unknown',
            client_name: stats.name || 'Unknown',
            subjective_or_goal: isM ? (grow.goal || '') : (soap.subjective || ''),
            objective_or_reality: isM ? (grow.reality || '') : (soap.objective || ''),
            assessment_or_options: isM ? (grow.options || '') : (soap.assessment || ''),
            plan_or_way_forward: isM ? (grow.way_forward || '') : (soap.plan || ''),
            emotional_tone: a.emotional_tone || '',
            risk_level: isM ? (risk.severe_distress_risk || 'low') : (risk.self_harm_risk || 'low'),
            topics: (a.topics || []).join('; '),
            word_count: a.wordCount || 0,
            confidence: a.confidence_score || 0,
            transcript: s.transcript || '',
        };
    });

    const parser = new Parser();
    const csv = parser.parse(rows);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=echoscribe-sessions.csv');
    res.send(csv);
});

// GET /api/export/record
const exportFullRecord = asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const sessions = await dbService.getHistory(req.supabaseToken, userId, req.query.mode || 'Therapy');

    if (!sessions || sessions.length === 0) {
        throw new AppError('No records to export.', 404);
    }

    const record = {
        exported_at: new Date().toISOString(),
        user_id: userId,
        total_sessions: sessions.length,
        sessions: sessions,
    };

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename=echoscribe-full-record.json');
    res.json(record);
});

module.exports = { exportPdf, exportCsv, exportFullRecord };
