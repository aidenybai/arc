import { App, serve, logger } from '../src/index.ts';

const app = new App();

app.use(logger());

app.get('/', (c) => c.text('Hello, Spark!'));

app.get('/users/:name', (c) => c.json({ hello: c.req.param('name') }));

app.post('/echo', async (c) => {
	const body = await c.req.json();
	return c.json({ youSent: body as Record<string, never> });
});

const server = serve(app);
console.log(`Listening on ${server.url}`);
