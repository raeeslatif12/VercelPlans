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

app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

const query = async (text, values = []) => {
  if (!pool) throw Object.assign(new Error('DATABASE_URL is not configured'), { status: 503 });
  return pool.query(text, values);
};
const safeUser = row => ({ id: row.id, phone: row.phone, role: row.role || 'user', referralCode: row.referral_code, balance: row.balance, totalReviews: row.total_reviews, totalReferrals: row.total_referrals, referralEarnings: row.referral_earnings });
const issueAuth = (res, userId) => res.cookie('vp_token', jwt.sign({ userId }, jwtSecret, { expiresIn: '7d' }), { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 604800000 });
const auth = async (req, res, next) => {
  try {
    const token = req.cookies.vp_token;
    if (!token) return res.status(401).json({ error: 'Please log in.' });
    const payload = jwt.verify(token, jwtSecret);
    const result = await query('SELECT * FROM users WHERE id = $1', [payload.userId]);
    if (!result.rows[0]) return res.status(401).json({ error: 'Account not found.' });
    req.user = result.rows[0];
    next();
  } catch (error) { res.status(error.status || 401).json({ error: error.message === 'DATABASE_URL is not configured' ? error.message : 'Your session has expired.' }); }
};
const adminAuth = (req, res, next) => auth(req, res, () => req.user.role === 'admin' ? next() : res.status(403).json({ error: 'Admin access required.' }));

