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

-- 部屋（Studio A）
insert into public.rooms (tenant_id, name, capacity)
values
  ('11111111-1111-1111-1111-111111111111', 'Studio A', 8);

-- 提供サービス（Standard）
insert into public.services (tenant_id, name, duration_min, buffer_before_min, buffer_after_min, color)
values
  ('11111111-1111-1111-1111-111111111111', 'Standard', 60, 15, 15, '#2e7');

-- 機材（Camera A）
insert into public.equipments (tenant_id, sku, name, track_serial, stock, active)
values
  ('11111111-1111-1111-1111-111111111111', 'CAM-001', 'Camera A', true, 0, true);

-- 例外時間帯(2025-09-11)
insert into public.calendar_exceptions(tenant_id,scope,range,type)
values
  ('11111111-1111-1111-1111-111111111111', 'tenant', tstzrange('2025-09-11 00:00+09','2025-09-11 23:59+09','[)'),'holiday');
