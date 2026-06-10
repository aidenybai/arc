import { describe, it, expect } from 'bun:test';
import { App, HTTPException } from '../src/index.ts';

describe('GET request', () => {
	const app = new App();

	app.get('/hello', async () => {
		return new Response('hello', { status: 200, statusText: 'Spark is OK' });
	});

	app.get('/hello-with-shortcuts', (c) => {
		c.header('X-Custom', 'This is Spark');
		c.status(201);
		return c.html('<h1>Spark!!!</h1>');
	});

	it('GET http://localhost/hello is ok', async () => {
		const res = await app.request('http://localhost/hello');
		expect(res.status).toBe(200);
		expect(res.statusText).toBe('Spark is OK');
		expect(await res.text()).toBe('hello');
	});

	it('GET /hello is ok', async () => {
		const res = await app.request('/hello');
		expect(res.status).toBe(200);
		expect(await res.text()).toBe('hello');
	});

	it('GET hello is ok', async () => {
		const res = await app.request('hello');
		expect(res.status).toBe(200);
	});

	it('GET /hello-with-shortcuts is ok', async () => {
		const res = await app.request('/hello-with-shortcuts');
		expect(res.status).toBe(201);
		expect(res.headers.get('X-Custom')).toBe('This is Spark');
		expect(res.headers.get('Content-Type')).toMatch(/text\/html/);
		expect(await res.text()).toBe('<h1>Spark!!!</h1>');
	});

	it('GET / is not found', async () => {
		const res = await app.request('/');
		expect(res.status).toBe(404);
	});

	it('POST /hello is not found', async () => {
		const res = await app.request('/hello', { method: 'POST' });
		expect(res.status).toBe(404);
	});
});

describe('Response shortcuts', () => {
	const app = new App();
	app.get('/text', (c) => c.text('plain'));
	app.get('/json', (c) => c.json({ ok: true }));
	app.get('/json-status', (c) => c.json({ created: true }, 201));
	app.get('/redirect', (c) => c.redirect('/elsewhere'));
	app.get('/redirect-permanent', (c) => c.redirect('/elsewhere', 301));
	app.get('/body', (c) => c.body('raw', 200, { 'Content-Type': 'application/octet-stream' }));

	it('returns text with content type', async () => {
		const res = await app.request('/text');
		expect(res.status).toBe(200);
		expect(res.headers.get('Content-Type')).toMatch(/text\/plain/);
		expect(await res.text()).toBe('plain');
	});

	it('returns json with content type', async () => {
		const res = await app.request('/json');
		expect(res.headers.get('Content-Type')).toMatch(/application\/json/);
		expect(await res.json()).toEqual({ ok: true });
	});

	it('returns json with custom status', async () => {
		const res = await app.request('/json-status');
		expect(res.status).toBe(201);
	});

	it('redirects with 302 by default', async () => {
		const res = await app.request('/redirect');
		expect(res.status).toBe(302);
		expect(res.headers.get('Location')).toBe('/elsewhere');
	});

	it('redirects with a custom status', async () => {
		const res = await app.request('/redirect-permanent');
		expect(res.status).toBe(301);
	});

	it('returns a raw body with custom headers', async () => {
		const res = await app.request('/body');
		expect(res.headers.get('Content-Type')).toBe('application/octet-stream');
		expect(await res.text()).toBe('raw');
	});
});

