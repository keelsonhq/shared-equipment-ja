import type { Client } from '@libsql/client';
import type { Actor } from '#lib/server/auth/actor.ts';
import { NAME_HONORIFICS } from '#lib/server/content.ts';
import { issuablePeople, type Person } from '#lib/server/domain/directory.ts';
import { AppError, ErrorCode, ValidationError } from '#lib/server/errors.ts';
import { normalizeName } from './args.ts';

// Who an AI assistant means by "Suzuki" or "suzuki@example.com". Tools take a
// person as free text (`person`); this turns it into one workspace member, or
// a field error the assistant can act on: `not_found`, or `ambiguous` with
// the candidates in the body so it can ask the user which one.
//
// Oneself needs no directory. Anyone else comes from the Directory API
// through issuablePeople, which is for admins only (members act for themselves).

/** At most this many candidates are returned for an ambiguous reference. */
const MAX_CANDIDATES = 10;

export interface PersonRef {
	id: string;
	name: string;
	email: string | null;
}

// Email (whole address) -> exact name -> part of a name or an email.
function matching(people: Person[], ref: string): Person[] {
	const key = normalizeName(ref);
	if (key === '') {
		return [];
	}
	const byEmail = people.filter((p) => p.email !== null && normalizeName(p.email) === key);
	if (byEmail.length > 0) {
		return byEmail;
	}
	const byName = people.filter((p) => normalizeName(p.name) === key);
	if (byName.length > 0) {
		return byName;
	}
	return people.filter(
		(p) => normalizeName(p.name).includes(key) || normalizeName(p.email ?? '').includes(key),
	);
}

function withoutHonorific(ref: string): string | null {
	const trimmed = ref.trim();
	const suffix = NAME_HONORIFICS.find((h) => trimmed.endsWith(h) && trimmed.length > h.length);
	return suffix ? trimmed.slice(0, -suffix.length) : null;
}

function self(actor: Actor): PersonRef {
	return { id: actor.id, name: actor.name, email: actor.email };
}

/**
 * Resolve a name or email to one person. `field` is the argument the
 * reference came in (for the field error).
 *
 * - The caller's own email (or, for a member, their own name) is the caller.
 * - Anyone else needs the manage grant (`forbidden_manage_required`) and the
 *   directory (`people_unconfigured` / `people_unavailable`).
 */
export async function resolvePersonRef(
	_db: Client,
	actor: Actor,
	ref: string,
	field = 'person',
): Promise<PersonRef> {
	const key = normalizeName(ref);
	if (actor.email !== null && normalizeName(actor.email) === key) {
		return self(actor);
	}
	// A member can only mean themselves; an admin's own name may also be
	// someone else's, so it goes through the directory below.
	if (!actor.isAdmin && normalizeName(actor.name) === key) {
		return self(actor);
	}
	const { state, people: items } = await issuablePeople(actor);
	if (state === 'unconfigured') {
		throw new AppError(ErrorCode.PeopleUnconfigured);
	}
	if (state === 'unavailable') {
		throw new AppError(ErrorCode.PeopleUnavailable);
	}
	let found = matching(items, ref);
	const bare = found.length === 0 ? withoutHonorific(ref) : null;
	if (bare !== null) {
		found = matching(items, bare);
	}
	if (found.length === 1) {
		return { id: found[0].id, name: found[0].name, email: found[0].email };
	}
	if (found.length === 0) {
		if (normalizeName(actor.name) === key) {
			return self(actor);
		}
		throw new ValidationError({ [field]: 'not_found' });
	}
	throw new ValidationError(
		{ [field]: 'ambiguous' },
		{
			candidates: found
				.slice(0, MAX_CANDIDATES)
				.map((p) => ({ id: p.id, name: p.name, email: p.email })),
		},
	);
}
