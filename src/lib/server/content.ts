// Server-emitted human text (the one server file where Japanese is allowed). The API itself never returns prose — only documents for people
// carry labels: the CSV export and template, and the return reminders the
// cron job sends.

import type { EquipmentStatus, SuspendReason } from '#lib/server/domain/equipment.ts';

/** The app's name, as people see it (reminder mails). */
export const APP_NAME = '共有機材管理';

/**
 * CSV columns shared by the template, the import and the export (import/csv.ts), in
 * file order. The import reads a column by this header (a trailing `*`, which
 * the template uses to mark required columns, is ignored).
 */
export const CSV_COLUMNS = {
	assetTag: '管理番号',
	name: '名称',
	typeName: '種類',
	serialNo: '製造番号',
	locationName: '保管場所',
	note: '備考',
} as const;

/** Export-only columns, after the importable ones (the import ignores them). */
export const CSV_READONLY_COLUMNS = {
	status: '状態',
	suspendedReason: '利用停止の理由',
	borrower: '利用者',
	dueAt: '返却予定',
	updatedAt: '更新日時',
} as const;

/** Example rows of the import template. */
export const CSV_TEMPLATE_EXAMPLES: Record<keyof typeof CSV_COLUMNS, string>[] = [
	{
		assetTag: 'SP-0101',
		name: '検証用 Android 端末 Pixel 9',
		typeName: 'スマートフォン',
		serialNo: '3A281FDH200P5K',
		locationName: '本社 3F 機材庫',
		note: '充電ケーブル・ケース付き',
	},
	{
		assetTag: 'PJ-0102',
		name: 'モバイルプロジェクター 1080p',
		typeName: 'プロジェクター',
		serialNo: '',
		locationName: '本社 5F 会議室前ロッカー',
		note: '',
	},
];

/** Template download file name. */
export const CSV_TEMPLATE_FILE = 'equipment-template.csv';

export const STATUS_LABELS: Record<EquipmentStatus, string> = {
	available: '空き',
	on_loan: '貸出中',
	reserved: '予約あり',
	overdue: '期限超過',
	suspended: '利用停止',
};

export const SUSPEND_REASON_LABELS: Record<SuspendReason, string> = {
	repair: '修理中',
	broken: '故障',
	lost: '紛失',
	other: 'その他',
};

/** Download file name prefix: <prefix>-YYYY-MM-DD.csv */
export const CSV_FILE_PREFIX = 'equipment';

/**
 * Polite suffixes written after a name (an AI assistant may pass a person as
 * they were spoken of). A person reference that matches nobody is tried again
 * without one (src/lib/server/mcp/people.ts).
 */
export const NAME_HONORIFICS = ['さん', 'さま', '様', '氏', 'くん', '君', 'ちゃん'];

/** `YYYY-MM-DDTHH:MM` -> `YYYY-MM-DD HH:MM` for people. */
function showTime(at: string): string {
	return at.replace('T', ' ');
}

/** The return reminder mail (cron job `return-reminder`). */
export function reminderMessage(input: {
	kind: 'due_today' | 'overdue';
	name: string;
	assetTag: string;
	equipmentName: string;
	dueAt: string;
	url: string | null;
}): { subject: string; text: string } {
	const what = `${input.assetTag} ${input.equipmentName}`;
	const subject =
		input.kind === 'due_today'
			? `【${APP_NAME}】本日が返却予定です: ${what}`
			: `【${APP_NAME}】返却予定を過ぎています: ${what}`;
	const lead =
		input.kind === 'due_today'
			? `${input.name} さん\n\nお借りしている機材の返却予定は本日 ${showTime(input.dueAt).slice(11)} です。`
			: `${input.name} さん\n\nお借りしている機材の返却予定(${showTime(input.dueAt)})を過ぎています。次に使う人がいる場合があります。返却するか、延長してください。`;
	const lines = [lead, '', `機材: ${what}`, `返却予定: ${showTime(input.dueAt)}`];
	if (input.url) {
		lines.push('', `返却・延長はこちらから: ${input.url}`);
	}
	lines.push('', `このメールは ${APP_NAME} から自動で送っています。`);
	return { subject, text: lines.join('\n') };
}
