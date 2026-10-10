// Error code -> message map (the frontend's one message file).
// The API returns only stable codes; every human-readable error lives here, as
// a short title plus "cause / what to do" body (DESIGN.md §10), and for a code
// that has one, the page to go to instead. The tables are keyed by the
// server's code types, so a code without a message is a type error
// (`pnpm check`).

import type { ErrorCode, FieldReason } from '#lib/server/errors.ts';
import type { ImportIssueCode } from '#lib/server/import/importer.ts';

export interface ErrorMessage {
	title: string;
	body: string;
	/** A page the user can go to instead (the page-level ErrorBox links it). */
	action?: { href: string; label: string };
}

/** Codes the browser itself reports (src/lib/api.ts): the server could not be reached. */
type ClientCode = 'network_error';

const MESSAGES: Record<ErrorCode | ClientCode, ErrorMessage> = {
	unauthorized: {
		title: 'ログインが必要です',
		body: 'ログインの有効期限が切れた可能性があります。ページを再読み込みしてください。',
	},
	forbidden_manage_required: {
		title: 'この操作には管理権限が必要です。',
		body: '管理権限を持つ人に操作を依頼してください。',
		// A user without `manage` on an admin screen: the page every user has.
		action: { href: '/me', label: '自分のページへ' },
	},
	validation_failed: {
		title: '入力内容を確認してください',
		body: '赤字で示した項目を直してください。',
	},
	invalid_request: {
		title: '入力内容を確認してください',
		body: '必須項目が空か、形式が正しくない項目があります。',
	},
	unsupported_media_type: {
		title: '送信できませんでした',
		body: 'ページを再読み込みしてから、もう一度操作してください。',
	},
	not_found: {
		title: '見つかりません',
		body: 'URL が正しいか確認してください。削除された可能性があります。',
	},
	equipment_not_found: {
		title: '機材が見つかりません',
		body: '一覧を再読み込みしてください。',
	},
	equipment_suspended: {
		title: 'この機材は利用停止中です',
		body: '原因: 修理中・故障などで利用を止めています。対処: 管理者が利用を再開するまで、予約と貸出はできません。',
	},
	equipment_not_suspended: {
		title: '利用停止中ではありません',
		body: '最新の状態を読み込みました。',
	},
	equipment_version_conflict: {
		title: 'ほかの人が先に更新しました',
		body: '最新の内容を読み込んでから、もう一度編集してください。',
	},
	equipment_on_loan: {
		title: 'この機材は貸出中です',
		body: '最新の状態を読み込みました。返却されてから借りるか、空いている時間を予約してください。',
	},
	previous_loan_not_returned: {
		title: '前の利用者が未返却です',
		body: '原因: 返却予定を過ぎても返却が記録されていません。対処: 前の利用者か管理者に連絡し、返却を記録してから借りてください。',
	},
	equipment_reserved: {
		title: 'いまはほかの人の予約の時間です',
		body: '予約の時間が終わってから借りるか、空いている時間を予約してください。',
	},
	reservation_not_found: {
		title: '予約が見つかりません',
		body: '最新の状態を読み込んでください。',
	},
	reservation_not_owned: {
		title: '自分以外の予約は取り消せません。',
		body: '取消は予約した本人か管理者が行います。管理者に連絡してください。',
	},
	reservation_not_active: {
		title: 'この予約は使えません',
		body: 'すでに取り消されたか、貸出に使われたか、まだ受け取れる時間になっていません。最新の状態を読み込みました。',
	},
	loan_not_found: {
		title: '貸出の記録が見つかりません',
		body: '最新の状態を読み込んでください。',
	},
	loan_not_owned: {
		title: '自分以外の貸出は返却・延長できません。',
		body: '返却の記録は借りた本人か管理者が行います。管理者に連絡してください。',
	},
	loan_already_returned: {
		title: 'すでに返却が記録されています',
		body: '最新の状態を読み込みました。',
	},
	equipment_not_on_loan: {
		title: 'この機材は貸出中ではありません',
		body: 'すでに返却が記録されているか、まだ貸し出されていません。最新の状態を読み込んでください。',
	},
	member_not_found: {
		title: '社員が見つかりません',
		body: 'ワークスペースのメンバーから外れた可能性があります。一覧から選び直してください。',
	},
	people_unconfigured: {
		title: '社員の一覧を取得できませんでした',
		body: '社員を選べないため、ほかの人の分は記録できません。自分の分は記録できます。',
	},
	people_unavailable: {
		title: '社員の一覧を取得できませんでした',
		body: 'しばらく待ってから、もう一度操作してください。',
	},
	type_not_found: {
		title: '種類が見つかりません',
		body: '最新の状態を読み込んでください。',
	},
	location_not_found: {
		title: '保管場所が見つかりません',
		body: '最新の状態を読み込んでください。',
	},
	attachment_not_found: {
		title: '添付が見つかりません',
		body: '削除された可能性があります。',
	},
	attachment_too_large: {
		title: 'ファイルが大きすぎます',
		body: '1 ファイル 10 MB までです。',
	},
	attachment_type_unsupported: {
		title: 'この形式は添付できません',
		body: 'PNG / JPEG / WebP の画像と PDF を添付できます。',
	},
	attachment_limit_reached: {
		title: '添付の上限に達しています',
		body: '1 つの機材に添付できるのは 20 件までです。不要な添付を削除してください。',
	},
	attachment_storage_failed: {
		title: 'ファイルを保存できませんでした',
		body: 'しばらく待ってから、もう一度操作してください。',
	},
	csv_too_large: {
		title: 'ファイルが大きすぎます',
		body: '2 MB 以下に分けて取り込んでください。',
	},
	csv_too_many_rows: {
		title: '行が多すぎます',
		body: '一度に取り込めるのは 2,000 行までです。ファイルを分けてください。',
	},
	csv_encoding_unknown: {
		title: '文字コードを読み取れません',
		body: 'UTF-8 または Shift_JIS で保存した CSV を選んでください。',
	},
	csv_unclosed_quote: {
		title: '引用符が閉じていません',
		body: 'ダブルクォート(")で始まる値が閉じていません。その行を確認してください。',
	},
	csv_empty: {
		title: 'ファイルが空です',
		body: '1 行目に見出しがある CSV を選んでください。',
	},
	csv_no_rows: {
		title: '取り込む行がありません',
		body: '見出しの下に機材の行を入れてください。',
	},
	csv_missing_columns: {
		title: '必須の列がありません',
		body: '「管理番号」と「名称」の列が必要です。ひな形の見出しを使ってください。',
	},
	csv_duplicate_column: {
		title: '同じ列が 2 つあります',
		body: '見出しが重複している列を 1 つにしてください。',
	},
	import_has_errors: {
		title: '取り込めない行があります',
		body: '「不可」の行を直すか、「不可を除いて取り込む」を使ってください。',
	},
	import_nothing_to_import: {
		title: '取り込める行がありません',
		body: 'プレビューの判定を確認してください。',
	},
	mcp_tool_not_found: {
		title: 'この操作は見つかりません',
		body: 'AI アシスタントの接続を一度切り、つなぎ直してください。',
	},
	internal_error: {
		title: '処理できませんでした',
		body: 'しばらく待ってから、もう一度操作してください。',
	},
	network_error: {
		title: 'サーバーに接続できません',
		body: '通信状態を確認して、もう一度操作してください。',
	},
};

