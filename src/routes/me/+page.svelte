<script lang="ts">
	import CalendarPlus from '@lucide/svelte/icons/calendar-plus';
	import type { MyPage, MyReservation } from '#lib/server/domain/me.ts';
	import type { ReservationView } from '#lib/server/domain/reservations.ts';
	import AssetTag from '#lib/components/equipment/AssetTag.svelte';
	import StatusChip from '#lib/components/equipment/StatusChip.svelte';
	import ExtendDialog from '#lib/components/loans/ExtendDialog.svelte';
	import LendDialog from '#lib/components/loans/LendDialog.svelte';
	import LoanLedger from '#lib/components/loans/LoanLedger.svelte';
	import ReturnDialog from '#lib/components/loans/ReturnDialog.svelte';
	import CancelDialog from '#lib/components/reservations/CancelDialog.svelte';
	import ReservationDialog from '#lib/components/reservations/ReservationDialog.svelte';
	import ReservationsTable from '#lib/components/reservations/ReservationsTable.svelte';
	import Avatar from '#lib/components/ui/Avatar.svelte';
	import ErrorBox from '#lib/components/ui/ErrorBox.svelte';
	import Tabs from '#lib/components/ui/Tabs.svelte';
	import { formatAt } from '#lib/format.ts';
	import { loader } from '#lib/state/loader.svelte.ts';
	import { session } from '#lib/state/session.svelte.ts';
	import type { BookingRef, EquipmentRef } from '#lib/types.ts';
	import { type LoanTarget, loanTargetOfLoan } from '#lib/components/loans/loanTarget.ts';
	import { btn, section, table } from '#lib/ui.ts';
	import PageTitle from '#lib/components/PageTitle.svelte';
	import PageLoading from '#lib/components/ui/PageLoading.svelte';

	const T = {
		blocked: {
			suspended: '利用停止中です。管理者に確認してください。',
			not_returned: '前の利用者が未返却です。',
			on_loan: 'ほかの人が貸出中です。',
		},
	};

	// My page (DESIGN.md §9-D): everyone's own page. What I have out (return,
	// change the due time), my bookings to come (pick up, cancel; a warning when
	// the equipment is suspended or the previous borrower has not returned it),
	// and my loan history. Nothing about other people is shown here.
	let tab = $state<'reservations' | 'history'>('reservations');
	let stampId = $state<string | null>(null);
	let returnTarget = $state<LoanTarget | null>(null);
	let extendTarget = $state<{ target: LoanTarget; equipmentId: number } | null>(null);
	let cancelling = $state<ReservationView | null>(null);
	let lending = $state<{ equipment: EquipmentRef; booking: BookingRef } | null>(null);
	let reserving = $state(false);

	const me = $derived(session.me);
	const now = $derived(me?.now ?? '');

	const myPage = loader<MyPage>(() => '/api/me/page');
	const mine = $derived(myPage.data);

	function warning(r: ReservationView): string | null {
		const blocked = (r as MyReservation).blocked;
		return blocked ? T.blocked[blocked] : null;
	}

	function pickUp(r: ReservationView) {
		lending = {
			equipment: { id: r.equipmentId, assetTag: r.assetTag, name: r.equipmentName },
			booking: { id: r.id, startsAt: r.startsAt, endsAt: r.endsAt },
		};
	}

	function done() {
		returnTarget = null;
		extendTarget = null;
		cancelling = null;
		lending = null;
		reserving = false;
		void myPage.reload();
	}
</script>

<PageTitle title="自分のページ" />

