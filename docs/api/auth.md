# 認証・テナント選択 API

| API | 概要 | 主なユースケース | 備考 |
| --- | --- | --- | --- |
| `POST /sessions` | メール + パスワードでサインイン | フェーズ 2: `/t/:slug` への誘導の起点 | Supabase Auth を利用（Server Action 経由） |
| `GET /tenants` | 所属テナント一覧の取得 | ログイン直後のテナント選択ダイアログ | 権限: メンバー以上 |
| `POST /tenants/{tenantId}/select` | アクティブテナントの選択（Cookie 更新） | 直リンク時の `/t/:slug` リダイレクト | 既存 middleware ロジックと連携 |

- すべてのリクエストは Supabase セッション Cookie を前提とします。
- レスポンス形式は他の API と同じく `code/message/details` へ揃える計画です。
