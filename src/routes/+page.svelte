<script lang="ts">
	import CalendarPlus from '@lucide/svelte/icons/calendar-plus';
	import FileUp from '@lucide/svelte/icons/file-up';
	import HandHelping from '@lucide/svelte/icons/hand-helping';
	import Plus from '@lucide/svelte/icons/plus';
	import { goto } from '$app/navigation';
	import type { HomeData } from '#lib/server/domain/home.ts';
	import AssetTag from '#lib/components/equipment/AssetTag.svelte';
	import EquipmentFormDialog from '#lib/components/equipment/EquipmentFormDialog.svelte';
	import StatusChip, { REASON_LABELS } from '#lib/components/equipment/StatusChip.svelte';
	import EventsTable from '#lib/components/events/EventsTable.svelte';
	import LendDialog from '#lib/components/loans/LendDialog.svelte';
	import ReturnDialog from '#lib/components/loans/ReturnDialog.svelte';
	import Person from '#lib/components/people/Person.svelte';
	import ReservationDialog from '#lib/components/reservations/ReservationDialog.svelte';
	import Empty from '#lib/components/ui/Empty.svelte';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import TableState from '#lib/components/ui/TableState.svelte';
	import { formatAt, formatCount } from '#lib/format.ts';
	import { loader } from '#lib/state/loader.svelte.ts';
	import { session } from '#lib/state/session.svelte.ts';
	import {
		type LoanTarget,
		loanTargetOfAttention,
		loanTargetOfToday,
	} from '#lib/components/loans/loanTarget.ts';
	import { btn, section, strip, table } from '#lib/ui.ts';
	import PageTitle from '#lib/components/PageTitle.svelte';
	import PageLoading from '#lib/components/ui/PageLoading.svelte';

	const T = {
		dueSoon: '次の予約が近い',
		bookings: (n: number) => `予約 ${n} 件が残っています`,
		noBookings: '予約はありません',
		notice: { sent: '送信済', failed: '送信失敗' },
		noticeLabel: '通知: ',
		kinds: { return: '返却予定', reservation: '予約' },
		fulfilled: '貸出済',
		counts: {
			dueToday: '本日の返却予定',
			overdue: '期限超過',
			reservationsToday: '本日の予約',
			availableNow: 'いま空いている機材',
		},
	};

	// Admin home (DESIGN.md §9-L): the day's jobs (register, book, lend), today's
	// figures, what needs action (overdue, a booking coming up while it is still
	// out, suspended equipment), today's returns and bookings, latest history.
	// Members are sent to their own page.

	let creating = $state(false);
	let reserving = $state(false);
	let lending = $state(false);
	let returnTarget = $state<LoanTarget | null>(null);

	const me = $derived(session.me);
	// Members are sent away before anything is read.
	const home = loader<HomeData>(() => (me?.isAdmin ? '/api/home' : null));
	const data = $derived(home.data);
	const error = $derived(home.error);
	const now = $derived(data?.now ?? me?.now ?? '');

	$effect(() => {
		if (me && !me.isAdmin) {
			void goto('/me', { replace: true });
		}
	});

	// Header cells of the two tables below: keep in step with their <th>s.
	const ATTENTION_COLS = 7;
	const TODAY_COLS = 6;

	function done() {
		reserving = false;
		lending = false;
		returnTarget = null;
		void home.reload();
	}

	const STRIP = $derived(
		data
			? (
					[
						['dueToday', '/equipment?status=on_loan&sort=due'],
						['overdue', '/equipment?status=overdue&sort=due'],
						[
							'reservationsToday',
							`/reservations?tab=all&from=${now.slice(0, 10)}&to=${now.slice(0, 10)}`,
						],
						['availableNow', '/equipment?status=available'],
					] as const
				).map(([key, href]) => ({
					key,
					label: T.counts[key],
					value: data?.counts[key] ?? 0,
					href,
				}))
			: [],
	);
</script>

<PageTitle title="ホーム" />

