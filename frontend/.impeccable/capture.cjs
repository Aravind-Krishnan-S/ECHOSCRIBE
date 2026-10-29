/* Review captures of every screen at desktop (1440) and phone (390) widths, API mocked from the demo session.
   MODE=worst: realistic worst-case data (long, short, non-Latin, missing fields, many rows); MODE=empty: a new account. */
const MODE = process.env.MODE || 'demo';
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
if (MODE === 'worst') {
  Object.assign(profile, { full_name: 'Aleksandra Wiśniewska-Kowalczyk', email: 'aleksandra.wisniewska-kowalczyk@northwind-counselling-services.example.com',
    title: 'Senior Clinical Psychologist and Head of Adolescent Services', organisation: 'Northwind Integrated Mental Health and Wellbeing Trust' });
  const names = ['Bartholomew Fitzgerald-Montgomery III', 'Jo', '李小龍', 'مريم عبد الرحمن', 'Nguyễn Thị Minh Khai', 'Anand Krishnamoorthy Venkataraman Subramaniam', 'Ö'];
  patients.length = 0;
  for (let i = 0; i < 64; i++) patients.push({ id: i === 0 ? session.patient_id : `p${i}`, name: names[i % names.length] + (i >= names.length ? ` ${i}` : ''),
    age: i % 3 ? 20 + i : null, gender: i % 4 ? 'F' : null, notes: '', email: i % 2 ? 'bartholomew.fitzgerald@northwind-industries-holdings.example.com' : null, phone: null, created_at: session.created_at });
  session.analysis_json = { ...session.analysis_json, topics: ['Persistent early-morning waking linked to anticipatory anxiety about a performance review that keeps being rescheduled', ...(session.analysis_json.topics || [])] };
}
if (MODE === 'empty') patients.length = 0;
const history = MODE === 'empty' ? [] : MODE === 'worst'
  ? Array.from({ length: 140 }, (_, i) => ({ ...session, id: i ? `s${i}` : session.id, patient_id: patients[i % patients.length].id, created_at: new Date(Date.now() - i * 36e5 * 7).toISOString() }))
  : [session, { ...session, id: 's2', patient_id: 'p2' }];
const syncedKeys = MODE === 'worst' ? Array.from({ length: 6 }, (_, i) => ({ id: `k${i}`, family: ['gemini', 'groq', 'openrouter'][i % 3], label: null, last4: 'x9Q' + i, created_at: session.created_at })) : [];
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
      if (authed) await page.addInitScript((worst) => { if (worst) localStorage.setItem('echoscribe_local_keys', JSON.stringify([{ id: 'l1', family: 'gemini', key: 'AIzaSyD-very-long-local-key-0000000000000000', addedAt: '2026-10-01' }, { id: 'l2', family: 'groq', key: 'gsk_short1', addedAt: '2026-10-01' }])); localStorage.setItem('echoscribe_token', 'demo'); localStorage.setItem('echoscribe_refresh_token', 'demo');
        localStorage.setItem('echoscribe_user', JSON.stringify({ id: 'demo', email: 'clinician@example.org' })); localStorage.setItem('echoscribe_workspace', 'therapy'); }, MODE === 'worst');
      await page.route('**/api/**', route => { const u = new URL(route.request().url()).pathname; const j = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
        if (u === '/api/auth/profile') return j(profile); if (u.startsWith('/api/session/')) return j(session);
        if (u.startsWith('/api/patients/') && u.endsWith('/sessions')) return j(MODE === 'empty' ? [] : history.slice(0, MODE === 'worst' ? 40 : 1)); if (u.startsWith('/api/patients/')) return j(patients[0] || { id: 'x', name: 'Jo', created_at: session.created_at });
        if (u === '/api/patients') return j(patients); if (u === '/api/history') return j(history);
        if (u === '/api/providers') return j(providers); if (u === '/api/providers/keys') return j({ keys: syncedKeys, syncAvailable: true });
        if (u === '/api/providers/status') return j({ slot: 'NOTE_SYNTH', models: [
          { family: 'gemini', model: 'gemini-3.5-flash', label: 'Google Gemini (gemini-3.5-flash)', available: false, cooldownSeconds: 214, reason: 'rate limited' },
          { family: 'gemini', model: 'gemini-3-flash-preview', label: 'Google Gemini (gemini-3-flash-preview)', available: true, cooldownSeconds: 0, reason: null },
          { family: 'gemini', model: 'gemini-3.6-flash', label: 'Google Gemini (gemini-3.6-flash)', available: false, cooldownSeconds: 61, reason: 'rate limited' },
          { family: 'gemini', model: 'gemini-3.5-flash-lite', label: 'Google Gemini (gemini-3.5-flash-lite)', available: true, cooldownSeconds: 0, reason: null },
          { family: 'groq', model: 'openai/gpt-oss-120b', label: 'Groq (openai/gpt-oss-120b)', available: true, cooldownSeconds: 0, reason: null }] });
        if (u === '/api/providers/models') return j({ models: [{ id: 'gemini-3.5-flash', caps: ['chat', 'transcribe'] }], live: true, hasKey: true });
        return j({}); });
      await page.goto(`http://localhost:4720${url}`, { waitUntil: 'networkidle' }); await page.waitForTimeout(700);
      if (MODE === 'menu') {
        if (name !== 'summary') { await page.close(); continue; }
        await page.click('button[aria-label="Choose the model for the new note"]'); await page.waitForTimeout(600);
        await page.screenshot({ path: path.join(OUT, `menu-${tag}-${name}.png`), fullPage: false }); await page.close(); continue;
      }
      await page.screenshot({ path: path.join(OUT, `${MODE === 'demo' ? '' : MODE + '-'}${tag}-${name}.png`), fullPage: true }); await page.close();
    }
  }
  await browser.close(); server.close(); console.log('captured', fs.readdirSync(OUT).length);
})().catch(e => { console.error(e); process.exit(1); });
