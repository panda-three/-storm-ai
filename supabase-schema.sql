create table if not exists public.user_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text,
  credit_balance integer not null default 0,
  membership_tier text check (membership_tier in ('vip', 'svip')),
  membership_expires_at timestamptz,
  membership_free_image_qualities jsonb not null default '[]'::jsonb,
  projects jsonb not null default '[]'::jsonb,
  ledger jsonb not null default '[]'::jsonb,
  redeemed_codes jsonb not null default '[]'::jsonb,
  role text not null default 'user' check (role in ('user', 'admin')),
  must_change_password boolean not null default false,
  temporary_password_set_at timestamptz,
  temporary_password_set_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_accounts add column if not exists role text not null default 'user';
alter table public.user_accounts add column if not exists username text;
alter table public.user_accounts add column if not exists must_change_password boolean not null default false;
alter table public.user_accounts add column if not exists temporary_password_set_at timestamptz;
alter table public.user_accounts add column if not exists temporary_password_set_by uuid references auth.users(id) on delete set null;
alter table public.user_accounts add column if not exists membership_tier text;
alter table public.user_accounts add column if not exists membership_expires_at timestamptz;
alter table public.user_accounts add column if not exists membership_free_image_qualities jsonb not null default '[]'::jsonb;
alter table public.user_accounts alter column credit_balance set default 0;
alter table public.user_accounts drop constraint if exists user_accounts_role_check;
alter table public.user_accounts add constraint user_accounts_role_check check (role in ('user', 'admin')) not valid;
alter table public.user_accounts drop constraint if exists user_accounts_membership_tier_check;
alter table public.user_accounts add constraint user_accounts_membership_tier_check check (membership_tier is null or membership_tier in ('vip', 'svip')) not valid;
alter table public.user_accounts drop constraint if exists user_accounts_membership_free_image_qualities_check;
alter table public.user_accounts add constraint user_accounts_membership_free_image_qualities_check check (jsonb_typeof(membership_free_image_qualities) = 'array') not valid;
alter table public.user_accounts drop constraint if exists user_accounts_username_format_check;
alter table public.user_accounts add constraint user_accounts_username_format_check check (username is null or username ~ '^[A-Za-z0-9_]{3,24}$') not valid;

create unique index if not exists user_accounts_username_unique_idx on public.user_accounts (lower(username)) where username is not null;

create table if not exists public.user_active_sessions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  session_id text not null,
  device_label text not null default '未知设备',
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_reason text,
  revoked_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.user_active_sessions add column if not exists session_id text;
alter table public.user_active_sessions add column if not exists device_label text not null default '未知设备';
alter table public.user_active_sessions add column if not exists created_at timestamptz not null default now();
alter table public.user_active_sessions add column if not exists last_seen_at timestamptz not null default now();
alter table public.user_active_sessions add column if not exists revoked_at timestamptz;
alter table public.user_active_sessions add column if not exists revoked_reason text;
alter table public.user_active_sessions add column if not exists revoked_by uuid references auth.users(id) on delete set null;
alter table public.user_active_sessions add column if not exists updated_at timestamptz not null default now();

create index if not exists user_active_sessions_session_id_idx on public.user_active_sessions (session_id);

create or replace function public.current_auth_session_id()
returns text
language sql
stable
as $$
  select nullif(auth.jwt() ->> 'session_id', '');
$$;

create or replace function public.is_current_active_session()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_active_sessions
    where user_id = auth.uid()
      and session_id = public.current_auth_session_id()
      and revoked_at is null
  );
$$;

create or replace function public.assert_current_active_session()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or public.current_auth_session_id() is null then
    raise exception '请先登录后再继续。';
  end if;

  if not public.is_current_active_session() then
    raise exception '该账号已在其他设备登录或已被解除登录占用，请重新登录。';
  end if;
end;
$$;

