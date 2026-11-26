import { getAdmin, getPublicClient, json } from '../lib/shared.mjs';

export default async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method tidak diizinkan.' }, 405);
  try {
    const body = await request.json();
    const username = String(body.username || '').trim().toLowerCase();
    const password = String(body.password || '');
    if (!/^[a-z0-9_]{3,20}$/.test(username) || password.length < 8) {
      return json({ error: 'Username atau kata sandi tidak sesuai.' }, 400);
    }
    const admin = getAdmin();
    const { data: profile, error: profileError } = await admin
      .from('user_profiles').select('email').eq('username', username).maybeSingle();
    if (profileError || !profile?.email) return json({ error: 'Username atau kata sandi tidak sesuai.' }, 401);

    const publicClient = getPublicClient();
    const { data, error } = await publicClient.auth.signInWithPassword({ email: profile.email, password });
    if (error || !data?.session) return json({ error: 'Username atau kata sandi tidak sesuai.' }, 401);
    return json({ ok: true, session: data.session });
  } catch (error) {
    console.error('Username login error:', error?.message || error);
    return json({ error: 'Layanan login belum siap. Periksa konfigurasi Supabase.' }, 503);
  }
};
