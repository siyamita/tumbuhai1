/* TumbuhAI frontend — Netlify + Supabase edition */
const $ = (id) => document.getElementById(id);
const appConfig = window.TUMBUHAI_CONFIG || {};
const supabaseReady = Boolean(
  window.supabase?.createClient &&
  appConfig.supabaseUrl &&
  appConfig.supabaseAnonKey &&
  !String(appConfig.supabaseUrl).includes('YOUR_') &&
  !String(appConfig.supabaseAnonKey).includes('YOUR_')
);
const supabaseClient = supabaseReady
  ? window.supabase.createClient(appConfig.supabaseUrl, appConfig.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    })
  : null;

let currentUser = null;
let workspaceCache = {};
let syncTimer = null;
let generatedText = '';
let aiAvailable = false;
let socialConnections = [];
let calendarDate = new Date();
calendarDate.setDate(1);
let campaigns = [], contents = [], products = [], leads = [], metrics = [];

const userDataKey = (key) => `tumbuhai_user_${encodeURIComponent((currentUser?.username || 'guest').toLowerCase())}_${key}`;
const safeJSON = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(userDataKey(key))) ?? fallback; }
  catch { return fallback; }
};

function toast(message) {
  const el = $('toast');
  if (!el) return;
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
}

function formatNumber(value) {
  if (value === null || value === undefined || value === '') return '—';
  return new Intl.NumberFormat('id-ID').format(Number(value));
}

