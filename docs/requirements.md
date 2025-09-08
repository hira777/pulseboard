# 予約管理ダッシュボード（撮影スタジオ＋機材レンタル）仕様

本プロダクトの中核機能。撮影スタジオの「部屋」と「機材（個体管理あり）」を同時に扱う実務運用を想定する。

## 1. スコープ/前提

- 対象: 複数スタジオ（部屋）と機材レンタルを伴う撮影予約。
- 粒度: 1 予約 = 1 つの「部屋」必須 ＋ 任意の「機材（複数可）」＋ 任意の「スタッフ」。
- 時間: 既定 15 分刻み（将来 5/10/30 分へ切替可能）。
- タイムゾーン: 店舗 TZ 固定（例: Asia/Tokyo）。

## 2. ロール/RBAC（ページは 404 秘匿、API は 403）

- admin: 全データ閲覧/編集、設定（営業時間/例外日/料金/機材/権限）。
- member: 自部署/担当範囲の予約を閲覧・作成・更新（設定変更不可）。
- 非許可 URL（/admin、予約詳細の直打ちなど）は HTTP 404（存在秘匿）。
- 操作系 API/Server Action は HTTP 403（汎用メッセージ）。
- ロールは「テナント単位」。同一ユーザーが複数テナントに所属可能（`tenant_users(profile_id, tenant_id, role)`）。

### 2.1 テナント判定（推奨）

- 方式: パスベース `/t/:tenantId` を正とする（深いリンク/SSR/キャッシュ分割に有利）。
- 既定選択: 直アクセス時はミドルウェアが Cookie `tenant_id` を参照して既定テナントへ誘導（未設定時はテナント選択画面）。
- UI: ヘッダーにテナントスイッチャーを設置し、切替で Cookie とパスを同期。
- RLS: DB は「所属テナントのみ」可視。アプリ側も必ず `tenant_id` で絞り込み。

## 3. 主要ユースケース

- 予約の作成/変更/キャンセル/リスケ/担当者割当。
- 可用枠の検索（期間・サービス・部屋・機材条件）。
- カレンダー（週/日）と一覧（10 万件仮想スクロール）で運用。
- 衝突検知（部屋/機材/スタッフ）と例外日（休業/メンテ/私用）考慮。
- 予約詳細で内部メモ/スレッドチャット、監査ログ参照。
- リアルタイム更新（他端末の編集反映、楽観更新 →ACK/rollback）。

## 4. 予約ライフサイクルと業務ルール

- 状態: `draft → pending → confirmed → in_use → completed`／`no_show`／`canceled`。
- 仮押さえ(Hold): TTL=10 分（既定）。TTL 超過で自動解放。
- バッファ: サービス既定（例: 前後 15 分）を自動付与。予約単位の上書きは admin のみ可。
- キャンセル規定: 開始 24 時間前まで無料、それ以降は 50%（v1 は表示のみ）。

## 5. 例外日（ブラックアウト）と営業時間

- 営業時間: 曜日ごとの open/close を店舗/部屋で保持。
- 例外日: 店舗全体／部屋個別／機材個別／スタッフ個別をサポート。
  - 判定は「予約が占有する全リソース」に対して適用。
  - スタッフ例外はスタッフを割当てた場合のみ有効。

## 6. 機材モデル（現実対応）

- すべての SKU で個体管理（serial あり）を有効化できる。
- 予約時は SKU レベルで数量確保、引渡し時に個体を割当。
- キット（セット）を定義可能。キットのみ／キット＋単品追加の両方を許容。
- 返却時の不具合（破損/紛失/修理中）は個体ステータスを変更し、以後の可用枠から除外。

## 7. 競合/可用枠ロジック（v1）

- 占有範囲: `[start - buffer_before, end + buffer_after]` を占有として扱う。
- 判定順: 営業時間 → 例外日 → 部屋重複 → 機材在庫（SKU 合計 ≤ stock）→ （任意）スタッフ重複。
- 入力（例）: 期間、サービス、希望部屋、必要機材（`sku: qty`）、（任意）スタッフ。
- 出力（例）: 候補スロット n 件（開始/終了、割当可能な部屋、満たした機材組合せ）をページング返却（n≤50）。

## 8. データモデル（概略）

