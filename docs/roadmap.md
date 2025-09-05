# Roadmap / TODO

## 現在地

- [x] Next.js プロジェクト構築
- [x] Supabase 接続と認証
- [x] middleware によるセッション同期
- [x] /dashboard でユーザー情報表示
- [x] profiles テーブル作成と RLS ポリシー

---

## プロトタイプ（最小構成）TODO

- [ ] profiles: RLS & トリガーを dev に適用
- [ ] /dashboard: プロフィール編集フォーム（display_name 更新）
- [ ] /shared/ws/connection.ts: 薄いインターフェース定義（内部は setInterval モック）
- [ ] KPI カード（4 枚）と接続ステータスバナー
- [ ] /admin: SSR で role チェック → member は 403
- [ ] ダミー 10 万件を生成して仮想リスト描画（API は後で）
- [ ] reportError(): console.error 実装（Sentry 導入は後で）

---

## 直近 TODO

- [ ] logout 後の UI 改善（フラッシュ表示）
- [ ] admin/member で UI を出し分け
- [ ] /admin: RBAC 実装強化
- [ ] Server Action でのエラーハンドリング

---

## 中期 TODO（リアルタイム）

- [ ] WebSocket 接続 Hook 実装（再接続, ping/pong, キュー処理）
- [ ] KPI ダッシュボードに push 更新を反映
- [ ] ライブイベントフィードを仮想リスト化
- [ ] Toast 通知（接続切断/復旧）

---

## 中期 TODO（大規模テーブル）

- [ ] 注文一覧テーブル作成（5〜10 万件）
- [ ] サーバ側ページング / ソート / フィルタ
- [ ] 仮想スクロール実装
- [ ] 検索 UI と URL 同期

---

## 中期 TODO（チャット）

- [ ] /chat ページ作成
- [ ] presence / typing
- [ ] メッセージ送信（楽観的 UI）
- [ ] ACK / 失敗リトライ
- [ ] 未読/既読管理
- [ ] オフラインキュー

---

## 品質改善

- [ ] Core Web Vitals 測定 & チューニング
- [ ] 初期バンドル 200KB 以下に最適化
- [ ] A11y チェック（キーボード操作・aria）
- [ ] テスト（ユニット/E2E）
