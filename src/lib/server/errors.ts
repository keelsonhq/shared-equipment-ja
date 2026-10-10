// Stable error codes. The API never returns human-facing text: the frontend
// resolves each code to a message (src/lib/messages.ts). A new code goes in
// three places: its group below, STATUS (its HTTP status) and a message there;
// the type checker reports a missing status or message.

/**
 * Codes of the parts an app built from this template keeps as they are:
 * authentication and request shape, people (Directory API), attachments, CSV
 * import and the AI assistant tools.
 */
const COMMON_CODES = {
	Unauthorized: 'unauthorized',
	ForbiddenManageRequired: 'forbidden_manage_required',
	InvalidRequest: 'invalid_request',
	/** Input problems tied to fields: the body carries `fields` (see ValidationError). */
	ValidationFailed: 'validation_failed',
	UnsupportedMediaType: 'unsupported_media_type',
	NotFound: 'not_found',
	MemberNotFound: 'member_not_found',
	PeopleUnconfigured: 'people_unconfigured',
	PeopleUnavailable: 'people_unavailable',
	AttachmentNotFound: 'attachment_not_found',
	AttachmentTooLarge: 'attachment_too_large',
	AttachmentTypeUnsupported: 'attachment_type_unsupported',
	AttachmentLimitReached: 'attachment_limit_reached',
	AttachmentStorageFailed: 'attachment_storage_failed',
	// CSV import: file-level problems (the body may carry the file `line`).
	CsvTooLarge: 'csv_too_large',
	CsvTooManyRows: 'csv_too_many_rows',
	CsvEncodingUnknown: 'csv_encoding_unknown',
	CsvUnclosedQuote: 'csv_unclosed_quote',
	CsvEmpty: 'csv_empty',
	CsvNoRows: 'csv_no_rows',
	CsvMissingColumns: 'csv_missing_columns',
	CsvDuplicateColumn: 'csv_duplicate_column',
	ImportHasErrors: 'import_has_errors',
	ImportNothingToImport: 'import_nothing_to_import',
	/** POST /api/mcp/<tool> for a tool the app does not have. */
	McpToolNotFound: 'mcp_tool_not_found',
	InternalError: 'internal_error',
} as const;

/**
 * Codes of this app's own records and rules (equipment, reservations, loans,
 * types, locations).
 */
const APP_CODES = {
	EquipmentNotFound: 'equipment_not_found',
	EquipmentSuspended: 'equipment_suspended',
	EquipmentNotSuspended: 'equipment_not_suspended',
	EquipmentVersionConflict: 'equipment_version_conflict',
	/** Someone has it out, still within the due time. */
	EquipmentOnLoan: 'equipment_on_loan',
	/** The previous borrower has not brought it back and the due time has passed. */
	PreviousLoanNotReturned: 'previous_loan_not_returned',
	/** Another person's booking covers the current time. */
	EquipmentReserved: 'equipment_reserved',
	ReservationNotFound: 'reservation_not_found',
	ReservationNotOwned: 'reservation_not_owned',
	ReservationNotActive: 'reservation_not_active',
	LoanNotFound: 'loan_not_found',
	LoanNotOwned: 'loan_not_owned',
	LoanAlreadyReturned: 'loan_already_returned',
	/** No open loan on this equipment (MCP tools address loans by asset tag). */
	EquipmentNotOnLoan: 'equipment_not_on_loan',
	TypeNotFound: 'type_not_found',
	LocationNotFound: 'location_not_found',
} as const;

