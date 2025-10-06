# フェーズ 3 予約作成フロー (UC-1) 作業順序案

## 概要

フェーズ 3 では予約作成 API を中心に、仕様整理 → バリデーションと競合判定 → テスト計画の順で進めます。以下の手順は各ステップで作成する成果物と参照ドキュメントを明示し、チーム内共有を容易にすることを目的としています。

## 手順リスト

- [ ] API 仕様策定 — `POST /t/{tenantId}/reservations` の入出力とエラー規約を整理し、ドラフトを `docs/api/reservations.md` に反映する。
  - インプット: `docs/requirements.md`, `docs/db/schema.md`, `docs/notes/uc1-preconditions.md`。
  - 成果物: 主要パラメータ一覧、レスポンス例（成功／候補なし／409）、エラーコード定義、Idempotency 方針メモ。
  - 留意点: Server Action で実装する想定か REST 化するかを決め、認可と RLS の整合を確認する。
- [ ] バリデーション・競合チェック整理 — 入力検証とリソース競合ロジックを洗い出し、実装タスク化する。
  - インプット: スキーマ仕様、`calendar_exceptions` / `reservation_equipment_items` のドキュメント。
  - 成果物: チェックリスト（必須項目、時間帯検証、例外日判定、部屋 EXCLUDE、機材個体割当、スタッフ重複）、処理順序のメモ。
  - 留意点: タイムゾーン変換ポイント（店舗 TZ ↔ UTC）とバッファ適用範囲を明記し、例外処理時のエラーハンドリングを仕様と揃える。
- [ ] テスト計画 — 正常系と例外系を網羅するテスト戦略をまとめ、実装担当に引き渡す。
  - インプット: 上記仕様ドラフト、既存テスト構成（`tests/features/`）。
  - 成果物: 単体テストケース一覧（正常／候補なし／409 競合／境界値）、必要なモックやフィクスチャのメモ、将来的な E2E 追加の検討メモ。
  - 留意点: 予約可能枠 API との依存やデータ整合性を確認し、テストデータ生成手順を記録する。

## 次のアクション例

- [ ] 上記チェックリストを PROJECT_STATUS.md の該当タスクと紐づけ、進捗更新の基準にする。
- [ ] API 仕様ドラフトレビュー後、バリデーション・競合チェックの具体的な実装タスクを Issue 化する。
- [ ] テスト計画をもとに `tests/features/reservations/` 配下のテストファイル構成案を作成する。

## バリデーション・競合チェック詳細タスク

- [ ] 時間帯検証タスクの洗い出し — `startAt`/`endAt` の前後関係、15 分刻み、タイムゾーン変換をユーティリティ化する（`toUtcRange`, `validateSlotIncrement` など）。
- [ ] 営業時間・例外適用タスク — `rooms.open_hours` と `calendar_exceptions` を突合し、占有区間を差し引く処理フローを予約作成用に整理する。
- [ ] バッファ反映タスク — サービス既定値と `bufferOverride` を合成し、占有時間帯を算出するユースケースを定義する。
- [ ] 機材在庫タスク — SKU 存在チェック、個体自動割当、既存貸出との衝突判定をパーツ化する。
- [ ] スタッフ重複タスク — 指定スタッフの既存予約・例外との重複判定ロジックを分解し、複数スタッフ指定時の方針を追記する。
- [ ] 顧客/リソース有効性タスク — `rooms.active`, `customers.status`, `services` 等のアクティブ確認をまとめ、エラーコードとの対応表を作る。

## 例外・在庫・スタッフ重複の整理メモ

- [ ] `calendar_exceptions` の適用順序と `target_id=null` の扱いを明文化し、`RESERVATIONS_CLOSED_SCOPE` を返す条件（テナント/部屋/機材/スタッフ単位）を記録する。
- [ ] 在庫判定の前提を整理（SKU 在庫 vs 個体管理、`reservation_equipment_items` の EXCLUDE 制約・トリガーを確認）し、必要なデータ取得 API をメモする。
- [ ] スタッフ重複チェックで再利用するデータ（`reservations.time_range`, `staff_id`）を取得するクエリやインデックスを確認し、複数スタッフ指定時の扱いを追記する。

## availability コード再利用メモ

- [ ] 再利用予定の関数を確認する — `src/features/availability/server.ts` の `buildCalendarContext`, `buildReservationContext`, `buildEquipmentAvailabilityContext`, `subtractIntervals`, `parsePgRange` などを共通化候補として列挙し、移動先モジュール案をまとめる。
- [ ] 予約可能枠専用で不要になる処理を特定する — `listAvailability`, `buildCandidateSlotsForRooms`, `finalizeSlots`, `generateCandidateSlots` などを削除/分解する際の注意点（テスト影響・共有定数）をメモする。
- [ ] 既存ファイルの型定義（`NormalizedAvailabilityInput`, `CandidateSlot` など）をどこまで流用するか判断し、残す/移す/破棄の方針と依存箇所を洗い出す。
