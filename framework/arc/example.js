// arc/webstd.ts
class ArcHeaders {
  #map = new Map;
  constructor(init) {
    if (init instanceof ArcHeaders) {
      for (const [ek, ev] of init.entries())
        this.set(ek, ev);
    } else if (Array.isArray(init)) {
      for (const [ak, av] of init)
        this.append(ak, av);
    } else if (init) {
      for (const ok of Object.keys(init))
        this.set(ok, init[ok]);
    }
  }
  get(name) {
    return this.#map.get(name.toLowerCase()) ?? null;
  }
  set(name, value) {
    this.#map.set(name.toLowerCase(), String(value));
  }
  append(name, value) {
    const key = name.toLowerCase();
    const existing = this.#map.get(key);
    this.#map.set(key, existing === undefined ? String(value) : existing + ", " + value);
  }
  has(name) {
    return this.#map.has(name.toLowerCase());
  }
  delete(name) {
    this.#map.delete(name.toLowerCase());
  }
  entries() {
    return this.#map.entries();
  }
  forEach(fn) {
    for (const [k, v] of this.#map.entries())
      fn(v, k);
  }
}

class ArcURLSearchParams {
  #pairs = [];
  constructor(init) {
    if (init) {
      const query = init.startsWith("?") ? init.slice(1) : init;
      for (const part of query.split("&")) {
        if (part === "")
          continue;
        const eq = part.indexOf("=");
        const rawKey = eq === -1 ? part : part.slice(0, eq);
        const rawValue = eq === -1 ? "" : part.slice(eq + 1);
        this.#pairs.push([
          decodeURIComponent(rawKey.replace(/\+/g, " ")),
          decodeURIComponent(rawValue.replace(/\+/g, " "))
        ]);
      }
    }
  }
  get(name) {
    const found = this.#pairs.find(([k]) => k === name);
    return found ? found[1] : null;
  }
  getAll(name) {
    return this.#pairs.filter(([k]) => k === name).map(([, v]) => v);
  }
  has(name) {
    return this.#pairs.some(([k]) => k === name);
  }
  toString() {
    return this.#pairs.map(([k, v]) => encodeURIComponent(k) + "=" + encodeURIComponent(v)).join("&");
  }
}

class ArcURL {
  protocol = "http:";
  hostname = "localhost";
  port = "";
  pathname = "/";
  search = "";
  hash = "";
  constructor(input, base) {
    let url = input;
    const abs = /^[a-zA-Z][a-zA-Z0-9+.-]*:[/][/]/.test(url);
    if (!abs) {
      if (base === undefined)
        throw new TypeError("Invalid URL: " + input);
      const b = new ArcURL(base);
      this.protocol = b.protocol;
      this.hostname = b.hostname;
      this.port = b.port;
      url = url.startsWith("/") ? url : "/" + url;
      this.#parsePath(url);
      return;
    }
    const schemeEnd = url.indexOf("://");
    this.protocol = url.slice(0, schemeEnd + 1);
    let rest = url.slice(schemeEnd + 3);
    let pathStart = rest.length;
    for (let i = 0;i < rest.length; i++) {
      const ch = rest[i];
      if (ch === "/" || ch === "?" || ch === "#") {
        pathStart = i;
        break;
      }
    }
    const hostport = rest.slice(0, pathStart);
    const colon = hostport.indexOf(":");
    if (colon === -1) {
      this.hostname = hostport;
    } else {
      this.hostname = hostport.slice(0, colon);
      this.port = hostport.slice(colon + 1);
    }
    this.#parsePath(rest.slice(pathStart) || "/");
  }
  #parsePath(pathAndQuery) {
    let rest = pathAndQuery;
    const hashIndex = rest.indexOf("#");
    if (hashIndex !== -1) {
      this.hash = rest.slice(hashIndex);
      rest = rest.slice(0, hashIndex);
    }
    const queryIndex = rest.indexOf("?");
    if (queryIndex !== -1) {
      this.search = rest.slice(queryIndex);
      rest = rest.slice(0, queryIndex);
    }
    this.pathname = rest === "" ? "/" : rest;
  }
  get host() {
    return this.port === "" ? this.hostname : this.hostname + ":" + this.port;
  }
  get origin() {
    return this.protocol + "//" + this.host;
  }
  get searchParams() {
    return new ArcURLSearchParams(this.search);
  }
  get href() {
    return this.origin + this.pathname + this.search + this.hash;
  }
  toString() {
    return this.href;
  }
}

