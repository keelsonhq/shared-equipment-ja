-- 0001_init: the initial schema. Data model and the reasons behind it:
-- REQUIREMENTS.md section 3.
--
-- Times of reservations and loans are wall-clock times in APP_TIME_ZONE,
-- written as `YYYY-MM-DDTHH:MM` (fixed width, so string comparison is time
-- order). Operation timestamps (created_at, events.at, ...) are ISO-8601 UTC.
--
-- Statement rule (see CUSTOMIZE.md): a statement ends with ";" at the end of
-- a line. Do not put ";" anywhere else (no triggers).

CREATE TABLE equipment_types (
	id         INTEGER PRIMARY KEY AUTOINCREMENT,
	name       TEXT NOT NULL UNIQUE,
	active     INTEGER NOT NULL DEFAULT 1,
	sort_order INTEGER NOT NULL DEFAULT 0,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL
);

-- Where a piece of equipment is kept when nobody has it.
CREATE TABLE locations (
	id         INTEGER PRIMARY KEY AUTOINCREMENT,
	name       TEXT NOT NULL UNIQUE,
	active     INTEGER NOT NULL DEFAULT 1,
	sort_order INTEGER NOT NULL DEFAULT 0,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL
);

-- A piece of equipment never stores who has it or who booked it: the loan row
-- with returned_at IS NULL is the current borrower, and the reservations with
-- status 'active' are the bookings.
CREATE TABLE equipment (
	id               INTEGER PRIMARY KEY AUTOINCREMENT,
	asset_tag        TEXT NOT NULL UNIQUE,
	name             TEXT NOT NULL,
	type_id          INTEGER REFERENCES equipment_types (id),
	serial_no        TEXT,
	location_id      INTEGER REFERENCES locations (id),
	note             TEXT,
	suspended_reason TEXT CHECK (suspended_reason IN ('repair', 'broken', 'lost', 'other')),
	suspended_note   TEXT,
	version          INTEGER NOT NULL DEFAULT 1,
	created_at       TEXT NOT NULL,
	updated_at       TEXT NOT NULL
);

CREATE INDEX idx_equipment_type ON equipment (type_id);

CREATE INDEX idx_equipment_location ON equipment (location_id);

CREATE INDEX idx_equipment_name ON equipment (name);

-- A booking of [starts_at, ends_at) (half-open: an end equal to the next
-- start does not overlap). user_name / user_email are snapshots taken when
-- the booking was made. No unique index can express "no overlap": the guarded
-- INSERT in src/lib/server/domain/reservations.ts does, inside one write
-- transaction.
CREATE TABLE reservations (
	id                TEXT PRIMARY KEY,
	equipment_id      INTEGER NOT NULL REFERENCES equipment (id),
	user_id           TEXT NOT NULL,
	user_name         TEXT NOT NULL,
	user_email        TEXT,
	starts_at         TEXT NOT NULL,
	ends_at           TEXT NOT NULL,
	purpose           TEXT,
	status            TEXT NOT NULL DEFAULT 'active'
		CHECK (status IN ('active', 'cancelled', 'fulfilled')),
	booked_by_id      TEXT NOT NULL,
	booked_by_name    TEXT NOT NULL,
	cancelled_at      TEXT,
	cancelled_by_id   TEXT,
	cancelled_by_name TEXT,
	loan_id           TEXT,
	created_at        TEXT NOT NULL,
	updated_at        TEXT NOT NULL,
	CHECK (ends_at > starts_at)
);

CREATE INDEX idx_reservations_equipment ON reservations (equipment_id, status, starts_at);

CREATE INDEX idx_reservations_user ON reservations (user_id, starts_at);

CREATE INDEX idx_reservations_starts ON reservations (status, starts_at);

