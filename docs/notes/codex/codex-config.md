# Codex CLI Config Reference 実運用ガイド

> 目的: https://github.com/openai/codex/blob/main/docs/config.md の **Config reference** を、現場で迷わないように「いつ使うか/なぜ必要か/注意点/例」まで踏み込んで解説。必要なところだけコピペで使える実用版です。

---

## 使い方の指針

- **原則**: デフォルトで安全寄り → 必要に応じて段階的に許可を広げる。
- **優先度**: `CLIフラグ > --profile/プロファイル > config.toml > デフォルト`。
- **おすすめ**: 日常は「Safe」プロファイル、作業内容に応じて一時的に「Auto/Local」へ切替。

---

## モデル関連

### `model` (string)

- **何をする?** 使用モデルを指定。
- **いつ/なぜ?** 処理精度/コスト/応答速度を調整したい時。軽量モデルで日常タスク、高推論で難案件。
- **注意点**: モデルにより reasoning/verbosity の効果や最大トークンが異なる。
- **例**

  ```toml
  model = "o3"      # 論理推論強め
  # model = "gpt-5" # バランス型
  ```

### `model_provider` (string)

- **何をする?** `model_providers` で定義した接続先を選択。
- **いつ/なぜ?** OpenAI/Azure/互換 API/ローカル(例: Ollama) を切替えたい時。
- **注意点**: Provider を切替えたら `model` の互換性も要確認。
- **例**

  ```toml
  model_provider = "openai-chat-completions"
  ```

### `model_context_window` / `model_max_output_tokens`

- **何をする?** 入力/出力のトークン上限を明示。
- **いつ/なぜ?** 古い CLI で新モデルを使う/長文を意図的に制限したい時。
- **注意点**: モデル側の上限を超える指定は無効。
- **例**

  ```toml
  model_context_window = 200000
  model_max_output_tokens = 4000
  ```

### `model_reasoning_effort`

- **何をする?** 推論の“深さ”を指示。
- **いつ/なぜ?** 難易度の高い修正/設計レビューで正確性を上げたい時。
- **注意点**: コスト/レイテンシ上昇。
- **例**

  ```toml
  model_reasoning_effort = "high"
  ```

### `model_reasoning_summary`

- **何をする?** Reasoning サマリの量を調整。
- **いつ/なぜ?** 実行ログを簡潔にしたい(`concise`)/詳細検証したい(`detailed`)。
- **注意点**: `none` で完全非表示。

### `model_verbosity`

- **何をする?** 応答のテキスト量を調整 (Responses API)。
- **いつ/なぜ?** CI ログや TUI で冗長さを避けたい時。

### `model_supports_reasoning_summaries` / `model_reasoning_summary_format`

- **何をする?** 未知モデルへの強制有効化/出力形式の指定(実験的)。
- **いつ/なぜ?** 互換 API やローカル推論で機能を明示的に使いたい時。

---

## モデルプロバイダ (接続先) 設定

### `model_providers.<id>.*`

- **何をする?** 互換 API/ローカルを含むプロバイダ定義。
- **いつ/なぜ?** OpenAI 以外(Azure, Mistral, Ollama)へ接続する、ヘッダやリトライを細かく制御する。
- **リスク/注意**: 認証鍵の取り扱い(`env_key`)、Azure の `api-version` 指定忘れ。
- **コピペ例**

  ```toml
  [model_providers.openai]
  name = "OpenAI"
  base_url = "https://api.openai.com/v1"
  env_key = "OPENAI_API_KEY"
  request_max_retries = 4
  stream_max_retries   = 10
  stream_idle_timeout_ms = 300000

  # ローカル推論 (Ollama)
  [model_providers.ollama]
  name = "Ollama"
  base_url = "http://localhost:11434/v1"
  ```

---

## 実行承認 (Approval) と サンドボックス

### `approval_policy`

- **何をする?** コマンド実行で承認を求めるタイミング。
- **選び方**

  - **untrusted**: 既定。安全第一。未知コマンドは都度確認。
  - **on-failure**: 失敗時のみ外部再試行の承認を求める。
  - **on-request**: モデルが必要時に昇格要求。
  - **never**: プロンプト無。自動実行に最適だが危険度高。

- **ユースケース**: 日常は `untrusted`、ローカル整備済み CI/検証は `on-failure`、熟練者の短時間作業で `never`。

### `sandbox_mode`

- **何をする?** OS レベルの権限境界。
- **選び方**

  - **read-only**(既定): 参照のみ、書込み/ネットワーク不可。
  - **workspace-write**: CWD と一部 tmp のみ書込可、`.git/`は保護。
  - **danger-full-access**: 無制限。Docker 等の外部サンドボックスが前提の時のみ。

- **補助設定 (`[sandbox_workspace_write]`)**

  - `network_access`: true で外部通信を許可(既定 false)。
  - `writable_roots`: 追加書込ディレクトリ(ビルドツールの shims 等)。

- **ユースケース**: 最初は `read-only` → テスト/フォーマッタ適用時だけ `workspace-write`。

---

## 環境変数の安全設計

### `shell_environment_policy`

