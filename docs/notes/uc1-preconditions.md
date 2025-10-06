# UC-1 前提条件メモ

## 要件ドキュメントからの整理

参照: `docs/requirements.md`

- ユーザーは対象テナントに所属しログイン済み（UC-1 前提条件）。
- 予約作成は「部屋 1 件」と開始/終了時刻を必須とし、「機材（複数可）」「スタッフ（任意）」「顧客」は追加選択できる。
- 時間刻みは既定 15 分。サービス設定で前後バッファ（分）を持ち、占有判定に含める。時刻は DB 保管時に UTC へ揃え、アプリ層で店舗 TZ（DST 無し前提）と往復変換する。
- 予約可能枠は営業時間、例外日、部屋・機材・スタッフの重複を順番にチェックして算出。
- 営業時間は曜日別に店舗/部屋で保持し、`open_hours` JSON は曜日キーごとに `{start,end}` の配列で管理。`end<start` の枠は翌日に跨ぎ、24 時間営業は `00:00-24:00` で表現。祝日や臨時変更は `calendar_exceptions` で上書きする。
- 競合チェックは「部屋 → 機材個体 → スタッフ」の順で二重予約を阻止。
- 機材は SKU と個体で管理し、予約確定時にシステムが空いている個体を自動で選んで必要数ぶんの個体 ID を割り当てる。
- 予約確定後は `confirmed` 状態で保存し、予約可能枠が無い場合は候補なし、競合検知時は 409 を返す。
- 予約のバッファ情報は占有時間に含める。占有時間帯はバッファ込みで算出する必要がある。

## スキーマドキュメントからの整理

参照: `docs/db/schema.md`および`docs/db/tables/*.md`

- テナント分離: 主要テーブルは `(tenant_id, id)` の複合キーで一意。RLS によりメンバーのみ参照・予約の書込が許可（schema.md RLS 方針）。
- `reservations` テーブル
  - EXCLUDE 制約で「room_id × time_range」の重複を防止。`time_range`は開始/終了＋バッファから生成（reservations.md）。
  - ステータスは`confirmed`などの限定値。確定時に`time_range`が値を持ち占有判定に使われる。
  - `buffer_before_min` / `buffer_after_min` を保持し、実際の占有範囲へ反映する。
- `reservation_equipment_items`
  - 機材個体割当を保持し、空き個体を自動選択して登録する。`equipment_item_id × reservation_time_range`の EXCLUDE 制約で重複貸出を防止（reservation_equipment_items.md）。
  - 予約更新時はトリガで`reservation_time_range`を同期する。
- `calendar_exceptions`
  - scope により tenant / room / equipment / staff 単位で例外時間帯を管理し、`target_id=NULL`の場合は scope 全体に適用（calendar_exceptions.md）。
  - 適用範囲の例外に重なる予約は抑止・警告が必要。
- `rooms`
  - `open_hours`JSON で曜日別営業時間を保持。`active`フラグによる利用可否を管理（rooms.md）。
- `services`
  - `duration_min`と前後バッファで占有時間を決定する（schema.md の Master Data 節）。
- 全テーブルで RLS が有効。アプリ層は `tenant_id` に基づき SELECT・INSERT・UPDATE を行う必要がある。
