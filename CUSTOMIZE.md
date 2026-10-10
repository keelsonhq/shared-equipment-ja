# カスタマイズガイド

このテンプレートは「持ち帰って AI で改修する小さな業務アプリ」です。よくある変更の場所をまとめます。
AI エージェント(Claude Code / Codex など)にそのまま渡せる改修プロンプト例は [PROMPTS.md](./PROMPTS.md) にあります。

変更後は必ず次を通してください:

```bash
pnpm check       # format + lint + 型 + test(Vite+ の vp check / vp test)
pnpm typecheck   # 型チェック(画面のコードも含む)
pnpm e2e         # 画面を変えたとき: ブラウザで基本操作を通す(初回は pnpm e2e:install。仕組みは AGENTS.md「e2e」)
```

---

## 1. 種類・保管場所を変える(コード変更不要)

管理者で **マスタ管理** を開き、「種類」「保管場所」のタブで追加・名前の変更・無効化ができます。
CSV 取込で未登録の種類・保管場所を自動で追加することもできます(取込画面の選択肢)。
使わなくなった値は無効にすると新しい登録の選択肢から外れ、登録済みの記録の表示はそのまま残ります。

初期値は [`seed-data/masters.json`](./seed-data/masters.json) です。アプリの起動時に、**まだ 1 件も無い一覧にだけ**
入ります(管理者が名前を変えた値を元に戻すことはありません)。

## 2. 予約と貸出のルールを変える

ルールは業務処理層の 2 ファイルにあり、どちらも「先頭の `INSERT ... SELECT` の条件」と「その前の項目単位の確認」の 2 か所で同じ式を使っています。
片方だけ変えると、同時操作のときだけ違う結果になります。両方を直し、テストを足してください。

| 変えたいこと                             | 場所                                                                                                                                             |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 予約の最長期間(既定 30 日)               | [`src/lib/server/domain/reservations.ts`](./src/lib/server/domain/reservations.ts) の `MAX_RESERVATION_MINUTES`                                  |
| 時刻の刻み(既定 15 分)                   | [`src/lib/server/dates.ts`](./src/lib/server/dates.ts) の `STEP_MINUTES`、画面の `step="900"` と `src/lib/format.ts` の `nextStep` / `stepStart` |
| 予約の重なりの判定                       | `reservations.ts` の `OVERLAP_SQL`(AI 向けの「この期間に空いている機材」は `equipment.ts` の `FREE_SQL` が同じ式。合わせて直す)                  |
| 早めの受け取り(既定 30 分前から)         | [`src/lib/server/domain/loans.ts`](./src/lib/server/domain/loans.ts) の `EARLY_PICKUP_MINUTES`                                                   |
| 貸出できる条件(他人の予約との重なり)     | `loans.ts` の `OTHERS_BOOKING_SQL` と `lendBlocker`                                                                                              |
| ホームの「次の予約が迫る」(既定 24 時間) | [`src/lib/server/domain/home.ts`](./src/lib/server/domain/home.ts) の `COMING_UP_HOURS`                                                          |
| 7 日の帯の時間幅(既定 8:00〜20:00)       | [`src/lib/components/equipment/Strip.svelte`](./src/lib/components/equipment/Strip.svelte) の `DAY_START` / `DAY_END`                            |

日時は、アプリのタイムゾーン(`APP_TIME_ZONE`)の壁時計時刻 `YYYY-MM-DDTHH:MM` の文字列で保存・比較しています。
ブラウザの `Date` やローカル時刻と混ぜないでください。

## 3. 返却の通知を変える

- **時刻**: [`keelson.yaml`](./keelson.yaml) の `crons` の `schedule`(ワークスペースのタイムゾーンで評価されます)
- **文面**: [`src/lib/server/content.ts`](./src/lib/server/content.ts) の `reminderMessage`
- **送る相手・回数・再試行**: [`src/lib/server/domain/notifications.ts`](./src/lib/server/domain/notifications.ts)
  (`targets` で対象を選び、`notifications` 表のキー (貸出, 種別, 返却予定日) で重複を防いでいます)
