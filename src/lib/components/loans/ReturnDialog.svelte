<script lang="ts">
	import type { LoanView } from '#lib/server/domain/loans.ts';
	import { sendJson } from '#lib/api.ts';
	import { formatAt } from '#lib/format.ts';
	import { type FieldErrors, focusFirstInvalid, splitError, withoutEdited } from '#lib/forms.ts';
	import { masters } from '#lib/state/masters.svelte.ts';
	import { serverNow } from '#lib/state/session.svelte.ts';
	import { showToast } from '#lib/state/toast.svelte.ts';
	import type { LoanTarget } from './loanTarget.ts';
	import { btn, input } from '#lib/ui.ts';
	import AssetTag from '#lib/components/equipment/AssetTag.svelte';
	import { REASON_LABELS } from '#lib/components/equipment/StatusChip.svelte';
	import Dialog from '#lib/components/ui/Dialog.svelte';
	import FieldError from '#lib/components/ui/FieldError.svelte';
	import { RETURN_NOTE_MAX, SUSPEND_NOTE_MAX } from '#lib/limits.ts';

	const T = {
		returned: '返却を記録しました。',
	};

	// Record a return, at the current time (DESIGN.md §9-E). Admins also choose
	// where it is kept and may suspend it if it needs repair; the borrower
	// records a note only. Recorded by the borrower = "returned" seal, by an
	// admin for someone else = "collected".
	let {
		onclose,
		ondone,
		target,
		admin,
	}: {
		onclose: () => void;
		ondone: (loan: LoanView) => void;
		target: LoanTarget;
		admin: boolean;
	} = $props();

	// Unique per instance: the submit buttons sit in the dialog footer, outside
	// the form, and must never reach the form of another dialog on the page.
	const uid = $props.id();
	const formId = `${uid}-form`;

	// The server's time when the dialog opened (see serverNow).
	const now = serverNow();

	let locationId = $state('');
	let condition = $state<'ok' | 'repair'>('ok');
	let reason = $state('repair');
	let reasonNote = $state('');
	let note = $state('');
	let error = $state<string | null>(null);
	let errors = $state<FieldErrors>({});
	let busy = $state(false);

	const locations = $derived(masters.locations.filter((l) => l.active));

	const shown = ['note', 'locationId', 'suspend.reason', 'suspend.note'];

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		error = null;
		errors = {};
		busy = true;
		try {
			const loan = await sendJson<LoanView>(
				'POST',
				`/api/loans/${encodeURIComponent(target.loanId)}/return`,
				{
					note,
					locationId: admin && locationId ? Number(locationId) : null,
					suspend: admin && condition === 'repair' ? { reason, note: reasonNote } : null,
				},
			);
			showToast(T.returned);
			ondone(loan);
		} catch (err) {
			({ fields: errors, general: error } = splitError(err, shown));
			void focusFirstInvalid();
		} finally {
			busy = false;
		}
	}
</script>

<Dialog title="返却を記録" {onclose} {error}>
	<form
		id={formId}
		data-testid="return-form"
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
		<dl class="grid grid-cols-3 gap-4 text-sm max-sm:grid-cols-1">
			<div>
				<dt class={input.label}>貸出日時</dt>
				<dd class="font-mono tabular-nums">{formatAt(target.lentAt)}</dd>
			</div>
			<div>
				<dt class={input.label}>返却予定</dt>
				<dd class="font-mono tabular-nums {target.dueAt < now ? 'text-seal' : ''}">
					{formatAt(target.dueAt)}
				</dd>
			</div>
			<div>
				<dt class={input.label}>返却日時</dt>
				<dd class="font-mono tabular-nums">{formatAt(now)}(いま)</dd>
			</div>
		</dl>

		{#if admin}
			<div>
				<label class={input.label} for="return-location"
					>保管場所 <span class="text-ink-faint">(任意)</span></label
				>
				<select
					id="return-location"
					name="locationId"
					class={input.select}
					bind:value={locationId}
					aria-invalid={!!errors.locationId || undefined}
				>
					<option value="">変えない</option>
					{#each locations as l (l.id)}
						<option value={String(l.id)}>{l.name}</option>
					{/each}
				</select>
				<FieldError field="locationId" reason={errors.locationId} />
			</div>

			<fieldset>
				<legend class={input.label}>状態</legend>
				<div class="flex gap-6 text-sm">
					<label class="inline-flex items-center gap-2">
						<input type="radio" class={input.radio} value="ok" bind:group={condition} />そのまま
					</label>
					<label class="inline-flex items-center gap-2">
						<input
							data-testid="return-repair"
							type="radio"
							class={input.radio}
							value="repair"
							bind:group={condition}
						/>要修理
					</label>
				</div>
			</fieldset>

			{#if condition === 'repair'}
				<div class="space-y-4 rounded-sm border border-amber-200 bg-amber-50 p-3">
					<p class="text-sm text-amber-800">
						返却と同時に利用停止にします。入っている予約は残り、予約した人に警告が出ます。
					</p>
					<div>
						<label class={input.label} for="return-reason">利用停止の理由</label>
						<select
							id="return-reason"
							name="suspend.reason"
							class={input.select}
							bind:value={reason}
							aria-invalid={!!errors['suspend.reason'] || undefined}
						>
							{#each Object.entries(REASON_LABELS) as [value, label] (value)}
								<option {value}>{label}</option>
							{/each}
						</select>
						<FieldError field="suspend.reason" reason={errors['suspend.reason']} />
					</div>
					<div>
						<label class={input.label} for="return-reason-note"
							>理由の詳細 <span class="text-ink-faint">(任意)</span></label
						>
						<input
							id="return-reason-note"
							name="suspend.note"
							type="text"
							class={input.text}
							maxlength={SUSPEND_NOTE_MAX}
							bind:value={reasonNote}
							aria-invalid={!!errors['suspend.note'] || undefined}
						/>
						<FieldError field="suspend.note" reason={errors['suspend.note']} />
					</div>
				</div>
			{/if}
		{/if}

		<div>
			<label class={input.label} for="return-note"
				>備考 <span class="text-ink-faint">(任意)</span></label
			>
			<textarea
				id="return-note"
				name="note"
				class={input.textarea}
				maxlength={RETURN_NOTE_MAX}
				placeholder="付属品の不足・気づいた傷など"
				bind:value={note}
				aria-invalid={!!errors.note || undefined}></textarea>
			<FieldError field="note" reason={errors.note} />
		</div>
	</form>

	{#snippet footer()}
		<button type="button" class={btn.secondary} onclick={onclose}>キャンセル</button>
		<button
			data-testid="return-submit"
			type="submit"
			form={formId}
			class={btn.primary}
			disabled={busy}>返却を記録</button
		>
	{/snippet}
</Dialog>
