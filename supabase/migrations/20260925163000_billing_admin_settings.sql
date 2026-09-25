-- Admin-controlled billing settings: plan prices + limited-time monthly discount.
-- Single-row table (id = 1). Prices in EGP; NULL price falls back to env defaults.

create table if not exists public.local_billing_settings (
  id integer primary key default 1 check (id = 1),
  pro_price_egp numeric(10,2),
  pro_6m_price_egp numeric(10,2),
  pro_1y_price_egp numeric(10,2),
  discount_enabled boolean not null default false,
  discount_price_egp numeric(10,2),
  discount_ends_at timestamptz,
  discount_label_ar text not null default 'عرض محدود',
  discount_label_en text not null default 'Limited offer',
  updated_at timestamptz not null default now()
);

-- Seed the limited-time monthly offer: 50 EGP until ~14 days after migration.
insert into public.local_billing_settings (
  id, discount_enabled, discount_price_egp, discount_ends_at, discount_label_ar, discount_label_en
)
values (1, true, 50, now() + interval '14 days', 'عرض محدود', 'Limited offer')
on conflict (id) do nothing;

alter table public.local_billing_settings enable row level security;

revoke all on table public.local_billing_settings from anon, authenticated;
grant select, update on table public.local_billing_settings to service_role;
