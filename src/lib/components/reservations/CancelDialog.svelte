<script lang="ts">
	import type { ReservationView } from '#lib/server/domain/reservations.ts';
	import { errorCode, sendJson } from '#lib/api.ts';
	import { formatPeriod } from '#lib/format.ts';
	import { showToast } from '#lib/state/toast.svelte.ts';
	import { btn } from '#lib/ui.ts';
	import AssetTag from '#lib/components/equipment/AssetTag.svelte';
	import Dialog from '#lib/components/ui/Dialog.svelte';

	const T = {
		cancelled: '予約を取り消しました。',
	};

	// Confirm cancelling a booking (the person who has it, or an admin).
	let {
		reservation,
		onclose,
		ondone,
	}: {
		reservation: ReservationView;
		onclose: () => void;
		ondone: () => void;
	} = $props();

	let error = $state<string | null>(null);
	let busy = $state(false);

	async function cancel() {
		busy = true;
		try {
			await sendJson('POST', `/api/reservations/${encodeURIComponent(reservation.id)}/cancel`);
			showToast(T.cancelled);
			ondone();
		} catch (err) {
			error = errorCode(err);
		} finally {
			busy = false;
		}
	}
</script>

<Dialog title="予約を取り消す" {onclose} {error}>
	<div class="space-y-2 text-sm">
		<div class="flex items-center gap-2">
			<AssetTag tag={reservation.assetTag} />
			<span class="font-medium truncate">{reservation.equipmentName}</span>
		</div>
		<p class="font-mono tabular-nums">
			{formatPeriod(reservation.startsAt, reservation.endsAt)}
			<span class="font-sans text-ink-muted">{reservation.name}</span>
		</p>
		<p class="text-ink-muted">取り消すと、この時間はほかの人が予約できるようになります。</p>
	</div>
	{#snippet footer()}
		<button type="button" class={btn.secondary} onclick={onclose}>閉じる</button>
		<button
			data-testid="cancel-submit"
			type="button"
			class={btn.danger}
			disabled={busy}
			onclick={cancel}>予約を取り消す</button
		>
	{/snippet}
</Dialog>
