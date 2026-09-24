# VercelPlans

A Vercel-ready recreation of the StarPoint-style rewards platform, branded as VercelPlans.

## Local setup

1. Copy `.env.example` to `.env` and set `DATABASE_URL` and `JWT_SECRET`.
2. Run `schema.sql` against Neon PostgreSQL.
3. Run `npm install` and `npm run dev`.

The app serves the public site and API from one Express process. Auth uses an HTTP-only JWT cookie; users, daily tasks, withdrawals, plans, payment methods, and orders persist in PostgreSQL.

Set `ADMIN_PHONE`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD` in `.env` before the first run to bootstrap an admin account. Admins authenticate separately at `/admin-dashboard` to create and manage plans, review payment references and proof, change order and withdrawal statuses, add payment methods, and enable or disable them.