- **送り方**: [`src/lib/server/domain/notify.ts`](./src/lib/server/domain/notify.ts) の `webhookSender`(送信の打ち切り `SEND_TIMEOUT_MS`・
  再試行の上限 `MAX_ATTEMPTS` もここ)。別の送り方にするときは `Sender` を実装して `src/lib/server/jobs/return-reminder.ts` で差し替えます
- ジョブは Node が TypeScript をそのまま実行します(ビルドしません)。ジョブから import するファイルでは `enum`・`namespace`・
  コンストラクタ引数のプロパティ宣言・JSON の import を使わないでください(AGENTS.md)。手で動かして確かめるには
  `node src/lib/server/jobs/return-reminder.ts`

## 4. 色・書体・表の密度を変える

- **アクセント色(左端の背表紙・主ボタン・空き帯の貸出中)**: [`src/app.css`](./src/app.css) 冒頭の `--color-accent` 系 3 行を
  差し替えます。白文字とのコントラスト比 4.5:1 以上の濃さを選んでください(DESIGN.md §5)。
- **書体**: `src/app.css` の `--font-sans` / `--font-mono` と、[`src/app.html`](./src/app.html) の読み込み `<link>`。
- **表の行の高さ・文字の大きさ**: `src/app.css` の密度トークン(`--row-h` / `--cell-text` など)。
- 紙色・墨色・罫線の値、角丸と影のルール、「一覧は表」は変えない前提です(DESIGN.md §11)。
- ボタン・入力欄・表・タブ・メニューなどのクラスは [`src/lib/ui.ts`](./src/lib/ui.ts) にまとめてあります。共通の部分
  (大きさ・見た目・フォーカスの輪)の定数を直すと、それを使う部品すべてに効きます。組み上がったクラスは `tests/ui.test.ts` が
  固定しているので、意図して変えたらテストの期待値も直してください。

## 5. 機材に項目を 1 つ足す(データベースの変更を含む)

例: 機材に「購入日」(`purchased_on`、日付、任意)を足す。**下の一覧の場所を、全部**直します。
どれかを飛ばすと、手元のテストは通るのにデプロイ先で壊れる、という事故になります。

どこを触るかの目安: **保存**は 1〜2(migration・`domain/equipment.ts`)、**入力**は 3〜4(上限・API の本文)、
**外部の入出力**は 5〜6(AI アシスタント・CSV)、**画面**は 7、サンプルとテストは 8〜10 です。

「(型)」と書いた場所は、直し忘れると `pnpm check` / `pnpm typecheck` の型検査が止めます(`EquipmentFields` か
`CSV_COLUMNS` から型を取っているため)。「(テスト)」と書いた場所は、直し忘れると `pnpm check` の全項目の往復テスト
([`tests/equipment-fields.test.ts`](./tests/equipment-fields.test.ts))が止めます。このテストは、全項目に値を入れた機材が
API の登録と編集・CSV の出力と取込・AI アシスタントの `register_equipment` と `get_equipment`・編集の履歴を通っても変わらないことを、
`EquipmentFields` の全項目について確かめます。新しい項目もテストを書き足さずに確かめられます(値は手順 9 で足します)。
印の無い場所(画面のセルと入力欄・`keelson.yaml`・説明文)は型でもテストでも気づけないので、一覧を上から順に確かめてください。

1. **migration**: `migrations/` に新しいファイルを作ります。番号は既存の最大 + 1。
   ```sql
   -- migrations/0002_add_purchased_on.sql
   -- Purchase date of a piece of equipment (optional).
   ALTER TABLE equipment ADD COLUMN purchased_on TEXT;
   ```
2. **型と読み書き**: [`src/lib/server/domain/equipment.ts`](./src/lib/server/domain/equipment.ts)
   - `EquipmentFields` に項目を足す(`EquipmentView` はこれを継承するので、そちらには足さない)
   - `FIELD_COLUMNS` に列名(型)。一覧の SELECT(`EQUIPMENT_COLUMNS_SQL`)、登録の INSERT(`equipmentInsertStatements`)、
     編集の UPDATE と履歴の前後の値は、どれもここから組み立てられるので、SQL を書き足す必要はありません。
     登録・AI アシスタント・CSV 取込・サンプルの投入はすべてこの INSERT を通ります
   - `equipmentViewOf` に読み取り(型。`purchasedOn: strOrNull(r, 'purchased_on')`)。列名を書き誤ると、読み取りが例外になります
     (`db/rows.ts` の読み取りは、SELECT に無い列を読むと止まる)
   - 一般の社員に見せない項目なら `AdminOnlyField` に足し、`forViewer` で外します
   - 一覧で並べ替えたいときは `EQUIPMENT_SORTS` と `SORT_SQL` にも足す
