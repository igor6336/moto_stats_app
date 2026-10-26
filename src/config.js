// Supabase project for accounts, friends and leaderboards. The anon /
// publishable key is public by design (access is limited by row level
// security in supabase/schema.sql). Never put the service_role key here.
// Empty values keep the app fully local: social screens show a notice.
export const SUPABASE_URL = '';
export const SUPABASE_KEY = '';

// Accounts use login + password. Supabase needs an e-mail, so the login is
// mapped to a placeholder address that never receives mail
// ("Confirm email" must be off in the Supabase project).
export const LOGIN_EMAIL_DOMAIN = 'riders.moto-stats.app';
