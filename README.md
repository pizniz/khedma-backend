# Khedma - Backend

Supabase backend configuration and database migrations for the Khedma Moroccan Home Services Marketplace.

## Tech Stack

- **Database**: PostgreSQL (via Supabase)
- **Authentication**: Supabase Auth
- **Storage**: Supabase Storage
- **Real-time**: Supabase Realtime
- **API**: Auto-generated REST API (PostgREST)

## Architecture

This repository contains:
- Database schema migrations (SQL files)
- Row-Level Security (RLS) policies
- Database functions and triggers
- Storage bucket configurations
- Real-time subscription settings

## Database Schema Overview

### Core Tables (13 total)

1. **profiles** - User profiles (clients and providers)
2. **user_roles** - Admin role management
3. **service_categories** - Service types (Plumber, Electrician, etc.)
4. **provider_services** - Services offered by providers
5. **service_requests** - Client requests for services
6. **bookings** - Service booking records
7. **quotes** - Provider pricing quotes
8. **conversations** - DM conversations between users
9. **messages** - Individual messages in conversations
10. **reviews** - Service reviews and ratings
11. **provider_photos** - Portfolio photos for providers
12. **favorites** - Bookmarked providers
13. **notifications** - User notifications

### Storage Buckets

- **voice-messages** - Public bucket for voice message files
- **avatars** - User profile pictures
- **photos** - Service portfolio images

For detailed schema documentation, see [SCHEMA.md](./SCHEMA.md)

## Prerequisites

- [Supabase CLI](https://supabase.com/docs/guides/cli) installed
- Supabase project created at [app.supabase.com](https://app.supabase.com)
- PostgreSQL client (optional, for local testing)

## Getting Started

### 1. Clone the Repository

```bash
git clone https://github.com/pizniz/khedma-backend.git
cd khedma-backend
```

### 2. Install Supabase CLI

```bash
# macOS
brew install supabase/tap/supabase

# Windows (PowerShell)
scoop bucket add supabase https://github.com/supabase/scoop-bucket.git
scoop install supabase

# Linux
brew install supabase/tap/supabase
```

### 3. Link to Your Supabase Project

```bash
# Login to Supabase
supabase login

# Link to your project
supabase link --project-ref YOUR_PROJECT_ID
```

### 4. Apply Migrations

#### To Remote (Production) Database

```bash
# Push all migrations to your Supabase project
supabase db push
```

#### To Local Database (Development)

```bash
# Start local Supabase
supabase start

# Apply migrations locally
supabase db reset
```

## Development Workflow

### Creating New Migrations

```bash
# Create a new migration file
supabase migration new your_migration_name

# Edit the generated SQL file in supabase/migrations/
# Example: supabase/migrations/20260123000000_your_migration_name.sql
```

### Testing Migrations Locally

```bash
# Start local Supabase (if not already running)
supabase start

# Apply all migrations
supabase db reset

# Test your changes
# Connect to local DB: postgresql://postgres:postgres@localhost:54322/postgres
```

### Pushing to Production

```bash
# Review migrations to be applied
supabase db push --dry-run

# Apply migrations to production
supabase db push
```

### Generating TypeScript Types

After schema changes, generate types for the frontend:

```bash
# Generate types
supabase gen types typescript --project-id YOUR_PROJECT_ID > types.ts

# Copy to frontend repository
cp types.ts ../khedma-frontend/src/integrations/supabase/types.ts
```

**Note:** This process is automated via GitHub Actions. When you push migrations to the `main` branch, types are automatically generated and a PR is created in the frontend repository.

## Migration Files

All migrations are in `supabase/migrations/` directory:

```
supabase/migrations/
├── 20260122214855_15c78207-9b46-4de2-b49b-7e6d5a161d1b.sql  # Initial schema
├── 20260122214905_a828cb20-f6e8-4868-8094-2c4fcf18066e.sql  # User roles & RLS
└── 20260122215514_c7cfbeb7-99b9-4aa4-bc3b-f6c90d1234ab.sql  # Storage buckets
```

### Migration Naming Convention

Migrations are automatically named with timestamps:
- Format: `YYYYMMDDHHMMSS_description.sql`
- Example: `20260123143022_add_favorites_table.sql`

## Row-Level Security (RLS)

All tables have RLS policies enabled for security:

- **profiles**: Users can view all, update own
- **service_requests**: Clients see own, providers see open requests
- **bookings**: Only participants can view/update
- **messages**: Only conversation participants can access
- **reviews**: Everyone can view, authenticated users can create

See [SCHEMA.md](./SCHEMA.md) for complete RLS policy documentation.

## Database Functions

### `handle_new_user()`
- Automatically creates a profile when a user signs up
- Triggered on `auth.users` INSERT

### `has_role(user_id, role)`
- Security definer function to check if a user has a specific role
- Used in RLS policies for admin operations

### `update_updated_at_column()`
- Automatically updates `updated_at` timestamp on row changes
- Applied to multiple tables via triggers

## Realtime

The following tables have realtime enabled:
- `messages` - For live chat updates
- `notifications` - For instant notification delivery
- `conversations` - For conversation list updates

## Frontend Repository

The React/Vite frontend application is maintained in a separate repository:

📦 [khedma-frontend](https://github.com/pizniz/khedma-frontend)

## CI/CD

### Automated Type Sync

When migrations are pushed to `main` branch:
1. GitHub Action triggers
2. TypeScript types are generated from the schema
3. A Pull Request is created in the frontend repository
4. Types are automatically synced

### Required GitHub Secrets

Set these in repository Settings > Secrets:
- `SUPABASE_ACCESS_TOKEN` - For type generation
- `SUPABASE_PROJECT_ID` - Your project ID
- `FRONTEND_PAT` - Personal Access Token with write access to frontend repo

## Backup and Recovery

### Creating Backups

```bash
# Backup the entire database
supabase db dump -f backup.sql

# Backup specific schemas
supabase db dump --schema public -f public_backup.sql
```

### Restoring from Backup

```bash
# Restore from SQL file
psql -h your-host -U postgres -d postgres -f backup.sql
```

## Troubleshooting

### Migration Failed

```bash
# Check migration status
supabase migration list

# Repair if needed (local only)
supabase db reset
```

### Reset Local Database

```bash
# Stop and remove all data
supabase stop --no-backup

# Start fresh
supabase start
supabase db reset
```

### Check Database Connection

```bash
# Get connection string
supabase status

# Test connection
psql "postgresql://postgres:postgres@localhost:54322/postgres"
```

## Best Practices

1. **Always test migrations locally** before pushing to production
2. **Use transactions** in migrations when possible
3. **Never drop tables** in production without backup
4. **Document complex queries** with comments
5. **Version control everything** - commit all migration files
6. **Use RLS policies** for all tables with user data
7. **Test RLS policies** thoroughly before deployment

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/new-migration`
3. Add your migration: `supabase migration new description`
4. Test locally: `supabase db reset`
5. Commit changes: `git commit -m 'Add new migration'`
6. Push to branch: `git push origin feature/new-migration`
7. Open a Pull Request

## Support

For issues or questions:
- Open an issue in this repository
- Check [Supabase Documentation](https://supabase.com/docs)
- Visit [Supabase Discord](https://discord.supabase.com)

## License

This project is part of the Khedma platform.
