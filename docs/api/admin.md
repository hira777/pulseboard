# 管理系 CRUD API

| API | 概要 | ユースケース | 備考 |
| --- | --- | --- | --- |
| `POST /t/{tenantId}/rooms` / `PATCH` / `DELETE` | 部屋情報の管理 | 管理画面 S1 | Admin 権限必須 |
| `POST /t/{tenantId}/services` / `PATCH` / `DELETE` | サービス管理 | メニュー更新 | バッファ/価格等も対象 |
| `POST /t/{tenantId}/equipments` / `PATCH` | 機材 SKU／在庫更新 | 在庫調整、個体状態変更 | `track_serial` 切替時の扱いを定義 |
| `POST /t/{tenantId}/staff` / `PATCH` | スタッフ管理 | 稼働設定・技能タグ調整 | `tenant_users` との同期が必要 |

- 削除操作は論理削除を前提にし、`active=false` 切替で運用する想定です。
- 変更系 API は `If-Match` と `Idempotency-Key` を採用し、重複や版ずれを防ぎます。
