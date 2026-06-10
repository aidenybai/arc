export interface HTTPExceptionOptions {
	message?: string;
	res?: Response;
	cause?: unknown;
}

/**
 * Throwable HTTP error. When thrown from a handler or middleware, the app
 * converts it into a response with the given status (unless a custom
 * `onError` handler intercepts it first).
 */
export class HTTPException extends Error {
	readonly status: number;
	readonly res?: Response;

	constructor(status = 500, options: HTTPExceptionOptions = {}) {
		super(options.message ?? `HTTP ${status}`, { cause: options.cause });
		this.name = 'HTTPException';
		this.status = status;
		this.res = options.res;
	}

	getResponse(): Response {
		return this.res ?? new Response(this.message, { status: this.status });
	}
}
