# Project Status

更新履歴: 2025-09-09 初稿

## ✅ 完了（Confirmed Done）

- RLS/制約の基本検証（admin/member 切替で許可/拒否を確認）
- スキーマ初期案の確立（`schema.md`）

## 🚧 進行中（In Progress）

- フェーズ 1: **RLS/制約の実証**
  - Supabase ローカル環境の起動・初期化（`runbook-rls.md` の通り）
  - 想定どおりの許可/拒否、`canceled` 重複対象外の挿入可否など
- フェーズ 2: **/t/:tenantId ルーティング基盤**
  - layout 導入、admin/member のナビ差し替え、未権限は 404、API は 403
- フェーズ 3: **可用枠 API v1**
  - `listAvailability` の IF 確定・ページング・理由コード整備、単体テスト

## 📝 次にやること（Next Up）

1. `/t/:tenantId` のルーティングと権限ガード（直リンク可 / 404 / 403 の整合）
2. `listAvailability` の I/O とエラーハンドリング整備、n≤50 ページング
3. 予約 CRUD の最小エンドポイント雛形と最終競合判定の骨格だけ先行

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
