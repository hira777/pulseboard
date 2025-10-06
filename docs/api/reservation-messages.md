# 予約メッセージ・監査 API

| API | 概要 | ユースケース | 備考 |
| --- | --- | --- | --- |
| `GET /t/{tenantId}/reservations/{id}/messages` | メッセージ一覧 | 運用コメント閲覧 | 権限: メンバー |
| `POST /t/{tenantId}/reservations/{id}/messages` | メッセージ追加 | スタッフ間メモ | フェーズ 5 UI S1 |
| `GET /t/{tenantId}/reservations/{id}/audit-logs` | 重要操作の監査ログ取得 | フェーズ 8 エラー規約/監査 | 権限: Admin |

- メッセージは作成者・本文・作成日時を含めます。
- 監査ログは更新種別と旧値/新値の差分を保持します。