function saveUserData(key, value) {
  localStorage.setItem(userDataKey(key), JSON.stringify(value));
  workspaceCache[key] = value;
  if (!supabaseClient || !currentUser?.id) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(async () => {
    try {
      const { error } = await supabaseClient.from('workspaces').upsert({
        user_id: currentUser.id,
        data: workspaceCache,
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id' });
      if (error) console.warn('Cloud sync failed:', error.message);
    } catch (error) {
      console.warn('Cloud sync unavailable:', error?.message || error);
    }
  }, 450);
}

async function hydrateWorkspace() {
  const keys = ['campaigns', 'contents', 'products', 'leads', 'metrics', 'brand'];
  const localData = {};
  for (const key of keys) {
    try {
      const value = localStorage.getItem(userDataKey(key));
      if (value !== null) localData[key] = JSON.parse(value);
    } catch { /* skip invalid local cache */ }
  }

  if (supabaseClient && currentUser?.id) {
    const { data, error } = await supabaseClient.from('workspaces')
      .select('data')
      .eq('user_id', currentUser.id)
      .maybeSingle();
    if (error) console.warn('Unable to load workspace:', error.message);
    if (data?.data && typeof data.data === 'object') {
      workspaceCache = { ...localData, ...data.data };
    } else {
      workspaceCache = localData;
      if (Object.keys(localData).length) {
        await supabaseClient.from('workspaces').upsert({
          user_id: currentUser.id, data: workspaceCache, updated_at: new Date().toISOString()
        }, { onConflict: 'user_id' });
      }
    }
  } else {
    workspaceCache = localData;
  }
  for (const [key, value] of Object.entries(workspaceCache)) {
    localStorage.setItem(userDataKey(key), JSON.stringify(value));
  }
}

function setCurrentUser(user) {
  const metadata = user?.user_metadata || {};
  currentUser = {
    id: user.id,
    username: String(metadata.username || metadata.user_name || user.email || 'pengguna').toLowerCase(),
    displayName: metadata.display_name || metadata.full_name || metadata.name || metadata.username || 'Pengguna'
  };
}

function navigate(view) {
  document.querySelectorAll('.view').forEach((element) => element.classList.remove('active'));
  $('view-' + view)?.classList.add('active');
  document.querySelectorAll('#mainNav button').forEach((button) => {
    button.classList.toggle('active', button.dataset.view === view);
  });
  const active = document.querySelector(`#mainNav button[data-view="${view}"]`);
  $('crumbName').textContent = active ? active.textContent.trim().replace(/\s+/g, ' ') : view;
  $('sidebar')?.classList.remove('open');
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (view === 'calendar') renderCalendar();
  if (view === 'leads') renderLeads();
  if (view === 'campaigns') renderCampaigns();
  if (view === 'catalog') renderProducts();
  if (view === 'analytics') renderAnalytics();
  if (view === 'social') refreshSocialConnections();
}

document.querySelectorAll('#mainNav button[data-view]').forEach((button) => {
  button.addEventListener('click', () => navigate(button.dataset.view));
});

function toggleSidebar() { $('sidebar')?.classList.toggle('open'); }
function openModal(id) { $(id)?.classList.add('show'); }
function closeModal(id) { $(id)?.classList.remove('show'); }

function showAuthPanel(panel) {
  $('loginPanel').hidden = panel !== 'login';
  $('registerPanel').hidden = panel !== 'register';
  $('authMessage').className = 'auth-message';
  $('authMessage').textContent = '';
}

function showAuthMessage(message, type = 'error') {
  const el = $('authMessage');
  el.textContent = message;
  el.className = 'auth-message show ' + type;
}

async function handleRegister(event) {
  event.preventDefault();
  if (!supabaseClient) {
    showAuthMessage('Website belum dikonfigurasi. Isi SUPABASE_URL dan SUPABASE_ANON_KEY pada file config.js terlebih dahulu.');
    return;
  }
  const displayName = $('registerName').value.trim();
  const email = $('registerEmail').value.trim().toLowerCase();
  const username = $('registerUsername').value.trim().toLowerCase();
  const password = $('registerPassword').value;
  const confirmation = $('registerConfirm').value;
  if (displayName.length < 2) return showAuthMessage('Nama lengkap minimal 2 karakter.');
  if (!/^[a-z0-9_]{3,20}$/.test(username)) return showAuthMessage('Username harus 3–20 karakter dan hanya boleh berisi huruf, angka, atau garis bawah.');
  if (!/^\S+@\S+\.\S+$/.test(email)) return showAuthMessage('Masukkan alamat email yang valid.');
  if (password.length < 8) return showAuthMessage('Kata sandi minimal 8 karakter.');
  if (password !== confirmation) return showAuthMessage('Konfirmasi kata sandi belum sama.');

  const button = $('registerButton');
  button.disabled = true;
  button.textContent = 'Membuat akun...';
  try {
    const { data, error } = await supabaseClient.auth.signUp({
      email,
      password,
      options: {
        data: { username, display_name: displayName },
        emailRedirectTo: window.location.origin
      }
    });
    if (error) throw error;
    $('registerName').value = '';
    $('registerEmail').value = '';
    $('registerUsername').value = '';
    $('registerPassword').value = '';
    $('registerConfirm').value = '';
    if (data.session && data.user) {
      setCurrentUser(data.user);
      await initWorkspace();
      toast('Akun berhasil dibuat. Selamat datang!');
    } else {
      showAuthPanel('login');
      showAuthMessage('Akun berhasil didaftarkan. Periksa email untuk verifikasi, kemudian masuk menggunakan username dan kata sandi.', 'success');
    }
  } catch (error) {
    const message = error?.message || 'Akun belum berhasil dibuat.';
    showAuthMessage(message.includes('user_profiles_username_key') || message.includes('duplicate key')
      ? 'Username sudah digunakan. Silakan pilih username lain.' : message);
  } finally {
    button.disabled = false;
    button.textContent = 'Daftar Akun →';
  }
}

async function handleLogin(event) {
  event.preventDefault();
  if (!supabaseClient) {
    showAuthMessage('Website belum dikonfigurasi. Isi SUPABASE_URL dan SUPABASE_ANON_KEY pada file config.js terlebih dahulu.');
    return;
  }
  const username = $('loginUsername').value.trim().toLowerCase();
  const password = $('loginPassword').value;
  if (!username || !password) return showAuthMessage('Masukkan username dan kata sandi.');
  const button = $('loginButton');
  button.disabled = true;
  button.textContent = 'Memeriksa akun...';
  try {
    const response = await fetch('/.netlify/functions/auth-username-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Username atau kata sandi tidak sesuai.');
    const { error } = await supabaseClient.auth.setSession({
      access_token: result.session.access_token,
      refresh_token: result.session.refresh_token
    });
    if (error) throw error;
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
    if (userError || !user) throw userError || new Error('Sesi masuk tidak dapat diverifikasi.');
    setCurrentUser(user);
    $('loginPassword').value = '';
    await initWorkspace();
    toast('Berhasil masuk. Selamat datang, ' + currentUser.displayName + '!');
  } catch (error) {
    showAuthMessage(error?.message || 'Tidak dapat masuk. Periksa koneksi dan konfigurasi server.');
  } finally {
    button.disabled = false;
    button.textContent = 'Masuk ke Dashboard →';
  }
}

async function logout() {
  if (supabaseClient) await supabaseClient.auth.signOut();
  currentUser = null;
  workspaceCache = {};
  $('appShell').classList.remove('is-visible');
  $('authScreen').style.display = 'flex';
  $('loginUsername').value = '';
  $('loginPassword').value = '';
  showAuthPanel('login');
}

async function initWorkspace() {
  if (!currentUser) return;
  await hydrateWorkspace();
  campaigns = safeJSON('campaigns', []);
  contents = safeJSON('contents', []);
  products = safeJSON('products', []);
  leads = safeJSON('leads', []);
  metrics = safeJSON('metrics', []);
  const display = currentUser.displayName || currentUser.username;
  const firstName = display.trim().split(/\s+/)[0];
  $('sidebarUserName').textContent = display;
  $('topUserName').textContent = display;
  $('dashboardName').textContent = firstName + '!';
  const initials = display.trim().split(/\s+/).slice(0, 2).map((word) => word[0]).join('').toUpperCase() || 'TU';
  $('sidebarInitials').textContent = initials;
  $('topInitials').textContent = initials;
  $('newContentDate').value = new Date().toISOString().slice(0, 10);
  $('metricDate').value = new Date().toISOString().slice(0, 10);
  if ($('socialShareUrl') && !$('socialShareUrl').value) $('socialShareUrl').value = window.location.origin;
  $('todayDate').textContent = new Intl.DateTimeFormat('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());
  document.querySelectorAll('.brand-input').forEach((element) => { element.value = ''; });
  const savedBrand = safeJSON('brand', null);
  if (savedBrand) Object.entries(savedBrand).forEach(([key, value]) => { if ($(key)) $(key).value = value; });
  $('appShell').classList.add('is-visible');
  $('authScreen').style.display = 'none';
  renderCampaigns();
  renderProducts();
  renderLeads();
  renderCalendar();
  calculateBrand(false);
  renderAnalytics();
  renderDashboard();
  navigate('dashboard');
  checkAI();
  refreshSocialConnections();
}

async function boot() {
  if (!supabaseClient) {
    showAuthPanel('login');
    showAuthMessage('Konfigurasi Supabase belum diisi. Lengkapi file config.js dan jalankan deployment setelah menyiapkan database.');
    return;
  }
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (session) {
    const { data: { user }, error } = await supabaseClient.auth.getUser();
    if (!error && user) {
      setCurrentUser(user);
      await initWorkspace();
    }
  }
  const params = new URLSearchParams(window.location.search);
  const socialStatus = params.get('social');
  if (socialStatus === 'connected') toast('Akun media sosial berhasil dihubungkan.');
  if (socialStatus === 'error') toast('Koneksi media sosial belum berhasil. Periksa konfigurasi atau coba lagi.');
  if (socialStatus) {
    params.delete('social'); params.delete('provider');
    const clean = window.location.pathname + (params.toString() ? '?' + params.toString() : '') + window.location.hash;
    history.replaceState({}, '', clean);
  }
}

function updateDashboard() {
  $('dashboardCampaignTotal').textContent = campaigns.length;
  $('campaignTotal').textContent = campaigns.length;
  $('campaignActive').textContent = campaigns.filter((campaign) => campaign.status === 'Aktif').length;
  $('campaignScheduled').textContent = campaigns.filter((campaign) => campaign.status === 'Terjadwal').length;
  $('campaignDone').textContent = campaigns.filter((campaign) => campaign.status === 'Selesai').length;
  const latest = [...metrics].sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
  $('dashboardReach').textContent = latest ? formatNumber(latest.reach) : '—';
  $('dashboardConversions').textContent = latest ? formatNumber(latest.conversions) : '—';
  const engagement = latest && Number(latest.reach) > 0 ? (Number(latest.interactions) / Number(latest.reach) * 100) : null;
  $('dashboardEngagement').textContent = engagement === null ? '—' : engagement.toFixed(2).replace('.', ',') + '%';
  $('dashboardCampaigns').innerHTML = campaigns.length
    ? campaigns.slice(0, 4).map((campaign) => `<div class="activity-item"><div class="activity-mark">📣</div><div><b>${escapeHTML(campaign.name)}</b><p>${escapeHTML(campaign.channel)} · ${escapeHTML(campaign.status)}</p></div></div>`).join('')
    : '<div class="dashboard-empty">Belum ada kampanye. Tambahkan kampanye pertama Anda.</div>';
  $('dashboardCampaignTable').innerHTML = campaigns.length
    ? campaigns.slice(0, 5).map((campaign) => `<tr><td><div class="campaign-title">${escapeHTML(campaign.name)}</div><div class="campaign-meta">${escapeHTML(campaign.goal || '')}</div></td><td>${escapeHTML(campaign.channel)}</td><td><span class="pill ${campaign.status === 'Selesai' ? 'blue' : campaign.status === 'Terjadwal' ? 'orange' : ''}">${escapeHTML(campaign.status)}</span></td><td>${escapeHTML(campaign.period || '—')}</td></tr>`).join('')
    : '<tr><td colspan="4" style="text-align:center;color:#98a39b;padding:25px">Belum ada data kampanye.</td></tr>';
  $('dashboardActivity').textContent = (campaigns.length + contents.length + products.length + leads.length + metrics.length)
    ? `${campaigns.length} kampanye, ${contents.length} jadwal konten, ${products.length} produk, ${leads.length} leads, dan ${metrics.length} laporan tersimpan di workspace.`
    : 'Belum ada aktivitas. Aktivitas akan muncul setelah Anda mulai mengelola kampanye dan konten.';
}

function setOutput(type) { $('outputType').value = type; $('view-studio') && navigate('studio'); }
function getBrief() {
  return {
    businessName: $('businessName').value.trim(), industry: $('industry').value,
    objective: $('objective').value, product: $('product').value.trim(), usp: $('usp').value.trim(),
    audience: $('audience').value.trim(), platform: $('platform').value, tone: $('tone').value,
    outputType: $('outputType').value, promotion: $('promotion').value.trim()
  };
}

async function checkAI() {
  try {
    const response = await fetch('/.netlify/functions/health');
    const data = await response.json();
    aiAvailable = Boolean(response.ok && data.aiConfigured);
  } catch { aiAvailable = false; }
  $('studioMode').textContent = aiAvailable ? 'AI siap digunakan' : 'AI belum dikonfigurasi';
  $('resultTag').textContent = aiAvailable ? 'TUMBUHAI · AI LIVE' : 'AI OFFLINE';
  $('aiStatusIcon').style.color = aiAvailable ? '#65a64b' : '#9a7f56';
}

async function generateMarketing() {
  const brief = getBrief();
  if (!brief.product && !brief.businessName) return toast('Isi nama bisnis atau produk terlebih dahulu.');
  if (!supabaseClient || !aiAvailable) return toast('AI belum aktif. Admin perlu mengisi OPENAI_API_KEY pada environment Netlify.');
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) return toast('Silakan masuk kembali untuk menggunakan AI.');
  const button = $('generateBtn');
  button.disabled = true;
  button.textContent = 'Sedang menyusun...';
  $('resultEmpty').classList.add('hidden');
  $('resultActions').classList.add('hidden');
  $('resultOutput').classList.remove('hidden');
  $('resultOutput').textContent = 'AI sedang menyiapkan materi pemasaran...';
  try {
    const response = await fetch('/.netlify/functions/ai-generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify(brief)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'AI tidak dapat memproses permintaan.');
    generatedText = data.text || '';
    $('resultOutput').textContent = generatedText;
    $('resultTag').textContent = 'TUMBUHAI · AI LIVE';
    $('resultActions').classList.remove('hidden');
    syncShareDraft();
    toast('Konten berhasil dibuat oleh AI.');
  } catch (error) {
    $('resultOutput').textContent = error.message || 'Terjadi kendala ketika menghubungi AI.';
    $('resultActions').classList.add('hidden');
  } finally {
    button.disabled = false;
    button.innerHTML = '✳ Generate dengan AI <span>↗</span>';
  }
}

async function copyResult() {
  if (!generatedText) return;
  try { await navigator.clipboard.writeText(generatedText); toast('Hasil berhasil disalin.'); }
  catch { toast('Browser tidak mengizinkan salin otomatis. Pilih teks lalu salin.'); }
}

function saveContent() {
  if (!generatedText) return toast('Belum ada hasil untuk disimpan.');
  const title = ($('outputType').value + ' — ' + ($('product').value || 'Konten baru')).slice(0, 70);
  contents.push({ title, date: new Date().toISOString().slice(0, 10), category: $('outputType').value.includes('Promo') ? 'Promosi' : 'Edukasi', channel: $('platform').value, text: generatedText });
  saveUserData('contents', contents);
  renderCalendar();
  renderDashboard();
  toast('Konten disimpan ke kalender.');
}

function calculateBrand(showToast = true) {
  const fields = ['brandName', 'brandTagline', 'brandPromise', 'brandCharacter', 'brandColor'];
  const checks = fields.map((id) => Boolean($(id).value.trim()));
  const score = Math.round(checks.filter(Boolean).length / fields.length * 100);
  $('brandScore').innerHTML = score + '<small>/100</small>';
  $('brandMeter').style.width = score + '%';
  const labels = ['Nama merek tersedia', 'Tagline terdefinisi', 'Brand promise terisi', 'Karakter merek dipilih', 'Palet warna ditentukan'];
  $('brandChecks').innerHTML = labels.map((label, index) => `<div class="score-check"><span>${label}</span><strong>${checks[index] ? '✓' : 'Belum'}</strong></div>`).join('');
  if (showToast) toast('Analisis kelengkapan identitas selesai.');
}

function saveBrand() {
  const data = {};
  document.querySelectorAll('.brand-input').forEach((element) => { data[element.id] = element.value; });
  saveUserData('brand', data);
  calculateBrand();
  toast('Profil merek tersimpan di akun Anda.');
}

function addCampaign() {
  const name = $('newCampaignName').value.trim();
  if (!name) return toast('Nama kampanye wajib diisi.');
  campaigns.push({
    id: crypto.randomUUID(), name, goal: $('newCampaignGoal').value.trim(),
    channel: $('newCampaignChannel').value, status: $('newCampaignStatus').value,
    period: $('newCampaignPeriod')?.value || ''
  });
  saveUserData('campaigns', campaigns);
  closeModal('campaignModal');
  $('newCampaignName').value = '';
  $('newCampaignGoal').value = '';
  renderCampaigns(); renderDashboard();
  toast('Kampanye berhasil ditambahkan.');
}

function renderCampaigns() {
  const grid = $('campaignGrid');
  if (!campaigns.length) {
    grid.innerHTML = '<div class="empty-state"><div class="empty-icon">📣</div><h3>Belum ada kampanye</h3><p>Buat kampanye pertama untuk mulai mencatat aktivitas pemasaran bisnis Anda.</p></div>';
  } else {
    grid.innerHTML = campaigns.map((campaign) => {
      const cls = campaign.status === 'Aktif' ? '' : campaign.status === 'Selesai' ? 'blue' : 'orange';
      return `<div class="campaign-card"><div class="campaign-card-head"><span class="pill ${cls}">${escapeHTML(campaign.status)}</span><span class="mini-tag">${escapeHTML(campaign.channel)}</span></div><h3>${escapeHTML(campaign.name)}</h3><p>${escapeHTML(campaign.goal || 'Belum ada deskripsi tujuan.')}</p><div class="campaign-metrics"><div><b>—</b><small>Jangkauan</small></div><div><b>—</b><small>Engagement</small></div><div><b>${escapeHTML(campaign.period || '—')}</b><small>Periode</small></div></div></div>`;
    }).join('');
  }
  updateDashboard();
}

function addContent() {
  const title = $('newContentTitle').value.trim(), date = $('newContentDate').value;
  if (!title || !date) return toast('Judul dan tanggal harus diisi.');
  contents.push({ title, date, category: $('newContentCategory').value, channel: $('newContentChannel').value });
  saveUserData('contents', contents);
  closeModal('contentModal');
  $('newContentTitle').value = '';
  renderCalendar(); renderDashboard();
  toast('Jadwal konten ditambahkan.');
}

function changeMonth(offset) { calendarDate.setMonth(calendarDate.getMonth() + offset); renderCalendar(); }

function renderCalendar() {
  const year = calendarDate.getFullYear(), month = calendarDate.getMonth();
  $('monthLabel').textContent = new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric' }).format(calendarDate);
  const first = new Date(year, month, 1), start = (first.getDay() + 6) % 7;
  const days = new Date(year, month + 1, 0).getDate(), prevDays = new Date(year, month, 0).getDate();
  const names = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];
  let html = names.map((name) => `<div class="day-name">${name}</div>`).join('');
  const today = new Date();
  for (let index = 0; index < 42; index++) {
    let day, other = false, date;
    if (index < start) { day = prevDays - start + index + 1; other = true; date = new Date(year, month - 1, day); }
    else if (index >= start + days) { day = index - start - days + 1; other = true; date = new Date(year, month + 1, day); }
    else { day = index - start + 1; date = new Date(year, month, day); }
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const events = contents.filter((item) => item.date === key);
    html += `<div class="day-cell ${other ? 'muted' : ''} ${date.toDateString() === today.toDateString() ? 'today' : ''}"><span class="day-num">${day}</span>${events.map((item) => `<span class="day-event ${item.category === 'Promosi' ? 'orange' : ''}" title="${escapeHTML(item.title)}">${escapeHTML(item.title)}</span>`).join('')}</div>`;
  }
  $('calendarGrid').innerHTML = html;
}

function addProduct() {
  const name = $('newProductName').value.trim();
  const priceValue = $('newProductPrice').value.trim();
  const price = priceValue === '' ? null : Number(priceValue);
  if (!name || (price !== null && (!Number.isFinite(price) || price < 0))) return toast('Nama produk wajib diisi dan harga harus valid.');
  products.push({ id: crypto.randomUUID(), name, price, emoji: $('newProductEmoji').value || '📦', desc: $('newProductDesc').value.trim() });
  saveUserData('products', products);
  closeModal('productModal');
  $('newProductName').value = ''; $('newProductPrice').value = ''; $('newProductDesc').value = '';
  renderProducts(); renderDashboard();
  toast('Produk berhasil ditambahkan.');
}

function rupiah(value) {
  if (value === null || value === undefined || value === '') return 'Harga belum diisi';
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(value);
}

function renderProducts() {
  $('productGrid').innerHTML = products.length
    ? products.map((product, index) => `<div class="product-card"><div class="product-visual" style="background:${['linear-gradient(145deg,#eaf3df,#f5f2e8)','linear-gradient(145deg,#f8eadf,#fff5e8)','linear-gradient(145deg,#e4eef6,#f6f4ed)'][index % 3]}">${escapeHTML(product.emoji || '📦')}</div><div class="product-info"><h3>${escapeHTML(product.name)}</h3><p>${escapeHTML(product.desc || 'Produk')}</p><div class="product-row"><span class="product-price">${rupiah(product.price)}</span><span class="pill">Tersimpan</span></div></div></div>`).join('')
    : '<div class="empty-state"><div class="empty-icon">🛍️</div><h3>Katalog masih kosong</h3><p>Tambahkan produk atau layanan bisnis Anda agar dapat digunakan dalam perencanaan konten dan kampanye.</p></div>';
}

function addLead() {
  const name = $('newLeadName').value.trim();
  if (!name) return toast('Nama lead harus diisi.');
  leads.push({ id: crypto.randomUUID(), name, contact: $('newLeadContact').value.trim(), source: $('newLeadSource').value, status: $('newLeadStatus').value });
  saveUserData('leads', leads);
  closeModal('leadModal'); $('newLeadName').value = ''; $('newLeadContact').value = '';
  renderLeads(); renderDashboard();
  toast('Lead berhasil disimpan.');
}

function renderLeads() {
  const query = ($('leadSearch')?.value || '').toLowerCase();
  const filtered = leads.filter((lead) => (lead.name + ' ' + lead.source + ' ' + lead.contact).toLowerCase().includes(query));
  $('leadTableBody').innerHTML = filtered.length ? filtered.map((lead) => {
    const phone = String(lead.contact || '').replace(/[^0-9]/g, '');
    const contactButton = phone.length >= 8 ? `<a class="btn outline small" href="https://wa.me/${phone}" target="_blank" rel="noopener">WhatsApp</a>` : '<span style="color:#98a39b">—</span>';
    return `<tr><td><div class="lead-person"><span class="lead-avatar">${escapeHTML(lead.name.slice(0, 1).toUpperCase())}</span>${escapeHTML(lead.name)}</div></td><td>${escapeHTML(lead.contact || '—')}</td><td>${escapeHTML(lead.source || '—')}</td><td><span class="pill ${lead.status === 'Baru' ? 'orange' : lead.status === 'Pelanggan' ? 'blue' : ''}">${escapeHTML(lead.status)}</span></td><td>${contactButton}</td></tr>`;
  }).join('') : '<tr><td colspan="5" style="text-align:center;color:#98a39b;padding:24px">Belum ada data prospek.</td></tr>';
  $('leadTotal').textContent = leads.length;
  $('leadNew').textContent = leads.filter((lead) => lead.status === 'Baru').length;
  $('leadFollowup').textContent = leads.filter((lead) => lead.status === 'Follow-up' || lead.status === 'Prospek').length;
  $('leadCustomers').textContent = leads.filter((lead) => lead.status === 'Pelanggan').length;
}

function addMetric() {
  const date = $('metricDate').value;
  if (!date) return toast('Tanggal laporan wajib diisi.');
  const fields = ['metricImpressions', 'metricReach', 'metricInteractions', 'metricClicks', 'metricConversions'];
  const values = {};
  for (const id of fields) {
    const raw = $(id).value.trim();
    const number = raw === '' ? 0 : Number(raw);
    if (!Number.isFinite(number) || number < 0) return toast('Semua metrik harus berupa angka nol atau lebih.');
    values[id.replace('metric', '').toLowerCase()] = number;
  }
  metrics.push({ id: crypto.randomUUID(), date, channel: $('metricChannel').value, ...values });
  saveUserData('metrics', metrics);
  closeModal('metricModal');
  fields.forEach((id) => { $(id).value = ''; });
  renderAnalytics(); renderDashboard();
  toast('Laporan performa berhasil disimpan.');
}

function renderAnalytics() {
  const latest = [...metrics].sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
  $('analyticsImpressions').textContent = latest ? formatNumber(latest.impressions) : '—';
  $('analyticsReach').textContent = latest ? formatNumber(latest.reach) : '—';
  $('analyticsInteractions').textContent = latest ? formatNumber(latest.interactions) : '—';
  $('analyticsConversions').textContent = latest ? formatNumber(latest.conversions) : '—';
  $('metricTableBody').innerHTML = metrics.length
    ? [...metrics].sort((a, b) => String(b.date).localeCompare(String(a.date))).map((item) => `<tr><td>${escapeHTML(item.date)}</td><td>${escapeHTML(item.channel)}</td><td>${formatNumber(item.impressions)}</td><td>${formatNumber(item.reach)}</td><td>${formatNumber(item.interactions)}</td><td>${formatNumber(item.clicks)}</td><td>${formatNumber(item.conversions)}</td></tr>`).join('')
    : '<tr><td colspan="7" style="text-align:center;color:#98a39b;padding:24px">Belum ada laporan. Klik “Input data performa” untuk menambahkan data.</td></tr>';
}

function socialProviderMeta(provider) {
  return {
    instagram: { label: 'Instagram', glyph: '◎', color: 'linear-gradient(140deg,#7d3bb8,#f14a72,#ffb45a)' },
    facebook: { label: 'Facebook', glyph: 'f', color: '#1877f2' },
    tiktok: { label: 'TikTok', glyph: '♪', color: '#111' }
  }[provider] || { label: provider, glyph: '•', color: '#59665e' };
}

async function connectSocial(provider) {
  if (!supabaseClient) return toast('Konfigurasi Supabase belum tersedia.');
  const button = $('connect-' + provider);
  if (button) { button.disabled = true; button.textContent = 'Menghubungkan...'; }
  try {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) throw new Error('Sesi masuk tidak ditemukan. Silakan masuk kembali.');
    const response = await fetch('/.netlify/functions/social-auth-start', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ provider })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Koneksi belum dapat dimulai.');
    window.location.assign(result.authorizationUrl);
  } catch (error) {
    toast(error.message || 'Koneksi media sosial belum berhasil.');
    if (button) { button.disabled = false; button.textContent = 'Hubungkan ' + socialProviderMeta(provider).label; }
  }
}

