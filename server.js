require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const bcrypt = require('bcrypt');

const authRoutes = require('./routes/auth');
const depositRoutes = require('./routes/deposits');
const withdrawalRoutes = require('./routes/withdrawals');
const adminRoutes = require('./routes/admin');
const chatRoutes = require('./routes/chat');
const { supabase } = require('./lib/db');
const SupabaseSessionStore = require('./lib/sessionStore');

const app = express();

app.set('trust proxy', 1);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  store: new SupabaseSessionStore(supabase),
  name: 'tgi.sid',
  secret: process.env.SESSION_SECRET || 'tgi-default-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    maxAge: 30 * 60 * 1000
  }
}));

app.use(express.static(path.join(__dirname, 'public')));

app.use('/auth', authRoutes);
app.use('/deposits', depositRoutes);
app.use('/withdrawals', withdrawalRoutes);
app.use('/admin', adminRoutes);
app.use('/chat', chatRoutes);

app.get('/api/ping', async (req, res) => {
  const { error } = await supabase.from('users').select('id').limit(1);
  if (error) return res.status(500).json({ ok: false, error: error.message });
  res.json({ ok: true, ts: new Date().toISOString() });
});

app.get('/api/me', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Not authenticated' });
  const { data, error } = await supabase
    .from('users')
    .select('id, email, full_name, balance, is_admin, is_approved, is_banned, created_at')
    .eq('id', req.session.userId)
    .single();
  if (error) return res.status(500).json({ error: 'Failed to load user' });
  res.json(data);
});

app.get('/api/transactions', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Not authenticated' });
  const { data, error } = await supabase
    .from('transactions')
    .select('*')
    .eq('user_id', req.session.userId)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) return res.status(500).json({ error: 'Failed to load transactions' });
  res.json(data);
});

app.get('/dashboard', (req, res) => {
  if (!req.session.userId) return res.redirect('/login');
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/admin-panel', (req, res) => {
  if (!req.session.userId || !req.session.isAdmin) return res.redirect('/login');
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/login', (req, res) => {
  if (req.session.userId) return res.redirect(req.session.isAdmin ? '/admin-panel' : '/dashboard');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/register', (req, res) => {
  if (req.session.userId) return res.redirect('/dashboard');
  res.sendFile(path.join(__dirname, 'public', 'register.html'));
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

async function seedAdmin() {
  try {
    const { data: existing } = await supabase
      .from('users').select('id').eq('email', 'admin@topglobal.com').maybeSingle();
    if (existing) return;
    const hash = await bcrypt.hash('Freddyamhome2026', 10);
    await supabase.from('users').insert({
      email: 'admin@topglobal.com',
      full_name: 'Super Admin',
      password_hash: hash,
      is_admin: true,
      is_approved: true,
      is_banned: false,
      terms_accepted: true
    });
    console.log('Admin user created: admin@topglobal.com');
  } catch (e) {
    console.error('Seed admin error:', e.message);
  }
}

const PORT = process.env.PORT || 3000;

if (require.main === module) {
  seedAdmin().then(() => {
    app.listen(PORT, () => console.log(`Top Global Investments running on http://localhost:${PORT}`));
  });
} else {
  seedAdmin();
}

module.exports = app;