{#if myPage.error}
	<ErrorBox code={myPage.error} onretry={myPage.reload} />
{:else if !mine || !me}
	<PageLoading />
{:else}
	<header
		class="flex items-start justify-between gap-6 px-6 py-5 border-b border-rule max-md:flex-col max-md:gap-4 max-md:px-4"
	>
		<div class="flex items-center gap-3 min-w-0">
			<Avatar name={me.name} imageUrl={me.imageUrl} large />
			<div class="min-w-0">
				<h1 class="text-lg font-semibold tracking-tight text-ink truncate">{me.name}</h1>
				{#if me.email}<p class="font-mono text-xs text-ink-muted truncate">{me.email}</p>{/if}
			</div>
		</div>
		<dl class="flex gap-8">
			<div>
				<dt class="text-xs text-ink-muted">借りている</dt>
				<dd data-testid="count-loans" class="font-mono text-2xl font-medium tabular-nums text-ink">
					{mine.loans.length}
				</dd>
			</div>
			<div>
				<dt class="text-xs text-ink-muted">予約</dt>
				<dd
					data-testid="count-reservations"
					class="font-mono text-2xl font-medium tabular-nums text-ink"
				>
					{mine.reservations.length}
				</dd>
			</div>
		</dl>
		<div class="flex items-center gap-2">
			<a class={btn.secondary} href="/equipment">機材を探す</a>
			<button type="button" class={btn.primary} onclick={() => (reserving = true)}>
				<CalendarPlus class="size-4 stroke-[1.5]" />予約する
			</button>
		</div>
	</header>

	<div class="px-6 py-4 space-y-6 max-md:px-4">
		<section class="space-y-3" aria-labelledby="loans-title">
			<h2 id="loans-title" class={section.heading}>借りている機材</h2>
			<div class={table.wrapPlain}>
				<table class={table.table}>
					<thead class={table.thead}>
						<tr class={table.headRow}>
							<th class="{table.stickyTh} w-[120px]">管理番号</th>
							<th class={table.th}>名称</th>
							<th class="{table.th} max-md:hidden">貸出</th>
							<th class={table.th}>返却予定</th>
							<th class="{table.th} max-md:hidden">状態</th>
							<th class="{table.thRight} w-[180px]"><span class="sr-only">操作</span></th>
						</tr>
					</thead>
					<tbody>
						{#each mine.loans as l (l.id)}
							<tr data-testid="my-loan-row" class={table.row}>
								<td class={table.stickyTd}><AssetTag tag={l.assetTag} /></td>
								<td class="{table.td} max-w-72 max-md:max-w-32 truncate font-medium">
									<a class="hover:underline underline-offset-2" href="/equipment/{l.equipmentId}"
										>{l.equipmentName}</a
									>
								</td>
								<td class="{table.td} font-mono tabular-nums max-md:hidden">{formatAt(l.lentAt)}</td
								>
								<td class="{table.td} font-mono tabular-nums {l.overdue ? 'text-seal' : ''}"
									>{formatAt(l.dueAt)}</td
								>
								<td class="{table.td} max-md:hidden"
									><StatusChip status={l.overdue ? 'overdue' : 'on_loan'} /></td
								>
								<td class="{table.td} text-right">
									<button
										data-testid="my-loan-extend"
										type="button"
										class={btn.ghostSm}
										onclick={() =>
											(extendTarget = { target: loanTargetOfLoan(l), equipmentId: l.equipmentId })}
										>延長</button
									>
									<button
										data-testid="my-loan-return"
										type="button"
										class={btn.ghostSm}
										onclick={() => (returnTarget = loanTargetOfLoan(l))}>返却</button
									>
								</td>
							</tr>
						{:else}
							<tr
								><td colspan="6" class="h-(--row-h) px-4 text-center text-sm text-ink-muted"
									>借りている機材はありません。</td
								></tr
							>
						{/each}
					</tbody>
				</table>
			</div>
		</section>

		<section>
			<Tabs
				testid="me-tab"
				tabs={[
					{ key: 'reservations', label: '自分の予約', count: mine.reservations.length },
					{ key: 'history', label: '利用の履歴', count: mine.history.length },
				]}
				bind:selected={tab}
			>
				{#if tab === 'reservations'}
					<ReservationsTable
						rows={mine.reservations}
						showName={false}
						plain
						oncancel={(r) => (cancelling = r)}
						onlend={pickUp}
						canLend={(r) => (r as MyReservation).canPickUp}
						{warning}
						emptyText="今後の予約はありません。"
					/>
					<p class="mt-2 text-xs text-ink-muted">
						予約の時間になったら(開始の 30
						分前から)「貸出」で借りられます。過去の予約は「予約」の画面で見られます。
					</p>
				{:else}
					<LoanLedger rows={mine.history} variant="person" {now} {stampId} />
				{/if}
			</Tabs>
		</section>
	</div>

	{#if returnTarget}
		<ReturnDialog
			target={returnTarget}
			admin={false}
			onclose={() => (returnTarget = null)}
			ondone={(l) => {
				stampId = l.id;
				tab = 'history';
				done();
			}}
		/>
	{/if}
	{#if extendTarget}
		<ExtendDialog
			target={extendTarget.target}
			equipmentId={extendTarget.equipmentId}
			onclose={() => (extendTarget = null)}
			ondone={done}
		/>
	{/if}
	{#if cancelling}
		<CancelDialog reservation={cancelling} onclose={() => (cancelling = null)} ondone={done} />
	{/if}
	{#if lending}
		<LendDialog
			equipment={lending.equipment}
			booking={lending.booking}
			admin={false}
			onclose={() => (lending = null)}
			ondone={done}
			onconflict={myPage.reload}
		/>
	{/if}
	{#if reserving}
		<ReservationDialog admin={false} onclose={() => (reserving = false)} ondone={done} />
	{/if}
{/if}
