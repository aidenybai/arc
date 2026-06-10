import type { Handler } from '../compose.ts';

export interface CORSOptions {
	origin?: string | string[] | ((origin: string) => string | undefined);
	allowMethods?: string[];
	allowHeaders?: string[];
	exposeHeaders?: string[];
	maxAge?: number;
	credentials?: boolean;
}

const DEFAULT_METHODS = ['GET', 'HEAD', 'PUT', 'POST', 'DELETE', 'PATCH'];

/** Cross-Origin Resource Sharing middleware. Defaults to `origin: '*'`. */
export const cors = (options: CORSOptions = {}): Handler => {
	const resolveOrigin = (requestOrigin: string): string | undefined => {
		const { origin = '*' } = options;
		if (typeof origin === 'string') return origin;
		if (Array.isArray(origin)) {
			return origin.includes(requestOrigin) ? requestOrigin : undefined;
		}
		return origin(requestOrigin);
	};

	return async (c, next) => {
		const allowOrigin = resolveOrigin(c.req.header('Origin') ?? '');
		const set = (name: string, value: string) => c.header(name, value);

		if (allowOrigin) set('Access-Control-Allow-Origin', allowOrigin);
		if (allowOrigin && allowOrigin !== '*') set('Vary', 'Origin');
		if (options.credentials) set('Access-Control-Allow-Credentials', 'true');
		if (options.exposeHeaders?.length) {
			set('Access-Control-Expose-Headers', options.exposeHeaders.join(','));
		}

		if (c.req.method === 'OPTIONS') {
			if (options.maxAge !== undefined) set('Access-Control-Max-Age', String(options.maxAge));
			set('Access-Control-Allow-Methods', (options.allowMethods ?? DEFAULT_METHODS).join(','));
			const allowHeaders = options.allowHeaders?.length
				? options.allowHeaders.join(',')
				: c.req.header('Access-Control-Request-Headers');
			if (allowHeaders) set('Access-Control-Allow-Headers', allowHeaders);
			return c.body(null, 204);
		}

		await next();
		if (c.res && allowOrigin && !c.res.headers.has('Access-Control-Allow-Origin')) {
			const res = new Response(c.res.body, c.res);
			res.headers.set('Access-Control-Allow-Origin', allowOrigin);
			if (options.credentials) res.headers.set('Access-Control-Allow-Credentials', 'true');
			c.res = res;
		}
	};
};
