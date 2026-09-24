CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  phone VARCHAR(20) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  referral_code VARCHAR(12) UNIQUE NOT NULL,
  referred_by INTEGER REFERENCES users(id),
  balance INTEGER NOT NULL DEFAULT 0,
  total_reviews INTEGER NOT NULL DEFAULT 0,
  total_referrals INTEGER NOT NULL DEFAULT 0,
  referral_earnings INTEGER NOT NULL DEFAULT 0,
  role VARCHAR(20) NOT NULL DEFAULT 'user',
  name VARCHAR(120) NOT NULL DEFAULT '',
  first_name VARCHAR(80) NOT NULL DEFAULT '',
  last_name VARCHAR(80) NOT NULL DEFAULT '',
  email VARCHAR(160) NOT NULL DEFAULT '',
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  deleted_at TIMESTAMPTZ,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS daily_tasks (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_date DATE NOT NULL DEFAULT CURRENT_DATE,
  completed_at TIMESTAMPTZ,
  UNIQUE(user_id, task_date)
);

CREATE TABLE IF NOT EXISTS withdrawals (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wallet VARCHAR(30) NOT NULL,
  account_number VARCHAR(30) NOT NULL,
  account_holder VARCHAR(120) NOT NULL,
  amount INTEGER NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  approved_by INTEGER REFERENCES users(id),
  approved_at TIMESTAMPTZ,
  rejection_reason TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS plans (
  id SERIAL PRIMARY KEY,
  name VARCHAR(120) NOT NULL UNIQUE,
  investment INTEGER NOT NULL CHECK (investment > 0),
  daily_return INTEGER NOT NULL CHECK (daily_return >= 0),
  return_rate NUMERIC(8,4) NOT NULL DEFAULT 0 CHECK (return_rate >= 0),
  duration_days INTEGER NOT NULL CHECK (duration_days > 0),
  total_return INTEGER NOT NULL CHECK (total_return >= 0),
  description TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payment_methods (
  id SERIAL PRIMARY KEY,
  name VARCHAR(80) NOT NULL UNIQUE,
  details TEXT NOT NULL DEFAULT '',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id INTEGER NOT NULL REFERENCES plans(id),
  payment_method_id INTEGER REFERENCES payment_methods(id),
  investment INTEGER NOT NULL,
  payment_reference VARCHAR(160) NOT NULL DEFAULT '',
  payment_details TEXT NOT NULL DEFAULT '',
  payment_proof TEXT NOT NULL DEFAULT '',
  status VARCHAR(20) NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending','Approved','Rejected','Processing','Completed')),
  admin_note TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT FALSE,
  activated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_settings (
  id SERIAL PRIMARY KEY,
  setting_name VARCHAR(120) NOT NULL UNIQUE,
  setting_value JSONB NOT NULL,
  updated_by INTEGER REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_devices (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  device_hash VARCHAR(128) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_devices_device_user ON user_devices(device_hash, user_id);

CREATE TABLE IF NOT EXISTS device_exceptions (
  id SERIAL PRIMARY KEY,
  device_hash VARCHAR(128) NOT NULL UNIQUE,
  allowed BOOLEAN NOT NULL DEFAULT FALSE,
  additional_accounts INTEGER NOT NULL DEFAULT 1 CHECK (additional_accounts >= 0),
  reason TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS referral_rewards (
  id SERIAL PRIMARY KEY,
  referrer_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  referred_user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  reward_amount INTEGER NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'registered' CHECK (status IN ('registered','qualified','rewarded')),
  qualified_order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  qualified_at TIMESTAMPTZ,
  rewarded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ledger_transactions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,
  type VARCHAR(20) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'posted',
  reference VARCHAR(200) NOT NULL DEFAULT '',
  source VARCHAR(120) NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS plan_daily_profits (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  plan_id INTEGER NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  profit_date DATE NOT NULL,
  profit_amount INTEGER NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'posted',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, order_id, profit_date)
);

CREATE TABLE IF NOT EXISTS daily_task_assignments (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_date DATE NOT NULL,
  task_key VARCHAR(120) NOT NULL,
  task_name VARCHAR(120) NOT NULL,
  category VARCHAR(80) NOT NULL DEFAULT '',
  reward_amount INTEGER NOT NULL DEFAULT 0,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, task_date, task_key)
);

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id SERIAL PRIMARY KEY,
  actor_user_id INTEGER REFERENCES users(id),
  target_user_id INTEGER REFERENCES users(id),
  action VARCHAR(120) NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_referred_by ON users(referred_by);
CREATE INDEX IF NOT EXISTS idx_orders_user_status_active ON orders(user_id, status, active);
CREATE INDEX IF NOT EXISTS idx_withdrawals_user_status ON withdrawals(user_id, status);
CREATE INDEX IF NOT EXISTS idx_ledger_user_created ON ledger_transactions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_daily_tasks_user_date ON daily_task_assignments(user_id, task_date, completed_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ledger_user_source_reference ON ledger_transactions(user_id, source, reference);

INSERT INTO plans(name, investment, daily_return, duration_days, total_return, description)
VALUES
  ('Starter Plan', 2500, 125, 30, 3750, 'A simple first step for new members.'),
  ('Growth Plan', 5000, 300, 30, 9000, 'A balanced plan for consistent returns.'),
  ('Premium Plan', 10000, 700, 30, 21000, 'Our highest projected return tier.')
ON CONFLICT (name) DO NOTHING;

INSERT INTO payment_methods(name, details)
VALUES ('Easypaisa', 'Send payment to the account shown after selecting this method.'),
       ('JazzCash', 'Send payment to the account shown after selecting this method.')
ON CONFLICT (name) DO NOTHING;

INSERT INTO app_settings(setting_name, setting_value)
VALUES
  ('referral_reward_amount', '80'),
  ('referral_system_enabled', 'true'),
  ('minimum_withdrawal_amount', '500'),
  ('withdrawal_system_enabled', 'true'),
  ('daily_task_count', '10'),
  ('daily_task_reward_amount', '20'),
  ('daily_tasks_enabled', 'true'),
  ('device_restriction_enabled', 'true'),
  ('allow_multiple_accounts_per_device', 'false'),
  ('max_accounts_per_device', '1'),
  ('daily_profit_enabled', 'true')
ON CONFLICT (setting_name) DO NOTHING;
