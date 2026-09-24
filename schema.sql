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
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20) NOT NULL DEFAULT 'user';

CREATE TABLE IF NOT EXISTS plans (
  id SERIAL PRIMARY KEY,
  name VARCHAR(120) NOT NULL UNIQUE,
  investment INTEGER NOT NULL CHECK (investment > 0),
  daily_return INTEGER NOT NULL CHECK (daily_return >= 0),
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
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

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