async function refreshSocialConnections() {
  if (!supabaseClient || !currentUser) return;
  try {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) return;
    const response = await fetch('/.netlify/functions/social-connections', {
      headers: { Authorization: `Bearer ${session.access_token}` }
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Status koneksi tidak dapat dimuat.');
    socialConnections = result.connections || [];
    const providers = ['instagram', 'facebook', 'tiktok'];
    for (const provider of providers) {
      const matches = socialConnections.filter((connection) => connection.provider === provider);
      const status = $('status-' + provider);
      const button = $('connect-' + provider);
      status.textContent = matches.length ? `${matches.length} akun terhubung` : 'Belum terhubung';
      status.classList.toggle('connected', matches.length > 0);
      if (button) button.textContent = matches.length ? 'Tambah / Hubungkan akun lain' : 'Hubungkan ' + socialProviderMeta(provider).label;
    }
    $('connectedAccounts').innerHTML = socialConnections.length ? socialConnections.map((connection) => {
      const meta = socialProviderMeta(connection.provider);
      return `<div class="social-connected-row"><div class="social-logo" style="background:${meta.color}">${meta.glyph}</div><div class="social-connected-info"><b>${escapeHTML(connection.account_name || meta.label)}</b><small>${meta.label}${connection.token_expires_at ? ' · token berlaku sampai ' + escapeHTML(new Date(connection.token_expires_at).toLocaleDateString('id-ID')) : ''}</small></div><button class="btn outline small" onclick="disconnectSocial('${escapeHTML(connection.id)}')">Hapus dari TumbuhAI</button></div>`;
    }).join('') : '<div class="activity-empty">Belum ada akun media sosial yang terhubung. Pilih salah satu kanal di atas untuk memulai.</div>';
    $('dashboardSocialSummary').innerHTML = socialConnections.length
      ? socialConnections.slice(0, 4).map((connection) => `<div class="activity-item"><div class="activity-mark">🔗</div><div><b>${escapeHTML(connection.account_name || socialProviderMeta(connection.provider).label)}</b><p>${escapeHTML(socialProviderMeta(connection.provider).label)} · Terhubung</p></div></div>`).join('')
      : '<div class="dashboard-empty">Belum ada akun yang terhubung.</div>';
  } catch (error) {
    $('connectedAccounts').innerHTML = `<div class="activity-empty">${escapeHTML(error.message)}</div>`;
  }
}

async function disconnectSocial(connectionId) {
  if (!confirm('Hapus token koneksi akun ini dari TumbuhAI? Untuk mencabut izin aplikasi sepenuhnya, lakukan juga dari pengaturan keamanan platform terkait.')) return;
  try {
    const { data: { session } } = await supabaseClient.auth.getSession();
    const response = await fetch('/.netlify/functions/social-connections', {
      method: 'DELETE', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ connectionId })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Koneksi tidak dapat diputuskan.');
    await refreshSocialConnections();
    toast('Data koneksi telah dihapus dari TumbuhAI.');
  } catch (error) { toast(error.message || 'Terjadi kesalahan.'); }
}

function syncShareDraft() {
  if (generatedText && $('socialShareText')) $('socialShareText').value = generatedText;
}

async function copyShareText() {
  const text = $('socialShareText').value.trim();
  if (!text) return toast('Tulis caption terlebih dahulu.');
  try { await navigator.clipboard.writeText(text); toast('Caption berhasil disalin.'); }
  catch { toast('Salin caption secara manual dari kotak teks.'); }
}

async function shareTo(channel) {
  const text = $('socialShareText').value.trim();
  if (!text) return toast('Tulis caption atau buat konten terlebih dahulu.');
  const pageUrl = ($('socialShareUrl')?.value || window.location.origin).trim();
  let parsedUrl;
  try {
    parsedUrl = new URL(pageUrl);
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error('URL harus menggunakan HTTP atau HTTPS.');
  } catch {
    return toast('Masukkan tautan tujuan yang valid (diawali https://).');
  }
  const safeUrl = parsedUrl.toString();
  const textWithUrl = safeUrl && !text.includes(safeUrl) ? `${text}\n${safeUrl}` : text;
  const encodedText = encodeURIComponent(textWithUrl);
  const encodedUrl = encodeURIComponent(safeUrl);
  const shareUrls = {
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`,
    x: `https://twitter.com/intent/tweet?text=${encodedText}`,
    linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}`,
    whatsapp: `https://wa.me/?text=${encodedText}`,
    pinterest: `https://pinterest.com/pin/create/button/?url=${encodedUrl}&description=${encodeURIComponent(text)}`
  };
  if (channel === 'instagram' || channel === 'tiktok') {
    try { await navigator.clipboard.writeText(textWithUrl); } catch { /* user can copy manually */ }
    window.open(channel === 'instagram' ? 'https://www.instagram.com/' : 'https://www.tiktok.com/upload', '_blank', 'noopener,noreferrer');
    toast(`Caption dan tautan disalin. Tempelkan di aplikasi ${channel === 'instagram' ? 'Instagram' : 'TikTok'} untuk melanjutkan.`);
    return;
  }
  if (!shareUrls[channel]) return toast('Kanal berbagi belum didukung.');
  window.open(shareUrls[channel], '_blank', 'noopener,noreferrer');
}

$('globalSearch')?.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  const query = event.target.value.toLowerCase();
  const map = [['ai', 'studio'], ['konten', 'calendar'], ['kalender', 'calendar'], ['brand', 'brand'], ['produk', 'catalog'], ['lead', 'leads'], ['kampanye', 'campaigns'], ['analytics', 'analytics'], ['analitik', 'analytics'], ['sosial', 'social'], ['media', 'social']];
  const match = map.find(([word]) => query.includes(word));
  if (match) navigate(match[1]); else toast('Coba kata kunci: AI, brand, kampanye, konten, produk, leads, analitik, atau sosial.');
});

boot();
