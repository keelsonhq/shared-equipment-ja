<script lang="ts">
	import Printer from '@lucide/svelte/icons/printer';
	import { page } from '$app/state';
	import type { EquipmentDetail } from '#lib/server/domain/equipment.ts';
	import ErrorBox from '#lib/components/ui/ErrorBox.svelte';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import { loader } from '#lib/state/loader.svelte.ts';
	import { btn } from '#lib/ui.ts';
	import PageLoading from '#lib/components/ui/PageLoading.svelte';
	import PageTitle, { APP_NAME } from '#lib/components/PageTitle.svelte';

	const T = {
		qrAlt: 'この機材のページを開く QR コード',
	};

	// One printable asset-tag label (DESIGN.md §9-B): the QR code of the equipment
	// page, the asset tag and the name. Printing shows the label only (the
	// print rules below hide the app shell without touching the layout).
	const equipmentId = $derived(Number(page.params.id));
	const detail = loader<EquipmentDetail>(() => `/api/equipment/${equipmentId}`);
	const equipment = $derived(detail.data?.equipment ?? null);
</script>

<PageTitle title={equipment ? `${equipment.assetTag} のラベル` : 'ラベル'} />

{#if detail.error}
	<ErrorBox code={detail.error} />
{:else if equipment}
	<PageHeader title="ラベルを印刷">
		{#snippet actions()}
			<a class={btn.secondary} href="/equipment/{equipment?.id}">機材のページへ</a>
			<button
				data-testid="label-print"
				type="button"
				class={btn.primary}
				onclick={() => window.print()}
			>
				<Printer class="size-4 stroke-[1.5]" />印刷する
			</button>
		{/snippet}
	</PageHeader>
	<div class="px-6 py-6 space-y-3 max-md:px-4">
		<p class="text-xs text-ink-muted">
			実寸はおよそ 62 × 32 mm です。ラベル用紙に印刷して機材に貼ってください。
		</p>
		<div
			data-testid="label-sheet"
			class="label-sheet inline-flex items-center gap-3 w-[62mm] h-[32mm] p-[2mm] border border-rule-strong bg-white text-ink"
		>
			<img
				src="/api/equipment/{equipment.id}/qr"
				alt={T.qrAlt}
				class="h-[28mm] w-[28mm] shrink-0"
			/>
			<div class="min-w-0 space-y-1">
				<p class="font-mono text-[13px] font-medium tracking-wide">{equipment.assetTag}</p>
				<p class="text-[9px] leading-tight line-clamp-3">{equipment.name}</p>
				<p class="text-[8px] text-ink-muted">{APP_NAME}</p>
			</div>
		</div>
	</div>
{:else}
	<PageLoading />
{/if}

<style>
	@media print {
		:global(body *) {
			visibility: hidden;
		}
		:global(.label-sheet),
		:global(.label-sheet *) {
			visibility: visible;
		}
		:global(.label-sheet) {
			position: fixed;
			left: 0;
			top: 0;
			border: none;
		}
	}
</style>
