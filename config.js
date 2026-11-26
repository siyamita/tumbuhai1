/*
 * Konfigurasi publik frontend.
 * SUPABASE_ANON_KEY memang digunakan di browser; pastikan RLS diaktifkan.
 * JANGAN PERNAH menaruh SUPABASE_SERVICE_ROLE_KEY atau API secret di file ini.
 */
window.TUMBUHAI_CONFIG = {
  supabaseUrl: 'https://YOUR_PROJECT_ID.supabase.co',
  supabaseAnonKey: 'YOUR_SUPABASE_ANON_OR_PUBLISHABLE_KEY'
};