3. **上限(文字列の項目だけ)**: [`src/lib/limits.ts`](./src/lib/limits.ts) の `EQUIPMENT_LIMITS` に上限を足します。
   API・CSV 取込・AI アシスタント・画面の `maxlength` がこの値を読みます
4. **API の入力**: [`src/lib/server/http/bodies.ts`](./src/lib/server/http/bodies.ts) の `equipmentFields`(型)。日付なら `c.date`、
   文字列なら `c.text` と `EQUIPMENT_LIMITS`。誤りは項目単位のエラー(`validation_failed`)で返ります
5. **AI アシスタント(MCP)**: 宣言と実装の 2 か所(§11)
   - [`src/lib/server/mcp/registry.ts`](./src/lib/server/mcp/registry.ts): `registerEquipmentTool` の入力(型。`c.date('purchased_on')`)と
     `getEquipmentTool` の結果(テスト。`purchased_on`)。項目のエラーは業務処理層の項目名(`purchasedOn`)から引数名(`purchased_on`)に
     自動で読み替わります(`mcp/refs.ts` の `argName`。引数名が項目名の snake_case でないときだけ `ARG_NAMES` に足す)
   - [`keelson.yaml`](./keelson.yaml) の `register_equipment` の `input.properties` に `purchased_on`(`type: string`、`format: date`、
     日本語の `description`)。`get_equipment` の `description` の項目の列挙にも足す
6. **CSV 出力・取込**:
   - [`src/lib/server/content.ts`](./src/lib/server/content.ts) の `CSV_COLUMNS`(列名。出力・取込・ひな形で共通)と
     `CSV_TEMPLATE_EXAMPLES`(型)
   - [`src/lib/server/import/csv.ts`](./src/lib/server/import/csv.ts) の `equipmentToCsv` の列の値(型)
   - [`src/lib/server/import/importer.ts`](./src/lib/server/import/importer.ts) の `readEquipment`(行から機材の項目を読む。型)
   - 取込画面の列名: [`src/routes/(admin)/import/PreviewTable.svelte`](<./src/routes/(admin)/import/PreviewTable.svelte>) の `T.columns`(型)。
     値は手順 7 の表示名の表から取ります(`purchasedOn: F.purchasedOn`)。
     プレビュー表と、[`src/routes/(admin)/import/+page.svelte`](<./src/routes/(admin)/import/+page.svelte>) の手順 1「列の対応」の表がこの列名を使います。
     手順 1 の説明文(「管理番号・名称(必須)、種類・…」)は列名を手で並べているので、そこにも足します
7. **画面**:
   - 項目の表示名: [`src/lib/components/equipment/EquipmentFormDialog.svelte`](./src/lib/components/equipment/EquipmentFormDialog.svelte) の
     `<script module>` の `T.fields`(型)。登録・編集フォームの欄の名前、機材詳細の `<dt>`、取込画面の列名、一覧の列名、
     履歴の編集の前後(`EventsTable.svelte` が表ごと取り込む)がこの表(`EQUIPMENT_FIELD_LABELS`)を使うので、名前はここに 1 回だけ書きます
   - 一覧の列: [`src/routes/equipment/LedgerTable.svelte`](./src/routes/equipment/LedgerTable.svelte) の `COLUMNS`・`T.columns`
     (列名は表示名の表から `F.purchasedOn`。列メニューもこの列名を使う)・セルの表示
   - 機材詳細の属性表: [`src/routes/equipment/[id]/+page.svelte`](./src/routes/equipment/[id]/+page.svelte) の定義リスト
     (`<dt>` は `{EQUIPMENT_FIELD_LABELS.purchasedOn}`)
   - 登録・編集フォーム: [`src/lib/components/equipment/EquipmentFormDialog.svelte`](./src/lib/components/equipment/EquipmentFormDialog.svelte) の
     状態・項目名の一覧(`FIELDS`。欄の直下にエラーを出す項目)・開いたときの初期値・送る本文・入力欄。
     入力欄には `<label>` に `{T.fields.purchasedOn}`、`name` = 項目名、`aria-invalid` と `<FieldError>`、文字列なら
     `maxlength={EQUIPMENT_LIMITS.<項目>}` を付けます(既存の欄と同じ形)
