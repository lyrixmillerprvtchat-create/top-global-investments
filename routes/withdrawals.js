const router = require('express').Router();
const { supabase } = require('../lib/db');
const { sendEmail } = require('../lib/email');
const { requireAuth } = require('../middleware/requireAuth');

router.post('/', requireAuth, async (req, res) => {
  try {
    const { amount, withdrawal_method, destination_details } = req.body;

    if (!amount || !withdrawal_method || !destination_details) {
      return res.status(400).json({ error: 'Amount, method, and destination details are required' });
    }

    const amt = parseFloat(amount);
    if (isNaN(amt) || amt < 20 || amt > 10000) {
      return res.status(400).json({ error: 'Amount must be between $20 and $10,000' });
    }

    if (!['bank', 'crypto', 'cash'].includes(withdrawal_method)) {
      return res.status(400).json({ error: 'Invalid withdrawal method' });
    }

    const { data: user } = await supabase
      .from('users')
      .select('balance, email, full_name')
      .eq('id', req.session.userId)
      .single();

    if (parseFloat(user.balance) < amt) {
      return res.status(400).json({ error: `Insufficient balance. Available: $${parseFloat(user.balance).toFixed(2)}` });
    }

    const today = new Date().toISOString().split('T')[0];
    const { data: dailyRecord } = await supabase
      .from('daily_withdrawals')
      .select('total_withdrawn')
      .eq('user_id', req.session.userId)
      .eq('date', today)
      .maybeSingle();

    const todayTotal = dailyRecord ? parseFloat(dailyRecord.total_withdrawn) : 0;
    if (todayTotal + amt > 10000) {
      return res.status(400).json({
        error: `Daily limit reached. You can withdraw up to $${(10000 - todayTotal).toFixed(2)} more today.`
      });
    }

    const { data: withdrawal, error } = await supabase
      .from('withdrawal_requests')
      .insert({
        user_id: req.session.userId,
        amount: amt,
        withdrawal_method,
        destination_details,
        status: 'pending'
      })
      .select('*')
      .single();

    if (error) {
      console.error('Withdrawal insert error:', error);
      return res.status(500).json({ error: 'Failed to submit withdrawal request' });
    }

    await sendEmail({
      to: user.email,
      subject: 'Withdrawal Request Received | Top Global Investments',
      html: `<div style="font-family:sans-serif;max-width:600px;margin:auto">
        <h2 style="color:#1a56db">Withdrawal Request Received</h2>
        <p>Dear ${user.full_name},</p>
        <p>We've received your withdrawal request for <strong>$${amt.toFixed(2)}</strong> via ${withdrawal_method}.</p>
        <p>Your request is pending review. You'll be notified once processed.</p>
        <p style="color:#666;font-size:13px">Top Global Investments &bull; freddy@bauerdavis-systems.com</p>
      </div>`
    });

    res.json({ success: true, withdrawal });
  } catch (e) {
    console.error('Withdrawal exception:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('withdrawal_requests')
    .select('*')
    .eq('user_id', req.session.userId)
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: 'Failed to fetch withdrawals' });
  res.json(data);
});

module.exports = router;
