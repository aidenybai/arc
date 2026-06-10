import { SparkRequest } from './request.ts';

/**
 * Per-request context passed to every handler and middleware. Holds the
 * wrapped request, pending response headers/status, and a `Map`-like store
 * for passing values between middleware (`set`/`get`).
 */
export class Context {
	req: SparkRequest;
	/** Set by middleware that ran `await next()` — the downstream response. */
	res: Response | undefined;
	finalized = false;

	#status = 200;
	#headers?: Headers;
	#store?: Map<string, unknown>;

	constructor(req: SparkRequest) {
		this.req = req;
	}

	set(key: string, value: unknown): void {
		this.#store ??= new Map();
		this.#store.set(key, value);
	}

	get<T = unknown>(key: string): T | undefined {
		return this.#store?.get(key) as T | undefined;
	}

	/** Set a header on the upcoming response. Pass `undefined` to remove. */
	header(name: string, value: string | undefined): void {
		this.#headers ??= new Headers();
		if (value === undefined) {
			this.#headers.delete(name);
		} else {
			this.#headers.set(name, value);
		}
	}

	/** Set the status code used by `text`/`json`/`html`/`body` shortcuts. */
	status(code: number): void {
		this.#status = code;
	}

	body(data: BodyInit | null, status?: number, headers?: Record<string, string>): Response {
		return this.#response(data, status, headers);
	}

	text(text: string, status?: number, headers?: Record<string, string>): Response {
		return this.#response(text, status, headers, 'text/plain; charset=UTF-8');
	}

	json(object: unknown, status?: number, headers?: Record<string, string>): Response {
		return this.#response(JSON.stringify(object), status, headers, 'application/json');
	}

	html(html: string, status?: number, headers?: Record<string, string>): Response {
		return this.#response(html, status, headers, 'text/html; charset=UTF-8');
	}

	redirect(location: string, status = 302): Response {
		return this.#response(null, status, { Location: location });
	}

	notFound(): Response {
		return new Response('404 Not Found', { status: 404 });
	}

	#response(
		data: BodyInit | null,
		status?: number,
		headers?: Record<string, string>,
		contentType?: string,
	): Response {
		const finalHeaders = new Headers(this.#headers);
		if (contentType && !finalHeaders.has('Content-Type')) {
			finalHeaders.set('Content-Type', contentType);
		}
		for (const [name, value] of Object.entries(headers ?? {})) {
			finalHeaders.set(name, value);
		}
		return new Response(data, { status: status ?? this.#status, headers: finalHeaders });
	}
}
