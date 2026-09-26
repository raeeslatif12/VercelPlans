export const toBusinessDateKey = value => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new RangeError('A valid backend timestamp is required.');
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit', day: '2-digit' });
  const parts = formatter.formatToParts(date);
  const map = {};
  for (const part of parts) {
    if (part.type !== 'literal') map[part.type] = part.value;
  }
  return `${map.year}-${map.month}-${map.day}`;
};

export const calendarDayDifference = (startKey, endKey) => {
  const toUtcDate = key => {
    const [year, month, day] = String(key || '').split('-').map(Number);
    if (!year || !month || !day) throw new RangeError('A valid business date is required.');
    return new Date(Date.UTC(year, month - 1, day));
  };
  return Math.floor((toUtcDate(endKey).getTime() - toUtcDate(startKey).getTime()) / 86400000);
};

const eligibleDatesFor = (activatedAt, targetDate, durationDays) => {
  const startDate = toBusinessDateKey(activatedAt);
  const endDate = toBusinessDateKey(targetDate);
  const elapsedDays = calendarDayDifference(startDate, endDate);
  const eligibleCount = Math.min(Number(durationDays), elapsedDays + 1);
  if (!Number.isFinite(eligibleCount) || eligibleCount <= 0) return [];

  const [year, month, day] = startDate.split('-').map(Number);
  const startUtc = Date.UTC(year, month - 1, day);
  return Array.from({ length: eligibleCount }, (_, index) => new Date(startUtc + index * 86400000).toISOString().slice(0, 10));
};

export const creditPlanProfit = async (client, order, profitDate, { createLedgerEntry, createUserNotification, createPlanProfitAudit }, amountOverride = null, catchUp = false) => {
  const normalizedProfitDate = toBusinessDateKey(profitDate);
  const reference = `plan_profit:${order.id}:${normalizedProfitDate}`;
  const existingPayouts = await client.query(
    'SELECT id, profit_amount, status FROM plan_daily_profits WHERE user_id = $1 AND order_id = $2 AND profit_date = $3 FOR UPDATE',
    [order.user_id, order.id, normalizedProfitDate]
  );
  const existingLedger = await client.query(
    `SELECT id, amount, type, status, reference, metadata
     FROM ledger_transactions
     WHERE user_id = $1 AND source = 'daily_plan_profit'
       AND (reference = $2 OR (metadata->>'order_id' = $3 AND metadata->>'profit_date' = $4))
     FOR UPDATE`,
    [order.user_id, reference, String(order.id), normalizedProfitDate]
  );

  const payout = existingPayouts.rows[0];
  const ledger = existingLedger.rows[0];
  const review = reason => ({ inserted: false, amount: 0, review: true, reason });
  if (existingPayouts.rowCount > 1 || existingLedger.rowCount > 1) return review('multiple_historical_records');

  if (payout) {
    if (!ledger || ledger.type !== 'credit' || ledger.status !== 'posted' || Number(ledger.amount) !== Number(payout.profit_amount) || payout.status !== 'posted') {
      return review('payout_and_ledger_records_do_not_match');
    }
    return { inserted: false, amount: Number(payout.profit_amount), alreadyPaid: true };
  }

  if (ledger) {
    const historicalAmount = Number(ledger.amount);
    if (ledger.type !== 'credit' || ledger.status !== 'posted' || !Number.isFinite(historicalAmount) || historicalAmount < 0) {
      return review('historical_ledger_entry_is_not_a_posted_credit');
    }
    const reconciled = await client.query(
      'INSERT INTO plan_daily_profits(user_id, order_id, plan_id, profit_date, profit_amount, status) VALUES($1,$2,$3,$4,$5,\'posted\') ON CONFLICT(user_id, order_id, profit_date) DO NOTHING RETURNING id',
      [order.user_id, order.id, order.plan_id, normalizedProfitDate, historicalAmount]
    );
    if (!reconciled.rowCount) return review('payout_record_conflicted_during_ledger_reconciliation');
    if (createPlanProfitAudit) {
      await createPlanProfitAudit(client, order.user_id, 'plan_profit_record_reconciled', {
        order_id: order.id,
        plan_id: order.plan_id,
        profit_date: normalizedProfitDate,
        amount: historicalAmount,
        ledger_transaction_id: ledger.id,
      });
    }
    return { inserted: false, amount: historicalAmount, reconciled: true };
  }

  const profitAmount = Number(amountOverride ?? order.daily_return ?? 0);
  if (!Number.isFinite(profitAmount) || profitAmount < 0) return review('configured_daily_return_is_invalid');

  const inserted = await client.query(
    'INSERT INTO plan_daily_profits(user_id, order_id, plan_id, profit_date, profit_amount, status) VALUES($1,$2,$3,$4,$5,\'posted\') ON CONFLICT(user_id, order_id, profit_date) DO NOTHING RETURNING id',
    [order.user_id, order.id, order.plan_id, normalizedProfitDate, profitAmount]
  );
  if (!inserted.rowCount) return review('payout_record_conflicted_before_credit');

  const metadata = {
    order_id: order.id,
    plan_id: order.plan_id,
    profit_date: normalizedProfitDate,
    eligible_payout_date: normalizedProfitDate,
    amount: profitAmount,
    catch_up: Boolean(catchUp),
  };
  await client.query('UPDATE users SET balance = balance + $1, updated_at = NOW() WHERE id = $2', [profitAmount, order.user_id]);
  await createLedgerEntry(client, order.user_id, profitAmount, 'credit', 'daily_plan_profit', reference, metadata);
  await createUserNotification(client, order.user_id, {
    title: 'Congratulations!',
    message: 'Plan earning credited successfully.',
    amount: profitAmount,
    reason: 'Plan earning',
    source: 'daily_plan_profit',
    reference,
    metadata,
  });
  if (catchUp && createPlanProfitAudit) await createPlanProfitAudit(client, order.user_id, 'plan_profit_catch_up', metadata);
  return { inserted: true, amount: profitAmount };
};

