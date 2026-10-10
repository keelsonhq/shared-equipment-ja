// Small UI-side shapes shared between components. API response types are
// imported (type-only) from the server modules that produce them.

/** A piece of equipment as shown at the top of a dialog. */
export interface EquipmentRef {
	id: number;
	assetTag: string;
	name: string;
}

/** A person as shown in dialogs. */
export interface PersonRef {
	id: string;
	name: string;
	email: string | null;
	imageUrl: string | null;
}

/** A booking a loan may pick up (lend dialog). */
export interface BookingRef {
	id: string;
	startsAt: string;
	endsAt: string;
}
