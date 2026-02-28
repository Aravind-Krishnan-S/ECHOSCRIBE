const puppeteer = require('puppeteer');

async function testPage() {
    const browser = await puppeteer.launch({ headless: 'new' });
    const page = await browser.newPage();

    let logs = [];
    page.on('console', msg => logs.push(`[${msg.type()}] ${msg.text()}`));
    page.on('pageerror', error => logs.push(`[PAGE ERROR] ${error.message}`));

    await page.goto('http://localhost:3000/login');
    await page.evaluate(() => {
        localStorage.setItem('echoscribe_token', 'fake_token');
        localStorage.setItem('echoscribe_active_patient', JSON.stringify({ id: '123', name: 'Test' }));
    });

    await page.goto('http://localhost:3000/patient.html?id=123');
    await new Promise(r => setTimeout(r, 2000));

    // Check elements patient.js needs
    const results = await page.evaluate(() => {
        return {
            patientName: !!document.getElementById('patient-name'),
            patientAge: !!document.getElementById('patient-age'),
            patientGender: !!document.getElementById('patient-gender'),
            patientEmail: !!document.getElementById('patient-email'),
            patientPhone: !!document.getElementById('patient-phone'),
            patientAvatar: !!document.getElementById('patient-avatar'),
            profileContent: !!document.getElementById('profile-content'),
            btnGenerateProfile: !!document.getElementById('btn-generate-profile'),
            filterMode: !!document.getElementById('filter-mode'),
            sessionsList: !!document.getElementById('sessions-list'),
            sessionsEmpty: !!document.getElementById('sessions-empty')
        };
    });
    console.log("DOM elements missing:", Object.entries(results).filter(x => !x[1]).map(x => x[0]));
    console.log("Patient logs:\n", logs.join('\n'));

    await browser.close();
}
testPage().catch(console.error);