- **何をする?** サブプロセスへ渡す環境変数を制御。
- **なぜ必要?** API 鍵やクラウド資格情報の**漏洩防止**。
- **推奨**

  ```toml
  [shell_environment_policy]
  inherit = "core"              # HOME, PATH, USER 等のみを基準に
  exclude = ["*KEY*", "*SECRET*", "*TOKEN*", "AWS_*", "AZURE_*"]
  include_only = ["PATH", "HOME", "USER"]
  set = { CI = "1" }
  ```

- **ユースケース**: 会社 PC/個人 PC ともに常時有効を推奨。

---

## 履歴・通知・エディタ連携

### `history.persistence`

- **何をする?** `$CODEX_HOME/history.jsonl` 保存可否。
- **いつ/なぜ?** 秘匿度が高い時は `none`、再現性が必要なら `save-all`。

### `notify`

- **何をする?** 外部スクリプトへ JSON でイベント通知。
- **ユースケース**: 長時間タスクの完了をデスクトップ通知。

### `file_opener`

- **何をする?** 端末出力のファイル参照をエディタ URI に変換。
- **ユースケース**: `vscode`/`cursor` 等に合わせて変更。

---

## 認証/プロファイル

### `preferred_auth_method` / `chatgpt_base_url`

- **何をする?** 既定の認証手段/ベース URL。
- **ユースケース**: 組織の SSO/プロキシ要件対応。

### `profile` / `profiles.<name>.*`

- **何をする?** 用途別に設定一括切替。
- **おすすめ構成**

  ```toml
  # 既定プロファイル
  profile = "safe"

  [profiles.safe]
  approval_policy = "untrusted"
  sandbox_mode    = "read-only"
  model_reasoning_effort = "medium"

  [profiles.auto]
  approval_policy = "never"
  sandbox_mode    = "workspace-write"
  model_reasoning_effort = "high"

  [profiles.local]
  model_provider = "ollama"
  model = "mistral"
  approval_policy = "on-failure"
  sandbox_mode    = "workspace-write"
  ```

- **使い分け**: `--profile safe` 常用 / `--profile auto` 一時昇格 / `--profile local` 機密コードやオフライン時。

---

## プロジェクト/ドキュメント

### `project_doc_max_bytes`

- **何をする?** `AGENTS.md` の読込上限。
- **いつ/なぜ?** 巨大ドキュメントでのトークン浪費を防止。

### `projects.<path>.trust_level`

- **何をする?** 特定ワークツリーを信頼済みに指定。
- **いつ/なぜ?** 社内の安全なモノレポ等で承認頻度を下げる。

---

## MCP サーバ連携 (ツール拡張)

### `mcp_servers.<id>.command/args/env`

- **何をする?** MCP ツール群の起動方法を定義。
- **いつ/なぜ?** スクレイピング/DB/検索などの社内ツールを安全に統合。
- **例**

  ```toml
  [mcp_servers.web]
  command = "npx"
  args = ["-y", "mcp-server"]
  env  = { API_KEY = "value" }
  ```

---

## 応答保存/実験オプション

### `disable_response_storage`

- **何をする?** モデル応答の保存を無効化。
- **いつ/なぜ?** 規制/社内ポリシー(ZDR 等)で保存禁止の時。

### `experimental_*` 系

- **何をする?** 先行機能の有効化。
- **注意**: 将来変更/削除の可能性。プロジェクト単位で検証。

---

## Web 検索ツール

### `tools.web_search`

- **何をする?** モデルからの Web 検索ツール使用を許可。
- **いつ/なぜ?** ライブラリ選定や最新情報調査を自動化。
- **注意**: ネットワーク越しの情報取り扱いポリシーに従う。

---

# 目的別プリセット (そのまま使える)

## 1) 安全重視 (個人/社内標準)

```toml
model = "gpt-5"
approval_policy = "untrusted"
sandbox_mode    = "read-only"
file_opener     = "vscode"

[shell_environment_policy]
inherit = "core"
exclude = ["*KEY*", "*SECRET*", "*TOKEN*", "AWS_*", "AZURE_*"]
include_only = ["PATH", "HOME", "USER"]

[history]
persistence = "none"
```

## 2) 作業効率優先 (短時間だけ昇格)

```toml
[profiles.auto]
approval_policy = "never"
sandbox_mode    = "workspace-write"
model_reasoning_effort = "high"
```

## 3) ローカル LLM 運用 (完全オフライン志向)

```toml
[model_providers.ollama]
name = "Ollama"
base_url = "http://localhost:11434/v1"

[profiles.local]
model_provider = "ollama"
model = "mistral"
approval_policy = "on-failure"
sandbox_mode    = "workspace-write"
```

---

# 運用チェックリスト

- [ ] まずは `read-only` + `untrusted` で開始
- [ ] `include_only` と `exclude` で環境変数漏洩を抑制
- [ ] `profiles` で一時昇格をワンコマンド化
- [ ] CI や長時間処理は `notify` で完了通知
- [ ] リモート/互換 API は `query_params`/`http_headers` を確認
- [ ] `AGENTS.md` は 32KiB 上限内で要点だけ(上限は `project_doc_max_bytes` 調整)
