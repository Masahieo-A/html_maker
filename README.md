# Viewpoint — 教材オーサリングアプリ

構造化コンポーネント方式で、英語の複雑な文構造などを「視覚的に分かる教材」として作り、HTMLで生徒に即共有できる Web アプリ。AI生成を出発点に、教員がノード単位で細部まで編集します。

- リポジトリ: https://github.com/Masahieo-A/html_maker
- 元仕様: [`要件定義.md`](./要件定義.md)（本リポジトリはフェーズ1=MVPの実装）

---

## 1. これは何をするアプリか

1. **AIで下書き生成**: 英文や着眼点のテキスト（＋任意で手書きスケッチ写真）を入力 → AIが構造化データ（`LessonDoc`）を生成。
2. **ノード単位で編集**: 見出し・段落・単語1語・樹形図の枝・注釈などをクリックして、右のインスペクタで編集。色は「意味（働き）」を表す役割パレットで管理。
3. **HTMLで配布**: 同じデータから自己完結HTML（CSSインライン・レスポンシブ・印刷可）を書き出し、生徒に配布。

中核思想：**見た目（HTML）を直接編集しない。** 教材は「意味の単位（ノード）」の集合データとして持ち、描画はそのデータから自動生成する。編集は常にデータに対して行うので、どの粒度でも「選択して編集」が成立し、undo/redo も自明。

---

## 2. APIキーはどこに入れる？（重要）

AI生成・編集には Anthropic（Claude）か Google（Gemini）のAPIキーが必要です。**2通りの入れ方**があり、両方に対応しています。

### 方式A：サーバー環境変数（推奨・入力不要）
Vercel のプロジェクト設定 → **Settings → Environment Variables** に以下を登録：

| 変数名 | 用途 |
|---|---|
| `ANTHROPIC_API_KEY` | Claude を使う場合（`sk-ant-...`） |
| `GEMINI_API_KEY` | Gemini を使う場合（`AIza...`） |

- 登録後に **再デプロイ**（Deployments → 最新 → Redeploy、または `main` に push）すると反映。
- これで**UIでのキー入力は不要**になります（アプリの「⚙ AI設定」にも「サーバー側に設定済み」と表示）。
- キーは Vercel のサーバー側にだけ存在し、**ブラウザにもGitHubにも出ません**。判定用エンドポイント [`/api/config`](./app/api/config/route.ts) は真偽だけを返し、値は返しません。

> キー発行先：Claude → https://console.anthropic.com/ ／ Gemini → https://aistudio.google.com/apikey

### 方式B：UIで入力（BYOK / 環境変数が無い場合のフォールバック）
アプリ右上「⚙ AI設定」でプロバイダ・モデル・キーを入力 → そのブラウザの localStorage に保存（**毎回ではなくブラウザごとに1回**）。複数人で使う・課金を各自に分けたい場合に有効。

**キー解決の順序**（[`app/api/generate/route.ts`](./app/api/generate/route.ts) / [`app/api/edit/route.ts`](./app/api/edit/route.ts)）:
`リクエスト(UI入力) → サーバー環境変数` の順。どちらも無ければ 400 エラー。

---

## 3. 作った教材の保存と公開

- **保存**: 編集すると教材データ（`LessonDoc`）が**自動でブラウザに保存**（明示「保存」ボタンもあり）。トップの一覧から再編集・複製・削除できます。
- **公開（生徒配布）**: エディタの **「書き出し(HTML)」タブ → ⬇ HTMLをダウンロード**。自己完結HTMLが**1ファイル**で出ます。メール添付／LMS／Google Drive で配布、または GitHub Pages 等に置けば共有URLになります。

> ⚠️ MVPの制約：教材データはブラウザの localStorage 保存なので、**別端末を開くと一覧は共有されません**（書き出したHTML自体はどの端末でも開けます）。端末間同期・閲覧専用の共有URLが必要なら「4. データベース」を参照。

---

## 4. データベースは必要？

**MVPでは不要**です（だから環境変数ゼロでも動く）。次が欲しくなったら必要になります（要件§7：Supabase）：

