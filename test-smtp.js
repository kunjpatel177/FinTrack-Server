require('dotenv').config();
const nodemailer = require('nodemailer');

async function testSmtp() {
  console.log('====================================================');
  console.log('      FinTrack SMTP Configuration Diagnostic Tool   ');
  console.log('====================================================\n');

  const service = (process.env.SMTP_SERVICE || process.env.EMAIL_SERVICE || 'gmail').toLowerCase();
  const rawUser = process.env.SMTP_USER || process.env.EMAIL_USER || '';
  const rawPass = process.env.SMTP_PASS || process.env.EMAIL_PASS || '';
  const host = process.env.SMTP_HOST || process.env.EMAIL_HOST || 'smtp.gmail.com';
  const port = parseInt(process.env.SMTP_PORT || process.env.EMAIL_PORT, 10) || 587;

  const user = rawUser.trim();
  const pass = rawPass.trim().replace(/\s+/g, '');

  console.log('SMTP Service: ' + service);
  console.log('SMTP User:    ' + (user ? user : '(NOT SET - EMPTY)'));
  console.log('SMTP Pass:    ' + (pass ? '******** (Length: ' + pass.length + ')' : '(NOT SET - EMPTY)'));
  console.log('SMTP Host:    ' + host + ':' + port);

  if (!user || !pass) {
    console.log('\n❌ [ERROR]: SMTP_USER or SMTP_PASS is empty in server/.env!');
    console.log('\nTo deliver emails directly to your Gmail inbox:');
    console.log('1. Go to: https://myaccount.google.com/apppasswords');
    console.log('2. Create an App Password called \"FinTrack\"');
    console.log('3. Open server/.env and fill in:');
    console.log('   SMTP_SERVICE=gmail');
    console.log('   SMTP_USER=your_email@gmail.com');
    console.log('   SMTP_PASS=xxxx xxxx xxxx xxxx');
    console.log('\n====================================================\n');
    process.exit(1);
  }

  console.log('\nConnecting to mail server...');
  const transporter = nodemailer.createTransport({
    service: service === 'gmail' ? 'gmail' : undefined,
    host: service !== 'gmail' ? host : undefined,
    port: service !== 'gmail' ? port : undefined,
    auth: { user, pass },
  });

  try {
    await transporter.verify();
    console.log('✓ SMTP server connection verified successfully!');
  } catch (err) {
    console.error('\n❌ SMTP Connection Verification Failed:', err.message);
    if (err.message.includes('535') || err.message.includes('Username and Password not accepted')) {
      console.error('\n💡 HINT: For Gmail, you MUST use an App Password, not your regular Gmail account password.');
      console.error('Make sure 2-Step Verification is enabled on your Google Account, then generate an App Password.');
    }
    process.exit(1);
  }

  const recipient = process.argv[2] || user;
  console.log('\nDispatching test email to: ' + recipient + '...');

  try {
    const info = await transporter.sendMail({
      from: '\"FinTrack Security\" <' + user + '>',
      to: recipient,
      subject: 'FinTrack Live Email Delivery Test',
      html: '<h2 style=\"color: #2563eb;\">FinTrack Email Delivery Active!</h2><p>This confirms live SMTP delivery is working.</p>',
      text: 'FinTrack Email Delivery is working!',
    });

    console.log('🎉 Email sent successfully!');
    console.log('Message ID:', info.messageId);
    console.log('Check the inbox of: ' + recipient);
  } catch (err) {
    console.error('❌ Failed to dispatch test email:', err.message);
    process.exit(1);
  }
}

testSmtp();
