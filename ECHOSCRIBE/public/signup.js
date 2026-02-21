(function () {
    'use strict';

    if (EchoAuth.isAuthenticated()) {
        window.location.href = '/dashboard';
        return;
    }

    const form = document.getElementById('signup-form');
    const signupBtn = document.getElementById('signup-btn');
    const errorDiv = document.getElementById('auth-error');
    const successDiv = document.getElementById('auth-success');

    form.addEventListener('submit', async function (e) {
        e.preventDefault();
        errorDiv.style.display = 'none';
        successDiv.style.display = 'none';

        const email = document.getElementById('email').value.trim();
        const password = document.getElementById('password').value;
        const confirmPassword = document.getElementById('confirm-password').value;

        if (!email || !password || !confirmPassword) {
            showError('Please fill in all fields.');
            return;
        }

        if (password.length < 6) {
            showError('Password must be at least 6 characters.');
            return;
        }

        if (password !== confirmPassword) {
            showError('Passwords do not match.');
            return;
        }

        signupBtn.disabled = true;
        signupBtn.textContent = 'Creating account...';

        try {
            const response = await fetch('/api/auth/signup', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password }),
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Signup failed');
            }

            // If session is returned, user is auto-confirmed (email confirmation disabled)
            if (data.session) {
                EchoAuth.saveSession(data);
                window.location.href = '/dashboard';
            } else {
                showSuccess('Account created! Please check your email to verify, then log in.');
                form.reset();
            }
        } catch (err) {
            showError(err.message);
        } finally {
            signupBtn.disabled = false;
            signupBtn.textContent = 'Create Account';
        }
    });

    function showError(msg) {
        errorDiv.textContent = msg;
        errorDiv.style.display = 'block';
        successDiv.style.display = 'none';
    }

    function showSuccess(msg) {
        successDiv.textContent = msg;
        successDiv.style.display = 'block';
        errorDiv.style.display = 'none';
    }
})();
