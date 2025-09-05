# Auth Spec

## セッション管理

- Supabase Auth による JWT ベース
- Cookie 保存、middleware で getAll/setAll で同期
- Server Actions でも signOut() → Cookie 更新

## ルート保護

- middleware: /dashboard, /admin, /chat を保護
- SSR 側でも getUser() で二重チェック
- 未ログインなら /(auth)/login へリダイレクト

## RBAC

- profiles.role を利用（admin / member）
- /admin は admin のみアクセス可
- UI も role に応じてボタン/メニューを出し分け

## 将来拡張

- organizations / memberships によるマルチテナント
- RLS: 所属 org のみ参照/編集可能
