import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['test/**/*.test.ts'],
		// The case runtime tests seed a whole demo world through the runtime, query by query.
		testTimeout: 30_000,
		hookTimeout: 120_000,
		globalSetup: ['test/global-setup.ts']
	}
});
