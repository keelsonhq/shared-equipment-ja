<script lang="ts">
	import { untrack } from 'svelte';
	import type { EquipmentView } from '#lib/server/domain/equipment.ts';
	import type { LoanView } from '#lib/server/domain/loans.ts';
	import type { Person } from '#lib/server/domain/directory.ts';
	import type { ReservationView } from '#lib/server/domain/reservations.ts';
	import { getJson, sendJson } from '#lib/api.ts';
	import { addMinutes, formatAt, formatPeriod, nextStep } from '#lib/format.ts';
	import {
		check,
		type FieldErrors,
		focusFirstInvalid,
		hasErrors,
		splitError,
		timeProblem,
		without,
		withoutEdited,
	} from '#lib/forms.ts';
	import { serverNow } from '#lib/state/session.svelte.ts';
	import { showToast } from '#lib/state/toast.svelte.ts';
	import type { BookingRef, EquipmentRef, PersonRef } from '#lib/types.ts';
	import { btn, input } from '#lib/ui.ts';
	import AssetTag from '#lib/components/equipment/AssetTag.svelte';
	import EquipmentPicker from '#lib/components/equipment/EquipmentPicker.svelte';
	import Dialog from '#lib/components/ui/Dialog.svelte';
	import FieldError from '#lib/components/ui/FieldError.svelte';
	import MemberCombobox from '#lib/components/people/MemberCombobox.svelte';
	import { LEND_NOTE_MAX } from '#lib/limits.ts';

	const T = {
		lent: '貸出を記録しました。',
		borrowed: '借りました。返却予定までに返却してください。',
		titleBorrow: '借りる',
		titleLend: '貸出を記録',
	};

	// Lend a piece of equipment now (DESIGN.md §9-E): to oneself ("borrow"), or,
	// for an admin, to someone else (blank = oneself). The due time must be
	// before the next booking of someone else; the server picks up the
	// borrower's own booking that is due now.
	let {
		onclose,
		ondone,
		onconflict,
		equipment = null,
		booking = null,
		borrower = null,
		admin,
	}: {
		onclose: () => void;
		ondone: (loan: LoanView) => void;
		/** The equipment changed under us (lent, suspended): reload the screen. */
		onconflict?: () => void;
		equipment?: EquipmentRef | null;
		/** Picking up this booking: its end is the default due time. */
		booking?: BookingRef | null;
		/** Admin: lending to this person (fixed, e.g. the booking's owner). */
		borrower?: PersonRef | null;
		admin: boolean;
	} = $props();

	// Unique per instance: the submit buttons sit in the dialog footer, outside
	// the form, and must never reach the form of another dialog on the page.
	const uid = $props.id();
	const formId = `${uid}-form`;

	// The server's time when the dialog opened (see serverNow).
	const now = serverNow();

	let picked = $state<EquipmentView | null>(null);
	let person = $state<Person | null>(null);
	// The booking's end when picking one up, else two hours from the next step.
	let dueAt = $state(untrack(() => booking?.endsAt ?? addMinutes(nextStep(now), 120)));
	let note = $state('');
	let error = $state<string | null>(null);
	let errors = $state<FieldErrors>({});
	let busy = $state(false);
	let blocked = $state(false);
	let nextBooking = $state<ReservationView | null>(null);

	const target = $derived(equipment ?? picked);
	const title = $derived(admin ? T.titleLend : T.titleBorrow);

	// The next booking of someone else: the latest possible due time.
	$effect(() => {
		const id = target?.id;
		nextBooking = null;
		if (!id) {
			return;
		}
		const borrowerId = borrower?.id ?? person?.id ?? null;
		const borrowerIsMe = !admin || borrowerId === null;
		getJson<ReservationView[]>(`/api/equipment/${id}/reservations`)
			.then((list) => {
				nextBooking =
					list.find(
						(r) =>
							r.endsAt > now &&
							r.id !== booking?.id &&
							(borrowerIsMe ? !r.mine : r.userId !== borrowerId),
					) ?? null;
				if (!booking && nextBooking && dueAt > nextBooking.startsAt && nextBooking.startsAt > now) {
					dueAt = nextBooking.startsAt;
				}
			})
			.catch(() => {
				nextBooking = null;
			});
	});

	const shown = $derived([
		...(equipment ? [] : ['equipmentId']),
		...(admin && !borrower ? ['userId'] : []),
		'dueAt',
		'note',
	]);

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		error = null;
		errors = check({
			equipmentId: !target && 'required',
			dueAt: timeProblem(dueAt, { after: now }),
		});
		if (hasErrors(errors) || !target) {
			void focusFirstInvalid();
			return;
		}
		busy = true;
		try {
			const loan = await sendJson<LoanView>('POST', '/api/loans', {
				equipmentId: target.id,
				userId: admin ? (borrower?.id ?? person?.id ?? null) : null,
				dueAt,
				note,
				reservationId: booking?.id ?? null,
			});
			showToast(loan.mine ? T.borrowed : T.lent);
			ondone(loan);
		} catch (err) {
			// The equipment or the person may be fixed by the screen that opened the
			// dialog; an error on it is shown as the general error.
			({ fields: errors, general: error } = splitError(err, shown, {
				equipmentId: 'equipment_not_found',
				userId: 'member_not_found',
			}));
			if (
				error === 'equipment_on_loan' ||
				error === 'previous_loan_not_returned' ||
				error === 'equipment_suspended' ||
				error === 'equipment_reserved'
			) {
				blocked = true;
				onconflict?.();
			}
			void focusFirstInvalid();
		} finally {
			busy = false;
		}
	}
