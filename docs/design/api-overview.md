# Pulseboard API Overview

このドキュメントは Pulseboard のサーバー API 一覧への入口です。詳細な仕様は `docs/api/` 配下へ分割しました。`docs/requirements.md` や `docs/roadmap.md` とあわせて参照し、各フェーズで必要なエンドポイントを把握してください。

- バックエンド: Next.js 15 + Supabase (PostgreSQL / RLS) / Node.js 22
- すべてのエンドポイントは `/t/{tenantId}/...` または `/t/{tenantSlug}/...` を前提とし、テナント境界を強制

## ドキュメント一覧

- [認証・テナント選択](../api/auth.md)
- [マスタ参照 API](../api/master-data.md)
- [予約可能枠 API](../api/availability.md)
- [予約 CRUD API](../api/reservations.md)
- [予約メッセージ・監査 API](../api/reservation-messages.md)
- [カレンダー例外 API](../api/calendar-exceptions.md)
- [顧客・補助マスタ API](../api/customers.md)
- [リアルタイム・通知 API](../api/realtime.md)
- [管理系 CRUD API](../api/admin.md)
- [今後検討すべき事項](../api/considerations.md)

## 利用メモ

- 各 API ドキュメントは入力例・レスポンス例・エラーコード・バリデーション（必要に応じて）を記載しています。
- 追加したい API が出たら `docs/api/` に新しいファイルを作成し、この一覧へのリンクを追加してください。
- フェーズ再編などで優先度が変わる場合は `docs/roadmap.md` と併せて更新します。
