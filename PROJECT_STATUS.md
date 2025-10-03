# Project Status

- 更新履歴:
  - 2025-10-03 フェーズ3を「予約作成フロー (UC-1)」へ変更
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

### フェーズ 2: **/t/:slug ルーティング基盤**

- ルーティング導入: `/t/[slug]/layout.tsx`（URL 値は slug。所属チェック → 未所属は `notFound()`=404）
- ダッシュボード骨組み: `/t/[slug]/page.tsx`
- テナント選択: `/t/select/page.tsx`（Server Action で `tenant_id` Cookie 設定 → リダイレクトは `/t/:slug`）
- 404 UI 統一: `app/not-found.tsx` + `app/__404`（middleware からの rewrite 用）
- middleware: `/` と `/dashboard` を Cookie 既定テナントの slug へ誘導、`/t/*` 要ログイン、`/admin` 未権限は `__404` へ rewrite
- 権限ヘルパー: `src/features/auth/tenant.ts`（ページ=404、API/Action=403 の分離）
- E2E: `e2e/tenant-routing.spec.ts` を追加（直リンク/404/既定テナント誘導の検証）

## 🚧 進行中（In Progress）

- フェーズ 3: **予約作成フロー (UC-1)**
  - `POST /t/{tenantId}/reservations` の入出力・エラー規約の確定
  - 予約作成時のバリデーション（サービス/部屋/機材/スタッフ/日時）
  - 競合チェック（部屋 EXCLUDE・機材在庫・スタッフ重複）、例外日チェック
  - 正常系・例外系（候補なし・409）の単体テスト整備

## 📝 次にやること（Next Up）

1. 予約作成 API の設計ドキュメント作成（IF/エラーコード/検証ルール）
2. バリデーションと競合チェックを備えた予約作成ロジックの実装
3. 例外日・機材割当ロジックを単体テストで再現

## 🐞 Known Issues / リスク

- ブラウザ間（特に Safari）での Cookie/セッション同期の不安定さ
- RLS 例外ケース（予約のリスケと在庫の同時更新など）未テスト
- WebSocket/リアルタイム反映は v1 では最小（トースト通知程度）

## 📊 KPI / 完了基準（S1）

- RLS/制約：想定どおりの許可/拒否が再現
- 予約 CRUD：二重送信なし。版ずれ時ロールバック＋差分提示
- 可用枠 API：期待件数・順序・理由コード一致、ページング正常（フェーズ4で再開）
- UI：ダッシュボード最小、予約作成/編集/取消の一連操作が完了可能

## 📚 参照

- 要件: `docs/requirements.md`
- スキーマ: `docs/db/schema.md`
- RLS 実証: `docs/archives/runbook-rls.md`
- ロードマップ: `docs/roadmap.md`
- API 概要: `docs/design/api-overview.md`
