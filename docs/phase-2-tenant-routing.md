# フェーズ 2 作業手順（/t/:tenantId ルーティング基盤）

最小差分で Phase 2 を完了するための実装手順。未権限はページ=404（秘匿）、操作 API/Server Action は 403（拒否）を厳守。

- 目的: 直リンク/ブックマーク可能な `/t/:tenantId` 配下のルーティング基盤を整備し、Cookie 既定テナントによる誘導を実装。
- 対象: Next.js 15 App Router、TypeScript、Supabase（JWT）。
- 参照根拠:
  - roadmap.md「フェーズ 2 テナントルーティング基盤」
  - requirements.md「2. ロール/RBAC（404/403 ポリシー）」「2.1 テナント判定」「13. 受け入れ基準（S1）」

---

## 1. 権限ヘルパー追加（ページ=404 / API=403）

追加: `src/features/auth/tenant.ts`

- `getTenantMembership(tenantId)`: `tenant_users(tenant_id, profile_id, role)` を参照し所属とロールを返す（無ければ `null`）。
- `requireTenantMember(tenantId)`: 未所属は `notFound()`（=HTTP 404）。
- `requireTenantAdmin(tenantId)`: 所属だが admin 以外は `notFound()`（=HTTP 404）。
- `assertTenantRoleForApi(tenantId, required)`: 未所属/ロール不足は `err.status=403` を付与して throw。

実装ポイント:

- サーバ側は `createSupabaseServerClient()` を用いる。
- 「ページは 404、操作は 403」の線引きを徹底（要件の秘匿方針）。

---

## 2. `/t/:tenantId` ルート骨組み

追加: `src/app/t/[tenantId]/layout.tsx`

- 先頭で `await requireTenantMember(params.tenantId)` を呼び秘匿を担保。
- ナビゲーションは `membership.role === 'admin'` のときだけ Admin タブを表示。

追加: `src/app/t/[tenantId]/page.tsx`

- 最小のダッシュボード骨組みを配置（S1 最小）。

---

## 3. テナント選択ページと Cookie 既定テナント

追加: `src/app/t/select/page.tsx`

- 所属テナント一覧を表示（`tenants` は RLS で所属分のみ可視）。
- Server Action で選択した `tenant_id` を `cookies().set('tenant_id', tenantId, { path: '/' })` に保存し、`redirect('/t/:tenantId')`。
- 既に Cookie がある場合は `/t/:tenantId` に即時リダイレクト可。

---

## 4. middleware の更新

更新: `src/middleware.ts`

- 追加: ルート `/` および `/dashboard` アクセス時、Cookie `tenant_id` があれば `/t/:tenantId` へ、無ければ `/t/select` へリダイレクト。
- 追加: `config.matcher` に `'/t/:path*'` を含め、`/t/*` を要ログイン化（未ログインは `/login` へ）。
- 既存 `/admin` ガードは現状維持（将来 `/t/:tenantId/admin` へ移設予定）。

---

## 5. ログイン後遷移の変更

更新: `src/app/(auth)/login/page.tsx`

- ログイン成功時の遷移先を `'/dashboard'` → `'/t/select'` に変更。
- Cookie が有る場合は middleware により `/t/:tenantId` へ誘導される。

---

## 6. E2E 追加（任意だが推奨）

追加: `e2e/tenant-routing.spec.ts`

1. 未ログインで `/t/1111...111` → `/login` にリダイレクト。
2. member が未所属テナント `/t/1111...112` 直打ち → HTTP 404。
3. Cookie `tenant_id=1111...111` 状態で `/` → `/t/1111...111` へ遷移。
4. 所属テナント直リンク `/t/1111...111` → 200 で骨組み表示。

`.env.test` に資格情報が無ければ `test.skip` でスキップ（既存方針に合わせる）。

補足:

