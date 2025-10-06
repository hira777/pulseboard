# カレンダー例外 API

| API | 概要 | ユースケース | 備考 |
| --- | --- | --- | --- |
| `GET /t/{tenantId}/calendar-exceptions` | 休業/メンテ情報参照 | カレンダー描画、予約可能枠除外 | scope: tenant/room/equipment/staff |
| `POST /t/{tenantId}/calendar-exceptions` | 例外追加 | 管理画面で稼働調整 | フェーズ 6 管理画面 S1 |
| `DELETE /t/{tenantId}/calendar-exceptions/{id}` | 例外削除 | 管理画面 | 権限: Admin |

- `scope` と `target_id` で対象リソースを特定します。`target_id=null` は scope 全体への適用を意味します。
- 予約作成時は例外範囲と重なると 409 を返す方針です。
