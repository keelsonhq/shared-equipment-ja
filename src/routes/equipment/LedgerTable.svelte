<script module lang="ts">
	import { EQUIPMENT_FIELD_LABELS as F } from '#lib/components/equipment/EquipmentFormDialog.svelte';

	const T = {
		columns: {
			name: F.name,
			status: '状態',
			strip: '7 日の空き',
			borrower: '利用者',
			due: '返却予定',
			type: F.typeId,
			location: F.locationId,
			serial: F.serialNo,
			updated: '更新',
		},
	};

	export type ColumnKey = keyof typeof T.columns;

	/** Column names; the column menu in LedgerToolbar lists them too. */
	export const COLUMN_LABELS = T.columns;

	// Column priorities (DESIGN.md §9-A): 1-2 shown by default; on narrow screens
	// only priority 1 stays visible and the table scrolls sideways. `admin`
	// columns are not offered to members (the API does not return them).
	export const COLUMNS: {
		key: ColumnKey;
		priority: number;
		sort?: string;
		width?: string;
		admin?: boolean;
	}[] = [
		{ key: 'name', priority: 1, sort: 'name', width: 'min-w-[200px]' },
		{ key: 'status', priority: 1, sort: 'status', width: 'w-[120px]' },
		{ key: 'strip', priority: 1 },
		{ key: 'borrower', priority: 2, sort: 'borrower', width: 'w-[150px]' },
		{ key: 'due', priority: 2, sort: 'due', width: 'w-[150px]' },
		{ key: 'type', priority: 2, sort: 'type', width: 'w-[120px]' },
		{ key: 'location', priority: 3, sort: 'location', width: 'w-[130px]' },
		{ key: 'serial', priority: 3, width: 'w-[140px]', admin: true },
		{ key: 'updated', priority: 4, sort: 'updated', width: 'w-[130px]' },
	];
	export const DEFAULT_COLUMNS = COLUMNS.filter((c) => c.priority <= 2).map((c) => c.key);
</script>

