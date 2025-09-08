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

## 非機能要件

- **パフォーマンス**：Core Web Vitals (LCP/CLS/INP) を達成、初期バンドル ≤ 200KB
- **アクセシビリティ**：キーボード操作完結、`aria` 属性 / コントラスト対応
- **型安全**：API / WS Payload を **TypeScript 型 + Zod** でバリデーション
- **テスト**：ユニットテスト + E2E テスト

---

## スプリント計画（提案）

- S1（基盤）: スキーマ/マイグレーション、可用枠 API v1、予約 CRUD、週ビュー/一覧の骨組み。
- S2（運用）: 個体割当・例外日・料金表示、通知（アプリ内）・監査ログ、チャット。
