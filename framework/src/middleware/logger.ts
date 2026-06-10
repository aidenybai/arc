import type { Handler } from '../compose.ts';

type LogFn = (message: string) => void;

const now = (): number =>
	typeof performance === 'undefined' ? Date.now() : performance.now();

/** Log each request's method, path, status, and duration. */
export const logger = (log: LogFn = console.log): Handler => {
	return async (c, next) => {
		const start = now();
		await next();
		const ms = (now() - start).toFixed(1);
		const status = c.res?.status ?? 404;
		log(`${c.req.method} ${c.req.path} ${status} ${ms}ms`);
	};
};