- `tenants(id, name, slug, created_at)`
- `tenant_users(tenant_id, profile_id, role: admin|member, created_at)`
- `rooms(id, name, capacity, color, open_hours, active)`
- `services(id, name, duration_min, buffer_before_min, buffer_after_min, color)`
- `equipments(id, sku, name, track_serial, stock, active)`
- `equipment_items(id, equipment_id, serial, status: available|repair|lost)`
- `customers(id, name, email, phone, note)`
- `staff(id, profile_id, name, skills(json), active)`
- `reservations(id, tenant_id, customer_id, service_id, room_id, start_at, end_at, status, buffer_before_min, buffer_after_min, note, hold_expires_at, created_by, updated_at, version)`
- `reservation_equipment(reservation_id, equipment_id, qty)`
- `calendar_exceptions(id, scope: tenant|room|equipment|staff, target_id, range:tstzrange, type: holiday|maintenance|ooh|busy, note)`
- `messages(id, reservation_id, sender_profile_id, body, created_at)`（内部メモ）
- `audit_logs(id, actor, action, target_type, target_id, diff(json), at)`

インデックス/制約（要点）

- 部屋重複: `rooms × tstzrange(start,end)+buffers` の重複禁止（EXCLUDE 制約を検討）。
- 機材在庫: 同時刻の `reservation_equipment.qty` 合計 ≤ `equipments.stock`（サーバ最終判定＋将来 DB 補助）。
- 楽観ロック: `reservations.version` を If-Match でチェック（409 を返す）。
- RLS: テナント境界＋ロールで行レベル制御。
  - 各ドメインテーブルは `tenant_id` を保持し、`tenant_users` を用いて所属テナントのみ行レベルで許可。

## 9. API / Server Actions（例）

- `listAvailability(tenant_id, date_range, service_id, wanted_equipments[], room_id?, staff_id?) → slots[]`
- `createReservation(tenant_id, payload) → reservation`（サーバで最終競合判定）
- `updateReservation(tenant_id, id, patch, if_version) → reservation`（version 不一致で 409）
- `cancelReservation(tenant_id, id, reason) → ok`（表示上の違約率を計算）
- `assignEquipmentItems(tenant_id, reservation_id, item_ids[]) → ok`（貸出時個体割当）
- `postMessage(tenant_id, reservation_id, body) → message`
  すべて `requireUser`。管理系は `requireAdmin`。
  - ルーティングから取得: `/t/:tenantId` を信頼し、Server Action/API へ `tenant_id` を明示的に渡す。

## 10. UI/画面

- ダッシュボード: 今日/週の予約数、部屋稼働率、キャンセル率、ライブフィード。
- カレンダー: 週/日ビュー、列=部屋（将来: スタッフ切替）。ドラッグでリスケ（楽観 →ACK/rollback）。
- 一覧: 10 万件仮想テーブル。期間/部屋/機材/状態/顧客/タグでサーバフィルタ/ソート。
- 詳細ドロワー: 顧客・サービス・部屋・機材・バッファ・状態遷移・内部チャット・監査履歴。
- 管理: サービス・料金・営業時間/例外日・機材（SKU/個体/キット）・スタッフ技能。

## 11. リアルタイム/通知

- Topics: `reservations.updated`（diff 付）、`availability.updated`、`messages.new`。
- クライアント: 切断時キュー、指数バックオフ、ACK/rollback の楽観制御。
- 通知: v1 はアプリ内トースト、v2 でメール/Slack Webhook、v3 でカレンダー連携。

## 12. 非機能/セキュリティ/監査

- パフォーマンス: 初期バンドル ≤ 200KB gzip、LCP<2.5s, INP<200ms、カレンダー/一覧 60fps 目標。
- セキュリティ: PII 最小化、CSP、Rate limit、IP/UA ログ、権限昇格は承認フロー。
- 監査: 重要操作（確定/変更/キャンセル/在庫状態/権限変更）を `audit_logs` に記録。

## 13. 受け入れ基準（S1）

- 予約作成: 部屋が必須。例外/競合が無ければ `confirmed` で作成できる。
- リスケ: カレンダーで時間変更 →ACK 後に他クライアントへ反映。
- 競合検知: 部屋重複／機材在庫超過はサーバで不可（明確なエラーメッセージ）。
- 404 秘匿: 非権限ユーザーが `/admin` や予約詳細 URL 直打ち →HTTP 404。
- バッファ: サービス既定を自動適用。admin は予約単位で上書き可。

## 14. 既定値（合意済み）

- 部屋: 必須。機材/スタッフ: 任意。
- 個体管理: すべての SKU で ON。
- キット: キットのみ／キット＋単品の両方を許容。
- バッファ既定: 前後 15 分（予約単位の上書きは admin のみ）。
- キャンセル規定: 24 時間前まで無料、それ以降 50%。
- ホールド TTL: 10 分。最大予約期間: 90 日先まで。
- マルチテナント: 同一ユーザーが複数テナント所属可（`tenant_users`）。
- テナント判定: パス `/t/:tenantId` を正とし、Cookie で既定テナントを補助。
- タイムゾーン/刻み: 店舗 TZ=Asia/Tokyo、刻み=15 分。