- ファイル: `e2e/tenant-routing.spec.ts`（新規）、`e2e/admin.spec.ts`（ログイン後の待機 URL を `/t/select|/t/:tenantId|/dashboard` に更新済み）。
- シード前提: `supabase/seed.sql` のテナント ID 定数を利用
  - 所属あり: `11111111-1111-1111-1111-111111111111`（Acme Studio）
  - 所属なし: `11111111-1111-1111-1111-111111111112`（Apex Studio）
- テスト用環境変数（`.env.test` 例）:

```
E2E_MEMBER_EMAIL=auth-member-acme@example.com
E2E_MEMBER_PASSWORD=1111
E2E_ADMIN_EMAIL=auth-admin-acme@example.com
E2E_ADMIN_PASSWORD=1111
TENANT_ID_STUDIO_A=11111111-1111-1111-1111-111111111111
TENANT_ID_STUDIO_B=11111111-1111-1111-1111-111111111112
```

実行コマンド:

- 画面なし: `pnpm test:e2e`
- 画面表示: `pnpm test:e2e:headed`

---

## 7. ドキュメント/ステータス更新

- 実装後、`PROJECT_STATUS.md` の該当項目を「完了」に更新。
- 参照根拠に `docs/roadmap.md` と `docs/requirements.md` の章番号を追記。

---

## 受け入れ基準（フェーズ 2）

- 直リンク/ブックマークで `/t/:tenantId` 配下が開ける（所属外は 404）。
- Cookie 既定テナントがあるとき `/` → `/t/:tenantId` に誘導、無ければ `/t/select` へ。
- 操作系 API/Server Action で未権限は 403 を返せる（ヘルパーで担保）。

---

## 受け入れ基準チェックリスト（実施用）

- [x] 未ログインで `/t/:tenantId` にアクセスすると `/login` にリダイレクトされる（middleware 経由）。
- [x] ログイン済みで未所属テナントの `/t/:tenantId` は 404（秘匿）。
- [x] 所属テナントの `/t/:tenantId` は 200 で表示され、見出し「Tenant Dashboard」を確認できる。
- [x] Cookie `tenant_id` がある状態で `/` または `/dashboard` へアクセスすると `/t/:tenantId` に誘導される。Cookie が無い場合は `/t/select` に誘導される。
- [x] `/t/select` で所属テナントを選ぶと、Server Action が Cookie `tenant_id` を設定し `/t/:tenantId` に遷移する。
- [x] ページ（RSC/レイアウト）は `requireTenantMember`/`requireTenantAdmin` により権限不足でも 404 を返している（URL 直打ちで確認）。
- [x] API/Server Action は `assertTenantRoleForApi` により未ログイン/未所属/権限不足で 403 を返す（サンプル Action/ハンドラで確認）。
- [x] E2E `e2e/tenant-routing.spec.ts` がグリーン（必要な `E2E_*` を設定時）。

---

## 影響範囲 / 注意点

- 新規ルーティング導入により既存 `/dashboard` は段階的に廃止予定（リンク先を `/t/:tenantId` に移行）。
- 404/403 の方針を厳守（ページ=404、API=403）。
- すべての Server Action/API は `tenant_id` を明示して処理する（RLS 任せにしない）。

---

## 検証手順（再現コマンド）

- 開発起動: `pnpm dev`
- 手動確認:
  - 未ログインで `http://localhost:3000/t/11111111-1111-1111-1111-111111111111` → `/login`。
  - ログイン後 `/t/select` で「Acme Studio」を選択 → `/t/1111...111` 表示。
  - Cookie `tenant_id` を別テナントに変更し `/` へ → 当該テナントへリダイレクト。
  - 未所属テナント ID を直打ち → 404。
- E2E（任意）: `pnpm test:e2e`

---

## 参考/根拠

- docs/roadmap.md: フェーズ 2 テナントルーティング基盤（受け入れ基準含む）
- docs/requirements.md: 2. ロール/RBAC、2.1 テナント判定、13. 受け入れ基準（S1）
