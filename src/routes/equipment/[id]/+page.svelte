<script lang="ts">
	import Ellipsis from '@lucide/svelte/icons/ellipsis';
	import Printer from '@lucide/svelte/icons/printer';
	import { page } from '$app/state';
	import type { EquipmentDetail } from '#lib/server/domain/equipment.ts';
	import type { EventView } from '#lib/server/domain/events.ts';
	import type { LoanView } from '#lib/server/domain/loans.ts';
	import type { ReservationView } from '#lib/server/domain/reservations.ts';
	import { errorCode, getJson, sendJson } from '#lib/api.ts';
	import AssetTag from '#lib/components/equipment/AssetTag.svelte';
	import AttachmentList from '#lib/components/equipment/AttachmentList.svelte';
	import EquipmentFormDialog, {
		EQUIPMENT_FIELD_LABELS,
	} from '#lib/components/equipment/EquipmentFormDialog.svelte';
	import StatusChip, { REASON_LABELS } from '#lib/components/equipment/StatusChip.svelte';
	import Strip from '#lib/components/equipment/Strip.svelte';
	import StripHead from '#lib/components/equipment/StripHead.svelte';
	import SuspendDialog from '#lib/components/equipment/SuspendDialog.svelte';
	import EventsTable from '#lib/components/events/EventsTable.svelte';
	import ExtendDialog from '#lib/components/loans/ExtendDialog.svelte';
	import LendDialog from '#lib/components/loans/LendDialog.svelte';
	import LoanLedger from '#lib/components/loans/LoanLedger.svelte';
	import ReturnDialog from '#lib/components/loans/ReturnDialog.svelte';
	import Person from '#lib/components/people/Person.svelte';
	import CancelDialog from '#lib/components/reservations/CancelDialog.svelte';
	import ReservationDialog from '#lib/components/reservations/ReservationDialog.svelte';
	import ReservationsTable from '#lib/components/reservations/ReservationsTable.svelte';
	import Empty from '#lib/components/ui/Empty.svelte';
	import ErrorBox from '#lib/components/ui/ErrorBox.svelte';
	import Menu from '#lib/components/ui/Menu.svelte';
	import Tabs from '#lib/components/ui/Tabs.svelte';
	import { formatAt, formatDateTime, formatPeriod } from '#lib/format.ts';
	import { messageFor } from '#lib/messages.ts';
	import { loader } from '#lib/state/loader.svelte.ts';
	import { session } from '#lib/state/session.svelte.ts';
	import { showErrorToast, showToast } from '#lib/state/toast.svelte.ts';
	import type { BookingRef, PersonRef } from '#lib/types.ts';
	import { loanTargetOfEquipment } from '#lib/components/loans/loanTarget.ts';
	import { btn, menu, section } from '#lib/ui.ts';
	import PageLoading from '#lib/components/ui/PageLoading.svelte';
	import PageTitle from '#lib/components/PageTitle.svelte';

	const T = {
		resumed: '利用を再開しました。',
		qrAlt: 'この機材のページを開く QR コード',
	};

	type Tab = 'reservations' | 'loans' | 'history' | 'attachments';

	// Equipment page (DESIGN.md §9-B), for everyone: attributes, who has it or
	// booked it now, the QR code of this page, the 7-day strip, the bookings to
	// come, the loan ledger, history (admins) and attachments. Members see the
	// shared facts only (the API narrows the data).

	const equipmentId = $derived(Number(page.params.id));
	let tab = $state<Tab>('reservations');
	let stampId = $state<string | null>(null);

	let lending = $state<{ booking: BookingRef | null; borrower: PersonRef | null } | null>(null);
	let reserving = $state(false);
	let returning = $state(false);
	let extending = $state(false);
	let editing = $state(false);
	let suspending = $state(false);
	let cancelling = $state<ReservationView | null>(null);

	const admin = $derived(session.me?.isAdmin ?? false);

	// The equipment, its bookings to come, its loan ledger and its history
	// (admins), read together so they always agree.
	const detail = loader(() => `/api/equipment/${equipmentId}`, {
		fetch: async (url) => {
			const [found, upcoming, loans, events] = await Promise.all([
				getJson<EquipmentDetail>(url),
				getJson<ReservationView[]>(`${url}/reservations`),
				getJson<LoanView[]>(`${url}/loans`),
				admin ? getJson<EventView[]>(`${url}/events`) : Promise.resolve([]),
			]);
			return { ...found, upcoming, loans, events };
		},
	});
	const equipment = $derived(detail.data?.equipment ?? null);
	const window = $derived(detail.data?.window ?? null);
	const upcoming = $derived(detail.data?.upcoming ?? []);
	const loans = $derived(detail.data?.loans ?? []);
	const events = $derived(detail.data?.events ?? []);

	// Another piece of equipment starts without the stamp of a return made here.
	$effect(() => {
		void equipmentId;
		stampId = null;
	});

	async function resume() {
		try {
			await sendJson('POST', `/api/equipment/${equipmentId}/resume`);
			showToast(T.resumed);
		} catch (err) {
			showErrorToast(messageFor(errorCode(err)).title);
		}
		await detail.reload();
	}

	const loan = $derived(equipment?.loan ?? null);
	const canReturn = $derived(loan !== null && (loan.mine || admin));
	const canLend = $derived(
		!!equipment &&
			!equipment.suspendedReason &&
			!loan &&
			(!equipment.reservedNow || equipment.reservedNow.mine),
	);
	const myCurrentBooking = $derived(
		upcoming.find((r) => r.mine && r.current && !r.expired) ?? null,
	);
	const nextBooking = $derived(upcoming.find((r) => !r.current) ?? null);
	const activeBookings = $derived(upcoming.length);
	const loanTarget = $derived(equipment ? loanTargetOfEquipment(equipment) : null);
	const ref = $derived(
		equipment ? { id: equipment.id, assetTag: equipment.assetTag, name: equipment.name } : null,
	);

	function openLend(r: ReservationView | null = myCurrentBooking) {
		lending = {
			booking: r ? { id: r.id, startsAt: r.startsAt, endsAt: r.endsAt } : null,
			// An admin handing over someone else's booking lends to its owner.
			borrower:
				r && !r.mine && r.userId
					? { id: r.userId, name: r.name, email: r.email ?? null, imageUrl: r.imageUrl }
					: null,
		};
	}

	function done() {
		lending = null;
		reserving = false;
		returning = false;
		extending = false;
		cancelling = null;
		void detail.reload();
	}
