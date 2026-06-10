import type { Params } from './router.ts';

/**
 * Wrapper around the incoming web-standard `Request` adding route params and
 * query helpers. The raw request stays available as `raw`.
 */
export class SparkRequest {
	raw: Request;
	#params: Params;
	#url?: URL;

	constructor(raw: Request, params: Params = {}) {
		this.raw = raw;
		this.#params = params;
	}

	/** @internal — updated by the app before each matched handler runs. */
	setParams(params: Params): void {
		this.#params = params;
	}

	get method(): string {
		return this.raw.method;
	}

	get url(): string {
		return this.raw.url;
	}

	get path(): string {
		return this.#parsedUrl.pathname;
	}

	get #parsedUrl(): URL {
		this.#url ??= new URL(this.raw.url, 'http://localhost');
		return this.#url;
	}

	param(name: string): string | undefined;
	param(): Params;
	param(name?: string): string | undefined | Params {
		if (name === undefined) return { ...this.#params };
		return this.#params[name];
	}

	query(name: string): string | undefined;
	query(): Record<string, string>;
	query(name?: string): string | undefined | Record<string, string> {
		const search = this.#parsedUrl.searchParams;
		if (name !== undefined) return search.get(name) ?? undefined;
		return Object.fromEntries(search.entries());
	}

	queries(name: string): string[] {
		return this.#parsedUrl.searchParams.getAll(name);
	}

	header(name: string): string | undefined {
		return this.raw.headers.get(name) ?? undefined;
	}

	json<T = unknown>(): Promise<T> {
		return this.raw.json() as Promise<T>;
	}

	text(): Promise<string> {
		return this.raw.text();
	}

	arrayBuffer(): Promise<ArrayBuffer> {
		return this.raw.arrayBuffer();
	}

	blob(): Promise<Blob> {
		return this.raw.blob();
	}

	formData(): Promise<FormData> {
		return this.raw.formData();
	}
}
