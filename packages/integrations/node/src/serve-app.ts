import { AsyncLocalStorage } from 'node:async_hooks';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { createRequest, writeResponse } from 'astro/app/node';
import type { BaseApp } from 'astro/app';
import { resolveClientDir } from './shared.js';
import type { Options, RequestHandler } from './types.js';

/**
 * Read a prerendered page from disk and return it as a Response.
 * Tries both the directory-format path (e.g. `/about/index.html`) and the
 * file-format path (e.g. `/about.html`). Returns `null` if neither is found.
 */
async function readStaticPageFromDisk(
	client: string,
	pathname: string,
): Promise<Response | null> {
	// Normalize: strip leading slash, then strip trailing slash for .html variant
	const normalized = pathname.startsWith('/') ? pathname.slice(1) : pathname;
	const withoutTrailing = normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;

	const filePaths = [
		// Directory format:  /about  →  dist/client/about/index.html
		path.join(client, normalized, 'index.html'),
		// File format:       /about  →  dist/client/about.html
		path.join(client, withoutTrailing + '.html'),
	];

	for (const filePath of filePaths) {
		try {
			const stream = createReadStream(filePath);
			await new Promise<void>((resolve, reject) => {
				stream.once('open', () => resolve());
				stream.once('error', reject);
			});
			const webStream = Readable.toWeb(stream) as ReadableStream;
			return new Response(webStream, {
				headers: { 'Content-Type': 'text/html; charset=utf-8' },
			});
		} catch {
			// File not found, try next pattern
		}
	}

	return null;
}

/**
 * Creates a `prerenderedPageFetch` callback for the given client directory.
 * This is passed to `app.render()` so that the Astro middleware chain runs
 * for prerendered page requests, with `next()` returning the pre-built HTML.
 */
function createPrerenderedPageFetch(
	client: string,
	app: BaseApp,
): (request: Request) => Promise<Response> {
	return async (request: Request) => {
		const url = new URL(request.url);
		const pathname = app.removeBase(url.pathname) || '/';
		const response = await readStaticPageFromDisk(client, pathname);
		// Return a null-body 404 so BaseApp.render() falls through to error-page handling.
		return response ?? new Response(null, { status: 404 });
	};
}

/**
 * Creates a Node.js http listener for on-demand rendered pages, compatible with http.createServer and Connect middleware.
 * If the next callback is provided, it will be called if the request does not have a matching route.
 * Intended to be used in both standalone and middleware mode.
 */
export function createAppHandler(app: BaseApp, options: Options): RequestHandler {
	/**
	 * Keep track of the current request path using AsyncLocalStorage.
	 * Used to log unhandled rejections with a helpful message.
	 */
	const als = new AsyncLocalStorage<string>();
	const logger = app.getAdapterLogger();
	process.on('unhandledRejection', (reason) => {
		const requestUrl = als.getStore();
		logger.error(`Unhandled rejection while rendering ${requestUrl}`);
		console.error(reason);
	});

	const client = resolveClientDir(options);

	// Read prerendered error pages directly from disk instead of fetching over HTTP.
	// This avoids SSRF risks and is more efficient.
	const prerenderedErrorPageFetch = async (url: string): Promise<Response> => {
		if (url.includes('/404')) {
			const response = await readStaticPageFromDisk(client, '/404');
			if (response) return response;
		}
		if (url.includes('/500')) {
			const response = await readStaticPageFromDisk(client, '/500');
			if (response) return response;
		}
		// Fallback: if experimentalErrorPageHost is configured, fetch from there
		if (options.experimentalErrorPageHost) {
			const originUrl = new URL(options.experimentalErrorPageHost);
			const errorPageUrl = new URL(url);
			errorPageUrl.protocol = originUrl.protocol;
			errorPageUrl.host = originUrl.host;
			return fetch(errorPageUrl);
		}
		// No file found and no fallback configured - return empty response
		return new Response(null, { status: 404 });
	};

	return async (req, res, next, locals) => {
		let request: Request;
		try {
			request = createRequest(req, {
				allowedDomains: app.getAllowedDomains?.() ?? [],
			});
		} catch (err) {
			logger.error(`Could not render ${req.url}`);
			console.error(err);
			res.statusCode = 500;
			res.end('Internal Server Error');
			return;
		}

		// Match all routes, including prerendered ones. Redirects that are prerendered
		// have always been handled here; we also handle prerendered pages when the
		// middleware mode opts in to request-time middleware for them.
		const routeData = app.match(request, true);
		const middlewareMode = app.manifest.middlewareMode;
		const runMiddlewareForPrerendered =
			middlewareMode === 'always' || middlewareMode === 'on-request';

		// Route through the app handler when:
		// - There's a route match AND
		// - It's not a prerendered page, OR the middleware mode opts in to request-time middleware
		const isPrerenderedPage = routeData?.type === 'page' && routeData.prerender;
		if (routeData && (!isPrerenderedPage || runMiddlewareForPrerendered)) {
			// For prerendered page routes when middleware mode opts in, provide a fetch function
			// that reads the pre-built HTML from disk. This is what middleware receives from next().
			const prerenderedPageFetch = isPrerenderedPage
				? createPrerenderedPageFetch(client, app)
				: undefined;
			const response = await als.run(request.url, () =>
				app.render(request, {
					addCookieHeader: true,
					locals,
					routeData,
					prerenderedErrorPageFetch,
					prerenderedPageFetch,
				}),
			);
			await writeResponse(response, res);
		} else if (next) {
			return next();
		} else {
			const response = await app.render(request, {
				addCookieHeader: true,
				prerenderedErrorPageFetch,
			});
			await writeResponse(response, res);
		}
	};
}
