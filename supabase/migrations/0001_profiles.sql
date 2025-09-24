-- 0001_profiles.sql
-- プロファイル表の作成 + RLSポリシー + 新規ユーザー時の自動作成トリガー

-- トランザクションを開始する。
begin;

-- アプリ固有のユーザープロフィールを保持するテーブル
create table if not exists public.profiles (
  -- id: 外部キー(auth.users.id)を参照。
  -- 参照している auth.users のレコードが削除されたら、それを参照している profiles レコードも削除される。
  id uuid primary key references auth.users(id) on delete cascade,
  -- 表示名（任意）
  display_name text,
  -- role: 権限（admin / member）。デフォルトは member
  role text not null default 'member' check (role in ('admin','member')),
  -- created_at: レコード作成日時、自動で現在時刻が入る
  created_at timestamptz not null default now()
);

-- RLS(Row Level Security)を有効化
-- これを有効にしないとポリシーが効かず、全ユーザーが自由に参照/更新できてしまう
alter table public.profiles enable row level security;

-- RLS ポリシー: 認証済みユーザーが自分自身の profiles レコードだけ参照できる
create policy profiles_select_own
  -- public.profiles が対象
  on public.profiles
  -- SELECT（読み取り）操作専用
  for select
  -- authenticated ロール（ログイン済みユーザー）が対象
  to authenticated
  -- 以下の条件に一致するレコードを参照できる
  -- 「profiles の id が、現在ログインしているユーザーの UUID (auth.uid()) と一致する」
  using (id = auth.uid());

-- RLS ポリシー: 認証済みユーザーが自分自身の profiles レコードだけ更新できる
create policy profiles_update_own
  on public.profiles
  -- UPDATE（更新）操作専用
  for update
  to authenticated
  using (id = auth.uid());

-- 新規ユーザー作成時に profiles 行を作成する関数
create or replace function public.insert_profile_after_user_insert()
  -- トリガー関数であることの宣言
  returns trigger
  -- PL/pgSQL という PostgreSQL の手続き言語で書かれていることを明示
  language plpgsql
  -- 関数の所有者の権限で実行する
  security definer
  -- 関数実行時のスキーマ検索パスを public, auth に設定
  set search_path = public, auth
  as $$
  begin
    -- auth.users の新規行 (NEW) を元に、profiles 行を追加
    insert into public.profiles (id, display_name, role)
    values (
      -- NEW は PostgreSQL のトリガー関数に自動的に渡される特殊なレコード変数
      NEW.id,
      -- ->> は JSON演算子 NEW.raw_user_meta_data という JSON から、 full_name キーの値を取得。
      coalesce(NEW.raw_user_meta_data ->> 'full_name', ''),
      'member'
    );
    return NEW;
  end;
  $$;

-- すでにトリガーが存在すれば削除する
drop trigger if exists on_auth_user_created on auth.users;

-- auth.users に行が挿入された直後に insert_profile_after_user_insert を呼ぶトリガーを作成
create trigger on_auth_user_created
  -- auth.users に行が追加された後に発火する
  after insert on auth.users
  -- 挿入される 各行ごとにトリガーが発火する
  -- 例えば一度に 3 ユーザーを INSERT したら 3 回呼ばれる。
  for each row
  -- 実行する関数
  execute function public.insert_profile_after_user_insert();

-- トランザクション内のすべての処理を確定する。
commit;
