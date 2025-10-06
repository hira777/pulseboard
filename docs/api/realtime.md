# リアルタイム・通知 API

| API | 概要 | ユースケース | 備考 |
| --- | --- | --- | --- |
| `GET /t/{tenantId}/events` (SSE/WS) | `reservations.updated` などを配信 | 複数端末の同時更新 | Supabase Realtime/Edge Functions 想定 |
| `POST /t/{tenantId}/notifications` | アプリ内トースト通知キュー登録 | UI の ACK/rollback 通知 | 最小実装はサーバ側のみ |

- SSE/WS 経路はフェーズ 7 以降で段階導入予定です。
- 通知キューは将来のマルチチャネル配信（メール/SMS）を見据えて拡張可能にします。
