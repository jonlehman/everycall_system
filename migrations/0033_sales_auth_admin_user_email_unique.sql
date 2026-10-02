-- Admin Users Save uses ON CONFLICT (email); enforce that identity key in the database.
-- Audit and resolve any duplicate emails before applying this migration.
CREATE UNIQUE INDEX IF NOT EXISTS admin_users_email_unique_idx ON admin_users (email);
