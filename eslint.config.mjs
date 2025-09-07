import { dirname } from 'path'
import { fileURLToPath } from 'url'

import { FlatCompat } from '@eslint/eslintrc'
import pluginImport from 'eslint-plugin-import'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const compat = new FlatCompat({
  baseDirectory: __dirname,
})

const eslintConfig = [
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    ignores: ['node_modules/**', '.next/**', 'out/**', 'build/**', 'next-env.d.ts'],
  },
  {
    plugins: {
      import: pluginImport,
    },
    rules: {
      'import/order': [
        'error',
        {
          // import を「どんな種類か」で分類して並び替えるためのルール
          groups: [
            // Node.js の標準モジュール (fs, path, url など)
            'builtin',
            // npm でインストールしたパッケージ (react, next, lodash など)
            'external',
            // プロジェクト内のエイリアス import (@/lib/utils など)
            'internal',
            // 相対パス import (../utils, ./Foo, ./index)
            ['parent', 'sibling', 'index'],
            // import * as foo from 'bar' みたいなオブジェクト形式
            'object',
            // import type { User } from './types' みたいな型専用import
            'type',
          ],
          // 特殊なパスパターンを「どのグループに入れるか」の指定
          pathGroups: [
            {
              // 「@/」で始まるパス（例: '@/features/xxx'）
              pattern: '@/**',
              // internal として扱う
              group: 'internal',
              // external の後に置く
              position: 'after',
            },
          ],
          // 「pathGroups の例外対象にする import 種別」を指定
          pathGroupsExcludedImportTypes: ['builtin'],
          'newlines-between': 'always', // グループごとに空行
          alphabetize: {
            // A → Z の昇順
            order: 'asc',
            // 大文字小文字を区別しない
            caseInsensitive: true,
          },
        },
      ],
    },
  },
]

export default eslintConfig