8. **サンプル**: [`seed-data/equipment.json`](./seed-data/equipment.json) に値を入れ(任意)、
   [`src/lib/server/domain/seed.ts`](./src/lib/server/domain/seed.ts) の `SeedEquipment` と `fields` の組み立て(型)に足す
9. **テスト**:
   - [`tests/support/helpers.ts`](./tests/support/helpers.ts) の `equipmentFields()`(機材を作るテストの既定値。型)と
     `completeEquipmentFields()`(全項目の往復テストの値。型。`second` のときは全項目を別の値にする)
   - [`tests/equipment-edit.test.ts`](./tests/equipment-edit.test.ts) の `editBody`(編集フォームが送る全項目。型)
   - 登録・編集・CSV・AI アシスタント・履歴で値が往復するかは、全項目の往復テストが確かめるので書き足さなくて済みます。
     項目に固有の規則(日付の検査など)があるときだけ、そのテストを足します
10. **e2e**: CSV の列が増えると [`e2e/fixtures/import.csv`](./e2e/fixtures/import.csv) の見出しがひな形と合わなくなり、
    `pnpm e2e` の CSV 取込(05)が失敗します。見出し行に列名を足し、各行の列数を揃えてください(値は空でも構いません)

### 項目を消す

例: 機材の「製造番号」(`serial_no`)を使わなくなった。方法は 2 つあります。

**推奨: 画面・CSV・AI アシスタントから外し、データベースの列は残す。** 列と値が残るので、あとで戻せます。
`EquipmentFields` から項目を消すと、型検査が「(型)」の場所を教えてくれます。外す場所は、足すときの一覧(上の 2〜10)と同じです:

- `domain/equipment.ts`: `EquipmentFields`・`FIELD_COLUMNS`・`equipmentViewOf`(SELECT・INSERT・UPDATE からは自動で外れます)。
  一般の社員に見せない項目なら `AdminOnlyField` からも消します。並べ替えや一覧の検索(`baseWhere` の `LIKE`)に使っていれば、
  `EQUIPMENT_SORTS`・`SORT_SQL` とその条件からも消します
- 上限(`limits.ts`)・API の入力(`http/bodies.ts`)
- AI アシスタント: `mcp/registry.ts` の `registerEquipmentTool` と `getEquipmentTool`、`keelson.yaml` の `register_equipment` の
  `input.properties` と `get_equipment` の `description`
- CSV: `content.ts` の `CSV_COLUMNS` と `CSV_TEMPLATE_EXAMPLES`、`equipmentToCsv`、`readEquipment`、取込画面の列名と手順 1 の説明文
- 画面: 表示名の表(下の「履歴の項目名」)、一覧の列、機材詳細、登録・編集フォーム、一覧の検索欄の placeholder(`LedgerToolbar.svelte`)
- サンプルとテスト: `seed-data/equipment.json` と `seed.ts`、`helpers.ts`、`editBody`、`e2e/fixtures/import.csv` の列

最後に、列名(`serial_no`)と項目名(`serialNo`)で `src/`・`tests/`・`e2e/` を検索し、残りが無いか確かめます。
列を残すと、新しく登録した機材のその列は空(NULL)になります。`NOT NULL` の列(管理番号・名称)はこの方法では外せません。

**上級: 列ごと消す。** 上の場所に加えて、新しい migration で列を消します。値は戻せません。

```sql
-- migrations/0002_drop_serial_no.sql
-- The serial number is no longer kept.
ALTER TABLE equipment DROP COLUMN serial_no;
```

SQLite では、インデックス・UNIQUE・外部キー・CHECK などが付いた列(例: 種類の `type_id`)はこの 1 文では消せず、テーブルの作り直しが要ります(下の「migration の規則」)。

