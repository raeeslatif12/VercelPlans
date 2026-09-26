# VercelPlans

A Vercel-ready recreation of the StarPoint-style rewards platform, branded as VercelPlans.

## Local setup

1. Copy `.env.example` to `.env` and set `DATABASE_URL` and `JWT_SECRET`.
2. Run `schema.sql` against Neon PostgreSQL.
3. Run `npm install` and `npm run dev`.

The app serves the public site and API from one Express process. Auth uses an HTTP-only JWT cookie; users, daily tasks, withdrawals, plans, payment methods, and orders persist in PostgreSQL.

Set `ADMIN_PHONE`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD` in `.env` before the first run to bootstrap an admin account. Admins authenticate separately at `/admin-dashboard` to create and manage plans, review payment references and proof, change order and withdrawal statuses, add payment methods, and enable or disable them.

## Daily plan profit on Vercel

Vercel Cron calls `GET /api/cron/daily-profit` daily using the existing `0 0 * * *` UTC schedule (05:00 in `Asia/Karachi`). Configure `CRON_SECRET` in the Vercel project environment, or continue using `VERCEL_CRON_SECRET`; the endpoint validates Vercel's `Authorization: Bearer ...` header. Vercel Cron runs against production deployments, so deploy this configuration to production and set the secret there.

PostgreSQL `CURRENT_TIMESTAMP` is the authoritative clock for accrual and dashboard eligibility. Order activation is recorded with database `NOW()` at admin approval. The existing `Asia/Karachi` calendar-date rule makes the approval date day one; subsequent cycles follow the Vercel `0 0 * * *` UTC schedule (05:00 Karachi). Catch-up honors the audited `daily_profit_enabled` switch at each cycle time. Only the protected cron processes payouts; dashboard requests are read-only and return backend-calculated balance, profit, day count, and next payout time. The dashboard polls for updated state every 30 seconds.

The processor checks both `plan_daily_profits` and matching `daily_plan_profit` ledger entries before crediting. A matching ledger entry without its payout summary repairs only the summary row, not the balance or historical ledger. Inconsistent or ambiguous history, including a missing activation timestamp, is returned as `needsReview` by the protected cron endpoint and logged for admin review; those cycles are not credited automatically.

`npm test` uses isolated fixtures. To enable the optional PostgreSQL transaction/rollback test, set `TEST_DATABASE_URL` to a dedicated disposable test database; the test never falls back to `DATABASE_URL`.
