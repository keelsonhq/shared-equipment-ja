<script lang="ts">
	import Columns from '@lucide/svelte/icons/columns-2';
	import Download from '@lucide/svelte/icons/download';
	import Ellipsis from '@lucide/svelte/icons/ellipsis';
	import FileUp from '@lucide/svelte/icons/file-up';
	import Plus from '@lucide/svelte/icons/plus';
	import Rows from '@lucide/svelte/icons/rows-3';
	import type { EquipmentStatus, StatusCounts } from '#lib/server/domain/equipment.ts';
	import FilterChip from '#lib/components/ui/FilterChip.svelte';
	import Menu from '#lib/components/ui/Menu.svelte';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import SearchInput from '#lib/components/ui/SearchInput.svelte';
	import { STATUS_LABELS } from '#lib/components/equipment/StatusChip.svelte';
	import { formatCount } from '#lib/format.ts';
	import { density, toggleDensity } from '#lib/state/density.svelte.ts';
	import { masters } from '#lib/state/masters.svelte.ts';
	import { btn, input, menu, strip } from '#lib/ui.ts';
	import { COLUMN_LABELS, COLUMNS, type ColumnKey } from './LedgerTable.svelte';

	const T = {
		title: '機材',
		all: '全件',
		noType: '(種類なし)',
		chips: {
			status: '状態',
			type: '種類',
			location: '保管場所',
			q: '検索',
		},
		searchAdmin: '管理番号・名称・種類・製造番号・備考・利用者',
		searchMember: '管理番号・名称・種類',
	};

	// Everything above the ledger table: the page header (count, column menu,
	// density, CSV and register for admins), the counts strip (DESIGN.md §8.2),
	// the filter bar (DESIGN.md §8.4) and the strip legend. The page owns the URL
	// query: this reads the applied filters and asks for changes through
	// `onquery`.
	let {
		total,
		counts,
		q,
		statuses,
		typeId,
		locationId,
		anyFilter,
		visible,
		admin,
		exportHref,
		onquery,
		oncolumns,
		oncreate,
	}: {
		total: number | null;
		counts: StatusCounts | null;
		q: string;
		statuses: EquipmentStatus[];
		typeId: string;
		locationId: string;
		anyFilter: boolean;
		visible: ColumnKey[];
		admin: boolean;
		/** CSV export of the current filters. */
		exportHref: string;
		onquery: (changes: Record<string, string | null>) => void;
		oncolumns: (visible: ColumnKey[]) => void;
		oncreate: () => void;
	} = $props();

	// The statuses in the order the status filter lists them. The counts strip
	// starts with "all" and shows "overdue" last, only when there is one (in
	// seal red).
	type StripKey = keyof StatusCounts;
	const STATUSES: EquipmentStatus[] = ['available', 'on_loan', 'reserved', 'overdue', 'suspended'];
	const STRIP: StripKey[] = ['all', ...STATUSES.filter((s) => s !== 'overdue')];
	const STRIP_LABELS: Record<StripKey, string> = { all: T.all, ...STATUS_LABELS };
	const stripKeys = $derived<StripKey[]>(
		(counts?.overdue ?? 0) > 0 ? [...STRIP, 'overdue'] : STRIP,
	);

	function toggleStatus(s: EquipmentStatus) {
		const next = statuses.includes(s) ? statuses.filter((x) => x !== s) : [...statuses, s];
		onquery({ status: next.join(',') || null });
	}

	function stripClick(key: StripKey) {
		onquery({ status: key === 'all' ? null : key });
	}

	function stripActive(key: StripKey): boolean {
		return key === 'all' ? statuses.length === 0 : statuses.length === 1 && statuses[0] === key;
	}

	function toggleColumn(key: ColumnKey) {
		oncolumns(visible.includes(key) ? visible.filter((k) => k !== key) : [...visible, key]);
	}

	const typeName = $derived(
		typeId === 'none'
			? T.noType
			: (masters.types.find((t) => String(t.id) === typeId)?.name ?? typeId),
	);
	const locationName = $derived(
		masters.locations.find((l) => String(l.id) === locationId)?.name ?? locationId,
	);
</script>

