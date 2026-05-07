# Discovery & Plan: BAH-4608

**JIRA**: BAH-4608 (details intentionally not fetched per user direction)
**Summary**: Code quality / improvements beyond the card scope on the bahmni-template-service codebase
**Story Points**: 2
**Created**: 2026-05-07

---

## JIRA Details

The user asked to skip JIRA fetching and focus on code quality and improvements beyond what BAH-4608 already shipped (data-config → compute refactor + compute.js hot-reload fix, per recent commits). The discovery below treats the **current codebase** as the authoritative source.

**AC Status**: N/A — exploratory code-quality work. User-approved scope is the gate.

---

## Codebase Assessment

### Architecture (from ARCHITECTURE.md and source)

Express service that, per render request, (1) loads template + data-config from disk, (2) fetches OpenMRS sources in parallel via axios, (3) runs declarative computed fields, (4) optionally runs `compute.js`, (5) renders Nunjucks template, (6) returns HTML. PDF path is wired but disabled in `server.ts`.

### Files Audited (10 source + 3 test)
| File | Status |
|------|--------|
| `src/server.ts` | Audited |
| `src/dataResolver.ts` | Audited (test: `dataResolver.test.ts` ✓) |
| `src/templateStore.ts` | Audited (no tests) |
| `src/computedRunner.ts` | Audited (no tests) |
| `src/computeScriptRunner.ts` | Audited (no tests) |
| `src/renderer.ts` | Audited (no tests) |
| `src/builtins/clinical.ts` | Audited (test ✓) |
| `src/builtins/collections.ts` | Audited (test ✓) |
| `src/builtins/fhirPath.ts` | Audited (no tests) |
| `src/adapters/htmlAdapter.ts` | Trivial pass-through |
| `src/adapters/pdfAdapter.ts` | Disabled in server |

### Baseline
- `npx jest` → **46/46 pass**
- `npx tsc --noEmit` → clean
- Coverage: **47.2%** overall. Zero coverage in computedRunner, computeScriptRunner, renderer, templateStore, htmlAdapter; partial in fhirPath (61%).

### CLAUDE.md
**Not present.** No repo-specific conventions to honour.

---

## Findings (ranked by impact)

### 🔴 Correctness bugs

**B1. Barcode filter is silently broken.** `renderer.ts:67-83` calls `bwipjs.toBuffer({...})` with no callback. In `bwip-js@3.4.5` (verified in `node_modules/bwip-js/dist/bwip-js-node.js:86`), `toBuffer` **returns a Promise** when no callback is provided. The current code then calls `.toString('base64')` on that Promise, producing the literal base64 of `"[object Promise]"` and an `<img>` tag with garbage data. Any template using `| barcode(...)` is currently emitting a broken barcode image.

**B2. 404 from OpenMRS surfaces as HTTP 500.** `dataResolver.ts:101-103` throws `OpenMRS resource not found for source: X`. `server.ts:138-159` only string-matches `Missing context variable | Unknown source | Invalid format` (→400), `OpenMRS API unreachable | ECONNREFUSED` (→502), `session expired` (→401). The "not found" message isn't matched, so it falls through to `500 Render failed`.

### 🟠 Resilience

**R1. No axios timeout.** Both `dataResolver.ts:87` and `computeScriptRunner.ts:36` call `axios.get(url, { headers })` with no timeout. A slow OpenMRS keeps the Express request open until the client disconnects, holding event-loop resources.

### 🟡 Performance

**P1. `templateStore.list()` and `get()` re-read JSON from disk every request.** Both `templates.json` and per-template `data-config.json` are read with `fs.readFileSync` on every API call, including the high-traffic `GET /templates` and every `POST /render`.

**P2. Translations re-read from disk on every render** (`renderer.ts:14-23`, called twice from `createEnvironment`: once for current locale, once for English fallback — even when locale === 'en').

**P3. `nunjucks` configured with `noCache: true`** (`renderer.ts:31`). Fine for dev, but in production this re-parses every template HTML on every render.

