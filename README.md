# Viewpoint — 教材オーサリングアプリ

構造化コンポーネント方式で、英語の複雑な文構造などを「視覚的に分かる教材」として作り、HTMLで生徒に即共有できる Web アプリ。AI生成を出発点に、教員がノード単位で細部まで編集します。

> 本リポジトリは [`要件定義.md`](./要件定義.md) のフェーズ1（MVP）実装です。

## 中核コンセプト

見た目（HTML）を直接編集せず、教材を「意味の単位（ノード）」の集合データ `LessonDoc` として持ち、描画はそのデータから自動生成します。編集は常に **データに対して** 行うため、どの粒度でも「選択して編集」が等しく成立し、undo/redo も自明に実装できます。

- **データモデル**: [`lib/types.ts`](./lib/types.ts)（信頼できる唯一の実体）
- **描画（編集ビュー）**: [`app/components/Renderer.tsx`](./app/components/Renderer.tsx)
- **HTML 書き出し（自己完結・レスポンシブ）**: [`lib/exportHtml.ts`](./lib/exportHtml.ts)

## 主な機能（MVP）

- ✅ AI 生成（テキスト＋任意でスケッチ写真 → スキーマ準拠 JSON、失敗時1回自動リトライ）
- ✅ ノード単位の手動編集（見出し・段落・単語・樹形図の root と各枝・注釈・画像・raw）
- ✅ 範囲指定 AI 編集（選択ノードのデータのみ送信し差し替え）
- ✅ undo/redo（履歴スタック、⌘Z / ⇧⌘Z）
- ✅ ビュー / ソース(JSON) / 書き出し(HTML) タブ。JSON 編集も双方向反映
- ✅ 役割パレット編集（色＝意味、色＋ラベルの二重符号化）
- ✅ 教材の保存・一覧・複製・削除

## 技術スタック

- Next.js (App Router) / React / TypeScript
- 永続化: **localStorage**（MVP。`lib/storage.ts` の API を保てば Supabase に差し替え可能）
- AI: **BYOK**（Anthropic Claude / Google Gemini をUIで選択。API キーはブラウザ保存し、サーバールート経由で各社APIへ）
- デプロイ: Vercel

## ローカル実行

```bash
npm install
npm run dev
# http://localhost:3000
```

「⚙ AI 設定」で プロバイダ・モデル・API キーを設定すると AI 生成／編集が使えます。

## MVP からの差分（要件 §9/§10 に対する判断）

| 項目 | 要件の理想 | MVPの実装 | 理由 |
|---|---|---|---|
| 永続化・認証 | Supabase (Postgres+Auth) | localStorage | 環境変数なしで即デプロイ可能にするため。`storage.ts` を差し替えれば移行可 |
| 共有 | 共有URL or ダウンロード | HTML ダウンロード | 共有URLはバックエンド必須のためフェーズ2へ |
| 樹形図レイアウト | dagre/elk/d3-hierarchy | 決定的なCSS入れ子レイアウト | 依存ゼロ・印刷/レスポンシブに強く、構造データから決定的に描画 |

## ディレクトリ

```
lib/            データモデル・純粋変換・検証・HTML書き出し・AI(サーバー)
app/            App Router ページ
  page.tsx          教材一覧
  new/              AI 生成画面
  editor/[id]/      エディタ（ビュー/JSON/HTML、インスペクタ）
  components/        Renderer / Inspector / 履歴フック / AI設定
  api/generate/     AI 下書き生成
  api/edit/         範囲指定 AI 編集
```
