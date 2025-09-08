export function render403Html(options?: { title?: string; message?: string }) {
  const title = options?.title ?? '403 – Forbidden'
  const message =
    options?.message ?? 'このページは管理者（admin）のみがアクセス可能です。'

  return `<!doctype html>
<html lang="ja">
  <head>
    <meta charSet="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <style>
      :root { color-scheme: light dark; }
      body { font-family: system-ui, -apple-system, Segoe UI, Roboto, Noto Sans, Ubuntu, Cantarell, 'Helvetica Neue', Arial, 'Apple Color Emoji', 'Segoe UI Emoji';
             margin: 0; padding: 24px; line-height: 1.6; }
      .container { max-width: 720px; margin: 0 auto; }
      h1 { font-size: 24px; margin: 0 0 8px; }
      p { margin: 0 0 12px; }
      a { color: #0b5fff; text-decoration: none; }
      .hint { opacity: .7; font-size: 14px; }
    </style>
  </head>
  <body>
    <main class="container">
      <h1>${title}</h1>
      <p>${message}</p>
      <p class="hint"><a href="/">ホームに戻る</a></p>
    </main>
  </body>
</html>`
}

