// Input limits, named by what they limit. Every check reads them from here:
// the API bodies and query strings (server/http/), the AI assistant tools
// (server/mcp/), the business layer, the CSV import and the forms' `maxlength`.
// Two limits with the same value but a different use have different names, so
// one can change without the other. This module sits outside server/ so the
// screens can import the values.
//
// The messages that state a limit in words (src/lib/messages.ts, the
// attachment list) change with it.

/** Equipment fields: the equipment form, the API, the CSV import and the AI assistant tools. */
export const EQUIPMENT_LIMITS = {
	assetTag: 40,
	name: 120,
	serialNo: 80,
	note: 2000,
} as const;

/** Name of an equipment type or a location. */
export const MASTER_NAME_MAX = 40;

/** Purpose of a booking. */
export const RESERVATION_PURPOSE_MAX = 500;

/** Note of a loan. */
export const LEND_NOTE_MAX = 500;

/** Note of a return. */
export const RETURN_NOTE_MAX = 500;

/** Detail of a suspension (what is wrong with the equipment). */
export const SUSPEND_NOTE_MAX = 500;

/** A person's id sent by a form (the employee picker). */
export const USER_ID_MAX = 200;

/** A booking id sent by a form (the booking a loan picks up). */
export const RESERVATION_ID_MAX = 64;

/**
 * Search term, and any other text in a list query string; longer text is
 * cut. Also the tools' `q` argument.
 */
export const SEARCH_MAX = 100;

/** Equipment one list query may name (`ids`: exporting a selection); more are dropped. */
export const EQUIPMENT_IDS_MAX = 1000;

/** A person named by an AI assistant: a name, an email address or an id. */
export const PERSON_REF_MAX = 200;

/** Rows a list tool returns (`limit`): 20 unless asked, never more than 50. */
export const MCP_LIST_LIMIT = { default: 20, max: 50 } as const;

/** CSV import file: size in bytes and data rows. */
export const IMPORT_BYTES_MAX = 2 * 1024 * 1024;
export const IMPORT_ROWS_MAX = 2000;

/** Imported file name kept in the history (longer is cut). */
export const IMPORT_FILE_NAME_MAX = 200;

/**
 * Attachments: bytes per file (at most the file store's 10 MiB per object;
 * keelson.yaml BODY_SIZE_LIMIT must stay above it) and files per piece of
 * equipment.
 */
export const ATTACHMENT_BYTES_MAX = 10 * 1024 * 1024;
export const ATTACHMENTS_PER_EQUIPMENT_MAX = 20;

/** Attachment file name (longer is cut). */
export const ATTACHMENT_FILE_NAME_MAX = 120;