{#if me?.isAdmin}
	<PageHeader title="ホーム">
		{#snippet actions()}
			<a class={btn.secondary} href="/import"
				><FileUp class="size-4 stroke-[1.5]" />CSV で取り込む</a
			>
		{/snippet}
	</PageHeader>

	<!-- Flow bar: the daily jobs. -->
	<div class="flex flex-wrap gap-2 px-6 py-3 border-b border-rule max-md:px-4">
		<button
			data-testid="equipment-register"
			type="button"
			class={btn.primary}
			onclick={() => (creating = true)}
		>
			<Plus class="size-4 stroke-[1.5]" />機材を登録
		</button>
		<button
			data-testid="home-reserve"
			type="button"
			class={btn.secondary}
			onclick={() => (reserving = true)}
		>
			<CalendarPlus class="size-4 stroke-[1.5]" />予約する
		</button>
		<button
			data-testid="home-lend"
			type="button"
			class={btn.secondary}
			onclick={() => (lending = true)}
		>
			<HandHelping class="size-4 stroke-[1.5]" />貸出を記録
		</button>
	</div>

	<!-- Today's figures (DESIGN.md §8.2 strip): each one opens the matching list. -->
	<div
		data-testid="home-counts"
		class="{strip.line} text-xs px-6 py-2 border-b border-rule bg-paper max-md:px-4"
	>
		{#each STRIP as item (item.key)}
			<a
				data-testid="home-count-{item.key}"
				class="{strip.item} {strip.off} {item.key === 'overdue' && item.value > 0
					? 'text-seal'
					: ''}"
				href={item.href}
			>
				{item.label}
				<span class={strip.figure}>{formatCount(item.value)}</span>
			</a>
		{/each}
	</div>

	<div class="px-6 py-4 space-y-8 max-md:px-4">
		<section data-testid="home-attention" class="space-y-3" aria-labelledby="attention-title">
			<div class={section.headingRow}>
				<h2 id="attention-title" class={section.title}>
					要対応{#if data && data.attention.total > 0}<span
							class="ml-2 font-mono text-xs text-ink-muted tabular-nums"
							>{formatCount(data.attention.total)} 件</span
						>{/if}
				</h2>
				{#if data && !data.notify.configured}
					<span data-testid="notify-off" class="text-xs text-ink-muted"
						>返却の通知: 未設定(期限はこの一覧で確認できます)</span
					>
				{/if}
			</div>
			<div class={table.wrapPlain}>
				<table class={table.table}>
					<thead class={table.thead}>
						<tr class={table.headRow}>
							<th class="{table.th} w-[140px]">状態</th>
							<th class="{table.stickyTh} w-[120px]">管理番号</th>
							<th class={table.th}>名称</th>
							<th class="{table.th} max-md:hidden">利用者</th>
							<th class="{table.th} max-md:hidden">期限または理由</th>
							<th class="{table.th} max-md:hidden">次の予約・残っている予約</th>
							<th class="{table.thRight} w-[80px]"><span class="sr-only">操作</span></th>
						</tr>
					</thead>
					<tbody>
						{#if home.loading && !data}
							<TableState state="loading" cols={ATTENTION_COLS} />
						{:else if error}
							<TableState state="error" cols={ATTENTION_COLS} {error} onretry={home.reload} />
						{:else if data}
							{#each data.attention.rows as row (`${row.kind}-${row.equipmentId}`)}
								<tr data-testid="attention-row" data-kind={row.kind} class={table.row}>
									<td class={table.td}>
										{#if row.kind === 'due_soon'}
											<span
												class="inline-flex items-center h-5 px-1.5 rounded-xs border border-dashed border-stone-400 bg-stone-100 text-(length:--chip-text) font-medium text-ink whitespace-nowrap"
												>{T.dueSoon}</span
											>
										{:else}
											<StatusChip
												status={row.kind === 'overdue' ? 'overdue' : 'suspended'}
												reason={row.suspendedReason}
											/>
										{/if}
									</td>
									<td class={table.stickyTd}><AssetTag tag={row.assetTag} /></td>
									<td class="{table.td} max-w-60 truncate font-medium">
										<a
											class="hover:underline underline-offset-2"
											href="/equipment/{row.equipmentId}">{row.equipmentName}</a
										>
									</td>
									<td class="{table.td} max-w-44 max-md:hidden"
										>{#if row.loan}<Person
												name={row.loan.name}
												former={row.loan.membership === 'former'}
												imageUrl={row.loan.imageUrl}
											/>{:else}<Empty />{/if}</td
									>
									<td class="{table.td} max-w-56 truncate max-md:hidden">
										{#if row.kind === 'suspended'}
											<span class={table.meta}
												>{row.suspendedReason
													? REASON_LABELS[row.suspendedReason]
													: ''}{#if row.suspendedNote}{' / '}{row.suspendedNote}{/if}</span
											>
										{:else if row.loan}
											<span
												class="font-mono tabular-nums {row.kind === 'overdue' ? 'text-seal' : ''}"
												>{formatAt(row.loan.dueAt)}</span
											>
											{#if row.notice}
												<span
													data-testid="attention-notice"
													class="ml-1 {table.meta} {row.notice === 'failed' ? 'text-red-700' : ''}"
													>{T.noticeLabel}{T.notice[row.notice]}</span
												>
											{/if}
										{/if}
									</td>
									<td class="{table.td} {table.meta} max-w-56 truncate max-md:hidden">
										{#if row.next}
											<span class="font-mono tabular-nums text-ink"
												>{formatAt(row.next.startsAt)}</span
											>
											{row.next.name}
										{:else if row.kind === 'suspended'}
											{row.bookings > 0 ? T.bookings(row.bookings) : T.noBookings}
										{:else}<Empty />{/if}
									</td>
									<td class="{table.td} text-right">
										{#if row.loan}
											<button
												data-testid="attention-return"
												type="button"
												class={btn.ghostSm}
												onclick={() => (returnTarget = loanTargetOfAttention(row))}>返却</button
											>
										{:else}
											<a class={btn.ghostSm} href="/equipment/{row.equipmentId}">詳細</a>
										{/if}
									</td>
								</tr>
							{:else}
								<TableState state="empty" cols={ATTENTION_COLS}>
									{#snippet empty()}対応が必要な機材はありません。{/snippet}
								</TableState>
							{/each}
						{/if}
					</tbody>
				</table>
			</div>
		</section>

		<section data-testid="home-today" class="space-y-3" aria-labelledby="today-title">
			<div class={section.headingRow}>
				<h2 id="today-title" class={section.title}>本日の返却予定と予約</h2>
				<a class={btn.ghostSm} href="/reservations?tab=all">予約をすべて見る</a>
			</div>
			<div class={table.wrapPlain}>
				<table class={table.table}>
					<thead class={table.thead}>
						<tr class={table.headRow}>
							<th class="{table.th} w-[160px]">時刻</th>
							<th class="{table.th} w-[100px]">種別</th>
							<th class="{table.stickyTh} w-[120px]">管理番号</th>
							<th class={table.th}>名称</th>
							<th class="{table.th} max-md:hidden">利用者</th>
							<th class="{table.thRight} w-[80px]"><span class="sr-only">操作</span></th>
						</tr>
					</thead>
					<tbody>
						{#if home.loading && !data}
							<TableState state="loading" cols={TODAY_COLS} />
						{:else if error}
							<TableState state="error" cols={TODAY_COLS} {error} onretry={home.reload} />
						{:else if data}
							{#each data.today as row, i (i)}
								<tr data-testid="today-row" data-kind={row.kind} class={table.row}>
									<td class="{table.td} font-mono tabular-nums {row.overdue ? 'text-seal' : ''}">
										{formatAt(row.at).slice(11)}{#if row.endsAt}<span class="text-ink-muted"
												>{' – '}{formatAt(row.endsAt).slice(11)}</span
											>{/if}
									</td>
									<td class="{table.td} {table.meta}"
										>{T.kinds[row.kind]}{#if row.status === 'fulfilled'}
											({T.fulfilled}){/if}</td
									>
									<td class={table.stickyTd}><AssetTag tag={row.assetTag} /></td>
									<td class="{table.td} max-w-72 truncate">
										<a
											class="hover:underline underline-offset-2"
											href="/equipment/{row.equipmentId}">{row.equipmentName}</a
										>
									</td>
									<td class="{table.td} max-md:hidden"
										><Person
											name={row.name}
											former={row.membership === 'former'}
											imageUrl={row.imageUrl}
										/></td
									>
									<td class="{table.td} text-right">
										{#if row.kind === 'return' && row.loanId}
											<button
												type="button"
												class={btn.ghostSm}
												onclick={() => (returnTarget = loanTargetOfToday(row))}>返却</button
											>
										{/if}
									</td>
								</tr>
							{:else}
								<TableState state="empty" cols={TODAY_COLS}>
									{#snippet empty()}本日の返却予定と予約はありません。{/snippet}
								</TableState>
							{/each}
						{/if}
					</tbody>
				</table>
			</div>
		</section>

		<section data-testid="home-recent" class="space-y-3" aria-labelledby="recent-title">
			<div class={section.headingRow}>
				<h2 id="recent-title" class={section.title}>最近の履歴</h2>
				<a class={btn.ghostSm} href="/history">履歴をすべて見る</a>
			</div>
			<EventsTable
				rows={data?.recent ?? null}
				loading={home.loading}
				{error}
				onretry={home.reload}
				plain
			/>
		</section>
	</div>

	{#if creating}
		<EquipmentFormDialog
			onclose={() => (creating = false)}
			ondone={() => {
				creating = false;
				void home.reload();
			}}
			onsaved={() => void home.reload()}
		/>
	{/if}
	{#if reserving}
		<ReservationDialog admin={true} onclose={() => (reserving = false)} ondone={done} />
	{/if}
	{#if lending}
		<LendDialog
			admin={true}
			onclose={() => (lending = false)}
			ondone={done}
			onconflict={home.reload}
		/>
	{/if}
	{#if returnTarget}
		<ReturnDialog
			target={returnTarget}
			admin={true}
			onclose={() => (returnTarget = null)}
			ondone={done}
		/>
	{/if}
{:else}
	<PageLoading />
{/if}
