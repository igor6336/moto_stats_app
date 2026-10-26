// Supabase project for accounts, friends and leaderboards. The anon /
// publishable key is public by design (access is limited by row level
// security in supabase/schema.sql). Never put the service_role key here.
// Empty values keep the app fully local: social screens show a notice.
export const SUPABASE_URL = 'https://dmtuusnkmsepvzufmwgd.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_NQQ2v9fkh6IbhKebOnNWUg_9qoWKs_S';

// Accounts use login + password. Supabase needs an e-mail, so the login is
// mapped to a placeholder address that never receives mail
// ("Confirm email" must be off in the Supabase project).
export const LOGIN_EMAIL_DOMAIN = 'riders.moto-stats.app';

// Yandex Maps JS API v3, free plan. The key is restricted by HTTP Referer
// to igor6336.github.io in the Yandex developer console. Empty = OSM only.
export const YANDEX_MAPS_KEY = '6d4ae16c-b2e0-47e8-932b-7d689265b22d';
