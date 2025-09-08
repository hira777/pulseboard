# DB 関連のメモ書き

## 用語

- PK: Primary Key（主キー） の略。そのテーブルの中で 行を一意に特定するためのカラム（列） を指す。

## `public.profile`の`public`に関して

利用するテーブル名の一つが`public.profile`という名前だが、`public`はスキーマ。

PostgreSQL（Supabase の DB）は、データベースの中を「スキーマ」という単位で分けて整理する（階層がないフォルダのようなもの）。

`public`は PostgreSQL が標準で用意するスキーマで、特に指定がなければ`public`にテーブルが作られる。

そのため`profiles`だけ書いても問題ないが、「どのスキーマにあるテーブルか」を明示するために`public.profiles`のように`public`も記述することが多い。

## `auth.users`などの`auth`について

`auth`もスキーマ名であり、Supabase では認証関連のデータを`auth`スキーマに格納している。

ここにはサインアップしたユーザー情報（メール、パスワードハッシュ、UID など）が保存される。

## 制約の読み方

`profiles.id`(カラム)には以下の制約がある。

```
references auth.users(id) on delete cascade
```

### `references auth.users(id) `

`profiles.id`は`auth.users.id`を参照する（外部キー制約）。

つまり、`profiles.id`には「`auth.users.id`に存在する値しか入れられない」という制約がある。

`auth.users`が親で`profiles`が子。

### `on delete cascade`

ある`auth.users.id`の行が削除されたら、それに対応する`profiles.id`の行も削除する。

---

## SQL 関数と PL/pgSQL の使い分け（目安）

結論（ざっくり）

- シンプルな読取クエリで真偽や 1 行を返すだけ → `language sql` が最適
- 複数手順・分岐・例外処理・ループ・動的 SQL が必要 → `language plpgsql`

違い

- `language sql`
  - 役割: 素の SQL（SELECT/EXISTS など）で完結する関数。
  - 強み: 軽量・最適化されやすい（インライン化される場合がある）。RLS 判定など高頻度用途に有利。
  - 向き: 「所属しているか？admin か？」のようなブール判定、1 文で書ける読み取り。
- `language plpgsql`
  - 役割: 手続き言語。変数/IF/LOOP/例外、動的 SQL（EXECUTE）を使える。
  - 強み: 複雑なロジックやトリガー処理に対応。
  - 向き: トリガ関数、複雑なバリデーション、条件により複数クエリを打ち分ける処理。

判断フロー（簡易）

1. 1 文の SELECT/EXISTS で書けるか？ → はい: `sql` / いいえ: 次へ
2. 分岐・ループ・例外・動的 SQL が要るか？ → はい: `plpgsql` / いいえ: 可能なら `sql`
3. RLS/ポリシー内で多用するか？ → なるべく `sql`（軽量）
4. トリガで副作用（別テーブル更新等）が必要？ → `plpgsql`

RLS 判定関数の推奨属性

- `stable`: 同一ステートメント中で一定だが、外部依存（`auth.uid()`やテーブル参照）があるため `immutable` にはしない。
- `security definer` + `set search_path = public`: 関数所有者権限で実行し、検索パスを固定して安全性を高める。

例（テナント管理者か判定: language sql）

```sql
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
```

同等の plpgsql 版（動くがやや重い）

```sql
create or replace function app_is_tenant_admin_plpgsql(target_tenant uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return exists (
    select 1
    from public.tenant_users tu
    where tu.tenant_id = target_tenant
      and tu.profile_id = auth.uid()
      and tu.role = 'admin'
  );
end;
$$;
```

メモ

- `language sql` でも CTE（WITH 句）や複数文は書けるが、IF/LOOP などの制御構文は使えない。
- 性能差はケース次第だが、RLS のように高頻度に評価される関数は“なるべく薄く”が定石。

---

## PL/pgSQL が向いている実例（サンプル付き）

### 1) `updated_at` を自動更新するトリガー
複数テーブルで共通の「更新時刻を自動で入れる」処理はトリガー化が便利。トリガー関数は PL/pgSQL が定番です。

```sql
create or replace function public.tg_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- 例: reservations の更新時に updated_at を自動更新
drop trigger if exists set_updated_at on public.reservations;
create trigger set_updated_at
before update on public.reservations
for each row execute function public.tg_set_updated_at();
```

### 2) 例外処理＋複数手順（バリデーション→変更→監査ログ）
1回の呼び出しで「検証→更新→監査ログ挿入」までやり切る場合、途中失敗時に `raise exception` してロールバックできる PL/pgSQL が適しています。

```sql
create or replace function public.reserve_confirm(p_reservation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid;
begin
  -- 1) 予約の存在チェック＆テナント取得
  select tenant_id into v_tenant
  from reservations where id = p_reservation_id;
  if v_tenant is null then
    raise exception 'reservation not found: %', p_reservation_id;
  end if;

  -- 2) 予約状態の検証（例: すでに確定済みなら中止）
  if exists (
    select 1 from reservations
    where id = p_reservation_id and status = 'confirmed'
  ) then
    raise exception 'already confirmed: %', p_reservation_id;
  end if;

  -- 3) 状態更新
  update reservations
     set status = 'confirmed'
   where id = p_reservation_id;

  -- 4) 監査ログ
  insert into audit_logs (tenant_id, actor, action, target_type, target_id)
  select r.tenant_id, auth.uid(), 'reservation.confirm', 'reservation', r.id
    from reservations r where r.id = p_reservation_id;
end;
$$;
```

### 3) 動的SQLや繰り返し処理（在庫検査の参考実装）
SKU 在庫の同時刻合計 ≤ stock を DB 側で厳密に検査する場合、時間帯重複の集計＋条件分岐が必要になります。以下は概念実装です（v1 ではアプリ層で対応予定）。

```sql
create or replace function public.validate_equipment_stock(
  p_reservation_id uuid
)
returns void
language plpgsql
as $$
declare
  v_tenant uuid;
  v_range tstzrange;
begin
  -- 予約のテナントと占有範囲を取得
  select tenant_id, time_range into v_tenant, v_range
  from reservations where id = p_reservation_id;

  if v_range is null then
    return; -- 占有しない状態（canceled/completed等）はスキップ
  end if;

  -- 各SKUについて重複時間帯の合計数量が stock を超えないか検査
  perform 1
  from (
    select e.id as equipment_id, e.stock,
           coalesce(sum(re.qty), 0) as total_qty
    from equipments e
    join reservation_equipment re on re.equipment_id = e.id
    join reservations r on r.id = re.reservation_id
    where e.tenant_id = v_tenant
      and r.time_range && v_range
    group by e.id, e.stock
    having coalesce(sum(re.qty), 0) > e.stock
  ) x;

  if found then
    raise exception 'equipment stock exceeded in overlapping time window';
  end if;
end;
$$;

-- 例: INSERT/UPDATE 時に検査（必要に応じて適用）
-- create trigger validate_equipment_stock_trg
-- after insert or update on reservation_equipment
-- for each row execute function public.validate_equipment_stock(new.reservation_id);
```

上記のように、
- トリガ（`TG_*` 変数、NEW/OLD 行の扱い）
- 例外処理とロールバックを前提にした複数手順
- 時間帯集計・条件分岐・場合によっては動的SQL

といった要件では PL/pgSQL を選ぶのが実務的です。
