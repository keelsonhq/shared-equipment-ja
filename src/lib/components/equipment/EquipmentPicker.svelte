<script lang="ts">
	import type { EquipmentList, EquipmentView } from '#lib/server/domain/equipment.ts';
	import { withQuery } from '#lib/api.ts';
	import Combobox from '#lib/components/ui/Combobox.svelte';
	import { loader } from '#lib/state/loader.svelte.ts';
	import { input } from '#lib/ui.ts';
	import AssetTag from './AssetTag.svelte';

	// Equipment picker (combobox over GET /api/equipment). `bookable`: not
	// suspended (booking). `available`: free right now (lending). `out` (admin):
	// out on loan now (recording a return; the borrower's name is searchable).
	let {
		id,
		selected = $bindable(null),
		invalid = false,
		scope = 'bookable',
		onselect,
	}: {
		id: string;
		selected?: EquipmentView | null;
		invalid?: boolean;
		scope?: 'bookable' | 'available' | 'out';
		onselect?: (row: EquipmentView) => void;
	} = $props();

	const FILTER: Record<typeof scope, Record<string, string>> = {
		bookable: { bookable: '1' },
		available: { status: 'available' },
		out: { status: 'on_loan' },
	};

	// The text searched last. The list is read again when it or the scope
	// changes; an answer to an older search is dropped (loader).
	let term = $state('');
	const found = loader<EquipmentList>(
		() => withQuery('/api/equipment', { q: term, size: 50, ...FILTER[scope] }),
		{ keepPreviousData: true },
	);
	const rows = $derived(found.error ? [] : (found.data?.rows ?? []));
</script>

<Combobox
	{id}
	testid="equipment-picker"
	class="{input.text} font-mono"
	placeholder={scope === 'out' ? '管理番号・名称・利用者で検索' : '管理番号・名称・種類で検索'}
	items={rows}
	bind:selected
	label={(row) => `${row.assetTag} ${row.name}`}
	{invalid}
	empty={scope === 'out'
		? '貸出中の機材はありません。'
		: scope === 'available'
			? 'いま空いている機材はありません。'
			: '予約できる機材はありません。'}
	onsearch={(q) => (term = q)}
	{onselect}
>
	{#snippet option(row)}
		<AssetTag tag={row.assetTag} />
		<span class="truncate">{row.name}</span>
		{#if scope === 'out' && row.loan}<span class="ml-auto text-xs text-ink-muted truncate"
				>{row.loan.name}</span
			>{:else if row.typeName}<span class="ml-auto text-xs text-ink-muted truncate"
				>{row.typeName}</span
			>{/if}
	{/snippet}
</Combobox>
