/* eval/screenshot_ui.js — renders the built frontend (frontend/dist) in headless Edge and saves the
   interface figures for the paper. API calls are answered from eval/results/demo_session.json (real
   pipeline output on a role-played transcript), so no account or database is needed.
   Usage: node eval/screenshot_ui.js   (run `npx vite build` in frontend/ first) */

const path = require('path');
const fs = require('fs');
const express = require('express');
const { chromium } = require('playwright-core');

const DIST = path.join(__dirname, '..', 'frontend', 'dist');
const OUT = path.join(__dirname, '..', 'paper', 'figures');
const session = JSON.parse(fs.readFileSync(path.join(__dirname, 'results', 'demo_session.json'), 'utf8'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

const profile = {
    user_id: 'demo', email: 'clinician@example.org', full_name: 'Dr. Meera Nair', avatar_url: null,
    title: 'Clinical psychologist', organisation: null, license_id: null, specialisations: [], phone: null,
    preferred_contact: null, role: 'therapist', prefs: {}, model_settings: {},
    onboarding: { tour_completed: true, viewed_note: true, checklist_dismissed: true },
};
const patient = { id: session.patient_id, name: 'Role-play client', age: 34, gender: null, notes: '', email: null, phone: null, created_at: session.created_at };

(async () => {
    fs.mkdirSync(OUT, { recursive: true });
    const app = express();
    app.use(express.static(DIST, { index: false }));
    app.get(/^\/(?!api).*/, (req, res) => res.sendFile(path.join(DIST, 'index.html')));
    const server = app.listen(4719);

    const browser = await chromium.launch({ executablePath: EDGE, headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1060 }, deviceScaleFactor: 2 });
    await page.addInitScript(() => {
        localStorage.setItem('echoscribe_token', 'demo');
        localStorage.setItem('echoscribe_refresh_token', 'demo');
        localStorage.setItem('echoscribe_user', JSON.stringify({ id: 'demo', email: 'clinician@example.org' }));
        localStorage.setItem('echoscribe_workspace', 'therapy');
    });
    await page.route('**/api/**', route => {
        const url = new URL(route.request().url());
        const json = body => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
        if (url.pathname === '/api/auth/profile') return json(profile);
        if (url.pathname.startsWith('/api/session/')) return json(session);
        if (url.pathname === `/api/patients/${session.patient_id}`) return json(patient);
        if (url.pathname === '/api/patients') return json([patient]);
        if (url.pathname === '/api/history') return json([session]);
        return json({});
    });

    await page.goto(`http://localhost:4719/w/therapy/sessions/${session.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-tour="risk"]');
    await page.waitForTimeout(600);
    // Hover a partly supported sentence so the figure shows its cited turns highlighted
    const partial = page.locator('span[role="button"].decoration-dotted').first();
    if (await partial.count()) { await partial.scrollIntoViewIfNeeded(); await partial.hover(); }
    await page.evaluate(() => window.scrollTo(0, 0));
    if (await partial.count()) await partial.hover();
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUT, 'ui_summary.png'), fullPage: false });
    console.log('saved', path.join(OUT, 'ui_summary.png'));

    // Paper crops: a narrow (single-column) layout keeps text large relative to the image width
    const narrow = await browser.newPage({ viewport: { width: 560, height: 2400 }, deviceScaleFactor: 3 });
    await narrow.addInitScript(() => {
        localStorage.setItem('echoscribe_token', 'demo');
        localStorage.setItem('echoscribe_refresh_token', 'demo');
        localStorage.setItem('echoscribe_user', JSON.stringify({ id: 'demo', email: 'clinician@example.org' }));
    });
    await narrow.route('**/api/**', route => page.context() && route.fallback());
    await narrow.unroute('**/api/**');
    await narrow.route('**/api/**', route => {
        const url = new URL(route.request().url());
        const json = body => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
        if (url.pathname === '/api/auth/profile') return json(profile);
        if (url.pathname.startsWith('/api/session/')) return json(session);
        if (url.pathname === `/api/patients/${session.patient_id}`) return json(patient);
        return json({});
    });
    await narrow.goto(`http://localhost:4719/w/therapy/sessions/${session.id}`, { waitUntil: 'networkidle' });
    await narrow.waitForSelector('[data-tour="transcript"]');
    await narrow.addStyleTag({ content: 'header.sticky, .lg\\:hidden.sticky { position: static !important; } [data-tour="transcript"] ol { max-height: none !important; overflow: visible !important; }' });

    // Hover the Objective sentence that cites the passive-ideation turns, so those turns light up
    const sentences = narrow.locator('article').nth(1).locator('span[role="button"]');
    const n = await sentences.count();
    let target = sentences.first();
    for (let i = 0; i < n; i++) {
        const label = await sentences.nth(i).getAttribute('aria-label');
        if (/turns [^)]*\b6\b/.test(label || '')) { target = sentences.nth(i); break; }
    }
    await target.hover();
    await narrow.waitForTimeout(300);

    const bar = await narrow.locator('section[aria-label] > div.panel').first().boundingBox();
    const objective = await narrow.locator('article').nth(1).boundingBox();
    await narrow.screenshot({ path: path.join(OUT, 'ui_bar.png'), clip: bar, fullPage: true });
    await narrow.screenshot({ path: path.join(OUT, 'ui_objective.png'), clip: objective, fullPage: true });

    const rows = narrow.locator('[data-tour="transcript"] li');
    const first = await rows.nth(3).boundingBox();   // T4
    const last = await rows.nth(7).boundingBox();    // T8
    const panel = await narrow.locator('[data-tour="transcript"]').boundingBox();
    await narrow.screenshot({ path: path.join(OUT, 'ui_transcript.png'), clip: { x: panel.x, y: first.y - 6, width: panel.width, height: last.y + last.height - first.y + 12 }, fullPage: true });
    console.log('saved ui_note.png and ui_transcript.png');

    await browser.close();
    server.close();
})().catch(e => { console.error(e); process.exit(1); });
