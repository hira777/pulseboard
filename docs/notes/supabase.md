# Supabase 関連のメモ書き

## `anon`ロールと`authenticated`ロール

Supabase は Postgres を利用しており、Postgres は、ロールという概念を用いてデータベースへのアクセス権限を管理する。

Supabase も様々なロールを作成している。

例えばクライアント（Web/モバイルアプリなど）が Supabase にリクエストを送り、Supabase がログイン状態をチェックして以下のロールをマッピングする。

- `anon`: 認証されていないリクエスト（ユーザーがログインしていない）
- `authenticated`: 認証されたリクエスト（ユーザーがログインしている）

ロールは RLS ポリシーの定義などに利用できる。以下は`authenticated`ロールが対象のポリシー。

```
create policy profiles_select_own
on public.profiles
for select
to authenticated
using (id = auth.uid());
```

> https://supabase.com/docs/guides/database/postgres/row-level-security?utm_source=chatgpt.com#authenticated-and-unauthenticated-roles

ロールのマッピングの仕組み以下を参照。

[Supabase 認証 & RLS の流れ](./supabase-auth-rls-flow.md)

## `auth.uid()`

リクエストを行ったユーザーの ID を返すヘルパー関数。

以下のような RLS ポリシーの定義などに利用できる。

```
create policy profiles_select_own
on public.profiles
for select
to authenticated
using (id = auth.uid());
```

> https://supabase.com/docs/guides/database/postgres/row-level-security?utm_source=chatgpt.com#authuid
