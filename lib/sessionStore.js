const { Store } = require('express-session');

class SupabaseSessionStore extends Store {
  constructor(supabaseClient) {
    super();
    this.sb = supabaseClient;
  }

  async get(sid, cb) {
    try {
      const { data } = await this.sb.from('session').select('sess, expire').eq('sid', sid).maybeSingle();
      if (!data) return cb(null, null);
      if (new Date(data.expire) < new Date()) {
        await this.sb.from('session').delete().eq('sid', sid);
        return cb(null, null);
      }
      cb(null, typeof data.sess === 'string' ? JSON.parse(data.sess) : data.sess);
    } catch (e) {
      cb(e);
    }
  }

  async set(sid, sess, cb) {
    try {
      const expire = sess.cookie && sess.cookie.expires
        ? new Date(sess.cookie.expires)
        : new Date(Date.now() + 30 * 60 * 1000);
      await this.sb.from('session').upsert({ sid, sess, expire: expire.toISOString() }, { onConflict: 'sid' });
      cb(null);
    } catch (e) {
      cb(e);
    }
  }

  async destroy(sid, cb) {
    try {
      await this.sb.from('session').delete().eq('sid', sid);
      cb(null);
    } catch (e) {
      cb(e);
    }
  }

  async touch(sid, sess, cb) {
    try {
      const expire = sess.cookie && sess.cookie.expires
        ? new Date(sess.cookie.expires)
        : new Date(Date.now() + 30 * 60 * 1000);
      await this.sb.from('session').update({ expire: expire.toISOString() }).eq('sid', sid);
      cb(null);
    } catch (e) {
      cb(e);
    }
  }
}

module.exports = SupabaseSessionStore;