class ArcBody {
  #body;
  bodyUsed = false;
  constructor(body) {
    this.#body = body == null ? "" : String(body);
  }
  async text() {
    this.bodyUsed = true;
    return this.#body;
  }
  async json() {
    this.bodyUsed = true;
    return JSON.parse(this.#body);
  }
}

class ArcRequest extends ArcBody {
  method;
  url;
  headers;
  constructor(input, init = {}) {
    const url = typeof input === "string" ? input : input.url;
    super(init.body);
    this.url = url;
    this.method = (init.method ?? (typeof input === "string" ? "GET" : input.method)).toUpperCase();
    this.headers = new ArcHeaders(init.headers ?? (typeof input === "string" ? undefined : input.headers));
  }
}

class ArcResponse extends ArcBody {
  status;
  statusText;
  headers;
  constructor(body = null, init = {}) {
    super(body);
    this.status = init.status ?? 200;
    this.statusText = init.statusText ?? "";
    this.headers = new ArcHeaders(init.headers);
  }
  get ok() {
    return this.status >= 200 && this.status < 300;
  }
  static json(data, init = {}) {
    const res = new ArcResponse(JSON.stringify(data), init);
    res.headers.set("content-type", "application/json");
    return res;
  }
}
var installWebStandards = () => {
  const g = globalThis;
  if (typeof g.Headers === "undefined")
    g.Headers = ArcHeaders;
  if (typeof g.URLSearchParams === "undefined")
    g.URLSearchParams = ArcURLSearchParams;
  if (typeof g.URL === "undefined")
    g.URL = ArcURL;
  if (typeof g.Request === "undefined")
    g.Request = ArcRequest;
  if (typeof g.Response === "undefined")
    g.Response = ArcResponse;
};

// src/compose.ts
var compose = (entries, onNoResponse) => {
  return async (c) => {
    let index = -1;
    const dispatch = async (i) => {
      if (i <= index)
        throw new Error("next() called multiple times");
      index = i;
      const entry = entries[i];
      if (!entry) {
        if (!c.finalized && onNoResponse) {
          c.res = await onNoResponse(c);
          c.finalized = true;
        }
        return;
      }
      const [handler, params] = entry;
      c.req.setParams(params);
      const result = await handler(c, () => dispatch(i + 1));
      if (result instanceof Response && !c.finalized) {
        c.res = result;
        c.finalized = true;
      }
    };
    await dispatch(0);
  };
};

// src/context.ts
class Context {
  req;
  res;
  finalized = false;
  #status = 200;
  #headers;
  #store;
  constructor(req) {
    this.req = req;
  }
  set(key, value) {
    this.#store ??= new Map;
    this.#store.set(key, value);
  }
  get(key) {
    return this.#store?.get(key);
  }
  header(name, value) {
    this.#headers ??= new Headers;
    if (value === undefined) {
      this.#headers.delete(name);
    } else {
      this.#headers.set(name, value);
    }
  }
  status(code) {
    this.#status = code;
  }
  body(data, status, headers) {
    return this.#response(data, status, headers);
  }
  text(text, status, headers) {
    return this.#response(text, status, headers, "text/plain; charset=UTF-8");
  }
  json(object, status, headers) {
    return this.#response(JSON.stringify(object), status, headers, "application/json");
  }
  html(html, status, headers) {
    return this.#response(html, status, headers, "text/html; charset=UTF-8");
  }
  redirect(location, status = 302) {
    return this.#response(null, status, { Location: location });
  }
  notFound() {
    return new Response("404 Not Found", { status: 404 });
  }
  #response(data, status, headers, contentType) {
    const finalHeaders = new Headers(this.#headers);
    if (contentType && !finalHeaders.has("Content-Type")) {
      finalHeaders.set("Content-Type", contentType);
    }
    for (const [name, value] of Object.entries(headers ?? {})) {
      finalHeaders.set(name, value);
    }
    return new Response(data, { status: status ?? this.#status, headers: finalHeaders });
  }
}

// src/http-exception.ts
class HTTPException extends Error {
  status;
  res;
  constructor(status = 500, options = {}) {
    super(options.message ?? `HTTP ${status}`, { cause: options.cause });
    this.name = "HTTPException";
    this.status = status;
    this.res = options.res;
  }
  getResponse() {
    return this.res ?? new Response(this.message, { status: this.status });
  }
}

// src/request.ts
class SparkRequest {
  raw;
  #params;
  #url;
  constructor(raw, params = {}) {
    this.raw = raw;
    this.#params = params;
  }
  setParams(params) {
    this.#params = params;
  }
  get method() {
    return this.raw.method;
  }
  get url() {
    return this.raw.url;
  }
  get path() {
    return this.#parsedUrl.pathname;
  }
  get #parsedUrl() {
    this.#url ??= new URL(this.raw.url, "http://localhost");
    return this.#url;
  }
  param(name) {
    if (name === undefined)
      return { ...this.#params };
    return this.#params[name];
  }
  query(name) {
    const search = this.#parsedUrl.searchParams;
    if (name !== undefined)
      return search.get(name) ?? undefined;
    return Object.fromEntries(search.entries());
  }
  queries(name) {
    return this.#parsedUrl.searchParams.getAll(name);
  }
  header(name) {
    return this.raw.headers.get(name) ?? undefined;
  }
  json() {
    return this.raw.json();
  }
  text() {
    return this.raw.text();
  }
  arrayBuffer() {
    return this.raw.arrayBuffer();
  }
  blob() {
    return this.raw.blob();
  }
  formData() {
    return this.raw.formData();
  }
}

// src/router.ts
var createNode = () => ({
  children: new Map,
  routes: []
});
var splitPath = (path) => path.split("/").filter((segment) => segment !== "");

class Router {
  #root = createNode();
  #order = 0;
  add(method, path, handler) {
    let node = this.#root;
    for (const segment of splitPath(path)) {
      if (segment.startsWith(":")) {
        const paramName = segment.slice(1);
        node.paramChild ??= { name: paramName, node: createNode() };
        if (node.paramChild.name !== paramName) {
          throw new Error(`conflicting param names at the same position: ':${node.paramChild.name}' and ':${paramName}'`);
        }
        node = node.paramChild.node;
      } else if (segment.startsWith("*")) {
        const wildcardName = segment.slice(1) || "*";
        node.wildcardChild ??= { name: wildcardName, node: createNode() };
        node = node.wildcardChild.node;
      } else {
        let child = node.children.get(segment);
        if (!child) {
          child = createNode();
          node.children.set(segment, child);
        }
        node = child;
      }
    }
    node.routes.push({ method, handler, order: this.#order++ });
  }
  match(method, path) {
    const segments = splitPath(path);
    const results = [];
    this.#collect(this.#root, segments, 0, method, {}, results);
    results.sort((a, b) => a[2] - b[2]);
    return results.map(([handler, params]) => [handler, params]);
  }
  #collect(node, segments, index, method, params, results) {
    if (index === segments.length) {
      this.#take(node, method, params, results);
      if (node.wildcardChild) {
        this.#take(node.wildcardChild.node, method, { ...params, [node.wildcardChild.name]: "" }, results);
      }
      return;
    }
    const segment = segments[index];
    const staticChild = node.children.get(segment);
    if (staticChild) {
      this.#collect(staticChild, segments, index + 1, method, params, results);
    }
    if (node.paramChild) {
      const nextParams = { ...params, [node.paramChild.name]: decodeURIComponent(segment) };
      this.#collect(node.paramChild.node, segments, index + 1, method, nextParams, results);
    }
    if (node.wildcardChild) {
      const rest = segments.slice(index).join("/");
      this.#take(node.wildcardChild.node, method, { ...params, [node.wildcardChild.name]: rest }, results);
    }
  }
  #take(node, method, params, results) {
    for (const route of node.routes) {
      if (route.method === method || route.method === "ALL") {
        results.push([route.handler, params, route.order]);
      }
    }
  }
}

// src/app.ts
var METHODS = ["get", "post", "put", "delete", "patch", "options", "head"];

class App {
  #router = new Router;
  #errorHandler = (err, c) => {
    if (err instanceof HTTPException)
      return err.getResponse();
    console.error(err);
    return c.text("Internal Server Error", 500);
  };
  #notFoundHandler = (c) => c.notFound();
  constructor() {
    for (const method of METHODS) {
      this[method] = (path, ...handlers) => this.#addRoute(method.toUpperCase(), path, handlers);
    }
  }
  all(path, ...handlers) {
    return this.#addRoute("ALL", path, handlers);
  }
  on(method, path, ...handlers) {
    return this.#addRoute(method.toUpperCase(), path, handlers);
  }
  use(arg, ...handlers) {
    if (typeof arg === "string") {
      return this.#addRoute("ALL", arg, handlers);
    }
    return this.#addRoute("ALL", "*", [arg, ...handlers]);
  }
  route(path, app) {
    const prefix = path.replace(/\/+$/, "");
    for (const { method, path: subPath, handler } of app.#routes()) {
      const sub = subPath.replace(/^\/+/, "");
      this.#router.add(method, `${prefix}/${sub}`, handler);
    }
    return this;
  }
  onError(handler) {
    this.#errorHandler = handler;
    return this;
  }
  notFound(handler) {
    this.#notFoundHandler = handler;
    return this;
  }
  fetch = async (request) => {
    const req = new SparkRequest(request);
    const c = new Context(req);
    try {
      const matched = this.#router.match(request.method, req.path);
      if (matched.length === 0) {
        return await this.#notFoundHandler(c);
      }
      await compose(matched, this.#notFoundHandler)(c);
      return c.res ?? await this.#notFoundHandler(c);
    } catch (err) {
      return await this.#errorHandler(toError(err), c);
    }
  };
  request(input, init) {
    if (input instanceof Request)
      return this.fetch(input);
    const trimmed = input.replace(/^\/+/, "");
    const url = /^https?:[/][/]/.test(input) ? input : `http://localhost/${trimmed}`;
    return this.fetch(new Request(url, init));
  }
  #registered = [];
  #routes() {
    return this.#registered;
  }
  #addRoute(method, path, handlers) {
    for (const handler of handlers) {
      this.#router.add(method, path, handler);
      this.#registered.push({ method, path, handler });
    }
    return this;
  }
}
var toError = (err) => err instanceof Error ? err : new Error(String(err));
// src/middleware/logger.ts
var now = () => typeof performance === "undefined" ? Date.now() : performance.now();
var logger = (log = console.log) => {
  return async (c, next) => {
    const start = now();
    await next();
    const ms = (now() - start).toFixed(1);
    const status = c.res?.status ?? 404;
    log(`${c.req.method} ${c.req.path} ${status} ${ms}ms`);
  };
};
// arc/example.ts
installWebStandards();
var app = new App;
app.use(logger());
app.get("/", (c) => c.text("hello from spark, running on arc!"));
app.get("/users/:name", (c) => c.json({ user: c.req.param("name"), greet: c.req.query("greet") ?? "hi" }));
app.post("/echo", async (c) => {
  const body = await c.req.json();
  return c.json({ echoed: body.msg });
});
app.get("/teapot", () => {
  throw new HTTPException(418, { message: "I am a teapot" });
});
app.notFound((c) => c.text("nothing here", 404));
var show = async (label, res) => {
  const r = await res;
  const body = await r.text();
  console.log(label);
  console.log("  -> " + r.status + " " + body);
};
var main = async () => {
  console.log("spark example app on arc");
  console.log("");
  await show("GET /", app.request("/"));
  await show("GET /users/aiden?greet=hello", app.request("/users/aiden?greet=hello"));
  await show('POST /echo {"msg":"hi arc"}', app.request("/echo", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ msg: "hi arc" })
  }));
  await show("GET /teapot", app.request("/teapot"));
  await show("GET /missing", app.request("/missing"));
};
main();
