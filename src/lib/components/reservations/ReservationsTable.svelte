<script lang="ts">
	import type { ReservationView } from '#lib/server/domain/reservations.ts';
	import { formatPeriod } from '#lib/format.ts';
	import { btn, table } from '#lib/ui.ts';
	import AssetTag from '#lib/components/equipment/AssetTag.svelte';
	import Empty from '#lib/components/ui/Empty.svelte';
	import Person from '#lib/components/people/Person.svelte';
	import TableState from '#lib/components/ui/TableState.svelte';
	import ReservationChip from './ReservationChip.svelte';

	const T = {
		suspended: '利用停止中',
		empty: '予約はありません。',
	};

	// A list of bookings (DESIGN.md §9-D, §9-M). One action per row: pick it up
	// (when it is mine, or for an admin, and due now), else cancel it.
	let {
		rows,
		showEquipment = true,
		showName = true,
		status = 'ready',
		error = null,
		onretry,
		oncancel,
		onlend,
		emptyText = T.empty,
		plain = false,
		canLend,
		warning,
	}: {
		rows: ReservationView[];
		showEquipment?: boolean;
		showName?: boolean;
		status?: 'ready' | 'loading' | 'error';
		error?: string | null;
		onretry?: () => void;
		oncancel?: (r: ReservationView) => void;
		onlend?: (r: ReservationView) => void;
		emptyText?: string;
		/** A short list that does not scroll on its own. */
		plain?: boolean;
		/** Whether the "lend" action applies to a row (default: running now). */
		canLend?: (r: ReservationView) => boolean;
		/** A warning shown under the equipment (my page: why it cannot be picked up). */
		warning?: (r: ReservationView) => string | null;
	} = $props();

	// Header cells: period + purpose + status, the optional equipment and booker
	// columns, and row actions.
	const cols = $derived(3 + (showEquipment ? 1 : 0) + (showName ? 1 : 0) + 1);
	const lendable = (r: ReservationView) => (canLend ? canLend(r) : r.current);
</script>

<div class={plain ? table.wrapPlain : table.wrap}>
	<table class={table.table}>
		<thead class={table.thead}>
			<tr class={table.headRow}>
				<th class="{table.th} w-[230px]">期間</th>
				{#if showEquipment}<th class={table.th}>機材</th>{/if}
				{#if showName}<th class={table.th}>予約した人</th>{/if}
				<th class="{table.th} max-md:hidden">目的・備考</th>
				<th class="{table.th} w-[100px]">状態</th>
				<th class="{table.thRight} w-[120px]"><span class="sr-only">操作</span></th>
			</tr>
		</thead>
		<tbody>
			{#if status === 'loading'}
				<TableState state="loading" {cols} />
			{:else if status === 'error'}
				<TableState state="error" {cols} {error} {onretry} />
			{:else}
				{#each rows as r (r.id)}
					<tr
						data-testid="reservation-row"
						class="{table.row} {r.current ? 'bg-accent-soft/30' : ''}"
					>
						<td class="{table.td} font-mono tabular-nums">{formatPeriod(r.startsAt, r.endsAt)}</td>
						{#if showEquipment}
							<td class="{table.td} max-w-80 max-md:max-w-40">
								<div class="flex items-center gap-2 min-w-0">
									<a
										class="inline-flex items-center gap-2 min-w-0 hover:underline underline-offset-2"
										href="/equipment/{r.equipmentId}"
									>
										<AssetTag tag={r.assetTag} />
										<span class="truncate">{r.equipmentName}</span>
									</a>
									{#if warning && warning(r)}
										<span
											data-testid="reservation-warning"
											class="shrink-0 text-(length:--meta-text) {r.suspendedReason
												? 'text-amber-800'
												: 'text-seal'}">{warning(r)}</span
										>
									{:else if r.suspendedReason && r.status === 'active'}
										<span class="shrink-0 text-(length:--meta-text) text-amber-800"
											>{T.suspended}</span
										>
									{/if}
								</div>
							</td>
						{/if}
						{#if showName}
							<td class="{table.td} max-w-48"
								><Person
									name={r.name}
									former={r.membership === 'former'}
									imageUrl={r.imageUrl}
								/></td
							>
						{/if}
						<td class="{table.td} max-w-72 truncate {table.meta} max-md:hidden"
							>{#if r.purpose}{r.purpose}{:else}<Empty />{/if}</td
						>
						<td class={table.td}><ReservationChip reservation={r} /></td>
						<td class="{table.td} text-right">
							{#if r.status === 'active' && !r.expired && onlend && lendable(r) && !r.suspendedReason}
								<button
									data-testid="reservation-lend"
									type="button"
									class={btn.ghostSm}
									onclick={() => onlend(r)}>貸出</button
								>
							{:else if r.status === 'active' && oncancel}
								<button
									data-testid="reservation-cancel"
									type="button"
									class={btn.ghostSm}
									onclick={() => oncancel(r)}>取り消す</button
								>
							{/if}
						</td>
					</tr>
				{:else}
					<TableState state="empty" {cols}>
						{#snippet empty()}{emptyText}{/snippet}
					</TableState>
				{/each}
			{/if}
		</tbody>
	</table>
</div>
