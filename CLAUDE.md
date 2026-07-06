# html_maker（教材オーサリングアプリ「Viewpoint」）

- PDF＋指示から AI が構造化教材データ（LessonDoc）を生成 → ノード単位で編集 → 自己完結HTMLを書き出して生徒に配布するアプリ。
- Next.js 15（App Router・TypeScript）+ React。AI は Anthropic Claude / Google Gemini（APIキーは Vercel 環境変数か画面入力）。
- コマンド: `npm run dev` / `build` / `start` / `lint`。
- デプロイ: GitHub `Masahieo-A/html_maker` → Vercel（所有者が手動作成・Import、push は SSH のみ）。
- 中核思想: 見た目のHTMLを直接編集しない。教材はノードの集合データとして持ち、描画はデータから自動生成する。
- 元仕様は `docs/要件定義.md`（本リポジトリはフェーズ1=MVP）。
- ファイル役割: README.md=公開用 / docs/要件定義.md=機能要件（バイブコーディング時の正） / docs/構成.md=開発者向け構成メモ。
