# shared-equipment — AI エージェント向けリポジトリガイド

検証用スマホ・共用 PC・プロジェクター・撮影機材など、みんなで使う機材の予約・貸出・返却のテンプレートアプリです。
改修するときの入口としてこのファイルを読んでください。デザインの正は [`DESIGN.md`](./DESIGN.md)、変更の場所別ガイドは
[`CUSTOMIZE.md`](./CUSTOMIZE.md)、改修プロンプト例は [`PROMPTS.md`](./PROMPTS.md) です。

## スタック

- **SvelteKit 3**(`@sveltejs/adapter-node`)+ **Svelte 5**(runes)+ **Tailwind CSS v4**
- **DB**: libSQL(`@libsql/client`)。本番はマネージド libSQL、ローカルはファイル
- **社員**: Keelson Directory API(`@keelsonhq/identity` の `listMembers`)。管理者が代理で予約・貸出するときの候補
- **添付**: Keelson のファイルストア(`@keelsonhq/files`)
- **QR コード**: `qrcode`(サーバーで SVG を作る。型は `src/lib/server/domain/qrcode.d.ts` の自前の宣言)
- **定期実行**: `keelson.yaml` の `crons`(返却の通知 `return-reminder`。Node が TypeScript をそのまま実行する)
- **AI アシスタント(MCP)**: `keelson.yaml` の `mcp:` にツールを宣言する。MCP と OAuth は Keelson のゲートウェイが話し、
  アプリは `POST /api/mcp/<ツール名>`(本文 = ツールの引数の JSON)を受けるだけ
- **品質ツール**: Vite+(`vp check` = Oxfmt + Oxlint + TS 型検査、`vp test` = Vitest)/ svelte-check(`pnpm typecheck`)/
  Playwright の e2e(`pnpm e2e`。`check` とは別。下の「e2e」)。
  テストの import は `vite-plus/test`(`vitest` 直指定は lint が止める)。`package.json` の `vite` の別名指定(`npm:@voidzero-dev/vite-plus-core`)と
  `overrides` / `pnpm` ブロックは Vite+ の配線なので触らない(版を上げるときは `vite-plus` と別名の版を同時に上げる)
- 版と確認日は [`DEPENDENCIES.md`](./DEPENDENCIES.md)

SvelteKit 3 の注意: 設定は `vite.config.ts` の `sveltekit({...})` に書く(`svelte.config.js` は使わない)。
`$lib` は廃止され、`package.json` の `imports` による **`#lib/*`** を使う。`goto` のオプションは
`replace` / `reset`(旧 `replaceState` / `keepFocus` / `noScroll` ではない)。

## ディレクトリ構成

