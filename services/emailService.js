const nodemailer = require('nodemailer');

// Initialize transporter based on environment
let transporter = null;

const isRealSmtpConfigured = () => {
  const user = process.env.SMTP_USER || process.env.EMAIL_USER;
  const pass = process.env.SMTP_PASS || process.env.EMAIL_PASS;
  return Boolean(user && pass);
};

let currentConfigKey = '';

const getTransporter = async () => {
  const service = (process.env.SMTP_SERVICE || process.env.EMAIL_SERVICE || '').toLowerCase();
  const rawUser = process.env.SMTP_USER || process.env.EMAIL_USER || '';
  const rawPass = process.env.SMTP_PASS || process.env.EMAIL_PASS || '';
  const host = process.env.SMTP_HOST || process.env.EMAIL_HOST;
  const port = parseInt(process.env.SMTP_PORT || process.env.EMAIL_PORT, 10) || 587;

  const user = rawUser.trim();
  // Strip spaces from App Passwords (Google presents passwords as "xxxx xxxx xxxx xxxx")
  const pass = rawPass.trim().replace(/\s+/g, '');

  const newConfigKey = `${user}:${pass}:${service}:${host}:${port}`;
  if (transporter && currentConfigKey === newConfigKey) {
    return transporter;
  }

  currentConfigKey = newConfigKey;

  if (user && pass) {
    if (service === 'gmail' || host === 'smtp.gmail.com') {
      transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user, pass },
      });
      console.log(`[Email Service] Configured with Gmail SMTP (${user})`);
    } else {
      transporter = nodemailer.createTransport({
        host: host || 'smtp.gmail.com',
        port,
        secure: port === 465 || process.env.SMTP_SECURE === 'true',
        auth: { user, pass },
      });
      console.log(`[Email Service] Configured with custom SMTP (${host || 'smtp.gmail.com'}:${port})`);
    }
  } else {
    // In development without configured SMTP, use Ethereal test account or local logging fallback
    try {
      const testAccount = await nodemailer.createTestAccount();
      transporter = nodemailer.createTransport({
        host: 'smtp.ethereal.email',
        port: 587,
        secure: false,
        auth: {
          user: testAccount.user,
          pass: testAccount.pass,
        },
      });
      console.log('[Email Service] Development sandbox active. Real SMTP not set in server/.env.');
    } catch (err) {
      transporter = nodemailer.createTransport({
        jsonTransport: true,
      });
      console.log('[Email Service] Falling back to JSON transport.');
    }
  }

  return transporter;
};

/**
 * Generic send email utility
 */
const sendEmail = async ({ to, subject, html, text }) => {
  const isReal = isRealSmtpConfigured();
  try {
    const mailer = await getTransporter();
    const smtpUser = process.env.SMTP_USER || process.env.EMAIL_USER;
    const fromAddress = process.env.FROM_EMAIL || (smtpUser ? `"FinTrack Security" <${smtpUser}>` : '"FinTrack Security" <security@fintrack.app>');

    const info = await mailer.sendMail({
      from: fromAddress,
      to,
      subject,
      text,
      html,
    });

    const previewUrl = nodemailer.getTestMessageUrl(info);
    if (isReal) {
      console.log(`[Email Sent to Inbox] To: ${to} | Subject: "${subject}" | MessageId: ${info.messageId}`);
    } else if (previewUrl) {
      console.log(`[Email Dispatched (Sandbox)] To: ${to} | Subject: "${subject}" | Preview: ${previewUrl}`);
    } else {
      console.log(`[Email Dispatched (Sandbox)] To: ${to} | Subject: "${subject}"`);
    }

    return {
      success: true,
      messageId: info.messageId,
      previewUrl: previewUrl || null,
      isRealDelivery: isReal,
    };
  } catch (error) {
    console.error(`[Email Service Error] Failed to send email to ${to}:`, error.message);
    return {
      success: false,
      error: error.message,
      isRealDelivery: isReal,
    };
  }
};

/**
 * Send Account / Email Verification Email
 */
