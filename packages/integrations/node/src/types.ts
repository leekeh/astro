import type { IncomingMessage, ServerResponse } from 'node:http';
import type { MiddlewareMode } from 'astro';

export interface UserOptions {
	/**
	 * Specifies the mode that the adapter builds to.
	 *
	 * - 'middleware' - Build to middleware, to be used within another Node.js server, such as Express.
	 * - 'standalone' - Build to a standalone server. The server starts up just by running the built script.
	 */
	mode: 'middleware' | 'standalone';
	/**
	 * Disables HTML streaming. This is useful for example if there are constraints from your host.
	 */
	experimentalDisableStreaming?: boolean;

	/**
	 * If enabled, the adapter will save [static headers in the framework API file](https://docs.netlify.com/frameworks-api/#headers).
	 *
	 * Here the list of the headers that are added:
	 * - The CSP header of the static pages is added when CSP support is enabled.
	 */
	staticHeaders?: boolean;

	/**
	 * The host that should be used if the server needs to fetch the prerendered error page.
	 * If not provided, this will default to the host of the server. This should be set if the server
	 * should fetch prerendered error pages from a different host than the public URL of the server.
	 * This is useful for example if the server is behind a reverse proxy or a load balancer, or if
	 * static files are hosted on a different domain. Do not include a path in the URL: it will be ignored.
	 */
	experimentalErrorPageHost?: string | URL;

	/**
	 * Determines when and how Astro middleware executes for prerendered (static) pages.
	 *
	 * - `'classic'` (default): Middleware runs for prerendered pages at build time only.
	 *   It does **not** run at request time for prerendered pages.
	 * - `'always'`: Middleware runs at build time for prerendered pages **and** again at
	 *   request time. Use this for auth, personalization, A/B testing on all pages.
	 * - `'on-request'`: Middleware does **not** run at build time for prerendered pages.
	 *   It only runs at request time (for both SSR and prerendered pages).
	 *
	 * @default 'classic'
	 */
	middlewareMode?: MiddlewareMode;
}

export interface Options extends UserOptions {
	host: string | boolean;
	port: number;
	server: string;
	client: string;
	staticHeaders: boolean;
}

export type RequestHandler = (...args: RequestHandlerParams) => void | Promise<void>;
type RequestHandlerParams = [
	req: IncomingMessage,
	res: ServerResponse,
	next?: (err?: unknown) => void,
	locals?: object,
];

export type NodeAppHeadersJson = {
	pathname: string;
	headers: {
		key: string;
		value: string;
	}[];
}[];
