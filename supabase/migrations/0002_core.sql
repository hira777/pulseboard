-- 0002_core.sql
-- マルチテナント予約システム（スタジオ＋機材レンタル）のコアスキーマ
-- 事前に 0001_profiles.sql（profiles/認証ユーザー）が適用されている前提です。

-- UUID 生成などで利用
create extension if not exists pgcrypto;
--  EXCLUDE 制約（重複防止）に利用
create extension if not exists btree_gist;

-- 以降の関数/テーブル/ポリシーを public スキーマに作成するための明示設定です。
set search_path = public;


-- Helper functions for RLS ----------------------------------------------------
-- Tenancy ---------------------------------------------------------------------
-- テナント（tenants）とテナント所属ユーザー（tenant_users）を管理します。
-- 1ユーザーは複数テナントに所属可能。RBAC は role（'admin' | 'member'）で表現します。
create table if not exists public.tenants (
  -- id … テナントID（UUID）。gen_random_uuid() により生成。
  id uuid primary key default gen_random_uuid(),
  -- name … テナント表示名（必須）。
  name text not null,
  -- slug … 人間可読な短い識別子。UI/URL 用（必須・ユニーク）。
  slug text not null,
  -- created_at … 作成時刻。既定で現在時刻。
  created_at timestamptz not null default now(),
  -- 形式チェック：小文字英数・ハイフン、3〜50文字、lower固定
  constraint tenants_slug_format_ck check (
    slug = lower(slug)
    and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    and char_length(slug) between 3 and 50
  ),
  -- ユニーク制約
  constraint tenants_slug_key unique (slug)
);

create table if not exists public.tenant_users (
  -- tenant_id … 所属先テナント。テナント削除時は連鎖削除。
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- profile_id … auth.users.id への参照。ユーザー削除時は連鎖削除。
  profile_id uuid not null references auth.users(id) on delete cascade,
  -- role … RBACロール。'admin' or 'member' のみを許容。
  role text not null default 'member' check (role in ('admin','member')),
  -- created_at … 追加日時。
  created_at timestamptz not null default now(),
  -- PK … (tenant_id, profile_id) で一意（1ユーザー1テナントに一意な所属）。
  primary key (tenant_id, profile_id)
);

alter table public.tenants enable row level security;
alter table public.tenant_users enable row level security;

-- RLS 判定用のヘルパー関数群。
-- app_is_tenant_member: 認証ユーザーが対象テナントのメンバーであるかを判定。
-- app_is_tenant_admin : 上記に加えて role='admin' であるかを判定。
create or replace function app_is_tenant_member(target_tenant uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.tenant_users tu
    where tu.tenant_id = target_tenant
      and tu.profile_id = auth.uid()
  );
$$;

create or replace function app_is_tenant_admin(target_tenant uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.tenant_users tu
    where tu.tenant_id = target_tenant
      and tu.profile_id = auth.uid()
      and tu.role = 'admin'
  );
$$;


-- tenants テーブルの RLS ポリシー
drop policy if exists tenants_select on public.tenants;
create policy tenants_select on public.tenants
for select using (app_is_tenant_member(id));

drop policy if exists tenants_admin_write on public.tenants;
create policy tenants_admin_write on public.tenants
for all using (app_is_tenant_admin(id)) with check (app_is_tenant_admin(id));

-- tenant_users テーブルの RLS ポリシー
drop policy if exists tenant_users_select on public.tenant_users;
create policy tenant_users_select on public.tenant_users
for select using (
  app_is_tenant_admin(tenant_id) or profile_id = auth.uid()
);

drop policy if exists tenant_users_admin_write on public.tenant_users;
create policy tenant_users_admin_write on public.tenant_users
for all using (app_is_tenant_admin(tenant_id)) with check (app_is_tenant_admin(tenant_id));