const FALLBACK: ErrorMessage = MESSAGES.internal_error;

// The API's codes arrive as plain strings: look them up as such.
function lookup<T>(table: Partial<Record<string, T>>, key: string): T | undefined {
	return table[key];
}

/** Message for an error code (unknown codes get the generic message). */
export function messageFor(code: string): ErrorMessage {
	return lookup(MESSAGES, code) ?? FALLBACK;
}

// Field errors: `{ fields: { <field>: <reason> } }` from the API, or the
// same shape from the form's own checks. Field names may carry a block prefix
// (`suspend.reason`); the message depends on the last part only.

const FIELD_REASONS: Record<FieldReason, string> = {
	required: '必須です。',
	too_long: '長すぎます。短くしてください。',
	invalid: '値が正しくありません。',
	invalid_date: '日付の形式が正しくありません。',
	invalid_datetime: '日時の形式が正しくありません。',
	step: '15 分単位(00・15・30・45 分)で指定してください。',
	past: '過ぎた時刻は指定できません。',
	before_start: '開始より後の日時を指定してください。',
	period_too_long: '1 回の予約は 30 日までです。',
	overlap: 'ほかの予約・貸出と重なっています。空いている時間を選んでください。',
	conflict: 'ほかの人の予約と重なります。次の予約の開始より前にしてください。',
	taken: 'すでに使われています。',
	not_found: '見つかりません。選び直してください。',
	ambiguous: '複数の候補があります。メールアドレスで指定してください。',
};

// `<field>:<reason>` -> a message that names what to do for that field.
const FIELD_OVERRIDES: Record<`${string}:${FieldReason}`, string> = {
	'assetTag:taken': 'この管理番号はすでに登録されています。',
	'name:taken': '同じ名前がすでにあります。',
	'userId:not_found': '社員が見つかりません。選び直してください。',
	'equipmentId:not_found': '機材が見つかりません。選び直してください。',
	'equipmentId:required': '機材を選んでください。',
	'locationId:not_found': 'この保管場所は使えません。選び直してください。',
	'typeId:not_found': 'この種類は使えません。選び直してください。',
	'startsAt:past': '開始は現在の時刻より前にできません。',
	'dueAt:past': '返却予定は現在より後にしてください。',
	'file:required': 'ファイルを選んでください。',
};

/** Message shown under a form field for a reason code. */
export function fieldMessage(field: string, reason: string): string {
	const name = field.split('.').pop() ?? field;
	return (
		lookup(FIELD_OVERRIDES, `${name}:${reason}`) ??
		lookup(FIELD_REASONS, reason) ??
		FIELD_REASONS.invalid
	);
}

// CSV import: the judgment of each cell (src/lib/server/import/importer.ts). A
// "needs a look" issue also says what the import will do with it.

const IMPORT_ISSUES: Record<ImportIssueCode, string> = {
	required: '必須です。',
	too_long: '長すぎます。',
	duplicate_in_file: 'ファイルの中で同じ管理番号が使われています。',
	duplicate_existing: 'この管理番号はすでに登録されています。',
	type_unregistered: '未登録の種類です。',
	location_unregistered: '未登録の保管場所です。',
	type_inactive: '無効にした種類です。マスタ管理で有効にしてください。',
	location_inactive: '無効にした保管場所です。マスタ管理で有効にしてください。',
};

// What the import does with a "needs a look" (`warn`) issue.
const IMPORT_WARN_ACTIONS: Partial<Record<ImportIssueCode, string>> = {
	type_unregistered: '取り込むときに追加します。',
	location_unregistered: '取り込むときに追加します。',
};

/** Message for one CSV import issue; `warn` issues add what will happen. */
export function importIssueMessage(code: string, level: string): string {
	const base = lookup(IMPORT_ISSUES, code) ?? FIELD_REASONS.invalid;
	const action = lookup(IMPORT_WARN_ACTIONS, code);
	return level === 'warn' && action ? `${base}${action}` : base;
}
