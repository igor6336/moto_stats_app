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

// Yandex Static API (map under the route on the share card), free plan.
// A separate key from the JS API one. Empty = card without a map.
export const YANDEX_STATIC_KEY = 'b09862dd-a95c-4be2-b8f2-1a5ecf3ac6aa';

// Web Push (VAPID) public key: notifications about new versions. The private
// half lives only in the GitHub Actions secret VAPID_PRIVATE_KEY.
export const VAPID_PUBLIC_KEY = 'BFhjUK7jL_N0LVQNyFwCXI4NrATjtU2Z0wLnBfbV9IGPSA66EZ9NituaAk8Nfg5M-FUYUu2mA9F75OFaTylRLeI';
