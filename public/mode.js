/**
 * EchoMode - Global State Management for Therapy vs. Mentoring Mode
 */
const EchoMode = (function () {
    const STORAGE_KEY = 'echoscribe_mode';
    const DEFAULT_MODE = 'therapy'; // 'therapy' or 'mentoring'

    // Mode specific configuration
    const CONFIG = {
        therapy: {
            id: 'therapy',
            label: 'Therapy Mode',
            primaryColor: 'var(--mode-therapy-primary)',
            accentColor: 'var(--mode-therapy-accent)',
            texts: {
                patient: 'Patient',
                patients: 'Patients',
                counselor: 'Therapist',
                notes: 'Clinical Notes',
                risk: 'Clinical Risk'
            }
        },
        mentoring: {
            id: 'mentoring',
            label: 'Mentoring Mode',
            primaryColor: 'var(--mode-mentoring-primary)',
            accentColor: 'var(--mode-mentoring-accent)',
            texts: {
                patient: 'Mentee',
                patients: 'Mentees',
                counselor: 'Mentor',
                notes: 'Academic Notes',
                risk: 'Burnout Risk'
            }
        }
    };

    let currentMode = localStorage.getItem(STORAGE_KEY) || DEFAULT_MODE;

    function init() {
        applyMode(currentMode);
        setupGlobalToggle();
    }

    function applyMode(mode) {
        if (!CONFIG[mode]) mode = DEFAULT_MODE;
        currentMode = mode;

        // 1. Update localStorage
        localStorage.setItem(STORAGE_KEY, mode);

        // 2. Set data attribute on the body for CSS to target
        document.body.setAttribute('data-mode', mode);

        // 3. Dispatch global custom event for components to listen to
        const event = new CustomEvent('echoscribe:modeChange', { detail: { mode, config: CONFIG[mode] } });
        document.dispatchEvent(event);

        // 4. Update the toggle switch UI if it exists
        updateToggleUI();

        // 5. Update dynamic text elements across the DOM (ones with data-mode-text attribute)
        updateDynamicTexts();
    }

    function toggle() {
        const nextMode = currentMode === 'therapy' ? 'mentoring' : 'therapy';
        applyMode(nextMode);
    }

    function setupGlobalToggle() {
        // If the toggle switch doesn't exist in the DOM, inject it
        if (!document.getElementById('global-mode-toggle')) {
            const toggleContainer = document.createElement('div');
            toggleContainer.className = 'global-mode-toggle-container';
            toggleContainer.innerHTML = `
                <div class="mode-toggle-track" id="global-mode-toggle" title="Switch Mode (Therapy / Mentoring)">
                    <div class="mode-toggle-thumb">
                        <span class="mode-icon-therapy">🩺</span>
                        <span class="mode-icon-mentoring">🎓</span>
                    </div>
                </div>
            `;
            document.body.appendChild(toggleContainer);

            document.getElementById('global-mode-toggle').addEventListener('click', () => {
                toggle();
            });
        }
        updateToggleUI();
    }

    function updateToggleUI() {
        const toggleTrack = document.getElementById('global-mode-toggle');
        if (toggleTrack) {
            if (currentMode === 'mentoring') {
                toggleTrack.classList.add('mode-active-mentoring');
            } else {
                toggleTrack.classList.remove('mode-active-mentoring');
            }
        }
    }

    function updateDynamicTexts() {
        const elements = document.querySelectorAll('[data-mode-text]');
        const texts = CONFIG[currentMode].texts;

        elements.forEach(el => {
            const key = el.getAttribute('data-mode-text');
            if (texts[key]) {
                el.textContent = texts[key];
            }
        });
    }

    return {
        init,
        toggle,
        getMode: () => currentMode,
        getConfig: () => CONFIG[currentMode]
    };
})();

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', EchoMode.init);
} else {
    EchoMode.init();
}