</script>

<PageTitle title={equipment ? `${equipment.assetTag} ${equipment.name}` : '機材'} />

{#if detail.error}
	<ErrorBox code={detail.error} onretry={detail.reload} />
{:else if !equipment || !window}
	<PageLoading />
{:else}
	<header
		class="flex items-start justify-between gap-4 px-6 py-4 border-b border-rule max-md:flex-col max-md:px-4"
	>
		<div class="flex flex-wrap items-center gap-3 min-w-0">
			<AssetTag tag={equipment.assetTag} large />
			<h1 data-testid="equipment-title" class="text-xl font-semibold tracking-tight text-ink">
				{equipment.name}
			</h1>
			<StatusChip status={equipment.status} reason={equipment.suspendedReason} />
		</div>
		<div class="flex flex-wrap items-center gap-2 shrink-0">
			{#if canReturn}
				<button
					data-testid="equipment-return"
					type="button"
					class={btn.primary}
					onclick={() => (returning = true)}>返却を記録</button
				>
				<button
					data-testid="equipment-extend"
					type="button"
					class={btn.secondary}
					onclick={() => (extending = true)}>返却予定を変更</button
				>
			{:else if canLend}
				<button
					data-testid="equipment-lend"
					type="button"
					class={btn.primary}
					onclick={() => openLend()}>{admin ? '貸出を記録' : '借りる'}</button
				>
			{/if}
			{#if !equipment.suspendedReason}
				<button
					data-testid="equipment-reserve"
					type="button"
					class={btn.secondary}
					onclick={() => (reserving = true)}>予約する</button
				>
			{/if}
			{#if admin}
				<button
					data-testid="equipment-edit"
					type="button"
					class={btn.secondary}
					onclick={() => (editing = true)}>編集</button
				>
				<Menu>
					{#snippet trigger(props)}
						<button
							{...props}
							data-testid="equipment-menu"
							class={btn.ghostIcon}
							aria-label="その他の操作"
						>
							<Ellipsis class="size-4 stroke-[1.5]" />
						</button>
					{/snippet}
					{#if equipment.suspendedReason}
						<button data-testid="equipment-resume" type="button" class={menu.item} onclick={resume}
							>利用を再開</button
						>
					{:else}
						<button
							data-testid="equipment-suspend"
							type="button"
							class={menu.item}
							onclick={() => (suspending = true)}>利用停止にする</button
						>
					{/if}
				</Menu>
			{/if}
		</div>
	</header>

	<div class="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6 px-6 py-4 max-md:px-4">
		<div class="space-y-6 min-w-0">
			<dl class="text-sm max-w-2xl">
				<div class="grid grid-cols-[7rem_1fr] gap-x-4 py-2 border-b border-rule last:border-0">
					<dt class="text-ink-muted">{EQUIPMENT_FIELD_LABELS.typeId}</dt>
					<dd data-testid="equipment-attr-type" class="text-ink">
						{#if equipment.typeName}{equipment.typeName}{:else}<Empty />{/if}
					</dd>
				</div>
				<div class="grid grid-cols-[7rem_1fr] gap-x-4 py-2 border-b border-rule last:border-0">
					<dt class="text-ink-muted">{EQUIPMENT_FIELD_LABELS.locationId}</dt>
					<dd data-testid="equipment-attr-location" class="text-ink">
						{#if equipment.locationName}{equipment.locationName}{:else}<Empty />{/if}
					</dd>
				</div>
				{#if admin}
					<div class="grid grid-cols-[7rem_1fr] gap-x-4 py-2 border-b border-rule last:border-0">
						<dt class="text-ink-muted">{EQUIPMENT_FIELD_LABELS.serialNo}</dt>
						<dd data-testid="equipment-attr-serial" class="text-ink font-mono tabular-nums">
							{#if equipment.serialNo}{equipment.serialNo}{:else}<Empty />{/if}
						</dd>
					</div>
					<div class="grid grid-cols-[7rem_1fr] gap-x-4 py-2 border-b border-rule last:border-0">
						<dt class="text-ink-muted">{EQUIPMENT_FIELD_LABELS.note}</dt>
						<dd data-testid="equipment-attr-note" class="text-ink whitespace-pre-wrap">
							{#if equipment.note}{equipment.note}{:else}<Empty />{/if}
						</dd>
					</div>
					<div class="grid grid-cols-[7rem_1fr] gap-x-4 py-2 border-b border-rule last:border-0">
						<dt class="text-ink-muted">更新</dt>
						<dd class="font-mono text-xs text-ink-muted tabular-nums">
							{formatDateTime(equipment.updatedAt)}
						</dd>
					</div>
				{/if}
			</dl>

			<section aria-labelledby="strip-title" class="space-y-2">
				<h2 id="strip-title" class={section.heading}>今日から 7 日の空き状況</h2>
				<div class="overflow-x-auto">
					<div class="inline-block space-y-1 text-[11px] text-ink-muted">
						<StripHead days={window.days} today={window.now.slice(0, 10)} wide />
						<Strip
							bands={equipment.bands}
							days={window.days}
							now={window.now}
							suspended={equipment.suspendedReason !== null}
							wide
						/>
					</div>
				</div>
				<p class="text-xs text-ink-muted">
					帯は 8:00〜20:00。濃い帯が貸出、淡い帯が予約、赤が返却予定を過ぎた貸出です。
				</p>
			</section>
		</div>

		<div class="space-y-4">
			<section
				data-testid="equipment-current"
				class="border border-rule rounded-sm bg-surface p-4 self-start"
				aria-labelledby="current-title"
			>
				<h2 id="current-title" class="{section.heading} mb-3">現在の状態</h2>
				{#if equipment.suspendedReason}
					<div
						data-testid="suspended-warning"
						class="mb-3 rounded-xs border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800"
					>
						<p class="font-medium">
							利用停止: {REASON_LABELS[equipment.suspendedReason]}
						</p>
						{#if equipment.suspendedNote}<p class="mt-1">{equipment.suspendedNote}</p>{/if}
						<p class="mt-1">
							新しい予約と貸出はできません。{#if activeBookings > 0}入っている予約
								<span class="font-mono tabular-nums">{activeBookings}</span> 件は残っています。{/if}
						</p>
					</div>
				{/if}
				{#if loan}
					<dl class="space-y-2 text-sm">
						<div>
							<dt class="sr-only">利用者</dt>
							<dd data-testid="current-borrower">
								<Person
									name={loan.name}
									former={loan.membership === 'former'}
									imageUrl={loan.imageUrl}
								/>
							</dd>
						</div>
						<div class="flex gap-4">
							<dt class="w-20 text-xs text-ink-muted">貸出</dt>
							<dd class="font-mono tabular-nums">{formatAt(loan.lentAt)}</dd>
						</div>
						<div class="flex gap-4">
							<dt class="w-20 text-xs text-ink-muted">返却予定</dt>
							<dd class="font-mono tabular-nums {loan.overdue ? 'text-seal' : ''}">
								{formatAt(loan.dueAt)}
							</dd>
						</div>
					</dl>
					{#if loan.overdue}
						<p data-testid="not-returned" class="mt-3 text-sm text-seal">
							返却予定を過ぎています。返却が記録されるまで、次の人に貸し出せません。
						</p>
					{/if}
				{:else if equipment.reservedNow}
					<p class="text-sm text-ink">
						いまは予約の時間です: <span class="font-medium">{equipment.reservedNow.name}</span>
					</p>
					<p class="mt-1 font-mono text-xs tabular-nums text-ink-muted">
						{formatPeriod(equipment.reservedNow.startsAt, equipment.reservedNow.endsAt)}
					</p>
				{:else if !equipment.suspendedReason}
					<p class="text-sm text-ink-muted">空いています。</p>
				{/if}
				{#if nextBooking}
					<p class="mt-3 pt-3 border-t border-rule text-xs text-ink-muted">
						次の予約: <span class="font-mono tabular-nums text-ink"
							>{formatPeriod(nextBooking.startsAt, nextBooking.endsAt)}</span
						>
						{nextBooking.name}
					</p>
				{/if}
			</section>

			<section
				data-testid="equipment-qr-panel"
				class="border border-rule rounded-sm bg-surface p-4"
				aria-labelledby="qr-title"
			>
				<h2 id="qr-title" class="{section.heading} mb-3">QR コード</h2>
				<div class="flex items-start gap-4">
					<img
						data-testid="equipment-qr"
						src="/api/equipment/{equipment.id}/qr"
						alt={T.qrAlt}
						class="size-28 border border-rule rounded-xs bg-white"
					/>
					<div class="space-y-2 text-xs text-ink-muted">
						<p>読み取るとこの機材のページが開きます(ログインが必要です)。</p>
						<a
							data-testid="equipment-label"
							class={btn.secondarySm}
							href="/equipment/{equipment.id}/label"
						>
							<Printer class="size-3.5 stroke-[1.5]" />ラベルを印刷
						</a>
					</div>
				</div>
			</section>
		</div>
	</div>

	<div class="px-6 pb-8 max-md:px-4">
		<Tabs
			testid="equipment-tab"
			tabs={[
				{ key: 'reservations', label: '今後の予約', count: upcoming.length },
				{ key: 'loans', label: admin ? '貸出台帳' : '自分の利用', count: loans.length },
				...(admin ? [{ key: 'history' as const, label: '履歴', count: events.length }] : []),
				{ key: 'attachments', label: '添付' },
			]}
			bind:selected={tab}
		>
			{#if tab === 'reservations'}
				<ReservationsTable
					rows={upcoming}
					showEquipment={false}
					plain
					oncancel={(r) => {
						if (r.mine || admin) cancelling = r;
					}}
					onlend={(r) => openLend(r)}
					canLend={(r) => r.current && (r.mine || admin) && !loan}
					emptyText="今後の予約はありません。"
				/>
			{:else if tab === 'loans'}
				<LoanLedger rows={loans} variant="equipment" now={window.now} {stampId} />
			{:else if tab === 'history'}
				<EventsTable rows={events} showTarget={false} plain />
			{:else}
				<AttachmentList {equipmentId} {admin} />
			{/if}
		</Tabs>
	</div>

	{#if lending}
		<LendDialog
			equipment={ref}
			booking={lending.booking}
			borrower={lending.borrower}
			{admin}
			onclose={() => (lending = null)}
			ondone={() => {
				tab = 'loans';
				done();
			}}
			onconflict={detail.reload}
		/>
	{/if}
	{#if reserving}
		<ReservationDialog
			equipment={ref}
			{admin}
			onclose={() => (reserving = false)}
			ondone={() => {
				tab = 'reservations';
				done();
			}}
		/>
	{/if}
	{#if returning && loanTarget}
		<ReturnDialog
			target={loanTarget}
			{admin}
			onclose={() => (returning = false)}
			ondone={(l) => {
				stampId = l.id;
				tab = 'loans';
				done();
			}}
		/>
	{/if}
	{#if extending && loanTarget}
		<ExtendDialog
			target={loanTarget}
			{equipmentId}
			onclose={() => (extending = false)}
			ondone={done}
		/>
	{/if}
	{#if cancelling}
		<CancelDialog reservation={cancelling} onclose={() => (cancelling = null)} ondone={done} />
	{/if}
	{#if admin && editing}
		<EquipmentFormDialog
			{equipment}
			onclose={() => (editing = false)}
			ondone={() => {
				editing = false;
				void detail.reload();
			}}
		/>
	{/if}
	{#if admin && suspending && ref}
		<SuspendDialog
			equipment={ref}
			onclose={() => (suspending = false)}
			ondone={() => {
				suspending = false;
				void detail.reload();
			}}
		/>
	{/if}
{/if}
