<script lang="ts">
	import type { EquipmentDetail, EquipmentView } from '#lib/server/domain/equipment.ts';
	import type { Person } from '#lib/server/domain/directory.ts';
	import type { ReservationView } from '#lib/server/domain/reservations.ts';
	import { getJson, sendJson } from '#lib/api.ts';
	import { addMinutes, formatAt, formatPeriod, stepStart } from '#lib/format.ts';
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
	import type { EquipmentRef } from '#lib/types.ts';
	import { btn, input } from '#lib/ui.ts';
	import AssetTag from '#lib/components/equipment/AssetTag.svelte';
	import EquipmentPicker from '#lib/components/equipment/EquipmentPicker.svelte';
	import Dialog from '#lib/components/ui/Dialog.svelte';
	import FieldError from '#lib/components/ui/FieldError.svelte';
	import MemberCombobox from '#lib/components/people/MemberCombobox.svelte';
	import { RESERVATION_PURPOSE_MAX } from '#lib/limits.ts';

	const T = {
		reserved: '予約しました。',
		loan: '貸出中',
		overdue: '貸出中(返却予定を過ぎています)',
		booking: '予約',
	};

	// Book a piece of equipment (DESIGN.md §9-E). Times are 15-minute steps in the
	// app's time zone; the period is [start, end). Below the form, what is
	// already booked or out, so a free slot can be chosen. Admins may book for
	// someone else (blank = themselves).
	let {
		onclose,
		ondone,
		equipment = null,
		admin,
	}: {
		onclose: () => void;
		ondone: (r: ReservationView) => void;
		/** Fixed by the screen that opened the dialog; else picked here. */
		equipment?: EquipmentRef | null;
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
	// The current step for an hour (moved to the first free hour once the
	// equipment's schedule is known, until the times are edited).
	let startsAt = $state(stepStart(now));
	let endsAt = $state(addMinutes(stepStart(now), 60));
	let purpose = $state('');
	let error = $state<string | null>(null);
	let errors = $state<FieldErrors>({});
	let busy = $state(false);
	let schedule = $state<{ label: string; period: string; name: string }[] | null>(null);
	// Whether the person changed the times (else the defaults may move to a free slot).
	let touched = $state(false);

	const target = $derived(equipment ?? picked);
	const minStart = $derived(stepStart(now));

	// The first free hour from `start`, given the taken periods (sorted by start).
	function firstFree(start: string, taken: { start: string; end: string }[]): string {
		let candidate = start;
		for (const t of taken) {
			if (t.start < addMinutes(candidate, 60) && t.end > candidate) {
				candidate = t.end;
			}
		}
		return candidate;
	}

	// What is already taken on the chosen equipment.
	$effect(() => {
		const id = target?.id;
		schedule = null;
		if (!id) {
			return;
		}
		Promise.all([
			getJson<EquipmentDetail>(`/api/equipment/${id}`),
			getJson<ReservationView[]>(`/api/equipment/${id}/reservations`),
		])
			.then(([detail, bookings]) => {
				const loan = detail.equipment.loan;
				if (!touched) {
					const taken = [
						...(loan && !loan.overdue ? [{ start: loan.lentAt, end: loan.dueAt }] : []),
						...bookings.map((b) => ({ start: b.startsAt, end: b.endsAt })),
					].sort((a, b) => a.start.localeCompare(b.start));
					startsAt = firstFree(stepStart(now), taken);
					endsAt = addMinutes(startsAt, 60);
				}
				schedule = [
					...(loan
						? [
								{
									label: loan.overdue ? T.overdue : T.loan,
									period: `${formatAt(loan.lentAt)} – ${formatAt(loan.dueAt)}`,
									name: loan.name,
								},
							]
						: []),
					...bookings.map((b) => ({
						label: T.booking,
						period: formatPeriod(b.startsAt, b.endsAt),
						name: b.name,
					})),
				];
			})
			.catch(() => {
				schedule = [];
			});
	});

	const shown = $derived([
		...(equipment ? [] : ['equipmentId']),
		...(admin ? ['userId'] : []),
		'startsAt',
		'endsAt',
		'purpose',
	]);

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		error = null;
		errors = check({
			equipmentId: !target && 'required',
			startsAt: timeProblem(startsAt, { notBefore: minStart }),
			endsAt: timeProblem(endsAt, { start: startsAt }),
		});
		if (hasErrors(errors) || !target) {
			void focusFirstInvalid();
			return;
		}
		busy = true;
		try {
			const r = await sendJson<ReservationView>('POST', '/api/reservations', {
				equipmentId: target.id,
				userId: admin && person ? person.id : null,
				startsAt,
				endsAt,
				purpose,
			});
			showToast(T.reserved);
			ondone(r);
		} catch (err) {
			// The equipment or the person may be fixed by the screen that opened the
			// dialog; an error on it is shown as the general error.
			({ fields: errors, general: error } = splitError(err, shown, {
				equipmentId: 'equipment_not_found',
				userId: 'member_not_found',
			}));
			void focusFirstInvalid();
		} finally {
			busy = false;
		}
	}
