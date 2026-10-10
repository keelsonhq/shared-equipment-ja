import type { Session } from '#lib/server/auth/session.ts';
import { errorCode, getJson } from '#lib/api.ts';

// The signed-in user and app setup (GET /api/me), loaded once by the root
// layout and shared by every page.
export const session = $state<{ me: Session | null; error: string | null; loadedAt: number }>({
	me: null,
	error: null,
	loadedAt: 0,
});

export async function loadSession(): Promise<void> {
	try {
		session.me = await getJson<Session>('/api/me');
		session.loadedAt = Date.now();
		session.error = null;
	} catch (err) {
		session.me = null;
		session.error = errorCode(err);
	}
}

/**
 * The server's wall-clock time now (`YYYY-MM-DDTHH:MM`, the app's time zone):
 * its `now` when the session loaded plus the minutes since. Dialogs read it
 * when they open, so defaults and checks match the server even when the
 * browser is in another time zone.
 */
export function serverNow(): string {
	const me = session.me;
	if (!me) {
		return '';
	}
	const d = new Date(`${me.now}:00Z`);
	d.setUTCMinutes(d.getUTCMinutes() + Math.floor((Date.now() - session.loadedAt) / 60_000));
	return d.toISOString().slice(0, 16);
}
