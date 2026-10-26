/* ============================================
   EchoScribe — Auth Guard
   ============================================
   Include this script on all protected pages.
   Handles token storage, auth checks, and
   attaches auth headers to fetch requests.
   ============================================ */

const EchoAuth = (function () {
    'use strict';

    const TOKEN_KEY = 'echoscribe_token';
    const REFRESH_KEY = 'echoscribe_refresh_token';
    const USER_KEY = 'echoscribe_user';

    function getToken() {
        return localStorage.getItem(TOKEN_KEY);
    }

    function getRefreshToken() {
        return localStorage.getItem(REFRESH_KEY);
    }

    function getUser() {
        const raw = localStorage.getItem(USER_KEY);
        if (!raw) return null;
        try {
            return JSON.parse(raw);
        } catch (e) {
            return null;
        }
    }

    function saveSession(data) {
        localStorage.setItem(TOKEN_KEY, data.session.access_token);
        localStorage.setItem(REFRESH_KEY, data.session.refresh_token);
        localStorage.setItem(USER_KEY, JSON.stringify(data.user));
    }

    function clearSession() {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(REFRESH_KEY);
        localStorage.removeItem(USER_KEY);
    }

    function isAuthenticated() {
        return !!getToken();
    }

    // ─── Provider Settings (per-role provider chains) ───
    const PROVIDER_KEY = 'echoscribe_provider_chain';

    function getProviderChains() {
        try {
            const parsed = JSON.parse(localStorage.getItem(PROVIDER_KEY) || '{}');
            return parsed && typeof parsed === 'object' ? parsed : {};
        } catch (e) {
            return {};
        }
    }

    function saveProviderChains(chains) {
        // Each slot is { strategy, targets: [...] }; older saves were a bare targets array
        const targetsOf = (v) => (Array.isArray(v) ? v : v && v.targets) || [];
        const nonEmpty = Object.fromEntries(Object.entries(chains || {}).filter(([, v]) => targetsOf(v).length));
        if (Object.keys(nonEmpty).length) localStorage.setItem(PROVIDER_KEY, JSON.stringify(nonEmpty));
        else localStorage.removeItem(PROVIDER_KEY);
    }

    function getProviderChainHeader() {
        const chains = getProviderChains();
        if (!Object.keys(chains).length) return null;
        return btoa(unescape(encodeURIComponent(JSON.stringify(chains))));
    }

    // Wrapper for fetch that auto-attaches auth header
    async function authFetch(url, options = {}) {
        const token = getToken();
        if (!token) {
            window.location.href = '/login';
            return;
        }

        const headers = {
            ...options.headers,
            'Authorization': `Bearer ${token}`,
        };

        if (!(options.body instanceof FormData)) {
            headers['Content-Type'] = headers['Content-Type'] || 'application/json';
        }

        // User-configured provider chain from the Settings page (keys live only in this browser)
        const providerChain = getProviderChainHeader();
        if (providerChain) headers['X-Provider-Chain'] = providerChain;

        let response = await fetch(url, { ...options, headers });

        // If 401, try refreshing the token
        if (response.status === 401) {
            const refreshed = await refreshSession();
            if (refreshed) {
                headers['Authorization'] = `Bearer ${getToken()}`;
                response = await fetch(url, { ...options, headers });
            } else {
                clearSession();
                window.location.href = '/login';
                return;
            }
        }

        return response;
    }

    async function refreshSession() {
        const refreshToken = getRefreshToken();
        if (!refreshToken) return false;

        try {
            const response = await fetch('/api/auth/refresh', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ refresh_token: refreshToken }),
            });

            if (!response.ok) return false;

            const data = await response.json();
            localStorage.setItem(TOKEN_KEY, data.session.access_token);
            localStorage.setItem(REFRESH_KEY, data.session.refresh_token);
            return true;
        } catch (e) {
            return false;
        }
    }

    async function logout() {
        try {
            await authFetch('/api/auth/logout', { method: 'POST' });
        } catch (e) {
            // Ignore errors during logout
        }
        clearSession();
        window.location.href = '/login';
    }

    // Guard — redirect to login if not authenticated
    function guard() {
        if (!isAuthenticated()) {
            window.location.href = '/login';
        }
    }

    return {
        getToken,
        getUser,
        saveSession,
        clearSession,
        isAuthenticated,
        getProviderChains,
        saveProviderChains,
        authFetch,
        logout,
        guard,
    };
})();