```
src/
  hooks.server.ts        起動時の準備(ready.ts)と /api の認証(信頼ヘッダ → 401)
  app.html / app.css     書体の読み込み / Tailwind テーマ(DESIGN.md §5 のトークン)
  app.d.ts               event.locals.actor(認証済みの利用者)の型
  routes/
    +layout.svelte       アプリシェル(背表紙・ナビ・バナー・トースト)。ssr=false(+layout.ts)
    +error.svelte        ページが見つからない・表示できないときの画面
    +page.svelte         ホーム(管理者。一般利用者は /me へ)
    equipment/           機材の一覧・機材詳細([id])・ラベル印刷([id]/label)。全員の画面。その画面だけの部品(LedgerTable など)も同じフォルダに置く
    reservations/  me/   予約・自分のページ(全員。DESIGN.md §9)
    (admin)/             管理者の画面(route group: フォルダ名は URL に入らない)。+layout.svelte が管理者でない人に 403 の表示を出す
      history/  import/  masters/   各画面(DESIGN.md §9)
    api/**/+server.ts    API の薄い入口(入力を読み、業務処理層を呼び、結果を返す)
    api/mcp/[tool]/+server.ts   AI アシスタントのツールの入口(POST /api/mcp/<ツール名>)
    api/[...rest]/+server.ts    どれにも当たらない /api のパスに 404 `{ "error": "not_found" }`
  lib/
    server/              サーバー側。業務処理層(domain/)と、それを API・AI アシスタント・CSV・定期実行に出す配管
      domain/            業務処理層。認可・整合性・履歴はすべてここ(機能別。components/ の箱と同じ名前)
        equipment.ts     機材の一覧(状態・7 日の帯・集計)・登録・編集・利用停止。一般利用者に見せる範囲(forViewer)
        reservations.ts  予約・取消・予約の一覧
        loans.ts         貸出・返却・延長・貸出台帳
        me.ts / home.ts  自分のページ / ホーム
        notifications.ts / notify.ts   返却の通知(対象の選び方・冪等・再試行)/ 通知 Webhook への送信。cron から Node が直接実行する
        directory.ts     社員の名簿(Directory API)。ほかの層は人についてここに尋ねる
        events.ts        履歴(操作の記録)
        attachments.ts / files.ts   添付 / ファイルストア
        qr.ts            機材ページの QR コード(SVG。型は qrcode.d.ts の自前の宣言)
        masters.ts / seed.ts        種類・保管場所 / 初期値とローカル用サンプルの投入
      jobs/              定期実行の入口(return-reminder.ts)
      mcp/               AI アシスタント(MCP)のツール。登録簿と本体は registry.ts、引数の読み方は args.ts、名前の引き当ては refs.ts
      import/            CSV の形式(csv.ts)と取込(importer.ts)
      http/              API 入口の配管(+server.ts が使う。業務の判断はしない)
      auth/              利用者の解決(actor.ts)・管理者の判定(guard.ts)・GET /api/me(session.ts)
      db/                接続・migration の呼び出し・名前付き引数の規則(named.ts)・行の読み取り(rows.ts。SELECT に無い列を読むと例外)
      content.ts         サーバーが出す日本語(CSV の見出し・通知の本文など)
      errors.ts          安定エラーコードと HTTP status の表(下の「エラーコード規約」)
      env.ts / dates.ts / ready.ts   環境変数 / 日付と壁時計時刻 / 起動時の準備
    components/          画面部品。ui/ は業務の語を持たない共通部品、ほかは機能別(server/domain/ と同じ名前)
      PageTitle.svelte   アプリ名とタブの題
      ui/                共通部品(ダイアログ・メニュー・タブ・候補から選ぶ入力欄・表の部品など。下の「部品の見た目と操作は 1 か所に」)
      equipment/         機材の部品(管理番号・状態チップ・7 日の帯・機材の選択・登録と編集(項目の表示名の表も)・利用停止・添付)
      reservations/      予約のダイアログ・予約の表・予約の状態チップ・取消の確認
      loans/             貸出・返却・返却予定の変更のダイアログと、その対象(loanTarget.ts)・貸出台帳
      people/            社員の表示・メンバー外のチップ・社員の選択
      events/            履歴の表・履歴の種類・履歴の詳細の整形
    state/               画面で共有する状態と、API からの読み込み(loader.svelte.ts)
    messages.ts          エラーコード → 日本語の文言
    limits.ts            入力の上限
    forms.ts             フォームのエラー処理と日時の検査
    api.ts               画面から API を呼ぶ唯一の入口
    ui.ts                DESIGN.md §8 のクラス一式
    format.ts / types.ts   表示の書式 / 画面側の小さな型
    urlstate.ts / urlquery.ts   一覧の条件を URL に残す(URL の組み立てと読み取りは urlquery.ts)
migrations/              データベースの構造(番号付き SQL。スキーマの正はここだけ)
seed-data/               初期値とローカル用サンプル(日本語。正本)
scripts/                 dev.mjs(`pnpm dev` の起動役)/ migrate.mjs(migration ランナー)
tests/                   Vitest(*.test.ts。ルーンを使う状態は *.svelte.test.ts)。サンプルの件数・社員は seed-data/ から読む
  support/               テストの道具(harness.ts: 一時 DB とエラーの検査 / helpers.ts: このアプリの記録 / http.ts: ハンドラの呼び出し / job.ts: ジョブの起動)
e2e/                     Playwright の e2e(下の「e2e」)
vite.config.ts / vitest.config.ts / playwright.config.ts   SvelteKit と Vite+ / Vitest / e2e の設定
keelson.yaml             デプロイの設定・定期実行(crons:)と、AI アシスタントのツールの宣言(mcp:)
.env.example             設定できる環境変数の一覧(どれも任意。pnpm dev は設定なしで動く)
.keelsonignore           デプロイのアーカイブから除くもの(デプロイの CLI は .gitignore を読まない)
static/                  favicon.svg(文字を含まない図柄)
screenshots/             紹介ページ用の画面写真の置き場所(撮り方は screenshots/README.md)
CHANGELOG.md             版ごとの変更(新しい版を公開するときに追記する)
```

## コマンド

