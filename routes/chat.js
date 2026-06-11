const router = require('express').Router();
const { supabase } = require('../lib/db');
const { requireAuth } = require('../middleware/requireAuth');

router.get('/messages', requireAuth, async (req, res) => {
  try {
    const { userId, isAdmin } = req.session;
    let q = supabase.from('support_messages').select('*').order('created_at', { ascending: true }).limit(50);
    if (!isAdmin) {
      q = q.or(`from_user_id.eq.${userId},to_user_id.eq.${userId}`);
    } else if (req.query.user_id) {
      q = q.or(`from_user_id.eq.${req.query.user_id},to_user_id.eq.${req.query.user_id}`);
    }
    const { data, error } = await q;
    if (error) return res.status(500).json({ error: 'Failed to fetch messages' });

    await supabase.from('support_messages').update({ is_read: true })
      .eq('to_user_id', userId).eq('is_read', false);

    res.json(data);
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/messages', requireAuth, async (req, res) => {
  try {
    const { message, to_user_id } = req.body;
    if (!message || !message.trim()) return res.status(400).json({ error: 'Message cannot be empty' });

    let toId = to_user_id;
    if (!req.session.isAdmin) {
      const { data: admin } = await supabase
        .from('users').select('id').eq('is_admin', true).limit(1).maybeSingle();
      toId = admin?.id || null;
    }

    const { data, error } = await supabase
      .from('support_messages')
      .insert({
        from_user_id: req.session.userId,
        to_user_id: toId,
        message: message.trim(),
        user_page_url: req.headers.referer || null
      })
      .select('*')
      .single();

    if (error) return res.status(500).json({ error: 'Failed to send message' });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/unread-count', requireAuth, async (req, res) => {
  const { count } = await supabase
    .from('support_messages').select('*', { count: 'exact', head: true })
    .eq('to_user_id', req.session.userId).eq('is_read', false);
  res.json({ count: count || 0 });
});

router.get('/inbox', requireAuth, async (req, res) => {
  if (!req.session.isAdmin) return res.status(403).json({ error: 'Admin only' });
  const { data, error } = await supabase
    .from('support_messages')
    .select('from_user_id, users!from_user_id(full_name, email), is_read, created_at')
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: 'Failed' });

  const map = {};
  data.forEach(m => {
    if (!map[m.from_user_id]) {
      map[m.from_user_id] = { id: m.from_user_id, full_name: m.users?.full_name, email: m.users?.email, unread: 0, last_message: m.created_at };
    }
    if (!m.is_read) map[m.from_user_id].unread++;
  });
  res.json(Object.values(map).sort((a, b) => new Date(b.last_message) - new Date(a.last_message)));
});

module.exports = router;