-- Master data -----------------------------------------------------------------
-- マスターデータ群。各テナント固有の部屋/サービス/機材/顧客/スタッフ情報を保持します。
create table if not exists public.rooms (
  -- id … 部屋ID（UUID）。
  id uuid primary key default gen_random_uuid(),
  -- tenant_id … 所属テナント。削除時は連鎖削除。
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- name … 部屋名（必須）。
  name text not null,
  -- capacity … 収容人数の目安（任意）。
  capacity int,
  -- color … UI上の色指定（任意）。
  color text,
  open_hours jsonb, -- e.g. { mon: [{start:"09:00", end:"18:00"}], ... }
  -- open_hours … 営業時間スロット（アプリ層で解釈）。
  -- active … 予約対象として有効かどうか。
  active boolean not null default true,
  constraint rooms_tenant_id_id_key unique (tenant_id, id)
);

alter table public.rooms
  add constraint rooms_tenant_id_name_key unique (tenant_id, name);

create table if not exists public.services (
  -- id … サービス（メニュー）ID。
  id uuid primary key default gen_random_uuid(),
  -- tenant_id … 所属テナント。
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- name … サービス名。
  name text not null,
  -- duration_min … 提供時間（分）。
  duration_min int not null,
  -- buffer_before_min … 前バッファ（分）。
  buffer_before_min int not null default 0,
  -- buffer_after_min … 後バッファ（分）。
  buffer_after_min int not null default 0,
  -- color … UI色（任意）。
  color text,
  constraint services_tenant_id_id_key unique (tenant_id, id)
);

create table if not exists public.equipments (
  -- id … 機材SKU ID。
  id uuid primary key default gen_random_uuid(),
  -- tenant_id … 所属テナント。
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- sku … テナント内ユニークな型番/SKU。
  sku text not null,
  -- name … 機材名。
  name text not null,
  -- track_serial … true の場合、個体（シリアル）単位で管理。
  track_serial boolean not null default false,
  -- stock … SKU全体の在庫数（個体管理しない場合に使用）。
  stock int not null default 0,
  -- active … 取り扱い中フラグ。
  active boolean not null default true,
  constraint equipments_tenant_id_sku_key unique (tenant_id, sku),
  constraint equipments_tenant_id_id_key unique (tenant_id, id)
);

create table if not exists public.equipment_items (
  -- id … 機材個体ID。
  id uuid primary key default gen_random_uuid(),
  -- tenant_id … 所属テナント。
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- equipment_id … 紐づくSKU。
  equipment_id uuid not null references public.equipments(id) on delete cascade,
  -- serial … 個体シリアル（SKU内で一意）。
  serial text,
  -- status … 個体状態。'available'|'repair'|'lost'。
  status text not null default 'available' check (status in ('available','repair','lost')),
  constraint equipment_items_tenant_id_id_key unique (tenant_id, id),
  constraint equipment_items_tenant_equipment_serial_key unique (tenant_id, equipment_id, serial),
  -- equipment_items_equipment_fk という名前の制約
  -- foreign key (tenant_id, equipment_id) で tenant_id と equipment_id が複合外部キーであることを宣言している
  -- そしてその外部キーの参照先が equipments の tenant_id と id である。
  -- そのため、tenant_id と equipment_id の値は、equipments の tenant_id と id カラムに存在
  constraint equipment_items_equipment_tenant_fk
    foreign key (tenant_id, equipment_id)
    references public.equipments(tenant_id, id)
    -- 参照先の equipments の行が削除されたら、それに紐づくこのテーブルの行も削除される
    on delete cascade
);

create table if not exists public.customers (
  -- id … 顧客ID。
  id uuid primary key default gen_random_uuid(),
  -- tenant_id … 所属テナント。
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- name … 顧客名。
  name text not null,
  -- email … 連絡用メール（重複許容）。
  email text not null,
  -- phone … 連絡用電話（重複許容）。
  phone text not null,
  -- note … メモ。
  note text,
  -- created_at … 登録時刻。
  created_at timestamptz not null default now(),
  constraint customers_tenant_id_id_key unique (tenant_id, id)
);

