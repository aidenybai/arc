// A small Spark app running on the arc engine.
// Run from framework/:  bun run example:arc
// (bundles this file with bun build, then executes it with `gleam run`)
import { installWebStandards } from './webstd.ts';
import { App, HTTPException, logger } from '../src/index.ts';

installWebStandards();

const app = new App();

app.use(logger());

app.get('/', (c) => c.text('hello from spark, running on arc!'));
app.get('/users/:name', (c) =>
  c.json({ user: c.req.param('name'), greet: c.req.query('greet') ?? 'hi' })
);
app.post('/echo', async (c) => {
  const body = await c.req.json<{ msg: string }>();
  return c.json({ echoed: body.msg });
});
app.get('/teapot', () => {
  throw new HTTPException(418, { message: 'I am a teapot' });
});
app.notFound((c) => c.text('nothing here', 404));

const show = async (label: string, res: Promise<Response>): Promise<void> => {
  const r = await res;
  const body = await r.text();
  console.log(label);
  console.log('  -> ' + r.status + ' ' + body);
};

const main = async (): Promise<void> => {
  console.log('spark example app on arc');
  console.log('');
  await show('GET /', app.request('/'));
  await show('GET /users/aiden?greet=hello', app.request('/users/aiden?greet=hello'));
  await show(
    'POST /echo {"msg":"hi arc"}',
    app.request('/echo', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ msg: 'hi arc' }),
    })
  );
  await show('GET /teapot', app.request('/teapot'));
  await show('GET /missing', app.request('/missing'));
};

void main();