```bash
pnpm install
pnpm dev                 # 開発(keelson dev serve の後ろで UI + API + HMR + サンプル)。既定 http://localhost:5173
                         # 利用者の切り替えは /__keelson/dev。名簿は seed-data/dev-users.json(README「ローカル開発」)
pnpm dev -- --as sample-sato  # 名簿の別の人で始める
pnpm build               # build/ に Node サーバーを出力
pnpm start               # 本番相当(node build/index.js)。信頼ヘッダが無いと 401
pnpm check               # vp check(整形・lint・型)+ vp test run(CI ゲート = これ)
pnpm typecheck           # svelte-kit sync + svelte-check
pnpm e2e:install         # e2e 用の Chromium を入れる(初回と Playwright を上げたとき)
pnpm e2e                 # Playwright の e2e(check とは別。下の「e2e」)
node scripts/migrate.mjs # migration を手で流す(ローカルは local.db)
node src/lib/server/jobs/return-reminder.ts   # 返却の通知ジョブを手で 1 回動かす(ローカルは local.db)
```

## 日本語を書いてよい場所

- `.svelte` のマークアップ、およびコンポーネント先頭の `const T = { ... }`(型注釈を付けず `const T = {` で書く。`<script module>` の先頭でもよい)
- `src/lib/messages.ts`(エラーコード → 文言)
- `src/lib/server/content.ts`(サーバーが出す人間向けテキスト)
- `seed-data/**`、`e2e/fixtures/**`、`*.md`、`keelson.yaml`、`src/app.html`
- それ以外(サーバーの他のコード・コメント・テスト・e2e・CSS)に日本語を書かない。**識別子・コメントは英語**。
  テストで日本語が要るときは `String.fromCodePoint(...)` で組み立てる

## 変更時に必ず守ること

- **エラーコード規約**: API は `{ "error": "<code>" }` だけを返す(文言は返さない)。入力の誤りは項目に紐づけて
  `{ "error": "validation_failed", "fields": { "<項目>": "<理由>" } }`(`server/http/validate.ts` の `Checker` が集め、`server/errors.ts` の `ValidationError` で返す)。
  新しいエラーは `server/errors.ts` にコード(用途のコードは `APP_CODES`)と HTTP status(`STATUS`)、`messages.ts` に文言を足す
  (どれかが抜けると型検査で落ちる)。`new AppError(code)` は status を表から引く。項目のエラーの理由(`FieldReason`)も共通 / 用途に分けてある。
  画面は項目のエラーを欄の直下に出す(DESIGN.md §8.6)。ページ全体のエラー(`ui/ErrorBox.svelte`)に導線を出すコードは、`messages.ts` の表に
  `action`(リンク先と文言)を書く(例: `forbidden_manage_required` → 自分のページ)。画面ごとに導線を渡さない。
- **入力の上限は `src/lib/limits.ts` だけに書く**: API の本文・クエリ・AI アシスタントの引数・CSV 取込・画面の `maxlength` はここを参照する。
  値が同じでも用途が違えば別の名前にする。
- **認可は業務処理層で**: 管理系の処理は関数の中で `requireAdmin(actor)` を呼ぶ。UI の出し分けだけに頼らない。本人の操作は所有者を確かめる
  (予約の取消・貸出の返却と延長)。一般利用者に返すのは占有期間と表示名まで(ユーザー ID・他人の目的と備考・管理情報は返さない。場所は CUSTOMIZE.md §7)。
- **時刻**: 予約・貸出の日時は APP_TIME_ZONE の壁時計時刻 `YYYY-MM-DDTHH:MM` の文字列(`server/dates.ts`)。`new Date()` のローカル時刻や
  ブラウザのタイムゾーンで比べない。画面の既定値は `state/session.svelte.ts` の `serverNow()` を使う。
- **「1 つしか成立してはいけない」記録**: 貸出は部分一意インデックス + 先頭の `INSERT ... SELECT` の条件、予約は先頭の `INSERT ... SELECT` の
  「重なる active な予約が無い」条件で守る。後続の文(履歴など)は `changes() = 1` で連鎖させる。この形を崩さない(`loans.ts` / `reservations.ts`)。
- **機材に貸出・予約の状態を持たせない**: 「誰が持っているか」は `loans` の `returned_at IS NULL` の行、「誰が予約しているか」は `reservations` の active な行だけが正。
- **履歴**: 機材・予約・貸出を変える操作(登録・編集・利用停止・再開・予約・取消・貸出・延長・返却)は、1 操作 = 1 バッチで、
  同じバッチに `eventAfterChangeStatement(...)` を 1 件以上書く(直前の文が 1 行変えたときだけ書かれる)。CSV 取込は 100 行ごとのバッチにその行の分を書き、
  最後に「取込」を 1 件書く(`unguardedEventStatement`)。種類・保管場所と添付の変更は履歴に残さない。
