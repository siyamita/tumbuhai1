-- TumbuhAI production schema (Supabase PostgreSQL)
-- Jalankan seluruh file ini di Supabase Dashboard > SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  display_name text not null default 'Pengguna',
  email text not null unique,
  created_at timestamptz not null default now(),
  constraint username_format check (username ~ '^[a-z0-9_]{3,20}$')
);

create or replace function public.handle_new_tumbuhai_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  raw_username text;
  raw_display_name text;
begin
  raw_username := lower(coalesce(new.raw_user_meta_data->>'username', ''));
  raw_display_name := coalesce(new.raw_user_meta_data->>'display_name', new.raw_user_meta_data->>'full_name', 'Pengguna');
  if raw_username !~ '^[a-z0-9_]{3,20}$' then
    raise exception 'Username tidak valid. Gunakan 3-20 karakter: huruf kecil, angka, atau garis bawah.';
  end if;
  insert into public.user_profiles (id, username, display_name, email)
  values (new.id, raw_username, raw_display_name, new.email);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_tumbuhai on auth.users;
create trigger on_auth_user_created_tumbuhai
after insert on auth.users
for each row execute procedure public.handle_new_tumbuhai_user();

alter table public.user_profiles enable row level security;
drop policy if exists "Users can read their own profile" on public.user_profiles;
create policy "Users can read their own profile"
on public.user_profiles for select
to authenticated using (auth.uid() = id);

create table if not exists public.workspaces (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.workspaces enable row level security;
drop policy if exists "Users can read own workspace" on public.workspaces;
create policy "Users can read own workspace"
on public.workspaces for select to authenticated using (auth.uid() = user_id);
drop policy if exists "Users can insert own workspace" on public.workspaces;
create policy "Users can insert own workspace"
on public.workspaces for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "Users can update own workspace" on public.workspaces;
create policy "Users can update own workspace"
on public.workspaces for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Tokens OAuth hanya boleh dibaca/ditulis oleh Netlify Functions menggunakan service-role key.
create table if not exists public.social_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('instagram', 'facebook', 'tiktok')),
  external_account_id text not null,
  account_name text not null,
  token_ciphertext text not null,
  token_iv text not null,
  token_auth_tag text not null,
  token_expires_at timestamptz,
  scopes text[] not null default '{}',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider, external_account_id)
);

alter table public.social_connections enable row level security;
-- Tidak ada policy untuk anon/authenticated: token tidak boleh diakses langsung dari browser.

create table if not exists public.social_oauth_states (
  state_hash text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('instagram', 'facebook', 'tiktok')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

alter table public.social_oauth_states enable row level security;
-- OAuth state hanya dikelola server-side oleh Netlify Functions.

-- Jadwalkan pembersihan state OAuth yang kedaluwarsa sesuai kebutuhan operasional.