export const processDailyPlanProfits = async ({ query, connect, readSetting, readEnablementHistory = async () => [], creditProfit }) => {
  if (!await readSetting('daily_profit_enabled', true)) return { processed: 0, total: 0, reconciled: 0, plansChecked: 0, needsReview: [] };

  const clock = await query('SELECT CURRENT_TIMESTAMP AS now');
  const targetDate = clock.rows[0]?.now;
  if (!targetDate || Number.isNaN(new Date(targetDate).getTime())) throw new Error('Database time is unavailable for plan accrual.');

  const enablementHistory = await readEnablementHistory();
  const isEnabledAt = timestamp => {
    let enabled = true;
    const cutoff = new Date(timestamp).getTime();
    for (const event of enablementHistory) {
      if (new Date(event.created_at).getTime() > cutoff) break;
      enabled = event.enabled === true || event.enabled === 'true';
    }
    return enabled;
  };

  const orders = await query(`
    SELECT o.id, o.user_id, o.plan_id, o.activated_at, o.created_at, o.active, p.daily_return, p.duration_days
    FROM orders o
    JOIN plans p ON p.id = o.plan_id
    WHERE o.status = 'Approved' AND o.active = true AND p.active = true
  `);

  let processed = 0;
  let total = 0;
  let reconciled = 0;
  const needsReview = [];

  for (const order of orders.rows) {
    const activatedAt = order.activated_at;
    if (!activatedAt) {
      needsReview.push({ order_id: order.id, user_id: order.user_id, profit_date: null, reason: 'missing_original_activation_timestamp' });
      continue;
    }
    const durationDays = Number(order.duration_days || 0);
    const eligibleDates = eligibleDatesFor(activatedAt, targetDate, durationDays);
    let hasReview = false;
    let orderNoLongerEligible = false;
    let latestOrder = null;

    for (const profitDate of eligibleDates) {
      const client = await connect();
      try {
        await client.query('BEGIN');
        const currentOrder = await client.query(`
          SELECT o.id, o.user_id, o.plan_id, o.activated_at, o.created_at, o.active, o.status,
                 p.daily_return, p.duration_days, p.active AS plan_active
          FROM orders o
          JOIN plans p ON p.id = o.plan_id
          WHERE o.id = $1
          FOR UPDATE OF o, p
        `, [order.id]);
        const current = currentOrder.rows[0];
        latestOrder = current || null;
        if (!current || current.status !== 'Approved' || !current.active || !current.plan_active) {
          orderNoLongerEligible = true;
          await client.query('COMMIT');
          break;
        }

        if (!current.activated_at) {
          hasReview = true;
          needsReview.push({ order_id: order.id, user_id: order.user_id, profit_date: profitDate, reason: 'missing_original_activation_timestamp' });
          await client.query('COMMIT');
          break;
        }

        const currentActivation = current.activated_at;
        const currentEligibleDates = eligibleDatesFor(currentActivation, targetDate, current.duration_days);
        if (!currentEligibleDates.includes(profitDate)) {
          await client.query('COMMIT');
          continue;
        }

        const cycleTimestamp = profitDate === toBusinessDateKey(currentActivation) ? currentActivation : `${profitDate}T00:00:00.000Z`;
        if (!isEnabledAt(cycleTimestamp)) {
          await client.query('COMMIT');
          continue;
        }

        const catchUp = profitDate < toBusinessDateKey(targetDate);
        const result = await creditProfit(client, current, profitDate, catchUp);
        await client.query('COMMIT');
        if (result.inserted) {
          processed += 1;
          total += result.amount;
        }
        if (result.reconciled) reconciled += 1;
        if (result.review) {
          hasReview = true;
          needsReview.push({ order_id: order.id, user_id: order.user_id, profit_date: profitDate, reason: result.reason });
        }
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }

    const latestActivation = latestOrder?.activated_at || latestOrder?.created_at || activatedAt;
    const latestDuration = Number(latestOrder?.duration_days || durationDays);
    const elapsedDayNumber = calendarDayDifference(toBusinessDateKey(latestActivation), toBusinessDateKey(targetDate)) + 1;
    if (!orderNoLongerEligible && !hasReview && latestOrder?.plan_active && latestDuration > 0 && elapsedDayNumber >= latestDuration) {
      await query('UPDATE orders SET active = false, status = CASE WHEN status = \'Approved\' THEN \'Completed\' ELSE status END, updated_at = NOW() WHERE id = $1 AND active = true AND status = \'Approved\'', [order.id]);
    }
  }

  return { processed, total, reconciled, plansChecked: orders.rowCount, needsReview };
};