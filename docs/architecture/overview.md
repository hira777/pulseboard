# Architecture Overview

## スタック

- Next.js 14 (App Router, TypeScript)
- Supabase (Auth / Postgres / RLS)
- React Query（サーバ状態管理）
- Zustand（UI 状態管理）
- TanStack Table + @tanstack/react-virtual（大規模テーブル）
- WebSocket (Socket.IO or ws) — リアルタイム通信基盤
- React Hook Form + Zod（フォーム/バリデーション）
- shadcn/ui（UI コンポーネント）

## 認証の流れ（要約）

1. ログイン → Supabase Auth が JWT を発行 → Cookie に保存
2. middleware / Server Action が Supabase セッションを同期
3. DB 接続は `authenticated` ロールで行われ、`auth.uid()` が有効
4. RLS により「本人のみ参照可能」などの制約を DB レイヤで強制

## ディレクトリ構成（抜粋）

```
src/
  app/
    (auth)/login/page.tsx      # ログイン
    dashboard/page.tsx         # 認証後ダッシュボード
    admin/page.tsx             # RBAC: admin 専用
    chat/page.tsx              # リアルタイムチャット
  lib/
    supabase/
      client.ts                # createSupabaseBrowserClient
      server.ts                # createSupabaseServerClient
    ws/connection.ts           # WebSocket 接続抽象
  middleware.ts                # セッション更新/保護
docs/
  architecture/
  db/
  specs/
```

## セキュリティの基本方針

- クライアントは anon key のみ利用
- RLS 常時 ON
- RBAC により admin / member の制御
- SECURITY DEFINER 関数は search_path を固定し完全修飾

## パフォーマンス・品質

- Core Web Vitals: LCP < 2.5s, CLS < 0.1, INP < 200ms
- 初期バンドルサイズ 200KB 以下
- SSR/ISR の活用、コード分割、Memo 化
- キーボード操作可能 / aria 属性適切化 / 色コントラスト遵守