const sendVerificationEmail = async ({ to, name, token }) => {
  const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173';
  const verifyLink = `${clientUrl}/verify-email/${token}`;

  const subject = 'Verify your FinTrack Account';
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 20px; color: #1e293b; }
        .container { max-width: 540px; margin: 0 auto; background: #ffffff; border-radius: 12px; padding: 36px 32px; box-shadow: 0 4px 12px rgba(0,0,0,0.05); border: 1px solid #e2e8f0; }
        .brand { font-size: 22px; font-weight: 700; color: #2563eb; margin-bottom: 24px; display: inline-block; }
        h1 { font-size: 20px; font-weight: 700; color: #0f172a; margin-top: 0; margin-bottom: 12px; }
        p { font-size: 15px; line-height: 1.6; color: #475569; margin: 12px 0; }
        .btn { display: inline-block; background-color: #2563eb; color: #ffffff !important; padding: 12px 28px; border-radius: 8px; font-weight: 600; text-decoration: none; margin: 20px 0; font-size: 15px; }
        .footer { font-size: 12px; color: #94a3b8; margin-top: 32px; border-top: 1px solid #e2e8f0; padding-top: 16px; }
        .code-box { background: #f1f5f9; padding: 12px; border-radius: 6px; font-family: monospace; font-size: 13px; word-break: break-all; color: #334155; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="brand">FinTrack</div>
        <h1>Welcome to FinTrack, ${name || 'User'}!</h1>
        <p>Thank you for creating an account with FinTrack. To activate your account and verify your email address, please click the button below:</p>
        <div style="text-align: center;">
          <a href="${verifyLink}" class="btn" target="_blank">Verify My Email</a>
        </div>
        <p>Or paste this link into your browser:</p>
        <div class="code-box">${verifyLink}</div>
        <p>This verification link is valid for <strong>24 hours</strong>. If you did not create a FinTrack account, please ignore this email.</p>
        <div class="footer">
          &copy; ${new Date().getFullYear()} FinTrack — Production-Quality Personal Finance Platform.
        </div>
      </div>
    </body>
    </html>
  `;

  const text = `Welcome to FinTrack, ${name || 'User'}!\n\nPlease verify your email by opening the following link:\n${verifyLink}\n\nThis link is valid for 24 hours.`;

  const result = await sendEmail({ to, subject, html, text });
  return { ...result, verifyLink };
};

/**
 * Send Password Reset Email
 */
const sendPasswordResetEmail = async ({ to, name, token }) => {
  const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173';
  const resetLink = `${clientUrl}/reset-password/${token}`;

  const subject = 'Reset your FinTrack Password';
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 20px; color: #1e293b; }
        .container { max-width: 540px; margin: 0 auto; background: #ffffff; border-radius: 12px; padding: 36px 32px; box-shadow: 0 4px 12px rgba(0,0,0,0.05); border: 1px solid #e2e8f0; }
        .brand { font-size: 22px; font-weight: 700; color: #2563eb; margin-bottom: 24px; display: inline-block; }
        h1 { font-size: 20px; font-weight: 700; color: #0f172a; margin-top: 0; margin-bottom: 12px; }
        p { font-size: 15px; line-height: 1.6; color: #475569; margin: 12px 0; }
        .btn { display: inline-block; background-color: #ef4444; color: #ffffff !important; padding: 12px 28px; border-radius: 8px; font-weight: 600; text-decoration: none; margin: 20px 0; font-size: 15px; }
        .footer { font-size: 12px; color: #94a3b8; margin-top: 32px; border-top: 1px solid #e2e8f0; padding-top: 16px; }
        .code-box { background: #f1f5f9; padding: 12px; border-radius: 6px; font-family: monospace; font-size: 13px; word-break: break-all; color: #334155; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="brand">FinTrack</div>
        <h1>Password Reset Request</h1>
        <p>Hello ${name || 'User'},</p>
        <p>We received a request to reset your FinTrack password. Click the button below to choose a new password:</p>
        <div style="text-align: center;">
          <a href="${resetLink}" class="btn" target="_blank">Reset Password</a>
        </div>
        <p>Or paste this link into your browser:</p>
        <div class="code-box">${resetLink}</div>
        <p>This password reset link will expire in <strong>1 hour</strong>. If you did not request a password reset, you can safely ignore this email; your password will remain unchanged.</p>
        <div class="footer">
          &copy; ${new Date().getFullYear()} FinTrack — Production-Quality Personal Finance Platform.
        </div>
      </div>
    </body>
    </html>
  `;

  const text = `Hello ${name || 'User'},\n\nWe received a request to reset your FinTrack password. Open this link to set a new password:\n${resetLink}\n\nThis link is valid for 1 hour.`;

  const result = await sendEmail({ to, subject, html, text });
  return { ...result, resetLink };
};

/**
 * Send MFA One-Time Passcode (OTP) Email
 */
const sendMfaOtpEmail = async ({ to, name, otp }) => {
  const subject = `Your FinTrack Verification Code: ${otp}`;
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 20px; color: #1e293b; }
        .container { max-width: 500px; margin: 0 auto; background: #ffffff; border-radius: 12px; padding: 36px 32px; box-shadow: 0 4px 12px rgba(0,0,0,0.05); border: 1px solid #e2e8f0; }
        .brand { font-size: 22px; font-weight: 700; color: #2563eb; margin-bottom: 24px; display: inline-block; }
        h1 { font-size: 20px; font-weight: 700; color: #0f172a; margin-top: 0; margin-bottom: 8px; }
        p { font-size: 15px; line-height: 1.6; color: #475569; margin: 12px 0; }
        .otp-box { background: #eff6ff; border: 2px dashed #3b82f6; border-radius: 8px; padding: 18px; text-align: center; margin: 24px 0; }
        .otp-code { font-size: 36px; font-weight: 800; letter-spacing: 8px; color: #1d4ed8; font-family: monospace; }
        .footer { font-size: 12px; color: #94a3b8; margin-top: 32px; border-top: 1px solid #e2e8f0; padding-top: 16px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="brand">FinTrack</div>
        <h1>Multi-Factor Verification Code</h1>
        <p>Hello ${name || 'User'},</p>
        <p>Use the following 6-digit one-time passcode (OTP) to complete your secure sign-in:</p>
        <div class="otp-box">
          <div class="otp-code">${otp}</div>
        </div>
        <p>This code is valid for <strong>10 minutes</strong>. Never share this code with anyone. FinTrack will never ask for your code over phone or chat.</p>
        <div class="footer">
          &copy; ${new Date().getFullYear()} FinTrack — Production-Quality Personal Finance Platform.
        </div>
      </div>
    </body>
    </html>
  `;

  const text = `Hello ${name || 'User'},\n\nYour FinTrack verification code is: ${otp}\n\nThis code expires in 10 minutes. Do not share it with anyone.`;

  const result = await sendEmail({ to, subject, html, text });
  return { ...result, otp };
};

module.exports = {
  isRealSmtpConfigured,
  sendEmail,
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendMfaOtpEmail,
};
