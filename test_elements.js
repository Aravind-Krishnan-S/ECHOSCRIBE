const puppeteer = require('puppeteer');

async function testPage() {
    const browser = await puppeteer.launch({ headless: 'new' });
    const page = await browser.newPage();

    await page.goto('http://localhost:3000/login');
    await page.evaluate(() => {
        localStorage.setItem('echoscribe_token', 'fake_token');
        localStorage.setItem('echoscribe_active_patient', JSON.stringify({ id: '123', name: 'Test' }));
    });

    await page.goto('http://localhost:3000/record.html');
    await new Promise(r => setTimeout(r, 2000));

    const results = await page.evaluate(() => {
        return {
            btnInsights: !!document.getElementById('btn-insights'),
            btnRecord: !!document.getElementById('btn-record'),
            btnUpload: !!document.getElementById('btn-upload'),
            btnClear: !!document.getElementById('btn-clear'),
            btnCopy: !!document.getElementById('btn-copy'),
            btnSummarize: !!document.getElementById('btn-summarize'),
            btnLogout: !!document.getElementById('btn-logout'),
            themeToggle: !!document.getElementById('theme-toggle'),
            summarizeIcon: !!document.getElementById('summarize-icon'),
            summarizeLabel: !!document.getElementById('summarize-label'),
            summarizeSpinner: !!document.getElementById('summarize-spinner'),
            transcriptBox: !!document.getElementById('transcript-box'),
            placeholder: !!document.getElementById('placeholder'),
            statusIndicator: !!document.getElementById('status-indicator'),
            statusText: !!document.getElementById('status-text'),
            recordIcon: !!document.getElementById('record-icon'),
            recordLabel: !!document.getElementById('record-label'),
            wordCount: !!document.getElementById('word-count'),
            langSelect: !!document.getElementById('lang-select'),
            browserWarning: !!document.getElementById('browser-warning'),
            toast: !!document.getElementById('toast'),
            toastMessage: !!document.getElementById('toast-message'),
            userGreeting: !!document.getElementById('user-greeting'),
            audioFileInput: !!document.getElementById('audio-file-input'),
            uploadProgress: !!document.getElementById('upload-progress'),
            uploadProgressBar: !!document.getElementById('upload-progress-bar'),
            uploadProgressText: !!document.getElementById('upload-progress-text')
        };
    });
    console.log("DOM elements found:", Object.entries(results).filter(x => !x[1]).map(x => x[0]));

    await browser.close();
}
testPage();