- **スキーマ変更は `migrations/` に新しいファイルを足すだけ**: 適用済みのファイルは編集しない(checksum で起動が止まる)。
  規則は [CUSTOMIZE.md](./CUSTOMIZE.md) の「migration の規則」。機材に項目を 1 つ足すときは、CUSTOMIZE.md §5 の一覧の場所を全部直す。
- **サンプルはローカルとテストだけ**: デプロイしたアプリにサンプルデータを出さない。デモモードという状態は作らない。社員は Directory API だけ
  (ローカルでは `keelson dev serve` か SDK のローカルモードが名簿 `seed-data/dev-users.json` を Directory として返す。アプリにローカル用の認証や社員の分岐は無い)。
- **画面は API を通す**: `+page.svelte`(と併置コンポーネント)から業務処理層を直接呼ばない(SSR を無効にして `/api` を読む構成)。
  応答の型は業務処理層の型(`EquipmentList` / `ReservationList` / `EventList` など)を `import type` で使い、画面で写さない。
  読み込みは `state/loader.svelte.ts` の `loader(() => url)` で書く(`data` / `loading` / `error` / `reload()`)。一覧は `{ keepPreviousData: true }`
  (条件を変えても読み込み中は前の行を出したまま)、1 件のページは指定しない(別の記録に移ると空から)。一覧の並べ替え・ページ送りの読み取りは `listParams`。
- **ダイアログは開いている間だけ描く**: 呼ぶ側が `{#if returnTarget}<ReturnDialog target={returnTarget} … />{/if}` と書き、閉じるときは条件を戻す
  (`ui/Dialog.svelte` はマウントで開き、外れるときに開いたボタンへフォーカスを返す)。ダイアログの入力の初期値は `$state(...)` の宣言に書き、
  prop や `$derived` から取るときは `untrack(() => …)` で包む。開くたびに戻す `$effect` は書かない(開くたびに作り直される)。
  ダイアログの `admin` は「管理者として操作するか」で、自分のページは管理者でも `admin={false}` で開く(自分の貸出・予約として記録する)。
  日時の入力の検査(必須・15 分刻み・過去・開始より後)は `forms.ts` の `timeProblem()` で書く(ダイアログごとに比較を書かない)。
- **管理者の画面は `src/routes/(admin)/` に置く**: 権限の表示はそこの `+layout.svelte` が出す。画面ごとに `isAdmin` を確かめない
  (API は業務処理層で `requireAdmin` が守る。上の「認可は業務処理層で」)。機材の一覧・詳細・予約は全員の画面なので `(admin)/` に入れない。
- **部品の見た目と操作は 1 か所に**: DESIGN.md §8 のクラスは `src/lib/ui.ts` のレシピを使い、画面に直書きしない(足りなければ `ui.ts` に足す)。
  表の読み込み中・エラー・空は `ui/TableState.svelte`(表の中に出す)、データを待つ画面全体は `ui/PageLoading.svelte`。
  行を押して別の画面へ移る表は `<tr {@attach rowLink(href)}>`(`ui/rowLink.ts`)。タブの題は `<PageTitle title="…" />`(アプリ名を付けるのはこの部品)。
  メニューは `ui/Menu.svelte`、タブは `ui/Tabs.svelte`、候補から選ぶ入力欄は `ui/Combobox.svelte` の上に作る
  (検索は呼ぶ側が `loader` で読む。例: `equipment/EquipmentPicker.svelte`・`people/MemberCombobox.svelte`)。
  操作の仕様(閉じ方・キー操作・フォーカス)は各部品の冒頭のコメントにある。
- **画面でも同じ知識を写さない**: いくつもの画面に出る表示名(機材の状態・利用停止の理由・機材の項目名・履歴の種類・一覧の列名など)は、描画するコンポーネントの
  `<script module>` が export する表を import する(どの表がどこにあるかは CUSTOMIZE.md §6)。返却・延長のダイアログの対象は
  `components/loans/loanTarget.ts`(機材・貸出・ホームの行から)で作る。
- **ロジックと型は隣の `.ts` に**: `.ts`(テスト)から `.svelte` の `<script module>` の export は名前付きで
  import できない(`vp check` の型検査は `.svelte` を default export だけと見なす)。日本語を含まないロジックと型は隣の `.ts` に置き
  (例: `loans/loanTarget.ts`・`events/eventDetail.ts`)、テストはそれを普通に import する。`<script module>` に置くのは日本語の表示名の表と
  それに直に付くもの(一覧の列の定義など)だけにし、テストから読むときは `tests/components.test.ts` のように名前空間で import して型を書いて読む。
