<script lang="ts">
	import CalendarPlus from '@lucide/svelte/icons/calendar-plus';
	import { page } from '$app/state';
	import type { ReservationList, ReservationView } from '#lib/server/domain/reservations.ts';
	import { withQuery } from '#lib/api.ts';
	import LendDialog from '#lib/components/loans/LendDialog.svelte';
	import CancelDialog from '#lib/components/reservations/CancelDialog.svelte';
	import ReservationDialog from '#lib/components/reservations/ReservationDialog.svelte';
	import ReservationsTable from '#lib/components/reservations/ReservationsTable.svelte';
	import ErrorBox from '#lib/components/ui/ErrorBox.svelte';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import Pagination from '#lib/components/ui/Pagination.svelte';
	import SearchInput from '#lib/components/ui/SearchInput.svelte';
	import Tabs from '#lib/components/ui/Tabs.svelte';
	import { loader } from '#lib/state/loader.svelte.ts';
	import { session } from '#lib/state/session.svelte.ts';
	import type { BookingRef, EquipmentRef, PersonRef } from '#lib/types.ts';
	import { btn, input } from '#lib/ui.ts';
	import { listParams, updateQuery } from '#lib/urlstate.ts';
	import PageTitle from '#lib/components/PageTitle.svelte';

	const T = {
		tabs: { upcoming: '自分の予約(今後)', past: '自分の予約(過去)', all: 'すべての予約' },
		emptyUpcoming: '今後の予約はありません。「予約する」から予約できます。',
		emptyPast: '過去の予約はありません。',
		emptyAll: 'この期間の予約はありません。',
	};

	type Tab = 'upcoming' | 'past' | 'all';

	// Reservations (DESIGN.md §9-M): my bookings to come and past ones, and for
	// admins every booking in a date range. The tab, range, search and page
	// live in the URL.

	let reserving = $state(false);
	let cancelling = $state<ReservationView | null>(null);
	let lending = $state<{
		equipment: EquipmentRef;
		booking: BookingRef;
		borrower: PersonRef | null;
	} | null>(null);

	const admin = $derived(session.me?.isAdmin ?? false);
	const today = $derived(session.me?.today ?? '');
	const params = $derived(page.url.searchParams);
	const tab = $derived<Tab>(
		params.get('tab') === 'past'
			? 'past'
			: params.get('tab') === 'all' && admin
				? 'all'
				: 'upcoming',
	);
	const from = $derived(params.get('from') ?? '');
	const to = $derived(params.get('to') ?? '');
	const q = $derived(params.get('q') ?? '');
	const { page: pageNo, size } = $derived(listParams(params));

	const list = loader<ReservationList>(
		() =>
			withQuery('/api/reservations', {
				scope: tab === 'all' ? 'all' : 'mine',
				when: tab === 'past' ? 'past' : 'upcoming',
				from: tab === 'all' ? from || today : null,
				to: tab === 'all' ? to || null : null,
				q,
				page: pageNo,
				size,
			}),
		{ keepPreviousData: true },
	);

	function openLend(r: ReservationView) {
		lending = {
			equipment: { id: r.equipmentId, assetTag: r.assetTag, name: r.equipmentName },
			booking: { id: r.id, startsAt: r.startsAt, endsAt: r.endsAt },
			borrower:
				!r.mine && r.userId
					? { id: r.userId, name: r.name, email: r.email ?? null, imageUrl: r.imageUrl }
					: null,
		};
	}

	function done() {
		reserving = false;
		cancelling = null;
		lending = null;
		void list.reload();
	}

	const tabs = $derived<Tab[]>(admin ? ['upcoming', 'past', 'all'] : ['upcoming', 'past']);
</script>

<PageTitle title="予約" />

{#if list.error === 'forbidden_manage_required'}
	<ErrorBox code={list.error} />
{:else}
	<PageHeader title="予約" count={list.data?.total ?? null}>
		{#snippet actions()}
			<button
				data-testid="reservation-new"
				type="button"
				class={btn.primary}
				onclick={() => (reserving = true)}
			>
				<CalendarPlus class="size-4 stroke-[1.5]" />予約する
			</button>
		{/snippet}
	</PageHeader>

	<div class="px-6 pt-3 max-md:px-4">
		<Tabs
			testid="reservations-tab"
			tabs={tabs.map((key) => ({ key, label: T.tabs[key] }))}
			bind:selected={
				() => tab, (key) => updateQuery(page.url, { tab: key === 'upcoming' ? null : key })
			}
		>
			<div class="flex flex-wrap items-center gap-2 pb-3">
				<SearchInput
					value={q}
					label="予約を検索"
					placeholder="管理番号・名称・予約した人"
					onsearch={(value) => updateQuery(page.url, { q: value || null })}
				/>
				{#if tab === 'all'}
					<label class="inline-flex items-center gap-1 text-xs text-ink-muted">
						期間
						<input
							data-testid="reservations-from"
							type="date"
							class="{input.textSm} font-mono tabular-nums"
							value={from || today}
							onchange={(e) => updateQuery(page.url, { from: e.currentTarget.value || null })}
							aria-label="開始日"
						/>
						–
						<input
							data-testid="reservations-to"
							type="date"
							class="{input.textSm} font-mono tabular-nums"
							value={to}
							onchange={(e) => updateQuery(page.url, { to: e.currentTarget.value || null })}
							aria-label="終了日"
						/>
					</label>
				{/if}
			</div>

			<ReservationsTable
				rows={list.data?.rows ?? []}
				showName={tab === 'all'}
				status={list.loading && !list.data ? 'loading' : list.error ? 'error' : 'ready'}
				error={list.error}
				onretry={list.reload}
				oncancel={(r) => (cancelling = r)}
				onlend={tab === 'past' ? undefined : openLend}
				emptyText={tab === 'all' ? T.emptyAll : tab === 'past' ? T.emptyPast : T.emptyUpcoming}
			/>
			<Pagination
				page={pageNo}
				{size}
				total={list.data?.total ?? 0}
				onpage={(p) => updateQuery(page.url, { page: p }, { resetPage: false })}
				onsize={(s) => updateQuery(page.url, { size: s })}
			/>
		</Tabs>
	</div>

	{#if reserving}
		<ReservationDialog {admin} onclose={() => (reserving = false)} ondone={done} />
	{/if}
	{#if cancelling}
		<CancelDialog reservation={cancelling} onclose={() => (cancelling = null)} ondone={done} />
	{/if}
	{#if lending}
		<LendDialog
			equipment={lending.equipment}
			booking={lending.booking}
			borrower={lending.borrower}
			{admin}
			onclose={() => (lending = null)}
			ondone={done}
			onconflict={list.reload}
		/>
	{/if}
{/if}
