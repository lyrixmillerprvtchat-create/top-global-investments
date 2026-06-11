const router = require('express').Router();
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');
const { supabase } = require('../lib/db');
const { sendEmail } = require('../lib/email');

const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: { error: 'Too many signup attempts. Try again in an hour.' }
});

router.post('/register', signupLimiter, async (req, res) => {
  try {
    const { full_name, email, phone, password, confirm_password, terms } = req.body;

    if (!full_name || !email || !password || !confirm_password) {
      return res.status(400).json({ error: 'All required fields must be filled' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    if (password !== confirm_password) {
      return res.status(400).json({ error: 'Passwords do not match' });
    }
    if (!terms) {
      return res.status(400).json({ error: 'You must accept the terms and conditions' });
    }

    const { data: existing } = await supabase
      .from('users')
      .select('id')
      .eq('email', email.toLowerCase())
      .maybeSingle();

    if (existing) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    const password_hash = await bcrypt.hash(password, 10);

    const { data: user, error } = await supabase
      .from('users')
      .insert({
        email: email.toLowerCase(),
        full_name: full_name.trim(),
        phone: phone || null,
        password_hash,
        terms_accepted: true,
        is_approved: false,
        is_banned: false
      })
      .select('id, email, full_name')
      .single();

    if (error) {
      console.error('Register error:', error);
      return res.status(500).json({ error: 'Registration failed. Please try again.' });
    }

    await sendEmail({
      to: user.email,
      subject: 'Account Created – Pending Approval | Top Global Investments',
      html: `<div style="font-family:sans-serif;max-width:600px;margin:auto">
        <h2 style="color:#1a56db">Welcome to Top Global Investments!</h2>
        <p>Dear ${user.full_name},</p>
        <p>Your account has been successfully created and is currently <strong>pending admin approval</strong>.</p>
        <p>You will receive an email once your account has been reviewed. This usually takes 1–2 business days.</p>
        <p style="color:#666;font-size:13px">Top Global Investments &bull; freddy@bauerdavis.systems.com</p>
      </div>`
    });

    res.json({ success: true, message: 'Account created. Awaiting admin approval.' });
  } catch (e) {
    console.error('Register exception:', e);
    res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password, remember_me } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const { data: user } = await supabase
      .from('users')
      .select('*')
      .eq('email', email.toLowerCase())
      .maybeSingle();

    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    if (user.is_banned) {
      return res.status(403).json({ error: 'Account suspended. Contact support.' });
    }

    if (!user.is_approved) {
      return res.status(403).json({ error: 'Account pending admin approval' });
    }

    req.session.userId = user.id;
    req.session.isAdmin = user.is_admin;
    req.session.email = user.email;
    req.session.fullName = user.full_name;

    if (remember_me === 'true' || remember_me === true) {
      req.session.cookie.maxAge = 7 * 24 * 60 * 60 * 1000;
    }

    await supabase
      .from('users')
      .update({ last_login_at: new Date().toISOString() })
      .eq('id', user.id);

    res.json({
      success: true,
      user: { id: user.id, email: user.email, full_name: user.full_name, is_admin: user.is_admin },
      redirect: user.is_admin ? '/admin-panel' : '/dashboard'
    });
  } catch (e) {
    console.error('Login exception:', e);
    res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('tgi.sid');
    res.json({ success: true });
  });
});

module.exports = router;
