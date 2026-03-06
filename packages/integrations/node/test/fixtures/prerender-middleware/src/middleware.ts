import type { MiddlewareHandler } from 'astro';

export const onRequest: MiddlewareHandler = async (ctx, next) => {
	// Test: middleware can redirect before serving the static page
	if (ctx.url.pathname === '/static' && ctx.request.headers.get('x-test-redirect') === 'true') {
		return ctx.redirect('/dynamic');
	}

	const response = await next();

	// Test: middleware can set response headers after the page is served
	response.headers.set('x-middleware-ran', 'true');
	response.headers.set('x-is-prerendered', String(ctx.isPrerendered));

	return response;
};
