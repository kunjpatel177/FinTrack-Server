const express = require('express');
const router = express.Router();
const {
  register,
  verifyEmail,
  resendVerification,
  login,
  verifyMfaLogin,
  resendLoginEmailOtp,
  setupTotp,
  verifyTotpSetup,
  sendEmailOtpTest,
  verifyEmailOtpTest,
  updateMfaPreference,
  getMe,
  updateProfile,
  updatePassword,
  forgotPassword,
  resetPassword,
  deleteAccount,
  updateNetBalance,
} = require('../controllers/authController');
const { protect } = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimiter');

// Public Authentication & Onboarding
router.post('/register', authLimiter, register);
router.post('/login', authLimiter, login);
router.post('/verify-email/:token', authLimiter, verifyEmail);
router.post('/resend-verification', authLimiter, resendVerification);

// MFA Login Challenge (Public with mfaToken)
router.post('/mfa/verify', authLimiter, verifyMfaLogin);
router.post('/mfa/resend-email-otp', authLimiter, resendLoginEmailOtp);

// Password Recovery
router.post('/forgot-password', authLimiter, forgotPassword);
router.post('/reset-password/:token', authLimiter, resetPassword);

// Authenticated User Profile & Security Configuration
router.get('/me', protect, getMe);
router.put('/profile', protect, updateProfile);
router.put('/password', protect, updatePassword);
router.delete('/delete-account', protect, deleteAccount);
router.post('/balance', protect, updateNetBalance);

// Authenticated MFA Management
router.post('/mfa/totp/setup', protect, setupTotp);
router.post('/mfa/totp/verify', protect, verifyTotpSetup);
router.post('/mfa/email/send-test', protect, sendEmailOtpTest);
router.post('/mfa/email/verify-test', protect, verifyEmailOtpTest);
router.put('/mfa/preference', protect, updateMfaPreference);

module.exports = router;