**P4. `require.cache` is invalidated on every compute.js execution** (`computeScriptRunner.ts:82`). Forces re-parse of compute.js per render.

**P5. `JSON.stringify(response.data).slice(0,300)` in `dataResolver.ts:88`** stringifies the *entire* response body just to log a 300-char preview. With large FHIR Bundles this is real CPU + memory pressure.

### 🟡 Security / observability

**S1. Verbose logging of session headers and response bodies** (`server.ts:52-60`, `dataResolver.ts:88`). Healthcare service — response bodies likely contain PHI; full-body stringification before slicing is also a memory concern. Logged unconditionally at info level.

**S2. No path-traversal guard on template folder.** `templateStore.ts:45,66` builds `templateDir` from `entry.folder` (templates.json). If `templates.json` is ever writable by lower-trust actors, a `folder: "../etc/passwd-dir"` value would let `compute.js` `require()` an arbitrary file. templates.json is currently config-trusted, but a 4-line `path.resolve` + prefix check is cheap insurance.

**S3. No request body validation.** Server trusts `RenderRequest` shape. Internal service so risk is low, but a malformed `context` object can throw mid-render in unhelpful ways.

### 🟢 Code health (low impact)

**C1. Error mapping by string-matching** in `server.ts:138-159` is brittle — a message rewording silently changes HTTP status. Worth migrating to typed errors with status codes.

**C2. Duplicate auth-header construction** in `server.ts:97-102` and `:108-112` (built twice for the same request).

**C3. PDF type/runtime mismatch.** `RenderRequest.format` is `'html' | 'pdf'`, `TemplateEntry.outputFormats` is `Array<'html' | 'pdf'>`, but `server.ts:69-73` rejects `pdf` outright. Either restore PDF (pdfAdapter still exists) or strip PDF from types and `outputFormats`. ARCHITECTURE.md still documents PDF as supported.

**C4. Cosmetic.** `server.ts:29` `category:t.category` missing space.

**C5. `.env.txt`** is untracked but contains a local-machine `TEMPLATES_DIR` path. `.gitignore` only covers `.env` exact match.

### 🔵 Test coverage gaps
**T1.** No tests for `computedRunner` (the entire `executeField` switch is uncovered).
**T2.** No tests for `templateStore` (cache + path validation logic, once added, needs coverage).
**T3.** No test for `renderer` filters — particularly the `barcode` filter, whose current bug would have been caught.

---

## Implementation Approach

### Approach A — Recommended: Correctness + Resilience + targeted Perf

Fix the real bugs, add one resilience fix, address the highest-leverage perf issues, and backfill tests around the changes. Stays within 2-pointer scope.

**Includes**: B1, B2, R1, P1, P2, P5, S1 (sanitize logs), T3 (test for barcode + new error mapping); plus C2/C4 cosmetic cleanups since they're touched anyway.

**Defers** to a follow-up: P3, P4 (env-gated cache toggles), S2/S3 (validation), C1 (error class refactor), C3 (PDF decision), T1/T2 broad test backfill.

### Approach B — Bug fixes only

Just B1 + B2 + R1 + a barcode regression test. ~0.75 pts, smaller PR but leaves obvious wins on the table.

### Approach C — Full sweep

Do everything in this discovery. Crosses 3+ pts, would need re-estimation.

### Recommended: **Approach A**

Hits the two real correctness bugs (B1, B2 are user-visible defects), the resilience issue most likely to bite under OpenMRS slowness (R1), and the perf wins that affect every request (P1, P2, P5). Test coverage tightens around the new code.

---

## Work Breakdown (Approach A)

