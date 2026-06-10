import { compose, type Handler } from './compose.ts';
import { Context } from './context.ts';
import { HTTPException } from './http-exception.ts';
import { SparkRequest } from './request.ts';
import { Router, type Matched } from './router.ts';

export type ErrorHandler = (err: Error, c: Context) => Response | Promise<Response>;
export type NotFoundHandler = (c: Context) => Response | Promise<Response>;

const METHODS = ['get', 'post', 'put', 'delete', 'patch', 'options', 'head'] as const;
type Method = (typeof METHODS)[number];

type RouteFn = {
	(path: string, ...handlers: Handler[]): App;
};

export interface App extends Record<Method, RouteFn> {}

/**
 * The application. Register routes and middleware, then hand `app.fetch` to
 * any web-standard server (e.g. `Bun.serve({ fetch: app.fetch })`), or
 * `export default app` and let Bun serve it directly.
 */
export class App {
	#router = new Router<Handler>();
	#errorHandler: ErrorHandler = (err, c) => {
		if (err instanceof HTTPException) return err.getResponse();
		console.error(err);
		return c.text('Internal Server Error', 500);
	};
	#notFoundHandler: NotFoundHandler = (c) => c.notFound();

	constructor() {
		for (const method of METHODS) {
			this[method] = (path: string, ...handlers: Handler[]) =>
				this.#addRoute(method.toUpperCase(), path, handlers);
		}
	}

	/** Register a route for every HTTP method. */
	all(path: string, ...handlers: Handler[]): App {
		return this.#addRoute('ALL', path, handlers);
	}

	/** Register a custom HTTP method (e.g. `PURGE`). */
	on(method: string, path: string, ...handlers: Handler[]): App {
		return this.#addRoute(method.toUpperCase(), path, handlers);
	}

	/**
	 * Register middleware. `app.use(mw)` runs on every request;
	 * `app.use('/admin/*', mw)` runs on matching paths only.
	 */
	use(arg: string | Handler, ...handlers: Handler[]): App {
		if (typeof arg === 'string') {
			return this.#addRoute('ALL', arg, handlers);
		}
		return this.#addRoute('ALL', '*', [arg, ...handlers]);
	}

	/** Mount a sub-app under a path prefix. */
	route(path: string, app: App): App {
		const prefix = path.replace(/\/+$/, '');
		for (const { method, path: subPath, handler } of app.#routes()) {
			const sub = subPath.replace(/^\/+/, '');
			this.#router.add(method, `${prefix}/${sub}`, handler);
		}
		return this;
	}

	onError(handler: ErrorHandler): App {
		this.#errorHandler = handler;
		return this;
	}

	notFound(handler: NotFoundHandler): App {
		this.#notFoundHandler = handler;
		return this;
	}

	/** Web-standard fetch handler. */
	fetch = async (request: Request): Promise<Response> => {
		const req = new SparkRequest(request);
		const c = new Context(req);
		try {
			const matched: Matched<Handler>[] = this.#router.match(request.method, req.path);
			if (matched.length === 0) {
				return await this.#notFoundHandler(c);
			}
			await compose(matched, this.#notFoundHandler)(c);
			return c.res ?? (await this.#notFoundHandler(c));
		} catch (err) {
			return await this.#errorHandler(toError(err), c);
		}
	};

	/** Dispatch a request without a server — handy in tests. */
	request(input: string | Request, init?: RequestInit): Promise<Response> {
		if (input instanceof Request) return this.fetch(input);
		const trimmed = input.replace(/^\/+/, '');
		const url = /^https?:[/][/]/.test(input) ? input : `http://localhost/${trimmed}`;
		return this.fetch(new Request(url, init));
	}

	#registered: Array<{ method: string; path: string; handler: Handler }> = [];

	#routes() {
		return this.#registered;
	}

	#addRoute(method: string, path: string, handlers: Handler[]): App {
		for (const handler of handlers) {
			this.#router.add(method, path, handler);
			this.#registered.push({ method, path, handler });
		}
		return this;
	}
}

const toError = (err: unknown): Error => (err instanceof Error ? err : new Error(String(err)));
