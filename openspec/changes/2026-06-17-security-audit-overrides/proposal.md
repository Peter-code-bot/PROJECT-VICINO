# Proposal: Fix Security Audit with pnpm.overrides

## Goal
Resolve the CI failure caused by `pnpm audit --audit-level=high` detecting vulnerabilities in deep dependencies (e.g., `@babel/core`, `tar`, `minimatch`, `esbuild`, `ws`, `brace-expansion`).

## Problem
Vercel deployment is blocked because the GitHub Actions `Security Audit` check fails. The vulnerabilities reside in sub-dependencies of Next.js, Capacitor, Supabase, and Sentry. Because we don't control the direct inclusion of these packages, standard `pnpm install` cannot bump them if they are constrained by the parent packages' `package.json`.

## Proposed Solution
Inject strict version overrides into the root `package.json` using `pnpm.overrides`.
This forces the package manager to resolve to patched versions across the entire monorepo, bypassing the semver constraints of the intermediate packages.

### Vulnerability Fix Mapping
- `tar`: `>=7.5.11` (Fixes Arbitrary File Creation/Overwrite)
- `minimatch`: `>=3.1.4` (Fixes ReDoS)
- `esbuild`: `>=0.28.1` (Fixes Remote Code Execution via NPM_CONFIG_REGISTRY)
- `ws`: `>=8.21.0` (Fixes Memory exhaustion DoS)
- `brace-expansion`: `>=2.0.3` (Fixes process hang / memory exhaustion)
- `postcss`: `>=8.5.10` (Fixes XSS)

## Verification
- Run `pnpm install` to update `pnpm-lock.yaml`.
- Run `pnpm audit --audit-level=high` locally to ensure 0 high vulnerabilities are found.
- Run `pnpm build` to verify that forcing these new versions does not introduce breaking changes in the build process (especially `esbuild` and `postcss`).
