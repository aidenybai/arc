export type Params = Record<string, string>;

export type Matched<T> = [T, Params];

type Ordered<T> = [T, Params, number];

interface Route<T> {
	method: string;
	handler: T;
	order: number;
}

interface Node<T> {
	children: Map<string, Node<T>>;
	paramChild?: { name: string; node: Node<T> };
	wildcardChild?: { name: string; node: Node<T> };
	routes: Route<T>[];
}

const createNode = <T>(): Node<T> => ({
	children: new Map(),
	routes: [],
});

const splitPath = (path: string): string[] =>
	path.split('/').filter((segment) => segment !== '');

/**
 * A trie router supporting static segments, `:param` segments, and `*`
 * wildcards. `match` returns every matching handler paired with its captured
 * params, ordered by registration order, so middleware registered before a
 * handler always runs before it.
 */
export class Router<T> {
	#root: Node<T> = createNode();
	#order = 0;

	add(method: string, path: string, handler: T): void {
		let node = this.#root;
		for (const segment of splitPath(path)) {
			if (segment.startsWith(':')) {
				const name = segment.slice(1);
				node.paramChild ??= { name, node: createNode() };
				if (node.paramChild.name !== name) {
					throw new Error(
						`conflicting param names at the same position: ':${node.paramChild.name}' and ':${name}'`,
					);
				}
				node = node.paramChild.node;
			} else if (segment.startsWith('*')) {
				const name = segment.slice(1) || '*';
				node.wildcardChild ??= { name, node: createNode() };
				node = node.wildcardChild.node;
			} else {
				let child = node.children.get(segment);
				if (!child) {
					child = createNode();
					node.children.set(segment, child);
				}
				node = child;
			}
		}
		node.routes.push({ method, handler, order: this.#order++ });
	}

	match(method: string, path: string): Matched<T>[] {
		const segments = splitPath(path);
		const results: Ordered<T>[] = [];
		this.#collect(this.#root, segments, 0, method, {}, results);
		results.sort((a, b) => a[2] - b[2]);
		return results.map(([handler, params]) => [handler, params]);
	}

	#collect(
		node: Node<T>,
		segments: string[],
		index: number,
		method: string,
		params: Params,
		results: Ordered<T>[],
	): void {
		if (index === segments.length) {
			this.#take(node, method, params, results);
			if (node.wildcardChild) {
				this.#take(node.wildcardChild.node, method, { ...params, [node.wildcardChild.name]: '' }, results);
			}
			return;
		}

		const segment = segments[index];

		const staticChild = node.children.get(segment);
		if (staticChild) {
			this.#collect(staticChild, segments, index + 1, method, params, results);
		}

		if (node.paramChild) {
			const nextParams = { ...params, [node.paramChild.name]: decodeURIComponent(segment) };
			this.#collect(node.paramChild.node, segments, index + 1, method, nextParams, results);
		}

		if (node.wildcardChild) {
			const rest = segments.slice(index).join('/');
			this.#take(node.wildcardChild.node, method, { ...params, [node.wildcardChild.name]: rest }, results);
		}
	}

	#take(
		node: Node<T>,
		method: string,
		params: Params,
		results: Ordered<T>[],
	): void {
		for (const route of node.routes) {
			if (route.method === method || route.method === 'ALL') {
				results.push([route.handler, params, route.order]);
			}
		}
	}
}
