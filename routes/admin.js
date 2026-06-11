const router = require('express').Router();
const { supabase } = require('../lib/db');
const { sendEmail } = require('../lib/email');
const { requireAdmin } = require('../middleware/requireAdmin');

router.use(requireAdmin);

router.get('/stats', async (req, res) => {
  try {
    const [a, b, c, d] = await Promise.all([
      supabase.from('users').select('*', { count: 'exact', head: true }).eq('is_approved', true).eq('is_banned', false),
      supabase.from('users').select('*', { count: 'exact', head: true }).eq('is_approved', false).eq('is_banned', false),
      supabase.from('deposit_requests').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
      supabase.from('withdrawal_requests').select('*', { count: 'exact', head: true }).eq('status', 'pending')
    ]);
    res.json({ approvedUsers: a.count, pendingUsers: b.count, pendingDeposits: c.count, pendingWithdrawals: d.count });
  } catch (e) {
    res.status(500).json({ error: 'Failed to load stats' });
  }
});

router.get('/users', async (req, res) => {
  try {
    const { status } = req.query;
    let q = supabase.from('users').select('id,email,full_name,phone,balance,is_admin,is_approved,is_banned,created_at,last_login_at');
    if (status === 'pending') q = q.eq('is_approved', false).eq('is_banned', false);
    else if (status === 'approved') q = q.eq('is_approved', true).eq('is_banned', false);
    else if (status === 'banned') q = q.eq('is_banned', true);
    const { data, error } = await q.order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: 'Failed to fetch users' });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/users/:id/approve', async (req, res) => {
  try {
    const { data: user, error } = await supabase
      .from('users')
      .update({ is_approved: true, approved_by: req.session.userId, approved_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .select('email, full_name')
      .single();
    if (error) return res.status(500).json({ error: 'Failed to approve user' });
    await sendEmail({
      to: user.email,
      subject: 'Account Approved | Top Global Investments',
      html: `<div style="font-family:sans-serif;max-width:600px;margin:auto">
        <h2 style="color:#1a56db">Account Approved!</h2>
        <p>Dear ${user.full_name},</p>
        <p>Your account has been approved. You can now <a href="https://topglobalinvestments.vercel.app/login">log in</a> and start investing.</p>
        <p style="color:#666;font-size:13px">Top Global Investments</p>
      </div>`
    });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/users/:id/reject', async (req, res) => {
  try {
    const { reason } = req.body;
    const { data: user, error } = await supabase
      .from('users')
      .update({ rejection_reason: reason || 'Application rejected by admin' })
      .eq('id', req.params.id)
      .select('email, full_name')
      .single();
    if (error) return res.status(500).json({ error: 'Failed to reject user' });
    await sendEmail({
      to: user.email,
      subject: 'Account Application Update | Top Global Investments',
      html: `<div style="font-family:sans-serif;max-width:600px;margin:auto">
        <h2 style="color:#1a56db">Application Update</h2>
        <p>Dear ${user.full_name},</p>
        <p>After review, we were unable to approve your account at this time.${reason ? ` Reason: ${reason}` : ''}</p>
        <p>Please contact support if you have questions.</p>
      </div>`
    });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/users/:id/ban', async (req, res) => {
  const { error } = await supabase
    .from('users')
    .update({ is_banned: true, is_approved: false })
    .eq('id', req.params.id);
  if (error) return res.status(500).json({ error: 'Failed to ban user' });
  res.json({ success: true });
});

router.post('/users/:id/unban', async (req, res) => {
  const { error } = await supabase
    .from('users')
    .update({ is_banned: false, is_approved: true })
    .eq('id', req.params.id);
  if (error) return res.status(500).json({ error: 'Failed to unban user' });
  res.json({ success: true });
});

router.post('/users/:id/add-funds', async (req, res) => {
  try {
    const amt = parseFloat(req.body.amount);
    if (isNaN(amt) || amt <= 0) return res.status(400).json({ error: 'Invalid amount' });
    const { data: user } = await supabase.from('users').select('balance').eq('id', req.params.id).single();
    const newBalance = parseFloat(user.balance) + amt;
    await supabase.from('users').update({ balance: newBalance }).eq('id', req.params.id);
    await supabase.from('transactions').insert({
      user_id: req.params.id, amount: amt, type: 'admin_add',
      description: req.body.reason || 'Admin fund addition', admin_id: req.session.userId
    });
    res.json({ success: true, new_balance: newBalance });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/users/:id/subtract-funds', async (req, res) => {
  try {
    const amt = parseFloat(req.body.amount);
    if (isNaN(amt) || amt <= 0) return res.status(400).json({ error: 'Invalid amount' });
    const { data: user } = await supabase.from('users').select('balance').eq('id', req.params.id).single();
    const newBalance = parseFloat(user.balance) - amt;
    await supabase.from('users').update({ balance: newBalance }).eq('id', req.params.id);
    await supabase.from('transactions').insert({
      user_id: req.params.id, amount: -amt, type: 'admin_subtract',
      description: req.body.reason || 'Admin fund deduction', admin_id: req.session.userId
    });
    res.json({ success: true, new_balance: newBalance });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/deposits', async (req, res) => {
  const { status = 'pending' } = req.query;
  const { data, error } = await supabase
    .from('deposit_requests')
    .select('*, users(full_name, email)')
    .eq('status', status)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: 'Failed to fetch deposits' });
  res.json(data);
});

router.post('/deposits/:id/approve', async (req, res) => {
  try {
    const { data: dep } = await supabase
      .from('deposit_requests')
      .select('*, users(email, full_name, balance)')
      .eq('id', req.params.id).eq('status', 'pending').single();
    if (!dep) return res.status(404).json({ error: 'Not found or already processed' });

    const newBalance = parseFloat(dep.users.balance) + parseFloat(dep.amount);
    await supabase.from('deposit_requests').update({
      status: 'approved', admin_id: req.session.userId, processed_at: new Date().toISOString()
    }).eq('id', req.params.id);
    await supabase.from('users').update({ balance: newBalance }).eq('id', dep.user_id);
    await supabase.from('transactions').insert({
      user_id: dep.user_id, amount: dep.amount, type: 'deposit_approved',
      reference_id: dep.id, description: `Deposit approved via ${dep.payment_method}`, admin_id: req.session.userId
    });
    await sendEmail({
      to: dep.users.email,
      subject: 'Deposit Approved | Top Global Investments',
      html: `<div style="font-family:sans-serif;max-width:600px;margin:auto">
        <h2 style="color:#1a56db">Deposit Approved!</h2>
        <p>Dear ${dep.users.full_name},</p>
        <p>Your deposit of <strong>$${parseFloat(dep.amount).toFixed(2)}</strong> has been approved.</p>
        <p>New balance: <strong>$${newBalance.toFixed(2)}</strong></p>
      </div>`
    });
    res.json({ success: true, new_balance: newBalance });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/deposits/:id/reject', async (req, res) => {
  try {
    const { data: dep } = await supabase
      .from('deposit_requests').select('*, users(email, full_name)')
      .eq('id', req.params.id).single();
    await supabase.from('deposit_requests').update({
      status: 'rejected', admin_id: req.session.userId, processed_at: new Date().toISOString()
    }).eq('id', req.params.id);
    await sendEmail({
      to: dep.users.email,
      subject: 'Deposit Request Update | Top Global Investments',
      html: `<div style="font-family:sans-serif;max-width:600px;margin:auto">
        <p>Dear ${dep.users.full_name}, your deposit request for $${parseFloat(dep.amount).toFixed(2)} has been declined.${req.body.reason ? ` Reason: ${req.body.reason}` : ''}</p>
      </div>`
    });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/withdrawals', async (req, res) => {
  const { status = 'pending' } = req.query;
  const { data, error } = await supabase
    .from('withdrawal_requests')
    .select('*, users(full_name, email, balance)')
    .eq('status', status)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: 'Failed to fetch withdrawals' });
  res.json(data);
});

router.post('/withdrawals/:id/approve', async (req, res) => {
  try {
    const { data: wd } = await supabase
      .from('withdrawal_requests')
      .select('*, users(email, full_name, balance)')
      .eq('id', req.params.id).eq('status', 'pending').single();
    if (!wd) return res.status(404).json({ error: 'Not found or already processed' });

    const newBalance = parseFloat(wd.users.balance) - parseFloat(wd.amount);
    if (newBalance < -10000) return res.status(400).json({ error: 'Would exceed minimum balance limit' });

    await supabase.from('withdrawal_requests').update({
      status: 'approved', admin_id: req.session.userId, processed_at: new Date().toISOString()
    }).eq('id', req.params.id);
    await supabase.from('users').update({ balance: newBalance }).eq('id', wd.user_id);

    const today = new Date().toISOString().split('T')[0];
    const { data: dw } = await supabase.from('daily_withdrawals').select('id, total_withdrawn')
      .eq('user_id', wd.user_id).eq('date', today).maybeSingle();
    if (dw) {
      await supabase.from('daily_withdrawals')
        .update({ total_withdrawn: parseFloat(dw.total_withdrawn) + parseFloat(wd.amount) })
        .eq('id', dw.id);
    } else {
      await supabase.from('daily_withdrawals').insert({ user_id: wd.user_id, date: today, total_withdrawn: wd.amount });
    }

    await supabase.from('transactions').insert({
      user_id: wd.user_id, amount: -parseFloat(wd.amount), type: 'withdrawal_approved',
      reference_id: wd.id, description: `Withdrawal approved via ${wd.withdrawal_method}`, admin_id: req.session.userId
    });

    await sendEmail({
      to: wd.users.email,
      subject: 'Withdrawal Approved | Top Global Investments',
      html: `<div style="font-family:sans-serif;max-width:600px;margin:auto">
        <h2 style="color:#1a56db">Withdrawal Approved!</h2>
        <p>Dear ${wd.users.full_name},</p>
        <p>Your withdrawal of <strong>$${parseFloat(wd.amount).toFixed(2)}</strong> has been approved.</p>
        <p>New balance: <strong>$${newBalance.toFixed(2)}</strong></p>
      </div>`
    });
    res.json({ success: true, new_balance: newBalance });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/withdrawals/:id/reject', async (req, res) => {
  try {
    const { data: wd } = await supabase
      .from('withdrawal_requests').select('*, users(email, full_name)')
      .eq('id', req.params.id).single();
    await supabase.from('withdrawal_requests').update({
      status: 'rejected', admin_id: req.session.userId, processed_at: new Date().toISOString()
    }).eq('id', req.params.id);
    await sendEmail({
      to: wd.users.email,
      subject: 'Withdrawal Request Update | Top Global Investments',
      html: `<p>Dear ${wd.users.full_name}, your withdrawal request for $${parseFloat(wd.amount).toFixed(2)} has been declined.${req.body.reason ? ` Reason: ${req.body.reason}` : ''}</p>`
    });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/transactions', async (req, res) => {
  const { user_id } = req.query;
  let q = supabase.from('transactions').select('*, users!user_id(full_name, email)').order('created_at', { ascending: false }).limit(100);
  if (user_id) q = q.eq('user_id', user_id);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: 'Failed to fetch transactions' });
  res.json(data);
});

module.exports = router;
