import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const { Pool } = pg;
const pool = process.env.DATABASE_URL ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }) : null;
const jwtSecret = process.env.JWT_SECRET || 'development-secret-change-me';
const brands = [
  ['Foodpanda', 'Food Delivery'], ['Gul Ahmed', 'Fashion'], ['Naheed', 'Grocery'], ['Nestle', 'Food'],
  ['Bykea', 'Ride Hailing'], ['Coca-Cola', 'Beverages'], ['Zong', 'Telecom'], ['Ufone', 'Telecom'],
  ['Infinix', 'Mobile'], ['Sapphire', 'Fashion']
];
const defaultSettings = {
  referral_reward_amount: 80,
  referral_system_enabled: true,
  minimum_withdrawal_amount: 500,
  withdrawal_system_enabled: true,
  daily_task_count: 10,
  daily_task_reward_amount: 20,
  daily_tasks_enabled: true,
  device_restriction_enabled: true,
  allow_multiple_accounts_per_device: false,
  daily_profit_enabled: true,
};

app.use(express.json({ limit: '6mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

const query = async (text, values = []) => {
  if (!pool) throw Object.assign(new Error('DATABASE_URL is not configured'), { status: 503 });
  return pool.query(text, values);
};

const parseSettingValue = (value, fallback) => {
  if (value === null || value === undefined) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

const readSetting = async (name, fallback) => {
  const result = await query('SELECT setting_value FROM app_settings WHERE setting_name = $1', [name]);
  if (!result.rows[0]) return fallback;
  return parseSettingValue(result.rows[0].setting_value, fallback);
};

const writeSetting = async (name, value, actorId = null) => {
  await query(
    'INSERT INTO app_settings(setting_name, setting_value, updated_by) VALUES($1,$2,$3) ON CONFLICT(setting_name) DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_by = EXCLUDED.updated_by, updated_at = NOW()',
    [name, JSON.stringify(value), actorId]
  );
};

const readAllSettings = async () => {
  const result = await query('SELECT setting_name, setting_value FROM app_settings ORDER BY setting_name');
  const settings = { ...defaultSettings };
  for (const row of result.rows) {
    settings[row.setting_name] = parseSettingValue(row.setting_value, settings[row.setting_name]);
  }
  return settings;
};

const safeUser = row => ({
  id: row.id,
  phone: row.phone,
  role: row.role || 'user',
  referralCode: row.referral_code,
  balance: row.balance,
  totalReviews: row.total_reviews,
  totalReferrals: row.total_referrals,
  referralEarnings: row.referral_earnings,
  name: row.name || '',
  email: row.email || '',
  status: row.status || 'active',
});

const buildUserPlanSummary = async (userId, now = new Date()) => {
  const activeOrders = await query(`
    SELECT o.*, p.name, p.investment, p.daily_return, p.duration_days, p.total_return
    FROM orders o
    JOIN plans p ON p.id = o.plan_id
    WHERE o.user_id = $1
      AND o.status = 'Approved'
      AND o.active = true
      AND p.active = true
    ORDER BY o.activated_at DESC NULLS LAST, o.created_at DESC
  `, [userId]);

  const results = [];
  for (const order of activeOrders.rows) {
    const startDate = order.activated_at ? new Date(order.activated_at) : new Date(order.created_at);
    const durationDays = Number(order.duration_days || 0);
    const totalDurationMs = durationDays * 24 * 60 * 60 * 1000;
    const elapsedDays = Math.max(0, Math.min(durationDays, Math.floor((now.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000))));
    const remainingDays = Math.max(0, durationDays - elapsedDays);
    const isStillActive = remainingDays > 0 && durationDays > 0;

    if (!isStillActive) continue;

    const earnedResult = await query(
      'SELECT COALESCE(SUM(profit_amount), 0) AS earned_amount FROM plan_daily_profits WHERE user_id = $1 AND order_id = $2',
      [userId, order.id]
    );

    const totalEarned = Number(earnedResult.rows[0]?.earned_amount || 0);
    const progressPercent = durationDays > 0 ? Math.min(100, Math.round((elapsedDays / durationDays) * 100)) : 0;

    results.push({
      order_id: order.id,
      plan_id: order.plan_id,
      name: order.name,
      investment: Number(order.investment || 0),
      daily_profit: Number(order.daily_return || 0),
      total_return: Number(order.total_return || 0),
      total_earned: totalEarned,
      duration_days: durationDays,
      days_completed: elapsedDays,
      days_remaining: remainingDays,
      progress_percent: progressPercent,
      start_date: startDate.toISOString(),
      end_date: new Date(startDate.getTime() + totalDurationMs).toISOString(),
      status: 'Active',
      is_active: true,
    });
  }

  return results;
};

const buildUserDashboardData = async userId => {
  const pendingOrder = await query(`
    SELECT o.id, o.status, o.created_at, o.active, p.name, p.investment, p.duration_days, p.daily_return
    FROM orders o
    JOIN plans p ON p.id = o.plan_id
    WHERE o.user_id = $1 AND o.status IN ('Pending', 'Processing', 'Rejected')
    ORDER BY o.created_at DESC
    LIMIT 1
  `, [userId]);

  const activePlans = await buildUserPlanSummary(userId);
  return {
    activePlans,
    pendingOrder: pendingOrder.rows[0] ? {
      id: pendingOrder.rows[0].id,
      status: pendingOrder.rows[0].status,
      created_at: pendingOrder.rows[0].created_at,
      plan_name: pendingOrder.rows[0].name,
      investment: Number(pendingOrder.rows[0].investment || 0),
      duration_days: Number(pendingOrder.rows[0].duration_days || 0),
      daily_profit: Number(pendingOrder.rows[0].daily_return || 0),
    } : null,
    hasActivePlan: activePlans.length > 0,
  };
};

const issueAuth = (res, userId) => res.cookie('vp_token', jwt.sign({ userId }, jwtSecret, { expiresIn: '7d' }), { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 604800000 });
const issueAdminAuth = (res, userId) => res.cookie('vp_admin_token', jwt.sign({ admin: true, userId }, jwtSecret, { expiresIn: '8h' }), { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 28800000 });

const auth = async (req, res, next) => {
  try {
    const token = req.cookies.vp_token;
    if (!token) return res.status(401).json({ error: 'Please log in.' });
    const payload = jwt.verify(token, jwtSecret);
    const result = await query('SELECT * FROM users WHERE id = $1 AND status = \'active\'', [payload.userId]);
    if (!result.rows[0]) return res.status(401).json({ error: 'Account not found.' });
    req.user = result.rows[0];
    next();
  } catch (error) {
    res.status(error.status || 401).json({ error: error.message === 'DATABASE_URL is not configured' ? error.message : 'Your session has expired.' });
  }
};

const adminAuth = async (req, res, next) => {
  try {
    const payload = jwt.verify(req.cookies.vp_admin_token || '', jwtSecret);
    if (!payload.admin) throw new Error('Invalid admin session');
    const result = await query('SELECT * FROM users WHERE role = \'admin\' AND ($1::integer IS NULL OR id=$1) ORDER BY id LIMIT 1', [payload.userId || null]);
    if (!result.rows[0]) throw new Error('Admin account not found');
    req.admin = result.rows[0];
    next();
  } catch (error) {
    res.status(error.status || 401).json({ error: error.message === 'DATABASE_URL is not configured' ? error.message : 'Admin login required.' });
  }
};

const createLedgerEntry = async (client, userId, amount, type, source, reference, metadata = {}) => {
  await client.query(
    'INSERT INTO ledger_transactions(user_id, amount, type, status, reference, source, metadata) VALUES($1,$2,$3,\'posted\',$4,$5,$6::jsonb)',
    [userId, amount, type, reference, source, JSON.stringify(metadata || {})]
  );
};

const rewardReferralForApprovedOrder = async (client, orderId, referredUserId) => {
  const setting = await client.query('SELECT setting_value FROM app_settings WHERE setting_name = \'referral_system_enabled\'');
  if (setting.rows[0] && setting.rows[0].setting_value === false) return false;
  const referral = await client.query('SELECT * FROM referral_rewards WHERE referred_user_id = $1 FOR UPDATE', [referredUserId]);
  if (!referral.rowCount || ['rewarded', 'credited'].includes(referral.rows[0].status)) return false;

  const reward = referral.rows[0];
  const updated = await client.query(
    'UPDATE referral_rewards SET status = \'rewarded\', qualified_order_id = $1, qualified_at = NOW(), rewarded_at = NOW() WHERE id = $2 AND status NOT IN (\'rewarded\', \'credited\') RETURNING id',
    [orderId, reward.id]
  );
  if (!updated.rowCount) return false;

  await client.query('UPDATE users SET referral_earnings = referral_earnings + $1, balance = balance + $1, updated_at = NOW() WHERE id = $2', [reward.reward_amount, reward.referrer_user_id]);
  await createLedgerEntry(client, reward.referrer_user_id, reward.reward_amount, 'credit', 'referral_reward', `referral:${reward.id}`, { referred_user_id: referredUserId, qualified_order_id: orderId, reward_amount: reward.reward_amount });
  return true;
};

const insertAuditLog = async (actorUserId, targetUserId, action, metadata = {}) => {
  await query(
    'INSERT INTO admin_audit_log(actor_user_id, target_user_id, action, metadata) VALUES($1,$2,$3,$4::jsonb)',
    [actorUserId || null, targetUserId || null, action, JSON.stringify(metadata || {})]
  );
};

const insertAuditLogWithClient = async (client, actorUserId, targetUserId, action, metadata = {}) => {
  await client.query(
    'INSERT INTO admin_audit_log(actor_user_id, target_user_id, action, metadata) VALUES($1,$2,$3,$4::jsonb)',
    [actorUserId || null, targetUserId || null, action, JSON.stringify(metadata || {})]
  );
};

const createDeviceHash = req => {
  const userAgent = String(req.headers['user-agent'] || '');
  const forwarded = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '');
  return crypto.createHash('sha256').update(`${userAgent}|${forwarded}`).digest('hex');
};

const ensureUserHasActivePlan = async userId => {
  const result = await query(`
    SELECT 1
    FROM orders o
    JOIN plans p ON p.id = o.plan_id
    WHERE o.user_id = $1 AND o.status = 'Approved' AND o.active = true AND p.active = true
    LIMIT 1
  `, [userId]);
  return result.rowCount > 0;
};

const ensureDatabaseSchema = async () => {
  if (!pool) return;
  const statements = [
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20) NOT NULL DEFAULT 'user';`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS name VARCHAR(120) NOT NULL DEFAULT '';`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS email VARCHAR(160) NOT NULL DEFAULT '';`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active';`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code VARCHAR(12);`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();`,
    `ALTER TABLE orders ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT FALSE;`,
    `ALTER TABLE orders ADD COLUMN IF NOT EXISTS activated_at TIMESTAMPTZ;`,
    `ALTER TABLE orders ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();`,
    `ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS approved_by INTEGER REFERENCES users(id);`,
    `ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;`,
    `ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS rejection_reason TEXT NOT NULL DEFAULT '';`,
    `CREATE TABLE IF NOT EXISTS app_settings (id SERIAL PRIMARY KEY, setting_name VARCHAR(120) NOT NULL UNIQUE, setting_value JSONB NOT NULL, updated_by INTEGER REFERENCES users(id), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`,
    `CREATE TABLE IF NOT EXISTS user_devices (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, device_hash VARCHAR(128) NOT NULL UNIQUE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`,
    `CREATE TABLE IF NOT EXISTS device_exceptions (id SERIAL PRIMARY KEY, device_hash VARCHAR(128) NOT NULL UNIQUE, allowed BOOLEAN NOT NULL DEFAULT FALSE, reason TEXT NOT NULL DEFAULT '', created_by INTEGER REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`,
    `CREATE TABLE IF NOT EXISTS referral_rewards (id SERIAL PRIMARY KEY, referrer_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, referred_user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE, reward_amount INTEGER NOT NULL DEFAULT 0, status VARCHAR(20) NOT NULL DEFAULT 'credited', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`,
    `ALTER TABLE referral_rewards ADD COLUMN IF NOT EXISTS qualified_order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL;`,
    `ALTER TABLE referral_rewards ADD COLUMN IF NOT EXISTS qualified_at TIMESTAMPTZ;`,
    `ALTER TABLE referral_rewards ADD COLUMN IF NOT EXISTS rewarded_at TIMESTAMPTZ;`,
    `CREATE TABLE IF NOT EXISTS ledger_transactions (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, amount INTEGER NOT NULL, type VARCHAR(20) NOT NULL, status VARCHAR(20) NOT NULL DEFAULT 'posted', reference VARCHAR(200) NOT NULL DEFAULT '', source VARCHAR(120) NOT NULL DEFAULT '', metadata JSONB NOT NULL DEFAULT '{}', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`,
    `CREATE TABLE IF NOT EXISTS plan_daily_profits (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE, plan_id INTEGER NOT NULL REFERENCES plans(id) ON DELETE CASCADE, profit_date DATE NOT NULL, profit_amount INTEGER NOT NULL DEFAULT 0, status VARCHAR(20) NOT NULL DEFAULT 'posted', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(user_id, order_id, profit_date));`,
    `CREATE TABLE IF NOT EXISTS daily_task_assignments (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, task_date DATE NOT NULL, task_key VARCHAR(120) NOT NULL, task_name VARCHAR(120) NOT NULL, category VARCHAR(80) NOT NULL DEFAULT '', reward_amount INTEGER NOT NULL DEFAULT 0, completed_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(user_id, task_date, task_key));`,
    `CREATE TABLE IF NOT EXISTS admin_audit_log (id SERIAL PRIMARY KEY, actor_user_id INTEGER REFERENCES users(id), target_user_id INTEGER REFERENCES users(id), action VARCHAR(120) NOT NULL, metadata JSONB NOT NULL DEFAULT '{}', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`,
    `CREATE INDEX IF NOT EXISTS idx_users_referred_by ON users(referred_by);`,
    `CREATE INDEX IF NOT EXISTS idx_orders_user_status_active ON orders(user_id, status, active);`,
    `CREATE INDEX IF NOT EXISTS idx_withdrawals_user_status ON withdrawals(user_id, status);`,
    `CREATE INDEX IF NOT EXISTS idx_ledger_user_created ON ledger_transactions(user_id, created_at DESC);`,
    `CREATE INDEX IF NOT EXISTS idx_daily_tasks_user_date ON daily_task_assignments(user_id, task_date, completed_at);`,
  ];

  for (const statement of statements) {
    try {
      await query(statement);
    } catch (error) {
      if (!String(error.message).includes('already exists') && !String(error.message).includes('duplicate')) {
        throw error;
      }
    }
  }

  const usersWithoutCodes = await query("SELECT id FROM users WHERE referral_code IS NULL OR referral_code = '' ORDER BY id");
  for (const user of usersWithoutCodes.rows) {
    let assigned = false;
    while (!assigned) {
      try {
        await query('UPDATE users SET referral_code = $1, updated_at = NOW() WHERE id = $2 AND (referral_code IS NULL OR referral_code = \'\')', [generateReferralCode(), user.id]);
        assigned = true;
      } catch (error) {
        if (error.code !== '23505' || !String(error.detail || '').includes('referral_code')) throw error;
      }
    }
  }
  await query('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_referral_code_unique ON users(referral_code)');
  await query('ALTER TABLE users ALTER COLUMN referral_code SET NOT NULL');
  await query('ALTER TABLE referral_rewards ALTER COLUMN status SET DEFAULT \'registered\'');

  for (const [name, value] of Object.entries(defaultSettings)) {
    await writeSetting(name, value);
  }
};

const generateReferralCode = () => crypto.randomBytes(4).toString('hex').toUpperCase();

const ensureUserDailyTasks = async userId => {
  const taskCount = Number(await readSetting('daily_task_count', 10));
  const rewardPerTask = Number(await readSetting('daily_task_reward_amount', 20));
  const existing = await query('SELECT * FROM daily_task_assignments WHERE user_id = $1 AND task_date = CURRENT_DATE ORDER BY id LIMIT $2', [userId, taskCount]);
  const tasks = existing.rows;
  const needed = Math.max(0, taskCount - tasks.length);
  if (needed > 0) {
    for (let index = tasks.length; index < taskCount; index += 1) {
      const brand = brands[index % brands.length];
      const [taskName, category] = brand;
      const taskKey = `${taskName.toLowerCase()}-${Date.now()}-${index}`;
      await query(
        'INSERT INTO daily_task_assignments(user_id, task_date, task_key, task_name, category, reward_amount) VALUES($1, CURRENT_DATE, $2, $3, $4, $5) ON CONFLICT(user_id, task_date, task_key) DO NOTHING',
        [userId, taskKey, taskName, category, rewardPerTask]
      );
    }
  }
  const refreshed = await query('SELECT * FROM daily_task_assignments WHERE user_id = $1 AND task_date = CURRENT_DATE ORDER BY id LIMIT $2', [userId, taskCount]);
  return refreshed.rows;
};

const processDailyPlanProfits = async (targetDate = new Date()) => {
  const enabled = await readSetting('daily_profit_enabled', true);
  if (!enabled) return { processed: 0, total: 0 };

  const today = new Date(targetDate);
  const dateString = today.toISOString().slice(0, 10);
  const orders = await query(`
    SELECT o.id, o.user_id, o.plan_id, o.activated_at, o.created_at, o.active, p.daily_return, p.duration_days
    FROM orders o
    JOIN plans p ON p.id = o.plan_id
    WHERE o.status = 'Approved' AND o.active = true AND p.active = true
  `);

  let processed = 0;
  let total = 0;

  for (const order of orders.rows) {
    const activatedAt = order.activated_at ? new Date(order.activated_at) : new Date(order.created_at);
    const elapsedDays = Math.max(0, Math.floor((today.getTime() - activatedAt.getTime()) / 86400000));
    if (elapsedDays >= Number(order.duration_days)) {
      await query('UPDATE orders SET active = false, status = CASE WHEN status = \'Approved\' THEN \'Completed\' ELSE status END, updated_at = NOW() WHERE id = $1', [order.id]);
      continue;
    }

    const existing = await query('SELECT id FROM plan_daily_profits WHERE user_id = $1 AND order_id = $2 AND profit_date = $3', [order.user_id, order.id, dateString]);
    if (existing.rowCount) continue;

    const profitAmount = Number(order.daily_return || 0);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const inserted = await client.query(
        'INSERT INTO plan_daily_profits(user_id, order_id, plan_id, profit_date, profit_amount, status) VALUES($1,$2,$3,$4,$5,\'posted\') ON CONFLICT(user_id, order_id, profit_date) DO NOTHING RETURNING id',
        [order.user_id, order.id, order.plan_id, dateString, profitAmount]
      );
      if (inserted.rowCount) {
        await client.query('UPDATE users SET balance = balance + $1 WHERE id = $2', [profitAmount, order.user_id]);
        await createLedgerEntry(client, order.user_id, profitAmount, 'credit', 'daily_plan_profit', `plan_profit:${order.id}:${dateString}`, { order_id: order.id, plan_id: order.plan_id, profit_date: dateString, amount: profitAmount });
        processed += 1;
        total += profitAmount;
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  return { processed, total };
};

app.get('/api/session', auth, (req, res) => res.json({ user: safeUser(req.user) }));

app.get('/api/dashboard', auth, async (req, res) => {
  const dashboard = await buildUserDashboardData(req.user.id);
  res.json({
    user: safeUser(req.user),
    activePlans: dashboard.activePlans,
    pendingOrder: dashboard.pendingOrder,
    hasActivePlan: dashboard.hasActivePlan,
  });
});

app.post('/api/register', async (req, res) => {
  const client = pool?.connect ? await pool.connect() : null;
  try {
    const { phone, password, referralCode } = req.body;
    if (!/^03\d{9}$/.test(String(phone || '')) || String(password || '').length < 7) {
      return res.status(400).json({ error: 'Enter a valid mobile number and a password of at least 7 characters.' });
    }
    const db = client || { query };
    const deviceHash = createDeviceHash(req);
    const settings = await readAllSettings();
    if (settings.device_restriction_enabled) {
      const existingDevice = await db.query('SELECT user_id FROM user_devices WHERE device_hash = $1 LIMIT 1', [deviceHash]);
      const exception = await db.query('SELECT allowed FROM device_exceptions WHERE device_hash = $1 AND allowed = true LIMIT 1', [deviceHash]);
      if (existingDevice.rows[0] && !exception.rows[0]) {
        return res.status(409).json({ error: 'This device is already registered. Only one account is allowed per device.' });
      }
    }
    if (client) await client.query('BEGIN');
    const normalizedReferralCode = String(referralCode || '').trim().toUpperCase();
    let referrer = null;
    if (normalizedReferralCode) {
      referrer = (await db.query('SELECT * FROM users WHERE referral_code = $1', [normalizedReferralCode])).rows[0] || null;
      if (!referrer) {
        if (client) await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Invalid referral code.' });
      }
      if (referrer.phone === phone) {
        if (client) await client.query('ROLLBACK');
        return res.status(400).json({ error: 'You cannot use your own referral code.' });
      }
    }

    const existing = await db.query('SELECT id FROM users WHERE phone = $1', [phone]);
    if (existing.rows[0]) {
      if (client) await client.query('ROLLBACK');
      return res.status(409).json({ error: 'This mobile number is already registered.' });
    }

    let created;
    for (;;) {
      try {
        created = await db.query(
          'INSERT INTO users(phone,password_hash,referral_code,referred_by) VALUES($1,$2,$3,$4) RETURNING *',
          [phone, await bcrypt.hash(password, 12), generateReferralCode(), referrer?.id || null]
        );
        break;
      } catch (error) {
        if (error.code !== '23505' || !String(error.detail || '').includes('referral_code')) throw error;
      }
    }

    if (deviceHash) {
      await db.query('INSERT INTO user_devices(user_id, device_hash) VALUES($1,$2) ON CONFLICT(device_hash) DO NOTHING', [created.rows[0].id, deviceHash]);
    }

    if (referrer) {
      const rewardAmount = Number(settings.referral_reward_amount || 80);
      await db.query(
        'INSERT INTO referral_rewards(referrer_user_id, referred_user_id, reward_amount, status) VALUES($1,$2,$3,\'registered\') ON CONFLICT(referred_user_id) DO NOTHING',
        [referrer.id, created.rows[0].id, rewardAmount]
      );
      await db.query('UPDATE users SET total_referrals = total_referrals + 1, updated_at = NOW() WHERE id = $1', [referrer.id]);
    }

    if (client) await client.query('COMMIT');
    issueAuth(res, created.rows[0].id);
    res.status(201).json({ user: safeUser(created.rows[0]) });
  } catch (error) {
    if (client) await client.query('ROLLBACK');
    res.status(error.status || 500).json({ error: error.message });
  } finally {
    client?.release();
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const phone = String(req.body.phone || '').trim();
    const result = await query('SELECT * FROM users WHERE phone = $1 AND status = \'active\'', [phone]);
    if (!result.rows[0] || !(await bcrypt.compare(req.body.password || '', result.rows[0].password_hash))) {
      return res.status(401).json({ error: 'The mobile number or password is incorrect.' });
    }
    await query('UPDATE users SET last_login_at = NOW(), updated_at = NOW() WHERE id = $1', [result.rows[0].id]);
    issueAuth(res, result.rows[0].id);
    res.json({ user: safeUser(result.rows[0]) });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

app.post('/api/logout', (req, res) => res.clearCookie('vp_token').json({ ok: true }));

app.post('/api/admin/login', async (req, res) => {
  try {
    const identifier = String(req.body.email || '').trim().toLowerCase();
    const configuredEmail = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
    const configuredPhone = String(process.env.ADMIN_PHONE || '').trim();
    const result = await query('SELECT * FROM users WHERE role = \'admin\' ORDER BY id');
    if (!identifier || (identifier !== configuredEmail && identifier !== configuredPhone)) {
      return res.status(401).json({ error: 'Invalid admin credentials.' });
    }
    let admin = null;
    for (const row of result.rows) {
      if (await bcrypt.compare(req.body.password || '', row.password_hash)) {
        admin = row;
        break;
      }
    }
    if (!admin) return res.status(401).json({ error: 'Invalid admin credentials.' });
    issueAdminAuth(res, admin.id);
    res.json({ ok: true });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

app.get('/api/admin/session', adminAuth, (req, res) => res.json({ authenticated: true }));
app.post('/api/admin/logout', (req, res) => res.clearCookie('vp_admin_token').json({ ok: true }));
app.post('/api/admin/password', adminAuth, async (req, res) => {
  if ((req.body.password || '').length < 7 || req.body.password !== req.body.confirmPassword) {
    return res.status(400).json({ error: 'Passwords must match and be at least 7 characters.' });
  }
  await query('UPDATE users SET password_hash = $1 WHERE id = $2', [await bcrypt.hash(req.body.password, 12), req.admin.id]);
  res.json({ ok: true });
});

app.get('/api/referrals', auth, async (req, res) => {
  const result = await query(
    'SELECT rr.id, rr.reward_amount, rr.status, rr.qualified_at, rr.created_at, u.phone AS referred_phone FROM referral_rewards rr JOIN users u ON u.id = rr.referred_user_id WHERE rr.referrer_user_id = $1 ORDER BY rr.created_at DESC',
    [req.user.id]
  );
  const summary = (await query(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status IN ('qualified','rewarded','credited'))::int AS approved, COUNT(*) FILTER (WHERE status = 'registered')::int AS pending, COALESCE(SUM(CASE WHEN status IN ('qualified','rewarded','credited') THEN reward_amount ELSE 0 END),0) AS earnings FROM referral_rewards WHERE referrer_user_id = $1`, [req.user.id])).rows[0];
  res.json({ total: Number(summary.total || 0), approved: Number(summary.approved || 0), pending: Number(summary.pending || 0), earnings: Number(summary.earnings || 0), referrals: result.rows });
});

app.get('/api/tasks', auth, async (req, res) => {
  const settings = await readAllSettings();
  if (!settings.daily_tasks_enabled) {
    return res.json({ enabled: false, tasks: [], completed: false, progress: 0, taskCount: 0, totalReward: 0 });
  }
  const tasks = await ensureUserDailyTasks(req.user.id);
  const completed = tasks.filter(task => task.completed_at).length;
  res.json({
    enabled: true,
    tasks: tasks.map(task => ({
      id: task.id,
      task_name: task.task_name,
      category: task.category,
      reward_amount: Number(task.reward_amount || 0),
      completed: Boolean(task.completed_at),
      completed_at: task.completed_at,
    })),
    completed: tasks.length > 0 && completed >= tasks.length,
    progress: completed,
    totalReward: tasks.reduce((sum, task) => sum + Number(task.reward_amount || 0), 0),
    taskCount: tasks.length,
  });
});

app.post('/api/tasks/:id/complete', auth, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const user = await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [req.user.id]);
    if (!user.rowCount) return res.status(404).json({ error: 'Account not found.' });

    const taskResult = await client.query(
      'SELECT * FROM daily_task_assignments WHERE id = $1 AND user_id = $2 AND task_date = CURRENT_DATE FOR UPDATE',
      [req.params.id, req.user.id]
    );
    if (!taskResult.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'This task is not available today.' });
    }

    const task = taskResult.rows[0];
    if (task.completed_at) {
      await client.query('COMMIT');
      return res.json({ ok: true, alreadyCompleted: true, reward: 0, completed: true });
    }

    await client.query('UPDATE daily_task_assignments SET completed_at = NOW() WHERE id = $1', [task.id]);
    const settings = await readAllSettings();
    const taskCount = Number(settings.daily_task_count || 10);
    const pending = await client.query(
      'SELECT COUNT(*) AS count FROM daily_task_assignments WHERE user_id = $1 AND task_date = CURRENT_DATE AND completed_at IS NULL',
      [req.user.id]
    );
    const completedCount = taskCount - Number(pending.rows[0].count || 0);
    let reward = 0;

    if (completedCount >= taskCount) {
      const rewardReference = `daily_task_reward:${req.user.id}:${new Date().toISOString().slice(0, 10)}`;
      const rewardExists = await client.query(
        'SELECT 1 FROM ledger_transactions WHERE user_id = $1 AND source = \'daily_task_reward\' AND reference = $2 LIMIT 1',
        [req.user.id, rewardReference]
      );
      if (!rewardExists.rowCount) {
        reward = Number(settings.daily_task_reward_amount || 0) * taskCount;
        await client.query('UPDATE users SET balance = balance + $1, total_reviews = total_reviews + $2, updated_at = NOW() WHERE id = $3', [reward, taskCount, req.user.id]);
        await createLedgerEntry(client, req.user.id, reward, 'credit', 'daily_task_reward', rewardReference, { task_count: taskCount, reward_per_task: Number(settings.daily_task_reward_amount || 0) });
      }
    }

    await client.query('COMMIT');
    res.json({ ok: true, alreadyCompleted: false, reward, completed: completedCount >= taskCount, progress: completedCount });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

app.post('/api/tasks/complete', auth, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const rewardPerTask = Number(await readSetting('daily_task_reward_amount', 20));
    const rows = await client.query('SELECT * FROM daily_task_assignments WHERE user_id = $1 AND task_date = CURRENT_DATE AND completed_at IS NULL ORDER BY id', [req.user.id]);
    if (!rows.rowCount) {
      await client.query('COMMIT');
      return res.json({ ok: true, reward: 0, completed: true });
    }
    const ids = rows.rows.map(row => row.id);
    await client.query('UPDATE daily_task_assignments SET completed_at = NOW() WHERE id = ANY($1)', [ids]);
    const totalReward = rows.rowCount * rewardPerTask;
    await client.query('UPDATE users SET balance = balance + $1, total_reviews = total_reviews + $2 WHERE id = $3', [totalReward, rows.rowCount, req.user.id]);
    await createLedgerEntry(client, req.user.id, totalReward, 'credit', 'daily_task_reward', `daily_task:${req.user.id}:${new Date().toISOString().slice(0, 10)}`, { task_count: rows.rowCount, reward_per_task: rewardPerTask });
    await client.query('COMMIT');
    res.json({ ok: true, reward: totalReward, completed: true });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

app.get('/api/withdrawals', auth, async (req, res) => {
  const withdrawals = await query('SELECT id, wallet, account_number, account_holder, amount, status, created_at FROM withdrawals WHERE user_id = $1 ORDER BY created_at DESC', [req.user.id]);
  res.json({ withdrawals: withdrawals.rows });
});

app.post('/api/withdrawals', auth, async (req, res) => {
  const { wallet, accountNumber, accountHolder, amount } = req.body;
  const settings = await readAllSettings();
  if (!settings.withdrawal_system_enabled) return res.status(403).json({ error: 'Withdrawals are currently disabled.' });
  if (!(await ensureUserHasActivePlan(req.user.id))) {
    return res.status(400).json({ error: 'You need an active plan before you can request a withdrawal.' });
  }
  const minimum = Number(settings.minimum_withdrawal_amount || 500);
  const withdrawalAmount = Number(amount || 0);
  if (!Number.isFinite(withdrawalAmount) || withdrawalAmount < minimum) {
    return res.status(400).json({ error: `Minimum withdrawal amount is PKR ${minimum}.` });
  }
  if (withdrawalAmount > Number(req.user.balance || 0)) {
    return res.status(400).json({ error: 'Your withdrawal amount exceeds your available balance.' });
  }
  if (!wallet || !accountNumber || !accountHolder) {
    return res.status(400).json({ error: 'Please provide wallet, account number and account holder name.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const pendingExists = await client.query('SELECT 1 FROM withdrawals WHERE user_id = $1 AND status IN (\'pending\',\'Processing\') LIMIT 1', [req.user.id]);
    if (pendingExists.rowCount) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'You already have a pending withdrawal request.' });
    }
    const result = await client.query(
      'INSERT INTO withdrawals(user_id,wallet,account_number,account_holder,amount,status) VALUES($1,$2,$3,$4,$5,\'pending\') RETURNING *',
      [req.user.id, wallet, accountNumber, accountHolder, withdrawalAmount]
    );
    await client.query('INSERT INTO ledger_transactions(user_id, amount, type, status, reference, source, metadata) VALUES($1,$2,\'debit\',\'pending\',$3,$4,$5::jsonb)',
      [req.user.id, withdrawalAmount, `withdrawal:${result.rows[0].id}`, 'withdrawal_request', JSON.stringify({ withdrawal_id: result.rows[0].id, amount: withdrawalAmount })]);
    await client.query('COMMIT');
    res.status(201).json({ ok: true, withdrawal: result.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

app.post('/api/profile/password', auth, async (req, res) => {
  if ((req.body.password || '').length < 7 || req.body.password !== req.body.confirmPassword) {
    return res.status(400).json({ error: 'Passwords must match and be at least 7 characters.' });
  }
  await query('UPDATE users SET password_hash = $1 WHERE id = $2', [await bcrypt.hash(req.body.password, 12), req.user.id]);
  res.json({ ok: true });
});

app.get('/api/plans', auth, async (req, res) => {
  const plans = await query('SELECT * FROM plans WHERE active = true ORDER BY investment');
  res.json({ plans: plans.rows });
});

app.get('/api/plans/:id', auth, async (req, res) => {
  const result = await query('SELECT * FROM plans WHERE id = $1 AND active = true', [req.params.id]);
  if (!result.rows[0]) return res.status(404).json({ error: 'Plan not found.' });
  const methods = await query('SELECT id, name, details FROM payment_methods WHERE enabled = true ORDER BY name');
  res.json({ plan: result.rows[0], paymentMethods: methods.rows });
});

app.post('/api/orders', auth, async (req, res) => {
  const { planId, paymentMethodId, paymentReference = '', paymentDetails = '', paymentProof = '' } = req.body;
  const plan = (await query('SELECT * FROM plans WHERE id = $1 AND active = true', [planId])).rows[0];
  const method = (await query('SELECT * FROM payment_methods WHERE id = $1 AND enabled = true', [paymentMethodId])).rows[0];
  if (!plan || !method) return res.status(400).json({ error: 'Choose an active plan and payment method.' });
  const result = await query(
    'INSERT INTO orders(user_id, plan_id, payment_method_id, investment, payment_reference, payment_details, payment_proof, status) VALUES($1,$2,$3,$4,$5,$6,$7,\'Pending\') RETURNING id',
    [req.user.id, plan.id, method.id, plan.investment, paymentReference, paymentDetails, paymentProof]
  );
  res.status(201).json({ orderId: result.rows[0].id });
});

app.get('/api/orders', auth, async (req, res) => {
  const orders = await query('SELECT o.*, p.name plan_name, pm.name payment_method FROM orders o JOIN plans p ON p.id = o.plan_id LEFT JOIN payment_methods pm ON pm.id = o.payment_method_id WHERE o.user_id = $1 ORDER BY o.created_at DESC', [req.user.id]);
  res.json({ orders: orders.rows });
});

app.get('/api/admin/plans', adminAuth, async (req, res) => {
  const rows = await query('SELECT * FROM plans ORDER BY created_at DESC');
  res.json({ plans: rows.rows });
});

app.post('/api/admin/plans', adminAuth, async (req, res) => {
  const { name, investment, dailyReturn, durationDays, totalReturn, description = '' } = req.body;
  const result = await query(
    'INSERT INTO plans(name, investment, daily_return, duration_days, total_return, description) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',
    [name, investment, dailyReturn, durationDays, totalReturn, description]
  );
  res.status(201).json({ plan: result.rows[0] });
});

app.patch('/api/admin/plans/:id', adminAuth, async (req, res) => {
  const { name, investment, dailyReturn, durationDays, totalReturn, description, active } = req.body;
  const result = await query(
    'UPDATE plans SET name = COALESCE($1, name), investment = COALESCE($2, investment), daily_return = COALESCE($3, daily_return), duration_days = COALESCE($4, duration_days), total_return = COALESCE($5, total_return), description = COALESCE($6, description), active = COALESCE($7, active) WHERE id = $8 RETURNING *',
    [name, investment, dailyReturn, durationDays, totalReturn, description, active, req.params.id]
  );
  res.json({ plan: result.rows[0] });
});

app.delete('/api/admin/plans/:id', adminAuth, async (req, res) => {
  await query('DELETE FROM plans WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

app.get('/api/admin/orders', adminAuth, async (req, res) => {
  const orders = await query('SELECT o.*, u.id user_id, u.phone, u.created_at user_created_at, u.balance user_balance, p.name plan_name, pm.name payment_method FROM orders o JOIN users u ON u.id = o.user_id JOIN plans p ON p.id = o.plan_id LEFT JOIN payment_methods pm ON pm.id = o.payment_method_id ORDER BY o.created_at DESC');
  res.json({ orders: orders.rows });
});

app.patch('/api/admin/orders/:id', adminAuth, async (req, res) => {
  const { status, adminNote } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const currentOrder = await client.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!currentOrder.rowCount) return res.status(404).json({ error: 'Order not found.' });
    const nextStatus = status || currentOrder.rows[0].status;
    const activeFlag = nextStatus === 'Approved';
    const updated = await client.query(
      'UPDATE orders SET status = $1, admin_note = COALESCE($2, admin_note), active = $3, activated_at = CASE WHEN $3 THEN COALESCE(activated_at, NOW()) ELSE activated_at END, updated_at = NOW() WHERE id = $4 RETURNING *',
      [nextStatus, adminNote, activeFlag, req.params.id]
    );
    if (nextStatus === 'Approved' && !currentOrder.rows[0].active) {
      await client.query('UPDATE orders SET active = true, activated_at = COALESCE(activated_at, NOW()) WHERE id = $1', [req.params.id]);
    }
    if (nextStatus !== 'Approved' && currentOrder.rows[0].active) {
      await client.query('UPDATE orders SET active = false WHERE id = $1', [req.params.id]);
    }
    if (nextStatus === 'Approved') await rewardReferralForApprovedOrder(client, req.params.id, currentOrder.rows[0].user_id);
    await client.query('COMMIT');
    await insertAuditLog(req.admin.id, currentOrder.rows[0].user_id, 'order_status_updated', { order_id: req.params.id, status: nextStatus, admin_note: adminNote || '' });
    res.json({ order: updated.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

app.get('/api/admin/withdrawals', adminAuth, async (req, res) => {
  const withdrawals = await query('SELECT w.*, u.phone FROM withdrawals w JOIN users u ON u.id = w.user_id ORDER BY w.created_at DESC');
  res.json({ withdrawals: withdrawals.rows });
});

app.patch('/api/admin/withdrawals/:id', adminAuth, async (req, res) => {
  const { status, rejectionReason } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const currentWithdrawal = await client.query('SELECT * FROM withdrawals WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!currentWithdrawal.rowCount) return res.status(404).json({ error: 'Withdrawal request not found.' });
    const withdrawal = currentWithdrawal.rows[0];
    const nextStatus = status || withdrawal.status;
    if (nextStatus === 'Approved' && withdrawal.status !== 'Approved') {
      const user = await client.query('SELECT * FROM users WHERE id = $1 FOR UPDATE', [withdrawal.user_id]);
      if (withdrawal.amount > Number(user.rows[0].balance || 0)) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'User does not have enough available balance to approve this withdrawal.' });
      }
      await client.query('UPDATE users SET balance = balance - $1 WHERE id = $2', [withdrawal.amount, withdrawal.user_id]);
      await createLedgerEntry(client, withdrawal.user_id, withdrawal.amount, 'debit', 'withdrawal', `withdrawal:${withdrawal.id}`, { withdrawal_id: withdrawal.id, amount: withdrawal.amount, status: 'posted' });
    }
    const updated = await client.query(
      'UPDATE withdrawals SET status = $1::varchar, approved_by = COALESCE($2, approved_by), approved_at = CASE WHEN $1::varchar = \'Approved\' THEN NOW() ELSE approved_at END, rejection_reason = COALESCE($3, rejection_reason) WHERE id = $4 RETURNING *',
      [nextStatus, req.admin.id, rejectionReason || withdrawal.rejection_reason, req.params.id]
    );
    await client.query('COMMIT');
    await insertAuditLog(req.admin.id, withdrawal.user_id, 'withdrawal_status_updated', { withdrawal_id: withdrawal.id, status: nextStatus, rejection_reason: rejectionReason || '' });
    res.json({ withdrawal: updated.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

app.get('/api/admin/payment-methods', adminAuth, async (req, res) => {
  const methods = await query('SELECT * FROM payment_methods ORDER BY name');
  res.json({ methods: methods.rows });
});

app.post('/api/admin/payment-methods', adminAuth, async (req, res) => {
  const result = await query('INSERT INTO payment_methods(name, details, enabled) VALUES($1,$2,COALESCE($3, true)) RETURNING *', [req.body.name, req.body.details || '', req.body.enabled]);
  res.status(201).json({ method: result.rows[0] });
});

app.patch('/api/admin/payment-methods/:id', adminAuth, async (req, res) => {
  const result = await query('UPDATE payment_methods SET name = COALESCE($1, name), details = COALESCE($2, details), enabled = COALESCE($3, enabled) WHERE id = $4 RETURNING *', [req.body.name, req.body.details, req.body.enabled, req.params.id]);
  res.json({ method: result.rows[0] });
});

app.delete('/api/admin/payment-methods/:id', adminAuth, async (req, res) => {
  await query('DELETE FROM payment_methods WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

app.get('/api/admin/users', adminAuth, async (req, res) => {
  const users = await query('SELECT id, phone, role, balance, total_reviews, total_referrals, referral_earnings, referred_by, created_at, status, name, email FROM users ORDER BY created_at DESC');
  res.json({ users: users.rows });
});

app.get('/api/admin/users/:id', adminAuth, async (req, res) => {
  const user = await query('SELECT * FROM users WHERE id = $1', [req.params.id]);
  if (!user.rows[0]) return res.status(404).json({ error: 'User not found.' });
  const orders = await query('SELECT o.*, p.name plan_name FROM orders o JOIN plans p ON p.id = o.plan_id WHERE o.user_id = $1 ORDER BY o.created_at DESC', [req.params.id]);
  const withdrawals = await query('SELECT * FROM withdrawals WHERE user_id = $1 ORDER BY created_at DESC', [req.params.id]);
  const tasks = await query('SELECT * FROM daily_task_assignments WHERE user_id = $1 ORDER BY task_date DESC', [req.params.id]);
  const referrals = await query('SELECT * FROM referral_rewards WHERE referrer_user_id = $1 ORDER BY created_at DESC', [req.params.id]);
  const ledger = await query('SELECT * FROM ledger_transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50', [req.params.id]);
  res.json({ user: user.rows[0], orders: orders.rows, withdrawals: withdrawals.rows, tasks, referrals, ledger });
});

app.patch('/api/admin/users/:id', adminAuth, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const body = req.body || {};
    const targetUser = await client.query('SELECT * FROM users WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!targetUser.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'User not found.' });
    }
    const user = targetUser.rows[0];
    if (user.status === 'deleted') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Deleted accounts cannot be edited.' });
    }
    if (body.status !== undefined && !['active', 'suspended'].includes(String(body.status))) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'User status must be active or suspended.' });
    }
    const previousBalance = Number(user.balance || 0);
    let nextBalance = previousBalance;
    const salaryAdjusted = Number(body.balanceAdjustment || 0);
    if (Number.isFinite(salaryAdjusted) && salaryAdjusted !== 0) {
      nextBalance += salaryAdjusted;
      if (nextBalance < 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Balance adjustment cannot make the balance negative.' });
      }
      await client.query('UPDATE users SET balance = $1, updated_at = NOW() WHERE id = $2', [nextBalance, req.params.id]);
      await createLedgerEntry(client, req.params.id, salaryAdjusted, salaryAdjusted > 0 ? 'credit' : 'debit', 'admin_adjustment', `admin_adjustment:${req.params.id}:${Date.now()}`, { previous_balance: previousBalance, new_balance: nextBalance, note: body.balanceReason || 'Admin balance adjustment', admin_id: req.admin.id });
      await insertAuditLogWithClient(client, req.admin.id, req.params.id, 'balance_adjustment', { amount: salaryAdjusted, previous_balance: previousBalance, new_balance: nextBalance, reason: body.balanceReason || '' });
    }
    if (body.name !== undefined || body.email !== undefined || body.phone !== undefined || body.status !== undefined) {
      const updates = [];
      const values = [];
      if (body.name !== undefined) { updates.push('name = $' + (values.length + 1)); values.push(String(body.name || '')); }
      if (body.email !== undefined) { updates.push('email = $' + (values.length + 1)); values.push(String(body.email || '')); }
      if (body.phone !== undefined) { updates.push('phone = $' + (values.length + 1)); values.push(String(body.phone || '')); }
      if (body.status !== undefined) { updates.push('status = $' + (values.length + 1)); values.push(String(body.status || 'active')); }
      values.push(req.params.id);
      await client.query(`UPDATE users SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${values.length} RETURNING *`, values);
    }
    if (body.password) {
      await client.query('UPDATE users SET password_hash = $1 WHERE id = $2', [await bcrypt.hash(body.password, 12), req.params.id]);
      await insertAuditLogWithClient(client, req.admin.id, req.params.id, 'password_reset', { by_admin: req.admin.id });
    }
    const refreshed = await client.query('SELECT * FROM users WHERE id = $1', [req.params.id]);
    await client.query('COMMIT');
    res.json({ user: refreshed.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

app.delete('/api/admin/users/:id', adminAuth, async (req, res) => {
  const userId = Number(req.params.id);
  if (!Number.isInteger(userId)) return res.status(400).json({ error: 'Invalid user.' });
  if (userId === req.admin.id) return res.status(400).json({ error: 'You cannot delete the signed-in admin account.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const target = await client.query('SELECT id, role, phone, name, email, status FROM users WHERE id = $1 FOR UPDATE', [userId]);
    if (!target.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'User not found.' });
    }
    if (target.rows[0].role === 'admin') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Admin accounts cannot be deleted here.' });
    }
    if (target.rows[0].status === 'deleted') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'User is already deleted.' });
    }

    await client.query('UPDATE users SET status = \'deleted\', deleted_at = NOW(), updated_at = NOW() WHERE id = $1', [userId]);
    await insertAuditLogWithClient(client, req.admin.id, userId, 'user_deleted', {
      deletion_type: 'soft',
      user_id: userId,
      phone: target.rows[0].phone,
      name: target.rows[0].name || '',
      email: target.rows[0].email || '',
    });
    await client.query('COMMIT');
    res.json({ ok: true, status: 'deleted' });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

app.get('/api/admin/settings', adminAuth, async (req, res) => {
  const settings = await readAllSettings();
  res.json({ settings });
});

app.put('/api/admin/settings', adminAuth, async (req, res) => {
  const payload = req.body || {};
  const allowedKeys = Object.keys(defaultSettings);
  const updates = [];
  for (const [key, value] of Object.entries(payload)) {
    if (!allowedKeys.includes(key)) continue;
    await writeSetting(key, value, req.admin.id);
    updates.push(key);
    await insertAuditLog(req.admin.id, null, 'settings_updated', { key, value });
  }
  const settings = await readAllSettings();
  res.json({ ok: true, updated: updates, settings });
});

app.post('/api/admin/device-exceptions', adminAuth, async (req, res) => {
  const { deviceHash, allowed, reason = '' } = req.body || {};
  if (!deviceHash) return res.status(400).json({ error: 'A device hash is required.' });
  await query(
    'INSERT INTO device_exceptions(device_hash, allowed, reason, created_by, updated_at) VALUES($1,$2,$3,$4,NOW()) ON CONFLICT(device_hash) DO UPDATE SET allowed = EXCLUDED.allowed, reason = EXCLUDED.reason, created_by = EXCLUDED.created_by, updated_at = NOW()',
    [deviceHash, Boolean(allowed), reason, req.admin.id]
  );
  await insertAuditLog(req.admin.id, null, 'device_exception_updated', { device_hash: deviceHash, allowed: Boolean(allowed), reason });
  res.json({ ok: true });
});

app.post('/api/cron/daily-profit', async (req, res) => {
  const secret = req.headers['x-vercel-cron-secret'] || req.body?.secret;
  if (process.env.VERCEL_CRON_SECRET && secret && secret !== process.env.VERCEL_CRON_SECRET) {
    return res.status(401).json({ error: 'Invalid cron secret.' });
  }
  const result = await processDailyPlanProfits(new Date());
  res.json({ ok: true, processed: result.processed, total: result.total });
});

const ensureAdmin = async () => {
  if (!pool || !process.env.ADMIN_PHONE || !process.env.ADMIN_PASSWORD) return;
  const existing = await query('SELECT id FROM users WHERE phone = $1', [process.env.ADMIN_PHONE]);
  if (existing.rows[0]) {
    await query('UPDATE users SET role = \'admin\', email = COALESCE(email, $1), name = COALESCE(name, \'Administrator\'), updated_at = NOW() WHERE id = $2', [process.env.ADMIN_EMAIL || 'admin@vercelplans.app', existing.rows[0].id]);
    return;
  }
  const code = generateReferralCode();
  await query(
    'INSERT INTO users(phone, password_hash, referral_code, role, email, name) VALUES($1,$2,$3,\'admin\',$4,$5)',
    [process.env.ADMIN_PHONE, await bcrypt.hash(process.env.ADMIN_PASSWORD, 12), code, process.env.ADMIN_EMAIL || 'admin@vercelplans.app', 'Administrator']
  );
};

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const port = process.env.PORT || 3000;
if (pool) {
  await ensureDatabaseSchema();
  await ensureAdmin();
}
if (process.env.VERCEL !== '1') app.listen(port, () => console.log(`VercelPlans running on http://localhost:${port}`));
export default app;