- **人の所属(メンバーかどうか)の項目名は、隣の画像の項目と同じ接頭辞にする**: `imageUrl` の隣は `membership`(貸出・予約の行、機材の `loan`、ホームの行)。
  `peopleIndex` から表示のたびに引き、画面は `former` の人の隣にチップを出す(DESIGN.md §8.10)。
- **AI アシスタントのツール(`server/mcp/`)は domain を呼ぶだけ**: SQL を書かない(要る読み取りは `domain/` に足す)。
  足し方(`keelson.yaml` の `mcp.tools` と `mcp/registry.ts` の両方を直す)と書き方(人の解決・結果の大きさ・宣言の文字列)は [CUSTOMIZE.md](./CUSTOMIZE.md) §11。
- **一覧は表**: カード・タイル・リストにしない。ページング・ソート・絞り込みはサーバー側(DESIGN.md §2, §3)。
  行の高さ・文字の大きさは `src/app.css` の密度トークンと `src/lib/ui.ts` の `table` を使う。
- **メールの事業者名を書かない**: 通知は「メールへ中継する Webhook 1 本」に抽象化してある。
- **定期実行(`keelson.yaml` の `crons:`)のジョブ**: `src/lib/server/jobs/` と、そこから import で辿るファイル(`domain/notifications.ts`・`domain/notify.ts` など)は
  Node が型を取り除くだけで直接実行する(`node src/lib/server/jobs/return-reminder.ts`)。取り除けない TypeScript(`enum` / `namespace` / parameter property。
  `http/validate.ts` の `Checker` も使っている)・`.svelte` と `$app/*`・属性なしの JSON の import(`domain/seed.ts`)を辿らせない。
  `tests/notifications.test.ts` が実際に `node` でジョブを起動して確かめる(未設定は終了コード 0、送信の失敗は 1)

## e2e

`pnpm e2e`(Playwright)は基本操作の正常系を chromium(headless)で通す(異常系は網羅しない)。1 ファイル = 1 シナリオで、
ファイル名がその内容(例: `01-reserve-lend-return.spec.ts` = 予約 → 貸出 → 返却)。`pnpm check` には含まれない。

`playwright.config.ts` の `webServer` が `scripts/dev.mjs --port 5191`(`E2E_PORT` で変更)を、実行ごとに新しい一時ディレクトリの DB(`LOCAL_DB_URL`)・ファイル置き場と
`LOCAL_SAMPLE_DATA=1` で起動する(`.env` の DB・デプロイの設定と SDK のローカルモードは空にして無効化。`local.db` を使わないので `pnpm dev` と並べて動かせる)。
launcher は `keelson dev serve` の後ろで開発サーバーを動かすので、e2e には Keelson CLI(v0.6.11 以降)が要る。無いときは `playwright.config.ts` が
入れ方を示すエラーで止まる。
テストは API が応答してから(`webServer.url`)、`e2e/global-setup.ts` が全画面を 1 回開き終えてから始まる(開発サーバーは画面を初めて開かれたときに組み立てる)。
管理者は名簿(`seed-data/dev-users.json`)の先頭の管理者(`keelson dev serve` の既定の利用者)、一般利用者は別のブラウザコンテキストに
`X-Keelson-Dev-As: <名簿の最初の一般の社員の ID>` を付けて作る(`e2e/support/harness.ts`)。

- **画面の文言では要素を探さない・確かめない**(英語版の公開でも同じテストが通るように)。e2e のソースは日本語を書けない場所なので、
  日本語が要る入力(取込用 CSV)は `e2e/fixtures/` に置く
- 要素は `data-testid`(`kebab-case`。例: `equipment-reserve`、`lend-submit`、`field-error-startsAt`)、role、フォームの `name` 属性(= API の項目名)で取る。
  状態チップ・朱印・予約の状態・履歴の種類は `data-status` / `data-kind`(英語の値)で確かめる。画面を作り替えるときはこれらの属性を残す
- シナリオは互いに独立させる: 前提データは管理者の API で作り、管理番号は `uniqueTag()` で実行ごとに固有にする。fixture の中で実行ごとに変わる値・
  サンプルから決まる値は `{{PREFIX}}` などの置き換えにして spec が `fillFixture()` で埋める(同じ DB で繰り返しても通るように。`pnpm e2e --repeat-each=3` で確かめる)
- 時刻に依存するシナリオは、サーバーの `now`(`/api/me`)から日時を組み立てる(`e2e/support/app.ts` の `dayAt`)
- 失敗時だけ screenshot と trace を `test-results/` に残す(`pnpm exec playwright show-trace <zip>` で見る)

変更後は `pnpm check` と `pnpm typecheck` を通してください。画面を変えたら `pnpm e2e` も通してください。
