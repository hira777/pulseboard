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

  const pathname = request.nextUrl.pathname

  // ルートと /dashboard は既定テナントへ誘導（Cookie が無ければ /t/select）
  if (pathname === '/' || pathname === '/dashboard') {
    const cookieTenant = request.cookies.get('tenant_id')?.value
    const url = request.nextUrl.clone()
    if (!cookieTenant) {
      url.pathname = '/t/select'
    } else {
      // Cookie には tenant_id(UUID) を格納する前提。slug を解決できなければ選択画面へ。
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser()
        if (user) {
          const { data } = await supabase
            .from('tenants')
            .select('slug')
            .eq('id', cookieTenant)
            .maybeSingle()
          if (data?.slug) {
            url.pathname = `/t/${data.slug as string}`
          } else {
            url.pathname = '/t/select'
          }
        } else {
          url.pathname = '/login'
        }
      } catch {
        url.pathname = '/t/select'
      }
    }
    const redirectResponse = NextResponse.redirect(url)
    for (const c of response.cookies.getAll()) redirectResponse.cookies.set(c)
    return redirectResponse
  }

  // /t/* と /admin は要ログイン
  if (pathname.startsWith('/t') || pathname.startsWith('/admin')) {
    // ユーザー取得（必要に応じてSupabase が内部的にセッションを検証＆更新する）
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      const url = request.nextUrl.clone()
      url.pathname = '/login'
      const redirectResponse = NextResponse.redirect(url)
      // middleware 内で更新された Cookie を引き継ぐ
      for (const c of response.cookies.getAll()) redirectResponse.cookies.set(c)
      return redirectResponse
    }

    // admin 未権限は __404 に rewrite（最終的に app/not-found.tsx へ合流）
    if (pathname.startsWith('/admin')) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .maybeSingle()

      if (!profile || profile.role !== 'admin') {
        const url = request.nextUrl.clone()
        url.pathname = '/__404'
        const rewrite = NextResponse.rewrite(url)
        for (const c of response.cookies.getAll()) rewrite.cookies.set(c)
        return rewrite
      }
    }
  }

  // セッションが更新された Cookie を含むレスポンスを返す
  return response
}

// middleware を適用するルートの設定
export const config = {
  matcher: ['/', '/dashboard/:path*', '/admin/:path*', '/t/:path*'],
}
