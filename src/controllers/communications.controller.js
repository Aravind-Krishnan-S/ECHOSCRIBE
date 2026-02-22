const { Resend } = require('resend');
const { asyncHandler, AppError } = require('../middleware/errorHandler');

// Redeploy trigger: 2026-02-22T21:44:00
const resend = new Resend(process.env.RESEND_API_KEY);

// POST /api/communications/send
const sendCommunication = asyncHandler(async (req, res) => {
    const { patientId, patientEmail, patientPhone, type, content } = req.body;

    if (!patientId && !patientEmail && !patientPhone) {
        throw new AppError('No contact information provided for the patient.', 400);
    }

    if (!content) {
        throw new AppError('Message content is required.', 400);
    }

    let emailResult = null;
    let smsResult = "SMS capability requires Twilio integration (Mocked)";

    // Send Real Email via Resend
    if (patientEmail) {
        try {
            const { data, error } = await resend.emails.send({
                from: 'onboarding@resend.dev',
                to: [patientEmail],
                subject: `EchoScribe: ${type}`,
                html: `
                    <div style="font-family: sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
                        <h2 style="color: #2b6cb0;">EchoScribe Health Communication</h2>
                        <p><strong>Message Type:</strong> ${type}</p>
                        <hr style="border: 0; border-top: 1px solid #eee;" />
                        <div style="white-space: pre-wrap; color: #333; line-height: 1.6;">${content}</div>
                        <hr style="border: 0; border-top: 1px solid #eee;" />
                        <p style="font-size: 0.8rem; color: #888;">This is an automated message from your healthcare provider using EchoScribe.</p>
                    </div>
                `
            });

            if (error) {
                console.error('[Resend Error]:', error);
                emailResult = { success: false, error: error.message };
            } else {
                emailResult = { success: true, id: data.id };
            }
        } catch (err) {
            console.error('[Resend Exception]:', err);
            emailResult = { success: false, error: err.message };
        }
    }

    // Mock SMS (for future Twilio integration)
    if (patientPhone) {
        console.log(`[SMS Mock] Sending to ${patientPhone}: ${content.substring(0, 50)}...`);
    }

    res.json({
        success: emailResult ? emailResult.success : true,
        message: patientEmail
            ? (emailResult.success ? 'Email sent successfully!' : `Email failed: ${emailResult.error}`)
            : 'Communication processed (SMS mocked).',
        details: {
            patientEmail,
            patientPhone,
            type,
            emailStatus: emailResult,
            smsStatus: patientPhone ? "Mocked" : "Not attempted"
        }
    });
});

module.exports = {
    sendCommunication
};
