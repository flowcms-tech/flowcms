## What this changes, and why

<!-- The "why" is the part reviewers cannot reconstruct from the diff. If this
     fixes an issue, link it. -->

## How it was verified

<!-- Say what you ran and what it printed. "Tests pass" without output is not
     evidence. -->

```
$ npm run typecheck
$ npm run lint
$ npm run test
$ npm run build
```

## Checklist

- [ ] Typecheck, lint, tests and build all run locally and pass.
- [ ] A new API route has an entry in `src/Framework/Auth/routePolicies.ts` with
      a written reason, and calls `requireApiAuth()`.
- [ ] Anything touching authentication, authorization, escaping or input
      validation has a test — written first, and observed to fail.
- [ ] Every write records activity through `recordActivity()`.
- [ ] No link, redirect or fetch hardcodes `/admin-panel`; the admin path comes
      from `adminPath()` / `useAdminHref()`.
- [ ] Public documentation is updated if this changes behaviour, configuration,
      APIs or dependencies that users, operators or theme authors depend on.
- [ ] No secret, credential, database file or `.env` is included in the diff.

## Anything reviewers should look at closely

<!-- Trade-offs you are unsure about, a shape you would like a second opinion
     on, or something deliberately left out of scope. -->
