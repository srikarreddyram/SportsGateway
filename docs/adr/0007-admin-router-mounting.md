# 7. Admin routes mounted under a path prefix

**Status:** Accepted — records a defect and the invariant that prevents its return

## Context

The gateway exposes operational endpoints — live state, cache invalidation — guarded by an
optional shared secret in `ADMIN_TOKEN`. The guard is an Express middleware applied inside
the admin router:

```js
router.use(requireAdminToken); // no path argument
```

A pathless `router.use()` applies to **every request the router receives**. Which requests
the router receives is decided entirely by where the caller mounts it.

The router originally declared full paths on its own routes (`/admin/status`) and was
mounted at the application root:

```js
app.use(createAdminRouter(...));   // receives every request
```

The routes resolved to the right URLs, so this looked correct. It was not: mounting at the
root means the router receives _all_ traffic, so `requireAdminToken` ran on **every
request in the application** — `/health`, `/metrics`, `/api/*`, everything.

It stayed invisible because the guard short-circuits when no token is configured
(`if (!config.admin.token) return next()`), and `ADMIN_TOKEN` had never been set to a real
value in any test or demo. The bug was latent behind an unset environment variable, and it
would have activated the moment someone secured their deployment — turning the entire
public API into a 401 for every client, as a _consequence of enabling security_.

It surfaced immediately once `docker-compose.yml` was given a real default token: `/docs`
and `/openapi.json` started returning 401.

## Decision

The router declares routes relative to its own root (`/status`, `/cache`) and the caller
mounts it at the prefix:

```js
app.use('/admin', createAdminRouter(...));
```

The URLs are identical. The difference is that the router now only receives `/admin/*`
traffic, so its pathless guard can only ever apply there.

## Consequences

**The invariant:** a router carrying a pathless `use()` guard must be mounted at a path
prefix, never at the root. Routers whose own paths are absolute are indistinguishable from
correctly-scoped ones by reading the route definitions alone — the scoping lives at the
mount site, which is a different file.

**The test that holds it.** `test/adminAuth.test.js` asserts both halves, and the second
half is the one that matters: with `ADMIN_TOKEN` set, `/health`, `/ready`, `/metrics`,
`/openapi.json` and `/api/scores/:id` must all still be reachable without a token. Testing
only that admin routes reject unauthenticated requests would have passed against the
broken version.

**The general lesson.** A security control that is inert by default hides its own
misconfiguration. The config that exercises it — here, a non-empty token — has to be
covered by a test, or "it works" only means "it has never been switched on."
