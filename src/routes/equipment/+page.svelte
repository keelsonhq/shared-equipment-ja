<script lang="ts">
	import Download from '@lucide/svelte/icons/download';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import type {
		EquipmentList,
		EquipmentStatus,
		EquipmentView,
	} from '#lib/server/domain/equipment.ts';
	import { withQuery } from '#lib/api.ts';
	import EquipmentFormDialog from '#lib/components/equipment/EquipmentFormDialog.svelte';
	import LendDialog from '#lib/components/loans/LendDialog.svelte';
	import ReturnDialog from '#lib/components/loans/ReturnDialog.svelte';
	import ReservationDialog from '#lib/components/reservations/ReservationDialog.svelte';
	import Pagination from '#lib/components/ui/Pagination.svelte';
	import { loader } from '#lib/state/loader.svelte.ts';
	import { readPref, writePref } from '#lib/state/prefs.ts';
	import { session } from '#lib/state/session.svelte.ts';
	import type { BookingRef, EquipmentRef } from '#lib/types.ts';
	import { type LoanTarget, loanTargetOfEquipment } from '#lib/components/loans/loanTarget.ts';
	import { btn } from '#lib/ui.ts';
	import { commaSeparatedParam, listParams, updateQuery } from '#lib/urlstate.ts';
	import LedgerTable, { type ColumnKey, DEFAULT_COLUMNS } from './LedgerTable.svelte';
	import LedgerToolbar from './LedgerToolbar.svelte';
	import PageTitle from '#lib/components/PageTitle.svelte';

	// The equipment ledger (DESIGN.md §9-A), for everyone. This page owns the
	// state: the URL query (filters, sort, paging), the loaded page of rows, the
	// selection (admins), the visible columns and the dialogs. LedgerToolbar
	// and LedgerTable draw it and report back.

	let visible = $state<ColumnKey[]>(readPref('equipment.columns', DEFAULT_COLUMNS));

	let selected = $state<number[]>([]);

	let lendTarget = $state<EquipmentRef | null>(null);
	let lendBooking = $state<BookingRef | null>(null);
	let reserveTarget = $state<EquipmentRef | null>(null);
	let returnTarget = $state<LoanTarget | null>(null);
	let creating = $state(false);

	const admin = $derived(session.me?.isAdmin ?? false);
	const params = $derived(page.url.searchParams);
	const { sort, dir, page: pageNo, size } = $derived(listParams(params, { sort: 'tag' }));
	const statuses = $derived(commaSeparatedParam(params, 'status') as EquipmentStatus[]);
	const q = $derived(params.get('q') ?? '');
	const typeId = $derived(params.get('type') ?? '');
	const locationId = $derived(params.get('location') ?? '');

	const ledger = loader<EquipmentList>(() => `/api/equipment${page.url.search}`, {
		keepPreviousData: true,
	});

	// A new query clears the selection.
	$effect(() => {
		void page.url.search;
		selected = [];
	});

	function setSort(key: string) {
		const nextDir = sort === key && dir === 'asc' ? 'desc' : 'asc';
		void updateQuery(page.url, { sort: key, dir: nextDir });
	}

	function setColumns(next: ColumnKey[]) {
		visible = next;
		writePref('equipment.columns', visible);
	}

	function ref(row: EquipmentView): EquipmentRef {
		return { id: row.id, assetTag: row.assetTag, name: row.name };
	}

	function openLend(row: EquipmentView) {
		lendBooking =
			row.reservedNow?.mine === true
				? {
						id: row.reservedNow.id,
						startsAt: row.reservedNow.startsAt,
						endsAt: row.reservedNow.endsAt,
					}
				: null;
		lendTarget = ref(row);
	}

	function openReturn(row: EquipmentView) {
		returnTarget = loanTargetOfEquipment(row);
	}

	function exportHref(ids: number[] = []): string {
		if (ids.length > 0) {
			return withQuery('/api/equipment/export', { ids: ids.join(','), sort, dir });
		}
		const query = new URLSearchParams(page.url.searchParams.toString());
		query.delete('page');
		query.delete('size');
		const qs = query.toString();
		return `/api/equipment/export${qs ? `?${qs}` : ''}`;
	}

	function done() {
		lendTarget = null;
		reserveTarget = null;
		returnTarget = null;
		void ledger.reload();
	}

	const anyFilter = $derived(statuses.length > 0 || q !== '' || typeId !== '' || locationId !== '');
</script>

<PageTitle title="機材" />

<LedgerToolbar
	total={ledger.data?.total ?? null}
	counts={ledger.data?.counts ?? null}
	{q}
	{statuses}
	{typeId}
	{locationId}
	{anyFilter}
	{visible}
	{admin}
	exportHref={exportHref()}
	onquery={(changes) => updateQuery(page.url, changes)}
	oncolumns={setColumns}
	oncreate={() => (creating = true)}
/>

<div class="px-6 pt-3 max-md:px-4">
	{#if admin && selected.length > 0}
		<div
			class="flex items-center gap-3 h-10 px-3 mb-2 rounded-sm border border-accent/30 bg-accent-soft/40 text-sm"
		>
			<span><span class="font-mono tabular-nums">{selected.length}</span> 件を選択</span>
			<a class={btn.secondarySm} href={exportHref(selected)} download>
				<Download class="size-3.5 stroke-[1.5]" />CSV 出力
			</a>
			<button type="button" class="{btn.ghostSm} ml-auto" onclick={() => (selected = [])}
				>選択解除</button
			>
		</div>
	{/if}

	<LedgerTable
		rows={ledger.data?.rows ?? null}
		window={ledger.data?.window ?? null}
		loading={ledger.loading}
		error={ledger.error}
		{visible}
		{sort}
		{dir}
		{selected}
		{anyFilter}
		{admin}
		onsort={setSort}
		onselect={(ids) => (selected = ids)}
		onretry={ledger.reload}
		onlend={openLend}
		onreserve={(row) => (reserveTarget = ref(row))}
		onreturn={openReturn}
		oncreate={() => (creating = true)}
	/>

	<Pagination
		page={pageNo}
		{size}
		total={ledger.data?.total ?? 0}
		onpage={(p) => updateQuery(page.url, { page: p }, { resetPage: false })}
		onsize={(s) => updateQuery(page.url, { size: s })}
	/>
</div>

{#if lendTarget}
	<LendDialog
		equipment={lendTarget}
		booking={lendBooking}
		{admin}
		onclose={() => (lendTarget = null)}
		ondone={done}
		onconflict={ledger.reload}
	/>
{/if}
{#if reserveTarget}
	<ReservationDialog
		equipment={reserveTarget}
		{admin}
		onclose={() => (reserveTarget = null)}
		ondone={done}
	/>
{/if}
{#if returnTarget}
	<ReturnDialog target={returnTarget} {admin} onclose={() => (returnTarget = null)} ondone={done} />
{/if}
{#if admin && creating}
	<EquipmentFormDialog
		onclose={() => (creating = false)}
		ondone={(saved) => {
			creating = false;
			void goto(`/equipment/${saved.id}`);
		}}
		onsaved={() => void ledger.reload()}
	/>
{/if}
