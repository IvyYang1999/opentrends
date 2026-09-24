# SEO release — 2026-09-13

Metadata/discovery only; preserve homepage body, stylesheet, event handlers, analytics and API worker.

Production web build must supply its public compile-time URLs:

```sh
VITE_SERVER_URL=https://api.opentrends.io VITE_SITE_URL=https://opentrends.io bun run --cwd apps/web build
node apps/web/node_modules/wrangler/bin/wrangler.js versions upload --config apps/web/dist/server/wrangler.json --name opentrends-web-production
```

Use repository-pinned Wrangler; a newer downloaded CLI rejects this build toolchain's generated legacy_env field. Never change worker permissions or runtime bindings to work around a build failure.

Verification: candidate 1 rejected for missing VITE_SERVER_URL at build time; candidate 2 restored runtime but bounded sweep found invalid locale aliases on non-trend routes and redirect URLs in sitemap. Circuit stop recorded; user authorized unattended completion, so candidate 3 is a closed repair of those existing SEO targets only. Third failure stops publication.

Pre-existing typecheck failure: event-flow-page.tsx:379 EventFeedItem.signals. This file is unchanged by this release. Production build plus valid/invalid route and visual smoke are required.

Candidate 3: HTTP route matrix ACCEPTED (valid 200, invalid locale 404, single canonical and 9 alternates, 64 canonical sitemap URLs). Browser preview data fetch is denied by existing production CORS: same API endpoint returns 200 for both origins, ACAO only for https://opentrends.io. Runtime bindings and CSS are equal to previous production. Do not widen CORS; verify real custom domain immediately after promotion and roll back on failure.
