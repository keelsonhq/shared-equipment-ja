<script lang="ts">
	import type { ReservationView } from '#lib/server/domain/reservations.ts';

	// State of a booking: upcoming / running now / over and never picked up /
	// picked up (lent) / cancelled. Text label always; colour is a second cue.
	let { reservation }: { reservation: ReservationView } = $props();

	const T = {
		upcoming: '予約中',
		current: '利用時間中',
		expired: '期限切れ',
		fulfilled: '貸出済',
		cancelled: '取消',
	};

	const state = $derived(
		reservation.status === 'active'
			? reservation.expired
				? 'expired'
				: reservation.current
					? 'current'
					: 'upcoming'
			: reservation.status,
	);

	const STYLE: Record<string, string> = {
		upcoming: 'border-dashed border-stone-400 bg-stone-100 text-ink',
		current: 'border-accent/40 bg-accent-soft text-accent-strong',
		expired: 'border-rule-strong bg-surface text-ink-faint',
		fulfilled: 'border-rule-strong bg-surface text-ink-muted',
		cancelled: 'border-rule-strong bg-surface text-ink-faint line-through',
	};
</script>

<span
	data-testid="reservation-chip"
	data-status={state}
	class="inline-flex items-center h-5 px-1.5 rounded-xs border text-(length:--chip-text) font-medium whitespace-nowrap {STYLE[
		state
	]}">{T[state as keyof typeof T]}</span
>