| # | Sub-task | Effort | Files | Tests |
|---|----------|--------|-------|-------|
| 1 | **B1** Fix barcode filter — pass callback to `bwipjs.toBuffer` (synchronous when callback supplied; verified in source) | ~0.4 pt | `src/renderer.ts` | new `renderer.test.ts` covering barcode filter |
| 2 | **B2** Map "OpenMRS resource not found" → HTTP 404 in error handler | ~0.1 pt | `src/server.ts` | extend `dataResolver.test.ts` or add server-level assertion |
| 3 | **R1** Add axios timeout (env-tunable, default 10s) | ~0.2 pt | `src/dataResolver.ts`, `src/computeScriptRunner.ts` | add timeout assertion in `dataResolver.test.ts` |
| 4 | **P1** Cache `templates.json` + per-template `data-config.json` in `templateStore`; mtime-based invalidation | ~0.5 pt | `src/templateStore.ts` | new `templateStore.test.ts` (cache hit / miss / mtime change) |
| 5 | **P2** Memoize `loadTranslations` per locale; skip duplicate English read when locale === 'en' | ~0.2 pt | `src/renderer.ts` | covered by renderer test from #1 |
| 6 | **P5/S1** Replace full-body `JSON.stringify` log with `{ resourceType, entryCount, status }` summary; gate header log behind `LOG_LEVEL=debug` | ~0.2 pt | `src/server.ts`, `src/dataResolver.ts` | spy-based check in tests |
| 7 | **C2/C4** Extract `buildAuthHeaders(req)` helper; fix `category:t.category` spacing | ~0.1 pt | `src/server.ts` | — |
| 8 | Re-run jest + tsc; write implementation summary | ~0.3 pt | — | — |

**Total estimated**: ~2.0 points

---

## Scope Verdict

✅ **Confirmed 2-pointer.** The work is moderate, focused, and refactoring (helper extraction, cache layer in templateStore) is justified by the perf and safety wins.

Approach C (everything) would be 3+ pts and is explicitly deferred.

---

## User Decisions (2026-05-07)

1. **Scope**: Approach A approved.
2. **PDF**: Strip completely. Remove `pdf` from `RenderRequest`/`outputFormats` types, delete `src/adapters/pdfAdapter.ts`, drop disabled imports/format gates in `server.ts`, update `ARCHITECTURE.md` to remove PDF references. (Adds ~0.2 pt; total stays at ~2.0.)
3. **Timeout**: 10s default, env-tunable via `OPENMRS_TIMEOUT_MS`.
4. **i18n cache**: mtime-based — current behavior reflects edits instantly (no cache at all), so a process-lifetime cache would silently regress that. mtime check on every render keeps the live-edit behavior with a single `fs.statSync` per locale per render.

## Updated Work Breakdown

| # | Sub-task | Files |
|---|----------|-------|
| 1 | **B1** Fix barcode filter (callback form of `bwipjs.toBuffer`) | `src/renderer.ts` |
| 2 | **B2** Map "OpenMRS resource not found" → 404 | `src/server.ts` |
| 3 | **R1** Add 10s axios timeout via `OPENMRS_TIMEOUT_MS` | `src/dataResolver.ts`, `src/computeScriptRunner.ts` |
| 4 | **P1** Cache templates.json + data-config.json with mtime check | `src/templateStore.ts` |
| 5 | **P2** mtime-based translation cache; skip duplicate english read when locale === 'en' | `src/renderer.ts` |
| 6 | **P5/S1** Compact response log; gate header log behind `LOG_LEVEL=debug` | `src/server.ts`, `src/dataResolver.ts` |
| 7 | **C2/C4** Extract `buildAuthHeaders(req)`; fix `category:t.category` spacing | `src/server.ts` |
| 8 | **PDF strip** Remove pdf from types, delete pdfAdapter, prune server.ts, update ARCHITECTURE.md | `src/types.ts`, `src/server.ts`, `src/adapters/pdfAdapter.ts` (delete), `package.json` (drop puppeteer-core), `ARCHITECTURE.md` |
| 9 | Add `renderer.test.ts` (barcode filter regression) and `templateStore.test.ts` (cache hit / mtime invalidation) | `src/renderer.test.ts`, `src/templateStore.test.ts` |
| 10 | Validate (jest + tsc) and write summary | — |
