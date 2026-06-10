// Runs the Spark framework on the arc engine and exercises routing,
// middleware, error handling, and sub-apps through app.request().
// Bundle with: bun build arc/spark-on-arc.ts --outfile arc/spark-on-arc.js
// Run with:    gleam run -- framework/arc/spark-on-arc.js  (from repo root)
import { installWebStandards } from './webstd.ts';
import { App, HTTPException, logger, cors } from '../src/index.ts';

installWebStandards();

let pass = 0;
let fail = 0;

const check = (name: string, actual: unknown, expected: unknown): void => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    pass++;
    console.log('PASS ' + name);
  } else {
    fail++;
    console.log('FAIL ' + name + ' — expected ' + e + ', got ' + a);
  }
};

const main = async (): Promise<void> => {
  const app = new App();
  const order: Array<string> = [];

  app.use(async (c, next) => {
    order.push('mw1 in');
    await next();
    order.push('mw1 out');
    c.res?.headers.set('x-powered-by', 'spark-on-arc');
  });
  app.use('/admin/*', async (c, next) => {
    const token = c.req.header('authorization');
    if (token !== 'secret') return c.text('forbidden', 403);
    await next();
  });

  app.get('/', (c) => c.text('hello from spark on arc'));
  app.get('/users/:name', (c) => c.json({ user: c.req.param('name'), greet: c.req.query('greet') }));
  app.get('/files/*path', (c) => c.text('file: ' + c.req.param('path')));
  app.post('/echo', async (c) => {
    const body = await c.req.json<{ msg: string }>();
    return c.json({ echoed: body.msg });
  });
  app.get('/admin/panel', (c) => c.text('admin ok'));
  app.get('/boom', () => {
    throw new HTTPException(418, { message: 'teapot' });
  });
  app.get('/crash', () => {
    throw new Error('kaboom');
  });
  app.notFound((c) => c.text('custom 404', 404));

  const api = new App();
  api.get('/status', (c) => c.json({ ok: true }));
  app.route('/api', api);

  // 1. basic GET
  let res = await app.request('/');
  check('GET / status', res.status, 200);
  check('GET / body', await res.text(), 'hello from spark on arc');
  check('middleware header set', res.headers.get('x-powered-by'), 'spark-on-arc');
  check('onion order', order, ['mw1 in', 'mw1 out']);

  // 2. params + query
  res = await app.request('/users/aiden?greet=hello');
  check('param+query json', await res.json(), { user: 'aiden', greet: 'hello' });
  check('content-type json', res.headers.get('content-type'), 'application/json');

  // 3. URI-encoded param
  res = await app.request('/users/a%20b');
  check('decoded param', await res.json(), { user: 'a b' });

  // 4. wildcard
  res = await app.request('/files/docs/readme.md');
  check('wildcard rest', await res.text(), 'file: docs/readme.md');

  // 5. POST body
  res = await app.request('/echo', { method: 'POST', body: JSON.stringify({ msg: 'beam' }) });
  check('POST echo', await res.json(), { echoed: 'beam' });

  // 6. scoped middleware short-circuit
  res = await app.request('/admin/panel');
  check('admin blocked', res.status, 403);
  res = await app.request('/admin/panel', { headers: { authorization: 'secret' } });
  check('admin allowed', await res.text(), 'admin ok');

  // 7. custom 404
  res = await app.request('/nope');
  check('404 status', res.status, 404);
  check('404 body', await res.text(), 'custom 404');

  // 8. HTTPException
  res = await app.request('/boom');
  check('HTTPException status', res.status, 418);
  check('HTTPException body', await res.text(), 'teapot');

  // 9. uncaught error -> 500
  res = await app.request('/crash');
  check('uncaught error -> 500', res.status, 500);

  // 10. sub-app
  res = await app.request('/api/status');
  check('sub-app route', await res.json(), { ok: true });

  // 11. method routing
  res = await app.request('/echo');
  check('GET on POST-only route -> 404', res.status, 404);

  // 12. built-in middleware: cors preflight
  const corsApp = new App();
  corsApp.use(cors({ origin: 'https://example.com', maxAge: 600 }));
  corsApp.use(logger((line) => order.push(line)));
  corsApp.get('/data', (c) => c.json({ n: 1 }));
  res = await corsApp.request('/data', { method: 'OPTIONS', headers: { origin: 'https://example.com' } });
  check('cors preflight status', res.status, 204);
  check('cors allow-origin', res.headers.get('access-control-allow-origin'), 'https://example.com');
  res = await corsApp.request('/data', { headers: { origin: 'https://example.com' } });
  check('cors on GET', res.headers.get('access-control-allow-origin'), 'https://example.com');
  check('logger ran', /^GET \/data 200 /.test(order[order.length - 1] ?? ''), true);

  console.log('');
  console.log('spark-on-arc results: ' + pass + ' passed, ' + fail + ' failed');
  if (fail > 0) console.log('SUITE FAILED');
  else console.log('SUITE PASSED');
};

await main();
