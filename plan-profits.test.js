import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { creditPlanProfit, processDailyPlanProfits } from './plan-profits.js';

const copy = value => JSON.parse(JSON.stringify(value));

const createFixture = ({ activatedAt = '2026-01-01T10:00:00.000Z', databaseNow = '2026-01-01T15:00:00.000Z', durationDays = 5, dailyReturn = 125, orders = null, existingPayouts = [], existingLedger = [], enablementHistory = [], failLedger = false } = {}) => {
  const state = {
    balance: 1000,
    orders: orders || [{ id: 11, user_id: 7, plan_id: 3, activated_at: activatedAt, created_at: activatedAt, status: 'Approved', active: true, plan_active: true, daily_return: dailyReturn, duration_days: durationDays }],
    profits: copy(existingPayouts),
    ledger: copy(existingLedger),
    notifications: [],
    audit: [],
  };
  let transactionTail = Promise.resolve();

  const query = async (sql, values = []) => {
    if (sql.includes('FROM app_settings')) return { rows: [{ setting_value: true }], rowCount: 1 };
    if (sql.includes('CURRENT_TIMESTAMP AS now')) return { rows: [{ now: new Date(databaseNow) }], rowCount: 1 };
    if (sql.includes('FROM orders o') && sql.includes('JOIN plans p')) {
      const activeOrders = state.orders.filter(order => order.status === 'Approved' && order.active && order.plan_active !== false);
      return {
        rows: activeOrders,
        rowCount: activeOrders.length,
      };
    }
    if (sql.startsWith('UPDATE orders SET active = false')) {
      const order = state.orders.find(item => item.id === values[0] && item.active);
      if (order) {
        order.active = false;
        order.status = 'Completed';
      }
      return { rows: [], rowCount: order ? 1 : 0 };
    }
    throw new Error(`Unexpected fixture query: ${sql}`);
  };

  const connect = async () => {
    let transactionState = null;
    let releaseTransaction = null;
    return {
      async query(sql, values = []) {
        if (sql === 'BEGIN') {
          const previousTransaction = transactionTail;
          transactionTail = new Promise(resolve => { releaseTransaction = resolve; });
          await previousTransaction;
          transactionState = copy(state);
          return { rows: [], rowCount: 0 };
        }
        if (sql === 'COMMIT') {
          Object.assign(state, transactionState);
          transactionState = null;
          releaseTransaction();
          return { rows: [], rowCount: 0 };
        }
        if (sql === 'ROLLBACK') {
          transactionState = null;
          releaseTransaction();
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes('FROM orders o') && sql.includes('FOR UPDATE OF o, p')) {
          const order = transactionState.orders.find(item => item.id === values[0]);
          return { rows: order ? [{ ...order, plan_active: order.plan_active !== false }] : [], rowCount: order ? 1 : 0 };
        }
        if (sql.includes('FROM plan_daily_profits') && sql.includes('FOR UPDATE')) {
          const [userId, orderId, profitDate] = values;
          const rows = transactionState.profits.filter(row => row.user_id === userId && row.order_id === orderId && row.profit_date === profitDate);
          return { rows, rowCount: rows.length };
        }
        if (sql.includes('FROM ledger_transactions') && sql.includes('FOR UPDATE')) {
          const [userId, reference, orderId, profitDate] = values;
          const rows = transactionState.ledger.filter(row => row.user_id === userId && row.source === 'daily_plan_profit' && (
            row.reference === reference || (String(row.metadata?.order_id) === orderId && row.metadata?.profit_date === profitDate)
          ));
          return { rows, rowCount: rows.length };
        }
        if (sql.startsWith('INSERT INTO plan_daily_profits')) {
          const [userId, orderId, planId, profitDate, profitAmount] = values;
          const exists = transactionState.profits.some(row => row.user_id === userId && row.order_id === orderId && row.profit_date === profitDate);
          if (exists) return { rows: [], rowCount: 0 };
          transactionState.profits.push({ user_id: userId, order_id: orderId, plan_id: planId, profit_date: profitDate, profit_amount: profitAmount, status: 'posted' });
          return { rows: [{ id: transactionState.profits.length }], rowCount: 1 };
        }
        if (sql.startsWith('UPDATE users SET balance = balance +')) {
          transactionState.balance += values[0];
          return { rows: [], rowCount: 1 };
        }
        if (sql.startsWith('INSERT INTO ledger_transactions')) {
          if (failLedger) throw new Error('ledger insert failed');
          transactionState.ledger.push({ user_id: values[0], amount: values[1], type: values[2], reference: values[3], source: values[4], status: 'posted', metadata: JSON.parse(values[5]) });
          return { rows: [], rowCount: 1 };
        }
        if (sql.startsWith('INSERT INTO user_notifications')) {
          transactionState.notifications.push({ user_id: values[0], source: values[5], reference: values[6] });
          return { rows: [], rowCount: 1 };
        }
        if (sql.startsWith('INSERT INTO admin_audit_log')) {
          transactionState.audit.push({ target_user_id: values[1], action: values[2], metadata: JSON.parse(values[3]) });
          return { rows: [], rowCount: 1 };
        }
        throw new Error(`Unexpected transaction query: ${sql}`);
      },
      release() {},
    };
  };

  const payoutDependencies = {
    query,
    connect,
    readSetting: async () => true,
    readEnablementHistory: async () => enablementHistory,
    creditProfit: (client, order, date, catchUp) => creditPlanProfit(client, order, date, {
      createLedgerEntry: async (db, userId, amount, type, source, reference, metadata) => {
        await db.query('INSERT INTO ledger_transactions', [userId, amount, type, reference, source, JSON.stringify(metadata)]);
      },
      createUserNotification: async (db, userId, notification) => {
        await db.query('INSERT INTO user_notifications', [userId, notification.title, notification.message, notification.amount, notification.reason, notification.source, notification.reference, '{}']);
      },
      createPlanProfitAudit: async (db, userId, action, metadata) => {
        await db.query('INSERT INTO admin_audit_log', [null, userId, action, JSON.stringify(metadata)]);
      },
    }, null, catchUp),
  };

  return { state, payoutDependencies };
};

