import type { Actor } from './actor.ts';
import { localDevelopment } from '#lib/server/env.ts';
import { nowLocal } from '#lib/server/dates.ts';

/** GET /api/me — who the caller is. */
export interface Session {
	userId: string;
	name: string;
	email: string | null;
	/** Profile image from the directory (null without one; never stored). */
	imageUrl: string | null;
	isAdmin: boolean;
	/** Running under `pnpm dev` (the UI shows the local-preview banner). */
	localPreview: boolean;
	/** The server's business date, so the browser defaults match validation. */
	today: string;
	/** The server's wall-clock time (`YYYY-MM-DDTHH:MM`, app time zone). */
	now: string;
}

export function getSession(actor: Actor, imageUrl: string | null): Session {
	const now = nowLocal();
	return {
		userId: actor.id,
		name: actor.name,
		email: actor.email,
		imageUrl,
		isAdmin: actor.isAdmin,
		localPreview: localDevelopment(),
		today: now.slice(0, 10),
		now,
	};
}
