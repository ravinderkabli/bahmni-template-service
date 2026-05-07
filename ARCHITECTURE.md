# Bahmni Template Service — Architecture

## Overview

A Node.js/TypeScript microservice that generates clinical documents (prescriptions, registration cards, etc.) as HTML by fetching data from OpenMRS APIs and rendering Nunjucks templates. The browser handles PDF output via its native print dialog.

## Data Flow

```
React Frontend
    │
    ▼
POST /template-service/api/render
    │
    ├─ 1. TemplateStore   → loads templates.json + data-config.json from /etc/bahmni_config/print-templates (mtime-cached)
    │
    ├─ 2. DataResolver    → fetches data from OpenMRS FHIR/REST APIs in parallel (10s default timeout)
    │
    ├─ 3. ComputedRunner  → runs declarative computed fields (fhirPath, age, BMI, groupBy, etc.)
    │
    ├─ 4. Renderer        → Nunjucks renders template.html with computed data
    │
    └─ 5. HtmlAdapter     → returns HTML
```

## 1. Template Store (`src/templateStore.ts`)

Reads from `/etc/bahmni_config/print-templates/` (configurable via `TEMPLATES_DIR` env var):

```
print-templates/
├── templates.json           ← registry of all templates
└── prescription/
    ├── data-config.json     ← what APIs to call + what to compute
    └── template.html        ← Nunjucks HTML template
```

**`templates.json`** registers each template:
```json
{
  "templates": [{
    "id": "PRESCRIPTION_V1",
    "folder": "prescription",
    "outputFormats": ["html", "pdf"],
    "triggers": [{ "context": "medications", "label": "Print Prescription" }],
    "config": { "facilityName": "City Health Centre" }
  }]
}
```

## 2. Data Resolution (`src/dataResolver.ts`)

**Three modes** based on what the template declares and what the caller sends:

| Mode | Condition | Behavior |
|---|---|---|
| **Fetch** | Sources in data-config, no caller data | Fetches from OpenMRS APIs |
| **Passthrough** | No sources declared, caller provides data | Uses caller data directly |
| **Hybrid** | Sources declared AND caller provides data | Fetches + merges (caller wins conflicts) |

**`data-config.json` sources** declare what to fetch:
```json
{
  "sources": {
    "patient": {
      "api": "fhir",
      "resource": "Patient",
      "params": { "_id": "{{patientUuid}}" }
    },
    "medications": {
      "api": "fhir",
      "resource": "MedicationRequest",
      "params": { "patient": "{{patientUuid}}", "encounter": "{{encounterUuid}}" }
    }
  }
}
```

- `{{patientUuid}}` etc. are substituted from the request `context`
- `api: "fhir"` → calls `/openmrs/ws/fhir2/R4/Patient?_id=...`
- `api: "rest"` → calls `/openmrs/ws/rest/v1/...`
- All sources fetched **in parallel** via `Promise.all()`
- Auth forwarded: `x-openmrs-authorization` header or `JSESSIONID` cookie

### Auth Handling (`AuthHeaders` interface)

```typescript
interface AuthHeaders {
  cookie?: string;
  sessionId?: string;
  authorization?: string;
}
```

Priority order:
1. `x-openmrs-authorization` header (Basic Auth / token)
2. `x-openmrs-session-id` → sent as `JSESSIONID` cookie
3. Raw `cookie` header forwarded as-is

Error behaviour:
- `401` → session expired
- `400` → skip source, return empty Bundle
- `404` → not found

## 3. Computed Fields (`src/computedRunner.ts`)

Declarative transformations applied **in order** (later fields can chain from earlier ones):

```json
{
  "computed": {
    "patientName": { "fn": "fhirPath", "source": "patient", "expr": "Patient.name.first().text" },
    "patientAge":  { "fn": "age",      "source": "patient", "field": "birthDate" },
    "drugRows":    { "fn": "map",       "source": "medications", "fields": { "drug": "MedicationRequest.medication.text" } },
    "byProvider":  { "fn": "groupBy",   "source": "drugRows", "field": "provider" }
  }
}
```