-- One row per hand-over. returned_at IS NULL means "out now". Names and
-- emails are snapshots, so the ledger stays readable after people leave.
CREATE TABLE loans (
	id                   TEXT PRIMARY KEY,
	equipment_id         INTEGER NOT NULL REFERENCES equipment (id),
	user_id              TEXT NOT NULL,
	user_name            TEXT NOT NULL,
	user_email           TEXT,
	reservation_id       TEXT,
	lent_at              TEXT NOT NULL,
	due_at               TEXT NOT NULL,
	note                 TEXT,
	lent_by_id           TEXT NOT NULL,
	lent_by_name         TEXT NOT NULL,
	returned_at          TEXT,
	return_kind          TEXT CHECK (return_kind IN ('returned', 'collected')),
	returned_by_id       TEXT,
	returned_by_name     TEXT,
	return_note          TEXT,
	return_location_id   INTEGER,
	return_location_name TEXT,
	created_at           TEXT NOT NULL,
	updated_at           TEXT NOT NULL
);

-- The double-loan guarantee: at most one open loan per piece of equipment.
CREATE UNIQUE INDEX ux_loans_open_equipment ON loans (equipment_id) WHERE returned_at IS NULL;

CREATE INDEX idx_loans_user ON loans (user_id, returned_at);

CREATE INDEX idx_loans_equipment ON loans (equipment_id, lent_at);

CREATE INDEX idx_loans_due ON loans (returned_at, due_at);

-- History. Equipment and person fields are snapshots for the same reason as
-- on loans. detail is a JSON object (diffs, periods, reason, note).
CREATE TABLE events (
	id                TEXT PRIMARY KEY,
	at                TEXT NOT NULL,
	kind              TEXT NOT NULL CHECK (kind IN ('create', 'edit', 'suspend', 'resume',
		'reserve', 'cancel', 'lend', 'extend', 'return', 'import')),
	equipment_id      INTEGER,
	equipment_tag     TEXT,
	equipment_name    TEXT,
	reservation_id    TEXT,
	loan_id           TEXT,
	subject_user_id   TEXT,
	subject_user_name TEXT,
	actor_id          TEXT NOT NULL,
	actor_name        TEXT NOT NULL,
	detail            TEXT
);

CREATE INDEX idx_events_at ON events (at);

CREATE INDEX idx_events_equipment ON events (equipment_id, at);

CREATE INDEX idx_events_subject ON events (subject_user_id, at);

-- Photos and manuals of a piece of equipment. The bytes live in the platform
-- file store under file_key (src/lib/server/domain/attachments.ts).
CREATE TABLE attachments (
	id               TEXT PRIMARY KEY,
	equipment_id     INTEGER NOT NULL REFERENCES equipment (id),
	file_key         TEXT NOT NULL,
	file_name        TEXT NOT NULL,
	content_type     TEXT NOT NULL,
	size             INTEGER NOT NULL,
	uploaded_by_id   TEXT NOT NULL,
	uploaded_by_name TEXT NOT NULL,
	created_at       TEXT NOT NULL
);

CREATE INDEX idx_attachments_equipment ON attachments (equipment_id, created_at);

-- Return reminders sent by the cron job (src/lib/server/jobs/return-reminder.ts).
-- One row per (loan, kind, due date): running the job again, or by hand,
-- never sends the same reminder twice, and a changed due date makes a new key.
CREATE TABLE notifications (
	id              TEXT PRIMARY KEY,
	loan_id         TEXT NOT NULL REFERENCES loans (id),
	kind            TEXT NOT NULL CHECK (kind IN ('due_today', 'overdue')),
	target_date     TEXT NOT NULL,
	recipient_email TEXT,
	status          TEXT NOT NULL CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'skipped')),
	attempts        INTEGER NOT NULL DEFAULT 0,
	last_error      TEXT,
	sent_at         TEXT,
	created_at      TEXT NOT NULL,
	updated_at      TEXT NOT NULL,
	UNIQUE (loan_id, kind, target_date)
);

CREATE INDEX idx_notifications_status ON notifications (status, updated_at);
