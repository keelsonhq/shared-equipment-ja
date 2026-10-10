<script module lang="ts">
	import type { EventKind as Kind } from '#lib/server/domain/events.ts';

	const T = {
		kinds: {
			reserve: '予約',
			cancel: '予約取消',
			lend: '貸出',
			extend: '延長',
			return: '返却',
			create: '登録',
			edit: '編集',
			suspend: '利用停止',
			resume: '再開',
			import: '取込',
		},
	};

	/** History entry kinds, in the order the history filter offers them. */
	export const KIND_LABELS: Record<Kind, string> = T.kinds;
</script>

<script lang="ts">
	// Label of a history entry kind.
	let { kind }: { kind: Kind } = $props();
</script>

<span data-testid="event-kind" data-kind={kind} class="whitespace-nowrap">{KIND_LABELS[kind]}</span>
