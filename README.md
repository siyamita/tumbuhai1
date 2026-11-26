# TumbuhAI — Netlify Edition

Versi ini mempersiapkan TumbuhAI untuk deployment Netlify dengan:

- angka dashboard dan analytics tanpa data demo;
- input manual laporan performa aktual per kanal;
- akun pengguna berbasis username + password, dengan email untuk verifikasi dan pemulihan akun;
- penyimpanan workspace per pengguna di Supabase dengan Row Level Security;
- Netlify Functions untuk AI, login username, dan OAuth media sosial;
- koneksi OAuth untuk Instagram Professional, Facebook Page, dan TikTok;
- tombol berbagi ke Facebook, X, LinkedIn, WhatsApp, Pinterest, Instagram, dan TikTok.

## 1. Persiapan Supabase

1. Buat project di https://supabase.com.
2. Buka **SQL Editor** dan jalankan seluruh isi `supabase/schema.sql`.
3. Dari **Project Settings → API**, salin Project URL dan anon/publishable key.
4. Isi kedua nilai tersebut pada `config.js`:

```js
window.TUMBUHAI_CONFIG = {
  supabaseUrl: 'https://PROJECT_ID.supabase.co',
  supabaseAnonKey: 'SUPABASE_ANON_OR_PUBLISHABLE_KEY'
};
```

Anon/publishable key memang digunakan browser. Keamanan data bergantung pada kebijakan RLS di database. **Jangan pernah** memasukkan `SUPABASE_SERVICE_ROLE_KEY`, API secret, atau token media sosial ke `config.js`.

5. Di **Authentication → URL Configuration**, atur Site URL ke domain Netlify dan tambahkan domain produksi serta domain preview yang digunakan sebagai Redirect URLs.
6. Aktifkan Email provider. Sebaiknya pertahankan verifikasi email agar akun tervalidasi. Trigger database akan membuat profil username ketika user terdaftar. Setelah email diverifikasi, pengguna dapat masuk memakai username dan password.

## 2. Konfigurasi environment Netlify

Hubungkan repository Git ke Netlify. File `netlify.toml` sudah mengatur build command, folder publik `dist`, dan lokasi Functions.

Di Netlify buka **Site configuration → Environment variables**. Tambahkan variabel berikut. Isi secret langsung pada dashboard Netlify, jangan commit ke GitHub.

| Variable | Kegunaan |
|---|---|
| `SUPABASE_URL` | URL project Supabase |
| `SUPABASE_ANON_KEY` | anon/publishable key Supabase untuk server function login |
| `SUPABASE_SERVICE_ROLE_KEY` | service-role secret; hanya di server |
| `OPENAI_API_KEY` | Mengaktifkan AI Marketing Studio |
| `OPENAI_MODEL` | Model OpenAI yang tersedia pada project Anda, mis. `gpt-6.2-sol` (atau model lain yang diaktifkan untuk project API Anda) |
| `TOKEN_ENCRYPTION_KEY` | Kunci enkripsi token OAuth, 32 byte |
| `INSTAGRAM_APP_ID` | App ID untuk Instagram Login |
| `INSTAGRAM_APP_SECRET` | App secret untuk Instagram Login |
| `META_APP_ID` | App ID Meta untuk Facebook Login |
| `META_APP_SECRET` | App secret Meta untuk Facebook Login |
| `META_GRAPH_VERSION` | Versi Graph API, default `v27.0` |
| `TIKTOK_CLIENT_KEY` | Client key TikTok Login Kit |
| `TIKTOK_CLIENT_SECRET` | Client secret TikTok Login Kit |
| `SITE_URL` | Domain utama, mis. `https://namasitus.netlify.app` |

Buat encryption key 32 byte menggunakan:

```bash
openssl rand -base64 32
```

Simpan nilainya sebagai `TOKEN_ENCRYPTION_KEY` dan **jangan menggantinya** setelah token media sosial mulai tersimpan. Jika kunci berubah, token lama tidak dapat didekripsi dan akun perlu dihubungkan ulang.

Netlify Functions membaca variabel sensitif dari environment runtime. Environment variable untuk Functions perlu diatur pada Netlify UI/CLI/API dan memiliki scope Functions; variabel rahasia tidak disimpan di `netlify.toml`.

## 3. Konfigurasi OAuth media sosial

Callback URL yang digunakan untuk ketiga provider:

```text
https://NAMASITUS.netlify.app/.netlify/functions/social-auth-callback
```

Ganti `NAMASITUS.netlify.app` dengan domain produksi. URL ini harus sama persis dengan Redirect URI pada masing-masing developer portal.

### Instagram Professional

1. Buat aplikasi di Meta for Developers dan tambahkan produk **Instagram** dengan metode **Instagram Login**.
2. Atur OAuth Redirect URI callback di atas.
3. Isi `INSTAGRAM_APP_ID` dan `INSTAGRAM_APP_SECRET` pada Netlify.
4. Alur meminta scope `instagram_business_basic` dan menghubungkan akun Instagram Business/Creator. Akun personal tidak didukung untuk koneksi API ini.