**履歴の項目名は、どちらの方法でも残します。** 過去の編集の履歴には、消した項目の前後の値が残っています。表示名が無いと、
履歴の詳細にキー(例: `serialNo`)がそのまま出てしまいます。項目の表示名の表(`EquipmentFormDialog.svelte` の `T.fields`)は
`EquipmentFields` の項目と一致させる型なので、そこからは消し、その名前を履歴の表
[`src/lib/components/events/EventsTable.svelte`](./src/lib/components/events/EventsTable.svelte) の `T.fields` の末尾
(「A field removed from equipment keeps its name here」のコメントの下)に移します(例: `serialNo: '製造番号',`)。

### 項目を並べ替える

- 一覧の列の順: [`LedgerTable.svelte`](./src/routes/equipment/LedgerTable.svelte) の `COLUMNS` の並び
- CSV の列の順: [`content.ts`](./src/lib/server/content.ts) の `CSV_COLUMNS` の並び(出力・ひな形・取込画面の列の対応で共通)。
  取込は見出しの名前で列を対応させるので、並べ替えても既存の CSV は読めます。ただし列名(見出し)を変えると、
  古い見出しの CSV はその列を取り込めなくなります
- 登録・編集フォームと機材詳細の順: それぞれのマークアップの並び

### migration の規則

- **データベースの構造(テーブル・列・インデックス)は `migrations/` の SQL ファイルだけで変えます。**
  アプリのコードに `CREATE TABLE` / `ALTER TABLE` を書かないでください。
- ファイル名は `NNNN_<slug>.sql`(4 桁ゼロ埋めの番号 + 英小文字・数字・`_` のスラッグ)。番号順に、前にだけ進みます。
  元に戻す(down)仕組みはありません。戻したいときは、戻す内容の新しいファイルを足します。
- **適用済みのファイルは編集しません。** 内容を変えるとチェックサムが合わなくなり、起動とデプロイが
  `migration_checksum_mismatch` で止まります。
- **文の区切り**: 行末の `;` で 1 文が終わります。`--` で始まる行はコメントとして無視します。
  文の途中に `;` を書かないでください(そのためトリガーは使えません)。
- 1 ファイルは 1 トランザクションで適用され、適用済みの記録(`schema_migrations`)も同じトランザクションで残ります。
- **追加系の変更(列・テーブル・インデックスの追加)を優先します。** 列の型や制約(たとえば `events.kind` の CHECK)を変えるには
  テーブルの作り直し(新しいテーブル → `INSERT INTO ... SELECT` → 入れ替え → インデックスの作り直し)が要ります。
  デプロイ先のデータベースはネットワーク越しなので、重い作り直しは 10 秒以内に収まる規模にしてください。
- 適用のタイミング: デプロイ時に `keelson.yaml` の `db.migrate` が新しい版の動き出す前に 1 回実行され、
  アプリの起動時と通知のジョブの開始時にも同じ処理が走ります。手で流すときは `node scripts/migrate.mjs`。

## 6. 画面の文言を変える

- 画面のラベル: 各 `.svelte` のマークアップ、またはコンポーネント先頭の `const T = { ... }`
- ナビの項目名: [`src/routes/+layout.svelte`](./src/routes/+layout.svelte) の `T.nav`(並びは `MAIN_NAV` / `ADMIN_NAV` の配列)
- いくつもの画面に出る名前は、それを描画するコンポーネントの `<script module>` の `T` に 1 か所だけあります。
  ほかの画面はそこから export された表を import しているので、ここを直せば全部の画面に効きます
  - 機材の状態・利用停止の理由: [`src/lib/components/equipment/StatusChip.svelte`](./src/lib/components/equipment/StatusChip.svelte)
    (`STATUS_LABELS` / `REASON_LABELS`。一覧の集計と絞り込み、ホーム、機材詳細、履歴の詳細、利用停止と返却のダイアログの選択肢が使う)
  - 履歴の種類: [`src/lib/components/events/EventKind.svelte`](./src/lib/components/events/EventKind.svelte)(`KIND_LABELS`。履歴の絞り込みも使う)
  - 機材の項目の名前(管理番号・名称・種類・製造番号・保管場所・備考): [`src/lib/components/equipment/EquipmentFormDialog.svelte`](./src/lib/components/equipment/EquipmentFormDialog.svelte)
    (`EQUIPMENT_FIELD_LABELS`。登録・編集フォーム、機材詳細、一覧の列名、取込画面の列名、履歴の編集の前後が使う)。消した項目の名前は §5「項目を消す」
  - 一覧の列名: [`src/routes/equipment/LedgerTable.svelte`](./src/routes/equipment/LedgerTable.svelte)(`COLUMN_LABELS`。列メニューも使う)。
    機材の項目の列(名称・種類・保管場所・製造番号)は上の表から取り、状態・7 日の空き・利用者・返却予定・更新はここに書いてあります
  - 朱印の文言(返却済・回収済): [`src/lib/components/loans/LoanLedger.svelte`](./src/lib/components/loans/LoanLedger.svelte) の `T.seals`。
    朱印の部品(`ui/Seal.svelte`)は文言を持たず、呼ぶ側が `label` で渡します
