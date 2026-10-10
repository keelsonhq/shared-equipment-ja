import { render } from 'svelte/server';
import { describe, expect, it } from 'vite-plus/test';
import {
	EQUIPMENT_STATUSES,
	type EquipmentStatus,
	SUSPEND_REASONS,
	type SuspendReason,
} from '#lib/server/domain/equipment.ts';
import { EVENT_KINDS, type EventKind } from '#lib/server/domain/events.ts';
import type { LoanView, ReturnKind } from '#lib/server/domain/loans.ts';
import * as statusChip from '#lib/components/equipment/StatusChip.svelte';
import * as eventKind from '#lib/components/events/EventKind.svelte';
import LoanLedger from '#lib/components/loans/LoanLedger.svelte';
import MemberCombobox from '#lib/components/people/MemberCombobox.svelte';
import ErrorBox from '#lib/components/ui/ErrorBox.svelte';
import Seal from '#lib/components/ui/Seal.svelte';
import { messageFor } from '#lib/messages.ts';

// Components that own words other screens reuse (label tables exported from
// their <script module>), and shared parts that take words or a destination
// from elsewhere: the caller (Seal, MemberCombobox) or the message table
// (ErrorBox). Japanese is built from code points (no CJK in tests).

// `vp check` types a .svelte import as its default export only (svelte-check
// sees the rest), so what a <script module> exports is read with its type.
const { STATUS_LABELS, REASON_LABELS } = statusChip as unknown as {
	STATUS_LABELS: Record<EquipmentStatus, string>;
	REASON_LABELS: Record<SuspendReason, string>;
};
const { KIND_LABELS } = eventKind as unknown as { KIND_LABELS: Record<EventKind, string> };
const StatusChip = statusChip.default;
const EventKindLabel = eventKind.default;

const ja = (...codePoints: number[]) => String.fromCodePoint(...codePoints);
const RETURNED = ja(0x8fd4, 0x5374, 0x6e08);
const COLLECTED = ja(0x56de, 0x53ce, 0x6e08);
const TO_MY_PAGE = ja(0x81ea, 0x5206, 0x306e, 0x30da, 0x30fc, 0x30b8, 0x3078);
const SEARCH_PEOPLE = ja(
	0x540d,
	0x524d,
	0x307e,
	0x305f,
	0x306f,
	0x30e1,
	0x30fc,
	0x30eb,
	0x3067,
	0x691c,
	0x7d22,
);

/** The text of each element with `data-testid="<testid>"`, in order. */
function texts(html: string, testid: string): string[] {
	return [...html.matchAll(new RegExp(`data-testid="${testid}"[^>]*>([^<]*)<`, 'g'))].map(
		(m) => m[1],
	);
}

describe('label tables', () => {
	it('name every status, suspension reason and history kind', () => {
		// Statuses and reasons in the server order (the dialogs offer reasons in
		// it); history kinds in the order of the history filter.
		expect(Object.keys(STATUS_LABELS)).toEqual([...EQUIPMENT_STATUSES]);
		expect(Object.keys(REASON_LABELS)).toEqual([...SUSPEND_REASONS]);
		expect(Object.keys(KIND_LABELS).sort()).toEqual([...EVENT_KINDS].sort());
		for (const label of [
			...Object.values(STATUS_LABELS),
			...Object.values(REASON_LABELS),
			...Object.values(KIND_LABELS),
		]) {
			expect(label).not.toBe('');
		}
	});

	it('are what the components draw', () => {
		const chip = render(StatusChip, { props: { status: 'on_loan' } }).body;
		expect(chip).toContain('data-status="on_loan"');
		expect(texts(chip, 'status-chip')).toEqual([STATUS_LABELS.on_loan]);
		const suspended = render(StatusChip, { props: { status: 'suspended', reason: 'repair' } }).body;
		expect(texts(suspended, 'status-chip')).toEqual([
			`${STATUS_LABELS.suspended}: ${REASON_LABELS.repair}`,
		]);
		// A reason the table does not know is shown as its code.
		const unknown = render(StatusChip, { props: { status: 'suspended', reason: 'stolen' } }).body;
		expect(texts(unknown, 'status-chip')).toEqual([`${STATUS_LABELS.suspended}: stolen`]);

		const kind = render(EventKindLabel, { props: { kind: 'import' } }).body;
		expect(kind).toContain('data-kind="import"');
		expect(texts(kind, 'event-kind')).toEqual([KIND_LABELS.import]);
	});
});