create table if not exists public.staff (
  -- id … スタッフID。
  id uuid primary key default gen_random_uuid(),
  -- tenant_id … 所属テナント。
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- profile_id … auth.users への参照（任意）。
  profile_id uuid references auth.users(id) on delete set null,
  -- name … 表示名。
  name text not null,
  -- skills … 任意のスキル情報（JSON）。
  skills jsonb,
  -- active … 在籍/稼働中フラグ。
  active boolean not null default true,
  constraint staff_tenant_id_id_key unique (tenant_id, id)
);

-- Reservations ----------------------------------------------------------------
-- ===================================================================
-- make_occupy_tstzrange
-- 開始・終了日時、前後のバッファ、ステータスから占有時間帯を算出する関数。
-- - confirmed / in_use の場合のみ占有時間帯を返す
-- - それ以外のステータスは NULL を返す
-- - tstzrange 型を返し、予約の重複判定やインデックスに利用する
--
-- ▼使用例
--   select make_occupy_tstzrange(
--     '2025-09-10 10:00+09'::timestamptz,  -- 開始
--     '2025-09-10 11:00+09'::timestamptz,  -- 終了
--     15,  -- 前バッファ 15分
--     10,  -- 後バッファ 10分
--     'confirmed'
--   );
--
-- ▼返却例
--   ["2025-09-10 09:45:00+09","2025-09-10 11:10:00+09")
--
--   ※ status が 'canceled' の場合は NULL
-- ===================================================================
create or replace function make_occupy_tstzrange(
  p_start timestamptz,
  p_end   timestamptz,
  p_before_min int,
  p_after_min  int,
  p_status text
) returns tstzrange
language sql
immutable
as $$
  select case when p_status in ('confirmed','in_use') then
    tstzrange(
      p_start - (p_before_min::int * interval '1 minute'),
      p_end   + (p_after_min::int  * interval '1 minute'),
      '[)'
    )
  else null end
$$;
-- 予約テーブル。time_range（生成列）に前後バッファを含む占有時間帯を保持します。
-- ステータスが confirmed/in_use のときのみ重複判定の対象になります。
create table if not exists public.reservations (
  -- id … 予約ID。
  id uuid primary key default gen_random_uuid(),
  -- tenant_id … 所属テナント。
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- customer_id … 予約の顧客。削除時は NULL。
  customer_id uuid references public.customers(id) on delete set null,
  -- service_id … 選択サービス。削除時は NULL。
  service_id uuid references public.services(id) on delete set null,
  -- room_id … 対象部屋（必須）。参照先に予約があると部屋は削除不可（restrict）。
  room_id uuid not null references public.rooms(id) on delete restrict,
  -- staff_id … 担当スタッフ。削除時は NULL。
  staff_id uuid references public.staff(id) on delete set null,
  -- start_at … 開始日時。
  start_at timestamptz not null,
  -- end_at … 終了日時（start_at より後）。
  end_at timestamptz not null,
  -- status … 予約状態。重複抑止対象は confirmed/in_use。
  status text not null default 'confirmed' check (status in ('confirmed','in_use','completed','no_show','canceled')),
  -- buffer_before_min … 前バッファ（分）。
  buffer_before_min int not null default 0,
  -- buffer_after_min … 後バッファ（分）。
  buffer_after_min int not null default 0,
  -- note … 備考。
  note text,
  -- created_by … 作成者（auth.users）。
  created_by uuid references auth.users(id) on delete set null,
  -- updated_at … 更新時刻。既定 now()。アプリ層で適宜更新。
  updated_at timestamptz not null default now(),
  -- version … 将来の楽観的ロック等に利用可能（任意）。
  version int not null default 1,
  -- occupy only when the status blocks other bookings
  time_range tstzrange generated always as (
    make_occupy_tstzrange(start_at, end_at, buffer_before_min, buffer_after_min, status)
  ) stored,
  constraint reservations_time_order_ck check (end_at > start_at),
  constraint reservations_customer_tenant_fk foreign key (tenant_id, customer_id)
    references public.customers(tenant_id, id),
  constraint reservations_service_tenant_fk foreign key (tenant_id, service_id)
    references public.services(tenant_id, id),
  constraint reservations_room_tenant_fk foreign key (tenant_id, room_id)
    references public.rooms(tenant_id, id) on delete restrict,
  constraint reservations_staff_tenant_fk foreign key (tenant_id, staff_id)
    references public.staff(tenant_id, id),
  constraint reservations_tenant_id_id_key unique (tenant_id, id)
);

