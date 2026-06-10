# Spark on arc

Runs the Spark framework on the arc engine. Arc executes the bundled output directly.

## Try it

Run the example app (`example.ts`) on arc:

```sh
bun run example:arc
```

```
spark example app on arc

GET /
  -> 200 hello from spark, running on arc!
GET /users/aiden?greet=hello
  -> 200 {"user":"aiden","greet":"hello"}
POST /echo {"msg":"hi arc"}
  -> 200 {"echoed":"hi arc"}
GET /teapot
  -> 418 I am a teapot
GET /missing
  -> 404 nothing here
```

## Run the test suite

```sh
bun run test:arc
```

This bundles `spark-on-arc.ts` (which imports the real framework source plus the `webstd.ts` polyfills) into a single plain-JS file with `bun build`, then runs it with `gleam run -- framework/arc/spark-on-arc.js`. The suite covers routing, path params, wildcards, query strings, POST bodies, scoped middleware, onion ordering, custom 404s, `HTTPException`, uncaught errors, sub-apps, method routing, CORS preflight, and the logger: 22 checks.

## What webstd.ts provides

Arc implements core ECMAScript (classes, private fields, async/await, `Promise`, `Map`, `Proxy`, `JSON`, destructuring, optional chaining) but no web platform globals. `webstd.ts` installs minimal `Headers`, `URL`, `URLSearchParams`, `Request`, and `Response` (string bodies only) when they are missing, so the same framework code runs unchanged on Bun and arc.

## Arc parser bugs found while porting

These are engine bugs discovered during this work, each with a minimal repro. The framework source works around all three.

1. Reusing a `const` name in sibling blocks inside a class method or constructor throws a false `SyntaxError: Duplicate parameter name`:

   ```js
   class R { add(s) { if (s) { const name = 'a'; } else { const name = 'b'; } } }
   // SyntaxError: Duplicate parameter name 'name' not allowed
   ```

   Also triggered by two `for (const [k, v] of …)` loops in one constructor. The same code in a plain function parses fine.

2. A regex literal ending in an escaped slash directly before the closing delimiter (`…\//`) fails to parse inside a function body, but works at the top level:

   ```js
   function f() { return /ab\/\//.test('ab//'); }
   // SyntaxError: Expected '}' but got end of file
   ```

   Workaround: use a character class, for example `/^https?:[/][/]/`.

3. A regex literal inside a template-literal interpolation fails to parse anywhere:

   ```js
   const x = `a${'b'.replace(/b/, 'c')}`;
   // SyntaxError: Invalid regular expression: missing closing parenthesis
   ```

   Workaround: hoist the regex call into a variable before the template.

Missing runtime APIs encountered: `performance` (logger falls back to `Date.now()`), `TextEncoder`, `queueMicrotask`, and all fetch/web globals (polyfilled here).
