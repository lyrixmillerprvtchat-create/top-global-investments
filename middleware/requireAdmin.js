function requireAdmin(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  if (!req.session.isAdmin) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

module.exports = { requireAdmin };
