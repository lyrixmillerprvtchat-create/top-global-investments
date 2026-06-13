async function sendEmail({ to, subject, html }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.FROM_EMAIL || 'Top Global Investments <freddy@bauerdavis-systems.com>';

  if (!apiKey) {
    console.log('[EMAIL]', { to, subject, html });
    return;
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ from, to, subject, html })
    });
    if (!res.ok) {
      const err = await res.text();
      console.error('[EMAIL ERROR]', err);
    }
  } catch (e) {
    console.error('[EMAIL SEND FAILED]', e.message);
  }
}

module.exports = { sendEmail };