<PageHeader title={T.title} count={total}>
	{#snippet actions()}
		<button
			data-testid="density-toggle"
			type="button"
			class="{btn.ghost} max-md:hidden"
			onclick={toggleDensity}
			aria-pressed={density.dense}
		>
			<Rows class="size-4 stroke-[1.5]" />密度
		</button>
		<Menu class="max-md:hidden">
			{#snippet trigger(props)}
				<button {...props} class={btn.ghost}>
					<Columns class="size-4 stroke-[1.5]" />列
				</button>
			{/snippet}
			{#each COLUMNS.filter((c) => admin || !c.admin) as c (c.key)}
				<label class={menu.item}>
					<input
						type="checkbox"
						class={input.checkbox}
						checked={visible.includes(c.key)}
						onchange={() => toggleColumn(c.key)}
					/>
					{COLUMN_LABELS[c.key]}
				</label>
			{/each}
		</Menu>
		{#if admin}
			<a class="{btn.secondary} max-md:hidden" href="/import">
				<FileUp class="size-4 stroke-[1.5]" />CSV で取り込む
			</a>
			<a
				data-testid="equipment-export"
				class="{btn.secondary} max-md:hidden"
				href={exportHref}
				download
			>
				<Download class="size-4 stroke-[1.5]" />CSV 出力
			</a>
			<button data-testid="equipment-register" type="button" class={btn.primary} onclick={oncreate}>
				<Plus class="size-4 stroke-[1.5]" />機材を登録
			</button>
		{/if}
		<Menu class="md:hidden">
			{#snippet trigger(props)}
				<button {...props} class={btn.ghostIcon} aria-label="その他の操作">
					<Ellipsis class="size-4 stroke-[1.5]" />
				</button>
			{/snippet}
			{#if admin}
				<a class={menu.item} href="/import">CSV で取り込む</a>
				<a class={menu.item} href={exportHref} download>CSV 出力</a>
			{/if}
			<button type="button" class={menu.item} onclick={toggleDensity}>密度を切り替える</button>
		</Menu>
	{/snippet}
</PageHeader>

<!-- Counts strip (DESIGN.md §8.2): one line, each figure filters the ledger. -->
<div class="{strip.line} text-xs px-6 py-2 border-b border-rule bg-paper max-md:px-4">
	{#each stripKeys as key (key)}
		{@const on = stripActive(key)}
		<!-- "Overdue" is in seal red, its figure too, until it is the filter. -->
		{@const seal = key === 'overdue'}
		<button
			data-testid="strip-count-{key}"
			type="button"
			class="{strip.item} {on ? strip.on : strip.off} {seal && !on ? 'text-seal' : ''}"
			onclick={() => stripClick(key)}
		>
			{STRIP_LABELS[key]}
			<span class={seal ? 'font-mono tabular-nums' : strip.figure}
				>{formatCount(counts?.[key] ?? 0)}</span
			>
		</button>
	{/each}
</div>

<!-- Filter bar (DESIGN.md §8.4), synced with the URL query. -->
<div class="flex flex-wrap items-center gap-2 px-6 py-2 border-b border-rule max-md:px-4">
	<SearchInput
		value={q}
		label="機材を検索"
		placeholder={admin ? T.searchAdmin : T.searchMember}
		onsearch={(value) => onquery({ q: value || null })}
	/>
	<Menu align="left">
		{#snippet trigger(props)}
			<button
				{...props}
				data-testid="status-filter"
				class="{input.filterSelect} inline-flex items-center gap-1"
			>
				状態{#if statuses.length > 0}<span class="font-mono tabular-nums">({statuses.length})</span
					>{/if}
			</button>
		{/snippet}
		{#each STATUSES as s (s)}
			<label class={menu.item}>
				<input
					data-testid="status-filter-{s}"
					type="checkbox"
					class={input.checkbox}
					checked={statuses.includes(s)}
					onchange={() => toggleStatus(s)}
				/>
				{STATUS_LABELS[s]}
			</label>
		{/each}
	</Menu>
	<label>
		<span class="sr-only">種類</span>
		<select
			class={input.filterSelect}
			value={typeId}
			onchange={(e) => onquery({ type: e.currentTarget.value || null })}
		>
			<option value="">種類: すべて</option>
			{#each masters.types as t (t.id)}<option value={String(t.id)}>{t.name}</option>{/each}
			<option value="none">{T.noType}</option>
		</select>
	</label>
	<label>
		<span class="sr-only">保管場所</span>
		<select
			class={input.filterSelect}
			value={locationId}
			onchange={(e) => onquery({ location: e.currentTarget.value || null })}
		>
			<option value="">保管場所: すべて</option>
			{#each masters.locations as l (l.id)}<option value={String(l.id)}>{l.name}</option>{/each}
		</select>
	</label>

	<!-- Legend of the 7-day strip (DESIGN.md §9-A). -->
	<p class="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted max-md:ml-0">
		<span class="inline-flex items-center gap-1"
			><span class="inline-block w-3 h-2 rounded-[1px] bg-accent"></span>貸出中</span
		>
		<span class="inline-flex items-center gap-1"
			><span class="inline-block w-3 h-2 rounded-[1px] bg-accent-soft border border-accent/50"
			></span>予約</span
		>
		<span class="inline-flex items-center gap-1"
			><span class="inline-block w-3 h-2 rounded-[1px] bg-seal"></span>期限超過</span
		>
		<span>帯は 8:00〜20:00</span>
	</p>

	{#if anyFilter}
		<div class="flex flex-wrap items-center gap-2 basis-full">
			{#each statuses as s (s)}
				<FilterChip label="{T.chips.status}: {STATUS_LABELS[s]}" onremove={() => toggleStatus(s)} />
			{/each}
			{#if typeId}<FilterChip
					label="{T.chips.type}: {typeName}"
					onremove={() => onquery({ type: null })}
				/>{/if}
			{#if locationId}<FilterChip
					label="{T.chips.location}: {locationName}"
					onremove={() => onquery({ location: null })}
				/>{/if}
			{#if q}<FilterChip label="{T.chips.q}: {q}" onremove={() => onquery({ q: null })} />{/if}
			<button
				type="button"
				class={btn.ghostSm}
				onclick={() => onquery({ status: null, type: null, location: null, q: null })}
				>クリア</button
			>
		</div>
	{/if}
</div>