test('credits one eligible day and keeps balance, payout, ledger, and day count consistent', async () => {
  const { state, payoutDependencies } = createFixture();
  const result = await processDailyPlanProfits(payoutDependencies);

  assert.equal(result.processed, 1);
  assert.equal(result.total, 125);
  assert.deepEqual(result.needsReview, []);
  assert.equal(state.balance, 1125);
  assert.equal(state.profits.length, 1);
  assert.equal(state.profits[0].profit_date, '2026-01-01');
  assert.equal(state.ledger.length, 1);
  assert.equal(state.notifications.length, 1);
  assert.equal(state.profits.length, state.ledger.length);
});

test('forged caller timestamps cannot move payout eligibility away from the database clock', async () => {
  const { state, payoutDependencies } = createFixture({ databaseNow: '2026-01-01T15:00:00.000Z' });

  await processDailyPlanProfits({ ...payoutDependencies, targetDate: '2035-12-31T23:59:59.000Z' });
  await processDailyPlanProfits({ ...payoutDependencies, targetDate: '1990-01-01T00:00:00.000Z' });

  assert.equal(state.balance, 1125);
  assert.deepEqual(state.profits.map(row => row.profit_date), ['2026-01-01']);
});

test('a zero-return plan still records its eligible completed day exactly once', async () => {
  const { state, payoutDependencies } = createFixture({ dailyReturn: 0 });
  const result = await processDailyPlanProfits(payoutDependencies);

  assert.equal(result.processed, 1);
  assert.equal(result.total, 0);
  assert.equal(state.balance, 1000);
  assert.equal(state.profits.length, 1);
  assert.equal(state.ledger.length, 1);
  await processDailyPlanProfits(payoutDependencies);
  assert.equal(state.profits.length, 1);
});

test('repeated and concurrent processing cannot credit the same business date twice', async () => {
  const { state, payoutDependencies } = createFixture();

  await Promise.all([
    processDailyPlanProfits(payoutDependencies),
    processDailyPlanProfits(payoutDependencies),
  ]);
  await processDailyPlanProfits(payoutDependencies);

  assert.equal(state.balance, 1125);
  assert.equal(state.profits.length, 1);
  assert.equal(state.ledger.length, 1);
  assert.equal(state.notifications.length, 1);
});

test('a missed scheduled run catches up all elapsed Karachi dates', async () => {
  const { state, payoutDependencies } = createFixture({ activatedAt: '2026-01-01T18:00:00.000Z', databaseNow: '2026-01-04T18:00:00.000Z', durationDays: 7 });
  const result = await processDailyPlanProfits(payoutDependencies);

  assert.equal(result.processed, 4);
  assert.equal(result.total, 500);
  assert.deepEqual(state.profits.map(row => row.profit_date), ['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04']);
  assert.equal(state.balance, 1500);
  assert.equal(state.ledger.length, 4);
  assert.equal(state.audit.length, 3);
  assert.equal(state.ledger.filter(row => row.metadata.catch_up).length, 3);
});

