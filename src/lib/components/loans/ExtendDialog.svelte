<script lang="ts">
	import { untrack } from 'svelte';
	import type { LoanView } from '#lib/server/domain/loans.ts';
	import type { ReservationView } from '#lib/server/domain/reservations.ts';
	import { sendJson } from '#lib/api.ts';
	import { addMinutes, formatAt, formatPeriod, nextStep } from '#lib/format.ts';
	import {
		check,
		type FieldErrors,
		focusFirstInvalid,
		hasErrors,
		splitError,
		timeProblem,
		withoutEdited,
	} from '#lib/forms.ts';
	import { loader } from '#lib/state/loader.svelte.ts';
	import { serverNow } from '#lib/state/session.svelte.ts';
	import { showToast } from '#lib/state/toast.svelte.ts';
	import type { LoanTarget } from './loanTarget.ts';
	import { btn, input } from '#lib/ui.ts';
	import AssetTag from '#lib/components/equipment/AssetTag.svelte';
	import Dialog from '#lib/components/ui/Dialog.svelte';
	import FieldError from '#lib/components/ui/FieldError.svelte';

	const T = {
		extended: '返却予定を変更しました。',
	};

	// Move the due time of a loan (DESIGN.md §9-E): the borrower or an admin.
	// Refused when it would run into someone else's booking.
	let {
		onclose,
		ondone,
		target,
		equipmentId,
	}: {
		onclose: () => void;
		ondone: (loan: LoanView) => void;
		target: LoanTarget;
		equipmentId: number;
	} = $props();

	// Unique per instance: the submit buttons sit in the dialog footer, outside
	// the form, and must never reach the form of another dialog on the page.
	const uid = $props.id();
	const formId = `${uid}-form`;

	// The server's time when the dialog opened (see serverNow).
	const now = serverNow();

	// An hour after the current due time (or after now, when it has passed).
	let dueAt = $state(
		untrack(() => addMinutes(target.dueAt > now ? target.dueAt : nextStep(now), 60)),
	);
	let error = $state<string | null>(null);
	let errors = $state<FieldErrors>({});
	let busy = $state(false);

	// The next booking of someone other than the borrower (the limit of the new due time).
	const bookings = loader<ReservationView[]>(() => `/api/equipment/${equipmentId}/reservations`);
	const nextBooking = $derived(
		bookings.data?.find(
			(r) => r.endsAt > now && (target.mine ? !r.mine : r.name !== target.name),
		) ?? null,
	);

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		error = null;
		errors = check({
			dueAt: timeProblem(dueAt, { after: now }),
		});
		if (hasErrors(errors)) {
			void focusFirstInvalid();
			return;
		}
		busy = true;
		try {
			const loan = await sendJson<LoanView>(
				'POST',
				`/api/loans/${encodeURIComponent(target.loanId)}/extend`,
				{ dueAt },
			);
			showToast(T.extended);
			ondone(loan);
		} catch (err) {
			({ fields: errors, general: error } = splitError(err, ['dueAt']));
			void focusFirstInvalid();
		} finally {
			busy = false;
		}
	}
</script>

<Dialog title="返却予定を変更" {onclose} {error}>
	<form
		id={formId}
		data-testid="extend-form"
		class="space-y-4"
		onsubmit={submit}
		oninput={(e) => (errors = withoutEdited(errors, e))}
		novalidate
	>
		<div class="flex items-center gap-2 text-sm">
			<AssetTag tag={target.assetTag} />
			<span class="font-medium truncate">{target.equipmentName}</span>
			<span class="ml-auto text-xs text-ink-muted whitespace-nowrap">{target.name}</span>
		</div>
		<div class="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
			<div>
				<span class={input.label}>いまの返却予定</span>
				<p
					class="h-9 flex items-center font-mono tabular-nums text-sm {target.dueAt < now
						? 'text-seal'
						: 'text-ink'}"
				>
					{formatAt(target.dueAt)}
				</p>
			</div>
			<div>
				<label class={input.label} for="extend-due">新しい返却予定</label>
				<input
					id="extend-due"
					name="dueAt"
					type="datetime-local"
					step="900"
					min={nextStep(now)}
					class="{input.text} font-mono tabular-nums"
					bind:value={dueAt}
					aria-invalid={!!errors.dueAt || undefined}
				/>
				<FieldError field="dueAt" reason={errors.dueAt} />
			</div>
		</div>
		{#if nextBooking}
			<p class={input.help}>
				次の予約: <span class="font-mono tabular-nums"
					>{formatPeriod(nextBooking.startsAt, nextBooking.endsAt)}</span
				>
				{nextBooking.name}。返却予定はこの開始までにしてください。
			</p>
		{/if}
	</form>

	{#snippet footer()}
		<button type="button" class={btn.secondary} onclick={onclose}>キャンセル</button>
		<button
			data-testid="extend-submit"
			type="submit"
			form={formId}
			class={btn.primary}
			disabled={busy}>変更する</button
		>
	{/snippet}
</Dialog>
