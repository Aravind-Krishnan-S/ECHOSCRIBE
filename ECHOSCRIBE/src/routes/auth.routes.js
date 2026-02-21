const express = require('express');
const { z } = require('zod');
const { validate } = require('../middleware/validate');
const authController = require('../controllers/auth.controller');

const router = express.Router();

// Validation schemas
const signupSchema = z.object({
    email: z.string().email('Valid email is required'),
    password: z.string().min(6, 'Password must be at least 6 characters'),
});

const loginSchema = z.object({
    email: z.string().email('Valid email is required'),
    password: z.string().min(1, 'Password is required'),
});

const refreshSchema = z.object({
    refresh_token: z.string().min(1, 'Refresh token is required'),
});

// Public routes (no auth required)
router.post('/signup', validate(signupSchema), authController.signup);
router.post('/login', validate(loginSchema), authController.login);
router.post('/refresh', validate(refreshSchema), authController.refresh);

// Protected routes (auth required — middleware applied in index.js)
router.post('/logout', authController.logout);
router.get('/me', authController.me);

module.exports = router;
