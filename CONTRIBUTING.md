# Contributing to SYNCRO

## Database Migrations

SYNCRO uses the [Supabase CLI](https://supabase.com/docs/guides/cli) to manage database migrations.
All migration files live in `supabase/migrations/` and are applied in lexicographic order.

### Prerequisites

Install the Supabase CLI:

```bash
# macOS / Linux (Homebrew)
brew install supabase/tap/supabase

# Windows (Scoop)
scoop bucket add supabase https://github.com/supabase/scoop-bucket.git
scoop install supabase

# npm (any platform)
npm install -g supabase
```

### Local development setup

```bash
# 1. Start the local Supabase stack (Postgres + Studio + Auth)
supabase start

# 2. Apply all pending migrations
npm run db:migrate   # from /backend, or: supabase db push

# 3. Seed local database with test data
supabase db reset    # applies migrations + seed.sql automatically
```

The local Studio UI is available at http://localhost:54323.

### Creating a new migration

Always use the CLI to generate migration files — this ensures the timestamp prefix is correct:

```bash
# From the repo root
supabase migration new <description>
# e.g. supabase migration new add_notifications_table
```

This creates `supabase/migrations/YYYYMMDDHHMMSS_<description>.sql`.
Write your SQL in that file, then apply it locally with `supabase db push`.

### Migration naming convention

```
YYYYMMDDHHMMSS_short_description.sql
```

Examples:
- `20240115000000_create_push_subscriptions.sql`
- `20240117000000_add_2fa_tables.sql`

### Applying migrations

| Environment | Command |
|-------------|---------|
| Local       | `npm run db:migrate` |
| Production  | `npm run db:migrate:prod` (requires `PRODUCTION_DB_URL` env var) |
| Reset local | `npm run db:reset` |

### Rollback strategy

Supabase does not support automatic down migrations. For each migration that makes
destructive changes, document the manual rollback steps in a comment block at the
top of the migration file:

```sql
-- ROLLBACK:
--   ALTER TABLE public.example DROP COLUMN IF EXISTS new_column;
```

For non-destructive migrations (adding tables, indexes, columns with defaults),
the rollback is simply dropping the added object.

### CI validation

Every pull request that touches `supabase/migrations/` triggers the
`.github/workflows/database.yml` workflow, which:

1. Starts a fresh local Supabase stack
2. Applies all migrations from scratch (`supabase db push`)
3. Runs `supabase db lint` to catch SQL issues

A PR cannot be merged if this workflow fails.

### Seed data

`supabase/seed.sql` contains fake data for local development only.
It is applied automatically by `supabase db reset`.

**Never add real emails, payment data, or any PII to seed.sql.**
Thank you for your interest in contributing! This guide will help you set up the project, follow conventions, and submit high-quality contributions.
---
## Development Setup
- Node.js >= 20
- npm or yarn
- Supabase CLI (for database)
- (Optional) Stellar CLI for contract interactions
---
### Clone and Install
git clone https://github.com/<your-username>/SYNCRO.git
cd SYNCRO
### Backend Setup
cd backend
cp .env.example .env   # Fill in required values
npm install
npm run dev
### Client Setup
cd client
cp .env.example .env.local   # Fill in required values
npm install
npm run dev
### Database Setup
supabase db push
## Environment Variables
Environment variables are defined in `.env.example`.
Key variables include:
- `SUPABASE_URL` – Supabase project URL
- `SUPABASE_KEY` – API key
- `JWT_SECRET` – Secret for authentication
- `REDIS_URL` – Redis connection (if used)
- `EMAIL_SERVICE` – SMTP configuration
> Ensure all required variables are set before running the app.
## Branch Naming Convention
Use the following format:
feat/add-feature-name
fix/bug-description
chore/update-dependencies
docs/update-readme
test/add-unit-tests
## Branch Naming Convention
Use the following format:
feat/add-feature-name
fix/bug-description
chore/update-dependencies
docs/update-readme
test/add-unit-tests
## Pull Request Guidelines
- Reference the issue:
Closes #<issue-number>
- Ensure all tests pass
- Include a clear description of changes
- Add a test plan (how reviewers can verify)
- Keep PRs focused and small
## Code Review Standards
### TypeScript
- No `any` types
- Avoid unsafe non-null assertions
### Security
- No hardcoded secrets
- Validate all inputs (use Zod where applicable)
### Testing
Required for:
- New endpoints
- Bug fixes
- Business logic
## Before Submitting
 - Code builds successfully (npm run build)
 - Tests pass (npm test)
 - Environment variables configured
 - No lint or type errors
 - PR description completed
## Questions or Issues?
If you encounter any issues with the branch protection or have questions about the contribution process:
1. Check existing issues on GitHub
2. Open a new issue with details about your problem
3. Ask for help in discussions or pull request comments
## Code of Conduct
- Be respectful and professional in all interactions
- Provide constructive feedback in reviews
- Help newer contributors learn and improve
- Report any code of conduct violations to the maintainers
## Additional Resources
- [PR Submission Guide](./PR_SUBMISSION_GUIDE.md)
- [Backend README](./backend/README.md)
- [Client README](./client/README.md)
- [GitHub Docs on Branch Protection](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)
---
Thank you for helping make Synchro better! 🚀