create or replace function public.claim_current_auth_session(p_device_label text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_session_id text := public.current_auth_session_id();
  v_device_label text := left(coalesce(nullif(trim(p_device_label), ''), '未知设备'), 160);
  v_existing public.user_active_sessions%rowtype;
begin
  if v_user_id is null or v_session_id is null then
    raise exception '请先登录后再继续。';
  end if;

  select *
  into v_existing
  from public.user_active_sessions
  where user_id = v_user_id
  for update;

  if not found then
    insert into public.user_active_sessions (
      user_id,
      session_id,
      device_label,
      created_at,
      last_seen_at,
      updated_at
    )
    values (
      v_user_id,
      v_session_id,
      v_device_label,
      now(),
      now(),
      now()
    );

    return jsonb_build_object('ok', true, 'claimed', true);
  end if;

  if v_existing.session_id = v_session_id and v_existing.revoked_at is null then
    update public.user_active_sessions
    set
      device_label = v_device_label,
      last_seen_at = now(),
      updated_at = now()
    where user_id = v_user_id;

    return jsonb_build_object('ok', true, 'claimed', false);
  end if;

  if v_existing.revoked_at is not null then
    if v_existing.session_id = v_session_id then
      raise exception '该登录会话已失效，请重新登录。';
    end if;

    update public.user_active_sessions
    set
      session_id = v_session_id,
      device_label = v_device_label,
      created_at = now(),
      last_seen_at = now(),
      revoked_at = null,
      revoked_reason = null,
      revoked_by = null,
      updated_at = now()
    where user_id = v_user_id;

    return jsonb_build_object('ok', true, 'claimed', true);
  end if;

  raise exception '该账号已在其他设备登录，请先在原设备退出或联系管理员。';
end;
$$;

create or replace function public.release_current_auth_session()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_session_id text := public.current_auth_session_id();
begin
  if v_user_id is null or v_session_id is null then
    return jsonb_build_object('ok', true, 'released', false);
  end if;

  update public.user_active_sessions
  set
    revoked_at = now(),
    revoked_reason = 'user_signed_out',
    revoked_by = v_user_id,
    updated_at = now()
  where user_id = v_user_id
    and session_id = v_session_id
    and revoked_at is null;

  return jsonb_build_object('ok', true, 'released', found);
end;
$$;

create or replace function public.admin_revoke_active_session(
  p_user_id uuid,
  p_reason text default 'admin_revoked'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_reason text := left(coalesce(nullif(trim(p_reason), ''), 'admin_revoked'), 160);
begin
  if not public.is_admin() then
    raise exception '无管理员权限。';
  end if;

  if p_user_id is null then
    raise exception '缺少用户 ID。';
  end if;

  update public.user_active_sessions
  set
    revoked_at = now(),
    revoked_reason = v_reason,
    revoked_by = v_actor,
    updated_at = now()
  where user_id = p_user_id
    and revoked_at is null;

  return jsonb_build_object('ok', true, 'revoked', found);
end;
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_accounts
    where user_id = auth.uid()
      and role = 'admin'
  ) and public.is_current_active_session();
$$;

create or replace function public.is_username_available(p_username text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select trim(coalesce(p_username, '')) ~ '^[A-Za-z0-9_]{3,24}$'
    and not exists (
      select 1
      from public.user_accounts
      where lower(username) = lower(trim(p_username))
    );
$$;

create or replace function public.create_account_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_username text := trim(coalesce(new.raw_user_meta_data->>'username', ''));
begin
  if v_username !~ '^[A-Za-z0-9_]{3,24}$' then
    raise exception '用户名需为 3-24 位字母、数字或下划线。';
  end if;

  insert into public.user_accounts (user_id, username, credit_balance)
  values (new.id, v_username, 0);

  return new;
exception
  when unique_violation then
    raise exception '该用户名已被使用，请换一个。';
end;
$$;

drop trigger if exists create_account_for_new_user on auth.users;
create trigger create_account_for_new_user
after insert on auth.users
for each row execute function public.create_account_for_new_user();

create table if not exists public.credit_packages (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  package_type text not null default 'credits' check (package_type in ('credits', 'membership')),
  price_cny numeric(10, 2) not null check (price_cny >= 0),
  credits integer not null check (credits >= 0),
  membership_tier text check (membership_tier in ('vip', 'svip')),
  membership_duration_days integer check (membership_duration_days is null or membership_duration_days > 0),
  membership_free_image_qualities jsonb not null default '[]'::jsonb,
  enabled boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.credit_packages add column if not exists package_type text not null default 'credits';
alter table public.credit_packages add column if not exists membership_tier text;
alter table public.credit_packages add column if not exists membership_duration_days integer;
alter table public.credit_packages add column if not exists membership_free_image_qualities jsonb not null default '[]'::jsonb;
alter table public.credit_packages drop constraint if exists credit_packages_credits_check;
alter table public.credit_packages add constraint credit_packages_credits_check check (credits >= 0) not valid;
alter table public.credit_packages drop constraint if exists credit_packages_package_type_check;
alter table public.credit_packages add constraint credit_packages_package_type_check check (package_type in ('credits', 'membership')) not valid;
alter table public.credit_packages drop constraint if exists credit_packages_membership_tier_check;
alter table public.credit_packages add constraint credit_packages_membership_tier_check check (membership_tier is null or membership_tier in ('vip', 'svip')) not valid;
alter table public.credit_packages drop constraint if exists credit_packages_membership_duration_days_check;
alter table public.credit_packages add constraint credit_packages_membership_duration_days_check check (membership_duration_days is null or membership_duration_days > 0) not valid;
alter table public.credit_packages drop constraint if exists credit_packages_membership_free_image_qualities_check;
alter table public.credit_packages add constraint credit_packages_membership_free_image_qualities_check check (jsonb_typeof(membership_free_image_qualities) = 'array') not valid;
alter table public.credit_packages drop constraint if exists credit_packages_package_shape_check;
alter table public.credit_packages add constraint credit_packages_package_shape_check check (
  (
    package_type = 'credits'
    and credits > 0
    and membership_tier is null
    and membership_duration_days is null
    and membership_free_image_qualities = '[]'::jsonb
  )
  or (
    package_type = 'membership'
    and credits = 0
    and membership_tier in ('vip', 'svip')
    and membership_duration_days > 0
    and jsonb_array_length(membership_free_image_qualities) > 0
  )
) not valid;

create table if not exists public.redeem_codes (
  code text primary key,
  package_id uuid references public.credit_packages(id) on delete set null,
  package_type text not null default 'credits' check (package_type in ('credits', 'membership')),
  credits integer not null check (credits >= 0),
  membership_tier text check (membership_tier in ('vip', 'svip')),
  membership_duration_days integer check (membership_duration_days is null or membership_duration_days > 0),
  membership_free_image_qualities jsonb not null default '[]'::jsonb,
  price_cny numeric(10, 2) not null default 0 check (price_cny >= 0),
  status text not null default 'unused' check (status in ('unused', 'used', 'disabled')),
  used_by uuid references auth.users(id) on delete set null,
  used_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.redeem_codes add column if not exists package_type text not null default 'credits';
alter table public.redeem_codes add column if not exists membership_tier text;
alter table public.redeem_codes add column if not exists membership_duration_days integer;
alter table public.redeem_codes add column if not exists membership_free_image_qualities jsonb not null default '[]'::jsonb;
alter table public.redeem_codes drop constraint if exists redeem_codes_credits_check;
alter table public.redeem_codes add constraint redeem_codes_credits_check check (credits >= 0) not valid;
alter table public.redeem_codes drop constraint if exists redeem_codes_package_type_check;
alter table public.redeem_codes add constraint redeem_codes_package_type_check check (package_type in ('credits', 'membership')) not valid;
alter table public.redeem_codes drop constraint if exists redeem_codes_membership_tier_check;
alter table public.redeem_codes add constraint redeem_codes_membership_tier_check check (membership_tier is null or membership_tier in ('vip', 'svip')) not valid;
alter table public.redeem_codes drop constraint if exists redeem_codes_membership_duration_days_check;
alter table public.redeem_codes add constraint redeem_codes_membership_duration_days_check check (membership_duration_days is null or membership_duration_days > 0) not valid;
alter table public.redeem_codes drop constraint if exists redeem_codes_membership_free_image_qualities_check;
alter table public.redeem_codes add constraint redeem_codes_membership_free_image_qualities_check check (jsonb_typeof(membership_free_image_qualities) = 'array') not valid;
alter table public.redeem_codes drop constraint if exists redeem_codes_package_shape_check;
alter table public.redeem_codes add constraint redeem_codes_package_shape_check check (
  (
    package_type = 'credits'
    and credits > 0
    and membership_tier is null
    and membership_duration_days is null
    and membership_free_image_qualities = '[]'::jsonb
  )
  or (
    package_type = 'membership'
    and credits = 0
    and membership_tier in ('vip', 'svip')
    and membership_duration_days > 0
    and jsonb_array_length(membership_free_image_qualities) > 0
  )
) not valid;

create index if not exists redeem_codes_status_idx on public.redeem_codes (status);
create index if not exists redeem_codes_used_by_idx on public.redeem_codes (used_by);

create table if not exists public.account_security_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  event_type text not null check (event_type in ('temporary_password_set', 'password_changed')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists account_security_events_user_id_idx on public.account_security_events (user_id, created_at desc);
create index if not exists account_security_events_actor_user_id_idx on public.account_security_events (actor_user_id, created_at desc);

create table if not exists public.model_pricing (
  id uuid primary key default gen_random_uuid(),
  model text not null,
  type text not null check (type in ('image', 'video')),
  quality text,
  duration_seconds integer,
  aspect_ratio text,
  cost_cny numeric(10, 4) not null check (cost_cny >= 0),
  markup numeric(8, 4) not null default 2 check (markup > 0),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (model, type, quality, duration_seconds, aspect_ratio)
);

create table if not exists public.generation_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('image', 'video')),
  provider text not null,
  model text not null,
  prompt text not null,
  amount integer not null check (amount >= 0),
  client_request_id text,
  expected_result_count integer not null default 1 check (expected_result_count between 1 and 4),
  expires_at timestamptz,
  quality text,
  aspect_ratio text,
  duration_seconds integer,
  reference text not null unique,
  status text not null default 'submitted' check (status in ('submitted', 'processing', 'completed', 'failed', 'partial_completed')),
  upstream_task_id text,
  result_urls jsonb not null default '[]'::jsonb,
  storage_urls jsonb not null default '[]'::jsonb,
  task_error text,
  last_checked_at timestamptz,
  next_check_at timestamptz not null default now(),
  check_attempts integer not null default 0,
  last_sync_error text,
  sync_locked_until timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.generation_jobs add column if not exists last_checked_at timestamptz;
alter table public.generation_jobs add column if not exists next_check_at timestamptz not null default now();
alter table public.generation_jobs add column if not exists check_attempts integer not null default 0;
alter table public.generation_jobs add column if not exists last_sync_error text;
alter table public.generation_jobs add column if not exists sync_locked_until timestamptz;
alter table public.generation_jobs add column if not exists completed_at timestamptz;
alter table public.generation_jobs add column if not exists client_request_id text;
alter table public.generation_jobs add column if not exists expected_result_count integer not null default 1;
alter table public.generation_jobs add column if not exists expires_at timestamptz;
alter table public.generation_jobs add column if not exists quality text;
alter table public.generation_jobs add column if not exists aspect_ratio text;
alter table public.generation_jobs add column if not exists duration_seconds integer;
alter table public.generation_jobs add column if not exists storage_urls jsonb not null default '[]'::jsonb;
alter table public.generation_jobs drop constraint if exists generation_jobs_status_check;
alter table public.generation_jobs add constraint generation_jobs_status_check check (status in ('submitted', 'processing', 'completed', 'failed', 'partial_completed')) not valid;
alter table public.generation_jobs drop constraint if exists generation_jobs_expected_result_count_check;
alter table public.generation_jobs add constraint generation_jobs_expected_result_count_check check (expected_result_count between 1 and 4) not valid;
alter table public.generation_jobs drop constraint if exists generation_jobs_storage_urls_check;
alter table public.generation_jobs add constraint generation_jobs_storage_urls_check check (jsonb_typeof(storage_urls) = 'array') not valid;

update public.generation_jobs
set expires_at = coalesce(completed_at, created_at) + interval '24 hours'
where expires_at is null
  and status in ('completed', 'failed', 'partial_completed');

update public.generation_jobs as job
set
  quality = coalesce(job.quality, parsed.quality),
  aspect_ratio = coalesce(job.aspect_ratio, parsed.aspect_ratio),
  duration_seconds = coalesce(job.duration_seconds, parsed.duration_seconds)
from (
  select
    generation_jobs.id,
    case when generation_jobs.type = 'image' then nullif(trim(parts.items[3]), '') else nullif(trim(parts.items[4]), '') end as quality,
    case when generation_jobs.type = 'video' then nullif(trim(parts.items[5]), '') else null end as aspect_ratio,
    case when generation_jobs.type = 'video' then nullif(regexp_replace(parts.items[3], '\D', '', 'g'), '')::integer else null end as duration_seconds
  from public.generation_jobs
  join public.user_accounts on user_accounts.user_id = generation_jobs.user_id
  cross join lateral (
    select regexp_split_to_array(ledger_item->>'code', '\s*·\s*') as items
    from jsonb_array_elements(user_accounts.ledger) as ledger_item
    where ledger_item->>'id' = generation_jobs.reference
    limit 1
  ) as parts
  where generation_jobs.quality is null
     or generation_jobs.aspect_ratio is null
     or generation_jobs.duration_seconds is null
) as parsed
where parsed.id = job.id;

create index if not exists generation_jobs_user_id_idx on public.generation_jobs (user_id, created_at desc);
create index if not exists generation_jobs_upstream_task_id_idx on public.generation_jobs (upstream_task_id);
create unique index if not exists generation_jobs_user_client_request_id_unique_idx
on public.generation_jobs (user_id, client_request_id)
where client_request_id is not null;
create index if not exists generation_jobs_expires_at_idx on public.generation_jobs (expires_at)
where status in ('completed', 'failed', 'partial_completed');
create index if not exists generation_jobs_sync_due_idx
on public.generation_jobs (next_check_at, created_at)
where provider = 'apimart'
  and status in ('submitted', 'processing')
  and upstream_task_id is not null;

create table if not exists public.site_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.credit_packages (name, price_cny, credits, sort_order)
values
  ('体验包', 9.90, 990, 10),
  ('标准包', 39.00, 3900, 20),
  ('专业包', 99.00, 9900, 30)
on conflict do nothing;

insert into public.credit_packages (
  name,
  package_type,
  price_cny,
  credits,
  membership_tier,
  membership_duration_days,
  membership_free_image_qualities,
  sort_order
)
select 'VIP199', 'membership', 199.00, 0, 'vip', 365, '["1K", "2K"]'::jsonb, 40
where not exists (
  select 1 from public.credit_packages where name = 'VIP199'
);

insert into public.credit_packages (
  name,
  package_type,
  price_cny,
  credits,
  membership_tier,
  membership_duration_days,
  membership_free_image_qualities,
  sort_order
)
select 'SVIP499', 'membership', 499.00, 0, 'svip', 365, '["1K", "2K", "4K"]'::jsonb, 50
where not exists (
  select 1 from public.credit_packages where name = 'SVIP499'
);

insert into public.site_settings (key, value)
values (
  'customer_service',
  jsonb_build_object(
    'wechatId', '',
    'qrCodeUrl', '',
    'description', '联系客服购买兑换码后，在站内输入兑换码完成点数充值。'
  )
)
on conflict (key) do nothing;

alter table public.user_accounts enable row level security;
alter table public.credit_packages enable row level security;
alter table public.redeem_codes enable row level security;
alter table public.account_security_events enable row level security;
alter table public.model_pricing enable row level security;
alter table public.generation_jobs enable row level security;
alter table public.site_settings enable row level security;
alter table public.user_active_sessions enable row level security;

drop policy if exists "Users can read own active session" on public.user_active_sessions;
create policy "Users can read own active session"
on public.user_active_sessions
for select
to authenticated
using (auth.uid() = user_id or public.is_admin());

drop policy if exists "Admins can manage active sessions" on public.user_active_sessions;
create policy "Admins can manage active sessions"
on public.user_active_sessions
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "Users can read own account" on public.user_accounts;
create policy "Users can read own account"
on public.user_accounts
for select
to authenticated
using ((auth.uid() = user_id and public.is_current_active_session()) or public.is_admin());

drop policy if exists "Users can insert own account" on public.user_accounts;
drop policy if exists "Admins can insert accounts" on public.user_accounts;
create policy "Admins can insert accounts"
on public.user_accounts
for insert
to authenticated
with check (public.is_admin());

drop policy if exists "Users can update own account" on public.user_accounts;
drop policy if exists "Admins can update accounts" on public.user_accounts;
create policy "Admins can update accounts"
on public.user_accounts
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "Authenticated users can read enabled packages" on public.credit_packages;
create policy "Authenticated users can read enabled packages"
on public.credit_packages
for select
to authenticated
using ((enabled = true and public.is_current_active_session()) or public.is_admin());

drop policy if exists "Admins can manage packages" on public.credit_packages;
create policy "Admins can manage packages"
on public.credit_packages
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "Users can read own used redeem codes" on public.redeem_codes;
create policy "Users can read own used redeem codes"
on public.redeem_codes
for select
to authenticated
using ((used_by = auth.uid() and public.is_current_active_session()) or public.is_admin());

drop policy if exists "Admins can manage redeem codes" on public.redeem_codes;
create policy "Admins can manage redeem codes"
on public.redeem_codes
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "Users can read own security events" on public.account_security_events;
create policy "Users can read own security events"
on public.account_security_events
for select
to authenticated
using ((auth.uid() = user_id and public.is_current_active_session()) or public.is_admin());

drop policy if exists "Admins can insert security events" on public.account_security_events;
create policy "Admins can insert security events"
on public.account_security_events
for insert
to authenticated
with check (public.is_admin());

drop policy if exists "Authenticated users can read enabled model pricing" on public.model_pricing;
create policy "Authenticated users can read enabled model pricing"
on public.model_pricing
for select
to authenticated
using ((enabled = true and public.is_current_active_session()) or public.is_admin());

drop policy if exists "Admins can manage model pricing" on public.model_pricing;
create policy "Admins can manage model pricing"
on public.model_pricing
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "Users can read own generation jobs" on public.generation_jobs;
create policy "Users can read own generation jobs"
on public.generation_jobs
for select
to authenticated
using ((auth.uid() = user_id and public.is_current_active_session()) or public.is_admin());

drop policy if exists "Admins can manage generation jobs" on public.generation_jobs;
create policy "Admins can manage generation jobs"
on public.generation_jobs
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "Authenticated users can read site settings" on public.site_settings;
create policy "Authenticated users can read site settings"
on public.site_settings
for select
to authenticated
using (public.is_current_active_session());

drop policy if exists "Admins can manage site settings" on public.site_settings;
create policy "Admins can manage site settings"
on public.site_settings
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create or replace function public.redeem_credit_code(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_code text := upper(trim(p_code));
  v_redeem public.redeem_codes%rowtype;
  v_current_expires_at timestamptz;
  v_current_tier text;
  v_expires_at timestamptz;
  v_ledger jsonb;
  v_balance integer;
begin
  if v_user_id is null then
    raise exception '请先登录后再兑换。';
  end if;

  perform public.assert_current_active_session();

  if v_code = '' then
    raise exception '请输入兑换码。';
  end if;

  select *
  into v_redeem
  from public.redeem_codes
  where code = v_code
  for update;

  if not found then
    raise exception '兑换码无效，请检查后重试。';
  end if;

  if v_redeem.status = 'disabled' then
    raise exception '该兑换码已被禁用。';
  end if;

  if v_redeem.status = 'used' then
    raise exception '该兑换码已被使用。';
  end if;

  if v_redeem.package_type = 'membership' then
    if v_redeem.membership_tier is null or v_redeem.membership_duration_days is null then
      raise exception '会员兑换码配置不完整，请联系管理员。';
    end if;

    if jsonb_typeof(coalesce(v_redeem.membership_free_image_qualities, '[]'::jsonb)) <> 'array' then
      raise exception '会员权益配置不正确，请联系管理员。';
    end if;
  end if;

  insert into public.user_accounts (user_id)
  values (v_user_id)
  on conflict (user_id) do nothing;

  if v_redeem.package_type = 'membership' then
    select membership_tier, membership_expires_at
    into v_current_tier, v_current_expires_at
    from public.user_accounts
    where user_id = v_user_id
    for update;

    if v_current_tier = 'svip'
      and v_current_expires_at > now()
      and v_redeem.membership_tier = 'vip'
    then
      raise exception '当前 SVIP 仍在有效期内，不能兑换低等级 VIP。';
    end if;

    v_expires_at := greatest(coalesce(v_current_expires_at, now()), now())
      + (v_redeem.membership_duration_days * interval '1 day');

    v_ledger := jsonb_build_object(
      'id', 'ledger_' || extract(epoch from now())::bigint || '_' || v_code,
      'type', 'redeem',
      'code', v_code,
      'amount', 0,
      'createdAt', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    );

    update public.redeem_codes
    set
      status = 'used',
      used_by = v_user_id,
      used_at = now(),
      updated_at = now()
    where code = v_code;

    update public.user_accounts
    set
      membership_tier = v_redeem.membership_tier,
      membership_expires_at = v_expires_at,
      membership_free_image_qualities = v_redeem.membership_free_image_qualities,
      redeemed_codes = to_jsonb(v_code) || redeemed_codes,
      ledger = v_ledger || ledger,
      updated_at = now()
    where user_id = v_user_id
    returning credit_balance into v_balance;

    return jsonb_build_object(
      'code', v_code,
      'credits', 0,
      'credit_balance', v_balance,
      'membership_tier', v_redeem.membership_tier,
      'membership_expires_at', v_expires_at,
      'membership_free_image_qualities', v_redeem.membership_free_image_qualities
    );
  end if;

  v_ledger := jsonb_build_object(
    'id', 'ledger_' || extract(epoch from now())::bigint || '_' || v_code,
    'type', 'redeem',
    'code', v_code,
    'amount', v_redeem.credits,
    'createdAt', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  );

  update public.redeem_codes
  set
    status = 'used',
    used_by = v_user_id,
    used_at = now(),
    updated_at = now()
  where code = v_code;

  update public.user_accounts
  set
    credit_balance = credit_balance + v_redeem.credits,
    redeemed_codes = to_jsonb(v_code) || redeemed_codes,
    ledger = v_ledger || ledger,
    updated_at = now()
  where user_id = v_user_id
  returning credit_balance into v_balance;

  return jsonb_build_object(
    'code', v_code,
    'credits', v_redeem.credits,
    'credit_balance', v_balance
  );
end;
$$;

create or replace function public.save_user_projects(p_projects jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_existing_projects jsonb := '[]'::jsonb;
  v_project jsonb;
  v_projects jsonb;
  v_incoming_ids text[];
begin
  if v_user_id is null then
    raise exception '请先登录后再保存历史项目。';
  end if;

  perform public.assert_current_active_session();

  if jsonb_typeof(coalesce(p_projects, '[]'::jsonb)) <> 'array' then
    raise exception '历史项目格式不正确。';
  end if;

  insert into public.user_accounts (user_id)
  values (v_user_id)
  on conflict (user_id) do nothing;

  select projects
  into v_existing_projects
  from public.user_accounts
  where user_id = v_user_id
  for update;

  select coalesce(array_agg(key), array[]::text[])
  into v_incoming_ids
  from jsonb_array_elements(coalesce(p_projects, '[]'::jsonb)) as project(value)
  cross join lateral (
    values (value->>'id'), (value->>'taskId')
  ) as keys(key)
  where key is not null and key <> '';

  select coalesce(jsonb_agg(value), '[]'::jsonb)
  into v_projects
  from jsonb_array_elements(coalesce(v_existing_projects, '[]'::jsonb))
  where not (
    value->>'id' = any(v_incoming_ids)
    or coalesce(value->>'taskId', '') = any(v_incoming_ids)
  );

  for v_project in select value from jsonb_array_elements(coalesce(p_projects, '[]'::jsonb))
  loop
    v_projects := v_projects || jsonb_build_array(v_project);
  end loop;

  insert into public.user_accounts (user_id, projects)
  values (v_user_id, v_projects)
  on conflict (user_id) do update
  set
    projects = excluded.projects,
    updated_at = now();

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.spend_credits(
  p_amount integer,
  p_reason text,
  p_reference text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_reference text := trim(p_reference);
  v_ledger jsonb;
  v_balance integer;
begin
  if v_user_id is null then
    raise exception '请先登录后再生成。';
  end if;

  perform public.assert_current_active_session();

  if p_amount <= 0 then
    raise exception '扣费点数必须大于 0。';
  end if;

  if v_reference = '' then
    raise exception '缺少扣费流水号。';
  end if;

  insert into public.user_accounts (user_id)
  values (v_user_id)
  on conflict (user_id) do nothing;

  perform 1
  from public.user_accounts
  where user_id = v_user_id
    and credit_balance >= p_amount
  for update;

  if not found then
    raise exception '点数余额不足，请先充值。';
  end if;

  v_ledger := jsonb_build_object(
    'id', v_reference,
    'type', 'generate',
    'code', coalesce(p_reason, 'AI 生成扣费'),
    'amount', -p_amount,
    'createdAt', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  );

  update public.user_accounts
  set
    credit_balance = credit_balance - p_amount,
    ledger = v_ledger || ledger,
    updated_at = now()
  where user_id = v_user_id
  returning credit_balance into v_balance;

  return jsonb_build_object(
    'amount', p_amount,
    'credit_balance', v_balance,
    'reference', v_reference
  );
end;
$$;

create or replace function public.refund_credits(
  p_amount integer,
  p_reason text,
  p_reference text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_reference text := trim(p_reference);
  v_refund_id text := v_reference || '_refund';
  v_ledger jsonb;
  v_balance integer;
begin
  if v_user_id is null then
    raise exception '请先登录后再退款。';
  end if;

  perform public.assert_current_active_session();

  if p_amount <= 0 then
    raise exception '退款点数必须大于 0。';
  end if;

  if v_reference = '' then
    raise exception '缺少退款流水号。';
  end if;

  insert into public.user_accounts (user_id)
  values (v_user_id)
  on conflict (user_id) do nothing;

  perform 1
  from public.user_accounts
  where user_id = v_user_id
    and ledger @> jsonb_build_array(jsonb_build_object('id', v_refund_id))
  for update;

  if found then
    select credit_balance
    into v_balance
    from public.user_accounts
    where user_id = v_user_id;

    return jsonb_build_object(
      'amount', 0,
      'credit_balance', v_balance,
      'reference', v_refund_id,
      'already_refunded', true
    );
  end if;

  v_ledger := jsonb_build_object(
    'id', v_refund_id,
    'type', 'refund',
    'code', coalesce(p_reason, 'AI 生成失败退款'),
    'amount', p_amount,
    'createdAt', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  );

  update public.user_accounts
  set
    credit_balance = credit_balance + p_amount,
    ledger = v_ledger || ledger,
    updated_at = now()
  where user_id = v_user_id
  returning credit_balance into v_balance;

  return jsonb_build_object(
    'amount', p_amount,
    'credit_balance', v_balance,
    'reference', v_refund_id,
    'already_refunded', false
  );
end;
$$;

create or replace function public.spend_generation_credits(
  p_user_id uuid,
  p_amount integer,
  p_reason text,
  p_reference text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reference text := trim(p_reference);
  v_ledger jsonb;
  v_balance integer;
begin
  if p_user_id is null then
    raise exception '缺少用户 ID。';
  end if;

  if p_amount <= 0 then
    raise exception '扣费点数必须大于 0。';
  end if;

  if v_reference = '' then
    raise exception '缺少扣费流水号。';
  end if;

  insert into public.user_accounts (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  perform 1
  from public.user_accounts
  where user_id = p_user_id
    and credit_balance >= p_amount
  for update;

  if not found then
    raise exception '点数余额不足，请先充值。';
  end if;

  v_ledger := jsonb_build_object(
    'id', v_reference,
    'type', 'generate',
    'code', coalesce(p_reason, 'AI 生成扣费'),
    'amount', -p_amount,
    'createdAt', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  );

  update public.user_accounts
  set
    credit_balance = credit_balance - p_amount,
    ledger = v_ledger || ledger,
    updated_at = now()
  where user_id = p_user_id
  returning credit_balance into v_balance;

  return jsonb_build_object(
    'amount', p_amount,
    'credit_balance', v_balance,
    'reference', v_reference
  );
end;
$$;

create or replace function public.record_free_generation_usage(
  p_user_id uuid,
  p_reason text,
  p_reference text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reference text := trim(p_reference);
  v_ledger jsonb;
  v_balance integer;
begin
  if p_user_id is null then
    raise exception '缺少用户 ID。';
  end if;

  if v_reference = '' then
    raise exception '缺少会员免费流水号。';
  end if;

  insert into public.user_accounts (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  v_ledger := jsonb_build_object(
    'id', v_reference,
    'type', 'generate',
    'code', coalesce(p_reason, 'AI 生成会员免费'),
    'amount', 0,
    'createdAt', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  );

  update public.user_accounts
  set
    ledger = v_ledger || ledger,
    updated_at = now()
  where user_id = p_user_id
  returning credit_balance into v_balance;

  return jsonb_build_object(
    'amount', 0,
    'credit_balance', v_balance,
    'reference', v_reference
  );
end;
$$;

create or replace function public.refund_generation_credits(
  p_user_id uuid,
  p_amount integer,
  p_reason text,
  p_reference text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reference text := trim(p_reference);
  v_refund_id text := v_reference || '_refund';
  v_ledger jsonb;
  v_balance integer;
begin
  if p_user_id is null then
    raise exception '缺少用户 ID。';
  end if;

  if p_amount <= 0 then
    raise exception '退款点数必须大于 0。';
  end if;

  if v_reference = '' then
    raise exception '缺少退款流水号。';
  end if;

  insert into public.user_accounts (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  perform 1
  from public.user_accounts
  where user_id = p_user_id
    and ledger @> jsonb_build_array(jsonb_build_object('id', v_refund_id))
  for update;

  if found then
    select credit_balance
    into v_balance
    from public.user_accounts
    where user_id = p_user_id;

    return jsonb_build_object(
      'amount', 0,
      'credit_balance', v_balance,
      'reference', v_refund_id,
      'already_refunded', true
    );
  end if;

  v_ledger := jsonb_build_object(
    'id', v_refund_id,
    'type', 'refund',
    'code', coalesce(p_reason, 'AI 生成失败退款'),
    'amount', p_amount,
    'createdAt', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  );

  update public.user_accounts
  set
    credit_balance = credit_balance + p_amount,
    ledger = v_ledger || ledger,
    updated_at = now()
  where user_id = p_user_id
  returning credit_balance into v_balance;

  return jsonb_build_object(
    'amount', p_amount,
    'credit_balance', v_balance,
    'reference', v_refund_id,
    'already_refunded', false
  );
end;
$$;

create or replace function public.create_generation_job_with_billing(
  p_user_id uuid,
  p_amount integer,
  p_reason text,
  p_reference text,
  p_provider text,
  p_type text,
  p_model text,
  p_prompt text,
  p_expected_result_count integer,
  p_quality text default null,
  p_aspect_ratio text default null,
  p_duration_seconds integer default null,
  p_is_free boolean default false,
  p_client_request_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reference text := trim(p_reference);
  v_client_request_id text := nullif(trim(coalesce(p_client_request_id, '')), '');
  v_reason text := coalesce(nullif(trim(p_reason), ''), 'AI 生成');
  v_ledger jsonb;
  v_job public.generation_jobs%rowtype;
begin
  if p_user_id is null then
    raise exception '缺少用户 ID。';
  end if;

  if v_reference = '' then
    raise exception '缺少生成流水号。';
  end if;

  if p_type not in ('image', 'video') then
    raise exception '生成类型无效。';
  end if;

  if p_expected_result_count < 1 or p_expected_result_count > 4 then
    raise exception '生成结果数量无效。';
  end if;

  insert into public.user_accounts (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  if p_is_free then
    v_ledger := jsonb_build_object(
      'id', v_reference,
      'type', 'generate',
      'code', v_reason,
      'amount', 0,
      'createdAt', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    );

    update public.user_accounts
    set
      ledger = v_ledger || ledger,
      updated_at = now()
    where user_id = p_user_id;
  else
    if p_amount <= 0 then
      raise exception '扣费点数必须大于 0。';
    end if;

    perform 1
    from public.user_accounts
    where user_id = p_user_id
      and credit_balance >= p_amount
    for update;

    if not found then
      raise exception '点数余额不足，请先充值。';
    end if;

    v_ledger := jsonb_build_object(
      'id', v_reference,
      'type', 'generate',
      'code', v_reason,
      'amount', -p_amount,
      'createdAt', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    );

    update public.user_accounts
    set
      credit_balance = credit_balance - p_amount,
      ledger = v_ledger || ledger,
      updated_at = now()
    where user_id = p_user_id;
  end if;

  insert into public.generation_jobs (
    amount,
    client_request_id,
    expected_result_count,
    quality,
    aspect_ratio,
    duration_seconds,
    model,
    prompt,
    provider,
    reference,
    status,
    type,
    user_id
  )
  values (
    case when p_is_free then 0 else p_amount end,
    v_client_request_id,
    p_expected_result_count,
    nullif(trim(coalesce(p_quality, '')), ''),
    nullif(trim(coalesce(p_aspect_ratio, '')), ''),
    p_duration_seconds,
    p_model,
    p_prompt,
    p_provider,
    v_reference,
    'submitted',
    p_type,
    p_user_id
  )
  returning * into v_job;

  return to_jsonb(v_job);
end;
$$;

create or replace function public.fail_generation_job_with_refund(
  p_job_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.generation_jobs%rowtype;
  v_refund_id text;
  v_ledger jsonb;
begin
  select *
  into v_job
  from public.generation_jobs
  where id = p_job_id
  for update;

  if not found then
    raise exception '生成任务不存在。';
  end if;

  if v_job.status in ('completed', 'failed', 'partial_completed') then
    return to_jsonb(v_job);
  end if;

  if v_job.amount > 0 then
    v_refund_id := v_job.reference || '_refund';

    insert into public.user_accounts (user_id)
    values (v_job.user_id)
    on conflict (user_id) do nothing;

    perform 1
    from public.user_accounts
    where user_id = v_job.user_id
      and ledger @> jsonb_build_array(jsonb_build_object('id', v_refund_id))
    for update;

    if not found then
      v_ledger := jsonb_build_object(
        'id', v_refund_id,
        'type', 'refund',
        'code', coalesce(nullif(trim(p_reason), ''), 'AI 生成失败退款'),
        'amount', v_job.amount,
        'createdAt', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
      );

      update public.user_accounts
      set
        credit_balance = credit_balance + v_job.amount,
        ledger = v_ledger || ledger,
        updated_at = now()
      where user_id = v_job.user_id;
    end if;
  end if;

  update public.generation_jobs
  set
    completed_at = coalesce(completed_at, now()),
    expires_at = coalesce(expires_at, coalesce(completed_at, now()) + interval '24 hours'),
    last_checked_at = now(),
    last_sync_error = p_reason,
    next_check_at = now(),
    status = 'failed',
    sync_locked_until = null,
    task_error = p_reason,
    updated_at = now()
  where id = v_job.id
  returning * into v_job;

  return to_jsonb(v_job);
end;
$$;

grant execute on function public.redeem_credit_code(text) to authenticated;
grant execute on function public.is_username_available(text) to anon, authenticated;
grant execute on function public.current_auth_session_id() to authenticated;
grant execute on function public.is_current_active_session() to authenticated;
grant execute on function public.assert_current_active_session() to authenticated;
grant execute on function public.claim_current_auth_session(text) to authenticated;
grant execute on function public.release_current_auth_session() to authenticated;
grant execute on function public.admin_revoke_active_session(uuid, text) to authenticated;
grant execute on function public.save_user_projects(jsonb) to authenticated;
revoke execute on function public.spend_credits(integer, text, text) from public, anon, authenticated;
revoke execute on function public.refund_credits(integer, text, text) from public, anon, authenticated;
revoke execute on function public.spend_generation_credits(uuid, integer, text, text) from public, anon, authenticated;
revoke execute on function public.record_free_generation_usage(uuid, text, text) from public, anon, authenticated;
revoke execute on function public.refund_generation_credits(uuid, integer, text, text) from public, anon, authenticated;
revoke execute on function public.create_generation_job_with_billing(uuid, integer, text, text, text, text, text, text, integer, boolean, text) from public, anon, authenticated;
revoke execute on function public.create_generation_job_with_billing(uuid, integer, text, text, text, text, text, text, integer, text, text, integer, boolean, text) from public, anon, authenticated;
revoke execute on function public.fail_generation_job_with_refund(uuid, text) from public, anon, authenticated;
grant execute on function public.spend_generation_credits(uuid, integer, text, text) to service_role;
grant execute on function public.record_free_generation_usage(uuid, text, text) to service_role;
grant execute on function public.refund_generation_credits(uuid, integer, text, text) to service_role;
grant execute on function public.create_generation_job_with_billing(uuid, integer, text, text, text, text, text, text, integer, text, text, integer, boolean, text) to service_role;
grant execute on function public.fail_generation_job_with_refund(uuid, text) to service_role;
