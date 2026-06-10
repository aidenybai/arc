import { describe, it, expect } from 'bun:test';
import { App, cors, logger } from '../src/index.ts';

describe('logger', () => {
	it('logs method, path, status, and duration', async () => {
		const lines: string[] = [];
		const app = new App();
		app.use(logger((line) => lines.push(line)));
		app.get('/hello', (c) => c.text('hi'));
		await app.request('/hello');
		expect(lines).toHaveLength(1);
		expect(lines[0]).toMatch(/^GET \/hello 200 \d+(\.\d+)?ms$/);
	});

	it('logs 404 for unmatched routes', async () => {
		const lines: string[] = [];
		const app = new App();
		app.use(logger((line) => lines.push(line)));
		await app.request('/missing');
		expect(lines[0]).toContain('404');
	});
});

describe('cors', () => {
	it('sets Access-Control-Allow-Origin: * by default', async () => {
		const app = new App();
		app.use(cors());
		app.get('/api', (c) => c.json({ ok: true }));
		const res = await app.request('/api');
		expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
	});

	it('handles preflight requests', async () => {
		const app = new App();
		app.use(cors({ allowMethods: ['GET', 'POST'], maxAge: 600 }));
		app.get('/api', (c) => c.json({ ok: true }));
		const res = await app.request('/api', {
			method: 'OPTIONS',
			headers: { Origin: 'https://example.com', 'Access-Control-Request-Method': 'POST' },
		});
		expect(res.status).toBe(204);
		expect(res.headers.get('Access-Control-Allow-Methods')).toBe('GET,POST');
		expect(res.headers.get('Access-Control-Max-Age')).toBe('600');
	});

	it('echoes allowed origins from a list', async () => {
		const app = new App();
		app.use(cors({ origin: ['https://a.com', 'https://b.com'] }));
		app.get('/api', (c) => c.json({ ok: true }));

		const allowed = await app.request('/api', { headers: { Origin: 'https://a.com' } });
		expect(allowed.headers.get('Access-Control-Allow-Origin')).toBe('https://a.com');
		expect(allowed.headers.get('Vary')).toBe('Origin');

		const denied = await app.request('/api', { headers: { Origin: 'https://evil.com' } });
		expect(denied.headers.get('Access-Control-Allow-Origin')).toBeNull();
	});

	it('sets credentials when configured', async () => {
		const app = new App();
		app.use(cors({ origin: 'https://a.com', credentials: true }));
		app.get('/api', (c) => c.json({ ok: true }));
		const res = await app.request('/api', { headers: { Origin: 'https://a.com' } });
		expect(res.headers.get('Access-Control-Allow-Credentials')).toBe('true');
	});
});
