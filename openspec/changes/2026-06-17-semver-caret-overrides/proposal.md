# Proposal: Enforce SemVer Carets in pnpm.overrides

## Goal
Migrate all `pnpm.overrides` ranges from `>=` to `^` (caret) in `package.json` to prevent unintended major version updates that could introduce breaking changes in sub-dependencies.

## Problem
Currently, the security overrides in `package.json` are defined using the `>=` operator (e.g., `"ws": ">=8.21.0"`). While this satisfies security requirements, it allows `pnpm` to resolve to the absolute latest version available in the registry, including major versions (e.g., `9.0.0`). Major versions, by definition in SemVer, introduce breaking changes. This creates a "time bomb" where a future install might silently break runtime dependencies (like Supabase's realtime socket) or build tools (like Capacitor).

## Proposed Solution
Update all overrides to use the caret (`^`) operator. The caret operator allows minor and patch updates (e.g., `^8.21.0` allows `8.22.0` or `8.21.1`) but strictly blocks the next major version (blocks `>=9.0.0`). 

### Changes to `package.json`
We will update the following overrides:
- `serialize-javascript`: `^7.0.3`
- `picomatch`: `^4.0.4`
- `lodash`: `^4.18.0`
- `fast-uri`: `^3.1.2`
- `@xmldom/xmldom`: `^0.8.13`
- `@babel/plugin-transform-modules-systemjs`: `^7.29.4`
- `@babel/core`: `^7.29.6`
- `tar`: `^7.5.11`
- `minimatch`: `^3.1.4`
- `esbuild`: `^0.28.1`
- `ws`: `^8.21.0`
- `postcss`: `^8.5.10`
- `uuid`: `^11.1.1`

## Verification
- Run `pnpm install` to regenerate the `pnpm-lock.yaml` with the new constrained ranges.
- Confirm `pnpm build` passes successfully.
