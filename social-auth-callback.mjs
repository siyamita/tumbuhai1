import { getAdmin, json, redirect, callbackUrl, siteUrl, sha256, encryptToken } from '../lib/shared.mjs';

async function saveConnection(admin, userId, provider, accountId, accountName, tokenData, scopes = [], metadata = {}) {
  const encrypted = encryptToken(tokenData);
  const expiry = tokenData.expires_in ? new Date(Date.now() + Number(tokenData.expires_in) * 1000).toISOString() : null;
  const { error } = await admin.from('social_connections').upsert({
    user_id: userId,
    provider,
    external_account_id: String(accountId),
    account_name: accountName || provider,
    ...encrypted,
    token_expires_at: expiry,
    scopes,
    metadata,
    updated_at: new Date().toISOString()
  }, { onConflict: 'user_id,provider,external_account_id' });
  if (error) throw error;
}

async function connectInstagram(admin, userId, code, redirectUri) {
  const form = new URLSearchParams({
    client_id: process.env.INSTAGRAM_APP_ID,
    client_secret: process.env.INSTAGRAM_APP_SECRET,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
    code
  });
  const exchangeResponse = await fetch('https://api.instagram.com/oauth/access_token', { method: 'POST', body: form });
  const exchanged = await exchangeResponse.json();
  if (!exchangeResponse.ok || !exchanged.access_token) throw new Error(exchanged.error_message || 'Pertukaran token Instagram gagal.');
  const longParams = new URLSearchParams({
    grant_type: 'ig_exchange_token', client_secret: process.env.INSTAGRAM_APP_SECRET,
    access_token: exchanged.access_token
  });
  const longResponse = await fetch(`https://graph.instagram.com/access_token?${longParams}`);
  const longToken = await longResponse.json();
  if (!longResponse.ok || !longToken.access_token) throw new Error('Token jangka panjang Instagram tidak dapat diperoleh.');
  const profileResponse = await fetch(`https://graph.instagram.com/${process.env.META_GRAPH_VERSION || 'v27.0'}/me?fields=user_id,username,account_type&access_token=${encodeURIComponent(longToken.access_token)}`);
  const profile = await profileResponse.json();
  if (!profileResponse.ok || !profile.id && !profile.user_id) throw new Error('Profil Instagram tidak dapat dibaca. Pastikan akun merupakan Business atau Creator.');
  await saveConnection(admin, userId, 'instagram', profile.user_id || profile.id, profile.username || 'Instagram Professional', {
    access_token: longToken.access_token,
    expires_in: longToken.expires_in,
    token_type: 'bearer'
  }, exchanged.permissions || ['instagram_business_basic'], { account_type: profile.account_type || 'PROFESSIONAL' });
}

async function connectFacebook(admin, userId, code, redirectUri) {
  const version = process.env.META_GRAPH_VERSION || 'v27.0';
  const exchangeParams = new URLSearchParams({
    client_id: process.env.META_APP_ID, redirect_uri: redirectUri,
    client_secret: process.env.META_APP_SECRET, code
  });
  const exchangeResponse = await fetch(`https://graph.facebook.com/${version}/oauth/access_token?${exchangeParams}`);
  const shortToken = await exchangeResponse.json();
  if (!exchangeResponse.ok || !shortToken.access_token) throw new Error('Token Facebook tidak berhasil diperoleh.');
  const extendedParams = new URLSearchParams({
    grant_type: 'fb_exchange_token', client_id: process.env.META_APP_ID,
    client_secret: process.env.META_APP_SECRET, fb_exchange_token: shortToken.access_token
  });
  const extendedResponse = await fetch(`https://graph.facebook.com/${version}/oauth/access_token?${extendedParams}`);
  const userToken = await extendedResponse.json();
  const token = extendedResponse.ok && userToken.access_token ? userToken : shortToken;
  const pagesUrl = new URL(`https://graph.facebook.com/${version}/me/accounts`);
  pagesUrl.searchParams.set('fields', 'id,name,access_token,tasks');
  pagesUrl.searchParams.set('access_token', token.access_token);
  const pagesResponse = await fetch(pagesUrl);
  const pages = await pagesResponse.json();
  if (!pagesResponse.ok) throw new Error(pages.error?.message || 'Daftar Facebook Page tidak dapat dimuat.');
  if (!Array.isArray(pages.data) || !pages.data.length) throw new Error('Tidak ditemukan Facebook Page yang dapat Anda kelola.');
  for (const page of pages.data) {
    if (!page.access_token) continue;
    await saveConnection(admin, userId, 'facebook', page.id, page.name, {
      access_token: page.access_token,
      token_type: 'page_access_token'
    }, ['pages_show_list', 'pages_read_engagement'], { tasks: page.tasks || [] });
  }
}

async function connectTikTok(admin, userId, code, redirectUri) {
  const form = new URLSearchParams({
    client_key: process.env.TIKTOK_CLIENT_KEY,
    client_secret: process.env.TIKTOK_CLIENT_SECRET,
    code,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri
  });
  const tokenResponse = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form
  });
  const tokenData = await tokenResponse.json();
  if (!tokenResponse.ok || !tokenData.access_token) throw new Error(tokenData.error_description || 'Token TikTok tidak berhasil diperoleh.');
  const profileUrl = new URL('https://open.tiktokapis.com/v2/user/info/');
  profileUrl.searchParams.set('fields', 'open_id,display_name,avatar_url');
  const profileResponse = await fetch(profileUrl, { headers: { Authorization: `Bearer ${tokenData.access_token}` } });
  const profile = await profileResponse.json();
  if (!profileResponse.ok || profile.error?.code !== 'ok' || !profile.data?.user) throw new Error(profile.error?.message || 'Profil TikTok tidak dapat dibaca.');
  const user = profile.data.user;
  await saveConnection(admin, userId, 'tiktok', user.open_id || tokenData.open_id, user.display_name || 'TikTok', {
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token,
    expires_in: tokenData.expires_in,
    refresh_expires_in: tokenData.refresh_expires_in,
    token_type: 'bearer'
  }, String(tokenData.scope || 'user.info.basic,video.list').split(','), { avatar_url: user.avatar_url || null });
}

export default async (request) => {
  const params = new URL(request.url).searchParams;
  const code = params.get('code');
  const state = params.get('state');
  const providerError = params.get('error') || params.get('error_description');
  if (!state || providerError) return redirect(`${siteUrl()}/?social=error`);
  try {
    const admin = getAdmin();
    // Consume state atomically: only one callback can claim this unexpired state.
    const { data: stateRow, error: stateError } = await admin.from('social_oauth_states')
      .delete()
      .eq('state_hash', sha256(state))
      .gt('expires_at', new Date().toISOString())
      .select('state_hash,user_id,provider,expires_at')
      .maybeSingle();
    if (stateError || !stateRow) return redirect(`${siteUrl()}/?social=error`);
    if (!code) return redirect(`${siteUrl()}/?social=error`);
    const callback = callbackUrl();
    if (stateRow.provider === 'instagram') await connectInstagram(admin, stateRow.user_id, code, callback);
    else if (stateRow.provider === 'facebook') await connectFacebook(admin, stateRow.user_id, code, callback);
    else if (stateRow.provider === 'tiktok') await connectTikTok(admin, stateRow.user_id, code, callback);
    else return redirect(`${siteUrl()}/?social=error`);
    return redirect(`${siteUrl()}/?social=connected&provider=${encodeURIComponent(stateRow.provider)}`);
  } catch (error) {
    console.error('Social OAuth callback failed:', error?.message || error);
    return redirect(`${siteUrl()}/?social=error`);
  }
};
