<script module lang="ts">
	import type { EquipmentStatus, SuspendReason } from '#lib/server/domain/equipment.ts';

	const T = {
		statuses: {
			available: '空き',
			on_loan: '貸出中',
			reserved: '予約あり',
			overdue: '期限超過',
			suspended: '利用停止',
		},
		reasons: { repair: '修理中', broken: '故障', lost: '紛失', other: 'その他' },
	};

	/** Status names; the ledger's counts strip and status filter list them too. */
	export const STATUS_LABELS: Record<EquipmentStatus, string> = T.statuses;

	/**
	 * Suspension reasons, in the order the suspend and return dialogs offer
	 * them; the home screen, the equipment page and the history show them too.
	 */
	export const REASON_LABELS: Record<SuspendReason, string> = T.reasons;
</script>

<script lang="ts">
	// Status chip (DESIGN.md §5 status colours, §8.8, §9). Always carries a text
	// label; shape differs too (reserved is dashed), so colour is never the
	// only cue. Colours follow the family's state palette: available = the
	// neutral "free" chip, on loan = accent, reserved = dashed, overdue = seal
	// red, suspended = amber.
	let { status, reason = null }: { status: EquipmentStatus; reason?: string | null } = $props();

	const STYLE: Record<EquipmentStatus, string> = {
		available: 'border-rule-strong bg-surface text-ink-muted',
		on_loan: 'border-accent/40 bg-accent-soft text-accent-strong',
		reserved: 'border-dashed border-stone-400 bg-stone-100 text-ink',
		overdue: 'border-seal/40 bg-seal-soft text-seal',
		suspended: 'border-amber-300 bg-amber-50 text-amber-800',
	};

	// A reason the table does not know is shown as its code.
	const label = $derived(
		status === 'suspended' && reason
			? `${STATUS_LABELS.suspended}: ${REASON_LABELS[reason as SuspendReason] ?? reason}`
			: STATUS_LABELS[status],
	);
</script>

<span
	data-testid="status-chip"
	data-status={status}
	class="inline-flex items-center h-5 px-1.5 rounded-xs border text-(length:--chip-text) font-medium whitespace-nowrap {STYLE[
		status
	]}">{label}</span
>