test('catch-up excludes dates when the existing daily-profit switch was disabled', async () => {
  const enablementHistory = [
    { enabled: 'false', created_at: '2026-01-02T00:00:00.000Z' },
    { enabled: 'true', created_at: '2026-01-03T00:00:00.000Z' },
  ];
  const { state, payoutDependencies } = createFixture({ databaseNow: '2026-01-04T15:00:00.000Z', enablementHistory });
  const result = await processDailyPlanProfits(payoutDependencies);

  assert.equal(result.processed, 3);
  assert.deepEqual(state.profits.map(row => row.profit_date), ['2026-01-01', '2026-01-03', '2026-01-04']);
  assert.equal(state.balance, 1375);
});

test('expiry credits only the plan duration and marks the order completed', async () => {
  const { state, payoutDependencies } = createFixture({ databaseNow: '2026-01-05T15:00:00.000Z', durationDays: 2 });
  const result = await processDailyPlanProfits(payoutDependencies);

  assert.equal(result.processed, 2);
  assert.equal(result.total, 250);
  assert.deepEqual(state.profits.map(row => row.profit_date), ['2026-01-01', '2026-01-02']);
  assert.equal(state.balance, 1250);
  assert.equal(state.orders[0].active, false);
  assert.equal(state.orders[0].status, 'Completed');
});

test('multiple existing plans reconcile paid days, catch up missed days, and preserve near-expiry limits', async () => {
  const orders = [
    { id: 11, user_id: 7, plan_id: 3, activated_at: '2026-01-01T10:00:00.000Z', created_at: '2026-01-01T10:00:00.000Z', status: 'Approved', active: true, plan_active: true, daily_return: 100, duration_days: 7 },
    { id: 12, user_id: 7, plan_id: 4, activated_at: '2026-01-02T10:00:00.000Z', created_at: '2026-01-02T10:00:00.000Z', status: 'Approved', active: true, plan_active: true, daily_return: 200, duration_days: 3 },
    { id: 13, user_id: 7, plan_id: 5, activated_at: '2026-01-04T10:00:00.000Z', created_at: '2026-01-04T10:00:00.000Z', status: 'Approved', active: true, plan_active: true, daily_return: 50, duration_days: 30 },
  ];
  const existingPayouts = [
    { user_id: 7, order_id: 11, plan_id: 3, profit_date: '2026-01-01', profit_amount: 100, status: 'posted' },
    { user_id: 7, order_id: 11, plan_id: 3, profit_date: '2026-01-02', profit_amount: 100, status: 'posted' },
    { user_id: 7, order_id: 13, plan_id: 5, profit_date: '2026-01-04', profit_amount: 50, status: 'posted' },
  ];
  const existingLedger = existingPayouts.map((row, index) => ({
    id: index + 1,
    user_id: row.user_id,
    amount: row.profit_amount,
    type: 'credit',
    status: 'posted',
    source: 'daily_plan_profit',
    reference: `plan_profit:${row.order_id}:${row.profit_date}`,
    metadata: { order_id: row.order_id, plan_id: row.plan_id, profit_date: row.profit_date },
  }));
  const { state, payoutDependencies } = createFixture({ orders, existingPayouts, existingLedger, databaseNow: '2026-01-04T15:00:00.000Z' });
  state.balance = 1250;

  const result = await processDailyPlanProfits(payoutDependencies);

  assert.equal(result.plansChecked, 3);
  assert.equal(result.processed, 5);
  assert.equal(result.total, 800);
  assert.equal(result.reconciled, 0);
  assert.deepEqual(result.needsReview, []);
  assert.equal(state.profits.filter(row => row.order_id === 11).length, 4);
  assert.equal(state.profits.filter(row => row.order_id === 12).length, 3);
  assert.equal(state.profits.filter(row => row.order_id === 13).length, 1);
  assert.equal(state.orders.find(order => order.id === 12).status, 'Completed');
  assert.equal(state.orders.find(order => order.id === 13).active, true);
  assert.equal(state.balance, 2050);
  assert.equal(state.audit.length, 3);
});