- エラーの文言: [`src/lib/messages.ts`](./src/lib/messages.ts)(コード → 見出し + 原因と対処。入力欄の直下の 1 文は `fieldMessage`、
  CSV 取込の判定は `importIssueMessage`)。ページ全体のエラーに出すリンクもコードごとにここに書きます
  (`action`。例: 管理権限がないとき(`forbidden_manage_required`)の「自分のページへ」)
- CSV の見出し・ひな形の例・状態名・通知の文面: [`src/lib/server/content.ts`](./src/lib/server/content.ts)。CSV の状態名・利用停止の理由は画面の名前
  (`StatusChip.svelte`)とは別に書いてあるので、揃えたいときは両方を直します(サーバーの文言と画面の文言は置き場所が分かれている)

e2e(`e2e/`)は画面の文言を読まない(`data-testid` などで要素を探す)ので、文言を変えても e2e は壊れません。
要素を作り替えるときは、付いている `data-testid` / `data-status` / `data-kind` を残してください。

日本語を書けるのは決まった場所だけです(一覧は [AGENTS.md](./AGENTS.md) の「日本語を書いてよい場所」)。
サーバーの API はエラーコードだけを返し、文言を返しません。

### アプリ名を変える

画面に出るアプリ名(左の背表紙の上、狭い画面の上部バー、ブラウザのタブの題、印刷するラベル)は、画面のコードでは
[`src/lib/components/PageTitle.svelte`](./src/lib/components/PageTitle.svelte) の `T.app` の 1 か所だけです。
タブの題(「機材 | 共有機材管理」)は各画面がこの部品で付けるので、画面ごとに直す場所はありません。画面の外では次も直します:

- [`src/lib/server/content.ts`](./src/lib/server/content.ts) の `APP_NAME`(返却の通知の本文。サーバーの文言は画面と置き場所が分かれています)
- [`keelson.yaml`](./keelson.yaml) の `mcp.instructions` の 1 行目(AI アシスタントへの説明。「共有機材管理アプリです」)と、
  必要なら `description`(アプリの説明)
- [`README.md`](./README.md) の見出し(DESIGN.md の表題も同じ名前です)
- [`src/app.html`](./src/app.html) にはアプリ名を書いていません(`<title>` は `PageTitle` が付けます)

## 7. 一般の社員に見せる範囲を変える

一般の社員(`manage` なし)に返すデータは次の場所で決まります。広げるときは、他人の情報を返してよいかを先に決めてください。

- 機材の一覧・詳細: [`src/lib/server/domain/equipment.ts`](./src/lib/server/domain/equipment.ts) の `forViewer`(管理用の項目とユーザー ID を外している)
- 予約: [`src/lib/server/domain/reservations.ts`](./src/lib/server/domain/reservations.ts) の `reservationViewOf`(他人の目的を外している)
- 貸出: [`src/lib/server/domain/loans.ts`](./src/lib/server/domain/loans.ts) の `loanViewOf` と `listEquipmentLoans`(他人の過去の貸出を返さない)
- 自分のページ: [`src/lib/server/domain/me.ts`](./src/lib/server/domain/me.ts)

管理者だけの処理は、関数の中で `requireAdmin(actor)` を呼んでいます。画面のボタンを隠すだけでは守れません。

## 8. QR とラベルを変える

- QR の中身(URL)と見た目: [`src/lib/server/domain/qr.ts`](./src/lib/server/domain/qr.ts)(`KEELSON_APP_URL` が無いときはリクエストのオリジン)
- ラベルの大きさ・載せる項目: [`src/routes/equipment/[id]/label/+page.svelte`](./src/routes/equipment/[id]/label/+page.svelte)
  (印刷時の表示はこのファイルの `@media print`)

