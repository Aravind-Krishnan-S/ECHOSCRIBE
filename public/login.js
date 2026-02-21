(function () {
    'use strict';

    // If already logged in, redirect to main app
    if (EchoAuth.isAuthenticated()) {
        window.location.href = '/dashboard';
        return;
    }

    const form = document.getElementById('login-form');
    const loginBtn = document.getElementById('login-btn');
    const errorDiv = document.getElementById('auth-error');
    const successDiv = document.getElementById('auth-success');

    form.addEventListener('submit', async function (e) {
        e.preventDefault();
        errorDiv.style.display = 'none';

        const email = document.getElementById('email').value.trim();
        const password = document.getElementById('password').value;

        if (!email || !password) {
            showError('Please fill in all fields.');
            return;
        }

        loginBtn.disabled = true;
        loginBtn.textContent = 'Signing in...';

        try {
            const response = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password }),
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Login failed');
            }

            EchoAuth.saveSession(data);
            window.location.href = '/dashboard';
        } catch (err) {
            showError(err.message);
        } finally {
            loginBtn.disabled = false;
            loginBtn.textContent = 'Sign In';
        }
    });

    function showError(msg) {
        errorDiv.textContent = msg;
        errorDiv.style.display = 'block';
    }
})();