describe('Routing', () => {
	it('supports route params', async () => {
		const app = new App();
		app.get('/users/:id', (c) => c.text(c.req.param('id') ?? ''));
		const res = await app.request('/users/123');
		expect(await res.text()).toBe('123');
	});

	it('supports multiple params', async () => {
		const app = new App();
		app.get('/posts/:postId/comments/:commentId', (c) => c.json(c.req.param()));
		const res = await app.request('/posts/1/comments/2');
		expect(await res.json()).toEqual({ postId: '1', commentId: '2' });
	});

	it('decodes URI-encoded params', async () => {
		const app = new App();
		app.get('/files/:name', (c) => c.text(c.req.param('name') ?? ''));
		const res = await app.request('/files/hello%20world');
		expect(await res.text()).toBe('hello world');
	});

	it('resolves overlapping routes in registration order', async () => {
		const app = new App();
		app.get('/users/me', (c) => c.text('static'));
		app.get('/users/:id', (c) => c.text('param'));
		expect(await (await app.request('/users/me')).text()).toBe('static');
		expect(await (await app.request('/users/42')).text()).toBe('param');
	});

	it('supports wildcards', async () => {
		const app = new App();
		app.get('/static/*', (c) => c.text(c.req.param('*') ?? ''));
		const res = await app.request('/static/css/main.css');
		expect(await res.text()).toBe('css/main.css');
	});

	it('supports app.all', async () => {
		const app = new App();
		app.all('/any', (c) => c.text(c.req.method));
		expect(await (await app.request('/any')).text()).toBe('GET');
		expect(await (await app.request('/any', { method: 'PUT' })).text()).toBe('PUT');
	});

	it('supports custom methods via app.on', async () => {
		const app = new App();
		app.on('PURGE', '/cache', (c) => c.text('purged'));
		const res = await app.request('/cache', { method: 'PURGE' });
		expect(await res.text()).toBe('purged');
	});

	it('supports chaining', async () => {
		const app = new App();
		app.get('/a', (c) => c.text('a')).get('/b', (c) => c.text('b'));
		expect(await (await app.request('/b')).text()).toBe('b');
	});

	it('mounts sub-apps with app.route', async () => {
		const books = new App();
		books.get('/', (c) => c.text('list books'));
		books.get('/:id', (c) => c.text(`book ${c.req.param('id')}`));
		const app = new App();
		app.route('/books', books);
		expect(await (await app.request('/books')).text()).toBe('list books');
		expect(await (await app.request('/books/42')).text()).toBe('book 42');
	});
});

describe('Request helpers', () => {
	it('parses query strings', async () => {
		const app = new App();
		app.get('/search', (c) => c.json({ q: c.req.query('q'), all: c.req.query() }));
		const res = await app.request('/search?q=spark&page=2');
		expect(await res.json()).toEqual({ q: 'spark', all: { q: 'spark', page: '2' } });
	});

	it('returns all values for repeated query params', async () => {
		const app = new App();
		app.get('/tags', (c) => c.json(c.req.queries('tag')));
		const res = await app.request('/tags?tag=a&tag=b');
		expect(await res.json()).toEqual(['a', 'b']);
	});

	it('reads request headers', async () => {
		const app = new App();
		app.get('/ua', (c) => c.text(c.req.header('User-Agent') ?? 'none'));
		const res = await app.request('/ua', { headers: { 'User-Agent': 'test-agent' } });
		expect(await res.text()).toBe('test-agent');
	});

	it('parses a JSON body', async () => {
		const app = new App();
		app.post('/echo', async (c) => c.json(await c.req.json()));
		const res = await app.request('/echo', {
			method: 'POST',
			body: JSON.stringify({ name: 'spark' }),
			headers: { 'Content-Type': 'application/json' },
		});
		expect(await res.json()).toEqual({ name: 'spark' });
	});

	it('reads a text body', async () => {
		const app = new App();
		app.post('/text', async (c) => c.text(await c.req.text()));
		const res = await app.request('/text', { method: 'POST', body: 'hello' });
		expect(await res.text()).toBe('hello');
	});
});

