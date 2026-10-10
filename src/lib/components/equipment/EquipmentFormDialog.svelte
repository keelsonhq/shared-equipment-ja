<script module lang="ts">
	import type { EquipmentFields } from '#lib/server/domain/equipment.ts';

	const T = {
		fields: {
			assetTag: '管理番号',
			name: '名称',
			typeId: '種類',
			serialNo: '製造番号',
			locationId: '保管場所',
			note: '備考',
		},
		created: '登録しました。',
		saved: '保存しました。',
	};

	/**
	 * The name of each equipment field. The ledger's columns, the import
	 * preview, the history's edit lines and the equipment page use it too.
	 */
	export const EQUIPMENT_FIELD_LABELS: Record<keyof EquipmentFields, string> = T.fields;
</script>

<script lang="ts">
	import { tick, untrack } from 'svelte';
	import type { EquipmentView } from '#lib/server/domain/equipment.ts';
	import { sendJson } from '#lib/api.ts';
	import {
		check,
		type FieldErrors,
		focusFirstInvalid,
		hasErrors,
		splitError,
		withoutEdited,
	} from '#lib/forms.ts';
	import { masters } from '#lib/state/masters.svelte.ts';
	import { showToast } from '#lib/state/toast.svelte.ts';
	import { btn, input } from '#lib/ui.ts';
	import Dialog from '#lib/components/ui/Dialog.svelte';
	import FieldError from '#lib/components/ui/FieldError.svelte';
	import { EQUIPMENT_LIMITS } from '#lib/limits.ts';

	// Register a piece of equipment, or edit one (admin, DESIGN.md §9-E). The asset
	// tag is the company's own management number (it goes on the QR label),
	// separate from the manufacturer's serial number. "Save and continue" keeps
	// the dialog open with the type and location for the next one.
	let {
		onclose,
		ondone,
		onsaved,
		equipment = null,
	}: {
		onclose: () => void;
		ondone: (equipment: EquipmentView) => void;
		/** Called after each "save and continue" (the dialog stays open). */
		onsaved?: (equipment: EquipmentView) => void;
		equipment?: EquipmentView | null;
	} = $props();

	// Unique per instance: the submit buttons sit in the dialog footer, outside
	// the form, and must never reach the form of another dialog on the page.
	const uid = $props.id();
	const formId = `${uid}-form`;

	// The form starts from the equipment being edited (empty when registering).
	let assetTag = $state(untrack(() => equipment?.assetTag ?? ''));
	let name = $state(untrack(() => equipment?.name ?? ''));
	let typeId = $state(untrack(() => (equipment?.typeId ? String(equipment.typeId) : '')));
	let serialNo = $state(untrack(() => equipment?.serialNo ?? ''));
	let locationId = $state(
		untrack(() => (equipment?.locationId ? String(equipment.locationId) : '')),
	);
	let note = $state(untrack(() => equipment?.note ?? ''));
	let error = $state<string | null>(null);
	let errors = $state<FieldErrors>({});
	let busy = $state(false);
	let tagInput: HTMLInputElement | undefined = $state();

	// Active entries, plus the current ones even if deactivated.
	const types = $derived(masters.types.filter((t) => t.active || t.id === equipment?.typeId));
	const locations = $derived(
		masters.locations.filter((l) => l.active || l.id === equipment?.locationId),
	);
	const creating = $derived(equipment === null);

	const FIELDS = ['assetTag', 'name', 'typeId', 'serialNo', 'locationId', 'note'];

	// "Save and continue": the dialog stays open for the next one. Keep the
	// type and the location, clear the rest.
	async function next() {
		assetTag = '';
		name = '';
		serialNo = '';
		note = '';
		await tick();
		tagInput?.focus();
	}

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		const again = (e.submitter as HTMLButtonElement | null)?.value === 'continue';
		error = null;
		errors = check({
			assetTag: assetTag.trim() === '' && 'required',
			name: name.trim() === '' && 'required',
		});
		if (hasErrors(errors)) {
			void focusFirstInvalid();
			return;
		}
		busy = true;
		const body = {
			assetTag,
			name,
			typeId: typeId ? Number(typeId) : null,
			serialNo,
			locationId: locationId ? Number(locationId) : null,
			note,
		};
		try {
			if (equipment) {
				const saved = await sendJson<EquipmentView>('PATCH', `/api/equipment/${equipment.id}`, {
					...body,
					version: equipment.version,
				});
				showToast(T.saved);
				ondone(saved);
				return;
			}
			const saved = await sendJson<EquipmentView>('POST', '/api/equipment', body);
			showToast(T.created);
			if (again) {
				onsaved?.(saved);
				await next();
			} else {
				ondone(saved);
			}
		} catch (err) {
			({ fields: errors, general: error } = splitError(err, FIELDS));
			void focusFirstInvalid();
		} finally {
			busy = false;
		}
	}
