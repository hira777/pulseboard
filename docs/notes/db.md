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
