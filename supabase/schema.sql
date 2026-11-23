-- ════════════════════════════════════════════════════════════════
--  TRCO APP · Base de datos (Supabase / PostgreSQL)
--  Pega TODO este archivo en Supabase → SQL Editor → New query → Run.
--  Se puede volver a correr sin problema (es idempotente).
-- ════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

-- ── Perfiles y roles ─────────────────────────────────────────────
-- owner   = dueño: ve todo (costos, ganancias, gastos, equipo)
-- staff   = equipo: inventario, ventas, clientes, producción
-- pending = cuenta nueva esperando aprobación del dueño (no ve nada)
create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  email text,
  name text,
  role text not null default 'pending' check (role in ('owner', 'staff', 'pending')),
  created_at timestamptz not null default now()
);

-- La PRIMERA cuenta que se registre será el dueño; las siguientes quedan pendientes.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, name, role)
  values (
    new.id, new.email,
    coalesce(nullif(new.raw_user_meta_data ->> 'name', ''), split_part(new.email, '@', 1)),
    case when exists (select 1 from public.profiles) then 'pending' else 'owner' end
  );
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role in ('owner', 'staff'));
$$;

create or replace function public.is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'owner');
$$;

-- ── Tablas del negocio ───────────────────────────────────────────
create table if not exists public.settings (
  id int primary key default 1 check (id = 1),
  data jsonb not null default '{}'
);

create table if not exists public.drops (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  release_date date,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text,
  color text,
  drop_id uuid references public.drops on delete set null,
  price numeric(12,2) not null default 0,
  cost numeric(12,2) not null default 0,
  stock jsonb not null default '{}',      -- {"S": 4, "M": 10, ...}
  min_stock int not null default 2,
  photo text,                              -- imagen comprimida (data URL)
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  instagram text,
  city text,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.sales (
  id uuid primary key default gen_random_uuid(),
  date date not null default current_date,
  customer_id uuid references public.customers on delete set null,
  channel text,
  payment_method text,
  status text not null default 'entregado' check (status in ('entregado', 'por_enviar', 'apartado', 'cancelado')),
  subtotal numeric(12,2) not null default 0,
  discount numeric(12,2) not null default 0,
  shipping numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  paid numeric(12,2) not null default 0,
  tracking text,
  notes text,
  created_by uuid default auth.uid() references auth.users on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales on delete cascade,
  product_id uuid references public.products on delete set null,
  product_name text,
  type text,
  size text,
  qty int not null default 1,
  unit_price numeric(12,2) not null default 0,
  unit_cost numeric(12,2) not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.production (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references public.products on delete set null,
  supplier text,
  quantities jsonb not null default '{}',  -- {"S": 10, "M": 20}
  total_cost numeric(12,2) not null default 0,
  ordered_date date default current_date,
  expected_date date,
  received_date date,
  status text not null default 'en_produccion' check (status in ('en_produccion', 'recibido')),
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  date date not null default current_date,
  category text,
  description text,
  amount numeric(12,2) not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists sale_items_sale_idx on public.sale_items (sale_id);
create index if not exists sales_date_idx on public.sales (date);

-- ── Ajuste de inventario atómico (evita errores si 2 personas venden a la vez) ──
create or replace function public.adjust_stock(p_product uuid, p_size text, p_delta int) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_member() then raise exception 'Sin permiso'; end if;
  update public.products
     set stock = jsonb_set(coalesce(stock, '{}'), array[p_size],
                           to_jsonb(coalesce((stock ->> p_size)::int, 0) + p_delta))
   where id = p_product;
end $$;

-- ── Seguridad (Row Level Security) ───────────────────────────────
alter table public.profiles   enable row level security;
alter table public.settings   enable row level security;
alter table public.drops      enable row level security;
alter table public.products   enable row level security;
alter table public.customers  enable row level security;
alter table public.sales      enable row level security;
alter table public.sale_items enable row level security;
alter table public.production enable row level security;
alter table public.expenses   enable row level security;

-- Perfiles: cada quien ve el suyo; los miembros ven al equipo; solo el dueño cambia roles.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select
  using (id = auth.uid() or public.is_member());
drop policy if exists profiles_owner_update on public.profiles;
create policy profiles_owner_update on public.profiles for update
  using (public.is_owner()) with check (public.is_owner());
drop policy if exists profiles_owner_delete on public.profiles;
create policy profiles_owner_delete on public.profiles for delete
  using (public.is_owner() and id <> auth.uid());

-- Ajustes: todos los miembros leen, solo el dueño cambia.
drop policy if exists settings_select on public.settings;
create policy settings_select on public.settings for select using (public.is_member());
drop policy if exists settings_owner on public.settings;
create policy settings_owner on public.settings for all
  using (public.is_owner()) with check (public.is_owner());

-- Tablas operativas: cualquier miembro (dueño o equipo).
do $$
declare t text;
begin
  foreach t in array array['drops', 'products', 'customers', 'sales', 'sale_items', 'production'] loop
    execute format('drop policy if exists %1$s_members on public.%1$s', t);
    execute format('create policy %1$s_members on public.%1$s for all using (public.is_member()) with check (public.is_member())', t);
  end loop;
end $$;

-- Gastos: SOLO el dueño.
drop policy if exists expenses_owner on public.expenses;
create policy expenses_owner on public.expenses for all
  using (public.is_owner()) with check (public.is_owner());

insert into public.settings (id, data) values (1, '{}') on conflict (id) do nothing;
