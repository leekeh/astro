import * as assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import * as cheerio from 'cheerio';
import nodejs from '../dist/index.js';
import { loadFixture, waitServerListen } from './test-utils.js';

/**
 * Tests that Astro middleware executes for prerendered (static) pages at request time.
 * The middleware serves the pre-built HTML file as the response from `next()`, giving
 * middleware a chance to inspect/modify headers, set cookies, or redirect.
 */
describe('Middleware runs for prerendered pages (standalone)', () => {
	/** @type {import('./test-utils').Fixture} */
	let fixture;
	let server;

	before(async () => {
		fixture = await loadFixture({
			root: './fixtures/prerender-middleware/',
			output: 'server',
			outDir: './dist/prerender-middleware',
			adapter: nodejs({ mode: 'standalone' }),
		});
		await fixture.build();
		const { startServer } = await fixture.loadAdapterEntryModule();
		const res = startServer();
		server = res.server;
		await waitServerListen(server.server);
	});

	after(async () => {
		await server.stop();
		await fixture.clean();
	});

	it('serves the prerendered HTML content correctly', async () => {
		const res = await fetch(`http://${server.host}:${server.port}/static`);
		assert.equal(res.status, 200);
		const html = await res.text();
		const $ = cheerio.load(html);
		assert.equal($('h1').text(), 'Static Page');
	});

	it('middleware runs for prerendered pages (header set by middleware is present)', async () => {
		const res = await fetch(`http://${server.host}:${server.port}/static`);
		assert.equal(res.status, 200);
		assert.equal(res.headers.get('x-middleware-ran'), 'true');
	});

	it('ctx.isPrerendered is true inside middleware for prerendered pages', async () => {
		const res = await fetch(`http://${server.host}:${server.port}/static`);
		assert.equal(res.headers.get('x-is-prerendered'), 'true');
	});

	it('middleware also runs for SSR pages (sanity check)', async () => {
		const res = await fetch(`http://${server.host}:${server.port}/dynamic`);
		assert.equal(res.status, 200);
		assert.equal(res.headers.get('x-middleware-ran'), 'true');
		assert.equal(res.headers.get('x-is-prerendered'), 'false');
	});

	it('middleware can redirect before serving a prerendered page', async () => {
		const res = await fetch(`http://${server.host}:${server.port}/static`, {
			redirect: 'manual',
			headers: { 'x-test-redirect': 'true' },
		});
		assert.equal(res.status, 302);
		assert.ok(res.headers.get('location')?.endsWith('/dynamic'));
	});
});

describe('Middleware runs for prerendered pages (middleware mode)', () => {
	/** @type {import('./test-utils').Fixture} */
	let fixture;
	let server;

	before(async () => {
		const express = (await import('express')).default;

		fixture = await loadFixture({
			root: './fixtures/prerender-middleware/',
			output: 'server',
			outDir: './dist/prerender-middleware-mode',
			adapter: nodejs({ mode: 'middleware' }),
		});
		await fixture.build();
		const { handler } = await fixture.loadAdapterEntryModule();

		const app = express();
		// The Astro handler handles all routes, including prerendered pages.
		// It reads the pre-built HTML from disk and runs Astro middleware before serving.
		app.use(handler);

		server = await new Promise((resolve) => {
			const s = app.listen(0, () => resolve(s));
		});
	});

	after(() => {
		server.close();
		return fixture.clean();
	});

	it('serves the prerendered HTML content correctly', async () => {
		const { port } = server.address();
		const res = await fetch(`http://localhost:${port}/static`);
		assert.equal(res.status, 200);
		const html = await res.text();
		const $ = cheerio.load(html);
		assert.equal($('h1').text(), 'Static Page');
	});

	it('middleware runs for prerendered pages in middleware mode', async () => {
		const { port } = server.address();
		const res = await fetch(`http://localhost:${port}/static`);
		assert.equal(res.status, 200);
		assert.equal(res.headers.get('x-middleware-ran'), 'true');
	});
});
