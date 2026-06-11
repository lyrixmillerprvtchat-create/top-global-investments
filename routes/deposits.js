const router = require('express').Router();
const { supabase } = require('../lib/db');
const { sendEmail } = require('../lib/email');
const { requireAuth } = require('../middleware/requireAuth');

router.post('/', requireAuth, async (req, res) => {
  try {
    const { amount, payment_method, reference_notes } = req.body;

    if (!amount || !payment_method) {
      return res.status(400).json({ error: 'Amount and payment method are required' });
    }

    const amt = parseFloat(amount);
    if (isNaN(amt) || amt < 10 || amt > 50000) {
      return res.status(400).json({ error: 'Amount must be between $10 and $50,000' });
    }

    if (!['bank_transfer', 'crypto', 'cash'].includes(payment_method)) {
      return res.status(400).json({ error: 'Invalid payment method' });
    }

    const { data: user } = await supabase
      .from('users')
      .select('email, full_name')
      .eq('id', req.session.userId)
      .single();

    const { data: deposit, error } = await supabase
      .from('deposit_requests')
      .insert({
        user_id: req.session.userId,
        amount: amt,
        payment_method,
        reference_notes: reference_notes || null,
        status: 'pending'
      })
      .select('*')
      .single();

    if (error) {
      console.error('Deposit insert error:', error);
      return res.status(500).json({ error: 'Failed to submit deposit request' });
    }

    await sendEmail({
      to: user.email,
      subject: 'Deposit Request Received | Top Global Investments',
      html: `<div style="font-family:sans-serif;max-width:600px;margin:auto">
        <h2 style="color:#1a56db">Deposit Request Received</h2>
        <p>Dear ${user.full_name},</p>
        <p>We've received your deposit request for <strong>$${amt.toFixed(2)}</strong> via ${payment_method.replace('_', ' ')}.</p>
        <p>Your request is being reviewed and you'll be notified once processed.</p>
        <p style="color:#666;font-size:13px">Top Global Investments &bull; freddy@bauerdavis.systems.com</p>
      </div>`
    });

    res.json({ success: true, deposit });
  } catch (e) {
    console.error('Deposit exception:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('deposit_requests')
    .select('*')
    .eq('user_id', req.session.userId)
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: 'Failed to fetch deposits' });
  res.json(data);
});

module.exports = router;