</script>

<Dialog {title} {onclose} {error}>
	<form
		id={formId}
		data-testid="lend-form"
		class="space-y-4"
		onsubmit={submit}
		oninput={(e) => (errors = withoutEdited(errors, e))}
		novalidate
	>
		{#if equipment}
			<div class="flex items-center gap-2 text-sm">
				<AssetTag tag={equipment.assetTag} />
				<span class="font-medium truncate">{equipment.name}</span>
			</div>
		{:else}
			<div>
				<label class={input.label} for="lend-equipment">機材</label>
				<EquipmentPicker
					id="lend-equipment"
					scope="available"
					bind:selected={picked}
					invalid={!!errors.equipmentId}
					onselect={() => (errors = without(errors, 'equipmentId'))}
				/>
				<FieldError field="equipmentId" reason={errors.equipmentId} />
			</div>
		{/if}

		{#if booking}
			<p class="text-sm text-ink-muted">
				予約 <span class="font-mono tabular-nums text-ink"
					>{formatPeriod(booking.startsAt, booking.endsAt)}</span
				> の貸出です。
			</p>
		{/if}

		{#if admin && borrower}
			<p class="text-sm">
				借りる人: <span class="font-medium">{borrower.name}</span>
			</p>
		{:else if admin}
			<div>
				<label class={input.label} for="lend-person"
					>借りる人 <span class="text-ink-faint">(任意)</span></label
				>
				<MemberCombobox
					id="lend-person"
					bind:selected={person}
					invalid={!!errors.userId}
					onselect={() => (errors = without(errors, 'userId'))}
				/>
				{#if errors.userId}
					<FieldError field="userId" reason={errors.userId} />
				{:else}
					<p class={input.help}>
						空欄のときは自分が借ります。借りる人のいまの予約があれば、その予約の貸出として記録します。
					</p>
				{/if}
			</div>
		{/if}

		<div class="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
			<div>
				<span class={input.label}>貸出日時</span>
				<p class="h-9 flex items-center font-mono tabular-nums text-sm text-ink">
					{formatAt(now)}(いま)
				</p>
			</div>
			<div>
				<label class={input.label} for="lend-due">返却予定</label>
				<input
					id="lend-due"
					name="dueAt"
					type="datetime-local"
					step="900"
					min={nextStep(now)}
					max={nextBooking && nextBooking.startsAt > now ? nextBooking.startsAt : undefined}
					class="{input.text} font-mono tabular-nums"
					bind:value={dueAt}
					aria-invalid={!!errors.dueAt || undefined}
				/>
				<FieldError field="dueAt" reason={errors.dueAt} />
			</div>
		</div>
		{#if nextBooking}
			<p data-testid="lend-next-booking" class="{input.help} -mt-2">
				次の予約: <span class="font-mono tabular-nums"
					>{formatPeriod(nextBooking.startsAt, nextBooking.endsAt)}</span
				>
				{nextBooking.name}。返却予定はこの開始までにしてください。
			</p>
		{/if}

		<div>
			<label class={input.label} for="lend-note"
				>備考 <span class="text-ink-faint">(任意)</span></label
			>
			<textarea
				id="lend-note"
				name="note"
				class={input.textarea}
				maxlength={LEND_NOTE_MAX}
				bind:value={note}
				aria-invalid={!!errors.note || undefined}></textarea>
			<FieldError field="note" reason={errors.note} />
		</div>
	</form>

	{#snippet footer()}
		<button type="button" class={btn.secondary} onclick={onclose}>キャンセル</button>
		<button
			data-testid="lend-submit"
			type="submit"
			form={formId}
			class={btn.primary}
			disabled={busy || blocked}>{title}</button
		>
	{/snippet}
</Dialog>
