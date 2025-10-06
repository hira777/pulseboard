# 予約 CRUD API

<!-- prettier-ignore-start -->
| API | 概要 | ユースケース | 備考 |
| --- | --- | --- | --- |
| `POST /t/{tenantId}/reservations` | 新規予約作成（部屋 + 機材 + スタッフ + 顧客） | Idempotency-Key + 409 対応を想定 |
| `PATCH /t/{tenantId}/reservations/{id}` | 予約日時・割当変更 | UC-2 リスケ | `If-Match` ヘッダー、差分返却 |
| `DELETE /t/{tenantId}/reservations/{id}` | キャンセル（ステータス制御） | UC-3 キャンセル | `status='canceled'` に更新 |
| `GET /t/{tenantId}/reservations` | 期間・部屋・ステータスで検索 | カレンダー / リスト表示 | 分割ページング or カーソル |
| `GET /t/{tenantId}/reservations/{id}` | 予約詳細 | 予約ドロワー、履歴表示 | 機材・スタッフ・顧客情報を含む |
<!-- prettier-ignore-end -->

## 予約作成 API `POST /t/{tenantId}/reservations`

予約を作成するエンドポイント。

### リクエストヘッダー

- `Idempotency-Key`（任意）
- `If-None-Match`（未使用）
- `Cookie`（必須）: Supabase セッション

### リクエスト項目

<!-- prettier-ignore-start -->
| フィールド | 型 / 例 | 必須 | 説明 |
| --- | --- | --- | --- |
| `tenantId` (path) | `"tn-123"` | ✅ | テナント識別子。URL で指定。 |
| `serviceId` | `"svc-101"` | 任意 | サービス。指定すると所要時間とバッファを自動適用。 |
| `roomId` | `"room-1"` | ✅ | 利用する部屋。`rooms.active=true` を要求。 |
| `startAt` | `"2025-10-05T10:00:00+09:00"` | ✅ | 店舗タイムゾーンでの開始時刻。サーバで UTC に変換。 |
| `endAt` | `"2025-10-05T12:00:00+09:00"` | ✅ | 店舗タイムゾーンでの終了時刻。`endAt > startAt`。 |
| `bufferOverride` | `{ "beforeMin": 15, "afterMin": 0 }` | 任意 | サービス既定のバッファを上書き。占有時間に反映。 |
| `equipmentRequests` | `[{ "equipmentId": "cam-a", "quantity": 2 }]` | 任意 | SKU 単位の必要数量。個体はサーバ側で自動割当。 |
| `staffIds` | `["staff-1"]` | 任意 | 担当スタッフ ID の配列。重複不可。 |
| `customerId` | `"cust-9"` | 任意 | 既存顧客 ID。 |
| `notes` | `"事前搬入あり"` | 任意 | 内部メモ。最大 2000 文字。 |
<!-- prettier-ignore-end -->

### 成功レスポンス（201 Created）

```json
{
  "id": "resv-9001",
  "status": "confirmed",
  "roomId": "room-1",
  "startAt": "2025-10-05T01:00:00Z",
  "endAt": "2025-10-05T03:00:00Z",
  "buffer": { "beforeMin": 15, "afterMin": 0 },
  "equipmentItems": [
    { "equipmentItemId": "cam-a-01", "equipmentId": "cam-a" },
    { "equipmentItemId": "cam-a-07", "equipmentId": "cam-a" }
  ],
  "staffIds": ["staff-1"],
  "customerId": "cust-9"
}
```

### 候補なしレスポンス（422 Unprocessable Content）

```json
{
  "code": "RESERVATIONS_NO_SLOTS",
  "message": "指定条件に予約可能枠がありません",
  "details": {
    "conflicts": []
  }
}
```

### 競合レスポンス（409 Conflict）

```json
{
  "code": "RESERVATIONS_VALIDATION_FAILED",
  "message": "部屋または機材が既存予約と重複しています",
  "details": {
    "room": {
      "reservationId": "resv-8001",
      "timeRange": ["2025-10-05T01:00:00Z", "2025-10-05T03:00:00Z"]
    },
    "equipment": ["cam-a-01"],
    "staff": []
  }
}
```

### エラーコード一覧

- `RESERVATIONS_VALIDATION_FAILED`(HTTP 422): 入力値が条件（必須・型・範囲）を満たさない。
- `RESERVATIONS_NO_SLOTS`(HTTP 422): 営業時間・例外日・在庫のいずれかで候補がない。
- `RESERVATIONS_CONFLICT`(HTTP 409): 部屋・機材・スタッフの重複検知。
- `RESERVATIONS_CLOSED_SCOPE`(HTTP 409): `calendar_exceptions` により休業中。
- `RESERVATIONS_DISABLED_RESOURCE`(HTTP 400): `rooms.active=false` など利用不可リソース指定。

### バリデーションルール（ドラフト）

- 予約時間: `startAt` < `endAt` かつ同一タイムゾーンで解釈。15 分刻みを前提とし、端数はエラー。
- 営業時間: `rooms.open_hours` とテナントの曜日設定内に収まること。例外日（`calendar_exceptions`）は先に除外。
- バッファ: サービス既定＋上書き値で占有範囲を計算し、部屋 EXCLUDE 制約に送る。
- 機材: `equipmentRequests` の SKU が存在し、必要数量が在庫数以下。個体は空き個体から自動割当。
- スタッフ: 指定された `staffIds` がテナント所属で、同時間帯の予約と重複しない。
- 顧客: `customerId` がテナント所属で `status='active'`。未指定の場合は仮顧客レコードを作らず通す。
