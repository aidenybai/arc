import { describe, it, expect } from 'bun:test';
import { Router } from '../src/router.ts';

describe('Router', () => {
	it('matches static routes', () => {
		const router = new Router<string>();
		router.add('GET', '/hello', 'h');
		expect(router.match('GET', '/hello')).toEqual([['h', {}]]);
		expect(router.match('GET', '/nope')).toEqual([]);
		expect(router.match('POST', '/hello')).toEqual([]);
	});

	it('matches the root path', () => {
		const router = new Router<string>();
		router.add('GET', '/', 'root');
		expect(router.match('GET', '/')).toEqual([['root', {}]]);
	});

	it('ignores trailing slashes', () => {
		const router = new Router<string>();
		router.add('GET', '/about', 'a');
		expect(router.match('GET', '/about/')).toEqual([['a', {}]]);
	});

	it('captures params', () => {
		const router = new Router<string>();
		router.add('GET', '/users/:id', 'u');
		expect(router.match('GET', '/users/7')).toEqual([['u', { id: '7' }]]);
	});

	it('captures nested params', () => {
		const router = new Router<string>();
		router.add('GET', '/a/:x/b/:y', 'h');
		expect(router.match('GET', '/a/1/b/2')).toEqual([['h', { x: '1', y: '2' }]]);
	});

	it('rejects conflicting param names at the same position', () => {
		const router = new Router<string>();
		router.add('GET', '/users/:id', 'a');
		expect(() => router.add('GET', '/users/:name', 'b')).toThrow();
	});

	it('matches ALL routes for any method', () => {
		const router = new Router<string>();
		router.add('ALL', '/any', 'h');
		expect(router.match('GET', '/any')).toEqual([['h', {}]]);
		expect(router.match('DELETE', '/any')).toEqual([['h', {}]]);
	});

	it('captures wildcard remainders', () => {
		const router = new Router<string>();
		router.add('GET', '/files/*', 'f');
		expect(router.match('GET', '/files/a/b/c.txt')).toEqual([['f', { '*': 'a/b/c.txt' }]]);
		expect(router.match('GET', '/files')).toEqual([['f', { '*': '' }]]);
	});

	it('supports named wildcards', () => {
		const router = new Router<string>();
		router.add('GET', '/static/*path', 's');
		expect(router.match('GET', '/static/css/app.css')).toEqual([['s', { path: 'css/app.css' }]]);
	});

	it('returns multiple matches in registration order', () => {
		const router = new Router<string>();
		router.add('ALL', '*', 'mw');
		router.add('GET', '/x', 'handler');
		expect(router.match('GET', '/x')).toEqual([
			['mw', { '*': 'x' }],
			['handler', {}],
		]);
	});

	it('keeps params separate per match', () => {
		const router = new Router<string>();
		router.add('GET', '/p/:a', 'one');
		router.add('GET', '/p/:a/q', 'two');
		expect(router.match('GET', '/p/1')).toEqual([['one', { a: '1' }]]);
		expect(router.match('GET', '/p/1/q')).toEqual([['two', { a: '1' }]]);
	});
});
