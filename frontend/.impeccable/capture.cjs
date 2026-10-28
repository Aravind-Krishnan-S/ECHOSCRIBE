/* Review captures of every screen at desktop (1440) and phone (390) widths, API mocked from the demo session. */
const R = p => require(require('path').join(__dirname, '..', '..', 'node_modules', p));
const path = require('path'), fs = require('fs');
const express = R('express'); const { chromium } = R('playwright-core');
const ROOT = path.join(__dirname, '..', '..');
const DIST = path.join(__dirname, '..', 'dist'), OUT = path.join(__dirname, 'review');
const session = JSON.parse(fs.readFileSync(path.join(ROOT, 'eval', 'results', 'demo_session.json'), 'utf8'));
const profile = { user_id: 'demo', email: 'clinician@example.org', full_name: 'Dr. Meera Nair', avatar_url: null, title: 'Clinical psychologist',
  organisation: 'Jyothi Counselling Centre', license_id: null, specialisations: [], phone: null, preferred_contact: null, role: 'both', prefs: {}, model_settings: {},
  onboarding: { tour_completed: true, viewed_note: true } };
const patients = [{ id: session.patient_id, name: 'Role-play client', age: 34, gender: 'F', notes: '', email: null, phone: null, created_at: session.created_at },
  { id: 'p2', name: 'Arjun Menon', age: 21, gender: 'M', notes: '', email: null, phone: null, created_at: session.created_at }];
const providers = { strategies: { priority: 'Declared order', 'round-robin': 'Even spread', lkgp: 'Last known good' },
  families: [
    { key: 'gemini', label: 'Google Gemini', capabilities: ['chat', 'transcribe', 'diarize'], requiresKey: true, group: 'Frontier labs', keyUrl: 'aistudio.google.com/apikey', serverKeys: 3, defaultModel: 'gemini-3.5-flash' },
    { key: 'groq', label: 'Groq', capabilities: ['chat', 'transcribe'], requiresKey: true, group: 'Inference platforms', keyUrl: 'console.groq.com/keys', serverKeys: 1, defaultModel: 'openai/gpt-oss-120b' },
    { key: 'openrouter', label: 'OpenRouter (free models only)', capabilities: ['chat'], requiresKey: true, group: 'Inference platforms', keyUrl: 'openrouter.ai/settings/keys', serverKeys: 1, defaultModel: 'nvidia/nemotron-3-ultra-550b-a55b:free' },
    { key: 'ollama', label: 'Ollama (this computer)', capabilities: ['chat'], requiresKey: false, group: 'On this computer', keyUrl: 'ollama.com/download', serverKeys: 0, defaultModel: 'llama3.1:8b' }],
  slots: Object.fromEntries(['STT', 'ROLE_LABEL', 'NOTE_SYNTH', 'PROFILE_GEN', 'VERIFY'].map(s => [s, { label: s, capability: s === 'STT' ? 'transcribe' : 'chat', userConfigurable: true, source: 'reference', strategy: 'priority', entries: [{ family: 'gemini', model: 'gemini-3.5-flash', keyCount: 3, activeKeys: 3 }] }])) };
const screens = [['login', '/login', false], ['signup', '/signup', false], ['workspaces', '/workspaces'], ['home', '/w/therapy'], ['home-mentoring', '/w/mentoring'],
  ['clients', '/w/therapy/clients'], ['client', `/w/therapy/clients/${session.patient_id}`], ['record', '/w/therapy/record'],
  ['summary', `/w/therapy/sessions/${session.id}`], ['profile', '/settings/profile'], ['models', '/settings/models'], ['general', '/settings/general']];
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const app = express(); app.use(express.static(DIST, { index: false }));
  app.get(/^\/(?!api).*/, (q, s) => s.sendFile(path.join(DIST, 'index.html')));
  const server = app.listen(4720);
  const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  for (const [vw, vh, tag] of [[1440, 900, 'desktop'], [390, 844, 'mobile']]) {
    for (const [name, url, authed = true] of screens) {
      const page = await browser.newPage({ viewport: { width: vw, height: vh }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
      if (authed) await page.addInitScript(() => { localStorage.setItem('echoscribe_token', 'demo'); localStorage.setItem('echoscribe_refresh_token', 'demo');
        localStorage.setItem('echoscribe_user', JSON.stringify({ id: 'demo', email: 'clinician@example.org' })); localStorage.setItem('echoscribe_workspace', 'therapy'); });
      await page.route('**/api/**', route => { const u = new URL(route.request().url()).pathname; const j = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
        if (u === '/api/auth/profile') return j(profile); if (u.startsWith('/api/session/')) return j(session);
        if (u.startsWith('/api/patients/') && u.endsWith('/sessions')) return j([session]); if (u.startsWith('/api/patients/')) return j(patients[0]);
        if (u === '/api/patients') return j(patients); if (u === '/api/history') return j([session, { ...session, id: 's2', patient_id: 'p2' }]);
        if (u === '/api/providers') return j(providers); if (u === '/api/providers/keys') return j({ keys: [], syncAvailable: true });
        if (u === '/api/providers/models') return j({ models: [{ id: 'gemini-3.5-flash', caps: ['chat', 'transcribe'] }], live: true, hasKey: true });
        return j({}); });
      await page.goto(`http://localhost:4720${url}`, { waitUntil: 'networkidle' }); await page.waitForTimeout(700);
      await page.screenshot({ path: path.join(OUT, `${tag}-${name}.png`), fullPage: true }); await page.close();
    }
  }
  await browser.close(); server.close(); console.log('captured', fs.readdirSync(OUT).length);
})().catch(e => { console.error(e); process.exit(1); });