create index if not exists idx_reservations_tenant_start on public.reservations(tenant_id, start_at);
create index if not exists idx_reservations_room_start on public.reservations(room_id, start_at);

-- 同一 room_id で time_range が重なる予約を EXCLUDE 制約で排他します（NULL は対象外）。
alter table public.reservations
  add constraint reservations_no_overlap_per_room
  exclude using gist (
    room_id with =,
    time_range with &&
  );

alter table public.reservations
  add constraint reservations_no_overlap_per_staff
  exclude using gist (
    staff_id with =,
    time_range with &&
  );

create table if not exists public.reservation_equipment_items (
  -- id … 割当ID。
  id uuid primary key default gen_random_uuid(),
  -- tenant_id … 所属テナント。親予約のテナントと一致させる。
  tenant_id uuid not null,
  -- reservation_id … 親予約。
  reservation_id uuid not null,
  -- equipment_item_id … 個体ID。故障/紛失時の追跡に利用。
  equipment_item_id uuid not null,
  -- reservation_time_range … 親予約の占有時間帯（キャンセル時は NULL）。
  reservation_time_range tstzrange,
  -- created_at … 割当日時。
  created_at timestamptz not null default now(),
  constraint reservation_equipment_items_reservation_item_key unique (reservation_id, equipment_item_id),
  constraint reservation_equipment_items_reservation_tenant_fk foreign key (tenant_id, reservation_id)
    references public.reservations(tenant_id, id) on delete cascade,
  constraint reservation_equipment_items_equipment_item_tenant_fk foreign key (tenant_id, equipment_item_id)
    references public.equipment_items(tenant_id, id) on delete restrict
);

-- 個体の二重予約を防ぎ、予約の時間変更に追従させるためのトリガ/関数。
-- -----------------------------------------------------------------------------
-- 前提:
--  - public.reservations に、占有レンジを表す生成列 time_range（tstzrange）がある
--    （例: make_occupy_tstzrange により confirmed/in_use のみ [start,end)＋バッファを生成）。
--  - public.reservation_equipment_items に、予約側レンジを複製保持する
--    reservation_time_range（tstzrange）列が存在する。
--  - public.reservation_equipment_items に、親予約と同じ tenant_id を保持する列がある。
--  - btree_gist 拡張が有効（EXCLUDE制約に必要）。
-- 目的:
--  1) 子テーブル（予約×個体）に、親予約の占有レンジを常に反映させる
--  2) 同一個体（equipment_item_id）で時間帯が重なる割当をDBで排他（EXCLUDE）
-- 留意:
--  - reservation_time_range が NULL の行は EXCLUDE の判定対象外（PostgreSQL仕様）。
--    status に応じて NULL を許容するポリシーか、NOT NULL 制約で常に判定対象にするかを決める。
--  - AFTER トリガで親の変更を子に一括反映。BEFORE トリガで子行挿入時にも親の値をコピー。
-- -----------------------------------------------------------------------------
create or replace function reservation_equipment_items_apply_time_range()
returns trigger
language plpgsql
as $$
declare
  v_range tstzrange;  -- 親予約の占有レンジ（reservations.time_range）を受け取る一時変数
  v_tenant uuid;      -- 親予約のテナントID
