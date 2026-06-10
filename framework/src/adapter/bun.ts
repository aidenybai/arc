import type { App } from '../app.ts';

export interface ServeOptions {
	port?: number;
	hostname?: string;
}

export interface SparkServer {
	port: number;
	hostname: string;
	url: string;
	stop(): void;
}

/**
 * Start a Bun HTTP server for the given app. Reads `PORT` from the
 * environment when no port is passed, matching what hosts like Railway
 * expect.
 */
export const serve = (app: App, options: ServeOptions = {}): SparkServer => {
	if (typeof Bun === 'undefined') {
		throw new Error('serve() requires the Bun runtime — run this file with `bun`');
	}
	const port = options.port ?? (process.env.PORT ? Number(process.env.PORT) : 3000);
	const server = Bun.serve({
		port,
		hostname: options.hostname,
		fetch: app.fetch,
	});
	return {
		port: server.port ?? port,
		hostname: server.hostname ?? options.hostname ?? 'localhost',
		url: server.url.toString(),
		stop: () => server.stop(true),
	};
};
