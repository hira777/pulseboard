# Supabase 認証 & RLS の流れ

Supabase はユーザーがログイン済みかどうかで、`authenticated`か`anon`ロールで DB に接続する時がある。

しかし、どのような仕組みやタイミングでそれを行っているかわからなかったので、以下のように図にしてもらった。

```text
[ブラウザ / クライアント]
   │
   │ 1. ログイン (supabase.auth.signInWithPassword)
   │    ↓
   │    JWT が発行され Cookie に保存
   │
   └───── リクエスト (JWT付き Cookie / Authorizationヘッダー)
             ↓
[Supabase サーバー: GoTrue + PostgREST]
   │
   │ 2. JWT 検証
   │    - 署名が正しいか (秘密鍵で検証)
   │    - 有効期限が切れてないか
   │    - 中に user_id が入っているか
   │
   │ 3. 検証成功なら
   │    - このリクエストは "authenticated ロール"
   │    - user_id をセッションに紐づける
   │
   └───── DB にクエリを投げる
             ↓
[Postgres DB]
   │
   │ 4. DBセッションは "authenticated" ロールとして動作
   │    auth.uid() = このリクエストの user_id
   │
   │ 5. RLS ポリシーを評価
   │    例: using (id = auth.uid())
   │        → 自分の行だけ返す
   │
   └───── 結果を返す
             ↓
[ブラウザ / クライアント]
   │
   │ 6. 自分のデータだけが返ってくる
```
