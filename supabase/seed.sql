-- ユーザー（auth.users）
-- 本来は supabase.auth.admin.createUser() を使うが、
-- ローカル検証用なので最低限のカラムで直接投入。
insert into auth.users (id, email)
values
  ('00000000-0000-0000-0000-000000000001', 'db-admin-acme@example.com'),
  ('00000000-0000-0000-0000-000000000002', 'db-member-acme@example.com'),
  ('00000000-0000-0000-0000-000000000003', 'db-member-apex@example.com')
on conflict (id) do nothing;

-- プロフィール（public.profiles）
insert into public.profiles (id, role)
values
  ('00000000-0000-0000-0000-000000000001', 'admin'),
  ('00000000-0000-0000-0000-000000000002', 'member'),
  ('00000000-0000-0000-0000-000000000003', 'member')
on conflict (id) do nothing;

-- テナント
insert into public.tenants (id, name, slug)
values
  ('11111111-1111-1111-1111-111111111111', 'Acme Studio', 'acme'),
  ('11111111-1111-1111-1111-111111111112', 'Apex Studio', 'apex')
on conflict (slug) do nothing;

-- テナントユーザー
insert into public.tenant_users (tenant_id, profile_id, role)
values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000001', 'admin'),
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000002', 'member'),
  ('11111111-1111-1111-1111-111111111112', '00000000-0000-0000-0000-000000000003', 'member')
on conflict do nothing;

-- 部屋
insert into public.rooms (tenant_id, name, capacity)
values
  ('11111111-1111-1111-1111-111111111111', 'Studio A', 8),
  ('11111111-1111-1111-1111-111111111111', 'Studio B', 8),
  ('11111111-1111-1111-1111-111111111112', 'Studio AA', 8);

-- 提供サービス（Standard）
insert into public.services (tenant_id, name, duration_min, buffer_before_min, buffer_after_min, color)
values
  ('11111111-1111-1111-1111-111111111111', 'Standard', 60, 15, 15, '#2e7'),
  ('11111111-1111-1111-1111-111111111111', 'Quick Portrait', 30, 10, 10, '#f94'),
  ('11111111-1111-1111-1111-111111111112', 'Full Session', 90, 20, 20, '#39f')
on conflict do nothing;

-- スタッフ
insert into public.staff (tenant_id, name, active)
values
  ('11111111-1111-1111-1111-111111111111', 'Akari Tanaka', true),
  ('11111111-1111-1111-1111-111111111111', 'Shun Kato', true),
  ('11111111-1111-1111-1111-111111111112', 'Mina Hayashi', true)
on conflict do nothing;

-- 顧客
-- source という一時的な表を作成。列名は name / email / phone / tenant_slug
with source(name, email, phone, tenant_slug) as (
  -- source にデータを追加。以下のようにデータが作成される。
  -- name: 'Acme Productions', email: 'customer-acme@example.com', phone: '+81-3-0000-0001, tenant_slug: 'acme'
  values
    ('Acme Productions', 'customer-acme@example.com', '+81-3-0000-0001', 'acme'),
    ('Sunrise Creators', 'customer-sunrise@example.com', '+81-3-0000-0002', 'acme'),
    ('Apex Advertising', 'customer-apex@example.com', '+81-3-0000-0101', 'apex')
)
-- customers に tenant_id / name / email / phone の列順でデータを挿入。
insert into public.customers (tenant_id, name, email, phone)
-- customers に 挿入する値を select で取得する。
-- tenant_id には tenants.id を挿入したいので t.id を指定している。
select t.id, source.name, source.email, source.phone
-- select で取得するデータは source と tenants を join で結合したデータ。
-- source と tenants の行同士を結合する条件は t.slug = source.tenant_slug。
-- つまり tenants.slug と source.tenant_slug が一致するデータを結合してる。
-- public.tenants t の t は public.tenants のエイリアスであり任意に指定できる。
-- source と tenants を join で結合したデータは以下のようになり、これを select で取得している。
-- t.id (tenant_id)     | source.name        | source.email              | source.phone
---------------------+-------------------+---------------------------+------------------
-- 8f2a...              | Acme Productions  | customer-acme@example.com | +81-3-0000-0001
from source
join public.tenants t on t.slug = source.tenant_slug
-- 挿入時に一意制約（UNIQUE/PRIMARY KEY/EXCLUDE）に当たった場合は、その行だけ挿入をスキップする。
on conflict do nothing;

-- 機材（Camera A）
insert into public.equipments (tenant_id, sku, name, track_serial, stock, active)
values
  ('11111111-1111-1111-1111-111111111111', 'CAM-001', 'Camera A', true, 0, true);

-- 機材個体（Camera A の管理対象シリアル）
with source(serial, tenant_slug, sku) as (
  values
    ('CAM-001-ITEM-001', 'acme', 'CAM-001'),
    ('CAM-001-ITEM-002', 'acme', 'CAM-001'),
    ('CAM-001-ITEM-101', 'apex', 'CAM-001')
)
insert into public.equipment_items (tenant_id, equipment_id, serial, status)
select t.id, e.id, source.serial, 'available'
from source
join public.tenants t on t.slug = source.tenant_slug
join public.equipments e on e.tenant_id = t.id and e.sku = source.sku
on conflict (tenant_id, equipment_id, serial) do nothing;

-- 例外時間帯(2025-09-11)
insert into public.calendar_exceptions(tenant_id,scope,range,type)
values
  ('11111111-1111-1111-1111-111111111111', 'tenant', tstzrange('2025-09-11 00:00+09','2025-09-11 23:59+09','[)'),'holiday');