function closed(id: string, returnKind: ReturnKind): LoanView {
	return {
		id,
		equipmentId: 1,
		assetTag: 'PJ-0001',
		equipmentName: 'Projector',
		typeName: null,
		suspendedReason: null,
		name: 'Sato',
		imageUrl: null,
		membership: 'member',
		mine: false,
		reservationId: null,
		lentAt: '2025-04-01T10:00',
		dueAt: '2025-04-01T18:00',
		overdue: false,
		note: null,
		lentByName: 'Admin',
		returnedAt: '2025-04-01T17:00',
		returnKind,
		returnedByName: 'Admin',
		returnNote: null,
		returnLocationName: null,
	};
}

describe('Seal', () => {
	it('carries the words of the loan ledger (returned / collected)', () => {
		const html = render(LoanLedger, {
			props: {
				rows: [closed('l-1', 'returned'), closed('l-2', 'collected')],
				variant: 'equipment',
				now: '2025-06-01T09:00',
			},
		}).body;
		expect(html).toContain('data-kind="returned"');
		expect(html).toContain('data-kind="collected"');
		expect(texts(html, 'seal')).toEqual([RETURNED, COLLECTED]);
	});

	it('shows the words of the caller', () => {
		const small = render(Seal, { props: { kind: 'inspected', label: 'Inspected' } }).body;
		expect(small).toContain('data-kind="inspected"');
		expect(texts(small, 'seal')).toEqual(['Inspected']);
		// The round seal uses `largeLabel`, or else `label`.
		const round = { kind: 'inspected', label: 'Inspected', large: true };
		expect(texts(render(Seal, { props: round }).body, 'seal')).toEqual(['Inspected']);
		expect(
			texts(render(Seal, { props: { ...round, largeLabel: 'In\nspected' } }).body, 'seal'),
		).toEqual(['In\nspected']);
	});
});

describe('ErrorBox', () => {
	it('sends a user without manage to their own page (the message table says where)', () => {
		expect(messageFor('forbidden_manage_required').action).toEqual({
			href: '/me',
			label: TO_MY_PAGE,
		});
		// Every screen gets the link without passing anything, retry or not.
		for (const onretry of [undefined, () => {}]) {
			const html = render(ErrorBox, { props: { code: 'forbidden_manage_required', onretry } }).body;
			expect(html).toContain('href="/me"');
			expect(html).toContain(`>${TO_MY_PAGE}</a>`);
			expect(html).not.toContain('<button');
		}
	});

	it('offers a reload for other errors when the page can retry, and no link', () => {
		const retry = render(ErrorBox, { props: { code: 'internal_error', onretry: () => {} } }).body;
		expect(retry).toContain('<button');
		expect(retry).not.toContain('<a ');
		const plain = render(ErrorBox, { props: { code: 'internal_error' } }).body;
		expect(plain).not.toContain('<a ');
		expect(plain).not.toContain('<button');
	});
});

describe('MemberCombobox', () => {
	it('asks for a name or email by default, compact or not', () => {
		for (const compact of [false, true]) {
			const html = render(MemberCombobox, { props: { id: 'p', compact } }).body;
			expect(html).toContain(`placeholder="${SEARCH_PEOPLE}"`);
		}
	});

	it('shows the placeholder of the caller', () => {
		const html = render(MemberCombobox, {
			props: { id: 'p', compact: true, placeholder: 'Filter by holder' },
		}).body;
		expect(html).toContain('placeholder="Filter by holder"');
	});
});