## 9. 添付の形式・上限を変える

形式の判定は [`src/lib/server/domain/attachments.ts`](./src/lib/server/domain/attachments.ts) の `detectKind`、上限は
[`src/lib/limits.ts`](./src/lib/limits.ts) の `ATTACHMENT_BYTES_MAX` / `ATTACHMENTS_PER_EQUIPMENT_MAX` です。1 ファイルの上限はファイルストアの上限(10 MiB)を
超えられません。上限を上げるときは `keelson.yaml` の `BODY_SIZE_LIMIT` も合わせます。上限を文で書いている文言
(添付欄の案内 `src/lib/components/equipment/AttachmentList.svelte` と `src/lib/messages.ts` の `attachment_too_large` / `attachment_limit_reached`)も直します。

## 10. サンプルデータを変える

[`seed-data/`](./seed-data/) の JSON を編集します(構成は [seed-data/README.md](./seed-data/README.md))。
サンプルはローカル開発(`pnpm dev`)とテスト・画面写真の撮影用です。`pnpm dev` が、ローカルのデータベースに
機材が 1 件も無いときにだけ入れます。入れ直すときは `local.db` を消してから `pnpm dev` を起動してください。
デプロイしたアプリと `pnpm start` には入りません。
テスト(`tests/`・`e2e/`)はサンプルの件数と社員を `seed-data/` から読むので、行を増減してもテストは直さずに通ります(貸出中・期限超過・
予約あり・利用停止・空きの機材を 1 件ずつと、名簿 `dev-users.json` の一般の社員 3 人以上、メールに `yama` を含む人 2 人は残してください)。
名簿 `dev-users.json` は `pnpm dev` でログインする人と社員の一覧です(先頭の管理者が既定の利用者)。貸出・予約の `user` は名簿の ID か、
`schedule.json` の `former`(メンバー外)の ID にしてください。

## 11. AI 向けのツール(MCP)を足す・変える

AI アシスタント(Claude・ChatGPT など)から使えるツールは、次の **2 か所** で決まります。片方だけ変えると
`pnpm check` のテスト(`tests/mcp-manifest.test.ts`。名前・`access`・`permission` の一致と、引数の宣言を確かめる)が失敗します。ツールの動きのテストは `tests/mcp.test.ts` です。

| 場所                                                                                | 中身                                                                                                                                                                                         |
| ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`keelson.yaml`](./keelson.yaml) の `mcp.tools`                                     | ツールの名前・説明(`description`)・引数の JSON Schema(`input`)・`access`(`read` / `write`)・`permission`(`view` / `manage`)。AI アシスタントはこれを読んで、どのツールをいつ使うかを決めます |
| [`src/lib/server/mcp/registry.ts`](./src/lib/server/mcp/registry.ts) の `MCP_TOOLS` | 同じ名前で、引数を読み(`mcp/args.ts` の `ToolArgs`)、業務処理層(`src/lib/server/domain/`)を呼んで結果を返す関数                                                                              |

足す手順(例: 管理者が機材の履歴を聞けるツール):

1. `registry.ts` に関数を書き、`MCP_TOOLS` に `tool('read', 'manage', 関数)` で登録します。**SQL は書かず、業務処理層の関数を呼びます**
   (必要な読み取りが無ければ `domain/` に足します)。結果は要点だけにし、一覧は `limit`(既定 20・最大 50。`limits.ts` の `MCP_LIST_LIMIT`)・`total`・`truncated` を返します。
   文字列の引数の上限は [`src/lib/limits.ts`](./src/lib/limits.ts) の定数で読みます(`c.text('note', { max: LEND_NOTE_MAX })`)
2. `keelson.yaml` の `mcp.tools` に同じ名前で宣言します(`access` / `permission` を `registry.ts` と揃える)
3. `tests/mcp.test.ts` に呼び出しのテストを足します
4. 再デプロイすると、接続済みの AI アシスタントにも新しいツールが見えます。新しく足した**書き込み**のツールは、
   AI アシスタントを接続し直して同意するまで使えません

`description` の書き方:

