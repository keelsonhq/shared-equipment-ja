<script lang="ts">
	// Header of the 7-day availability strip (DESIGN.md §9-A): one label per day,
	// aligned with the day cells of Strip.svelte below it.
	let { days, today, wide = false }: { days: string[]; today: string; wide?: boolean } = $props();

	const T = {
		weekdays: ['日', '月', '火', '水', '木', '金', '土'],
	};

	function label(day: string): { date: string; weekday: string } {
		const d = new Date(`${day}T00:00:00Z`);
		return { date: `${d.getUTCMonth() + 1}/${d.getUTCDate()}`, weekday: T.weekdays[d.getUTCDay()] };
	}
</script>

<span class="flex gap-0.5" aria-hidden="true">
	{#each days as day (day)}
		{@const l = label(day)}
		<span
			class="{wide ? 'w-16' : 'w-12'} text-center leading-tight {day === today
				? 'text-ink font-medium'
				: ''} {l.weekday === T.weekdays[0] || l.weekday === T.weekdays[6] ? 'text-ink-faint' : ''}"
		>
			<span class="block font-mono tabular-nums">{l.date}</span><span class="block text-[10px]"
				>{l.weekday}</span
			>
		</span>
	{/each}
</span>