export const ErrorCode = { ...COMMON_CODES, ...APP_CODES } as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/** The HTTP status of each code: a code always answers with the same status. */
const STATUS: Record<ErrorCode, number> = {
	// Common
	unauthorized: 401,
	forbidden_manage_required: 403,
	invalid_request: 400,
	validation_failed: 422,
	unsupported_media_type: 415,
	not_found: 404,
	member_not_found: 404,
	people_unconfigured: 409,
	people_unavailable: 503,
	attachment_not_found: 404,
	attachment_too_large: 413,
	attachment_type_unsupported: 415,
	attachment_limit_reached: 409,
	attachment_storage_failed: 502,
	csv_too_large: 413,
	csv_too_many_rows: 400,
	csv_encoding_unknown: 400,
	csv_unclosed_quote: 400,
	csv_empty: 400,
	csv_no_rows: 400,
	csv_missing_columns: 400,
	csv_duplicate_column: 400,
	import_has_errors: 409,
	import_nothing_to_import: 400,
	mcp_tool_not_found: 404,
	internal_error: 500,
	// This app
	equipment_not_found: 404,
	equipment_suspended: 409,
	equipment_not_suspended: 409,
	equipment_version_conflict: 409,
	equipment_on_loan: 409,
	previous_loan_not_returned: 409,
	equipment_reserved: 409,
	reservation_not_found: 404,
	reservation_not_owned: 403,
	reservation_not_active: 409,
	loan_not_found: 404,
	loan_not_owned: 403,
	loan_already_returned: 409,
	equipment_not_on_loan: 409,
	type_not_found: 404,
	location_not_found: 404,
};

/** A business-rule failure: a stable code and its HTTP status (STATUS). */
export class AppError extends Error {
	readonly status: number;
	readonly code: ErrorCode;

	constructor(code: ErrorCode) {
		super(code);
		this.name = 'AppError';
		this.status = STATUS[code];
		this.code = code;
	}
}

/** A CSV file problem, at a line of the file when there is one (`line`). */
export class CsvError extends AppError {
	readonly line: number | null;

	constructor(code: ErrorCode, line: number | null = null) {
		super(code);
		this.name = 'CsvError';
		this.line = line;
	}
}

/**
 * Why a field was rejected, in the parts an app built from this template
 * keeps: request shape, uniqueness, lookups, and person references.
 */
type CommonReason =
	| 'required'
	| 'too_long'
	| 'invalid'
	| 'invalid_date'
	| 'taken'
	| 'not_found'
	/** A person reference (MCP `person`) that matches more than one person; the body then carries `candidates`. */
	| 'ambiguous';

/**
 * Why a field was rejected by this app's own rules (booking and loan times):
 * `invalid_datetime` (not `YYYY-MM-DDTHH:MM`), `step` (not on a 15-minute
 * boundary), `past` (before the current time slot), `before_start` (an end at
 * or before the start), `period_too_long`, `overlap` (another booking or the
 * current loan), `conflict` (a due time that runs into someone else's
 * booking).
 */
type AppReason =
	| 'invalid_datetime'
	| 'step'
	| 'past'
	| 'before_start'
	| 'period_too_long'
	| 'overlap'
	| 'conflict';

/**
 * Why a field was rejected. The frontend turns (field, reason) into a message
 * shown under that field (src/lib/messages.ts).
 */
export type FieldReason = CommonReason | AppReason;

export type FieldErrors = Record<string, FieldReason>;

/** A person an ambiguous name could mean (MCP tools, at most 10). */
export interface PersonCandidate {
	id: string;
	name: string;
	email: string | null;
}

/** Optional data a validation error carries next to `fields`. */
export interface ValidationExtra {
	candidates?: PersonCandidate[];
}

/**
 * Input that failed validation, tied to fields:
 * `{ "error": "validation_failed", "fields": { "assetTag": "taken" } }`,
 * plus `candidates` when a person reference was ambiguous.
 */
export class ValidationError extends AppError {
	readonly fields: FieldErrors;
	readonly extra: ValidationExtra;

	constructor(fields: FieldErrors, extra: ValidationExtra = {}) {
		super(ErrorCode.ValidationFailed);
		this.name = 'ValidationError';
		this.fields = fields;
		this.extra = extra;
	}
}

/**
 * JSON error body `{ "error": "<code>" }` with the code's status and no-store
 * caching, plus `fields` (validation, with `candidates` when there are any) or
 * `line` (a CSV file line) when there are any.
 */
export function errorResponse(
	code: ErrorCode,
	extra: { fields?: FieldErrors; line?: number } & ValidationExtra = {},
): Response {
	return new Response(JSON.stringify({ error: code, ...extra }), {
		status: STATUS[code],
		headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
	});
}
