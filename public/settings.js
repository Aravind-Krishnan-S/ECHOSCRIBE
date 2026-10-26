/* ============================================
   EchoScribe — Provider Settings
   ============================================
   Lets a user build an ordered provider chain
   per processing role. Keys are validated with a
   test call before saving and stored in this
   browser only (see EchoAuth.saveProviderChains).
   ============================================ */

(function () {
    'use strict';

    EchoAuth.guard();

    const slotsEl = document.getElementById('slots');
    const statusEl = document.getElementById('save-status');
    let families = [];
    let strategies = {};
    let slots = {};
    let draft = {}; // slot → { strategy, targets: [{ family, model, keys }] }

    // Older saves stored a bare array of targets
    function normalizeCombo(value) {
        if (Array.isArray(value)) return { strategy: 'priority', targets: value };
        return { strategy: (value && value.strategy) || 'priority', targets: (value && value.targets) || [] };
    }

    function strategyOptions(selected) {
        return Object.entries(strategies).map(([key, desc]) =>
            `<option value="${esc(key)}" title="${esc(desc)}" ${key === selected ? 'selected' : ''}>${esc(key)}</option>`).join('');
    }

    const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    function familiesFor(capability) {
        return families.filter(f => f.capabilities.includes(capability));
    }

    function describeDefault(slot) {
        const s = slots[slot];
        if (!s.entries.length) return '<em>No server default configured</em>';
        return s.entries.map(e => `<code>${esc(e.family)}:${esc(e.model)}</code>${e.keyCount > 1 ? ` (${e.keyCount} keys)` : ''}`).join(' → ')
            + ` <span class="slot-meta">[${esc(s.strategy)} · ${esc(s.source)}]</span>`;
    }

    function render() {
        slotsEl.innerHTML = Object.entries(slots).map(([slot, s]) => {
            const combo = draft[slot] || { strategy: 'priority', targets: [] };
            const entries = combo.targets;
            const options = familiesFor(s.capability);
            const head = `
                <div class="slot-head">
                    <h2>${esc(s.label)}</h2>
                    <span class="slot-meta">${esc(slot)} · ${esc(s.capability)}</span>
                </div>
                <div class="chain-default">Server default: ${describeDefault(slot)}</div>`;

            if (!s.userConfigurable) {
                return `<section class="card slot-card">${head}
                    <p class="slot-meta" style="font-family: var(--font-ui);">Not user-configurable in this release:
                    changing the diarization model can affect the calibration of the role resolver. Administrators set it with
                    <code>ROLE_CHAIN_${esc(slot)}</code>.</p></section>`;
            }

            const rows = entries.map((e, i) => `
                <div class="entry" data-slot="${esc(slot)}" data-index="${i}">
                    <div class="entry-row">
                        <span class="entry-rank">${i + 1}</span>
                        <select data-field="family">
                            ${options.map(f => `<option value="${esc(f.key)}" ${f.key === e.family ? 'selected' : ''}>${esc(f.label)}</option>`).join('')}
                        </select>
                        <input data-field="model" placeholder="Model name, e.g. gemini-2.0-flash" value="${esc(e.model)}" />
                    </div>
                    <textarea data-field="keys" placeholder="API key(s), one per line — several keys form a rotating pool">${esc((e.keys || []).join('\n'))}</textarea>
                    <div class="entry-actions">
                        <button class="btn btn-secondary btn-sm" data-action="up" ${i === 0 ? 'disabled' : ''}>↑</button>
                        <button class="btn btn-secondary btn-sm" data-action="down" ${i === entries.length - 1 ? 'disabled' : ''}>↓</button>
                        <button class="btn btn-secondary btn-sm" data-action="remove">Remove</button>
                        <button class="btn btn-secondary btn-sm" data-action="test">Test</button>
                        <span class="test-result"></span>
                    </div>
                </div>`).join('');

            return `<section class="card slot-card">${head}
                ${entries.length ? `<p class="slot-meta" style="font-family: var(--font-ui); display: flex; gap: 0.6rem; align-items: center; flex-wrap: wrap;">
                    Your combo (overrides the server default for this role) · routing strategy
                    <select data-strategy-slot="${esc(slot)}" style="width: auto;">${strategyOptions(combo.strategy)}</select>
                    <span>${esc(strategies[combo.strategy] || '')}</span></p>` : ''}
                ${rows}
                <div class="entry-actions">
                    <button class="btn btn-secondary btn-sm" data-action="add" data-slot="${esc(slot)}">+ Add provider</button>
                    ${entries.length ? `<button class="btn btn-secondary btn-sm" data-action="clear" data-slot="${esc(slot)}">Use server default</button>` : ''}
                </div>
            </section>`;
        }).join('');
    }

    function readEntry(el) {
        return {
            family: el.querySelector('[data-field="family"]').value,
            model: el.querySelector('[data-field="model"]').value.trim(),
            keys: el.querySelector('[data-field="keys"]').value.split(/\r?\n/).map(k => k.trim()).filter(Boolean),
        };
    }

    // Strategy picker
    slotsEl.addEventListener('change', (ev) => {
        const slot = ev.target.dataset && ev.target.dataset.strategySlot;
        if (!slot || !draft[slot]) return;
        draft[slot].strategy = ev.target.value;
        render();
    });

    // Keep draft in sync with what is typed
    slotsEl.addEventListener('input', (ev) => {
        const entryEl = ev.target.closest('.entry');
        if (!entryEl) return;
        draft[entryEl.dataset.slot].targets[Number(entryEl.dataset.index)] = readEntry(entryEl);
    });

    async function testEntry(slot, entry) {
        const family = families.find(f => f.key === entry.family);
        if (!entry.model) return [{ ok: false, error: 'Model is required' }];
        const keys = family && family.requiresKey ? entry.keys : [null];
        if (!keys.length) return [{ ok: false, error: 'At least one API key is required' }];

        const results = [];
        for (const key of keys) {
            const res = await EchoAuth.authFetch('/api/providers/test', {
                method: 'POST',
                body: JSON.stringify({ family: entry.family, model: entry.model, key, slot }),
            });
            const data = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
            results.push(res.ok ? data : { ok: false, error: data.error || `HTTP ${res.status}` });
        }
        return results;
    }

    function showResults(entryEl, results) {
        const out = entryEl.querySelector('.test-result');
        out.innerHTML = results.map((r, i) => r.ok
            ? `<span class="ok">key ${i + 1} ✓ ${r.latencyMs} ms</span>`
            : `<span class="bad">key ${i + 1} ✗ ${esc(r.reason ? r.reason + ': ' : '')}${esc(r.error)}</span>`).join(' · ');
    }

    slotsEl.addEventListener('click', async (ev) => {
        const btn = ev.target.closest('button[data-action]');
        if (!btn) return;
        const action = btn.dataset.action;
        const entryEl = btn.closest('.entry');
        const slot = entryEl ? entryEl.dataset.slot : btn.dataset.slot;
        const combo = draft[slot] = draft[slot] || { strategy: 'priority', targets: [] };
        const list = combo.targets;
        const i = entryEl ? Number(entryEl.dataset.index) : -1;

        if (action === 'add') {
            const first = familiesFor(slots[slot].capability)[0];
            list.push({ family: first ? first.key : '', model: '', keys: [] });
        } else if (action === 'clear') {
            delete draft[slot];
        } else if (action === 'remove') {
            list.splice(i, 1);
        } else if (action === 'up' && i > 0) {
            [list[i - 1], list[i]] = [list[i], list[i - 1]];
        } else if (action === 'down' && i < list.length - 1) {
            [list[i + 1], list[i]] = [list[i], list[i + 1]];
        } else if (action === 'test') {
            btn.disabled = true;
            entryEl.querySelector('.test-result').textContent = 'Testing…';
            showResults(entryEl, await testEntry(slot, readEntry(entryEl)));
            btn.disabled = false;
            return;
        }
        render();
    });

    document.getElementById('btn-save').addEventListener('click', async () => {
        const saveBtn = document.getElementById('btn-save');
        saveBtn.disabled = true;
        statusEl.style.color = 'var(--text-secondary)';
        statusEl.textContent = 'Testing every key…';

        let failures = 0;
        for (const entryEl of slotsEl.querySelectorAll('.entry')) {
            const results = await testEntry(entryEl.dataset.slot, readEntry(entryEl));
            showResults(entryEl, results);
            failures += results.filter(r => !r.ok).length;
        }

        if (failures) {
            statusEl.style.color = 'var(--danger)';
            statusEl.textContent = `${failures} key(s) failed the test call — nothing was saved.`;
        } else {
            EchoAuth.saveProviderChains(draft);
            statusEl.style.color = 'var(--mode-accent)';
            statusEl.textContent = 'Saved. Changes apply from your next request.';
        }
        saveBtn.disabled = false;
    });

    document.getElementById('btn-reset').addEventListener('click', () => {
        draft = {};
        EchoAuth.saveProviderChains({});
        statusEl.style.color = 'var(--mode-accent)';
        statusEl.textContent = 'Using server defaults for every role.';
        render();
    });

    document.getElementById('btn-logout').addEventListener('click', () => EchoAuth.logout());

    (async function load() {
        try {
            const res = await EchoAuth.authFetch('/api/providers');
            if (!res) return;
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
            families = data.families;
            strategies = data.strategies || {};
            slots = data.slots;
            draft = Object.fromEntries(Object.entries(EchoAuth.getProviderChains()).map(([slot, v]) => [slot, normalizeCombo(v)]));
            render();
        } catch (err) {
            slotsEl.innerHTML = `<p style="color: var(--danger);">Could not load provider settings: ${esc(err.message)}</p>`;
        }
    })();
})();
