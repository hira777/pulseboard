import { NextResponse, type NextRequest } from 'next/server'

export function middleware(_req: NextRequest) {
  // 後でここに「未ログインなら /login へ」などのガードを入れる
  return NextResponse.next()
}

// ガードしたいルートを事前に宣言だけしとく
export const config = {
  matcher: ['/dashboard/:path*', '/admin/:path*'],
}
