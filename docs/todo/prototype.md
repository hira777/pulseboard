# プロトタイプ実装タスク（Sprint 0）

最小構成で縦に一通りの流れ（ログイン → プロフィール → KPI 表示 → RBAC）を通す。

---

## 1) profiles の RLS/トリガーを dev に適用

**目的**
本人以外は読めない DB の土台を固める。

**やること**

- `public.profiles` 作成、RLS 有効化、select/update「本人のみ」ポリシー
- `auth.users` AFTER INSERT トリガーで `profiles` 自動作成
- Supabase migration ファイルにまとめる

**触るファイル**

- `/supabase/migrations/0001_profiles.sql`

**完了条件**

- 新規ユーザー登録時に `profiles` に自動で 1 行作成される
- RLS 下で `auth.uid()` != id の行は読めない

**コミットメッセージ例**

---

## 2) /dashboard にプロフィール編集フォーム（display_name）

**目的**
Server Action 経由で 1 レコード更新できるようにする。

**やること**

- `dashboard/page.tsx` に display_name 編集フォーム追加
- Server Action で `supabase.from('profiles').update(...)` を実行

**触るファイル**

- `src/app/dashboard/page.tsx`

**完了条件**

- display_name 更新後、リロードなしで反映される

**コミットメッセージ例**

---

## 3) WS 抽象の薄い雛形（内部は setInterval モック）

**目的**
後で本物の WebSocket に差し替え可能な IF を先に固定。

**やること**

- `src/shared/ws/connection.ts` を新規作成
- `connect / disconnect / subscribe / send` の形だけ定義
- 内部は `setInterval` でダミー KPI イベントを流す

**触るファイル**

- `src/shared/ws/connection.ts`

**完了条件**

- `subscribe('metrics', cb)` で数値が 2 秒ごとに届く

**コミットメッセージ例**

---

## 4) ダッシュボードに KPI カード 4 枚＋接続ステータス

**目的**
リアルタイム表示の表面を作る。

**やること**

- ダッシュボードで WS の `subscribe('metrics')` を利用
- KPI（注文数/売上/エラー率/平均応答など）4 枚を表示
- 接続ステータス（connecting/open/closed）を画面上部バナーで表示

**触るファイル**

- `src/app/dashboard/page.tsx`
- `src/shared/ui/StatusBanner.tsx`（任意）

**完了条件**

- KPI 数値が 2 秒ごとに更新される
- `disconnect()` で切断バナーが表示される

**コミットメッセージ例**

---

## 5) /admin ページ雛形＋ SSR ロールチェック（member は 403）

**目的**
RBAC の入口を固める。

**やること**

- `src/app/admin/page.tsx` を新規作成
- SSR で `getUser()` → `profiles.role` を参照
- admin 以外は 403 表示（notFound でも可）

**触るファイル**

- `src/app/admin/page.tsx`

**完了条件**

- admin ユーザーのみ `/admin` が表示される
- member でアクセスすると 403 表示

**コミットメッセージ例**

---

## （任意）ダミー 10 万件の仮想テーブル骨組み

**目的**
仮想化の体感と API 設計を見据える。

**やること**

- `src/app/dashboard/orders-demo.tsx` を新規作成
- クライアントでダミーデータ 10 万件生成
- `@tanstack/react-virtual` で仮想スクロール

**完了条件**

- スクロールが滑らか（60fps に近い）

**コミットメッセージ例**
