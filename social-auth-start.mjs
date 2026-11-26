import { randomBytes } from 'node:crypto';
import { callbackUrl, getAdmin, json, requireUser, sha256 } from '../lib/shared.mjs';

export default async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method tidak diizinkan.' }, 405);
  const auth = await requireUser(request);
  if (auth.error) return json({ error: auth.error }, auth.status);
  try {
    const { provider } = await request.json();
    const settings = {
      instagram: Boolean(process.env.INSTAGRAM_APP_ID && process.env.INSTAGRAM_APP_SECRET),
      facebook: Boolean(process.env.META_APP_ID && process.env.META_APP_SECRET),
      tiktok: Boolean(process.env.TIKTOK_CLIENT_KEY && process.env.TIKTOK_CLIENT_SECRET)
    };
    if (!Object.hasOwn(settings, provider)) return json({ error: 'Provider media sosial belum didukung.' }, 400);
    if (!settings[provider]) {
      const message = provider === 'instagram'
        ? 'Instagram OAuth belum dikonfigurasi. Isi INSTAGRAM_APP_ID dan INSTAGRAM_APP_SECRET di Netlify.'
        : provider === 'facebook'
          ? 'Facebook OAuth belum dikonfigurasi. Isi META_APP_ID dan META_APP_SECRET di Netlify.'
          : 'TikTok OAuth belum dikonfigurasi. Isi TIKTOK_CLIENT_KEY dan TIKTOK_CLIENT_SECRET di Netlify.';
      return json({ error: message }, 503);
    }

    const redirectUri = callbackUrl();
    const state = randomBytes(32).toString('hex');
    const admin = getAdmin();
    const { error: stateError } = await admin.from('social_oauth_states').insert({
      state_hash: sha256(state), user_id: auth.user.id, provider,
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString()
    });
    if (stateError) throw stateError;

    let authorizationUrl;
    if (provider === 'instagram') {
      const params = new URLSearchParams({
        client_id: process.env.INSTAGRAM_APP_ID,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'instagram_business_basic',
        state,
        force_authentication: '1'
      });
      authorizationUrl = `https://www.instagram.com/oauth/authorize?${params}`;
    } else if (provider === 'facebook') {
      const params = new URLSearchParams({
        client_id: process.env.META_APP_ID,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'pages_show_list,pages_read_engagement',
        state
      });
      authorizationUrl = `https://www.facebook.com/${process.env.META_GRAPH_VERSION || 'v27.0'}/dialog/oauth?${params}`;
    } else {
      const params = new URLSearchParams({
        client_key: process.env.TIKTOK_CLIENT_KEY,
        response_type: 'code',
        scope: 'user.info.basic',
        redirect_uri: redirectUri,
        state
      });
      authorizationUrl = `https://www.tiktok.com/v2/auth/authorize/?${params}`;
    }
    return json({ ok: true, authorizationUrl });
  } catch (error) {
    console.error('OAuth start error:', error?.message || error);
    return json({ error: 'Tidak dapat memulai koneksi media sosial. Periksa konfigurasi database dan OAuth.' }, 500);
  }
};
