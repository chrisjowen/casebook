// `pnpm dev:mcp`: the MCP endpoint with the dev sign-in, on http://localhost:5190/mcp by default.
// Development only: the dev authorization server signs anyone in as any demo user.
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { localhostAllowedHostnames } from '@modelcontextprotocol/server';
import { createDb, filesDirectory, localFileStore } from '@casebook/store';
import { devAuthorizationServer } from '../auth/dev-server.js';
import { casebookMcpApp, nodeListener } from '../http.js';

// Like the store's seed: read the repository root .env when present.
const rootEnv = fileURLToPath(new URL('../../../../.env', import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

if (process.env.NODE_ENV === 'production') {
	console.error(
		'The casebook MCP dev sign-in is for development only; it will not run in production.'
	);
	process.exit(1);
}
const url = process.env.DATABASE_URL;
if (!url) {
	console.error('DATABASE_URL is not set; copy .env.example to .env at the repository root.');
	process.exit(1);
}

const port = Number(process.env.CASEBOOK_MCP_PORT ?? 5190);
const host = process.env.CASEBOOK_MCP_HOST ?? '127.0.0.1';
const origin = new URL(process.env.CASEBOOK_MCP_URL ?? `http://localhost:${port}`);
const resource = new URL('/mcp', origin);

const db = createDb(url);
const files = filesDirectory();
const report = (error: Error) => console.error(`casebook MCP: ${error.message}`);
const app = casebookMcpApp({
	db,
	files: localFileStore(files),
	signIn: devAuthorizationServer({ db, issuer: origin, resource }),
	resource,
	allowedHosts: [...localhostAllowedHostnames(), origin.hostname],
	onerror: report
});
const server = createServer(nodeListener(app, report));

server.listen(port, host, () => {
	console.log(`casebook MCP server on ${resource.href} (dev sign-in with the demo users)`);
	console.log(`Case files are read from and written to ${files}.`);
	console.log(
		`Connect Claude Code with: claude mcp add --transport http casebook ${resource.href}`
	);
});

const stop = () => {
	server.close();
	void app.close().finally(() => db.$client.end());
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