test('ledger-only historical credits repair the day record without another balance credit', async () => {
  const existingLedger = [{
    id: 1,
    user_id: 7,
    amount: 125,
    type: 'credit',
    status: 'posted',
    source: 'daily_plan_profit',
    reference: 'plan_profit:11:2026-01-01',
    metadata: { order_id: 11, plan_id: 3, profit_date: '2026-01-01' },
  }];
  const { state, payoutDependencies } = createFixture({ existingLedger });

  const result = await processDailyPlanProfits(payoutDependencies);

  assert.equal(result.processed, 0);
  assert.equal(result.reconciled, 1);
  assert.deepEqual(result.needsReview, []);
  assert.equal(state.balance, 1000);
  assert.equal(state.profits.length, 1);
  assert.equal(state.ledger.length, 1);
  assert.equal(state.audit[0].action, 'plan_profit_record_reconciled');
});

test('payout records without a matching posted ledger entry are held for admin review', async () => {
  const existingPayouts = [{ user_id: 7, order_id: 11, plan_id: 3, profit_date: '2026-01-01', profit_amount: 125, status: 'posted' }];
  const { state, payoutDependencies } = createFixture({ existingPayouts });

  const result = await processDailyPlanProfits(payoutDependencies);

  assert.equal(result.processed, 0);
  assert.deepEqual(result.needsReview, [{ order_id: 11, user_id: 7, profit_date: '2026-01-01', reason: 'payout_and_ledger_records_do_not_match' }]);
  assert.equal(state.balance, 1000);
  assert.equal(state.profits.length, 1);
  assert.equal(state.ledger.length, 0);
});

test('missing original activation timestamps are reported instead of inferred from purchase dates', async () => {
  const { state, payoutDependencies } = createFixture({ activatedAt: null, databaseNow: '2026-01-04T15:00:00.000Z' });

  const result = await processDailyPlanProfits(payoutDependencies);

  assert.equal(result.processed, 0);
  assert.deepEqual(result.needsReview, [{ order_id: 11, user_id: 7, profit_date: null, reason: 'missing_original_activation_timestamp' }]);
  assert.equal(state.balance, 1000);
  assert.equal(state.profits.length, 0);
});

test('ledger failure rolls back the payout row and balance update', async () => {
  const { state, payoutDependencies } = createFixture({ failLedger: true });

  await assert.rejects(
    processDailyPlanProfits(payoutDependencies),
    /ledger insert failed/
  );
  assert.equal(state.balance, 1000);
  assert.equal(state.profits.length, 0);
  assert.equal(state.ledger.length, 0);
});

