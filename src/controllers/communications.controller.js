const { asyncHandler, AppError } = require('../middleware/errorHandler');

// POST /api/communications/send
const sendCommunication = asyncHandler(async (req, res) => {
    const { patientId, patientEmail, patientPhone, type, content } = req.body;

    if (!patientId && !patientEmail && !patientPhone) {
        throw new AppError('No contact information provided for the patient.', 400);
    }

    if (!content) {
        throw new AppError('Message content is required.', 400);
    }

    // In a production app, we would integrate with SendGrid, Twilio, Resend, etc.
    // For this prototype, we mock the sending process.
    console.log(`\n[Communication Mock] Sending ${type} to patient...`);
    if (patientEmail) console.log(`   --> Emailing to: ${patientEmail}`);
    if (patientPhone) console.log(`   --> Texting to: ${patientPhone}`);
    console.log(`   --> Content:\n${content}\n`);

    res.json({
        success: true,
        message: `${type} sent successfully via Email/SMS.`,
        details: { patientEmail, patientPhone, type }
    });
});

module.exports = {
    sendCommunication
};