## 15. 未確定（確認したい事項）

- テナントの招待/ロール管理フロー（招待メール、自己参加可否、ロール変更承認）
- 料金の詳細ルール（ピーク/オフピーク、最低利用時間、パッケージの優先度）

### 15.1 仕様の不足/要決定（優先順）

- 予約詳細 URL とドロワーの整合: 共有可能な直リンク（`/reservations/:id`）とカレンダー深いリンク（`/calendar?reservationId=...`）の併存方針。
- 料金表示の粒度: ピーク/オフピーク、最低利用時間、税込/税別、通貨/小数処理（v1 は表示のみでもルール明記）。
- スタッフ運用: 可用性モデル（シフト/私用/技能）と「スタッフ必須のサービス」の扱い、重複判定の優先度。
- 例外日と営業時間の境界: 跨ぎ予約（営業終了跨ぎ）、深夜営業の翌日扱い、DST の扱い。
- 可用枠ページング/上限: 候補 `n≤50` の確定、並び順（開始昇順/スコア）と同点解決ルール。
- 重複検知の誤差許容: 刻み未満入力の丸め規則、バッファ適用順序の厳密化。
- 顧客データ: 重複判定キー（email/phone/名前）とマージ方針、PII 最小化・マスキング。
- メッセージ/監査の保持: 保存期間、エクスポート可否、個人情報を含む場合の取り扱い。
- 認証/招待: サインイン方式、テナント招待・ロール変更の承認フロー（S2 で確定範囲）。
- API イディオム: Idempotency-Key、409 時レスポンス形式、バリデーション/エラーコード体系、最大リスト件数。
- 国際化: 表示言語、週開始曜日、祝日カレンダー・ローカライズの方針。
- インポート/エクスポート: 顧客・予約の CSV 入出力、初期データ投入手順。

## 非機能要件

- **パフォーマンス**：Core Web Vitals (LCP/CLS/INP) を達成、初期バンドル ≤ 200KB
- **アクセシビリティ**：キーボード操作完結、`aria` 属性 / コントラスト対応
- **型安全**：API / WS Payload を **TypeScript 型 + Zod** でバリデーション
- **テスト**：ユニットテスト + E2E テスト

---

## スプリント計画（提案）

- S1（基盤）: スキーマ/マイグレーション、可用枠 API v1、予約 CRUD、週ビュー/一覧の骨組み。
- S2（運用）: 個体割当・例外日・料金表示、通知（アプリ内）・監査ログ、チャット。

---

## 9.1 API/エラー規約（追補）

- Idempotency: 変更系は `Idempotency-Key`（ヘッダー）を受け付け、同一キー重送は重複作成を防止。
- 楽観制御: 予約更新は `If-Match: <version>` 必須。版ずれは `409` と最新 `reservation` を返却。
- エラー表現: `code`（機械判定用）/`message`（ユーザー表示）/`details`（フィールドエラー配列）。
  - 代表コード: `ROOM_CONFLICT`／`EQUIPMENT_STOCK_EXCEEDED`／`OUT_OF_BUSINESS_HOURS`／`BLACKOUT`／`VERSION_MISMATCH`。
- リスト API: ページングは `cursor`（次ページトークン）と `limit`（最大 100）。
- 共通クエリ: 期間は `from`/`to`（ISO8601, 店舗 TZ 基準）。

## 10.1 画面/ルーティング定義（詳細）

- 共通: すべての URL は `/t/:tenantId` 配下。未認可ページは 404（秘匿）、操作 API は 403（既定どおり）。

1. ダッシュボード

   - パス: `/t/:tenantId/`
   - 目的: 今日/週の KPI と最近の更新を俯瞰。
   - 権限: admin, member
   - 操作: 期間切替、ショートカット（予約作成/カレンダー/一覧）。

2. カレンダー（週/日）

   - パス: `/t/:tenantId/calendar/week`, `/t/:tenantId/calendar/day`
   - 目的: 部屋列での可視化、ドラッグ作成/リスケ。
   - 権限: admin, member
   - 操作: 予約の D&D 移動・リサイズ、詳細ドロワー起動、部屋/サービス/状態フィルタ。
   - Deep link: `/t/:tenantId/calendar/week?reservationId=:id` で該当予約をフォーカス。

3. 可用枠検索

   - パス: `/t/:tenantId/availability`
   - 目的: 条件から候補スロットを検索し予約作成へ。
   - 権限: admin, member
   - 操作: 期間/サービス/部屋/機材/スタッフ条件 → 候補表示 → 作成へ遷移。

