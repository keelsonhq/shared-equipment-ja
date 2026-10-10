<script lang="ts">
	import type { LoanView } from '#lib/server/domain/loans.ts';
	import { formatAt, minutesBetween } from '#lib/format.ts';
	import { table } from '#lib/ui.ts';
	import AssetTag from '#lib/components/equipment/AssetTag.svelte';
	import StatusChip from '#lib/components/equipment/StatusChip.svelte';
	import Empty from '#lib/components/ui/Empty.svelte';
	import Person from '#lib/components/people/Person.svelte';
	import Seal from '#lib/components/ui/Seal.svelte';

	const T = {
		days: '日',
		hours: '時間',
		minutes: '分',
		seals: { returned: '返却済', collected: '回収済' },
	};

	// Loan ledger (DESIGN.md §9-F): one row per hand-over, lent and returned times
	// side by side, the seal at the end. Names are the snapshot taken at the
	// time, so the history survives people leaving the workspace.
	let {
		rows,
		variant,
		now,
		stampId = null,
	}: {
		rows: LoanView[];
		variant: 'equipment' | 'person';
		now: string;
		stampId?: string | null;
	} = $props();

	function duration(loan: LoanView): string {
		const minutes = minutesBetween(loan.lentAt, loan.returnedAt ?? now);
		if (minutes >= 24 * 60) {
			return `${Math.floor(minutes / (24 * 60))} ${T.days}`;
		}
		if (minutes >= 60) {
			return `${Math.floor(minutes / 60)} ${T.hours}`;
		}
		return `${minutes} ${T.minutes}`;
	}
</script>

<div class={table.wrapPlain}>
	<table class={table.table}>
		<thead class={table.thead}>
			<tr class={table.headRow}>
				<th class={table.th}>貸出</th>
				<th class={table.th}>返却</th>
				<th class={table.th}>{variant === 'equipment' ? '利用者' : '機材'}</th>
				<th class="{table.th} max-md:hidden">返却予定</th>
				<th class="{table.thRight} max-md:hidden">期間</th>
				<th class="{table.th} max-md:hidden">記録した人</th>
				<th class={table.thRight}>印</th>
			</tr>
		</thead>
		<tbody>
			{#each rows as loan (loan.id)}
				<tr data-testid="loan-row" class="{table.row} {loan.returnedAt ? '' : 'bg-accent-soft/30'}">
					<td class="{table.td} font-mono tabular-nums">{formatAt(loan.lentAt)}</td>
					<td data-testid="loan-returned-at" class="{table.td} font-mono tabular-nums"
						>{#if loan.returnedAt}{formatAt(loan.returnedAt)}{:else}<Empty />{/if}</td
					>
					<td class="{table.td} max-w-60 max-md:max-w-40">
						{#if variant === 'equipment'}
							<Person
								name={loan.name}
								former={loan.membership === 'former'}
								imageUrl={loan.imageUrl}
							/>
						{:else}
							<a
								class="inline-flex items-center gap-2 min-w-0 max-w-full hover:underline underline-offset-2"
								href="/equipment/{loan.equipmentId}"
							>
								<AssetTag tag={loan.assetTag} />
								<span class="truncate">{loan.equipmentName}</span>
							</a>
						{/if}
					</td>
					<td
						class="{table.td} font-mono tabular-nums max-md:hidden {loan.overdue
							? 'text-seal'
							: ''}">{formatAt(loan.dueAt)}</td
					>
					<td class="{table.tdNum} max-md:hidden">{duration(loan)}</td>
					<td class="{table.td} {table.meta} max-w-48 truncate max-md:hidden">
						{loan.lentByName}{#if loan.returnedByName && loan.returnedByName !== loan.lentByName}
							/ {loan.returnedByName}{/if}
					</td>
					<td class="{table.td} text-right">
						{#if loan.returnKind}
							<Seal
								kind={loan.returnKind}
								label={T.seals[loan.returnKind]}
								animate={loan.id === stampId}
							/>
						{:else}
							<StatusChip status={loan.overdue ? 'overdue' : 'on_loan'} />
						{/if}
					</td>
				</tr>
			{:else}
				<tr
					><td colspan="7" class="h-24 px-4 text-center text-sm text-ink-muted"
						>貸出の記録はありません。</td
					></tr
				>
			{/each}
		</tbody>
	</table>
</div>
