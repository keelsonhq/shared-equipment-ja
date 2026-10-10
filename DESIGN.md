# 共有機材管理 デザインガイドライン

**バージョン:** 0.2(共有機材管理の初版と、2026-10-04 のプロフィール画像対応を反映。骨格 §1〜§8 は備品管理 v0.12 から変更なしで継承)
**対象:** AI コーディングエージェント・デザイナー
**位置づけ:** テンプレートアプリごとに自己完結した DESIGN.md を持つ方針(共有文書への参照はしない)。
本ファイルはテンプレート repo に同梱して公開する。

本書は、資産管理テンプレート 4 本(備品 / 共有機材 / 社外貸出 / ソフトウェアライセンス)が
共有する **骨格(§1〜§8)** と、本アプリ固有の **顔(§9)** で構成する。
姉妹テンプレートへ展開するときは、§5 のアクセント 3 行・§9・付録 A だけを差し替える(付録 A)。

## ドキュメント目的

本文書を AI エージェントに直接インプットとして渡し、追加指示なしで意図したデザインの
概ね 8 割が再現されることを検収基準とする。
UI の第一言語は日本語(英語版は publish 時に AI 翻訳で生成されるため、本文書の例文も日本語で書く)。
CSS フレームワークは Tailwind CSS v4 系(実装時に最新安定版を確認して固定する)。

---

## 1. Core Philosophy (不変の原則)

### Concept: "Ledger" (台帳)

**罫線で区切り、影で浮かせない**
備品台帳・会計帳簿のメタファー。要素の境界は 1px の罫線で示し、カードを影で浮かせない。
面は紙(`paper`)と白(`surface`)の 2 段だけ。装飾のためのグラデーション・背景模様は使わない。

**一覧は表。密度が価値**
このアプリ群の主画面は数百〜数千件の資産を扱う台帳である。一覧は常に表(table)で、
1 行 = 1 資産。見栄えのためにカード・タイル・リスト型に崩さない(§2)。
行高・列幅・固定ヘッダ・ページングは「件数が多いときに破綻しない」ことを最優先に決める。

**数字と番号は等幅で揃える**
管理番号・製造番号・日付・数量・金額はすべて等幅書体(`font-mono`)で、桁位置を揃える。
台帳の信頼感は桁揃えから生まれる。

**状態は印で示す**
確定した事実(返却済・回収済)は朱印風の印(§8.9)で表す。アクセント色とは独立した朱を
印だけに使い、「押された」ことを一目で分からせる。

**紙の温度を持つ中立色**
背景は真っ白でも冷たいグレーでもなく、わずかに暖かい紙色。文字は真っ黒ではなく墨色。
本体の管理画面(黒 × 橙)とは別の、ユーザー自身の所有物としての落ち着きを持たせる。

**AI フレンドリーな構造**
ユーザーによるカスタマイズを前提とするため、複雑な独自 CSS は避け、Tailwind の
標準ユーティリティクラスを組み合わせた予測可能なコンポーネント設計を徹底する。

---

## 2. 一覧の原則(必須・最優先)

一覧画面の設計で迷ったら、常に「1,000 件入ったときに使えるか」で判断する。

- **一覧は表(`<table>`)で作る。** カード・タイル・縦積みリストにしない。モバイルでも同じ(§9-K)。
  これは見栄えの選択肢ではなく禁止事項(§3)。
- **件数前提は数千件。** 一覧はサーバー側ページング(既定 50 件、切替 100 / 200)、
  サーバー側ソート・絞り込み。総件数を常に表示する(例: `1–50 / 1,284 件`)。
  検索は 300ms のデバウンス。
- **行は細く、情報は横に並べる。** 行高は既定 44px(`h-11`)、密モード 36px(`h-9`)。
  行の中で改行させない(`whitespace-nowrap` + `truncate`)。行内に大きなアバター・サムネイル・
  アイコンの群れを置かない。アバターは 20px まで。
- **ヘッダは固定、先頭列も固定。** `thead` は `sticky top-0`、管理番号列は `sticky left-0`。
  横スクロールを許容し、列を無理に詰め込まない。
- **列に優先度を付ける。** 幅が狭いときは低優先の列を隠す(「列」メニューで戻せる)。
  カードに畳むのではなく、列を減らす。
- **数値は右揃え・等幅、日付は左揃え・等幅。** 文字列は左揃え。ヘッダの揃えもセルに合わせる。
- **絞り込みは 1 行のバー、適用中はチップで見せる。** 集計ストリップ(§8.2)の数値から
  ワンクリックで絞り込める。URL クエリに状態を反映し、絞り込み済みの一覧をそのまま共有できる。
- **空状態・読み込み中・エラーも表の中で表す。** 表の外にイラスト付きの空状態を置かない。
- **選択列は左端、一括操作は選択時だけ上部に出す。** 常設の一括操作ボタンで高さを消費しない。
- **行の操作は末尾 1 列に 1 つだけ。** 状態に応じた主操作(支給 / 返却)を小型ボタンで置き、
  それ以外は詳細画面で行う。行ごとに「…」メニューを並べない。

---

## 3. 収斂回避: 禁止事項と必須の個性

AI コーディングエージェントは、訓練データに多い「無難な既定」へ引き戻される。
以下は本テンプレートで明示的に禁止する。

| 禁止                                                           | 代わりに                                                                    |
| -------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Inter / Roboto / Arial / system-ui を主書体にする              | §6 の IBM Plex Sans JP + IBM Plex Mono を読み込んで使う                     |
| 紫・インディゴ・バイオレット系のアクセント、グラデーション背景 | §5 のアクセント 1 色 + 紙色の面                                             |
| 白いカードに `shadow-*` を付けて灰色背景に浮かせる             | `border border-rule` の罫線で区切る。影はダイアログ・メニュー・トーストだけ |
| 一覧をカード・タイル・リスト型にする(モバイル含む)             | §2 の表                                                                     |
| 一覧ページ上部に 3〜4 枚の KPI カードを並べる                  | §8.2 の 1 行の集計ストリップ                                                |
| 中央寄せのヒーロー見出し、大きな余白で情報を薄める             | 左寄せの `h-14` ページヘッダ(§8.2)                                          |
| 8px 以上の角丸(`rounded-lg` 以上)、ピル型ボタン                | 器 4px(`rounded-sm`)、部品 2px(`rounded-xs`)。丸いのは印とアバターだけ      |
| UI 文言の絵文字・「!」・称賛表現                               | §10 の事実ベースの文言                                                      |
| 装飾アイコンの多用、行内のアイコン列                           | アイコンはナビと操作ボタンだけ(§8.18)                                       |
| ページ読み込み時の順次フェードイン演出                         | モーションは §7 の 4 種類だけ                                               |

必須の個性(これが無ければ本テンプレートの見た目にならない):
紙色の背景(`bg-paper`)、罫線だけの区切り、等幅の管理番号チップ(§8.7)、朱印(§8.9)、
左端 4px の背表紙(§8.1)、固定ヘッダの密な表(§8.3)。

---

## 4. Accessibility & Contrast (品質基準)

**Standard:** WCAG 2.1 Level AA 準拠(コントラスト比 4.5:1 以上を厳守)

