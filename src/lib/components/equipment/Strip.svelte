<script lang="ts">
	import type { Band } from '#lib/server/domain/equipment.ts';
	import { formatPeriod } from '#lib/format.ts';

	// The 7-day availability strip (DESIGN.md §9-A, the app's face): one small
	// cell per day inside a table cell, the booked and lent stretches drawn as
	// bars. A day is drawn from DAY_START to DAY_END o'clock; bars outside that
	// window are clipped. Past time today is shaded. Not a card: it lives in a
	// column of the ledger (and on the equipment page, `wide`).
	let {
		bands,
		days,
		now,
		suspended = false,
		wide = false,
	}: {
		bands: Band[];
		days: string[];
		now: string;
		suspended?: boolean;
		wide?: boolean;
	} = $props();

	const T = {
		loan: '貸出',
		overdue: '貸出(期限超過)',
		reservation: '予約',
		mine: '自分',
		free: '空き',
		suspended: '利用停止中',
		label: '7 日の空き状況',
		open: '(',
		close: ')',
		separator: '・',
	};

	const DAY_START = 8;
	const DAY_END = 20;
	const SPAN = (DAY_END - DAY_START) * 60;

	// Minutes from DAY_START on `day` to `at` (may be negative or > SPAN).
	function offset(day: string, at: string): number {
		const base = Date.parse(`${day}T${String(DAY_START).padStart(2, '0')}:00:00Z`);
		return (Date.parse(`${at}:00Z`) - base) / 60_000;
	}

	function pieces(day: string) {
		const out: { left: number; width: number; band: Band }[] = [];
		for (const band of bands) {
			const from = Math.max(0, offset(day, band.start));
			const to = Math.min(SPAN, offset(day, band.end));
			if (to > from) {
				out.push({ left: (from / SPAN) * 100, width: ((to - from) / SPAN) * 100, band });
			}
		}
		return out;
	}

	function pastWidth(day: string): number {
		if (day !== now.slice(0, 10)) {
			return day < now.slice(0, 10) ? 100 : 0;
		}
		return Math.min(100, Math.max(0, (offset(day, now) / SPAN) * 100));
	}

	function kindLabel(band: Band): string {
		const kind = band.kind === 'reservation' ? T.reservation : band.overdue ? T.overdue : T.loan;
		return `${kind}${band.mine ? `${T.separator}${T.mine}` : ''}`;
	}

	function title(day: string): string {
		const list = pieces(day).map(
			(p) =>
				`${formatPeriod(p.band.start, p.band.end)} ${p.band.name}${T.open}${kindLabel(p.band)}${T.close}`,
		);
		if (suspended) {
			list.unshift(T.suspended);
		}
		return `${day} ${list.length > 0 ? list.join(' / ') : T.free}`;
	}

	function barClass(band: Band): string {
		const base =
			band.kind === 'reservation'
				? 'bg-accent-soft border border-accent/50'
				: band.overdue
					? 'bg-seal'
					: 'bg-accent';
		return band.mine ? `${base} ring-1 ring-inset ring-ink/70` : base;
	}
</script>

<span data-testid="strip" class="flex gap-0.5" role="img" aria-label={T.label}>
	{#each days as day (day)}
		<span
			data-testid="strip-day"
			class="relative block {wide
				? 'w-16 h-5'
				: 'w-12 h-4'} rounded-xs border overflow-hidden {suspended
				? 'border-amber-200 bg-amber-50'
				: 'border-rule bg-surface'}"
			title={title(day)}
		>
			{#if pastWidth(day) > 0}
				<span class="absolute inset-y-0 left-0 bg-stone-100" style="width: {pastWidth(day)}%"
				></span>
			{/if}
			{#each pieces(day) as p, i (i)}
				<span
					data-testid="strip-band"
					data-kind={p.band.overdue ? 'overdue' : p.band.kind}
					class="absolute inset-y-[3px] rounded-[1px] {barClass(p.band)}"
					style="left: {p.left}%; width: max({p.width}%, 2px)"
				></span>
			{/each}
		</span>
	{/each}
</span>