describe('Middleware', () => {
	it('runs middleware in onion order', async () => {
		const order: string[] = [];
		const app = new App();
		app.use(async (c, next) => {
			order.push('1 in');
			await next();
			order.push('1 out');
		});
		app.use(async (c, next) => {
			order.push('2 in');
			await next();
			order.push('2 out');
		});
		app.get('/', (c) => {
			order.push('handler');
			return c.text('ok');
		});
		await app.request('/');
		expect(order).toEqual(['1 in', '2 in', 'handler', '2 out', '1 out']);
	});

	it('scopes middleware to a path', async () => {
		const app = new App();
		app.use('/admin/*', async (c, next) => {
			c.header('X-Admin', 'true');
			await next();
		});
		app.get('/admin/panel', (c) => c.text('admin'));
		app.get('/public', (c) => c.text('public'));
		const adminRes = await app.request('/admin/panel');
		expect(adminRes.headers.get('X-Admin')).toBe('true');
		const publicRes = await app.request('/public');
		expect(publicRes.headers.get('X-Admin')).toBeNull();
	});

	it('lets middleware short-circuit', async () => {
		const app = new App();
		app.use(async (c) => c.text('blocked', 403));
		app.get('/', (c) => c.text('never'));
		const res = await app.request('/');
		expect(res.status).toBe(403);
		expect(await res.text()).toBe('blocked');
	});

	it('lets middleware modify the response after next()', async () => {
		const app = new App();
		app.use(async (c, next) => {
			await next();
			if (c.res) {
				const res = new Response(c.res.body, c.res);
				res.headers.set('X-After', 'yes');
				c.res = res;
			}
		});
		app.get('/', (c) => c.text('ok'));
		const res = await app.request('/');
		expect(res.headers.get('X-After')).toBe('yes');
	});

	it('passes values between middleware via set/get', async () => {
		const app = new App();
		app.use(async (c, next) => {
			c.set('user', 'aiden');
			await next();
		});
		app.get('/', (c) => c.text(c.get('user') ?? 'nobody'));
		const res = await app.request('/');
		expect(await res.text()).toBe('aiden');
	});

	it('middleware sees 404 for unmatched routes', async () => {
		let observed = 0;
		const app = new App();
		app.use(async (c, next) => {
			await next();
			observed = c.res?.status ?? 0;
		});
		const res = await app.request('/nope');
		expect(res.status).toBe(404);
		expect(observed).toBe(404);
	});

	it('throws when next() is called twice', async () => {
		const app = new App();
		app.use(async (c, next) => {
			await next();
			await next();
		});
		app.get('/', (c) => c.text('ok'));
		const res = await app.request('/');
		expect(res.status).toBe(500);
	});
});

describe('Error handling', () => {
	it('returns 500 for thrown errors', async () => {
		const app = new App();
		app.get('/boom', () => {
			throw new Error('boom');
		});
		const res = await app.request('/boom');
		expect(res.status).toBe(500);
	});

	it('supports a custom onError handler', async () => {
		const app = new App();
		app.get('/boom', () => {
			throw new Error('boom');
		});
		app.onError((err, c) => c.text(`custom: ${err.message}`, 500));
		const res = await app.request('/boom');
		expect(await res.text()).toBe('custom: boom');
	});

	it('converts HTTPException to its response', async () => {
		const app = new App();
		app.get('/auth', () => {
			throw new HTTPException(401, { message: 'Unauthorized' });
		});
		const res = await app.request('/auth');
		expect(res.status).toBe(401);
		expect(await res.text()).toBe('Unauthorized');
	});

	it('uses the custom response from HTTPException', async () => {
		const app = new App();
		app.get('/teapot', () => {
			throw new HTTPException(418, { res: new Response('short and stout', { status: 418 }) });
		});
		const res = await app.request('/teapot');
		expect(res.status).toBe(418);
		expect(await res.text()).toBe('short and stout');
	});

	it('supports a custom notFound handler', async () => {
		const app = new App();
		app.notFound((c) => c.text('nothing here', 404));
		const res = await app.request('/missing');
		expect(res.status).toBe(404);
		expect(await res.text()).toBe('nothing here');
	});

	it('catches async errors', async () => {
		const app = new App();
		app.get('/async-boom', async () => {
			await Promise.resolve();
			throw new Error('async boom');
		});
		app.onError((err, c) => c.text(err.message, 500));
		const res = await app.request('/async-boom');
		expect(await res.text()).toBe('async boom');
	});
});
