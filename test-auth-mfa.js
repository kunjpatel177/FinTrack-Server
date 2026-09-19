const speakeasy = require('speakeasy');
const mongoose = require('mongoose');
const User = require('./models/User');

const API = 'http://localhost:5000/api/v1';

async function req(endpoint, options = {}) {
  const url = `${API}${endpoint}`;
  const { headers, ...restOptions } = options;
  const res = await fetch(url, {
    ...restOptions,
    headers: {
      'Content-Type': 'application/json',
      ...(headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json();
  return { status: res.status, data };
}

async function runTests() {
  console.log('--- STARTING AUTH, VERIFICATION & MFA BACKEND TESTS ---');
  await mongoose.connect('mongodb://localhost:27017/fintrack');

  const testEmail = `securer_${Date.now()}@test.com`;
  const initialPassword = 'Password123!';
  const updatedPassword = 'NewSecretPassword99!';

  // 1. Registration
  console.log('\n1. Testing Registration & Verification Token Generation...');
  const regRes = await req('/auth/register', {
    method: 'POST',
    body: {
      name: 'Security Test User',
      email: testEmail,
      password: initialPassword,
      currency: 'INR',
      startingBalance: 10000,
    },
  });

  if (!regRes.data.success || !regRes.data.data.verificationToken) {
    throw new Error(`Registration failed: ${JSON.stringify(regRes.data)}`);
  }
  const verificationToken = regRes.data.data.verificationToken;
  let authToken = regRes.data.data.token;
  console.log('✓ Registered successfully. Verification Token:', verificationToken);

  // 2. Email Verification
  console.log('\n2. Testing Email Verification with Token...');
  const verifyRes = await req(`/auth/verify-email/${verificationToken}`, { method: 'POST' });
  if (!verifyRes.data.success || !verifyRes.data.data.isEmailVerified) {
    throw new Error(`Email verification failed: ${JSON.stringify(verifyRes.data)}`);
  }
  console.log('✓ Email verified successfully:', verifyRes.data.message);

  // 3. Forgot Password
  console.log('\n3. Testing Forgot Password Link Dispatch...');
  const forgotRes = await req('/auth/forgot-password', {
    method: 'POST',
    body: { email: testEmail },
  });
  if (!forgotRes.data.success || !forgotRes.data.resetToken) {
    throw new Error(`Forgot password failed: ${JSON.stringify(forgotRes.data)}`);
  }
  const resetToken = forgotRes.data.resetToken;
  console.log('✓ Reset token generated successfully:', resetToken);

  // 4. Reset Password
  console.log('\n4. Testing Reset Password with Token...');
  const resetRes = await req(`/auth/reset-password/${resetToken}`, {
    method: 'POST',
    body: { password: updatedPassword },
  });
  if (!resetRes.data.success || !resetRes.data.data.token) {
    throw new Error(`Reset password failed: ${JSON.stringify(resetRes.data)}`);
  }
  authToken = resetRes.data.data.token;
  console.log('✓ Password reset successfully! New login session acquired.');

  // 5. Login with New Password
  console.log('\n5. Testing Login with New Password (MFA initially disabled)...');
  const loginRes = await req('/auth/login', {
    method: 'POST',
    body: { email: testEmail, password: updatedPassword },
  });
  if (loginRes.data.mfaRequired || !loginRes.data.data.token) {
    throw new Error(`Initial login should not require MFA: ${JSON.stringify(loginRes.data)}`);
  }
  authToken = loginRes.data.data.token;
  console.log('✓ Standard login successful without MFA required.');

  // 6. Setup TOTP Authenticator
  console.log('\n6. Testing Authenticator App (TOTP) Setup & QR Code...');
  const totpSetupRes = await req('/auth/mfa/totp/setup', {
    method: 'POST',
    headers: { Authorization: `Bearer ${authToken}` },
  });
  if (!totpSetupRes.data.success || !totpSetupRes.data.data.secret || !totpSetupRes.data.data.qrCode) {
    throw new Error(`TOTP setup failed: ${JSON.stringify(totpSetupRes.data)}`);
  }
  const totpSecret = totpSetupRes.data.data.secret;
  console.log('✓ TOTP Secret and QR Code generated. Secret:', totpSecret);

  // Generate valid TOTP code using speakeasy
  const validTotpCode = speakeasy.totp({
    secret: totpSecret,
    encoding: 'base32',
  });

  // 7. Verify TOTP setup
  console.log('\n7. Verifying TOTP setup with code:', validTotpCode);
  const verifyTotpRes = await req('/auth/mfa/totp/verify', {
    method: 'POST',
    headers: { Authorization: `Bearer ${authToken}` },
    body: { token: validTotpCode },
  });
  if (!verifyTotpRes.data.success) {
    throw new Error(`TOTP verification failed: ${JSON.stringify(verifyTotpRes.data)}`);
  }
  console.log('✓ TOTP setup verified successfully:', verifyTotpRes.data.message);

  // 8. Test Email OTP Setup
  console.log('\n8. Testing Email OTP Setup & Delivery...');
  const sendEmailOtpRes = await req('/auth/mfa/email/send-test', {
    method: 'POST',
    headers: { Authorization: `Bearer ${authToken}` },
  });
  if (!sendEmailOtpRes.data.success || !sendEmailOtpRes.data.otp) {
    throw new Error(`Send email OTP test failed: ${JSON.stringify(sendEmailOtpRes.data)}`);
  }
  const testEmailOtp = sendEmailOtpRes.data.otp;
  console.log('✓ Email OTP test generated:', testEmailOtp);

  const verifyEmailOtpRes = await req('/auth/mfa/email/verify-test', {
    method: 'POST',
    headers: { Authorization: `Bearer ${authToken}` },
    body: { otp: testEmailOtp },
  });
  if (!verifyEmailOtpRes.data.success) {
    throw new Error(`Email OTP test verification failed: ${JSON.stringify(verifyEmailOtpRes.data)}`);
  }
  console.log('✓ Email OTP verified successfully:', verifyEmailOtpRes.data.message);

  // 9. Enable Authenticator MFA Preference
  console.log('\n9. Setting MFA Preference to "authenticator"...');
  const setMfaAuthRes = await req('/auth/mfa/preference', {
    method: 'PUT',
    headers: { Authorization: `Bearer ${authToken}` },
    body: { mfaType: 'authenticator', currentPassword: updatedPassword },
  });
  if (!setMfaAuthRes.data.success || setMfaAuthRes.data.data.mfaType !== 'authenticator') {
    throw new Error(`Failed to set MFA to authenticator: ${JSON.stringify(setMfaAuthRes.data)}`);
  }
  console.log('✓ MFA updated to authenticator.');

  // 10. Login with Authenticator MFA Challenge
  console.log('\n10. Testing Login with Authenticator Challenge...');
  const mfaLogin1 = await req('/auth/login', {
    method: 'POST',
    body: { email: testEmail, password: updatedPassword },
  });
  if (!mfaLogin1.data.mfaRequired || mfaLogin1.data.mfaType !== 'authenticator') {
    throw new Error(`Expected MFA Challenge for authenticator: ${JSON.stringify(mfaLogin1.data)}`);
  }
  const mfaToken1 = mfaLogin1.data.mfaToken;
  console.log('✓ MFA Challenge received correctly. Token generated.');

  // Test invalid TOTP code rejected
  const badAuthRes = await req('/auth/mfa/verify', {
    method: 'POST',
    body: { mfaToken: mfaToken1, totpCode: '000000' },
  });
  if (badAuthRes.status !== 400) {
    throw new Error('Expected invalid Authenticator code to be rejected');
  }
  console.log('✓ Invalid Authenticator code properly rejected.');

  // Test valid TOTP code
  const authCodeNow = speakeasy.totp({ secret: totpSecret, encoding: 'base32' });
  const completeMfa1 = await req('/auth/mfa/verify', {
    method: 'POST',
    body: {
      mfaToken: mfaToken1,
      totpCode: authCodeNow,
    },
  });
  if (!completeMfa1.data.success || !completeMfa1.data.data.token) {
    throw new Error(`Failed to complete Authenticator MFA login: ${JSON.stringify(completeMfa1.data)}`);
  }
  authToken = completeMfa1.data.data.token;
  console.log('✓ Authenticator MFA login completed successfully!');

  // 11. Test MFA Preference Password Protection
  console.log('\n11. Testing MFA Preference change rejects incorrect password...');
  const badPassRes = await req('/auth/mfa/preference', {
    method: 'PUT',
    headers: { Authorization: `Bearer ${authToken}` },
    body: { mfaType: 'email', currentPassword: 'WrongPassword123' },
  });
  if (badPassRes.status !== 400) {
    throw new Error('Expected MFA preference change with wrong password to be rejected');
  }
  console.log('✓ Security check passed: Incorrect password rejected when changing MFA.');

  // 12. Switch to "email" MFA Preference
  console.log('\n12. Setting MFA Preference to "email"...');
  await req('/auth/mfa/preference', {
    method: 'PUT',
    headers: { Authorization: `Bearer ${authToken}` },
    body: { mfaType: 'email', currentPassword: updatedPassword },
  });
  console.log('✓ MFA updated to email OTP.');

  // 13. Login with Email OTP MFA Challenge
  console.log('\n13. Testing Login with Email OTP Challenge...');
  const mfaLogin2 = await req('/auth/login', {
    method: 'POST',
    body: { email: testEmail, password: updatedPassword },
  });
  if (!mfaLogin2.data.mfaRequired || mfaLogin2.data.mfaType !== 'email') {
    throw new Error(`Expected Email OTP challenge: ${JSON.stringify(mfaLogin2.data)}`);
  }
  const mfaToken2 = mfaLogin2.data.mfaToken;

  // Test invalid email OTP rejected
  const badEmailRes = await req('/auth/mfa/verify', {
    method: 'POST',
    body: { mfaToken: mfaToken2, emailOtp: '000000' },
  });
  if (badEmailRes.status !== 400) {
    throw new Error('Expected invalid Email OTP to be rejected');
  }
  console.log('✓ Invalid Email OTP properly rejected.');

  // 14. Switch to "both" MFA Preference
  console.log('\n14. Setting MFA Preference to "both" (Authenticator + Email OTP)...');
  await req('/auth/mfa/preference', {
    method: 'PUT',
    headers: { Authorization: `Bearer ${authToken}` },
    body: { mfaType: 'both', currentPassword: updatedPassword },
  });
  console.log('✓ MFA updated to "both".');

  // 15. Login with "both" MFA Challenge
  console.log('\n15. Testing Login with Both Authenticator & Email Challenge...');
  const mfaLogin3 = await req('/auth/login', {
    method: 'POST',
    body: { email: testEmail, password: updatedPassword },
  });
  if (!mfaLogin3.data.mfaRequired || mfaLogin3.data.mfaType !== 'both') {
    throw new Error(`Expected Both MFA challenge: ${JSON.stringify(mfaLogin3.data)}`);
  }
  console.log('✓ Received dual-factor challenge for "both" mode.');

  // 16. Disabling MFA
  console.log('\n16. Disabling MFA (resetting preference to "none")...');
  const disableMfaRes = await req('/auth/mfa/preference', {
    method: 'PUT',
    headers: { Authorization: `Bearer ${authToken}` },
    body: { mfaType: 'none', currentPassword: updatedPassword },
  });
  if (!disableMfaRes.data.success || disableMfaRes.data.data.mfaType !== 'none') {
    throw new Error(`Failed to disable MFA: ${JSON.stringify(disableMfaRes.data)}`);
  }
  console.log('✓ MFA disabled successfully with password confirmation.');

  // 17. Confirm normal login works again
  console.log('\n17. Verifying normal login resumes with no challenge...');
  const normalLoginFinal = await req('/auth/login', {
    method: 'POST',
    body: { email: testEmail, password: updatedPassword },
  });
  if (normalLoginFinal.data.mfaRequired || !normalLoginFinal.data.data.token) {
    throw new Error(`Expected normal login: ${JSON.stringify(normalLoginFinal.data)}`);
  }
  authToken = normalLoginFinal.data.data.token;
  console.log('✓ Regular login resumed smoothly.');

  // 18. Testing Delete Account Functionality
  console.log('\n18. Testing Delete Account Functionality...');
  // 18a. Attempt with incorrect password
  const badDeleteRes = await req('/auth/delete-account', {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${authToken}` },
    body: { password: 'WrongPassword!' },
  });
  if (badDeleteRes.status === 200 || badDeleteRes.data.success) {
    throw new Error('Account deletion should fail with incorrect password');
  }
  console.log('✓ Rejected deletion attempt with wrong password.');

  // 18b. Attempt with correct password
  const goodDeleteRes = await req('/auth/delete-account', {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${authToken}` },
    body: { password: updatedPassword },
  });
  if (!goodDeleteRes.data.success) {
    throw new Error(`Account deletion failed: ${JSON.stringify(goodDeleteRes.data)}`);
  }
  console.log('✓ Account deleted successfully:', goodDeleteRes.data.message);

  // 18c. Confirm user is removed from database
  const deletedUser = await User.findOne({ email: testEmail });
  if (deletedUser) {
    throw new Error('User record still exists in database after deletion!');
  }
  console.log('✓ Confirmed user record erased from MongoDB.');

  // 18d. Confirm login fails now
  const loginAfterDelete = await req('/auth/login', {
    method: 'POST',
    body: { email: testEmail, password: updatedPassword },
  });
  if (loginAfterDelete.status === 200 && loginAfterDelete.data.success) {
    throw new Error('Login should not succeed after account deletion!');
  }
  console.log('✓ Login rejected for deleted user as expected.');

  await mongoose.disconnect();

  console.log('\n======================================================');
  console.log('🎉 ALL 18 END-TO-END AUTH, MFA & DELETE ACCOUNT TESTS PASSED 100%!');
  console.log('======================================================\n');
}

runTests().catch((err) => {
  console.error('\n❌ TEST FAILED:', err.message);
  process.exit(1);
});