### Built-in Functions (13 total)

| Function | Purpose |
|---|---|
| `fhirPath` | Evaluate FHIRPath expression on a resource |
| `age` | Human-readable age from birthDate |
| `bmi` | BMI from weight + height |
| `los` | Length of stay between two dates |
| `abnormalFlag` | Detect H/L/A flags in observations |
| `map` | Extract fields from array using FHIRPath |
| `groupBy` | Group array items by a field value |
| `sortBy` | Sort array asc/desc by field |
| `filter` | Keep items where field === value |
| `filterIn` | Keep items where field is in a set |
| `take` | First N items |
| `first` | First item only |
| `count` | Array length |

## 4. Template Rendering (`src/renderer.ts`)

Uses **Nunjucks** (JavaScript equivalent of Jinja2). Template receives:

| Variable | Description |
|---|---|
| `computed` | All computed field results |
| `sources` | Raw API responses |
| `config` | Static values from templates.json |
| `locale` | e.g. `"en"`, `"hi"` |
| `now` | Current datetime |

### Custom Filters

| Filter | Purpose |
|---|---|
| `\| t` | i18n translation |
| `\| barcode('code128', 40)` | Barcode PNG (bwip-js) |
| `\| qrcode(200)` | QR code SVG |
| `\| dateFormat` | Locale-aware date formatting |
| `\| age` | Age from birthDate |
| `\| fhirpathEvaluate(expr)` | Inline FHIRPath evaluation |
| `\| round(2)` | Number rounding |

### Example Template

```html
<h3>{{ computed.patientName }}</h3>
<p>Age: {{ computed.patientAge }}</p>
{{ computed.patientId | barcode('code128', 40) }}
{% for drug in computed.drugRows %}
  <p>{{ drug.name }} — {{ drug.dose }}</p>
{% endfor %}
```

## 5. Output Adapter

| Format | Adapter | Content-Type |
|---|---|---|
| `html` | `src/adapters/htmlAdapter.ts` | `text/html` |

PDF output is intentionally not supported by the service — clients (browsers) generate PDFs from the returned HTML via the print dialog.

## API Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/template-service/api/templates` | List all registered templates |
| `POST` | `/template-service/api/render` | Render a template to HTML |
| `GET` | `/template-service/health` | Docker health check |

### Render Request Shape

```json
{
  "templateId": "PRESCRIPTION_V1",
  "format": "html",
  "locale": "en",
  "context": {
    "patientUuid": "abc-123",
    "visitUuid": "xyz-456"
  },
  "data": {}
}
```

## Environment Variables

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8080` | HTTP port |
| `OPENMRS_URL` | `http://openmrs:8080` | OpenMRS base URL |
| `OPENMRS_TIMEOUT_MS` | `10000` | Per-request timeout for OpenMRS HTTP calls |
| `TEMPLATES_DIR` | `/etc/bahmni_config/print-templates` | Template config directory |
| `LOG_LEVEL` | — | Set to `debug` to log incoming session header presence |
| `OPENMRS_USERNAME` | — | Dev-only Basic Auth username |
| `OPENMRS_PASSWORD` | — | Dev-only Basic Auth password |

## Key Design Principles

1. **Zero-code configuration** — templates, data sources, and computed fields declared in JSON/HTML in `standard_config`, not in application code
2. **Parallel data fetching** — all OpenMRS API calls happen simultaneously via `Promise.all()`
3. **Chained computed fields** — later fields can use earlier computed fields as their source
4. **Auth transparency** — browser session forwarded as-is to OpenMRS (no re-login)
5. **Three data modes** — flexible for server-side fetch, client-side pre-fetch, or hybrid
6. **Error resilience** — computed field errors are logged but don't crash; failed fields return `null`
