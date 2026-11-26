import { createClient } from '@supabase/supabase-js';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

export function env(name, fallback = '') {
  return process.env[name] || fallback;
}

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

export function redirect(url) {
  return new Response(null, { status: 302, headers: { Location: url, 'Cache-Control': 'no-store' } });
}

export function getAdmin() {
  const url = env('SUPABASE_URL');
  const serviceKey = env('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey) throw new Error('Konfigurasi Supabase server belum lengkap.');
  return createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

export function getPublicClient() {
  const url = env('SUPABASE_URL');
  const anon = env('SUPABASE_ANON_KEY');
  if (!url || !anon) throw new Error('Konfigurasi Supabase server belum lengkap.');
  return createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function requireUser(request) {
  const authorization = request.headers.get('authorization') || '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!token) return { error: 'Sesi tidak ditemukan. Silakan masuk kembali.', status: 401 };
  try {
    const client = getPublicClient();
    const { data, error } = await client.auth.getUser(token);
    if (error || !data?.user) return { error: 'Sesi tidak valid atau telah berakhir.', status: 401 };
    return { user: data.user };
  } catch (error) {
    return { error: error.message || 'Autentikasi belum tersedia.', status: 503 };
  }
}

export function siteUrl() {
  const raw = env('SITE_URL', env('URL', 'http://localhost:8888'));
  return raw.replace(/\/$/, '');
}

export function callbackUrl() {
  return `${siteUrl()}/.netlify/functions/social-auth-callback`;
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function encryptionKey() {
  const raw = env('TOKEN_ENCRYPTION_KEY');
  if (!raw) throw new Error('TOKEN_ENCRYPTION_KEY belum diisi di Netlify.');
  let key;
  if (/^[a-f0-9]{64}$/i.test(raw)) key = Buffer.from(raw, 'hex');
  else key = Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error('TOKEN_ENCRYPTION_KEY harus berupa 32 byte dalam format base64 atau 64 karakter hex.');
  return key;
}

export function encryptToken(value) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return {
    token_ciphertext: encrypted.toString('base64'),
    token_iv: iv.toString('base64'),
    token_auth_tag: cipher.getAuthTag().toString('base64')
  };
}

export function decryptToken(row) {
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(row.token_iv, 'base64'));
  decipher.setAuthTag(Buffer.from(row.token_auth_tag, 'base64'));
  const clear = Buffer.concat([
    decipher.update(Buffer.from(row.token_ciphertext, 'base64')),
    decipher.final()
  ]).toString('utf8');
  return JSON.parse(clear);
}