- 「何をするか」「いつ使うか」「言い回しの例を 1〜2 個」を日本語で書きます(1,024 字まで)。アプリ全体の説明は `mcp.instructions`(4,096 字まで)
- 引数ごとに `description` を付けます(形式・省いたときの既定・管理者だけか)。`required` は本当に必須のものだけにします
- 選択肢(`enum`)は英語の値にして、`description` に日本語の意味を併記します
- 返りうるエラーコードと `fields` の理由を書いておくと、AI アシスタントが自分で直して呼び直せます

守ること:

- **4xx の本文はそのまま AI アシスタント(と利用者)に見えます。** エラーはこれまでどおりコードと `fields` だけを返します(文言は返さない)。
  新しいコードは `src/lib/server/errors.ts`(コードと HTTP status の表 `STATUS`)と `src/lib/messages.ts` に足します(抜けると型検査で落ちる)。
  応答の本文が 1 MiB を超えるとエラーになるので、備考の全文や履歴の全件は返しません
- **権限は業務処理層で確かめます。** `permission: manage` は Keelson も確かめますが、アプリでもこれまでどおり `requireAdmin` と本人の確認を通します
- 人の指定(名前かメールアドレス)は [`src/lib/server/mcp/people.ts`](./src/lib/server/mcp/people.ts) の `resolvePersonRef` で解決します
- 引数と結果のキーは snake_case です。業務処理層の項目名(`dueAt` など)は `mcp/refs.ts` の `argName` でツールの引数名に読み替えます
  (camelCase → snake_case。`userId` → `person` のように別の名前で受ける項目だけ `ARG_NAMES` に書く)。
  機材・種類・保管場所の名前の引き当ても `refs.ts`、どのアプリでも使える引数の読み方は `mcp/args.ts` です
- `/api/mcp/*` は、デプロイしたアプリでは Keelson の MCP の入口からしか届きません。ローカルでは `curl` で直接確かめられます(README.md)

## 12. 依存を更新する

採用している版と確認日は [DEPENDENCIES.md](./DEPENDENCIES.md) にあります。**記憶で書かず、npm registry で
最新の安定版を確認してから**固定します。

```bash
pnpm outdated
pnpm up <package>@<version>   # 安定版のみ。RC / next は避ける
npm install --package-lock-only   # デプロイ用の package-lock.json も合わせる
pnpm check && pnpm typecheck && pnpm build
```

`@playwright/test` を上げたときは、対応するブラウザを入れ直すため `pnpm e2e:install` のあと `pnpm e2e` を通してください。
更新したら DEPENDENCIES.md の版と確認日も直してください。SvelteKit を上げるときは peer の範囲(TypeScript など)を確認してください。
`qrcode` を上げたときは、使っている関数(`toString`)の形が変わっていないか `src/lib/server/domain/qrcode.d.ts` と見比べてください。

---

## 13. Keelson 以外で動かす

このアプリは Keelson で動かすことを前提に作っていますが、Keelson でしか動かないわけではありません。
中身はふつうの SvelteKit(Node.js)アプリで、`pnpm build` と `pnpm start` で起動できます。

Keelson が受け持っているのは次の 3 つです。ほかの環境で運用するときは、自社の仕組みにつなぎ替えてください。

- **ログイン** — Keelson のゲートウェイがログインを済ませ、利用者を `X-Keelson-User-*` ヘッダでアプリに渡しています
  ([`src/lib/server/auth/`](./src/lib/server/auth/))。アプリはこのヘッダをそのまま信頼し、ヘッダが無いと API は 401 を返します
- **社員の一覧** — Keelson の Directory API から読んでいます([`src/lib/server/domain/directory.ts`](./src/lib/server/domain/directory.ts))
- **通知の定期実行** — 毎朝の返却の通知は `keelson.yaml` の `crons` が
  [`src/lib/server/jobs/return-reminder.ts`](./src/lib/server/jobs/return-reminder.ts) を動かしています。
  自社のスケジューラから `node src/lib/server/jobs/return-reminder.ts` を 1 日 1 回実行してください

データベース(設定が無ければローカルのファイル)と添付(設定が無ければローカルのフォルダ)は、そのままでも動きます。
AI アシスタントからの接続(MCP)は Keelson のゲートウェイが受け持っているので、ほかの環境ではそのままでは使えません。
