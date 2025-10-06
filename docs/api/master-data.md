# マスタ参照 API

| API | 概要 | ユースケース | 備考 |
| --- | --- | --- | --- |
| `GET /t/{tenantId}/rooms` | 部屋一覧 + 営業時間・カラー等 | 予約作成フォーム、カレンダー初期表示 | `open_hours` JSON で営業時間を返す |
| `GET /t/{tenantId}/services` | サービス一覧 + 所要時間・前後バッファ | 予約メニュー選択、スロット長の算出 | フェーズ 3 で利用 |
| `GET /t/{tenantId}/equipments` | SKU 在庫・個体管理フラグ | 機材追加ダイアログ、予約可能枠条件 | `track_serial` / `stock` を返却 |
| `GET /t/{tenantId}/staff` | スタッフ一覧 + スキルタグ | スタッフ割当、フィルタリング | 将来の技能マッチングにも対応 |

- すべてテナント境界を `/t/{tenantId}` で強制します。
- レスポンスには `updatedAt` や `active` など UI で必要な最小項目を持たせる計画です。