test('daily-profit cron rejects unauthenticated GET and POST requests before database access', async () => {
  const originalEnvironment = {
    JWT_SECRET: process.env.JWT_SECRET,
    VERCEL: process.env.VERCEL,
    DATABASE_URL: process.env.DATABASE_URL,
  };
  process.env.JWT_SECRET = 'A1b2C3d4E5f6G7h8J9k0LmN1P2q3R4s5T6u7V8w9X0y1Z2';
  process.env.VERCEL = '1';
  process.env.DATABASE_URL = '';

  let server;
  try {
    const { default: app } = await import('./server.js');
    server = app.listen(0);
    await new Promise(resolve => server.once('listening', resolve));
    const url = `http://127.0.0.1:${server.address().port}/api/cron/daily-profit`;
    const getResponse = await fetch(url);
    const postResponse = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profitDate: '2035-12-31', userId: 999, amount: 999999 }),
    });

    assert.equal(getResponse.status, 401);
    assert.equal(postResponse.status, 401);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    for (const [key, value] of Object.entries(originalEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('PostgreSQL payout writes are idempotent and roll back with the outer test transaction', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const client = await pool.connect();
  let outerTransactionOpen = false;
  let savepointSequence = 0;
  try {
    await client.query('BEGIN');
    outerTransactionOpen = true;
    await client.query(`
      CREATE TEMP TABLE users (id integer PRIMARY KEY, balance integer NOT NULL, updated_at timestamptz DEFAULT NOW()) ON COMMIT DROP;
      CREATE TEMP TABLE plans (id integer PRIMARY KEY, daily_return integer NOT NULL, duration_days integer NOT NULL, active boolean NOT NULL) ON COMMIT DROP;
      CREATE TEMP TABLE orders (id integer PRIMARY KEY, user_id integer NOT NULL, plan_id integer NOT NULL, activated_at timestamptz, created_at timestamptz NOT NULL, active boolean NOT NULL, status text NOT NULL) ON COMMIT DROP;
      CREATE TEMP TABLE plan_daily_profits (id serial PRIMARY KEY, user_id integer NOT NULL, order_id integer NOT NULL, plan_id integer NOT NULL, profit_date date NOT NULL, profit_amount integer NOT NULL, status text NOT NULL, UNIQUE(user_id, order_id, profit_date)) ON COMMIT DROP;
      CREATE TEMP TABLE ledger_transactions (id serial PRIMARY KEY, user_id integer NOT NULL, amount integer NOT NULL, type text NOT NULL, status text NOT NULL, reference text NOT NULL, source text NOT NULL, metadata jsonb NOT NULL, UNIQUE(user_id, source, reference)) ON COMMIT DROP;
      CREATE TEMP TABLE user_notifications (id serial PRIMARY KEY, user_id integer NOT NULL, title text NOT NULL, message text NOT NULL, amount integer NOT NULL, reason text NOT NULL, source text NOT NULL, reference text NOT NULL, metadata jsonb NOT NULL, status text NOT NULL, UNIQUE(user_id, source, reference)) ON COMMIT DROP;
      CREATE TEMP TABLE admin_audit_log (id serial PRIMARY KEY, actor_user_id integer, target_user_id integer, action text NOT NULL, metadata jsonb NOT NULL, created_at timestamptz DEFAULT NOW()) ON COMMIT DROP;
      INSERT INTO users(id, balance) VALUES(701, 1000);
      INSERT INTO plans(id, daily_return, duration_days, active) VALUES(301, 125, 10, true);
      INSERT INTO orders(id, user_id, plan_id, activated_at, created_at, active, status)
      VALUES(1101, 701, 301, CURRENT_TIMESTAMP - INTERVAL '2 days', CURRENT_TIMESTAMP - INTERVAL '2 days', true, 'Approved');
    `);

    const query = (sql, values = []) => client.query(sql, values);
    const connect = async () => {
      const savepoint = `payout_cycle_${++savepointSequence}`;
      return {
        async query(sql, values = []) {
          if (sql === 'BEGIN') return client.query(`SAVEPOINT ${savepoint}`);
          if (sql === 'COMMIT') return client.query(`RELEASE SAVEPOINT ${savepoint}`);
          if (sql === 'ROLLBACK') {
            await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
            return client.query(`RELEASE SAVEPOINT ${savepoint}`);
          }
          return client.query(sql, values);
        },
        release() {},
      };
    };
    const dependencies = {
      query,
      connect,
      readSetting: async () => true,
      readEnablementHistory: async () => [],
      creditProfit: (db, order, date, catchUp) => creditPlanProfit(db, order, date, {
        createLedgerEntry: async (transaction, userId, amount, type, source, reference, metadata) => transaction.query(
          'INSERT INTO ledger_transactions(user_id, amount, type, status, reference, source, metadata) VALUES($1,$2,$3,\'posted\',$4,$5,$6::jsonb)',
          [userId, amount, type, reference, source, JSON.stringify(metadata)]
        ),
        createUserNotification: async (transaction, userId, notification) => transaction.query(
          'INSERT INTO user_notifications(user_id,title,message,amount,reason,source,reference,metadata,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,\'unread\') ON CONFLICT(user_id,source,reference) DO NOTHING',
          [userId, notification.title, notification.message, notification.amount, notification.reason, notification.source, notification.reference, JSON.stringify(notification.metadata)]
        ),
        createPlanProfitAudit: async (transaction, userId, action, metadata) => transaction.query(
          'INSERT INTO admin_audit_log(actor_user_id,target_user_id,action,metadata) VALUES(NULL,$1,$2,$3::jsonb)',
          [userId, action, JSON.stringify(metadata)]
        ),
      }, null, catchUp),
    };

    const firstRun = await processDailyPlanProfits(dependencies);
    const balanceAfterFirst = Number((await query('SELECT balance FROM users WHERE id = 701')).rows[0].balance);
    const payoutCountAfterFirst = Number((await query('SELECT COUNT(*)::int AS count FROM plan_daily_profits WHERE order_id = 1101')).rows[0].count);
    const ledgerCountAfterFirst = Number((await query('SELECT COUNT(*)::int AS count FROM ledger_transactions WHERE source = \'daily_plan_profit\'')).rows[0].count);
    const secondRun = await processDailyPlanProfits(dependencies);
    const balanceAfterSecond = Number((await query('SELECT balance FROM users WHERE id = 701')).rows[0].balance);

    assert.equal(firstRun.processed, 3);
    assert.equal(payoutCountAfterFirst, 3);
    assert.equal(ledgerCountAfterFirst, 3);
    assert.equal(balanceAfterFirst, 1375);
    assert.equal(secondRun.processed, 0);
    assert.equal(balanceAfterSecond, balanceAfterFirst);
  } finally {
    if (outerTransactionOpen) await client.query('ROLLBACK');
    client.release();
    await pool.end();
  }
});