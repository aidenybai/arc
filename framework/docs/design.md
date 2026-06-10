# Design notes

This page explains the two structural decisions behind Spark: running TypeScript directly instead of compiling it, and copying Hono's web-standard architecture. Read it if you want to change the framework, not to use it.

## No build step: Bun runs the source

The framework had two candidate strategies for executing TypeScript:

- **esbuild**: compile `src/` to JavaScript before running. Fast, but it adds a dependency, an artifact directory, a watch pipeline, and source-map indirection in stack traces.
- **Type stripping**: run the `.ts` source directly. Bun does this natively, and Node 22.6+ does it behind `--experimental-strip-types`.

Spark uses type stripping on Bun. The source is the artifact: stack traces point at the file you edited, there is no `dist/` to stale-cache, and `bun run server.ts` is the entire toolchain. The cost is a syntax constraint: types must be erasable, so no `enum`, no `namespace` with values, and no constructor parameter properties. The `tsconfig.json` enforces this with `"erasableSyntaxOnly": true`, and `bun run typecheck` fails on violations. Imports use explicit `.ts` extensions so the module graph resolves without rewriting.

## Web-standard core, runtime-specific edge

Every layer of Spark below `serve` speaks only WHATWG `Request` and `Response`. `App.fetch` has the signature `(Request) => Promise<Response>`, which is the interface Bun, Deno, Cloudflare Workers, and Node (via adapter) all converge on. Only `src/adapter/bun.ts` knows Bun exists, so porting to another runtime means writing one file.

This is the same shape as Hono, and it is what makes `app.request('/path')` work in tests with no server, no port, and no mocking.

## Router

The router is a trie keyed by path segment with three child kinds per node: static (a `Map`), one `:param` child, and one `*` wildcard child. `match` walks all three branches and returns every matching handler with its own captured params, sorted by registration order.

Returning all matches, rather than the single best one, is what makes middleware fall out of the routing model: `app.use('/admin/*', mw)` is a route like any other, and registration order alone decides execution order. The dispatcher (`compose`) then runs the matched handlers as an onion: each middleware calls `next()` to descend, and code after `next()` sees the downstream response in `c.res`. The first handler to produce a `Response` finalizes the context, and later matches only run if something upstream keeps calling `next()`.
