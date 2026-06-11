function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    if (req.accepts('html') && !req.path.startsWith('/api') && !req.path.startsWith('/auth') &&
        !req.path.startsWith('/deposits') && !req.path.startsWith('/withdrawals') &&
        !req.path.startsWith('/admin') && !req.path.startsWith('/chat')) {
      return res.redirect('/login');
    }
    return res.status(401).json({ error: 'Authentication required' });
  }
  next();
}

module.exports = { requireAuth };
