import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['test/**/*.test.ts'],
		// Each suite seeds the whole demo world through the case runtime.
		testTimeout: 30_000,
		hookTimeout: 120_000,
		globalSetup: ['test/global-setup.ts']
	}
});
