// What the return and extend dialogs need to know about the loan, built from
// the rows a screen can start from: a piece of equipment (the ledger, the
// equipment page), a loan (my page), and the home screen's rows (needs action,
// today's returns).

import type { EquipmentView } from '#lib/server/domain/equipment.ts';
import type { AttentionRow, TodayRow } from '#lib/server/domain/home.ts';
import type { LoanView } from '#lib/server/domain/loans.ts';

export interface LoanTarget {
	loanId: string;
	assetTag: string;
	equipmentName: string;
	/** The borrower's name. */
	name: string;
	/** The caller is the borrower (the extend dialog warns about other people's bookings). */
	mine: boolean;
	lentAt: string;
	dueAt: string;
}

/** The open loan of a piece of equipment, or null when nobody has it out. */
export function loanTargetOfEquipment(equipment: EquipmentView): LoanTarget | null {
	const loan = equipment.loan;
	if (!loan) {
		return null;
	}
	return {
		loanId: loan.id,
		assetTag: equipment.assetTag,
		equipmentName: equipment.name,
		name: loan.name,
		mine: loan.mine,
		lentAt: loan.lentAt,
		dueAt: loan.dueAt,
	};
}

/** A loan as listed on a page (my loans). */
export function loanTargetOfLoan(loan: LoanView): LoanTarget {
	return {
		loanId: loan.id,
		assetTag: loan.assetTag,
		equipmentName: loan.equipmentName,
		name: loan.name,
		mine: loan.mine,
		lentAt: loan.lentAt,
		dueAt: loan.dueAt,
	};
}

/**
 * The loan of a home row that needs action (overdue, due soon), or null for a
 * row without one (suspended equipment). The home screen is the admin's: the
 * loan is someone else's.
 */
export function loanTargetOfAttention(row: AttentionRow): LoanTarget | null {
	const loan = row.loan;
	if (!loan) {
		return null;
	}
	return {
		loanId: loan.id,
		assetTag: row.assetTag,
		equipmentName: row.equipmentName,
		name: loan.name,
		mine: false,
		lentAt: loan.lentAt,
		dueAt: loan.dueAt,
	};
}

/**
 * The loan of one of today's returns, or null for a booking row. The API sets
 * the loan and its lent time together, so a missing one means "nothing to
 * return", never a blank to fill in.
 */
export function loanTargetOfToday(row: TodayRow): LoanTarget | null {
	if (!row.loanId || !row.lentAt) {
		return null;
	}
	return {
		loanId: row.loanId,
		assetTag: row.assetTag,
		equipmentName: row.equipmentName,
		name: row.name,
		mine: false,
		lentAt: row.lentAt,
		dueAt: row.at,
	};
}
