const puppeteer = require('puppeteer');

async function testVercel() {
    const browser = await puppeteer.launch({ headless: 'new' });
    const page = await browser.newPage();

    page.on('response', response => {
        if (!response.ok()) {
            console.log(`[NETWORK ERROR] ${response.status()} ${response.url()}`);
        }
    });

    console.log("--- Logging into Vercel ---");
    await page.goto('https://echoscribe-vert.vercel.app/login.html');

    // Fill login form
    await page.waitForSelector('#email');
    await page.type('#email', 'aravindkrishnans.ad23@jecc.ac.in');
    await page.type('#password', 'pikachu');

    // Click login and wait for navigation
    await Promise.all([
        page.waitForNavigation(),
        page.click('button[type="submit"]')
    ]);

    console.log("--- Testing patient.html on Vercel ---");
    await page.goto('https://echoscribe-vert.vercel.app/patient.html?id=33eb095d-84d4-4dc1-a016-b3f4bd2794d9');
    await new Promise(r => setTimeout(r, 4000));

    await browser.close();
}
testVercel().catch(console.error);
