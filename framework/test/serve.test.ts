import { describe, it, expect, afterAll } from 'bun:test';
import { App, serve, type SparkServer } from '../src/index.ts';

describe('serve (real HTTP round-trip)', () => {
	const app = new App();
	app.get('/', (c) => c.text('hello over http'));
	app.get('/users/:id', (c) => c.json({ id: c.req.param('id') }));
	app.post('/echo', async (c) => c.json(await c.req.json()));

	const server: SparkServer = serve(app, { port: 0 });

	afterAll(() => server.stop());

	it('serves GET requests', async () => {
		const res = await fetch(`${server.url}`);
		expect(res.status).toBe(200);
		expect(await res.text()).toBe('hello over http');
	});

	it('serves routes with params', async () => {
		const res = await fetch(`${server.url}users/9`);
		expect(await res.json()).toEqual({ id: '9' });
	});

	it('serves POST requests with JSON bodies', async () => {
		const res = await fetch(`${server.url}echo`, {
			method: 'POST',
			body: JSON.stringify({ ping: 'pong' }),
			headers: { 'Content-Type': 'application/json' },
		});
		expect(await res.json()).toEqual({ ping: 'pong' });
	});

	it('returns 404 over the wire', async () => {
		const res = await fetch(`${server.url}missing`);
		expect(res.status).toBe(404);
	});
});
