import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({
    request,
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        // Supabase が「今のセッション状態を確認するとき」に実行される
        // 例えば supabase.auth.getClaims() などを実行した時に
        // 現在の Cookie を参照するために Supabase が getAll を実行する
        getAll() {
          return request.cookies.getAll()
        },
        // Supabase が「セッション Cookie を更新する必要があるとき」に実行される
        // - ログイン時（supabase.auth.signInWithPassword）
        // - セッション更新時（リフレッシュトークンで新しい JWT を発行したとき）
        // - ログアウト時（セッション Cookie を削除する必要があるとき）
        // cookiesToSet には最新の Cookie が含まれるため、こちらはそれを
        // リクエストやレスポンスに反映させる必要がある。
        setAll(cookiesToSet) {
          // request.cookies を更新し、現在のサーバ処理内で最新のセッションを参照できるようにする
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          // NextResponse を再生成して最新の状態を反映(ミドルウェア内の以降の処理でセッション関連の処理がある場合再生成は必須)
          response = NextResponse.next({
            request,
          })
          // ブラウザに返すレスポンスに Cookie をセット
          // HTTP レスポンスヘッダー Set-Cookie が付与される
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          )
        },
      },
    },
  )

  // セッションに紐づく JWT Claims（ユーザー情報やロールなど）を取得
  // これを呼ぶことで Supabase が内部的にセッションを検証＆更新する
  const { data } = await supabase.auth.getClaims()
  const user = data?.claims

  if (!user && request.nextUrl.pathname.startsWith('/dashboard')) {
    const url = request.nextUrl.clone()
    url.pathname = '/auth/login'
    return NextResponse.redirect(url)
  }

  // セッションが更新された Cookie を含むレスポンスを返す
  return response
}

// middleware を適用するルートの設定
export const config = {
  matcher: ['/dashboard/:path*', '/admin/:path*'],
}
