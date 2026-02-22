const fs = require('fs');
const path = require('path');

// Simple compliance audit logger
const auditLogStream = fs.createWriteStream(
    path.join(__dirname, '..', '..', 'compliance_audit.log'),
    { flags: 'a' }
);

function complianceLogger(req, res, next) {
    if (req.originalUrl.startsWith('/api/') && !req.originalUrl.includes('/health')) {
        const userId = req.user ? req.user.id : 'unauthenticated';
        const timestamp = new Date().toISOString();
        const method = req.method;
        const endpoint = req.originalUrl;
        const ip = req.ip || req.connection.remoteAddress;

        // Strip out heavy payloads (like transcript text or audio files) to avoid bloated logs,
        // but keep patient IDs or flags.
        let safeBody = { ...req.body };
        if (safeBody.text) safeBody.text = '[REDACTED_TRANSCRIPT]';
        if (safeBody.transcript) safeBody.transcript = '[REDACTED_TRANSCRIPT]';
        if (safeBody.summary) safeBody.summary = '[REDACTED_SUMMARY]';
        if (safeBody.analysisJson) safeBody.analysisJson = '[REDACTED_ANALYSIS]';

        const logEntry = JSON.stringify({
            timestamp,
            action: `${method} ${endpoint}`,
            actor_id: userId,
            ip_address: ip,
            parameters: safeBody,
            event: 'PHI_ACCESS_OR_MODIFICATION'
        });

        auditLogStream.write(logEntry + '\n');
    }
    next();
}

module.exports = { complianceLogger };