</script>

<Dialog title="予約する" {onclose} {error}>
	<form
		id={formId}
		data-testid="reservation-form"
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
				<label class={input.label} for="reservation-equipment">機材</label>
				<EquipmentPicker
					id="reservation-equipment"
					scope="bookable"
					bind:selected={picked}
					invalid={!!errors.equipmentId}
					onselect={() => (errors = without(errors, 'equipmentId'))}
				/>
				<FieldError field="equipmentId" reason={errors.equipmentId} />
			</div>
		{/if}

		{#if admin}
			<div>
				<label class={input.label} for="reservation-person"
					>予約する人 <span class="text-ink-faint">(任意)</span></label
				>
				<MemberCombobox
					id="reservation-person"
					bind:selected={person}
					invalid={!!errors.userId}
					onselect={() => (errors = without(errors, 'userId'))}
				/>
				{#if errors.userId}
					<FieldError field="userId" reason={errors.userId} />
				{:else}
					<p class={input.help}>空欄のときは自分の予約になります。</p>
				{/if}
			</div>
		{/if}

		<div class="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
			<div>
				<label class={input.label} for="reservation-start">開始</label>
				<input
					id="reservation-start"
					name="startsAt"
					type="datetime-local"
					step="900"
					min={minStart}
					class="{input.text} font-mono tabular-nums"
					oninput={() => (touched = true)}
					bind:value={startsAt}
					aria-invalid={!!errors.startsAt || undefined}
				/>
				<FieldError field="startsAt" reason={errors.startsAt} />
			</div>
			<div>
				<label class={input.label} for="reservation-end">終了</label>
				<input
					id="reservation-end"
					name="endsAt"
					type="datetime-local"
					step="900"
					min={startsAt || minStart}
					class="{input.text} font-mono tabular-nums"
					oninput={() => (touched = true)}
					bind:value={endsAt}
					aria-invalid={!!errors.endsAt || undefined}
				/>
				<FieldError field="endsAt" reason={errors.endsAt} />
			</div>
		</div>
		<p class="{input.help} -mt-2">
			15 分単位。終了の時刻ちょうどから次の人が予約できます。1 回の予約は 30 日まで。
		</p>

		<div>
			<label class={input.label} for="reservation-purpose"
				>目的・備考 <span class="text-ink-faint">(任意)</span></label
			>
			<textarea
				id="reservation-purpose"
				name="purpose"
				class={input.textarea}
				maxlength={RESERVATION_PURPOSE_MAX}
				placeholder="例: 取引先でのデモ"
				bind:value={purpose}
				aria-invalid={!!errors.purpose || undefined}></textarea>
			{#if errors.purpose}
				<FieldError field="purpose" reason={errors.purpose} />
			{:else}
				<p class={input.help}>自分と管理者だけに見えます。</p>
			{/if}
		</div>

		{#if target}
			<section class="border-t border-rule pt-3" aria-labelledby="reservation-schedule">
				<h3 id="reservation-schedule" class={input.label}>この機材の予定</h3>
				{#if schedule === null}
					<p class="text-xs text-ink-muted">読み込み中…</p>
				{:else if schedule.length === 0}
					<p class="text-xs text-ink-muted">予約・貸出はありません。</p>
				{:else}
					<ul class="space-y-0.5 text-xs text-ink-muted">
						{#each schedule.slice(0, 8) as s, i (i)}
							<li class="flex gap-3">
								<span class="font-mono tabular-nums text-ink">{s.period}</span>
								<span class="truncate">{s.name}({s.label})</span>
							</li>
						{/each}
					</ul>
				{/if}
			</section>
		{/if}
	</form>

	{#snippet footer()}
		<button type="button" class={btn.secondary} onclick={onclose}>キャンセル</button>
		<button
			data-testid="reservation-submit"
			type="submit"
			form={formId}
			class={btn.primary}
			disabled={busy}>予約する</button
		>
	{/snippet}
</Dialog>