- 端末間での教材の同期・共有 / 教員アカウント（認証）ごとの管理 / 閲覧専用の共有URL

永続化は [`lib/storage.ts`](./lib/storage.ts) のAPIに閉じてあるので、ここを Supabase 実装に差し替えれば移行できます（呼び出し側のページは変更不要）。

---

## 5. ディレクトリ構成

```
lib/                        ロジック（UIから独立した「背骨」）
  types.ts                  ★ データモデル LessonDoc（信頼できる唯一の実体）
  docOps.ts                 LessonDocへの純粋変換（編集＝新しいdocを返す→undo/redoが自明）
  validate.ts               AI出力(JSON)の安全なパース・正規化・id補完
  exportHtml.ts             LessonDoc → 自己完結HTML（CSSインライン・レスポンシブ・印刷可）
  sample.ts                 サンプル教材
  storage.ts                永続化(localStorage)＋AI設定＋サーバーキー判定 ← Supabase差し替え点
  aiServer.ts               サーバー専用：Anthropic/Gemini呼び出しの抽象化
  prompts.ts                AIへのシステムプロンプト（JSONのみ返させる）
  ids.ts                    一意ID生成

app/                        Next.js App Router
  layout.tsx                ルートレイアウト
  globals.css               全スタイル
  page.tsx                  教材一覧（新規/複製/削除）
  new/page.tsx              AI生成画面（テキスト＋スケッチ写真）
  editor/[id]/page.tsx      ★ エディタ（ビュー/JSON/HTMLタブ、undo/redo、保存、書き出し）
  components/
    Renderer.tsx            データ→編集ビュー（クリックでノード選択）
    Inspector.tsx           選択ノードのプロパティ編集＋範囲指定AI編集＋役割パレット
    AiSettings.tsx          BYOK設定モーダル
    useHistory.ts           undo/redo（履歴スタック）
  api/
    generate/route.ts       AI下書き生成（JSON厳格＋1回リトライ）
    edit/route.ts           範囲指定AI編集（選択ノードのみ送信→差し替え）
    config/route.ts         サーバーにキーがあるかの真偽だけ返す
```

データモデル（`LessonDoc`）の詳細は [`lib/types.ts`](./lib/types.ts) と 要件定義.md §4 を参照。

---

## 6. セキュリティ / Git に入れない情報

- [`.gitignore`](./.gitignore) で `node_modules` / `.next` / `.env`・`.env*.local` / `.vercel` を除外済み。
- APIキーはコードにハードコードしていません。**環境変数（サーバー）** か **localStorage（ブラウザ）** にのみ存在し、リポジトリには構造上入りません。
- ローカルで試す場合に環境変数を使うなら、`.env.local` に書けば自動で gitignore されます：
  ```
  ANTHROPIC_API_KEY=sk-ant-...
  # または
  GEMINI_API_KEY=AIza...
  ```

---

## 7. ローカル実行

```bash
npm install
npm run dev      # http://localhost:3000
# 本番ビルド確認:
npm run build && npm run start
```

キーは「⚙ AI設定」で入れるか、`.env.local` に環境変数で置けばUI入力なしで使えます。

---

## 8. 技術スタック

- Next.js (App Router) / React / TypeScript
- 永続化: localStorage（MVP。`lib/storage.ts`でSupabaseに差し替え可能）
- AI: Anthropic Claude / Google Gemini（サーバー環境変数 or UIでのBYOK、モデル選択可）
- 樹形図: 依存ゼロの決定的CSS入れ子レイアウト（構造データから決定的に描画）
- デプロイ: Vercel

## 9. MVPからの差分（要件 §9/§10 に対する判断）

| 項目 | 要件の理想 | MVPの実装 | 理由 |
|---|---|---|---|
| 永続化・認証 | Supabase (Postgres+Auth) | localStorage | 環境変数なしで即デプロイ。`storage.ts`差し替えで移行可 |
| 共有 | 共有URL or ダウンロード | HTMLダウンロード | 共有URLはバックエンド必須のためフェーズ2 |
| 樹形図 | dagre/elk/d3-hierarchy | 決定的CSS入れ子 | 依存ゼロ・印刷/レスポンシブに強い |
