import { getAdmin, json, requireUser } from '../lib/shared.mjs';

export default async (request) => {
  const auth = await requireUser(request);
  if (auth.error) return json({ error: auth.error }, auth.status);
  try {
    const admin = getAdmin();
    if (request.method === 'GET') {
      const { data, error } = await admin.from('social_connections')
        .select('id,provider,external_account_id,account_name,token_expires_at,scopes,updated_at')
        .eq('user_id', auth.user.id).order('updated_at', { ascending: false });
      if (error) throw error;
      return json({ ok: true, connections: data || [] });
    }
    if (request.method === 'DELETE') {
      const body = await request.json();
      const connectionId = String(body.connectionId || '');
      if (!connectionId) return json({ error: 'ID koneksi diperlukan.' }, 400);
      const { error } = await admin.from('social_connections').delete()
        .eq('id', connectionId).eq('user_id', auth.user.id);
      if (error) throw error;
      return json({ ok: true });
    }
    return json({ error: 'Method tidak diizinkan.' }, 405);
  } catch (error) {
    console.error('Social connections error:', error?.message || error);
    return json({ error: 'Data koneksi media sosial tidak dapat diproses.' }, 500);
  }
};
