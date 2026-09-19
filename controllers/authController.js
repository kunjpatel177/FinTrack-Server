const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const speakeasy = require('speakeasy');
const qrcode = require('qrcode');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const Category = require('../models/Category');
const Budget = require('../models/Budget');
const Goal = require('../models/Goal');
const Recurring = require('../models/Recurring');
const Household = require('../models/Household');
const Invitation = require('../models/Invitation');
const ActivityLog = require('../models/ActivityLog');
const { logActivity } = require('../services/activityService');
const {
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendMfaOtpEmail,
  isRealSmtpConfigured,
} = require('../services/emailService');

// Generate JWT
const generateToken = (id) => {
  return jwt.sign(
    { id },
    process.env.JWT_SECRET || 'fintrack_super_secret_jwt_key_2026_production_grade',
    {
      expiresIn: process.env.JWT_EXPIRE || '7d',
    }
  );
};

// @desc    Register a new user
// @route   POST /api/v1/auth/register
// @access  Public
const register = async (req, res, next) => {
  try {
    const { name, email, password, currency, startingBalance } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide name, email, and password',
      });
    }

    // Check if user exists
    const userExists = await User.findOne({ email: email.toLowerCase() });
    if (userExists) {
      return res.status(400).json({
        success: false,
        message: 'An account with this email already exists',
      });
    }

    // Create user
    const user = new User({
      name,
      email: email.toLowerCase(),
      password,
      currency: currency || 'INR',
      startingBalance: parseFloat(startingBalance) || 0,
    });

    const verificationToken = user.getEmailVerificationToken();
    await user.save();

    // Send verification email
    const emailResult = await sendVerificationEmail({
      to: user.email,
      name: user.name,
      token: verificationToken,
    });

    const token = generateToken(user._id);

    await logActivity(user._id, 'USER_REGISTER', 'User created an account');

    res.status(201).json({
      success: true,
      message: emailResult.isRealDelivery
        ? 'Account registered successfully! A verification link has been delivered to your email.'
        : 'Account registered successfully! (Development Mode: To deliver real emails to your inbox, configure SMTP_USER & SMTP_PASS in server/.env).',
      data: {
        token,
        verificationToken,
        isRealDelivery: emailResult.isRealDelivery,
        previewUrl: emailResult.previewUrl,
        verifyLink: emailResult.verifyLink,
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          currency: user.currency,
          startingBalance: user.startingBalance || 0,
          avatar: user.avatar,
          activeHousehold: user.activeHousehold,
          isEmailVerified: false,
          mfaType: 'none',
          isTotpVerified: false,
          isEmailOtpEnabled: false,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Verify email with token
// @route   POST /api/v1/auth/verify-email/:token
// @access  Public
const verifyEmail = async (req, res, next) => {
  try {
    const { token } = req.params;
    if (!token) {
      return res.status(400).json({ success: false, message: 'Verification token is required' });
    }

    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

    const user = await User.findOne({
      emailVerificationToken: hashedToken,
      emailVerificationExpire: { $gt: Date.now() },
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired email verification link.',
      });
    }

    user.isEmailVerified = true;
    user.emailVerificationToken = undefined;
    user.emailVerificationExpire = undefined;
    await user.save({ validateBeforeSave: false });

    await logActivity(user._id, 'EMAIL_VERIFIED', 'User successfully verified their email address');

    res.status(200).json({
      success: true,
      message: 'Your email address has been verified successfully!',
      data: {
        id: user._id,
        name: user.name,
        email: user.email,
        isEmailVerified: true,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Resend verification email
// @route   POST /api/v1/auth/resend-verification
// @access  Public / Private
const resendVerification = async (req, res, next) => {
  try {
    let email = req.body?.email;
    let user;

    // 1. Check req.user if populated by auth middleware
    if (req.user && req.user.id) {
      user = await User.findById(req.user.id);
    }

    // 2. Check Authorization header token if present (even on public route)
    if (!user && req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      try {
        const token = req.headers.authorization.split(' ')[1];
        const decoded = jwt.verify(
          token,
          process.env.JWT_SECRET || 'fintrack_super_secret_jwt_key_2026_production_grade'
        );
        if (decoded && decoded.id) {
          user = await User.findById(decoded.id);
        }
      } catch (err) {
        // Token invalid, continue to email fallback
      }
    }

    // 3. Check email in request body
    if (!user && email) {
      user = await User.findOne({ email: email.toLowerCase().trim() });
    }

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found. Please log in or provide an email.' });
    }

    if (user.isEmailVerified) {
      return res.status(400).json({ success: false, message: 'Email is already verified.' });
    }

    const verificationToken = user.getEmailVerificationToken();
    await user.save({ validateBeforeSave: false });

    const emailResult = await sendVerificationEmail({
      to: user.email,
      name: user.name,
      token: verificationToken,
    });

    res.status(200).json({
      success: true,
      message: emailResult.isRealDelivery
        ? 'A fresh verification link has been sent to your email address.'
        : 'A fresh verification link has been generated (Configure SMTP in server/.env for real delivery).',
      verificationToken,
      verifyLink: emailResult.verifyLink,
      isRealDelivery: emailResult.isRealDelivery,
      previewUrl: emailResult.previewUrl,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Login user (with optional MFA challenge)
// @route   POST /api/v1/auth/login
// @access  Public
const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide email and password',
      });
    }

    // Check for user
    const user = await User.findOne({ email: email.toLowerCase() }).select('+password +totpSecret');
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password',
      });
    }

    // Check password
    const isMatch = await user.matchPassword(password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password',
      });
    }

    const mfaType = user.mfaType || 'none';

    // If user has enabled MFA
    if (mfaType !== 'none') {
      let message = 'Additional security verification required.';
      let otpCode = null;
      let emailResult = null;

      if (mfaType === 'email' || mfaType === 'both') {
        const otp = user.generateEmailOtp();
        otpCode = otp;
        await user.save({ validateBeforeSave: false });
        emailResult = await sendMfaOtpEmail({ to: user.email, name: user.name, otp });
        message =
          mfaType === 'both'
            ? 'Enter your Authenticator code and the Email OTP sent to your inbox.'
            : 'A 6-digit verification code has been dispatched to your email.';
      } else if (mfaType === 'authenticator') {
        message = 'Please enter the 6-digit code from your Authenticator app.';
      }

      // Short-lived MFA session token (5 minutes)
      const mfaToken = jwt.sign(
        { id: user._id, stage: 'mfa_pending', mfaType },
        process.env.JWT_SECRET || 'fintrack_super_secret_jwt_key_2026_production_grade',
        { expiresIn: '5m' }
      );

      return res.status(200).json({
        success: true,
        mfaRequired: true,
        mfaType,
        mfaToken,
        email: user.email,
        message,
        isRealDelivery: emailResult ? emailResult.isRealDelivery : true,
        debugOtp: emailResult && !emailResult.isRealDelivery ? otpCode : undefined,
      });
    }

    // Normal login flow without MFA
    const token = generateToken(user._id);

    await logActivity(user._id, 'USER_LOGIN', 'User logged in');

    res.status(200).json({
      success: true,
      message: 'Logged in successfully',
      data: {
        token,
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          currency: user.currency,
          startingBalance: user.startingBalance || 0,
          avatar: user.avatar,
          activeHousehold: user.activeHousehold,
          isEmailVerified: user.isEmailVerified,
          mfaType: user.mfaType || 'none',
          isTotpVerified: user.isTotpVerified,
          isEmailOtpEnabled: user.isEmailOtpEnabled,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Verify MFA Login (Authenticator TOTP and/or Email OTP)
// @route   POST /api/v1/auth/mfa/verify
// @access  Public (Authenticated with mfaToken)
const verifyMfaLogin = async (req, res, next) => {
  try {
    const { mfaToken, totpCode, emailOtp } = req.body;

    if (!mfaToken) {
      return res.status(400).json({ success: false, message: 'MFA session token is required' });
    }

    let decoded;
    try {
      decoded = jwt.verify(
        mfaToken,
        process.env.JWT_SECRET || 'fintrack_super_secret_jwt_key_2026_production_grade'
      );
    } catch (err) {
      return res.status(401).json({
        success: false,
        message: 'MFA verification session expired. Please log in again.',
      });
    }

    if (decoded.stage !== 'mfa_pending') {
      return res.status(401).json({ success: false, message: 'Invalid MFA session' });
    }

    const user = await User.findById(decoded.id).select('+totpSecret +emailOtp');
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const requiredType = decoded.mfaType;

    // Verify Authenticator TOTP if required
    if (requiredType === 'authenticator' || requiredType === 'both') {
      const strTotp = totpCode !== undefined && totpCode !== null ? totpCode.toString().trim() : '';
      if (!strTotp || strTotp.length !== 6) {
        return res.status(400).json({
          success: false,
          message: 'Valid 6-digit Authenticator code is required',
        });
      }

      if (!user.totpSecret) {
        return res.status(400).json({
          success: false,
          message: 'Authenticator secret not configured on this account',
        });
      }

      const isTotpValid = speakeasy.totp.verify({
        secret: user.totpSecret,
        encoding: 'base32',
        token: strTotp,
        window: 1,
      });

      if (!isTotpValid) {
        return res.status(400).json({
          success: false,
          message: 'Invalid Authenticator code. Please check your app and try again.',
        });
      }
    }

    // Verify Email OTP if required
    if (requiredType === 'email' || requiredType === 'both') {
      const strEmailOtp = emailOtp !== undefined && emailOtp !== null ? emailOtp.toString().trim() : '';
      if (!strEmailOtp || strEmailOtp.length !== 6) {
        return res.status(400).json({
          success: false,
          message: 'Valid 6-digit Email OTP is required',
        });
      }

      if (!user.emailOtp || !user.emailOtpExpire || user.emailOtpExpire < Date.now()) {
        return res.status(400).json({
          success: false,
          message: 'Email OTP has expired. Please request a new one.',
        });
      }

      const hashedInputOtp = crypto.createHash('sha256').update(strEmailOtp).digest('hex');
      if (hashedInputOtp !== user.emailOtp) {
        return res.status(400).json({
          success: false,
          message: 'Incorrect Email OTP',
        });
      }
    }

    // Clear one-time email OTP
    user.emailOtp = undefined;
    user.emailOtpExpire = undefined;
    await user.save({ validateBeforeSave: false });

    await logActivity(user._id, 'USER_LOGIN_MFA', `User logged in with MFA (${requiredType})`);

    const token = generateToken(user._id);

    res.status(200).json({
      success: true,
      message: 'MFA verification successful',
      data: {
        token,
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          currency: user.currency,
          startingBalance: user.startingBalance || 0,
          avatar: user.avatar,
          activeHousehold: user.activeHousehold,
          isEmailVerified: user.isEmailVerified,
          mfaType: user.mfaType || 'none',
          isTotpVerified: user.isTotpVerified,
          isEmailOtpEnabled: user.isEmailOtpEnabled,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Resend Email OTP during MFA Login
// @route   POST /api/v1/auth/mfa/resend-email-otp
// @access  Public (Authenticated with mfaToken)
const resendLoginEmailOtp = async (req, res, next) => {
  try {
    const { mfaToken } = req.body;
    if (!mfaToken) {
      return res.status(400).json({ success: false, message: 'MFA session token is required' });
    }

    let decoded;
    try {
      decoded = jwt.verify(
        mfaToken,
        process.env.JWT_SECRET || 'fintrack_super_secret_jwt_key_2026_production_grade'
      );
    } catch (err) {
      return res.status(401).json({
        success: false,
        message: 'MFA session expired. Please log in again.',
      });
    }

    if (decoded.mfaType !== 'email' && decoded.mfaType !== 'both') {
      return res.status(400).json({
        success: false,
        message: 'Email OTP is not enabled for this login session',
      });
    }

    const user = await User.findById(decoded.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const otp = user.generateEmailOtp();
    await user.save({ validateBeforeSave: false });
    const emailResult = await sendMfaOtpEmail({ to: user.email, name: user.name, otp });

    res.status(200).json({
      success: true,
      message: emailResult.isRealDelivery
        ? 'A fresh verification code has been dispatched to your email.'
        : `Simulated OTP: ${otp} (Configure SMTP in server/.env for real delivery)`,
      debugOtp: !emailResult.isRealDelivery ? otp : undefined,
      isRealDelivery: emailResult.isRealDelivery,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Setup Authenticator App (Generate QR Code & Secret)
// @route   POST /api/v1/auth/mfa/totp/setup
// @access  Private
const setupTotp = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Generate TOTP Secret
    const secret = speakeasy.generateSecret({
      length: 20,
      name: `FinTrack (${user.email})`,
      issuer: 'FinTrack',
    });

    user.totpSecret = secret.base32;
    await user.save({ validateBeforeSave: false });

    const qrCodeUrl = await qrcode.toDataURL(secret.otpauth_url);

    res.status(200).json({
      success: true,
      data: {
        secret: secret.base32,
        qrCode: qrCodeUrl,
        otpauthUrl: secret.otpauth_url,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Verify initial Authenticator setup code
// @route   POST /api/v1/auth/mfa/totp/verify
// @access  Private
const verifyTotpSetup = async (req, res, next) => {
  try {
    const { token } = req.body;
    const strToken = token !== undefined && token !== null ? token.toString().trim() : '';
    if (!strToken || strToken.length !== 6) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid 6-digit code from your Authenticator app',
      });
    }

    const user = await User.findById(req.user.id).select('+totpSecret');
    if (!user || !user.totpSecret) {
      return res.status(400).json({
        success: false,
        message: 'Authenticator setup not initiated. Please generate a QR code first.',
      });
    }

    const isValid = speakeasy.totp.verify({
      secret: user.totpSecret,
      encoding: 'base32',
      token: strToken,
      window: 1,
    });

    if (!isValid) {
      return res.status(400).json({
        success: false,
        message: 'Invalid verification code. Please check your Authenticator app time and try again.',
      });
    }

    user.isTotpVerified = true;
    await user.save({ validateBeforeSave: false });

    await logActivity(req.user.id, 'MFA_TOTP_SETUP', 'User verified Authenticator app setup');

    res.status(200).json({
      success: true,
      message: 'Authenticator app verified successfully! You can now enable Authenticator MFA in your settings.',
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Send test Email OTP during setup
// @route   POST /api/v1/auth/mfa/email/send-test
// @access  Private
const sendEmailOtpTest = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const otp = user.generateEmailOtp();
    await user.save({ validateBeforeSave: false });

    const emailResult = await sendMfaOtpEmail({ to: user.email, name: user.name, otp });

    let message;
    if (emailResult.isRealDelivery && emailResult.success) {
      message = `A test verification code has been dispatched to ${user.email}.`;
    } else if (emailResult.isRealDelivery && !emailResult.success) {
      message = `SMTP delivery error: ${emailResult.error || 'Failed to send'}. Please check your server/.env settings.`;
    } else {
      message = `Test OTP code: ${otp} (Real SMTP not configured in server/.env)`;
    }

    res.status(200).json({
      success: true,
      message,
      otp,
      debugOtp: otp,
      isRealDelivery: emailResult.isRealDelivery,
      emailDelivered: Boolean(emailResult.success && emailResult.isRealDelivery),
      error: emailResult.error || null,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Verify test Email OTP during setup
// @route   POST /api/v1/auth/mfa/email/verify-test
// @access  Private
const verifyEmailOtpTest = async (req, res, next) => {
  try {
    const { otp } = req.body;
    const strOtp = otp !== undefined && otp !== null ? otp.toString().trim() : '';
    if (!strOtp || strOtp.length !== 6) {
      return res.status(400).json({ success: false, message: 'Please enter a 6-digit verification code' });
    }

    const user = await User.findById(req.user.id).select('+emailOtp');
    if (!user || !user.emailOtp || !user.emailOtpExpire || user.emailOtpExpire < Date.now()) {
      return res.status(400).json({
        success: false,
        message: 'Test OTP has expired or was not requested.',
      });
    }

    const hashedInputOtp = crypto.createHash('sha256').update(strOtp).digest('hex');
    if (hashedInputOtp !== user.emailOtp) {
      return res.status(400).json({ success: false, message: 'Incorrect OTP' });
    }

    user.isEmailOtpEnabled = true;
    user.emailOtp = undefined;
    user.emailOtpExpire = undefined;
    await user.save({ validateBeforeSave: false });

    res.status(200).json({
      success: true,
      message: 'Email OTP delivery confirmed successfully! You can now enable Email OTP in your settings.',
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update MFA Preference (None, Authenticator, Email, or Both)
// @route   PUT /api/v1/auth/mfa/preference
// @access  Private
const updateMfaPreference = async (req, res, next) => {
  try {
    const { mfaType, currentPassword } = req.body;

    if (!['none', 'authenticator', 'email', 'both'].includes(mfaType)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid MFA type. Must be "none", "authenticator", "email", or "both"',
      });
    }

    if (!currentPassword) {
      return res.status(400).json({
        success: false,
        message: 'Please provide your current password to confirm this security change',
      });
    }

    const user = await User.findById(req.user.id).select('+password +totpSecret');
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const isMatch = await user.matchPassword(currentPassword);
    if (!isMatch) {
      return res.status(400).json({
        success: false,
        message: 'Current password is incorrect',
      });
    }

    // Check prerequisites
    if (['authenticator', 'both'].includes(mfaType)) {
      if (!user.isTotpVerified || !user.totpSecret) {
        return res.status(400).json({
          success: false,
          message: 'Please complete and verify Authenticator App setup before selecting this option.',
        });
      }
    }

    user.mfaType = mfaType;
    await user.save({ validateBeforeSave: false });

    await logActivity(
      req.user.id,
      'MFA_UPDATED',
      `Updated MFA preference to "${mfaType}"`
    );

    res.status(200).json({
      success: true,
      message: `MFA preference updated to ${mfaType === 'none' ? 'Disabled' : mfaType}.`,
      data: {
        mfaType: user.mfaType,
        isTotpVerified: user.isTotpVerified,
        isEmailOtpEnabled: user.isEmailOtpEnabled,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get current user
// @route   GET /api/v1/auth/me
// @access  Private
const getMe = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id).populate('activeHousehold', 'name owner members');
    res.status(200).json({
      success: true,
      data: {
        id: user._id,
        name: user.name,
        email: user.email,
        currency: user.currency,
        startingBalance: user.startingBalance || 0,
        avatar: user.avatar,
        activeHousehold: user.activeHousehold,
        isEmailVerified: user.isEmailVerified,
        mfaType: user.mfaType || 'none',
        isTotpVerified: user.isTotpVerified,
        isEmailOtpEnabled: user.isEmailOtpEnabled,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update user profile
// @route   PUT /api/v1/auth/profile
// @access  Private
const updateProfile = async (req, res, next) => {
  try {
    const { name, email, currency, startingBalance } = req.body;

    const fieldsToUpdate = {};
    if (name) fieldsToUpdate.name = name;
    if (currency) fieldsToUpdate.currency = currency;
    if (startingBalance !== undefined && !isNaN(parseFloat(startingBalance))) {
      fieldsToUpdate.startingBalance = parseFloat(startingBalance);
    }
    if (email && email.toLowerCase() !== req.user.email) {
      const existing = await User.findOne({ email: email.toLowerCase() });
      if (existing) {
        return res.status(400).json({
          success: false,
          message: 'This email is already in use by another account',
        });
      }
      fieldsToUpdate.email = email.toLowerCase();
      fieldsToUpdate.isEmailVerified = false;
    }

    const updatedUser = await User.findByIdAndUpdate(req.user.id, fieldsToUpdate, {
      new: true,
      runValidators: true,
    });

    await logActivity(req.user.id, 'PROFILE_UPDATE', 'User updated profile details');

    res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      data: {
        id: updatedUser._id,
        name: updatedUser.name,
        email: updatedUser.email,
        currency: updatedUser.currency,
        startingBalance: updatedUser.startingBalance || 0,
        avatar: updatedUser.avatar,
        activeHousehold: updatedUser.activeHousehold,
        isEmailVerified: updatedUser.isEmailVerified,
        mfaType: updatedUser.mfaType || 'none',
        isTotpVerified: updatedUser.isTotpVerified,
        isEmailOtpEnabled: updatedUser.isEmailOtpEnabled,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update password
// @route   PUT /api/v1/auth/password
// @access  Private
const updatePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Please provide both current and new password',
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'New password must be at least 6 characters long',
      });
    }

    const user = await User.findById(req.user.id).select('+password');

    const isMatch = await user.matchPassword(currentPassword);
    if (!isMatch) {
      return res.status(400).json({
        success: false,
        message: 'Current password is incorrect',
      });
    }

    user.password = newPassword;
    await user.save();

    await logActivity(req.user.id, 'PASSWORD_CHANGE', 'User changed their password');

    const token = generateToken(user._id);

    res.status(200).json({
      success: true,
      message: 'Password updated successfully',
      data: { token },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Forgot password (dispatches reset password link via email)
// @route   POST /api/v1/auth/forgot-password
// @access  Public
const forgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, message: 'Please provide an email address' });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(200).json({
        success: true,
        message: 'If an account exists with that email, a password reset link has been dispatched.',
      });
    }

    const resetToken = user.getResetPasswordToken();
    await user.save({ validateBeforeSave: false });

    const emailResult = await sendPasswordResetEmail({
      to: user.email,
      name: user.name,
      token: resetToken,
    });

    await logActivity(user._id, 'PASSWORD_RESET_REQUEST', 'Password reset requested');

    res.status(200).json({
      success: true,
      message: emailResult.isRealDelivery
        ? 'Password reset link sent to your registered email.'
        : 'Password reset link generated! (Configure SMTP in server/.env for real email delivery)',
      resetToken,
      resetLink: emailResult.resetLink,
      isRealDelivery: emailResult.isRealDelivery,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Reset password with token
// @route   POST /api/v1/auth/reset-password/:token
// @access  Public
const resetPassword = async (req, res, next) => {
  try {
    const { password } = req.body;
    const { token } = req.params;

    if (!password || password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters long',
      });
    }

    // Get hashed token
    const resetPasswordToken = crypto
      .createHash('sha256')
      .update(token)
      .digest('hex');

    const user = await User.findOne({
      resetPasswordToken,
      resetPasswordExpire: { $gt: Date.now() },
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired password reset link',
      });
    }

    user.password = password;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpire = undefined;
    await user.save();

    await logActivity(user._id, 'PASSWORD_RESET_SUCCESS', 'Password was successfully reset');

    const jwtToken = generateToken(user._id);

    res.status(200).json({
      success: true,
      message: 'Password reset successfully. You are now logged in.',
      data: {
        token: jwtToken,
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          currency: user.currency,
          avatar: user.avatar,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete user account and all associated financial records permanently
// @route   DELETE /api/v1/auth/delete-account
// @access  Private
const deleteAccount = async (req, res, next) => {
  try {
    const { password } = req.body;

    if (!password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide your current password to authorize account deletion',
      });
    }

    const user = await User.findById(req.user.id).select('+password');
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const isMatch = await user.matchPassword(password);
    if (!isMatch) {
      return res.status(400).json({
        success: false,
        message: 'Incorrect password. Account deletion aborted.',
      });
    }

    const userId = req.user.id;
    const userEmail = user.email;

    // 1. Delete all transactions
    await Transaction.deleteMany({ user: userId });

    // 2. Delete all budgets
    await Budget.deleteMany({ user: userId });

    // 3. Delete all goals
    await Goal.deleteMany({ user: userId });

    // 4. Delete all recurring schedules
    await Recurring.deleteMany({ user: userId });

    // 5. Delete custom categories
    await Category.deleteMany({ user: userId });

    // 6. Delete all activity logs
    await ActivityLog.deleteMany({ user: userId });

    // 7. Delete household invitations
    await Invitation.deleteMany({
      $or: [{ invitedBy: userId }, { email: userEmail }],
    });

    // 8. Handle household membership / ownership
    const household = await Household.findOne({ 'members.user': userId });
    if (household) {
      if (household.owner.toString() === userId) {
        const remainingMembers = household.members.filter((m) => m.user.toString() !== userId);
        if (remainingMembers.length > 0) {
          // Transfer ownership to next member
          household.owner = remainingMembers[0].user;
          remainingMembers[0].role = 'owner';
          household.members = remainingMembers;
          await household.save();
        } else {
          // Delete household if sole member
          await Household.findByIdAndDelete(household._id);
        }
      } else {
        // Remove member from household
        household.members = household.members.filter((m) => m.user.toString() !== userId);
        await household.save();
      }
    }

    // 9. Permanently delete the user record
    await User.findByIdAndDelete(userId);

    res.status(200).json({
      success: true,
      message: 'Your account and all associated personal financial records have been permanently deleted.',
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update / Reconcile Net Balance (Starting balance or In-between Adjustment)
// @route   POST /api/v1/auth/balance
// @access  Private
const updateNetBalance = async (req, res, next) => {
  try {
    const { mode, startingBalance, targetBalance, paymentMethod, notes, date } = req.body;
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (mode === 'starting') {
      const numStarting = parseFloat(startingBalance);
      if (isNaN(numStarting) || numStarting < 0) {
        return res.status(400).json({
          success: false,
          message: 'Starting balance must be a non-negative number',
        });
      }
      user.startingBalance = numStarting;
      await user.save();

      await logActivity(
        req.user.id,
        'BALANCE_STARTING_SET',
        `Set opening starting balance to ${numStarting}`
      );

      return res.status(200).json({
        success: true,
        message: 'Opening starting balance updated successfully',
        data: {
          startingBalance: user.startingBalance,
        },
      });
    }

    if (mode === 'reconcile') {
      const numTarget = parseFloat(targetBalance);
      if (isNaN(numTarget)) {
        return res.status(400).json({
          success: false,
          message: 'Target balance is required and must be a valid number',
        });
      }

      // Calculate current all-time net balance
      const allTimeResult = await Transaction.aggregate([
        { $match: { user: user._id } },
        {
          $group: {
            _id: {
              type: '$type',
              isRefund: { $ifNull: ['$isRefund', false] },
            },
            total: { $sum: '$amount' },
          },
        },
      ]);

      let totalIncome = 0;
      let totalExpense = 0;
      allTimeResult.forEach((item) => {
        if (item._id.type === 'income') {
          totalIncome += item.total;
        } else if (item._id.type === 'expense') {
          if (item._id.isRefund) {
            totalExpense -= item.total;
          } else {
            totalExpense += item.total;
          }
        }
      });

      const currentBalance = (user.startingBalance || 0) + totalIncome - totalExpense;
      const difference = Math.round((numTarget - currentBalance) * 100) / 100;

      if (difference === 0) {
        return res.status(200).json({
          success: true,
          message: 'Balance is already reconciled to this exact amount. No adjustment needed.',
          data: {
            currentBalance,
            targetBalance: numTarget,
            difference: 0,
          },
        });
      }

      const isCredit = difference > 0;
      const absAmount = Math.abs(difference);
      const txType = isCredit ? 'income' : 'expense';

      let cat = await Category.findOne({
        $or: [
          { name: 'Balance Adjustment', type: txType },
          { name: isCredit ? 'Other Income' : 'Other Expense', type: txType },
        ],
      });

      if (!cat) {
        cat = await Category.findOne({ type: txType });
      }

      const txDate = date ? new Date(date) : new Date();
      const adjustmentTx = await Transaction.create({
        user: user._id,
        type: txType,
        amount: absAmount,
        category: cat ? cat._id : null,
        description: isCredit ? 'Balance Adjustment (Credit)' : 'Balance Adjustment (Debit)',
        paymentMethod: paymentMethod || 'Other',
        date: txDate,
        notes: notes ? notes.trim() : `Manual reconciliation: adjusted balance from ${currentBalance} to ${numTarget}`,
      });

      if (cat) {
        await adjustmentTx.populate('category', 'name type icon color');
      }

      await logActivity(
        user._id,
        'BALANCE_RECONCILE',
        `Reconciled balance from ${currentBalance} to ${numTarget} (${isCredit ? '+' : '-'}${absAmount})`,
        { transactionId: adjustmentTx._id, difference, targetBalance: numTarget }
      );

      return res.status(200).json({
        success: true,
        message: `Balance successfully reconciled to ${numTarget}`,
        data: {
          targetBalance: numTarget,
          previousBalance: currentBalance,
          difference,
          transaction: adjustmentTx,
        },
      });
    }

    return res.status(400).json({
      success: false,
      message: 'Invalid mode specified. Must be "starting" or "reconcile"',
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
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
};
