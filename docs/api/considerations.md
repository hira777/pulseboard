# 今後検討すべき事項

1. **エラー規約の統一**: すべての API で `code/message/details` 形式を徹底（フェーズ 8）。
2. **ページング設計**: `listAvailability` は `nextCursor`、予約一覧は cursor か offset かを決定する。
3. **認可ポリシー**: Admin と Member の操作範囲を API ごとに明文化し、`docs/db/schema.md` の RLS 方針と揃える。
4. **Idempotency**: 変更系 API（予約作成/更新/キャンセル）は Idempotency-Key を標準化する。
5. **Schema バージョン管理**: 入出力を Zod スキーマで管理し、エラーも型で表現する。

- これらは各 API ドキュメントに反映しつつ、フェーズ進行に合わせて更新します。