4. 予約一覧

   - パス: `/t/:tenantId/reservations`
   - 目的: 大量データの検索・運用。
   - 権限: admin, member
   - 操作: サーバフィルタ/ソート、仮想スクロール、CSV エクスポート（将来）。
   - クエリ: `status`, `roomId`, `serviceId`, `customer`, `from`, `to`。

5. 予約作成（ウィザード/モーダル）

   - パス: `/t/:tenantId/reservations/new`
   - 目的: サービス → 日時 → 部屋 → 機材 → 顧客 → 確認の段階的作成。
   - 権限: admin, member
   - 操作: 作成開始時に仮押さえ（TTL=10 分）。確定時に最終競合チェック →`confirmed`。

6. 予約詳細（ドロワー/直リンク）

   - パス: `/t/:tenantId/reservations/:id`
   - 目的: 状態遷移、内部メモ、監査、機材割当。
   - 権限: admin, member
   - 操作: `pending/confirmed/in_use/completed/canceled` 遷移、ノート/メッセージ投稿、監査参照。

7. 顧客

   - パス: `/t/:tenantId/customers`, `/t/:tenantId/customers/:id`
   - 目的: 顧客情報の CRUD。
   - 権限: admin, member

8. 機材（SKU）

   - パス: `/t/:tenantId/equipments`, `/t/:tenantId/equipments/:id`
   - 目的: 在庫/キット定義、SKU 有効/無効。
   - 権限: admin

9. 個体管理（シリアル）

   - パス: `/t/:tenantId/equipments/:id/items`, `/t/:tenantId/equipment-items/:itemId`
   - 目的: 個体の状態更新（available/repair/lost）。
   - 権限: admin

10. 部屋管理

- パス: `/t/:tenantId/rooms`
- 目的: 営業時間・表示色・収容人数の管理。
- 権限: admin

11. サービス管理

- パス: `/t/:tenantId/services`
- 目的: 所要時間・バッファ・色の設定。
- 権限: admin

12. 例外日管理

- パス: `/t/:tenantId/exceptions`
- 目的: 店舗/部屋/機材/スタッフの休業・メンテ等を登録。
- 権限: admin

13. スタッフ管理

- パス: `/t/:tenantId/staff`, `/t/:tenantId/staff/:id`
- 目的: スキル・稼働/私用例外の管理。
- 権限: admin

14. 監査ログ

- パス: `/t/:tenantId/audit-logs`
- 目的: 重要操作の履歴参照。
- 権限: admin

15. 設定/管理トップ

- パス: `/t/:tenantId/admin`
- 目的: 料金表示設定・権限・テナント設定の集約。
- 権限: admin

## 10.2 主要フロー（UI シーケンス要約）

- 予約作成

  1. サービス選択 → 所要時間/バッファ適用。
  2. 日時/部屋を選択 → サーバで競合なしなら仮押さえ開始（TTL=10 分）。
  3. 機材 SKU 数量を確保（在庫合計で判定）。
  4. 顧客入力 → 確認 → 作成 API 呼出（最終競合チェック）。
  5. 作成成功で `confirmed`。TTL 切れは UI で案内し再検索へ。

- リスケ（カレンダー）

  1. D&D で開始・終了を変更（楽観反映）。
  2. サーバ ACK で確定 → 他クライアントへ配信。
  3. 競合発生時はロールバック＋理由表示（部屋重複/在庫/例外/営業時間外）。

- 機材個体割当/返却
  1. 引渡し時に個体（serial）を予約へ紐付け。
  2. 返却時に `available/repair/lost` を更新。repair/lost は可用枠から除外。

## 13.1 受け入れ基準の追補（S1）

- 直リンク: `/t/:tenantId/reservations/:id` へ直接アクセスすると詳細ドロワー/ページが開く（未認可は 404）。
- 仮押さえ: 予約作成開始から TTL 内は同一リソースの二重確保不可。TTL 切れで自動解放と UI 通知。
- 楽観制御: `If-Match: version` 不一致は 409 ＋最新スナップショットを返却。UI は差分提示。
- カレンダー操作: D&D 後に ACK を待ち、失敗時は元位置へロールバック。
- 例外/営業時間: 営業外/例外日は UI で抑止し、理由コードを表示。

## 16. 設計ドキュメントタスク（追記）

- 画面ごとのワイヤーフレーム草案を作成（各画面 1 枚・主要操作の確認）。
- 予約作成/リスケのシーケンス図（UI↔API↔DB）を 1 枚追加。
