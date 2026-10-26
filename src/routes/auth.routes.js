const express = require('express');
const { z } = require('zod');
const multer = require('multer');
const os = require('os');
const path = require('path');
const { validate } = require('../middleware/validate');
const authController = require('../controllers/auth.controller');

const router = express.Router();

// Validation schemas
const signupSchema = z.object({
    email: z.string().email('Valid email is required'),
    password: z.string().min(8, 'Password must be at least 8 characters'),
    full_name: z.string().trim().min(1, 'Your name is required').max(120),
    role: z.enum(['therapist', 'mentor', 'both']),
});

const optionalText = (max) => z.string().trim().max(max).nullable().optional();

const profileSchema = z.object({
    full_name: z.string().trim().min(1, 'Your name is required').max(120).optional(),
    title: optionalText(120),
    organisation: optionalText(160),
    license_id: optionalText(80),
    specialisations: z.array(z.string().trim().min(1).max(60)).max(12).optional(),
    phone: optionalText(30),
    preferred_contact: z.enum(['email', 'phone', 'either']).nullable().optional(),
    role: z.enum(['therapist', 'mentor', 'both']).optional(),
    prefs: z.record(z.any()).optional(),
    onboarding: z.record(z.any()).optional(),
    model_settings: z.record(z.any()).optional(),
}).strict();

const passwordSchema = z.object({
    current_password: z.string().min(1, 'Enter your current password'),
    new_password: z.string().min(8, 'Use at least 8 characters'),
});

const avatarUpload = multer({
    dest: path.join(os.tmpdir(), 'echoscribe-avatars'),
    limits: { fileSize: 4 * 1024 * 1024 },
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
router.get('/profile', authController.getProfile);
router.put('/profile', validate(profileSchema), authController.updateProfile);
router.post('/avatar', avatarUpload.single('photo'), authController.uploadAvatar);
router.post('/password', validate(passwordSchema), authController.changePassword);

module.exports = router;
