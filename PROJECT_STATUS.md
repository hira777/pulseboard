# Project Status

- 更新履歴:
  - 2025-09-14 フェーズ 2 完了
  - 2025-09-12 フェーズ 1 完了
  - 2025-09-09 初稿

## ✅ 完了（Confirmed Done）

- RLS/制約の基本検証（admin/member 切替で許可/拒否を確認）
- スキーマ初期案の確立（`schema.md`）

### フェーズ 1: **RLS/制約の実証**

- Supabase ローカル環境の起動・初期化（`runbook-rls.md` の通り）
- 想定どおりの許可/拒否、`canceled` 重複対象外の挿入可否など

`runbook-rls.md`で記載されていたテスト方法は手動の想定だったが、Jest で自動テストができるようにテスト環境を整備した。

実行するテストは以下のファイル。

- `tests/db/rls.test.ts`

それに伴い`runbook-rls.md`は不要になったが、アーカイブとして残しておきたいので`docs/archives/`に移動した。

### フェーズ 2: **/t/:tenantId ルーティング基盤**

- ルーティング導入: `/t/[tenantId]/layout.tsx`（所属チェック → 未所属は `notFound()`=404）
- ダッシュボード骨組み: `/t/[tenantId]/page.tsx`
- テナント選択: `/t/select/page.tsx`（Server Action で `tenant_id` Cookie 設定 → リダイレクト）
- 404 UI 統一: `app/not-found.tsx` + `app/__404`（middleware からの rewrite 用）
- middleware: `/` と `/dashboard` を Cookie 既定テナントへ誘導、`/t/*` 要ログイン、`/admin` 未権限は `__404` へ rewrite
- 権限ヘルパー: `src/features/auth/tenant.ts`（ページ=404、API/Action=403 の分離）
- E2E: `e2e/tenant-routing.spec.ts` を追加（直リンク/404/既定テナント誘導の検証）

## 🚧 進行中（In Progress）

- フェーズ 3: **可用枠 API v1**
  - `listAvailability` の IF 確定・ページング・理由コード整備、単体テスト

## 📝 次にやること（Next Up）

1. `listAvailability` の I/O とエラーハンドリング整備、n≤50 ページング
2. 予約 CRUD の最小エンドポイント雛形と最終競合判定の骨格だけ先行
3. `/t/:tenantId/admin` への移行方針検討（現状 `/admin` リンクの段階的整理）

## 🐞 Known Issues / リスク

- ブラウザ間（特に Safari）での Cookie/セッション同期の不安定さ
- RLS 例外ケース（予約のリスケと在庫の同時更新など）未テスト
- WebSocket/リアルタイム反映は v1 では最小（トースト通知程度）

## 📊 KPI / 完了基準（S1）

- RLS/制約：想定どおりの許可/拒否が再現
- 可用枠 API：期待件数・順序・理由コード一致、ページング正常
- 予約 CRUD：二重送信なし。版ずれ時ロールバック＋差分提示
- UI：ダッシュボード最小、予約作成/編集/取消の一連操作が完了可能

## 📚 参照

- 要件: `docs/requirements.md`
- スキーマ: `docs/schema.md`
- RLS 実証: `docs/runbook-rls.md`
- ロードマップ: `docs/roadmap.md`
