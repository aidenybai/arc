// Minimal web-standard polyfills (Headers, URL, URLSearchParams, Request,
// Response) so Spark can run on the arc engine, which has no web platform
// globals. Pure JS, string bodies only.

class ArcHeaders {
  #map = new Map<string, string>();

  constructor(init?: Record<string, string> | Array<[string, string]> | ArcHeaders) {
    // Separate variable names per loop: arc's parser currently rejects
    // repeated destructuring names across sibling loops in a constructor.
    if (init instanceof ArcHeaders) {
      for (const [ek, ev] of init.entries()) this.set(ek, ev);
    } else if (Array.isArray(init)) {
      for (const [ak, av] of init) this.append(ak, av);
    } else if (init) {
      for (const ok of Object.keys(init)) this.set(ok, init[ok] as string);
    }
  }

  get(name: string): string | null {
    return this.#map.get(name.toLowerCase()) ?? null;
  }
  set(name: string, value: string): void {
    this.#map.set(name.toLowerCase(), String(value));
  }
  append(name: string, value: string): void {
    const key = name.toLowerCase();
    const existing = this.#map.get(key);
    this.#map.set(key, existing === undefined ? String(value) : existing + ', ' + value);
  }
  has(name: string): boolean {
    return this.#map.has(name.toLowerCase());
  }
  delete(name: string): void {
    this.#map.delete(name.toLowerCase());
  }
  entries(): IterableIterator<[string, string]> {
    return this.#map.entries();
  }
  forEach(fn: (value: string, key: string) => void): void {
    for (const [k, v] of this.#map.entries()) fn(v, k);
  }
}

class ArcURLSearchParams {
  #pairs: Array<[string, string]> = [];

  constructor(init?: string) {
    if (init) {
      const query = init.startsWith('?') ? init.slice(1) : init;
      for (const part of query.split('&')) {
        if (part === '') continue;
        const eq = part.indexOf('=');
        const rawKey = eq === -1 ? part : part.slice(0, eq);
        const rawValue = eq === -1 ? '' : part.slice(eq + 1);
        this.#pairs.push([
          decodeURIComponent(rawKey.replace(/\+/g, ' ')),
          decodeURIComponent(rawValue.replace(/\+/g, ' ')),
        ]);
      }
    }
  }

  get(name: string): string | null {
    const found = this.#pairs.find(([k]) => k === name);
    return found ? found[1] : null;
  }
  getAll(name: string): Array<string> {
    return this.#pairs.filter(([k]) => k === name).map(([, v]) => v);
  }
  has(name: string): boolean {
    return this.#pairs.some(([k]) => k === name);
  }
  toString(): string {
    return this.#pairs
      .map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v))
      .join('&');
  }
}

class ArcURL {
  protocol = 'http:';
  hostname = 'localhost';
  port = '';
  pathname = '/';
  search = '';
  hash = '';

  constructor(input: string, base?: string) {
    let url = input;
    const abs = /^[a-zA-Z][a-zA-Z0-9+.-]*:[/][/]/.test(url);
    if (!abs) {
      if (base === undefined) throw new TypeError('Invalid URL: ' + input);
      const b = new ArcURL(base);
      this.protocol = b.protocol;
      this.hostname = b.hostname;
      this.port = b.port;
      url = url.startsWith('/') ? url : '/' + url;
      this.#parsePath(url);
      return;
    }
    const schemeEnd = url.indexOf('://');
    this.protocol = url.slice(0, schemeEnd + 1);
    let rest = url.slice(schemeEnd + 3);
    let pathStart = rest.length;
    for (let i = 0; i < rest.length; i++) {
      const ch = rest[i];
      if (ch === '/' || ch === '?' || ch === '#') {
        pathStart = i;
        break;
      }
    }
    const hostport = rest.slice(0, pathStart);
    const colon = hostport.indexOf(':');
    if (colon === -1) {
      this.hostname = hostport;
    } else {
      this.hostname = hostport.slice(0, colon);
      this.port = hostport.slice(colon + 1);
    }
    this.#parsePath(rest.slice(pathStart) || '/');
  }

  #parsePath(pathAndQuery: string): void {
    let rest = pathAndQuery;
    const hashIndex = rest.indexOf('#');
    if (hashIndex !== -1) {
      this.hash = rest.slice(hashIndex);
      rest = rest.slice(0, hashIndex);
    }
    const queryIndex = rest.indexOf('?');
    if (queryIndex !== -1) {
      this.search = rest.slice(queryIndex);
      rest = rest.slice(0, queryIndex);
    }
    this.pathname = rest === '' ? '/' : rest;
  }

  get host(): string {
    return this.port === '' ? this.hostname : this.hostname + ':' + this.port;
  }
  get origin(): string {
    return this.protocol + '//' + this.host;
  }
  get searchParams(): ArcURLSearchParams {
    return new ArcURLSearchParams(this.search);
  }
  get href(): string {
    return this.origin + this.pathname + this.search + this.hash;
  }
  toString(): string {
    return this.href;
  }
}

type BodyInit = string | null | undefined;

class ArcBody {
  #body: string;
  bodyUsed = false;

  constructor(body: BodyInit) {
    this.#body = body == null ? '' : String(body);
  }

  async text(): Promise<string> {
    this.bodyUsed = true;
    return this.#body;
  }
  async json(): Promise<unknown> {
    this.bodyUsed = true;
    return JSON.parse(this.#body);
  }
}

interface RequestInitLike {
  method?: string;
  headers?: Record<string, string> | Array<[string, string]> | ArcHeaders;
  body?: BodyInit;
}

class ArcRequest extends ArcBody {
  method: string;
  url: string;
  headers: ArcHeaders;

  constructor(input: string | ArcRequest, init: RequestInitLike = {}) {
    const url = typeof input === 'string' ? input : input.url;
    super(init.body);
    this.url = url;
    this.method = (init.method ?? (typeof input === 'string' ? 'GET' : input.method)).toUpperCase();
    this.headers = new ArcHeaders(init.headers ?? (typeof input === 'string' ? undefined : input.headers));
  }
}

interface ResponseInitLike {
  status?: number;
  statusText?: string;
  headers?: Record<string, string> | Array<[string, string]> | ArcHeaders;
}

class ArcResponse extends ArcBody {
  status: number;
  statusText: string;
  headers: ArcHeaders;

  constructor(body: BodyInit = null, init: ResponseInitLike = {}) {
    super(body);
    this.status = init.status ?? 200;
    this.statusText = init.statusText ?? '';
    this.headers = new ArcHeaders(init.headers);
  }

  get ok(): boolean {
    return this.status >= 200 && this.status < 300;
  }

  static json(data: unknown, init: ResponseInitLike = {}): ArcResponse {
    const res = new ArcResponse(JSON.stringify(data), init);
    res.headers.set('content-type', 'application/json');
    return res;
  }
}

export const installWebStandards = (): void => {
  const g = globalThis as Record<string, unknown>;
  if (typeof g.Headers === 'undefined') g.Headers = ArcHeaders;
  if (typeof g.URLSearchParams === 'undefined') g.URLSearchParams = ArcURLSearchParams;
  if (typeof g.URL === 'undefined') g.URL = ArcURL;
  if (typeof g.Request === 'undefined') g.Request = ArcRequest;
  if (typeof g.Response === 'undefined') g.Response = ArcResponse;
};
