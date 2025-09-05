-- 0001_profiles.sql
-- プロファイル表の作成 + RLSポリシー + 新規ユーザー時の自動作成トリガー
-- 1トランザクションで包んで中途半端な状態を防止

begin;

-- 1) profiles テーブルを作成
--   - id: usersテーブルのidと同じ値を保持（uuid型、主キー）
--     -> auth.users.id を参照する外部キー。ユーザー削除時に CASCADE で一緒に削除される
--   - display_name: 表示名（任意）
--   - role: 権限（admin / member）。デフォルトは member
--   - created_at: レコード作成日時、自動で現在時刻が入る
--   - role_chk 制約: role に admin または member 以外の値を入れられない
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  role text not null default 'member',
  created_at timestamptz not null default now(),
  constraint role_chk check (role in ('admin','member'))
);

-- 2) Row Level Security(RLS) を有効化
--   - これを有効にしないとポリシーが効かず、全ユーザーが自由に参照/更新できてしまう
alter table public.profiles enable row level security;

-- 3) RLS ポリシー: 本人のみ参照できる
--   - authenticated ロール（ログイン済みユーザー）が対象
--   - 条件: profiles.id = 現在ログインしているユーザーのid (auth.uid())
--   - 結果: 自分のプロフィールだけ select 可能
create policy profiles_select_own
on public.profiles
for select
to authenticated
using (id = auth.uid());

-- 4) RLS ポリシー: 本人のみ更新できる
--   - 上と同様、条件は「profiles.id = ログインユーザーid」
--   - 結果: 自分のプロフィールだけ update 可能
create policy profiles_update_own
on public.profiles
for update
to authenticated
using (id = auth.uid());

-- 5) 新規ユーザー作成時に profiles 行を自動作成するトリガーと関数
--   - handle_new_user(): auth.users に新規行が追加されたときに呼ばれる
--   - new.id: 新しく作られたユーザーのid
--   - raw_user_meta_data->>'full_name': サインアップ時に渡された full_name を display_name に反映
--   - role はデフォルトで 'member'
--   - on_auth_user_created トリガー: auth.users に insert があったらこの関数を実行する
create or replace function public.handle_new_user()
-- トリガー関数であることの宣言
returns trigger
-- PL/pgSQL という PostgreSQL の手続き言語で書かれていることを明示
language plpgsql
-- 関数の所有者の権限で実行する
security definer
set search_path = public, auth
as $$
begin
  -- auth.users の新規行 (NEW) を元に、profiles を初期化
  insert into public.profiles (id, display_name, role)
  values (
    NEW.id,
    coalesce(NEW.raw_user_meta_data ->> 'full_name', ''),
    'member'
  );
  return NEW;
end;
$$;

-- 既に存在するトリガーがあれば削除して作り直す
drop trigger if exists on_auth_user_created on auth.users;

-- auth.users に行が挿入された直後に handle_new_user を呼ぶトリガーを作成
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

commit;