- **メインテキスト** `text-ink`(#1C1917)。真っ黒(`text-black`)は使わない。
- **補助テキスト** `text-ink-muted`(#57534E)。紙色の上でも 5.4:1 を確保する。これより薄い文字を
  本文に使わない。`text-ink-faint`(#78716C)はプレースホルダーと無効状態だけ(白い入力欄の上で 4.6:1)。
- **色だけで状態を伝えない。** 状態チップには必ず文字ラベルを入れる(§8.8)。返却待ちは破線、
  返却済は印、という形の違いも併用する。
- **Focus Ring** キーボード操作時は必ず可視化する:
  `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-paper`。
  入力欄は `focus:border-accent focus:ring-2 focus:ring-accent/25`。
- **表はキーボードで辿れる。** 行は `tabindex="0"`、Enter で詳細、Space で選択。
  行の `focus-within` を hover と同じ背景で示す。
- **タップ領域** 表の行は既定で 44px。タッチ環境では密モードでも行を 44px のままにし、ボタンとメニューの項目(§8.14)の高さも 44px(`h-11`)に上げる(§9-K)。
- **`prefers-reduced-motion`** を尊重し、§7 のアニメーションをすべて無効化する。

---

## 5. Color System & カスタマイズ前提

アクセント色(背表紙色)は **`accent` トークンに一元化**する。実装時は必ずグローバル CSS の
冒頭に以下の `@theme` 定義(Tailwind CSS v4)を置き、本文書のコンポーネント指定はすべて
`accent` 系クラス(`bg-accent` / `text-accent` / `ring-accent` など)を使う。
**アプリの色の変更はこの 3 行の差し替えだけで完結する**(姉妹テンプレートの値は付録 A)。

```css
@import 'tailwindcss';

@theme {
	/* 背表紙色(アクセント) — この 3 行を差し替えるだけでアプリの色が変わる */
	--color-accent: #155e75; /* 鉄紺。白文字と 7.3:1 */
	--color-accent-strong: #164e63; /* hover / active */
	--color-accent-soft: #cffafe; /* 選択行・淡い強調 */

	/* 紙と墨(家族共通。変更しない) */
	--color-paper: #f7f5f0; /* ページ背景 */
	--color-surface: #ffffff; /* 表・入力欄・ダイアログの面 */
	--color-ink: #1c1917; /* 本文 */
	--color-ink-muted: #57534e; /* 補助文 */
	--color-ink-faint: #78716c; /* プレースホルダー・無効 */
	--color-rule: #e7e5e4; /* 罫線 */
	--color-rule-strong: #d6d3d1; /* 強い罫線(表ヘッダ下・入力欄の枠) */

	/* 朱(印専用。アクセントとは独立) */
	--color-seal: #b91c1c;
	--color-seal-soft: #fef2f2;

	/* 書体(§6) */
	--font-sans: 'IBM Plex Sans JP', 'Hiragino Sans', 'Yu Gothic UI', sans-serif;
	--font-mono: 'IBM Plex Mono', ui-monospace, 'SFMono-Regular', Menlo, monospace;
}
```

`--color-accent` を差し替える場合も、白文字(`text-white`)とのコントラスト比 4.5:1 以上を
維持できる濃さの色を選ぶこと。

### 主要カラートークン

| 役割        | クラス                                  | 適用ルール / 意図                                                                       |
| ----------- | --------------------------------------- | --------------------------------------------------------------------------------------- |
| Accent      | `bg-accent` / `text-accent`             | 主要ボタン、アクティブなナビ、背表紙、管理番号チップの左縁。hover は `bg-accent-strong` |
| Accent Soft | `bg-accent-soft` / `text-accent-strong` | 選択行(`bg-accent-soft/60`)、適用中フィルタのチップ、支給中チップ                       |
| Paper       | `bg-paper`                              | ページ背景・サイドバー・表ヘッダ。真っ白や冷たいグレーを敷かない                        |
| Surface     | `bg-surface`                            | 表本体、入力欄、ダイアログ、パネル                                                      |
| Ink         | `text-ink`                              | 見出し・本文・セル                                                                      |
| Ink Muted   | `text-ink-muted`                        | 表ヘッダ、ラベル、メタ情報                                                              |
| Rule        | `border-rule`                           | 行の区切り、パネルの外枠、ナビの境界                                                    |
| Rule Strong | `border-rule-strong`                    | 表ヘッダ下、入力欄の枠、Secondary ボタンの枠                                            |
| Seal        | `text-seal` / `border-seal`             | 朱印(§8.9)専用。ボタンや見出しに使わない                                                |

### 状態色(本アプリの物品状態)

状態チップ(§8.8)の配色。アクセントを差し替えても意味色は変えない。

| 状態                                       | クラス                                                 | 形の手がかり           |
| ------------------------------------------ | ------------------------------------------------------ | ---------------------- |
| 未割当                                     | `border-rule-strong bg-surface text-ink-muted`         | 実線・無彩色           |
| 支給中                                     | `border-accent/40 bg-accent-soft text-accent-strong`   | 実線・アクセント       |
| 返却待ち(交換で旧品が残っている)           | `border-dashed border-stone-400 bg-stone-100 text-ink` | 破線                   |
| 利用停止(修理中・故障・紛失)               | `border-amber-300 bg-amber-50 text-amber-800`          | 実線・琥珀。理由を併記 |
| 返却期限超過(返却予定日を設定した場合のみ) | `border-seal/40 bg-seal-soft text-seal`                | 実線・朱               |
| 返却済 / 回収済(履歴行)                    | 朱印(§8.9)                                             | 印                     |

### 意味色(状態チップ以外)

- **注意:** `text-amber-800 bg-amber-50 border-amber-200`(CSV 取込の要確認行、返却時の「要修理」)
- **エラー:** `text-red-800 bg-red-50 border-red-200`(フォームエラー、取込不可行、読込失敗)
- 成功は専用色を持たない。完了はトースト文言と印で示す。

---

## 6. Typography

### 書体

- **UI / 本文:** `font-sans` = IBM Plex Sans JP。ウェイトは 400 / 500 / 600 だけ使う(700 は使わない)
- **番号・日付・数量・金額:** `font-mono` = IBM Plex Mono(400 / 500)。同じ Plex ファミリーなので
  和文と並べても字面が揃う
- 和文に字間調整(`tracking-*`)を掛けない。`tracking-tight` は H1 だけ

### 読み込み(必須)

書体を読み込まないと OS 既定へ落ちて本テンプレートの見た目にならない。
SvelteKit なら `src/app.html` の `<head>` に置く(自前配信に切り替えてもよい。
その場合も `@theme` の `--font-sans` / `--font-mono` の名前は変えない)。

```html
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link
	href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+JP:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap"
	rel="stylesheet"
/>
```

和文書体はファイルが大きいが、配信側で文字範囲ごとに分割されるため、実際に使う範囲だけが
読み込まれる。`display=swap` により読み込み前は代替書体で描画される。

### Hierarchy

| レベル           | クラス                                                 | 用途                                                                       |
| ---------------- | ------------------------------------------------------ | -------------------------------------------------------------------------- |
| H1               | `text-xl font-semibold tracking-tight text-ink`        | ページタイトル(ページヘッダ内)                                             |
| H2               | `text-sm font-semibold text-ink`                       | 節見出し。下に `border-b border-rule` を敷く                               |
| 表ヘッダ         | `text-[13px] font-medium text-ink-muted`               | `th`                                                                       |
| セル             | `text-[15px] text-ink`                                 | `td`(密モードは `text-sm`)                                                 |
| 本文             | `text-sm text-ink leading-5`                           | 表以外の本文                                                               |
| ラベル           | `text-xs font-medium text-ink-muted`                   | フォームラベル、定義リストの項目名                                         |
| メタ             | `text-[13px] text-ink-muted`                           | 補足、更新日時(表の補助列。密モードは `text-xs`。表の外の補足は `text-xs`) |
| チップ・管理番号 | `text-xs`                                              | 状態チップ・管理番号チップ・朱印(小)。密モードは `text-[11px]`             |
| 数値(セル)       | `font-mono text-sm tabular-nums`                       | 管理番号、日付、数量                                                       |
| 大きな数         | `font-mono text-2xl font-medium tabular-nums text-ink` | 社員ページの点数(§9-C)                                                     |
| 密モード         | セル `text-sm`・チップ `text-[11px]`・メタ `text-xs`   | 行高 36px のとき                                                           |

### 書式

- 日付 `YYYY-MM-DD`、日時 `YYYY-MM-DD HH:mm`。相対表現(「3 日前」)は台帳では使わない
- 件数は `1,284 件`、点数は `4 点`。桁区切りを入れる
- 空の値は `—`(全角ダッシュ 1 文字)を `text-ink-faint` で表示する
- 本文中の数字にも `tabular-nums` を付け、表の桁位置を崩さない

---

## 7. Shape, Elevation & Motion

### Radius

| 要素   | クラス            | 用途                                     |
| ------ | ----------------- | ---------------------------------------- |
| 器     | `rounded-sm`(4px) | 表の外枠、パネル、ダイアログ、ボタン     |
| 部品   | `rounded-xs`(2px) | 入力欄、チップ、管理番号チップ、ナビ項目 |
| 印・人 | `rounded-full`    | 朱印(大)、アバター                       |

`rounded-md` 以上は使わない。

### Elevation

- 区切りは罫線。`shadow-*` を許すのはダイアログ・ドロップダウン・メニュー・トーストだけで、
  値は `shadow-md shadow-stone-900/10` に固定する
- 表・パネル・入力欄に影を付けない

### Motion

使うのは次の 4 つだけ。時間は 120〜160ms、`ease-out`。

1. hover / focus の背景・枠線色(`transition-colors duration-150`)
2. ダイアログの表示(`opacity 0→1` + `scale(0.98)→1`、160ms)
3. トーストの表示(下から 8px スライド + フェード、160ms)
4. 朱印の押印(返却確定の瞬間に 1 回だけ)

```css
@keyframes stamp-press {
	0% {
		transform: scale(1.15) rotate(-6deg);
		opacity: 0;
	}
	60% {
		transform: scale(0.98) rotate(-6deg);
		opacity: 1;
	}
	100% {
		transform: scale(1) rotate(-6deg);
		opacity: 1;
	}
}
.stamp-press {
	animation: stamp-press 160ms ease-out both;
}

@media (prefers-reduced-motion: reduce) {
	.stamp-press {
		animation: none;
	}
}
```

ページ読み込み時の順次フェード、スケルトン以外のローディング演出、効果音、紙吹雪は不可。

---

## 8. Components(家族共通)

### 8.1 App Shell & Navigation(背表紙)

画面の左端に 4px のアクセント色の縦線を置く。これが「背表紙」で、どのアプリを開いているかを
色で識別する唯一の大きな面。

```
<div class="min-h-dvh bg-paper text-ink antialiased md:grid md:grid-cols-[240px_1fr]">
  <aside class="hidden md:flex md:flex-col border-l-4 border-l-accent border-r border-r-rule bg-paper px-3 py-4">
    <!-- アプリ名 -->
    <div class="flex items-center h-8 px-2 text-sm font-semibold tracking-tight text-ink">備品管理</div>
    <!-- ナビ -->
    <nav class="mt-4 space-y-0.5"> … </nav>
    <!-- 利用者 -->
    <div class="mt-auto flex items-center gap-2 h-10 px-2 text-xs text-ink-muted"> … </div>
  </aside>
  <main class="min-w-0"> … </main>
</div>
```

- **ナビ項目:** `flex items-center gap-2 h-8 px-2 rounded-xs text-sm text-ink-muted hover:bg-stone-200/60 hover:text-ink`
- **アクティブ:** `bg-surface border border-rule text-ink font-medium`(台帳のインデックス見出しのように白く浮く)
- **区分ラベル:** `px-2 mt-5 mb-1 text-[11px] font-medium text-ink-faint`(例: 「管理」)
- **利用者ブロック:** アバター(§8.10 の `size-5`)+ 表示名 + 権限チップ(`manage` 保有者のみ
  「管理」を §8.8 の未割当チップと同じ配色で)
- **モバイル(`md` 未満):** 上部バー `flex items-center h-12 px-4 border-t-4 border-t-accent border-b border-b-rule bg-paper`
  にメニューボタン + アプリ名。ナビはドロワー(左から、同じ項目)。背表紙は上辺の 4px に移る

本アプリのナビ(管理者): ホーム / 台帳 / 社員別 / 履歴 / マスタ管理、区分「自分」に 自分のページ。
CSV 取込(§9-H)はナビに置かず、ホームと台帳のヘッダの「CSV で取り込む」から入る。
一般利用者: 自分のページ だけ(§9-J)。

### 8.2 Page Header & 集計ストリップ

- **ページヘッダ:** `flex items-center justify-between gap-4 h-14 px-6 border-b border-rule`
  - 左: H1 + 総件数 `font-mono text-xs text-ink-muted tabular-nums`(例: `1,284 件`)
  - 右: Secondary(CSV 出力 / 列)+ Primary(物品を登録)。ボタンは 3 つまで
- **集計ストリップ(一覧ページのみ):**
  `flex flex-wrap items-center gap-x-6 gap-y-1 px-6 py-2 text-xs text-ink-muted border-b border-rule bg-paper`
  - 項目はボタン: ラベル + `font-mono text-ink tabular-nums` の数値(例: 「支給中 **128**」)
  - クリックでその状態に絞り込む。適用中の項目は `border-b border-accent text-ink`
  - カードにしない。高さは 1 行(折り返しても 2 行まで)

### 8.3 Table(台帳表)

本テンプレートの中心コンポーネント。すべての一覧(物品・社員・履歴・取込プレビュー・
添付・マスタ管理・ホームの集計)がこの構造を使う。

```
<div class="overflow-x-auto border border-rule rounded-sm bg-surface">
  <table class="w-full border-collapse text-[15px]">
    <thead class="sticky top-0 z-10 bg-paper">
      <tr class="border-b border-rule-strong">
        <th class="sticky left-0 z-10 h-10 w-12 px-4 bg-paper"><input type="checkbox" class="size-4 rounded-xs border-rule-strong accent-accent" /></th>
        <th class="sticky left-12 z-10 h-10 px-4 text-left text-[13px] font-medium text-ink-muted whitespace-nowrap bg-paper border-r border-rule">管理番号</th>
        <th class="h-10 px-4 text-left text-[13px] font-medium text-ink-muted whitespace-nowrap">物品名</th>
        <th class="h-10 px-4 text-right text-[13px] font-medium text-ink-muted whitespace-nowrap">数量</th>
      </tr>
    </thead>
    <tbody>
      <tr tabindex="0" class="border-b border-rule last:border-0 hover:bg-stone-50 focus-within:bg-stone-50 cursor-pointer">
        <td class="sticky left-0 z-[1] h-11 w-12 px-4 bg-surface"> … </td>
        <td class="sticky left-12 z-[1] h-11 px-4 whitespace-nowrap bg-surface border-r border-rule"> … </td>
        <td class="h-11 px-4 whitespace-nowrap max-w-72 truncate"> … </td>
        <td class="h-11 px-4 text-right font-mono tabular-nums"> … </td>
      </tr>
    </tbody>
  </table>
</div>
```

- **行高と文字:** 既定は行 `h-11`(44px)・セル `text-[15px]`・チップ `text-xs`・メタ `text-[13px]`・表ヘッダ `text-[13px]`
  (ヘッダ行 40px)。密モードは行 `h-9`(36px)・セル `text-sm`・チップ `text-[11px]`・メタ `text-xs`。32px の段は無い。
  セルの左右は `px-4`。切替は台帳のページヘッダ右の Ghost ボタン「密度」で、すべての表に効き、選択を
  localStorage に保存する。実装は `src/app.css` の密度トークン(`--row-h` / `--cell-text` / `--chip-text` /
  `--meta-text` / `--head-text`)で、表・チップ・管理番号チップはこのトークンを読む
- **固定:** `thead` は `sticky top-0`、選択列は `sticky left-0`(`w-12`)、先頭データ列(管理番号)は `sticky left-12`(選択列の右)。
  固定セルは背景色を持たせて下の内容を透かさない。右端に `border-r border-rule` で縁を示す
- **ソート:** `th` をボタン化し、ソート中の列は `text-ink` + 右に 12px の矢印アイコン。
  未ソート列はアイコンを出さない
- **選択:** 行頭の checkbox。選択行は `bg-accent-soft/60`。全選択はヘッダの checkbox
- **一括バー(選択時のみ表の直上):**
  `flex items-center gap-3 h-10 px-3 mb-2 rounded-sm border border-accent/30 bg-accent-soft/40 text-sm`
  - 「`3` 件を選択」(数値は mono)+ 操作(CSV 出力 など)+ 右端に「選択解除」Ghost
- **ページング(表の直下):** `flex items-center justify-between h-10 text-xs text-ink-muted`
  - 左: `font-mono tabular-nums` で `1–50 / 1,284 件`
  - 右: 表示件数の select(50 / 100 / 200、`h-7 text-xs`)+ 前へ / 次へ の Ghost 小型ボタン
- **列メニュー:** ページヘッダ右の Ghost「列」→ 表示列のチェックリスト(§8.14 のメニュー)。
  既定の表示は各画面の列表(§9)の優先度 1〜2
- **行の操作列(末尾):** 状態に応じた 1 操作を Ghost 小型(`h-7 px-2 text-xs`)で置く。
  hover / focus-within 時に `text-ink`、通常時は `text-ink-muted`
- **グループ行(社員ページの二段表など):**
  `<tr><td colspan="…" class="h-8 px-4 bg-paper text-xs font-medium text-ink-muted border-b border-rule">返却待ち 1 点</td></tr>`(密モードは `h-7` + `text-[11px]`)
- **空状態(表の中):** `tbody` に 1 行、`td colspan` を `h-24 text-center text-sm text-ink-muted`。
  文言は事実だけ(例: 「該当する物品はありません。」)。絞り込みなし・管理者のときだけ
  その下に Secondary「物品を登録」。イラスト・アイコンは置かない
- **読み込み中(表の中):** スケルトン 8 行(行高は既定・密モードに従う)。各セルに `h-3 w-[60%] rounded-xs bg-stone-200/80 animate-pulse`
  のバーを 1 本。表の外にスピナーを置かない
- **エラー(表の中):** 1 行、`text-sm text-red-800` + Ghost「再読み込み」
- **モバイル:** 表のまま。優先度 1 の列だけ表示し、横スクロールで残りを見せる。行高は既定と同じ `h-11`

### 8.4 Filter Bar

表の直上。`flex flex-wrap items-center gap-2 px-6 py-2 border-b border-rule`

- **検索:** `w-64 h-8 text-sm`(§8.6 の入力欄、左に 16px の検索アイコン、`pl-8`)。
  プレースホルダーは検索対象を書く(例: 「管理番号・物品名・製造番号」)
- **絞り込み select:** `h-8 text-xs`(状態 / 種類 / 使用場所 / 支給先)。複数選択が要るものは
  チェックリストのメニュー(§8.14)にする
- **適用中チップ:** `inline-flex items-center gap-1 h-6 px-2 rounded-xs border border-accent/40 bg-accent-soft text-xs text-accent-strong`
  - 右端に 12px の × ボタン。「状態: 支給中」のように項目名を含める
- **クリア:** 適用中が 1 つ以上あるときだけ Ghost「クリア」
- URL クエリ(`?q=&status=&type=&place=&member=&sort=&page=`)と双方向に同期する

### 8.5 Buttons

**Primary:**

```
inline-flex items-center gap-1.5 h-9 px-3 rounded-sm bg-accent text-sm font-medium text-white hover:bg-accent-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-paper disabled:bg-stone-300 disabled:cursor-not-allowed transition-colors duration-150
```

**Secondary:**

```
inline-flex items-center gap-1.5 h-9 px-3 rounded-sm border border-rule-strong bg-surface text-sm font-medium text-ink hover:bg-stone-50 hover:border-stone-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-paper disabled:text-ink-faint disabled:cursor-not-allowed transition-colors duration-150
```

**Ghost:**

```
inline-flex items-center gap-1.5 h-8 px-2 rounded-xs text-sm text-ink-muted hover:bg-stone-200/60 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent transition-colors duration-150
```

**Danger(訂正・削除など取り消しにくい操作):**

```
inline-flex items-center gap-1.5 h-9 px-3 rounded-sm border border-red-300 bg-surface text-sm font-medium text-red-700 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 focus-visible:ring-offset-paper transition-colors duration-150
```

- **小型:** 上記の `h-9 px-3 text-sm` を `h-7 px-2 text-xs` に置き換える(表の行内・一括バー)
- ピル型(`rounded-full`)にしない。アイコンは左に 1 つまで(16px)
- 確定操作(返却を記録・支給する)も Primary。朱色のボタンは作らない(朱は印だけ)

### 8.6 Inputs

**Text / Date / Number:**

```
block w-full h-9 rounded-xs border border-rule-strong bg-surface px-3 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25 disabled:bg-stone-100 disabled:text-ink-faint aria-invalid:border-red-500 aria-invalid:ring-red-500/20
```

- 管理番号・製造番号・日付・数量の入力欄には `font-mono tabular-nums` を追加する
- **Select:** 同スタイル + `pr-8 appearance-none` + 右に 16px の下向き矢印
- **Textarea:** 同スタイル。`h-9` を `min-h-20 py-2 leading-6` に置き換える
- **Checkbox / Radio:** `size-4 rounded-xs border-rule-strong accent-accent`(Radio は `rounded-full`)
- **ラベル:** `block text-xs font-medium text-ink-muted mb-1`。必須が既定で、任意項目にだけ
  `<span class="text-ink-faint">(任意)</span>` を付ける
- **補助文:** `mt-1 text-xs text-ink-faint`
- **エラー文:** `mt-1 text-xs text-red-700`。入力欄に `aria-invalid="true"`
- **フォーム全体:** `max-w-2xl space-y-4`。2 列にするのは日付のような短い項目だけ(`grid grid-cols-2 gap-4`)

**項目単位のエラー(全フォーム共通):**

- サーバーは入力の問題を項目に紐づけて返す:
  `{ "error": "validation_failed", "fields": { "assetTag": "taken", "purchasedOn": "invalid_date", "name": "required" } }`。
  キーはリクエストの項目名(入れ子は `assignment.userId` / `suspend.reason`)、値は理由コード
  (`required` / `too_long` / `invalid` / `invalid_date` / `taken` / `not_found` / `future` / `before_issued`)
- フロントは各入力欄の直下に上記のエラー文で出し、欄に `aria-invalid="true"`、最初のエラー欄にフォーカスを移す。
  文言は messages マップで (項目, 理由) → 日本語に解決する(例: 管理番号 + `taken` →「この管理番号はすでに登録されています。」、
  `required` →「必須です。」、`invalid_date` →「日付の形式が正しくありません。」)。欄を直すとその欄のエラーは消える
- 送信前のクライアント側の確認(必須・日付の前後)も同じ見た目で出す。サーバーの判定が正
- 項目に紐づかないエラー(競合 `item_already_assigned` など)は従来どおり `{ "error": "<code>" }` で、
  ダイアログ上部の本文内エラー(§8.13)に出す。項目のエラーをそこに出さない
- 対象: 物品の登録・編集 / 支給・交換 / 返却 / 利用停止 / 訂正 / マスタの追加・名前の変更(表内の入力欄の直下)/
  CSV 取込のファイル(ファイル名の直下)

**社員コンボボックス(ワークスペースのメンバー検索):**

- 入力欄は上記 Text。入力で候補を絞る(表示名・メールの部分一致)
- リスト: `absolute z-20 mt-1 w-full max-h-64 overflow-auto rounded-sm border border-rule-strong bg-surface shadow-md shadow-stone-900/10`
- 候補: `flex items-center gap-2 h-9 px-3 text-sm hover:bg-stone-50 aria-selected:bg-accent-soft/60`
  - アバター(§8.10)+ 表示名 + メール(`font-mono text-xs text-ink-muted`)
- 候補なし: `h-9 px-3 text-sm text-ink-muted`「該当する社員がいません。」。社員の新規作成リンクは置かない
- 社員の一覧を取得できないとき: 同じ位置に「社員の一覧を取得できませんでした。」とだけ出す(理由の推測や手順は書かない)
- クリックでもリストを開く(エラーでフォーカスが移った後にも選び直せるように)

### 8.7 Asset Tag(管理番号チップ)

管理番号は常にこのチップで表示する(表・詳細ヘッダ・ダイアログ・履歴)。
左縁のアクセント色が「このアプリの資産」であることを示す。

**標準(表・履歴):**

```
inline-flex items-center h-5 px-1.5 rounded-xs border border-rule-strong border-l-2 border-l-accent bg-surface font-mono text-xs font-medium tracking-wide text-ink whitespace-nowrap
```

**大(詳細ページのヘッダ):** `h-7 px-2 text-sm` に置き換える。

密モードの表では、標準の文字を `text-[11px]` にする。

管理番号は製造番号と別物として扱う。製造番号は `font-mono text-ink-muted` の素の文字列で、チップにしない。

### 8.8 Status Chip

```
inline-flex items-center h-5 px-1.5 rounded-xs border text-xs font-medium whitespace-nowrap
```

- §5「状態色」の配色クラス。密モードの表では `text-[11px]`。文字ラベルを必ず含める(例: 「支給中」「利用停止: 修理中」)。
  利用停止は理由を `: ` で続ける。

### 8.9 Seal(朱印)

返却済・回収済を表す印。アクセント色と独立した朱で、形(円・傾き・枠線)で「押された」ことを示す。

**大(詳細ページ・割当台帳の確定行の末尾):**

```
inline-flex items-center justify-center size-12 rounded-full border-[1.5px] border-seal text-seal text-[11px] font-semibold leading-tight text-center -rotate-6 select-none whitespace-pre-line
```

内容は `返却\n済`(2 行)。回収なら `回収\n済`。

**小(表の行内):**

```
inline-flex items-center h-5 px-1.5 rounded-xs border border-seal text-seal text-xs font-medium whitespace-nowrap
```

内容は `返却済` / `回収済`。

- 返却確定の直後に初めて描画されるときだけ `.stamp-press`(§7)を付ける。再描画では付けない
- 印は事実の記録にだけ使う。ボタン・見出し・リンクに朱を使わない
- 印の文言は、呼び出し側が `Seal.svelte` の `label`(必須)/ `largeLabel` で渡す(`Seal` 自体は文言を持たない)。本アプリの返却済・回収済は
  貸出台帳が渡し、付録 A の用途ごとの文言(検品済・解除済など)も同じ形で渡す。`data-kind` には英語の値(`kind`)を付ける

### 8.10 Avatar(画像、無ければイニシャル)

Directory にプロフィール画像がある人は画像、無い人は表示名の先頭 1 文字。画像の URL はアプリに保存せず、
表示のたびに Directory の一覧から引く。アプリ内に画像のアップロードや編集は持たない。

- **サイズは 2 段だけ:** 表・ナビ・候補リストは 20px(`size-5`)、名札ヘッダ(§9-C)は 40px(`size-10`)。画像でも頭文字でも同じ寸法
- **画像(`<img>`):** `inline-block shrink-0 rounded-full object-cover ring-1 ring-rule` + `size-5` / `size-10`。
  `ring-1 ring-rule` の罫線で紙面に馴染ませる(影は付けない)。`alt=""`(名前は隣のテキストが担う)、
  `loading="lazy"`、`referrerpolicy="no-referrer"`、`draggable="false"`
- **解像度:** `src` は Directory の URL に `width` / `height` を**表示 px の 2 倍**で付ける(20px → 40、40px → 80。
  高密度画面で滲まない)。組み立ては `src/lib/format.ts` の `avatarSrc`
- **頭文字(fallback):** 画像が無い・読み込みに失敗した(`onerror`)・URL が不正なときは頭文字に切り替える。
  URL が変わったら再試行する
  - **表・ナビ:** `inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-stone-200 text-[10px] font-medium text-ink`
  - **名札ヘッダ(§9-C):** `size-10 text-sm`
- **メンバー外(Directory から外れた人):** 画像があっても出さず、常に頭文字
  `bg-stone-100 text-ink-faint border border-dashed border-rule-strong`
  - 隣に §8.8 の未割当配色で「メンバー外」チップ
- Directory 未設定のとき(と、画像を持たないローカルの名簿の人)は頭文字

### 8.11 Definition List(属性表)

詳細ページの属性は定義リストで縦に並べる。表ではないが罫線で区切る。

```
<dl class="text-sm">
  <div class="grid grid-cols-[7rem_1fr] gap-x-4 py-2 border-b border-rule last:border-0">
    <dt class="text-ink-muted">製造番号</dt>
    <dd class="text-ink font-mono tabular-nums">SN-7F3A-0192</dd>
  </div>
</dl>
```

### 8.12 Tabs

`flex gap-4 border-b border-rule`。タブは
`h-9 px-1 text-sm text-ink-muted hover:text-ink border-b-2 border-transparent -mb-px`、
アクティブは `text-ink font-medium border-accent`。件数を添えるときは `font-mono text-xs text-ink-muted ml-1`。

### 8.13 Dialog

ネイティブ `<dialog>` を使う。

- **背景:** `fixed inset-0 bg-stone-900/40`
- **本体:** `fixed left-1/2 top-1/2 w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-sm border border-rule-strong bg-surface shadow-md shadow-stone-900/10`
- **ヘッダ:** `flex items-center justify-between h-12 px-5 border-b border-rule` + タイトル `text-sm font-semibold text-ink` + 閉じる Ghost(アイコンのみ)
- **本文:** `px-5 py-4 space-y-4`
- **フッタ:** `flex justify-end gap-2 px-5 py-3 border-t border-rule bg-paper` + Secondary「キャンセル」+ Primary
- **本文内エラー:** `rounded-xs border border-red-200 bg-red-50 p-3 text-sm text-red-800`。
  項目に紐づかないエラーだけに使う(項目のエラーは §8.6 のとおり欄の直下)
- Escape で閉じる。処理中は Primary を `disabled` にして多重送信を防ぐ

### 8.14 Menu / Dropdown

`min-w-40 rounded-sm border border-rule-strong bg-surface py-1 shadow-md shadow-stone-900/10`。
項目は `flex items-center gap-2 h-8 px-3 text-sm text-ink hover:bg-stone-50`、
取り消しにくい操作は `text-red-700`。チェックリスト型は項目先頭に §8.6 の checkbox。

### 8.15 Toast

`fixed bottom-4 left-4 z-50 flex items-center gap-3 h-10 px-4 rounded-sm bg-ink text-paper text-sm shadow-md shadow-stone-900/20`。
3 秒で自動的に消える。エラーは消えず、右端に Ghost「閉じる」(`text-paper`)。
モバイルでは `bottom-4 inset-x-4`。

### 8.16 Attachment List(添付)

グリッドのサムネイルにせず、表の行で並べる。

`flex items-center gap-3 h-10 px-3 border-b border-rule last:border-0 text-sm`

- 画像なら `size-8 rounded-xs border border-rule object-cover`、それ以外は 16px のファイルアイコン
- ファイル名(`truncate`)+ サイズ(`font-mono text-xs text-ink-muted`)+ 登録者 + 日付(`font-mono text-xs text-ink-muted`)
- 末尾に Ghost「…」(開く / 削除)。

### 8.17 Banners

画面最上部に固定し、複数あれば縦に積む。高さ 32px、文言は §10 の許可場所に置く。

- **ローカルプレビュー:** `flex items-center justify-center gap-2 h-8 bg-ink text-paper text-xs`
  「ローカルプレビュー: 本番では実際のログインと権限が適用されます。」(一般の社員に切り替えているときは末尾に「(メンバーとして表示)」)
- **社員の一覧を取得できないとき:** バナーも設定案内も出さない。社員を選ぶ場面(コンボボックスのリスト内)と
  社員別一覧の表の上に「社員の一覧を取得できませんでした。」とだけ出す。社員一覧の有効化手順は README の
  導入手順にだけ書き、画面には書かない。独自の社員登録フォームへ誘導しない

### 8.18 Icons

Lucide を `size-4 stroke-[1.5]`(16px)で使う。置く場所はナビ項目・操作ボタン・検索欄・
ソート矢印・ファイル種別だけ。表のセル、見出し、空状態に装飾アイコンを置かない。

---

## 9. 共有機材管理 固有(このアプリの顔)

このアプリの主役は **機材**。「いつ空いているか」を機材ごとに見渡せる **今日から 7 日の空き帯**(§9-A)と、
機材に貼って詳細ページへ飛べる **QR 付きの資産タグ**(§9-B / §9-C)が顔になる。
人が主役の備品管理(社員の名札ヘッダ)とは逆で、人は予約・貸出の行の中で見る。

### 状態色の対応(§5 の状態色を本アプリでこう使う)

§5 の状態色の表(未割当 / 支給中 / 返却待ち / 利用停止 / 返却期限超過)はそのまま使い、本アプリの状態を次のように当てる。
意味色は変えない。文字ラベルは常に付ける。

| 本アプリの状態                    | §5 の配色                        | チップの文言          |
| --------------------------------- | -------------------------------- | --------------------- |
| 空き                              | 未割当(実線・無彩色)             | 空き                  |
| 貸出中                            | 支給中(実線・アクセント)         | 貸出中                |
| 予約あり(いま予約の時間帯)        | 返却待ち(破線)                   | 予約あり              |
| 期限超過(返却予定を過ぎた貸出中)  | 返却期限超過(実線・朱)           | 期限超過              |
| 利用停止                          | 利用停止(実線・琥珀。理由を併記) | 利用停止: 修理中 など |
| 返却済 / 回収済(貸出台帳の確定行) | 朱印(§8.9)                       | 返却済 / 回収済       |

予約の状態チップ(予約の一覧): 予約中 = 破線、利用時間中 = アクセント、期限切れ・貸出済・取消 = 無彩色(取消は取り消し線)。

### A. 機材の一覧 — `/equipment`(顔)

全員が使う全件表。§8.3 の表 + §8.4 のフィルタ + §8.2 の集計ストリップ(全件 / 空き / 貸出中 / 予約あり / 利用停止、
期限超過は 1 件以上のときだけ朱で)。管理者には選択列と一括の CSV 出力が付く。

| 列               | 幅               | 揃え | 表現                                                 | 優先度 |
| ---------------- | ---------------- | ---- | ---------------------------------------------------- | ------ |
| 選択(管理者)     | 48px             | 中央 | checkbox。固定列                                     | 1      |
| 管理番号         | 120px            | 左   | 管理番号チップ(§8.7)。固定列                         | 1      |
| 名称             | 可変(最小 200px) | 左   | `font-medium text-ink`、`truncate`                   | 1      |
| 状態             | 120px            | 左   | 状態チップ(§8.8、上の対応表)                         | 1      |
| 7 日の空き       | 約 350px         | 左   | **空き帯**(下記)。ヘッダは日付と曜日                 | 1      |
| 利用者           | 150px            | 左   | アバター 20px + 表示名(現在の借り手)。いなければ `—` | 2      |
| 返却予定         | 150px            | 左   | `font-mono`。期限超過は `text-seal`                  | 2      |
| 種類             | 120px            | 左   | 文字列                                               | 2      |
| 保管場所         | 130px            | 左   | `text-ink-muted`                                     | 3      |
| 製造番号(管理者) | 140px            | 左   | `font-mono text-ink-muted`                           | 3      |
| 更新             | 130px            | 左   | `font-mono text-xs text-ink-muted`                   | 4      |
| 操作             | 80px             | 右   | 1 つだけ(下記)                                       | 1      |

**空き帯(7 日の空き)** — 表の 1 列の中に、今日から 7 日分の小さなセルを横に並べる。カードにしない。

- セル: `relative block w-12 h-4 rounded-xs border border-rule bg-surface overflow-hidden`、セルの間は `gap-0.5`。
  1 セル = 1 日で、**8:00〜20:00 を幅いっぱい**に描く(それ以外の時間帯は切る)
- 帯: `absolute inset-y-[3px] rounded-[1px]`、左端と幅は時刻の割合(最小 2px)
  - 貸出中 `bg-accent` / 期限超過の貸出 `bg-seal`(今日の終わりまで描く)/ 予約 `bg-accent-soft border border-accent/50`
  - 自分の予約・貸出は `ring-1 ring-inset ring-ink/70` を足す
- 今日の過ぎた時間は `bg-stone-100` で塗る。利用停止中の機材はセルを `border-amber-200 bg-amber-50` にする
- 各セルの `title` に「日付 期間 名前(予約/貸出)」を並べる。色だけに頼らないよう、表の上(フィルタバーの右端)に凡例
  「■貸出中 ■予約 ■期限超過 帯は 8:00〜20:00」を `text-xs text-ink-muted` で置く
- ヘッダの `th` に日ごとのラベル(`10/3` の下に曜日。今日は `text-ink font-medium`、土日は `text-ink-faint`)をセルと同じ幅で並べる

**行の操作**(末尾 1 列に 1 つだけ。§2): 自分の貸出(管理者は誰の貸出でも)→「返却」/ いま借りられる(貸出中でなく、
いまの予約が無いか自分の予約)→「借りる」(管理者は「貸出」)/ それ以外で利用停止でない →「予約」/ 利用停止中は空。

- 既定ソートは管理番号の昇順。検索対象は 管理者: 管理番号・名称・種類・製造番号・備考・利用者、一般利用者: 管理番号・名称・種類
- 絞り込み: 状態(複数)/ 種類(「種類なし」を含む)/ 保管場所
- 行クリックで機材詳細へ。ヘッダ右(管理者)の Primary は「機材を登録」、Secondary は「CSV で取り込む」(§9-H)と「CSV 出力」

### B. 機材詳細 — `/equipment/[id]`(全員)

- **ヘッダ:** `flex items-start justify-between gap-4 px-6 py-4 border-b border-rule`
  - 左: 管理番号チップ(大)+ H1(名称)+ 状態チップ
  - 右: 状態に応じた Primary(自分の貸出・管理者 →「返却を記録」+ Secondary「返却予定を変更」/ いま借りられる →「借りる」(管理者は「貸出を記録」))+
    Secondary「予約する」(利用停止中は出さない)+ 管理者は Secondary「編集」+ Ghost「…」(利用停止にする / 利用を再開)
- **本文:** `grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6 px-6 py-4`
  - 左: 属性の定義リスト(§8.11): 種類 / 保管場所(管理者はさらに 製造番号 / 備考 / 更新)。その下に H2「今日から 7 日の空き状況」と
    空き帯の大(セル `w-16 h-5`)+ 説明 1 行
  - 右 1: パネル `border border-rule rounded-sm bg-surface p-4`「現在の状態」。
    貸出中なら アバター + 表示名 / 貸出 / 返却予定(超過は `text-seal`)、期限超過なら朱の 1 文「返却予定を過ぎています。返却が記録されるまで、次の人に貸し出せません。」。
    いま予約の時間なら「いまは予約の時間です: 名前」+ 期間。空いていれば「空いています。」。
    利用停止中は注意色(§5)の囲みで理由・詳細(管理者)と「新しい予約と貸出はできません。入っている予約 N 件は残っています。」。
    最下段に罫線で区切って「次の予約: 期間 名前」
  - 右 2: パネル「QR コード」: QR の画像(`size-28 border border-rule rounded-xs bg-white`)+ 補足「読み取るとこの機材のページが開きます(ログインが必要です)。」+
    Secondary 小型「ラベルを印刷」(§9-C)
- **下部タブ(§8.12):** 今後の予約(§9-M の表。この機材の分、機材列なし)/ 貸出台帳(§9-F。一般利用者には「自分の利用」として自分の分だけ)/
  履歴(管理者)/ 添付(§8.16。閲覧は全員、追加・削除は管理者)

### C. ラベル印刷 — `/equipment/[id]/label`

QR 付きの資産タグを 1 枚印刷する画面。ページヘッダ「ラベルを印刷」+ Secondary「機材のページへ」+ Primary「印刷する」。

- ラベル: `inline-flex items-center gap-3 w-[62mm] h-[32mm] p-[2mm] border border-rule-strong bg-white`。
  左に QR(28mm 角)、右に 管理番号(`font-mono text-[13px] font-medium tracking-wide`)/ 名称(`text-[9px]`、3 行まで)/ アプリ名(`text-[8px] text-ink-muted`)
- 印刷時はラベル以外を隠す(印刷用のスタイルはこの画面のコンポーネントに置き、アプリシェルは変えない)

### D. 自分のページ — `/me`(全員)

一般利用者の着地(管理者もナビから開ける)。

- **ヘッダ:** アバター `size-10` + 表示名 + メール(`font-mono text-xs`)、点数 2 つ(「借りている」「予約」。`font-mono text-2xl`)、
  右に Secondary「機材を探す」+ Primary「予約する」
- **借りている機材:** §8.3 の表。列 管理番号 / 名称 / 貸出 / 返却予定(超過は朱)/ 状態 / 操作(Ghost 小型「延長」「返却」)。
  ここだけは主操作が 2 つある(返却予定の変更と返却は、借りている本人が毎日使うため)
- **タブ:** 自分の予約(今後。§9-M の表、予約者列なし。受け取れる予約は「貸出」、それ以外は「取り消す」。利用停止中・前の利用者が未返却の予約は
  機材名の右に警告(琥珀・朱))/ 利用の履歴(§9-F、自分の分)
- 補足 1 行: 「予約の時間になったら(開始の 30 分前から)「貸出」で借りられます。」

### E. ダイアログ

すべて §8.13。対象の機材は冒頭に 管理番号チップ + 名称 を `flex items-center gap-2 text-sm` で固定表示する(画面から決まらないときは機材の選択欄)。
日時の欄は `datetime-local`(`step="900"` = 15 分)、`font-mono tabular-nums`。入力の誤りは §8.6 の項目単位のエラーで出す。

- **予約する:** 機材(選択。利用停止でないもの)/ 予約する人(管理者だけ。社員コンボボックス、空欄なら自分)/ 開始・終了(2 列)/ 目的・備考(任意。
  補助文「自分と管理者だけに見えます。」)。その下に罫線で区切って「この機材の予定」(貸出中・今後の予約を `font-mono` の期間 + 名前で最大 8 行)。
  開始の既定値はいまの 15 分枠から最初の空き 1 時間。重なりは開始の欄の直下に「ほかの予約・貸出と重なっています。…」。Primary「予約する」。トースト「予約しました。」
- **借りる / 貸出を記録:** 機材(選択。いま空いているもの)/ 借りる人(管理者だけ。空欄なら自分。他人の予約から貸し出すときは固定表示)/
  貸出日時(いま。表示だけ)/ 返却予定(既定は予約の終了、予約が無ければ 2 時間後)/ 備考(任意)。
  次の他人の予約があれば返却予定の下に「次の予約: 期間 名前。返却予定はこの開始までにしてください。」。
  Primary「借りる」(管理者は「貸出を記録」)。トースト「借りました。返却予定までに返却してください。」/「貸出を記録しました。」
- **返却を記録:** 貸出日時 / 返却予定 / 返却日時(いま)を 3 列で表示 + 備考。管理者はさらに 保管場所(select、既定は「変えない」)と
  状態(radio: そのまま / 要修理 → 利用停止の理由)。Primary「返却を記録」。完了: トースト「返却を記録しました。」+ 貸出台帳の該当行に朱印(小)が `.stamp-press` で現れる
- **返却予定を変更:** いまの返却予定(表示)/ 新しい返却予定 + 次の予約の補助文。Primary「変更する」
- **予約を取り消す(確認):** 機材・期間・予約者を表示し、「取り消すと、この時間はほかの人が予約できるようになります。」。Danger「予約を取り消す」
- **機材を登録 / 編集:** 管理番号 / 種類(任意)/ 名称 / 製造番号(任意)/ 保管場所(任意。select)/ 備考(任意。「管理者だけに見えます。」)。
  登録は Secondary「保存して続けて登録」(種類と保管場所を残す)+ Primary「登録する」
- **利用停止にする:** 理由(select)+ 詳細。補助文「新しい予約と貸出を止めます。入っている予約は残り、予約した人に警告が出ます。貸出中なら返却は記録できます。」
- **競合エラー(同時操作):** 本文内エラー(例: `equipment_on_loan`「この機材は貸出中です」、`previous_loan_not_returned`「前の利用者が未返却です」)。
  ダイアログは閉じず、Primary を無効にし、画面の内容を読み直す

### F. 貸出台帳(履歴の二欄表)

機材詳細・自分のページで共通の履歴表。1 行 = 1 貸出。貸出と返却を 2 つの日時列で並べ、返却列が空なら貸出中。

| 列                                     | 揃え | 表現                                                  | 優先度 |
| -------------------------------------- | ---- | ----------------------------------------------------- | ------ |
| 貸出                                   | 左   | `font-mono`(日時)                                     | 1      |
| 返却                                   | 左   | `font-mono`。空は `—`                                 | 1      |
| 利用者(機材側の表)/ 機材(自分の側の表) | 左   | アバター + 表示名 / 管理番号チップ + 名称             | 1      |
| 返却予定                               | 左   | `font-mono`。貸出中で超過なら `text-seal`             | 2      |
| 期間                                   | 右   | `font-mono tabular-nums`(分・時間・日)                | 2      |
| 記録した人                             | 左   | `text-xs text-ink-muted`(貸した人 / 返却を記録した人) | 3      |
| 印                                     | 右   | 返却済 / 回収済 の朱印(小)。貸出中は状態チップ        | 1      |

- 貸出中の行は `bg-accent-soft/30`。既定ソートは貸出の降順。表示名は記録時のスナップショット

### G. 履歴 — `/history`(管理者)

§8.3 の表。列: 日時(`font-mono`)/ 操作(予約 / 予約取消 / 貸出 / 延長 / 返却 / 登録 / 編集 / 利用停止 / 再開 / 取込)/
対象(管理番号チップ + 名称)/ 利用者 / 操作者 / 備考・差分(`truncate`、クリックで行下に展開。日時は `YYYY-MM-DD HH:mm`)。
絞り込み: 操作種別 / 期間 / 操作者 / 検索。ページングあり。

### H. CSV 取込・出力 — `/import`(管理者)

ホームと機材の一覧のヘッダの Secondary「CSV で取り込む」から入る。手順は番号付きの節(カードにしない)。
`space-y-8`、各節は H2(`text-sm font-semibold pb-2 border-b border-rule`)+ 内容。

1. **ファイルを選ぶ:** 列の説明 + Secondary「ファイルを選ぶ」+ Ghost「ひな形をダウンロード」(見出し + 例 2 行)。
   選択後にファイル名(`font-mono text-sm`)+ 判別した文字コード + 列の対応(定義リスト §8.11。読まない列は「取り込まない」)。
   ファイル全体の問題(必須の列がない・引用符が閉じていない など)はファイル名の直下に §8.6 のエラー文で、行番号つきで出す
2. **取り込み方を決める:** checkbox「未登録の種類・保管場所を自動で追加する」(既定オン)。切り替えるとプレビューを取り直す。
   オフにすると未登録の種類・保管場所の行は「不可」になる
3. **内容を確認する(プレビュー):** §8.3 の表。列は 行番号 | 判定チップ | ファイルの各列 | 確認事項。判定は 取込可 / 要確認 / 不可。
   要確認行は `bg-amber-50/60`、不可行は `bg-red-50/60`。問題のある値は 要確認 `text-amber-800` / 不可 `text-red-700` で示し、
   確認事項の列に「列名: 理由」を出す。表の直上に集計ストリップ「全件 N / 取込可 N / 要確認 N / 不可 N」(クリックで絞り込み)と、
   追加される種類・保管場所の名前。100 行を超えたらページング(画面内)
   - 不可: 必須(管理番号・名称)の欠落、管理番号の重複(ファイル内・既存)、長すぎる値、無効にした種類・保管場所
   - 要確認: 種類・保管場所が未登録(追加する)
4. **取り込む:** Primary「取り込む」(不可が 0 のとき有効)+ 不可があるときだけ Secondary「不可を除いて取り込む」。
   100 行ごとのトランザクションで登録し、途中で失敗したらそこで止めて「N 行目から M 行目のまとまりで止まりました」と示す。
   結果: 「登録 N 件 / 除外 N 件」+ 追加した種類・保管場所 + Secondary「機材の一覧で見る」。履歴には「取込」1 件(件数つき)と機材ごとの「登録」が残る

- **ファイルの形式:** 1 行目は見出し。列は 管理番号* / 名称* / 種類 / 製造番号 / 保管場所 / 備考(`*` は必須の印で、付いていなくてもよい)。
  知らない列は読まない。文字コードは UTF-8(BOM の有無どちらも)と Shift_JIS を自動判別、CRLF / LF 両対応。上限 2,000 行・2 MB。
  予約・貸出は取り込めない
- **出力:** 機材の一覧のヘッダの Secondary「CSV 出力」と一括バーから。列は取込と同じ順に並べ、出力だけの列
  (状態 / 利用停止の理由 / 利用者 / 返却予定 / 更新日時)は末尾に置く。出力 → 編集 → 取込 の往復ができる(既存の管理番号の行は「不可」)

### I. マスタ管理 — `/masters`(管理者)

タブ(§8.12): 種類 / 保管場所。§8.3 の小さな表(名称 / 機材の件数 / 状態 / 操作)+ 最終行にインライン追加。使用中の値は無効化のみ。
保管場所は「機材を返してもらったときに置く場所」(返却の記録で管理者が選び直せる)。

### J. 権限による出し分け

- `manage` あり: ナビ全項目、ホーム、全員の予約、代理の予約・貸出・回収、機材の登録・編集・利用停止、添付の追加・削除、CSV、マスタ管理、履歴
- `manage` なし(一般利用者): 機材の一覧・機材詳細(共有の情報)・予約(自分)・自分のページ。自分の予約・貸出・返却・延長・取消だけ
- 出し分けは UI だけに頼らず、サーバー側で 403 を返す。`forbidden_manage_required` / `reservation_not_owned` / `loan_not_owned` を messages マップで解決する

### K. モバイル(`md` 未満)

- サイドバーは上部バー + ドロワー(§8.1)。背表紙は上辺 4px
- **表は表のまま。** 優先度 1 の列だけ表示し、横スクロール。空き帯も表の中に残す
- 主な利用場面は、機材に貼った QR を読み取って開く **機材詳細**(借りる・返却・予約)と **自分のページ**(返却・延長)。名称の列は狭めて操作を画面内に残す
- ダイアログは `w-[calc(100%-2rem)]` の中央表示(ボトムシートにしない)

### L. ホーム — `/`(管理者)

管理者の着地画面。一般利用者が `/` を開いたら自分のページ(§9-D)へ移す。

- **ページヘッダ:** H1「ホーム」+ 右に Secondary「CSV で取り込む」
- **動線バー:** `flex flex-wrap gap-2 px-6 py-3 border-b border-rule` に Primary「機材を登録」+ Secondary「予約する」「貸出を記録」(機材は選択欄で選ぶ)
- **本日の数(§8.2 の集計ストリップ):** 本日の返却予定 / 期限超過(1 以上は朱)/ 本日の予約 / いま空いている機材。各数値は該当の一覧へのリンク。カードにしない
- **要対応**(§8.3 の表): 期限超過 → 他人の予約が 24 時間以内に迫る貸出中 → 利用停止 の順で最大 10 行。
  列 状態 | 管理番号 | 名称 | 利用者 | 期限または理由(返却予定。通知を送っていれば「通知: 送信済 / 送信失敗」を併記)| 次の予約・残っている予約 | 操作(貸出中は「返却」、それ以外は「詳細」)。
  見出しの横に総件数、右に通知が未設定なら「返却の通知: 未設定(期限はこの一覧で確認できます)」。0 件なら表内に「対応が必要な機材はありません。」
- **本日の返却予定と予約**(§8.3 の表): 時刻順。列 時刻 | 種別(返却予定 / 予約(貸出済))| 管理番号 | 名称 | 利用者 | 操作(返却予定は「返却」)
- **最近の履歴**(§9-G の表): 直近 10 行 + 見出し右に Ghost「履歴をすべて見る」

### M. 予約 — `/reservations`(全員)

- ページヘッダ「予約」+ 総件数 + Primary「予約する」
- タブ: 自分の予約(今後)/ 自分の予約(過去)/ すべての予約(管理者。期間の date 2 つで絞り込み、既定は今日から)
- §8.3 の表。列 期間(`font-mono`、同じ日なら終了は時刻だけ)| 機材(管理番号チップ + 名称)| 予約した人(すべての予約のとき)|
  目的・備考(本人と管理者だけ。他人の分は `—`)| 状態(予約のチップ)| 操作(利用時間中の予約は「貸出」、それ以外の active は「取り消す」)

---

## 10. Tone of Voice & エラーハンドリング

### 文言

UI 文言は事実の記述。記号(「!」、絵文字)、称賛、擬人化を使わない。ボタンは動詞で終える。

| Do                                         | Don't                                    |
| ------------------------------------------ | ---------------------------------------- |
| 「予約しました。」                         | 「予約完了!🎉」                          |
| 「返却を記録しました。」                   | 「返却ありがとうございます!」            |
| 「該当する機材はありません。」             | 「まだ何もないみたいです 👀」            |
| 「この機材は貸出中です」                   | 「おっと、誰かが先に使っているようです」 |
| ボタン「予約する」「借りる」「返却を記録」 | 「予約!」「OK」「送信」                  |

### 文言の置き場所

人間向け文言は、決まった場所にだけ書く(一覧は [AGENTS.md](./AGENTS.md) の「日本語を書いてよい場所」)。識別子・コードコメントは英語。

### エラーメッセージの構造

サーバーは安定したエラーコードだけを返す(例: `equipment_on_loan` / `previous_loan_not_returned` / `equipment_reserved` /
`equipment_suspended` / `forbidden_manage_required` / `loan_not_owned` / `csv_missing_columns`)。
表示文言はフロントの messages マップで解決し、3 点セットで出す。項目に紐づく入力の誤りは `validation_failed` +
`fields` で返し、欄の直下に 1 文で出す(§8.6)。

- **Title:** 短い事実(例: 「前の利用者が未返却です」)
- **Body:** 原因と対処を 1 文ずつ(例: 「原因: 返却予定を過ぎても返却が記録されていません。対処: 前の利用者か管理者に連絡し、返却を記録してから借りてください。」)
- **Action:** 再試行、または解決画面への導線(管理者には機材詳細、一般利用者には「管理者に連絡」の文言)

---

## 11. カスタマイズ(何を変えてよいか)

| 変えてよい                   | 方法                                                                          |
| ---------------------------- | ----------------------------------------------------------------------------- |
| アクセント色                 | §5 の `--color-accent` 系 3 行                                                |
| 書体                         | §5 の `--font-sans` / `--font-mono` 2 行 + §6 の `<link>`。等幅書体は必ず残す |
| ナビの項目名・順序           | §8.1 のナビ配列                                                               |
| 各表の既定表示列・既定ソート | §9 の列表の優先度                                                             |
| 空き帯の時間幅(8:00〜20:00)  | `Strip.svelte` の `DAY_START` / `DAY_END`                                     |
| 種類・保管場所の選択肢       | マスタ管理(§9-I)。コード変更不要                                              |

| 変えない                      | 理由                                                 |
| ----------------------------- | ---------------------------------------------------- |
| `paper` / `ink` / `rule` の値 | 家族共通の紙面。姉妹テンプレートと並べたときの一体感 |
| 角丸・影のルール(§7)          | 台帳の見た目そのもの                                 |
| 一覧を表以外にする(§2)        | 件数が多いときに破綻する                             |
| 朱を印以外に使う(§8.9)        | 「確定」の意味が薄れる                               |

ダークモードは初版では提供しない(紙のメタファーを優先)。

---

## 12. 受入チェック(実装者・レビュアー用)

- [ ] `document.fonts.check('14px "IBM Plex Sans JP"')` と `('14px "IBM Plex Mono"')` が true
- [ ] `body` の背景が `#F7F5F0`、本文色が `#1C1917`
- [ ] 一覧がすべて `<table>`。カード・タイル・リスト型の一覧が 1 つもない(モバイル幅含む)
- [ ] 機材の一覧に 1,000 件入れた状態で、ヘッダ固定・先頭列固定・50 件ページング・総件数表示が動く
- [ ] `shadow-*` を持つ要素がダイアログ・メニュー・トースト以外にない
- [ ] `rounded-md` 以上を持つ要素がアバター・朱印以外にない
- [ ] 紫・インディゴ系の色、グラデーション背景がない
- [ ] 状態チップにすべて文字ラベルがある。予約ありは破線、返却済・回収済は朱印
- [ ] 管理番号はすべて §8.7 のチップ、日付・数量はすべて等幅
- [ ] キーボードだけで 機材の一覧 → 行選択 → 詳細 → 予約ダイアログ → 確定 まで辿れ、フォーカスが常に見える
- [ ] 機材の一覧の 1 列の中に 7 日の空き帯があり、凡例があり、セルの `title` で期間と名前が分かる
- [ ] 重なる予約を入れると、開始の欄の直下に「ほかの予約・貸出と重なっています。…」が出る
- [ ] 機材詳細に QR が出て、「ラベルを印刷」で 1 枚のラベルだけが印刷される
- [ ] 返却確定で朱印が 1 回だけ押印アニメーションし、`prefers-reduced-motion` で止まる
- [ ] UI 文言に「!」・絵文字・称賛がない
- [ ] 登録ダイアログで既存の管理番号を入れると、管理番号の欄の直下に「この管理番号はすでに登録されています。」が出て、
      その欄にフォーカスが移る(ダイアログ上部には出ない)
- [ ] 管理者は `/` でホーム(本日の数・要対応・本日の返却予定と予約・最近の履歴)、一般利用者は自分のページに着地する
- [ ] 一般利用者(`/__keelson/dev` で名簿の一般の社員に切り替え)で管理ナビ・他人の目的・備考・製造番号が見えず、管理 API が 403

---

## 付録 A. 姉妹テンプレートへの展開表

4 本は本書の §1〜§8 を骨格として共有し、次の 3 軸だけを差し替える。
展開手順: (1) §5 の `--color-accent` 系 3 行を置換 → (2) §9 をそのアプリの顔に書き換える →
(3) 本付録の自分の行を「本アプリ」に直す。§1〜§8 は編集しない。

| テンプレート                 | 主役 | 背表紙色(accent / strong / soft)         | 顔となる部品                                                                          |
| ---------------------------- | ---- | ---------------------------------------- | ------------------------------------------------------------------------------------- |
| 備品管理                     | 社員 | 帳簿緑 `#166534` / `#14532D` / `#DCFCE7` | 社員の名札ヘッダ + 支給中 / 返却待ちの二段表                                          |
| 共有機材管理(本アプリ)       | 機材 | 鉄紺 `#155E75` / `#164E63` / `#CFFAFE`   | 空き状況の横タイムライン(日 × 機材の予約・貸出帯、§9-A)+ QR 付き資産タグ(§9-B, §9-C)  |
| 社外貸出・レンタル管理       | 案件 | 焦茶 `#78350F` / `#451A03` / `#F3EBE1`   | 案件ステッパー(予約 → 出荷 / 引渡 → 返却 → 検品)+ 機器明細の部分返却・検品表          |
| ソフトウェア・ライセンス管理 | 契約 | 藍 `#1E40AF` / `#1E3A8A` / `#DBEAFE`     | 購入枠メーター(割当 / 枠、`font-mono` の分数 + 細いバー)+ 更新日・解約期限の 2 期限列 |

- 4 色とも白文字と 4.5:1 以上。soft は意味色(琥珀・赤)と混ざらない色を選んである
- 顔となる部品も §2 の原則に従う。タイムラインやステッパーは表の行の中、または表の直上の 1 段に置き、カード化しない
- 朱印の用途: 共有機材は本人の返却が「返却済」・管理者の代理返却が「回収済」、社外貸出は「検品済」、ライセンスは「解除済」

---

## 付録 B. 初版の実装との差分

共有機材管理の初版(2026-10-03)で決めた差分をここに記録する。§1〜§8 の本文は備品管理 v0.12 のまま変えていない(§5 のアクセント 3 行だけ差し替えた)。本文の中で備品管理の画面を指している箇所は、本アプリでは次のように読む。

- **アプリ名(§8.1 の例)**: 「備品管理」→「共有機材管理」。
- **ナビ(§8.1)**: 本アプリのナビは ホーム(管理者)/ 機材 / 予約 / 自分のページ、区分「管理」(管理者)に 履歴 / マスタ管理。
  一般利用者は 機材 / 予約 / 自分のページ(機材の一覧は全員の画面)。CSV 取込はナビに置かず、ホームと機材の一覧のヘッダから入る。
- **状態色(§5)**: 本アプリの状態への当て方は §9 の冒頭の対応表。「返却待ち」の破線は「予約あり」に使う。
- **ページヘッダの例(§8.2)**: 「物品を登録」→「機材を登録」。集計ストリップの例「支給中 128」→「貸出中」。
- **表(§8.3)**: 一般利用者の機材の一覧には選択列が無い(先頭の固定列は管理番号)。空き帯の列は §9-A。
- **社員コンボボックス(§8.6)**: 管理者が代理で予約・貸出するときだけ使う。一般利用者には出さない。
- **添付(§8.16)**: 閲覧は全員、追加・削除は管理者(備品管理は管理者だけ)。
- **日時の書式(§6)**: 予約・貸出の日時は `YYYY-MM-DD HH:mm`(アプリのタイムゾーンの時刻をそのまま表示し、ブラウザのタイムゾーンに直さない)。
  期間は同じ日なら `YYYY-MM-DD HH:mm – HH:mm`。
- **朱印(§8.9)**: 本人の返却 =「返却済」、管理者が他人の貸出の返却を記録 =「回収済」。
- **モーション(§7)・Select(§8.6)・表の固定ヘッダ(§8.3)・アプリシェル(§8.1)・タップ領域(§4)**: 備品管理の付録 B と同じ実装
  (`transform: scale()` だけのキーフレーム、`select-chevron`、`max-h-[calc(100dvh-17rem)]` の中でスクロール、`h-dvh` のシェル、`pointer-coarse:h-11`)。
- **自分のページの操作(§2 の例外)**: 借りている機材の表だけは行の操作を 2 つ(延長・返却)置いた(§9-D)。
- **ラベル印刷(§9-C)**: 印刷用のスタイルは画面のコンポーネント内の `@media print` に置き、`src/app.css` とアプリシェルは変えていない。

v0.2(2026-10-04)で §8.10 を「画像があれば画像、無ければ頭文字」に書き換えた(備品管理 v0.12 と同じ文面。Directory API の `image_url`)。
§2 の「アバターは 20px まで」は変えていない。
