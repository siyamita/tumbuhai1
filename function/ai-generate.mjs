import OpenAI from 'openai';
import { json, requireUser } from '../lib/shared.mjs';

const SYSTEM_PROMPT = `Anda adalah TumbuhAI, konsultan senior pemasaran digital dan brand strategist untuk UMKM Indonesia. Buat materi pemasaran yang praktis, kreatif, etis, dan dapat dieksekusi. Gunakan bahasa Indonesia yang natural dan sesuai konteks bisnis, produk, target audiens, kanal, tujuan, dan gaya komunikasi pengguna. Jangan mengarang fakta, testimoni, sertifikasi, komposisi, manfaat kesehatan, angka penjualan, diskon, stok, atau klaim produk. Jika data belum tersedia, gunakan placeholder atau beri catatan verifikasi. Hindari clickbait menyesatkan, manipulasi, spam, dan janji hasil yang tidak dapat dijamin. Berikan hasil siap diedit, CTA yang jelas, dan catatan optimasi ringkas yang relevan.`;

export default async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method tidak diizinkan.' }, 405);
  const auth = await requireUser(request);
  if (auth.error) return json({ error: auth.error }, auth.status);
  if (!process.env.OPENAI_API_KEY) return json({ error: 'OPENAI_API_KEY belum dikonfigurasi di Netlify.' }, 503);
  try {
    const body = await request.json();
    const allowed = ['businessName', 'industry', 'objective', 'product', 'usp', 'audience', 'platform', 'tone', 'outputType', 'promotion'];
    const brief = {};
    for (const key of allowed) brief[key] = typeof body[key] === 'string' ? body[key].trim().slice(0, 1200) : '';
    if (!brief.product && !brief.businessName) return json({ error: 'Nama bisnis atau produk wajib diisi.' }, 400);
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await client.responses.create({
      model: process.env.OPENAI_MODEL || 'gpt-6.2-sol',
      instructions: SYSTEM_PROMPT,
      input: `Buat materi pemasaran berdasarkan brief berikut.\n\n${JSON.stringify(brief, null, 2)}\n\nBuat hasil utama terlebih dahulu. Sesuaikan format dengan jenis output, kanal, tujuan dan tone. Jangan menambahkan data yang tidak diberikan.`,
      max_output_tokens: 1400
    });
    return json({ ok: true, text: response.output_text || 'AI tidak mengembalikan teks. Silakan coba kembali.' });
  } catch (error) {
    console.error('AI generation failed:', error?.status || '', error?.message || error);
    return json({ error: 'AI belum dapat memproses permintaan. Periksa konfigurasi model dan API key.' }, 502);
  }
};
