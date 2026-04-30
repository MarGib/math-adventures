/* ------------------------------------------------------------
 * config.example.js — szablon
 *
 * Skopiuj ten plik do `config.js` (gitignored) i wpisz swoje
 * wartosci z Supabase Dashboard -> Settings -> API.
 *
 * UWAGA: anon (publishable) key JEST publiczny — nie szyfruj go.
 * Bezpieczenstwo zapewnia Row Level Security (RLS), nie ukrywanie
 * klucza. Service_role key NIE TRAFIA tutaj.
 *
 * W produkcji (GitHub Pages) plik config.js generowany jest przez
 * workflow z GitHub Secrets, wiec lokalnie wystarczy testowy.
 * ------------------------------------------------------------ */
window.MATH_ADV_CONFIG = {
    SUPABASE_URL: 'https://YOUR-PROJECT.supabase.co',
    SUPABASE_ANON_KEY: 'eyJhbGc...your-anon-key...',

    // Opcjonalne flagi
    ENABLE_CLOUD: true,        // false -> 100% offline (tylko localStorage)
    GLOBAL_LEADERBOARD: true,  // pokazuje globalny ranking obok lokalnego
};
