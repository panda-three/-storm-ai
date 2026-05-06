create table if not exists public.user_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text,
  credit_balance integer not null default 0,
  projects jsonb not null default '[]'::jsonb,
  ledger jsonb not null default '[]'::jsonb,
  redeemed_codes jsonb not null default '[]'::jsonb,
  role text not null default 'user' check (role in ('user', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_accounts add column if not exists role text not null default 'user';
alter table public.user_accounts add column if not exists username text;
alter table public.user_accounts alter column credit_balance set default 0;
alter table public.user_accounts drop constraint if exists user_accounts_role_check;
alter table public.user_accounts add constraint user_accounts_role_check check (role in ('user', 'admin')) not valid;
alter table public.user_accounts drop constraint if exists user_accounts_username_format_check;
alter table public.user_accounts add constraint user_accounts_username_format_check check (username is null or username ~ '^[A-Za-z0-9_]{3,24}$') not valid;

create unique index if not exists user_accounts_username_unique_idx on public.user_accounts (lower(username)) where username is not null;

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
  );
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
  price_cny numeric(10, 2) not null check (price_cny >= 0),
  credits integer not null check (credits > 0),
  enabled boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.redeem_codes (
  code text primary key,
  package_id uuid references public.credit_packages(id) on delete set null,
  credits integer not null check (credits > 0),
  price_cny numeric(10, 2) not null default 0 check (price_cny >= 0),
  status text not null default 'unused' check (status in ('unused', 'used', 'disabled')),
  used_by uuid references auth.users(id) on delete set null,
  used_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists redeem_codes_status_idx on public.redeem_codes (status);
create index if not exists redeem_codes_used_by_idx on public.redeem_codes (used_by);

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
alter table public.model_pricing enable row level security;
alter table public.site_settings enable row level security;

drop policy if exists "Users can read own account" on public.user_accounts;
create policy "Users can read own account"
on public.user_accounts
for select
to authenticated
using (auth.uid() = user_id or public.is_admin());

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
using (enabled = true or public.is_admin());

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
using (used_by = auth.uid() or public.is_admin());

drop policy if exists "Admins can manage redeem codes" on public.redeem_codes;
create policy "Admins can manage redeem codes"
on public.redeem_codes
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "Authenticated users can read enabled model pricing" on public.model_pricing;
create policy "Authenticated users can read enabled model pricing"
on public.model_pricing
for select
to authenticated
using (enabled = true or public.is_admin());

drop policy if exists "Admins can manage model pricing" on public.model_pricing;
create policy "Admins can manage model pricing"
on public.model_pricing
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "Authenticated users can read site settings" on public.site_settings;
create policy "Authenticated users can read site settings"
on public.site_settings
for select
to authenticated
using (true);

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
  v_ledger jsonb;
  v_balance integer;
begin
  if v_user_id is null then
    raise exception '请先登录后再兑换。';
  end if;

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

  insert into public.user_accounts (user_id)
  values (v_user_id)
  on conflict (user_id) do nothing;

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
begin
  if v_user_id is null then
    raise exception '请先登录后再保存历史项目。';
  end if;

  if jsonb_typeof(coalesce(p_projects, '[]'::jsonb)) <> 'array' then
    raise exception '历史项目格式不正确。';
  end if;

  insert into public.user_accounts (user_id, projects)
  values (v_user_id, p_projects)
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

grant execute on function public.redeem_credit_code(text) to authenticated;
grant execute on function public.is_username_available(text) to anon, authenticated;
grant execute on function public.save_user_projects(jsonb) to authenticated;
grant execute on function public.spend_credits(integer, text, text) to authenticated;
grant execute on function public.refund_credits(integer, text, text) to authenticated;