begin
  -- 子行（NEW.reservation_id）に対応する親予約の time_range を取得
  select r.time_range, r.tenant_id into v_range, v_tenant
  from public.reservations r
  where r.id = new.reservation_id;

  -- 取得した占有レンジを子行の reservation_time_range に反映
  -- 例: 親が canceled 等で占有しない場合は NULL が入る（EXCLUDEの判定対象外になる）
  new.reservation_time_range := v_range;
  if new.tenant_id is null then
    new.tenant_id := v_tenant;
  elsif new.tenant_id <> v_tenant then
    raise exception 'reservation_equipment_items tenant mismatch'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

-- 子テーブル側: 挿入/更新のたびに親予約の占有レンジをコピーして整合を保つ
create trigger reservation_equipment_items_set_time_range
before insert or update on public.reservation_equipment_items
for each row
execute function reservation_equipment_items_apply_time_range();

create or replace function reservations_sync_equipment_items_time_range()
returns trigger
language plpgsql
as $$
begin
  -- 親予約の時間・バッファ・状態の変更後に、紐づく子行の reservation_time_range を一括更新
  -- NEW.time_range は reservations の生成列（更新後の占有レンジ）
  update public.reservation_equipment_items rei
  set reservation_time_range = new.time_range
  where rei.reservation_id = new.id;
  return null;  -- AFTERトリガでは戻り値は無視されるため NULL を返す
end;
$$;

-- 親テーブル側: 時刻・バッファ・状態が変わったときに子へ反映
create trigger reservations_sync_equipment_items_time_range
after update of start_at, end_at, buffer_before_min, buffer_after_min, status on public.reservations
for each row
execute function reservations_sync_equipment_items_time_range();

-- 同一個体について、時間帯が重なる割当（reservation_time_range の &&）を禁止
-- ・'[)' 片側閉区間を想定（tstzrangeのデフォルト）。終端の一致は重ならない扱い。
-- ・reservation_time_range が NULL の行は判定対象外（取消・非占有など）。
alter table public.reservation_equipment_items
  add constraint reservation_equipment_items_no_overlap
  exclude using gist (
    equipment_item_id with =,
    reservation_time_range with &&
  );

-- 参照系の実行計画を安定させるための補助インデックス
create index if not exists idx_reservation_equipment_items_reservation on public.reservation_equipment_items(reservation_id);
create index if not exists idx_reservation_equipment_items_equipment_item on public.reservation_equipment_items(equipment_item_id);

-- Calendar exceptions ----------------------------------------------------------
-- 休業日/メンテナンス/私用など例外時間帯。scope と target_id で適用範囲を特定します。
create table if not exists public.calendar_exceptions (
  -- id … 例外ID。
  id uuid primary key default gen_random_uuid(),
  -- tenant_id … 所属テナント。
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- scope … 適用範囲。'tenant'|'room'|'equipment'|'staff'。
  scope text not null check (scope in ('tenant','room','equipment','staff')),
  -- target_id … 対象ID。scope に応じて参照先が異なる（任意）。
  target_id uuid,
  -- range … 例外の時間範囲（[start, end)）。
  range tstzrange not null,
  -- type … 種別。'holiday'（休業）|'maintenance'（メンテ）|'ooh'（私用）|'busy'（埋まり）。
  type text not null check (type in ('holiday','maintenance','ooh','busy')),
  -- note … 備考。
  note text
);

-- Messaging & audit ------------------------------------------------------------
-- 内部メッセージと監査ログ。誰が/何を/いつを記録します。
create table if not exists public.messages (
  -- id … メッセージID。
  id uuid primary key default gen_random_uuid(),
  -- tenant_id … 所属テナント。
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- reservation_id … 紐づく予約。予約削除で連鎖削除。
  reservation_id uuid not null,
  -- sender_profile_id … 送信者（auth.users.id）。
  sender_profile_id uuid not null references auth.users(id) on delete cascade,
  -- body … 本文。
  body text not null,
  -- created_at … 送信時刻。
  created_at timestamptz not null default now(),
  constraint messages_reservation_tenant_fk foreign key (tenant_id, reservation_id)
    references public.reservations(tenant_id, id) on delete cascade,
  constraint messages_tenant_id_id_key unique (tenant_id, id)
);

