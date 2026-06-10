# Spark

Spark is a tiny, web-standard web framework for [Bun](https://bun.sh), with an API modeled on [Hono](https://hono.dev). This guide shows you how to build a web server with it, from a one-file hello world to a JSON API with middleware, and how to deploy it to Railway. Spark has zero runtime dependencies and no build step: Bun runs the TypeScript source directly.

## Prerequisites

- Bun 1.0 or later. Install it with `curl -fsSL https://bun.sh/install | bash`.

## Your first server

Create a file called `server.ts`:

```ts
import { App, serve } from './src/index.ts';

const app = new App();

app.get('/', (c) => c.text('Hello, Spark!'));

serve(app);
```

Run it with `bun run server.ts` and open `http://localhost:3000`. The `serve` helper starts a Bun HTTP server on port 3000, or on whatever the `PORT` environment variable says. Every handler receives a context `c` that wraps the incoming request and gives you response shortcuts.

## Routing

Register routes with a method function and a path. Each handler returns a `Response`, usually through one of the context shortcuts:

```ts
app.get('/about', (c) => c.text('About us'));
app.post('/users', (c) => c.json({ created: true }, 201));
app.put('/users/:id', (c) => c.text(`updated ${c.req.param('id')}`));
app.delete('/users/:id', (c) => c.text(`deleted ${c.req.param('id')}`));
```

`get`, `post`, `put`, `delete`, `patch`, `options`, and `head` are available. Use `app.all` to match every method, and `app.on` for custom methods:

```ts
app.all('/health', (c) => c.text('ok'));
app.on('PURGE', '/cache', (c) => c.text('purged'));
```

### Path parameters

A `:name` segment captures one path segment. Read it with `c.req.param`:

```ts
app.get('/posts/:postId/comments/:commentId', (c) => {
  const { postId, commentId } = c.req.param();
  return c.json({ postId, commentId });
});
```

Captured values are URI-decoded, so `/files/hello%20world` gives you `hello world`.

### Wildcards

A `*` segment captures the rest of the path. Name it to choose the param key:

```ts
app.get('/static/*', (c) => c.text(c.req.param('*') ?? ''));
app.get('/files/*path', (c) => c.text(c.req.param('path') ?? ''));
```

### Overlapping routes

When several routes match the same path, the one registered first wins. Register specific routes before general ones:

```ts
app.get('/users/me', (c) => c.text('you'));
app.get('/users/:id', (c) => c.text(c.req.param('id') ?? ''));
```

## Reading the request

`c.req` wraps the web-standard `Request` and adds helpers. The raw request stays available as `c.req.raw`.

```ts
app.get('/search', (c) => {
  const q = c.req.query('q');          // single query value
  const all = c.req.query();           // every query value as an object
  const tags = c.req.queries('tag');   // repeated values, e.g. ?tag=a&tag=b
  const agent = c.req.header('User-Agent');
  return c.json({ q, all, tags, agent });
});
```

Body parsers return promises, so `await` them:

```ts
app.post('/echo', async (c) => {
  const body = await c.req.json();
  return c.json(body);
});
```

`c.req.text()`, `c.req.formData()`, `c.req.arrayBuffer()`, and `c.req.blob()` work the same way.

## Building the response

The context gives you one shortcut per content type. Each accepts an optional status and headers:

```ts
c.text('plain text');
c.json({ any: 'serializable value' });
c.html('<h1>markup</h1>');
c.body(bytes, 200, { 'Content-Type': 'application/octet-stream' });
c.redirect('/login');        // 302
c.redirect('/moved', 301);
```

To set headers or the status before returning, use `c.header` and `c.status`:

```ts
app.get('/custom', (c) => {
  c.header('X-Request-Id', crypto.randomUUID());
  c.status(201);
  return c.text('created');
});
```

You can also return a plain `Response` and skip the shortcuts entirely.

## Middleware

Middleware runs before your handler, and again after it when you put code after `await next()`. Register it with `app.use`:

```ts
app.use(async (c, next) => {
  console.log('before handler');
  await next();
  console.log('after handler, status:', c.res?.status);
});
```

Pass a path pattern to scope middleware to part of your app:

```ts
app.use('/admin/*', async (c, next) => {
  if (c.req.header('Authorization') !== `Bearer ${token}`) {
    return c.text('Unauthorized', 401);
  }
  await next();
});
```

Returning a response from middleware short-circuits the chain: the handler never runs. After `next()` resolves, the downstream response is available as `c.res` and can be replaced.

Use `c.set` and `c.get` to pass values from middleware to handlers:

```ts
app.use(async (c, next) => {
  c.set('user', await lookupUser(c));
  await next();
});

app.get('/profile', (c) => c.json(c.get('user')));
```

### Built-in middleware

Spark ships a request logger and CORS support:

```ts
import { logger, cors } from './src/index.ts';

app.use(logger());
app.use(cors({ origin: ['https://example.com'], credentials: true }));
```

`cors()` with no options allows every origin. Pass an array to allow a fixed list, or a function to decide per request.

## Grouping routes

Build features as separate apps, then mount them under a prefix with `app.route`:

```ts
const books = new App();
books.get('/', (c) => c.json([{ title: 'Dune' }]));
books.get('/:id', (c) => c.json({ id: c.req.param('id') }));

const app = new App();
app.route('/api/books', books);
```

`GET /api/books/42` now reaches the `/:id` handler of the `books` app.

## Error handling

Throw `HTTPException` to return an error response from anywhere in a handler or middleware:

```ts
import { HTTPException } from './src/index.ts';

app.get('/admin', (c) => {
  throw new HTTPException(401, { message: 'Unauthorized' });
});
```

Customize how uncaught errors and missing routes are handled with `onError` and `notFound`:

```ts
app.onError((err, c) => c.json({ error: err.message }, 500));
app.notFound((c) => c.json({ error: 'not found' }, 404));
```

Without these, Spark returns the `HTTPException` response, a plain 500 for other errors, and a plain 404 for unknown paths.

## Testing your app

`app.request` dispatches a request without starting a server, which keeps tests fast:

```ts
import { describe, it, expect } from 'bun:test';

describe('my app', () => {
  it('serves the index', async () => {
    const res = await app.request('/');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('Hello, Spark!');
  });
});
```

Run the framework's own suite with `bun test` in this directory, and the type checker with `bun run typecheck`.

## Deploying to Railway

Railway detects Bun projects and runs them without extra configuration. The `serve` helper already reads the `PORT` environment variable, which is the only contract Railway requires.

1. Add a start script to your `package.json`:

   ```json
   {
     "scripts": {
       "start": "bun run server.ts"
     }
   }
   ```

2. Install the [Railway CLI](https://docs.railway.com/guides/cli) and log in:

   ```sh
   bun add -g @railway/cli
   railway login
   ```

3. Create a project and deploy from your repository root:

   ```sh
   railway init
   railway up
   ```

4. Give the service a public URL:

   ```sh
   railway domain
   ```

Railway builds the service with [Railpack](https://docs.railway.com/reference/railpack), which detects `bun.lock` or a `bun.lockb` file and provisions the Bun runtime automatically. If your repository contains both Bun and Node lockfiles, keep only the Bun one so detection is unambiguous.

To deploy from GitHub instead of the CLI, create a new project at [railway.app/new](https://railway.app/new), pick your repository, and set the root directory to the folder containing your `package.json`. Every push to your default branch then deploys automatically.

If you prefer a pinned, reproducible image, add a `Dockerfile` and Railway will use it instead:

```dockerfile
FROM oven/bun:1
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile
COPY . .
EXPOSE 3000
CMD ["bun", "run", "server.ts"]
```

## API summary

| Export | Purpose |
| --- | --- |
| `App` | The application: routes, middleware, `fetch`, `request` |
| `serve(app, options?)` | Start a Bun HTTP server, returns `{ url, port, stop }` |
| `Context` | Per-request context (`c`) with response shortcuts |
| `HTTPException` | Throwable HTTP error with status and optional response |
| `logger(log?)` | Request logging middleware |
| `cors(options?)` | CORS middleware |
| `Router` | The underlying trie router, usable standalone |
