# 予約可能枠 API

| API | 概要 | ユースケース | 備考 |
| --- | --- | --- | --- |
| `POST /t/{tenantId}/availability:list` | `listAvailability`。指定条件から予約可能なスロット候補を返す | 予約作成ウィザード、カレンダーの「空き枠検索」 | フェーズ 3 のコア。最大 50 件 + `nextCursor` |

## 入力例

```json
{
  "range": { "from": "2025-10-01T09:00:00+09:00", "to": "2025-10-01T15:00:00+09:00" },
  "serviceId": "svc-123",
  "roomId": "room-1",
  "wantedEquipments": [{ "equipmentId": "camera-1", "qty": 2 }],
  "staffId": "staff-1",
  "pageSize": 20
}
```

## 返却例

```json
{
  "slots": [
    {
      "roomId": "room-1",
      "start": "2025-10-01T09:00:00+09:00",
      "end": "2025-10-01T10:00:00+09:00",
      "feasibleEquipmentSets": [{ "items": [{ "equipmentId": "camera-1", "qty": 2 }] }]
    }
  ],
  "nextCursor": "2025-10-01T11:00:00+09:00"
}
```

- 例外や営業時間の考慮順序はフェーズ 4 で再計画します。
- `nextCursor` は ISO8601 形式で返し、後続ページの `range.from` 代わりに利用します。