create table if not exists public.audit_logs (
  -- id … 監査ログID。
  id uuid primary key default gen_random_uuid(),
  -- tenant_id … 所属テナント。
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- actor … 実行者（auth.users）。削除時は NULL。
  actor uuid references auth.users(id) on delete set null,
  -- action … 動作名（例: 'reservation.update'）。
  action text not null,
  -- target_type … 対象の種類（例: 'reservation'）。
  target_type text not null,
  -- target_id … 対象のID（任意）。
  target_id uuid,
  -- diff … 変更差分など（JSON）。
  diff jsonb,
  -- at … 記録時刻。
  at timestamptz not null default now()
);

-- RLS: enable on all domain tables --------------------------------------------
-- 以降のポリシーにより、テナント境界を RLS で強制します。
alter table public.rooms enable row level security;
alter table public.services enable row level security;
alter table public.equipments enable row level security;
alter table public.equipment_items enable row level security;
alter table public.customers enable row level security;
alter table public.staff enable row level security;
alter table public.reservations enable row level security;
alter table public.reservation_equipment_items enable row level security;
alter table public.calendar_exceptions enable row level security;
alter table public.messages enable row level security;
alter table public.audit_logs enable row level security;

-- ポリシーパターン。マスタは「メンバー参照可・管理者のみ書込可」を基本とします。
-- Admin-write / member-read patterns for master data
create policy rooms_select on public.rooms for select using (app_is_tenant_member(tenant_id));
create policy rooms_admin_write on public.rooms for all using (app_is_tenant_admin(tenant_id)) with check (app_is_tenant_admin(tenant_id));

create policy services_select on public.services for select using (app_is_tenant_member(tenant_id));
create policy services_admin_write on public.services for all using (app_is_tenant_admin(tenant_id)) with check (app_is_tenant_admin(tenant_id));

create policy equipments_select on public.equipments for select using (app_is_tenant_member(tenant_id));
create policy equipments_admin_write on public.equipments for all using (app_is_tenant_admin(tenant_id)) with check (app_is_tenant_admin(tenant_id));

create policy equipment_items_select on public.equipment_items for select using (app_is_tenant_member(tenant_id));
create policy equipment_items_admin_write on public.equipment_items for all using (app_is_tenant_admin(tenant_id)) with check (app_is_tenant_admin(tenant_id));

-- Operational data
-- 業務データは所属テナントのメンバーに read/write を許可します（要件に応じ拡張可能）。
create policy customers_rw on public.customers
for all using (app_is_tenant_member(tenant_id)) with check (app_is_tenant_member(tenant_id));

create policy staff_select on public.staff for select using (app_is_tenant_member(tenant_id));
create policy staff_admin_write on public.staff for all using (app_is_tenant_admin(tenant_id)) with check (app_is_tenant_admin(tenant_id));

create policy reservations_rw on public.reservations
for all using (app_is_tenant_member(tenant_id)) with check (app_is_tenant_member(tenant_id));

create policy reservation_equipment_items_rw on public.reservation_equipment_items
for all using (
  exists (
    select 1
    from public.reservations r
    where r.id = reservation_equipment_items.reservation_id
      and app_is_tenant_member(r.tenant_id)
  )
) with check (
  exists (
    select 1
    from public.reservations r
    where r.id = reservation_equipment_items.reservation_id
      and app_is_tenant_member(r.tenant_id)
  )
);

create policy calendar_exceptions_select on public.calendar_exceptions for select using (app_is_tenant_member(tenant_id));
create policy calendar_exceptions_admin_write on public.calendar_exceptions for all using (app_is_tenant_admin(tenant_id)) with check (app_is_tenant_admin(tenant_id));

create policy messages_rw on public.messages
for all using (app_is_tenant_member(tenant_id)) with check (app_is_tenant_member(tenant_id));

create policy audit_logs_select on public.audit_logs for select using (app_is_tenant_admin(tenant_id));
create policy audit_logs_insert on public.audit_logs for insert with check (app_is_tenant_member(tenant_id));
