import type { Context } from './context.ts';
import type { Params } from './router.ts';

export type Next = () => Promise<void>;

export type Handler = (c: Context, next: Next) => Response | undefined | void | Promise<Response | undefined | void>;

/**
 * Compose matched handlers into a single onion-model dispatcher. Each entry
 * carries its own params, applied to the request before the handler runs, so
 * `:param` captures are correct even when multiple routes match.
 */
export const compose = (
	entries: Array<[Handler, Params]>,
	onNoResponse?: (c: Context) => Response | Promise<Response>,
) => {
	return async (c: Context): Promise<void> => {
		let index = -1;
		const dispatch = async (i: number): Promise<void> => {
			if (i <= index) throw new Error('next() called multiple times');
			index = i;
			const entry = entries[i];
			if (!entry) {
				if (!c.finalized && onNoResponse) {
					c.res = await onNoResponse(c);
					c.finalized = true;
				}
				return;
			}
			const [handler, params] = entry;
			c.req.setParams(params);
			const result = await handler(c, () => dispatch(i + 1));
			if (result instanceof Response && !c.finalized) {
				c.res = result;
				c.finalized = true;
			}
		};
		await dispatch(0);
	};
};