</script>

<Dialog title={equipment ? '機材を編集' : '機材を登録'} {onclose} {error} wide>
	<form
		id={formId}
		data-testid="equipment-form"
		class="space-y-4"
		onsubmit={submit}
		oninput={(e) => (errors = withoutEdited(errors, e))}
		novalidate
	>
		<div class="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
			<div>
				<label class={input.label} for="equipment-tag">{T.fields.assetTag}</label>
				<input
					bind:this={tagInput}
					id="equipment-tag"
					name="assetTag"
					type="text"
					class="{input.text} font-mono tabular-nums"
					maxlength={EQUIPMENT_LIMITS.assetTag}
					placeholder="SP-0101"
					bind:value={assetTag}
					aria-invalid={!!errors.assetTag || undefined}
				/>
				{#if errors.assetTag}
					<FieldError field="assetTag" reason={errors.assetTag} />
				{:else}
					<p class={input.help}>社内で付ける番号。QR ラベルに印刷されます。製造番号とは別です。</p>
				{/if}
			</div>
			<div>
				<label class={input.label} for="equipment-type"
					>{T.fields.typeId} <span class="text-ink-faint">(任意)</span></label
				>
				<select
					id="equipment-type"
					name="typeId"
					class={input.select}
					bind:value={typeId}
					aria-invalid={!!errors.typeId || undefined}
				>
					<option value="">未設定</option>
					{#each types as t (t.id)}
						<option value={String(t.id)}>{t.name}</option>
					{/each}
				</select>
				<FieldError field="typeId" reason={errors.typeId} />
			</div>
		</div>
		<div>
			<label class={input.label} for="equipment-name">{T.fields.name}</label>
			<input
				id="equipment-name"
				name="name"
				type="text"
				class={input.text}
				maxlength={EQUIPMENT_LIMITS.name}
				placeholder="検証用 Android 端末 Pixel 9"
				bind:value={name}
				aria-invalid={!!errors.name || undefined}
			/>
			<FieldError field="name" reason={errors.name} />
		</div>
		<div class="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
			<div>
				<label class={input.label} for="equipment-serial"
					>{T.fields.serialNo} <span class="text-ink-faint">(任意)</span></label
				>
				<input
					id="equipment-serial"
					name="serialNo"
					type="text"
					class="{input.text} font-mono"
					maxlength={EQUIPMENT_LIMITS.serialNo}
					bind:value={serialNo}
					aria-invalid={!!errors.serialNo || undefined}
				/>
				<FieldError field="serialNo" reason={errors.serialNo} />
			</div>
			<div>
				<label class={input.label} for="equipment-location"
					>{T.fields.locationId} <span class="text-ink-faint">(任意)</span></label
				>
				<select
					id="equipment-location"
					name="locationId"
					class={input.select}
					bind:value={locationId}
					aria-invalid={!!errors.locationId || undefined}
				>
					<option value="">未設定</option>
					{#each locations as l (l.id)}
						<option value={String(l.id)}>{l.name}</option>
					{/each}
				</select>
				<FieldError field="locationId" reason={errors.locationId} />
			</div>
		</div>
		<div>
			<label class={input.label} for="equipment-note"
				>{T.fields.note} <span class="text-ink-faint">(任意)</span></label
			>
			<textarea
				id="equipment-note"
				name="note"
				class={input.textarea}
				maxlength={EQUIPMENT_LIMITS.note}
				placeholder="付属品・使うときの注意など"
				bind:value={note}
				aria-invalid={!!errors.note || undefined}></textarea>
			{#if errors.note}
				<FieldError field="note" reason={errors.note} />
			{:else}
				<p class={input.help}>管理者だけに見えます。</p>
			{/if}
		</div>
	</form>
	{#snippet footer()}
		<button
			data-testid="equipment-form-cancel"
			type="button"
			class={btn.secondary}
			onclick={onclose}>キャンセル</button
		>
		{#if creating}
			<button
				data-testid="equipment-form-continue"
				type="submit"
				form={formId}
				value="continue"
				class={btn.secondary}
				disabled={busy}>保存して続けて登録</button
			>
			<button
				data-testid="equipment-form-submit"
				type="submit"
				form={formId}
				class={btn.primary}
				disabled={busy}>登録する</button
			>
		{:else}
			<button
				data-testid="equipment-form-submit"
				type="submit"
				form={formId}
				class={btn.primary}
				disabled={busy}>保存する</button
			>
		{/if}
	{/snippet}
</Dialog>