<script lang="ts">
	import type { EquipmentView, StripWindow } from '#lib/server/domain/equipment.ts';
	import AssetTag from '#lib/components/equipment/AssetTag.svelte';
	import StatusChip from '#lib/components/equipment/StatusChip.svelte';
	import Strip from '#lib/components/equipment/Strip.svelte';
	import StripHead from '#lib/components/equipment/StripHead.svelte';
	import Person from '#lib/components/people/Person.svelte';
	import Empty from '#lib/components/ui/Empty.svelte';
	import { rowLink } from '#lib/components/ui/rowLink.ts';
	import SortTh from '#lib/components/ui/SortTh.svelte';
	import TableState from '#lib/components/ui/TableState.svelte';
	import { formatAt, formatDateTime } from '#lib/format.ts';
	import { btn, input, table } from '#lib/ui.ts';

	// The ledger table (DESIGN.md §9-A): sortable headers, a selection column
	// (admins), the 7-day availability strip, one action per row and the
	// loading / error / empty states. The page owns the rows, the sort and the
	// selection; this reports clicks back.
	let {
		rows,
		window,
		loading,
		error,
		visible,
		sort,
		dir,
		selected,
		anyFilter,
		admin,
		onsort,
		onselect,
		onretry,
		onlend,
		onreserve,
		onreturn,
		oncreate,
	}: {
		/** null until the first load answers. */
		rows: EquipmentView[] | null;
		window: StripWindow | null;
		loading: boolean;
		error: string | null;
		visible: ColumnKey[];
		sort: string;
		dir: 'asc' | 'desc';
		selected: number[];
		anyFilter: boolean;
		admin: boolean;
		onsort: (key: string) => void;
		onselect: (ids: number[]) => void;
		onretry: () => void;
		onlend: (row: EquipmentView) => void;
		onreserve: (row: EquipmentView) => void;
		onreturn: (row: EquipmentView) => void;
		oncreate: () => void;
	} = $props();

	// The columns shown, in table order, each with the class that hides it on
	// narrow screens (only priority 1 stays there; DESIGN.md §9-A).
	const shown = $derived(
		COLUMNS.filter((c) => visible.includes(c.key) && (admin || !c.admin)).map((c) => ({
			...c,
			narrow: c.priority > 1 ? 'max-md:hidden' : '',
		})),
	);
	// Header cells: selection (admins) + asset tag + the shown columns + row actions.
	const cols = $derived((admin ? 2 : 1) + shown.length + 1);
	const allSelected = $derived(
		(rows?.length ?? 0) > 0 && (rows?.every((r) => selected.includes(r.id)) ?? false),
	);

	/** The one action of a row (DESIGN.md §2, D-17). */
	function actionOf(row: EquipmentView): 'return' | 'lend' | 'reserve' | null {
		if (row.loan && (row.loan.mine || admin)) {
			return 'return';
		}
		if (row.suspendedReason) {
			return null;
		}
		if (!row.loan && (!row.reservedNow || row.reservedNow.mine)) {
			return 'lend';
		}
		return 'reserve';
	}

	function toggleRow(id: number) {
		onselect(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
	}

	function toggleAll() {
		const ids = rows?.map((r) => r.id) ?? [];
		onselect(ids.every((id) => selected.includes(id)) ? [] : ids);
	}

	// Space on the focused row selects it (admins; Enter and a click open the
	// equipment: rowLink).
	function rowKeydown(e: KeyboardEvent, row: EquipmentView) {
		if (e.key === ' ' && admin && e.target === e.currentTarget) {
			e.preventDefault();
			toggleRow(row.id);
		}
	}
</script>

<div class={table.wrap}>
	<table class={table.table}>
		<thead class={table.thead}>
			<tr class={table.headRow}>
				{#if admin}
					<th class="sticky left-0 z-20 h-(--head-h) w-12 min-w-12 px-4 bg-paper">
						<input
							type="checkbox"
							class={input.checkbox}
							aria-label="このページをすべて選択"
							checked={allSelected}
							onchange={toggleAll}
						/>
					</th>
				{/if}
				<SortTh
					key="tag"
					{sort}
					{dir}
					{onsort}
					extra="sticky {admin ? 'left-12' : 'left-0'} z-20 w-[120px] border-r border-rule"
					>{F.assetTag}</SortTh
				>
				{#each shown as c (c.key)}
					{#if c.key === 'strip'}
						<th class="{table.th} {c.width ?? ''}">
							<span class="sr-only">{T.columns.strip}</span>
							{#if window}<StripHead days={window.days} today={window.now.slice(0, 10)} />{/if}
						</th>
					{:else if c.sort}
						<SortTh key={c.sort} {sort} {dir} {onsort} extra="{c.width ?? ''} {c.narrow}"
							>{T.columns[c.key]}</SortTh
						>
					{:else}
						<th class="{table.th} {c.width ?? ''} {c.narrow}">{T.columns[c.key]}</th>
					{/if}
				{/each}
				<th class="{table.thRight} w-[80px]"><span class="sr-only">操作</span></th>
			</tr>
		</thead>
		<tbody>
			{#if loading && !rows}
				<TableState state="loading" {cols} />
			{:else if error}
				<TableState state="error" {cols} {error} {onretry} />
			{:else if rows}
				{#each rows as row (row.id)}
					{@const isSelected = selected.includes(row.id)}
					{@const action = actionOf(row)}
					<tr
						data-testid="equipment-row"
						class="{table.row} cursor-pointer {isSelected ? 'bg-accent-soft/60' : ''}"
						{@attach rowLink(`/equipment/${row.id}`)}
						onkeydown={(e) => rowKeydown(e, row)}
						aria-selected={admin ? isSelected : undefined}
					>
						{#if admin}
							<td
								class="sticky left-0 z-[1] h-(--row-h) w-12 min-w-12 px-4 {isSelected
									? 'bg-accent-soft'
									: 'bg-surface'}"
							>
								<input
									type="checkbox"
									class={input.checkbox}
									aria-label="{row.assetTag} を選択"
									checked={isSelected}
									onchange={() => toggleRow(row.id)}
									tabindex="-1"
								/>
							</td>
						{/if}
						<td
							class="sticky {admin
								? 'left-12'
								: 'left-0'} z-[1] h-(--row-h) px-4 whitespace-nowrap border-r border-rule {isSelected
								? 'bg-accent-soft'
								: 'bg-surface'}"
						>
							<AssetTag tag={row.assetTag} />
						</td>
						{#each shown as c (c.key)}
							<td
								class="{table.td} {c.narrow} {c.key === 'name'
									? 'max-w-72 truncate font-medium text-ink'
									: ''}"
							>
								{#if c.key === 'name'}
									{row.name}
								{:else if c.key === 'status'}
									<StatusChip status={row.status} reason={row.suspendedReason} />
								{:else if c.key === 'strip'}
									{#if window}
										<Strip
											bands={row.bands}
											days={window.days}
											now={window.now}
											suspended={row.suspendedReason !== null}
										/>
									{/if}
								{:else if c.key === 'borrower'}
									{#if row.loan}<Person
											name={row.loan.name}
											former={row.loan.membership === 'former'}
											imageUrl={row.loan.imageUrl}
										/>{:else}<Empty />{/if}
								{:else if c.key === 'due'}
									<span class="font-mono tabular-nums {row.loan?.overdue ? 'text-seal' : ''}"
										>{#if row.loan}{formatAt(row.loan.dueAt)}{:else}<Empty />{/if}</span
									>
								{:else if c.key === 'type'}
									{#if row.typeName}{row.typeName}{:else}<Empty />{/if}
								{:else if c.key === 'location'}
									<span class="text-ink-muted"
										>{#if row.locationName}{row.locationName}{:else}<Empty />{/if}</span
									>
								{:else if c.key === 'serial'}
									<span class="font-mono text-ink-muted"
										>{#if row.serialNo}{row.serialNo}{:else}<Empty />{/if}</span
									>
								{:else if c.key === 'updated'}
									<span class="font-mono {table.meta} tabular-nums"
										>{formatDateTime(row.updatedAt)}</span
									>
								{/if}
							</td>
						{/each}
						<td class="{table.td} text-right">
							{#if action === 'return'}
								<button
									data-testid="row-return"
									type="button"
									class={btn.ghostSm}
									onclick={() => onreturn(row)}>返却</button
								>
							{:else if action === 'lend'}
								<button
									data-testid="row-lend"
									type="button"
									class={btn.ghostSm}
									onclick={() => onlend(row)}>{admin ? '貸出' : '借りる'}</button
								>
							{:else if action === 'reserve'}
								<button
									data-testid="row-reserve"
									type="button"
									class={btn.ghostSm}
									onclick={() => onreserve(row)}>予約</button
								>
							{/if}
						</td>
					</tr>
				{:else}
					<TableState state="empty" {cols}>
						{#snippet empty()}
							該当する機材はありません。
							{#if !anyFilter && admin}
								<div class="mt-2">
									<button type="button" class={btn.secondary} onclick={oncreate}>機材を登録</button>
								</div>
							{/if}
						{/snippet}
					</TableState>
				{/each}
			{/if}
		</tbody>
	</table>
</div>