app.get('/api/session', auth, (req, res) => res.json({ user: safeUser(req.user) }));
app.post('/api/register', async (req, res) => {
  try {
    const { phone, password, referralCode } = req.body;
    if (!/^03\d{9}$/.test(phone || '') || (password || '').length < 7) return res.status(400).json({ error: 'Enter a valid mobile number and a password of at least 7 characters.' });
    const existing = await query('SELECT id FROM users WHERE phone = $1', [phone]);
    if (existing.rows[0]) return res.status(409).json({ error: 'This mobile number is already registered.' });
    const ref = referralCode ? (await query('SELECT id FROM users WHERE referral_code = $1', [referralCode.toUpperCase()])).rows[0] : null;
    const code = crypto.randomBytes(4).toString('hex').toUpperCase();
    const created = await query('INSERT INTO users(phone,password_hash,referral_code,referred_by) VALUES($1,$2,$3,$4) RETURNING *', [phone, await bcrypt.hash(password, 12), code, ref?.id || null]);
    issueAuth(res, created.rows[0].id);
    res.status(201).json({ user: safeUser(created.rows[0]) });
  } catch (error) { res.status(error.status || 500).json({ error: error.message }); }
});
app.post('/api/login', async (req, res) => {
  try {
    const result = await query('SELECT * FROM users WHERE phone = $1', [req.body.phone]);
    if (!result.rows[0] || !(await bcrypt.compare(req.body.password || '', result.rows[0].password_hash))) return res.status(401).json({ error: 'The mobile number or password is incorrect.' });
    issueAuth(res, result.rows[0].id);
    res.json({ user: safeUser(result.rows[0]) });
  } catch (error) { res.status(error.status || 500).json({ error: error.message }); }
});
app.post('/api/logout', (req, res) => res.clearCookie('vp_token').json({ ok: true }));
app.get('/api/tasks', auth, async (req, res) => {
  const done = await query('SELECT completed_at FROM daily_tasks WHERE user_id = $1 AND task_date = CURRENT_DATE', [req.user.id]);
  res.json({ brands, completed: Boolean(done.rows[0]?.completed_at), progress: done.rows[0]?.completed_at ? 10 : 0 });
});
app.post('/api/tasks/complete', auth, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const inserted = await client.query('INSERT INTO daily_tasks(user_id,completed_at) VALUES($1,NOW()) ON CONFLICT(user_id,task_date) DO NOTHING RETURNING id', [req.user.id]);
    if (inserted.rowCount) await client.query('UPDATE users SET balance=balance+350,total_reviews=total_reviews+10 WHERE id=$1', [req.user.id]);
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (error) { await client.query('ROLLBACK'); res.status(500).json({ error: error.message }); } finally { client.release(); }
});
app.get('/api/withdrawals', auth, async (req, res) => res.json({ withdrawals: (await query('SELECT id,wallet,account_number,amount,status,created_at FROM withdrawals WHERE user_id=$1 ORDER BY created_at DESC', [req.user.id])).rows }));
app.post('/api/withdrawals', auth, async (req, res) => {
  const { wallet, accountNumber, accountHolder, amount } = req.body;
  if (req.user.balance < 2500 || amount < 2500 || amount > req.user.balance) return res.status(400).json({ error: 'Minimum withdrawal is PKR 2,500.' });
  await query('INSERT INTO withdrawals(user_id,wallet,account_number,account_holder,amount) VALUES($1,$2,$3,$4,$5)', [req.user.id, wallet, accountNumber, accountHolder, amount]);
  await query('UPDATE users SET balance=balance-$1 WHERE id=$2', [amount, req.user.id]);
  res.json({ ok: true });
});
app.post('/api/profile/password', auth, async (req, res) => {
  if ((req.body.password || '').length < 7 || req.body.password !== req.body.confirmPassword) return res.status(400).json({ error: 'Passwords must match and be at least 7 characters.' });
  await query('UPDATE users SET password_hash=$1 WHERE id=$2', [await bcrypt.hash(req.body.password, 12), req.user.id]);
  res.json({ ok: true });
});
app.get('/api/plans', auth, async (req, res) => res.json({ plans: (await query('SELECT * FROM plans WHERE active=true ORDER BY investment')).rows }));
app.get('/api/plans/:id', auth, async (req, res) => {
  const result = await query('SELECT * FROM plans WHERE id=$1 AND active=true', [req.params.id]);
  if (!result.rows[0]) return res.status(404).json({ error: 'Plan not found.' });
  res.json({ plan: result.rows[0], paymentMethods: (await query('SELECT id,name,details FROM payment_methods WHERE enabled=true ORDER BY name')).rows });
});
app.post('/api/orders', auth, async (req, res) => {
  const { planId, paymentMethodId, paymentReference = '', paymentDetails = '', paymentProof = '' } = req.body;
  const plan = (await query('SELECT * FROM plans WHERE id=$1 AND active=true', [planId])).rows[0];
  const method = (await query('SELECT * FROM payment_methods WHERE id=$1 AND enabled=true', [paymentMethodId])).rows[0];
  if (!plan || !method) return res.status(400).json({ error: 'Choose an active plan and payment method.' });
  const result = await query('INSERT INTO orders(user_id,plan_id,payment_method_id,investment,payment_reference,payment_details,payment_proof) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id', [req.user.id, plan.id, method.id, plan.investment, paymentReference, paymentDetails, paymentProof]);
  res.status(201).json({ orderId: result.rows[0].id });
});
app.get('/api/orders', auth, async (req, res) => res.json({ orders: (await query('SELECT o.*,p.name plan_name,pm.name payment_method FROM orders o JOIN plans p ON p.id=o.plan_id LEFT JOIN payment_methods pm ON pm.id=o.payment_method_id WHERE o.user_id=$1 ORDER BY o.created_at DESC', [req.user.id])).rows }));
app.get('/api/admin/plans', adminAuth, async (req, res) => res.json({ plans: (await query('SELECT * FROM plans ORDER BY created_at DESC')).rows }));
app.post('/api/admin/plans', adminAuth, async (req, res) => { const { name, investment, dailyReturn, durationDays, totalReturn, description = '' } = req.body; const result = await query('INSERT INTO plans(name,investment,daily_return,duration_days,total_return,description) VALUES($1,$2,$3,$4,$5,$6) RETURNING *', [name, investment, dailyReturn, durationDays, totalReturn, description]); res.status(201).json({ plan: result.rows[0] }); });
app.patch('/api/admin/plans/:id', adminAuth, async (req, res) => { const { name, investment, dailyReturn, durationDays, totalReturn, description, active } = req.body; const result = await query('UPDATE plans SET name=COALESCE($1,name),investment=COALESCE($2,investment),daily_return=COALESCE($3,daily_return),duration_days=COALESCE($4,duration_days),total_return=COALESCE($5,total_return),description=COALESCE($6,description),active=COALESCE($7,active) WHERE id=$8 RETURNING *', [name, investment, dailyReturn, durationDays, totalReturn, description, active, req.params.id]); res.json({ plan: result.rows[0] }); });
app.delete('/api/admin/plans/:id', adminAuth, async (req, res) => { await query('DELETE FROM plans WHERE id=$1', [req.params.id]); res.json({ ok: true }); });
app.get('/api/admin/orders', adminAuth, async (req, res) => res.json({ orders: (await query('SELECT o.*,u.phone,p.name plan_name,pm.name payment_method FROM orders o JOIN users u ON u.id=o.user_id JOIN plans p ON p.id=o.plan_id LEFT JOIN payment_methods pm ON pm.id=o.payment_method_id ORDER BY o.created_at DESC')).rows }));
app.patch('/api/admin/orders/:id', adminAuth, async (req, res) => { const result = await query('UPDATE orders SET status=COALESCE($1,status),admin_note=COALESCE($2,admin_note) WHERE id=$3 RETURNING *', [req.body.status, req.body.adminNote, req.params.id]); res.json({ order: result.rows[0] }); });
app.get('/api/admin/withdrawals', adminAuth, async (req, res) => res.json({ withdrawals: (await query('SELECT w.*,u.phone FROM withdrawals w JOIN users u ON u.id=w.user_id ORDER BY w.created_at DESC')).rows }));
app.patch('/api/admin/withdrawals/:id', adminAuth, async (req, res) => { const result = await query('UPDATE withdrawals SET status=COALESCE($1,status) WHERE id=$2 RETURNING *', [req.body.status, req.params.id]); res.json({ withdrawal: result.rows[0] }); });
app.get('/api/admin/payment-methods', adminAuth, async (req, res) => res.json({ methods: (await query('SELECT * FROM payment_methods ORDER BY name')).rows }));
app.post('/api/admin/payment-methods', adminAuth, async (req, res) => { const result = await query('INSERT INTO payment_methods(name,details,enabled) VALUES($1,$2,COALESCE($3,true)) RETURNING *', [req.body.name, req.body.details || '', req.body.enabled]); res.status(201).json({ method: result.rows[0] }); });
app.patch('/api/admin/payment-methods/:id', adminAuth, async (req, res) => { const result = await query('UPDATE payment_methods SET name=COALESCE($1,name),details=COALESCE($2,details),enabled=COALESCE($3,enabled) WHERE id=$4 RETURNING *', [req.body.name, req.body.details, req.body.enabled, req.params.id]); res.json({ method: result.rows[0] }); });
app.delete('/api/admin/payment-methods/:id', adminAuth, async (req, res) => { await query('DELETE FROM payment_methods WHERE id=$1', [req.params.id]); res.json({ ok: true }); });

const ensureAdmin = async () => {
  if (!pool || !process.env.ADMIN_PHONE || !process.env.ADMIN_PASSWORD) return;
  await query('INSERT INTO users(phone,password_hash,referral_code,role) VALUES($1,$2,$3,\'admin\') ON CONFLICT(phone) DO UPDATE SET role=\'admin\'', [process.env.ADMIN_PHONE, await bcrypt.hash(process.env.ADMIN_PASSWORD, 12), `ADMIN${crypto.randomBytes(3).toString('hex').toUpperCase()}`]);
};
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const port = process.env.PORT || 3000;
ensureAdmin().catch(error => console.error('Admin bootstrap failed:', error.message));
if (process.env.VERCEL !== '1') app.listen(port, () => console.log(`VercelPlans running on http://localhost:${port}`));
export default app;
