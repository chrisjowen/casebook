// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
import type { UserSummary } from '@casebook/store';

declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			/** The signed-in user, who every permission check acts as. */
			user: UserSummary | undefined;
		}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
