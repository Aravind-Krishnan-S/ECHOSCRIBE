const puppeteer = require('puppeteer');

async function testPage() {
    const browser = await puppeteer.launch({ headless: 'new' });
    const page = await browser.newPage();

    let logs = [];
    page.on('console', msg => {
        const type = msg.type();
        if (type === 'error' || type === 'warning' || type === 'log') {
            logs.push(`[${type}] ${msg.text()}`);
        }
    });
    page.on('pageerror', error => logs.push(`[PAGE ERROR] ${error.message}`));

    await page.goto('http://localhost:3000/login');
    await page.evaluate(() => {
        localStorage.setItem('echoscribe_token', 'fake_token');
        localStorage.setItem('echoscribe_active_patient', JSON.stringify({ id: '123', name: 'Test' }));
    });

    console.log("--- Testing patient.html ---");
    await page.goto('http://localhost:3000/patient.html?id=123');
    await new Promise(r => setTimeout(r, 2000));

    console.log("Patient logs:\n", logs.join('\n'));
    logs = [];

    console.log("--- Testing record.html ---");
    await page.goto('http://localhost:3000/record.html');
    await new Promise(r => setTimeout(r, 2000));

    console.log("Record logs:\n", logs.join('\n'));

    await browser.close();
}
testPage().catch(console.error);
