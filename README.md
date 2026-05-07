# Bahmni Template Service

A Node.js/TypeScript microservice that renders configurable clinical documents (prescriptions, registration cards, discharge summaries, etc.) as HTML. Templates live in `standard-config` — an implementer edits a template file, and the next print request picks up the change automatically. No service restart or frontend rebuild required.

---

## Table of Contents

1. [How it fits into Bahmni](#1-how-it-fits-into-bahmni)
2. [Repository layout](#2-repository-layout)
3. [Request lifecycle](#3-request-lifecycle)
4. [API reference](#4-api-reference)
5. [Authentication](#5-authentication)
6. [Environment variables](#6-environment-variables)
7. [Running locally](#7-running-locally)
8. [Running tests](#8-running-tests)
9. [Adding a new template](#9-adding-a-new-template)

> **Template authors** (implementers configuring `standard-config`) — see the [Template Authoring Guide](../standard-config/print-templates/TEMPLATE_AUTHORING_GUIDE.md) for a full reference to `data-config.json`, `compute.js`, Nunjucks filters, and worked examples.

---

## 1. How it fits into Bahmni

```
Browser (React / Bahmni UI)
  │
  │  POST /template-service/api/render
  ▼
nginx  ──── proxy_pass ────►  template-service:8080  (this service)
                                      │
                          reads templates from disk
                          /etc/bahmni_config/print-templates/
                          (Docker bind-mount from standard-config)
                                      │
                          fetches patient data from
                          OpenMRS FHIR/REST APIs
                          (JSESSIONID forwarded from browser)
                                      │
                          returns rendered HTML string
                                      │
                      Browser handles print dialog / PDF
```

Templates are mounted from `standard-config` at runtime. The service uses **mtime-based caching** — edits to `templates.json`, `data-config.json`, `compute.js`, and `_i18n/*.json` are picked up on the next request without restarting.

---

## 2. Repository layout

```
bahmni-template-service/
├── src/
│   ├── server.ts               Express app — routes, auth, error mapping
│   ├── types.ts                All TypeScript interfaces (single source of truth)
│   ├── templateStore.ts        Reads templates.json + data-config.json (mtime-cached)
│   ├── dataResolver.ts         Fetches OpenMRS FHIR/REST sources; OPENMRS_TIMEOUT_MS
│   ├── computedRunner.ts       Executes declarative computed field declarations
│   ├── computeScriptRunner.ts  Runs compute.js with a pre-authenticated OpenMRS client
│   ├── renderer.ts             Nunjucks environment, custom filters, async render()
│   └── builtins/
│       ├── fhirPath.ts         FHIRPath evaluation
│       ├── clinical.ts         age, bmi, los, abnormalFlag
│       └── collections.ts      groupBy, sortBy, take, map, filter, filterIn
├── .env.example                Copy to .env for local dev
├── Dockerfile
└── ARCHITECTURE.md
```

---

## 3. Request lifecycle

```
1. React sends:
   POST /template-service/api/render
   {
     "templateId": "REG_CARD_V1",
     "format": "html",
     "locale": "en",
     "context": { "patientUuid": "abc-123", "visitUuid": "xyz-456" }
   }

2. server.ts validates the request and loads the template via templateStore.

3. templateStore reads templates.json → finds REG_CARD_V1 → reads its data-config.json.
   Both files are mtime-cached; disk is only re-read when the file changes.

4. dataResolver fetches all sources declared in data-config.json from OpenMRS in
   parallel, substituting {{patientUuid}} etc. from context into the URL params.
   JSESSIONID cookie from the browser request is forwarded to OpenMRS.
   Each call is bounded by OPENMRS_TIMEOUT_MS (default 10 s).

5. computedRunner runs each declarative computed field in order.
   A later field can use an earlier computed field as its source (chaining).

6. If a compute.js exists in the template folder, computeScriptRunner runs it
   with a pre-authenticated openmrs client and the resolved sources.

7. renderer.ts renders template.html with Nunjucks, passing:
     { computed, compute, sources, config, locale, now }
   Custom filters (| t, | barcode, | qrcode, | dateFormat, | age, | round, …) run inline.
   render() is async because the | barcode filter uses bwip-js zlib streams.

8. server.ts sends the HTML response.
   The browser handles the print dialog — no PDF generation at the service level.
```

---

## 4. API reference

### `GET /template-service/api/templates`

Returns all registered templates. The Bahmni UI calls this on load to decide which print buttons to show.

**Response**
```json
{
  "templates": [
    {
      "id": "REG_CARD_V1",
      "name": "Registration Card",
      "category": "patientRegistration",
      "triggers": [{ "label": "Print Card (English)", "shortcutKey": "p" }],
      "outputFormats": ["html"]
    }
  ]
}
```

---

### `POST /template-service/api/render`

Resolves data, runs computed fields, and renders the template.

**Request body**
```json
{
  "templateId": "REG_CARD_V1",
  "format": "html",
  "locale": "en",
  "context": {
    "patientUuid": "62d4400b-7bb9-4a0a-a2a5-620b080ee266"
  }
}
```

| Field | Required | Default | Description |
|---|---|---|---|
| `templateId` | Yes | — | Must match an `id` in `templates.json` |
| `format` | No | `"html"` | Only `"html"` is supported |
| `locale` | No | `"en"` | BCP 47 language tag (e.g. `"fr"`, `"hi"`) |
| `context` | No | `{}` | UUIDs substituted into `data-config.json` source params |
| `data` | No | — | Pre-fetched data (skips OpenMRS fetch for those source keys) |

**Responses**

| Status | Body | Cause |
|---|---|---|
| `200` | HTML string | Success |
| `400` | `{ "error": "..." }` | Missing `templateId` or invalid `format` |
| `404` | `{ "error": "Template not found: ..." }` | `templateId` not in `templates.json`, or OpenMRS resource not found |
| `502` | `{ "error": "OpenMRS API timeout..." }` | OpenMRS did not respond within `OPENMRS_TIMEOUT_MS` |
| `500` | `{ "error": "..." }` | Unexpected render error |

---

### `GET /template-service/health`

Docker health check. Returns `{ "status": "ok", "timestamp": "..." }`.

---

## 5. Authentication

The service forwards the browser's session to OpenMRS on every API call. No credentials are stored in the service.

| Header | Description |
|---|---|
| `Cookie: JSESSIONID=...` | Standard browser session (production — forwarded by nginx) |
| `x-openmrs-session-id: ...` | Alternative session header |
| `x-openmrs-authorization: Basic ...` | Basic Auth header (dev/testing) |

In production, nginx forwards the browser's `JSESSIONID` cookie transparently — no extra configuration needed. For local curl testing, pass `-H "Cookie: JSESSIONID=<value>"` copied from browser DevTools.

---

## 6. Environment variables

Copy `.env.example` to `.env` for local development.

| Variable | Default | Description |
|---|---|---|
| `PORT` | `8080` | Port the service listens on |
| `OPENMRS_URL` | `http://openmrs:8080` | OpenMRS base URL (Docker service name in prod) |
| `TEMPLATES_DIR` | `/etc/bahmni_config/print-templates` | Absolute path to the templates directory |
| `OPENMRS_TIMEOUT_MS` | `10000` | Per-request timeout for OpenMRS calls (ms) |
| `LOG_LEVEL` | — | Set to `debug` to log presence of session headers per request |

---

## 7. Running locally

```bash
# 1. Install dependencies
npm install

# 2. Copy and edit env file
cp .env.example .env
# Set TEMPLATES_DIR to your standard-config checkout:
#   TEMPLATES_DIR=/path/to/standard-config/print-templates

# 3. Start in dev mode (auto-restarts on TypeScript changes)
npm run dev

# 4. Test a render (use a real JSESSIONID from browser DevTools)
curl -s -X POST http://localhost:8080/template-service/api/render \
  -H "Content-Type: application/json" \
  -H "Cookie: JSESSIONID=<your-session-id>" \
  -d '{"templateId":"REG_CARD_V1","locale":"en","context":{"patientUuid":"<uuid>"}}'
```

---

## 8. Running tests

```bash
npm test                         # run all tests
npx jest --testPathPattern=renderer --verbose   # single suite
npx tsc --noEmit                 # type-check only
npm run build                    # compile to dist/
```

Test coverage (as of last run): **67%** statement coverage.

| Suite | What it covers |
|---|---|
| `renderer.test.ts` | Barcode PNG signature, barcode fallback, i18n mtime cache, missing-translation fallback |
| `templateStore.test.ts` | Cache hit, mtime invalidation, missing files, template loading |
| `dataResolver.test.ts` | Source fetching, timeout config, ECONNABORTED mapping |
| `clinical.test.ts` | age, bmi, los, abnormalFlag |
| `collections.test.ts` | groupBy, sortBy, take, map, filter, filterIn |

---

## 9. Adding a new template

All template files live in `standard-config`. No TypeScript changes are needed.

**Step 1 — Create a folder** under `print-templates/`:
```
print-templates/
└── discharge-summary/
    ├── template.html        ← required
    ├── data-config.json     ← optional: declarative data fetching
    └── compute.js           ← optional: full JS data fetching + transformation
```

**Step 2 — Register in `templates.json`:**
```json
{
  "id": "DISCHARGE_V1",
  "name": "Discharge Summary",
  "folder": "discharge-summary",
  "category": "discharge",
  "outputFormats": ["html"],
  "triggers": [
    { "label": "Print Discharge Summary", "shortcutKey": "d" }
  ],
  "config": {
    "facilityName": "City Health Centre"
  }
}
```

**Step 3 — Write `data-config.json` and/or `compute.js`** to declare what data to fetch.

**Step 4 — Write `template.html`** using `{{ computed.* }}`, `{{ compute.* }}`, `{{ config.* }}`, and the built-in Nunjucks filters.

Template edits are live — the mtime cache picks them up on the next request with no service restart.

See the **[Template Authoring Guide](../standard-config/print-templates/TEMPLATE_AUTHORING_GUIDE.md)** for the full reference.