### Facebook Page

1. Pada aplikasi Meta, aktifkan **Facebook Login** dan daftarkan callback URL yang sama.
2. Isi `META_APP_ID` dan `META_APP_SECRET`.
3. Alur meminta `pages_show_list` dan `pages_read_engagement`, kemudian menyimpan Page yang dapat dikelola pengguna.
4. Untuk penggunaan di luar peran developer/tester aplikasi, Meta dapat mewajibkan App Review dan akses lanjutan. Berikan izin sesedikit mungkin sesuai kebutuhan.

### TikTok

1. Buat aplikasi di TikTok for Developers.
2. Tambahkan produk **Login Kit** untuk Web dan daftarkan callback URL yang sama. TikTok mensyaratkan HTTPS dan Redirect URI harus statis serta cocok persis dengan konfigurasi aplikasi.
3. Isi `TIKTOK_CLIENT_KEY` dan `TIKTOK_CLIENT_SECRET`.
4. Alur hanya meminta scope `user.info.basic` untuk membaca identitas dasar profil. Akses daftar video atau publishing tidak diminta pada versi ini dan memerlukan scope/approval tersendiri.

Kredensial developer dan persetujuan aplikasi adalah prasyarat dari platform sosial. Tombol koneksi akan bekerja setelah semua konfigurasi ini benar. Untuk keamanan, jika pengguna memilih menghapus koneksi di TumbuhAI, token yang disimpan aplikasi dihapus. Tindakan ini tidak otomatis mencabut izin aplikasi pada platform; pengguna perlu mencabutnya dari pengaturan keamanan/aplikasi di Meta atau TikTok.

## 4. Deploy ke Netlify

1. Pastikan `config.js` sudah diisi dengan URL dan anon key Supabase.
2. Push seluruh folder proyek ke GitHub/GitLab/Bitbucket.
3. Di Netlify pilih **Add new project → Import an existing project**, lalu pilih repository.
4. Netlify membaca pengaturan di `netlify.toml`: build command `npm run build`, publish directory `dist`, Functions directory `netlify/functions`.
5. Tambahkan semua environment variables pada Netlify seperti bagian 2.
6. Deploy. Setelah deploy pertama, periksa URL `/.netlify/functions/health` untuk mengetahui status konfigurasi AI dan OAuth.
7. Daftarkan URL callback final pada Meta dan TikTok, lalu deploy ulang jika ada perubahan konfigurasi.

## 5. Menjalankan secara lokal

Gunakan Node.js 24 (atau minimal 22.13.0) agar sesuai dengan versi Netlify CLI yang dipakai proyek ini.

```bash
npm install
```

Isi `config.js`, lalu salin `.env.example` menjadi `.env` dan lengkapi kredensial yang diperlukan. Jalankan:

```bash
npm run dev
```

Netlify CLI akan menjalankan static frontend dan Functions pada satu origin lokal. Untuk menguji OAuth provider, callback harus menggunakan URL HTTPS yang terdaftar di developer portal; gunakan domain deploy/preview HTTPS untuk pengujian OAuth.

Pemeriksaan sintaks:

```bash
npm run check
```

## 6. Apa yang sudah aktif dan apa yang masih perlu konfigurasi?

**Sudah disiapkan di kode:** akun Supabase dengan username/password, workspace cloud per user, dashboard kosong sampai ada input, pengelolaan kampanye/konten/produk/leads, input metrik, Netlify Functions AI, OAuth start/callback untuk Instagram/Facebook/TikTok, penyimpanan token yang dienkripsi AES-256-GCM di server, dan tombol berbagi sosial.

**Perlu dilakukan oleh pemilik website:** membuat project Supabase, menjalankan SQL, mengisi `config.js`, memasukkan environment variables, membuat aplikasi developer Meta/TikTok, mendaftarkan callback URL, dan menyelesaikan proses review/izin dari provider.

**Batas integrasi versi ini:** koneksi OAuth menyimpan identitas dan token yang diizinkan, tetapi belum menarik analytics otomatis, belum menjadwalkan posting, dan belum menerbitkan konten otomatis ke akun sosial. Input angka Analytics saat ini berasal dari pengguna. Instagram/TikTok pada tombol berbagi membuka aplikasi/halaman tujuan dan menyalin caption karena web share intent universal untuk mem-publish caption tidak disediakan seperti layanan share-link biasa.

## 7. Struktur folder

```text
.
├── index.html
├── app.js
├── config.js
├── package.json
├── netlify.toml
├── netlify/
│   ├── functions/
│   │   ├── auth-username-login.mjs
│   │   ├── health.mjs
│   │   ├── ai-generate.mjs
│   │   ├── social-auth-start.mjs
│   │   ├── social-auth-callback.mjs
│   │   └── social-connections.mjs
│   └── lib/shared.mjs
├── scripts/build.mjs
└── supabase/schema.sql
```

