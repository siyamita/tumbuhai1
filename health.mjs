import { json } from '../lib/shared.mjs';
export default async () => json({
  ok: true,
  aiConfigured: Boolean(process.env.OPENAI_API_KEY),
  integrations: {
    instagram: Boolean(process.env.INSTAGRAM_APP_ID && process.env.INSTAGRAM_APP_SECRET),
    facebook: Boolean(process.env.META_APP_ID && process.env.META_APP_SECRET),
    tiktok: Boolean(process.env.TIKTOK_CLIENT_KEY && process.env.TIKTOK_CLIENT_SECRET)
  }
});
