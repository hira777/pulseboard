import { Client } from 'pg'

/**
 * - TEST_DB_URL 環境変数を利用して PostgreSQL に接続するためのユーティリティ。
 * - Jest などのテストコードで利用しやすいように、pg.Client のインスタンスを作成して接続した状態で返す。
 * - ※ 呼び出し側で必ず `await c.end()` を実行して接続を閉じる責任がある。
 */
export async function connect() {
  const c = new Client({ connectionString: process.env.TEST_DB_URL })
  await c.connect()
  return c
}

/**
 * - テスト用に Postgres に一時的に接続し、引数で受け取った処理（fn）を実行してから必ず切断する。
 * - jest の各テストケースごとに「使い捨て接続」を確実に閉じられるようにするためのユーティリティ。
 *
 * @param fn - 実際のDB操作を行う非同期関数（引数としてpg.Clientを受け取る）
 * @returns fn の戻り値
 */
export async function withPg<T>(fn: (c: Client) => Promise<T>) {
  // 環境変数から接続先を取得
  const c = new Client({ connectionString: process.env.TEST_DB_URL })
  // DB接続開始
  await c.connect()
  try {
    // fnに接続済みクライアントを渡して処理実行
    return await fn(c)
  } finally {
    // 成否に関わらず必ず接続終了
    await c.end()
  }
}

/**
 * - SupabaseのRLSは「現在のユーザーをJWTクレームから判定」するため、
 *   テスト内で任意のユーザーID(sub)・ロール(role)をトランザクションローカルで再現ためのユーティリティ。
 * - 実際には `set role authenticated` と `set session request.jwt.claims` を発行する。
 *
 * @param c - withPg で確立した pg.Client
 * @param sub - 再現したいユーザーのUUID（auth.uid() がこれになる）
 * @param role - 認証ロール（通常は 'authenticated'）
 */
export async function impersonateTxLocal(c: Client, sub: string, role = 'authenticated') {
  // Postgresのロールをauthユーザーに切替
  await c.query(`set role authenticated`)
  // JWTクレームをセッション変数にセット
  // 例: {"sub":"<uuid>","role":"authenticated"}
  await c.query(`select set_config('request.jwt.claims', $1, true)`, [
    JSON.stringify({ sub, role }),
  ])
}
