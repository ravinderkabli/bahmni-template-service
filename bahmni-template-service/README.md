# Bahmni Template Service

A Node.js microservice that renders configurable clinical documents (prescriptions, registration cards, etc.) as HTML or PDF. Templates are stored in `standard_config` — an implementation can change a template without touching React code or redeploying the frontend.

---

## Table of Contents

1. [Why this service exists](#1-why-this-service-exists)
2. [Repository layout](#2-repository-layout)
3. [How it fits into the Bahmni stack](#3-how-it-fits-into-the-bahmni-stack)
4. [Configuration: templates.json](#4-configuration-templatesjson)
5. [Configuration: data-config.json](#5-configuration-data-configjson)
6. [Configuration: template.html](#6-configuration-templatehtml)
7. [Request lifecycle (step by step)](#7-request-lifecycle-step-by-step)
8. [Data modes](#8-data-modes)
9. [Computed field reference](#9-computed-field-reference)
10. [Nunjucks filter reference](#10-nunjucks-filter-reference)
11. [API reference](#11-api-reference)
12. [Authentication](#12-authentication)
13. [Environment variables](#13-environment-variables)
14. [Running locally](#14-running-locally)
15. [Adding a new template](#15-adding-a-new-template)

---

## 1. Why this service exists

- **Config-driven templates.** Nunjucks HTML files live in the `standard_config` Docker volume. An implementer edits a template, restarts nothing, and the next render picks up the change.
- **Consistent PDF output.** Headless Chromium (Puppeteer) produces the same PDF regardless of the user's browser, OS, or printer driver.
- **Reusable clinical logic.** Age, BMI, length-of-stay, abnormal-flag, and collection transforms run in the service as built-in functions — not scattered across React components.
- **No frontend rebuild required.** Adding a field to a prescription means editing `data-config.json` + `template.html` in `standard_config`, not a TypeScript file.

---

## 2. Repository layout

```
bahmni-template-service/
├── src/
│   ├── server.ts           Express app — routes and startup
│   ├── types.ts            All TypeScript interfaces (single source of truth)
│   ├── templateStore.ts    Reads templates.json and individual template files from disk
│   ├── dataResolver.ts     Fetches data from OpenMRS FHIR/REST; handles auth
│   ├── computedRunner.ts   Executes declarative computed field definitions
│   ├── renderer.ts         Nunjucks setup, custom filters, renders HTML
│   ├── builtins/
│   │   ├── fhirPath.ts     FHIRPath evaluation wrapper
│   │   ├── clinical.ts     age, bmi, los, abnormalFlag
│   │   └── collections.ts  groupBy, sortBy, take, map, filter, filterIn
│   └── adapters/
│       ├── htmlAdapter.ts  Wraps rendered HTML in a full <html> document
│       └── pdfAdapter.ts   Puppeteer: HTML → PDF binary
└── ...
```

---

## 3. How it fits into the Bahmni stack

### Request path

```
Browser (React)
  │
  │  POST /template-service/api/render
  ▼
nginx  ──── proxy_pass ────►  template-service:3000  (this service)
                                      │
                             reads templates from
                             /etc/bahmni_config/print-templates/
                             (Docker bind-mount from standard_config)
                                      │
                             fetches patient data from
                             OpenMRS FHIR/REST APIs
                             (JSESSIONID forwarded from browser)
                                      │
                             returns HTML string  or  PDF binary
```

### How templates.json gets into the container

`templates.json` is **never fetched over HTTP**. It lives in `standard_config` and is mounted directly into the container as a read-only volume:

```yaml
# docker-compose.yml
template-service:
  volumes:
    - "${CONFIG_VOLUME}/openmrs:/etc/bahmni_config/:ro"
```

`standard_config/openmrs/apps/clinical/print-templates/` lands at `/etc/bahmni_config/apps/clinical/print-templates/` inside the container. `templateStore.ts` reads it from disk with `fs.readFileSync`.

### Dev proxy (webpack)

During local development (`yarn dev`), the webpack dev server proxies `/template-service` to `http://localhost:8080` so you can run the service locally alongside Bahmni.

---

## 4. Configuration: templates.json

This is the central registry, located at:
```
standard_config/openmrs/print-templates/templates.json
```

It tells the service which templates exist, where their files are, and when to show each print button in the React UI.

```json
{
  "templates": [
    {
      "id": "PRESCRIPTION_V1",
      "name": "Prescription",
      "folder": "prescription",
      "outputFormats": ["html", "pdf"],
      "triggers": [
        { "context": "medications", "label": "Print Prescription" }
      ],
      "config": {
        "facilityName": "City Health Centre",
        "footerText": "Keep this prescription safe."
      }
    },
    {
      "id": "REG_CARD_V1",
      "name": "Registration Card",
      "folder": "registration-card",
      "outputFormats": ["html", "pdf"],
      "triggers": [
        { "context": "patientRegistration", "label": "Print Registration Card" }
      ],
      "config": {
        "facilityName": "City Health Centre"
      }
    }
  ]
}
```

| Field | Description |
|---|---|
| `id` | Unique identifier used in the render API call |
| `name` | Human-readable label (not shown in UI directly) |
| `folder` | Subfolder name under `print-templates/` |
| `outputFormats` | Which formats this template supports: `"html"`, `"pdf"`, or both |
| `triggers[].context` | UI context where the print button should appear (matched by the React app) |
| `triggers[].label` | Button label shown in the UI |
| `config` | Static key-value pairs available in the template as `{{ config.key }}` |

The React frontend calls `GET /template-service/api/templates` on load and uses `triggers` to decide which print buttons to render and where.

---

## 5. Configuration: data-config.json

Each template folder contains a `data-config.json` that declares what data to fetch and how to transform it. No TypeScript changes are needed to add a field.

Location: `print-templates/<folder>/data-config.json`

### Full example (prescription)

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
      "params": {
        "subject": "{{patientUuid}}",
        "encounter": "{{visitUuid}}",
        "status": "active"
      }
    }
  },
  "computed": {
    "patientName":    { "fn": "fhirPath", "source": "patient",    "expr": "Patient.name.first().text" },
    "birthDate":      { "fn": "fhirPath", "source": "patient",    "expr": "Patient.birthDate" },
    "patientId":      { "fn": "fhirPath", "source": "patient",    "expr": "Patient.identifier.first().value" },
    "medicationRows": { "fn": "map",      "source": "medications", "fields": {
      "drugName":  "MedicationRequest.medication.concept.display",
      "dose":      "MedicationRequest.dosageInstruction.first().doseAndRate.first().dose.value",
      "unit":      "MedicationRequest.dosageInstruction.first().doseAndRate.first().dose.unit",
      "frequency": "MedicationRequest.dosageInstruction.first().timing.code.text",
      "provider":  "MedicationRequest.requester.display"
    }},
    "byProvider": { "fn": "groupBy", "source": "medicationRows", "field": "provider" }
  }
}
```

### Sources

`sources` is a map of named data fetches. Each source:

| Field | Description |
|---|---|
| `api` | `"fhir"` → `/openmrs/ws/fhir2/R4`, `"rest"` → `/openmrs/ws/rest/v1` |
| `resource` | FHIR resource type (e.g. `"Patient"`) or REST endpoint (e.g. `"obs"`) |
| `params` | Query parameters. `{{variableName}}` is replaced with values from the render request's `context` |

All sources are fetched in parallel.

### Computed fields

`computed` is an ordered map of named transformations. Fields are processed in order, and a later field **can use an earlier computed field as its source** — enabling chaining. See the [Computed field reference](#9-computed-field-reference) for all available functions.

---

## 6. Configuration: template.html

Location: `print-templates/<folder>/template.html`

This is a standard [Nunjucks](https://mozilla.github.io/nunjucks/) HTML template. Nunjucks is Python's Jinja2 ported to JavaScript — if you know Jinja2, Django templates, or Liquid, the syntax will be familiar.

### Variables available in every template

| Variable | Type | Description |
|---|---|---|
| `computed` | object | All computed field results from `data-config.json` |
| `sources` | object | Raw data fetched from OpenMRS (rarely needed directly) |
| `config` | object | Static values from the `templates.json` entry |
| `locale` | string | BCP 47 locale tag, e.g. `"en"` |
| `now` | Date | Current date/time at render time |

### Example template

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>{{ 'PRESCRIPTION' | t }}</title>
  <style>
    body { font-family: Arial, sans-serif; font-size: 12px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid #ccc; padding: 4px 8px; }
  </style>
</head>
<body>

  <h2>{{ config.facilityName }}</h2>
  <p>{{ now | dateFormat }}</p>

  <h3>{{ computed.patientName }}</h3>
  <p>
    {{ 'AGE' | t }}: {{ computed.birthDate | age }} &nbsp;|&nbsp;
    {{ 'ID' | t }}: {{ computed.patientId }}
  </p>
  <p>{{ computed.patientId | barcode('code128', 40) }}</p>

  {% for provider, meds in computed.byProvider %}
    <h4>{{ provider }}</h4>
    <table>
      <tr>
        <th>{{ 'DRUG' | t }}</th>
        <th>{{ 'DOSE' | t }}</th>
        <th>{{ 'FREQUENCY' | t }}</th>
      </tr>
      {% for med in meds %}
      <tr>
        <td>{{ med.drugName }}</td>
        <td>{{ med.dose }} {{ med.unit }}</td>
        <td>{{ med.frequency }}</td>
      </tr>
      {% endfor %}
    </table>
  {% endfor %}

  <p>{{ config.footerText }}</p>

</body>
</html>
```

### i18n / translations

Translation files live at `print-templates/_i18n/<locale>.json`:

```json
{
  "PRESCRIPTION": "Prescription",
  "AGE": "Age",
  "ID": "Patient ID",
  "DRUG": "Drug",
  "DOSE": "Dose",
  "FREQUENCY": "Frequency"
}
```

The `| t` filter looks up the key in the current locale, falls back to English, then falls back to the raw key string. To show a bilingual label:

```html
{{ 'WEIGHT' | t }} / {{ 'WEIGHT' | t('en') }}
```

---

## 7. Request lifecycle (step by step)

When the user clicks a print button in the React app, this is the full sequence:

```
1. React sends:
   POST /template-service/api/render
   { "templateId": "PRESCRIPTION_V1", "format": "html", "locale": "en",
     "context": { "patientUuid": "abc-123", "visitUuid": "xyz-456" } }

2. server.ts validates the request and looks up the template via templateStore.

3. templateStore.ts reads templates.json from disk
   → finds the "PRESCRIPTION_V1" entry
   → reads prescription/data-config.json
   → confirms prescription/template.html exists
   → returns a LoadedTemplate object.

4. dataResolver.ts fetches all declared sources from OpenMRS in parallel.
   → substitutes {{patientUuid}} etc. from context into URL params
   → forwards the browser's JSESSIONID cookie (or uses Basic Auth in dev)
   → returns { patient: <FHIR Patient>, medications: <FHIR Bundle> }

5. computedRunner.ts runs each computed field declaration in order.
   → "patientName":    evaluates FHIRPath on patient resource → "John Smith"
   → "medicationRows": maps each medication to { drugName, dose, ... }
   → "byProvider":     groups medicationRows by provider field
   → returns { patientName, birthDate, medicationRows, byProvider, ... }

6. renderer.ts renders prescription/template.html with Nunjucks.
   → passes { computed, sources, config, locale, now } to the template
   → custom filters (| t, | barcode, | dateFormat, | age, ...) run inline
   → returns an HTML string.

7. If format=html:  htmlAdapter wraps it in a full <html> doc → response.
   If format=pdf:   pdfAdapter feeds the HTML to headless Chromium → PDF binary → response.

8. React frontend:
   html → displays in <iframe> inside PrintModal → user clicks browser Print
   pdf  → creates an object URL from the Blob → triggers browser file download
```

---

## 8. Data modes

The service auto-detects which mode to use based on the request and the template's `data-config.json`. There is no explicit mode field.

| `data-config` has `sources`? | Request has `data`? | Mode | What happens |
|---|---|---|---|
| Yes | No | **Fetch** | Service fetches everything from OpenMRS |
| No | Yes | **Passthrough** | Renders directly with caller-supplied data |
| Yes | Yes | **Hybrid** | Fetches from OpenMRS, then merges with caller data. Caller data wins on key conflicts |
| No | No | (empty) | Template renders with no data — useful for static documents |

**Passthrough / Hybrid** are useful when the frontend already has the data in memory (e.g. a medication list already loaded in the React component) and you want to avoid a redundant OpenMRS round-trip.

---

## 9. Computed field reference

All functions are declared in `data-config.json`. A computed field can use either a `sources` key or a previously declared `computed` key as its `source`, enabling chaining.

### fhirPath
Evaluates a FHIRPath expression against a source resource.
```json
{ "fn": "fhirPath", "source": "patient", "expr": "Patient.name.first().text" }
```

### age
Computes a human-readable age string from a birthDate field.
```json
{ "fn": "age", "source": "patient", "field": "Patient.birthDate" }
```
Output: `"32 years"`, `"4 months"`, or `"14 days"` (neonates under 1 month).

### bmi
Computes BMI from weight (kg) and height (cm) fields.
```json
{ "fn": "bmi", "weightSource": "obs", "weightField": "...", "heightSource": "obs", "heightField": "..." }
```

### los
Computes length of stay between two date fields (admission to discharge, or to now if discharge is absent).
```json
{ "fn": "los", "admissionSource": "encounter", "admissionField": "Encounter.period.start",
                "dischargeSource": "encounter", "dischargeField": "Encounter.period.end" }
```

### abnormalFlag
Returns `true` if a FHIR Observation resource has an abnormal interpretation code (`H`, `HH`, `L`, `LL`, `A`, `AA`).
```json
{ "fn": "abnormalFlag", "source": "labResult" }
```

### map
Extracts multiple FHIRPath fields from each item in an array. Returns a flat array of plain objects — ideal for table rows.
```json
{ "fn": "map", "source": "medications", "fields": {
    "drugName":  "MedicationRequest.medication.concept.display",
    "dose":      "MedicationRequest.dosageInstruction.first().doseAndRate.first().dose.value"
}}
```

### groupBy
Groups an array by a named field value. Returns `{ fieldValue: [items...] }`.
```json
{ "fn": "groupBy", "source": "medicationRows", "field": "provider" }
```

### sortBy
Sorts an array by a named field.
```json
{ "fn": "sortBy", "source": "medicationRows", "field": "drugName", "dir": "asc" }
```
`dir` is optional, defaults to `"asc"`.

### take
Returns the first N items from an array.
```json
{ "fn": "take", "source": "medicationRows", "n": 5 }
```

### filter
Filters an array where `field === value`.
```json
{ "fn": "filter", "source": "medicationRows", "field": "status", "value": "active" }
```

### filterIn
Filters an array where `field` is one of the given values. `values` can be a JSON array or a comma-separated string — useful when the list comes from a context variable (e.g. `"values": "{{selectedIds}}"`).
```json
{ "fn": "filterIn", "source": "medicationRows", "field": "status", "values": ["active", "completed"] }
```

### first
Returns the first item from an array, or `null` if empty.
```json
{ "fn": "first", "source": "medicationRows" }
```

### count
Returns the length of an array.
```json
{ "fn": "count", "source": "medicationRows" }
```

---

## 10. Nunjucks filter reference

Custom filters are registered in `renderer.ts` and available in every template.

### `| t`
Translates a string key using the current locale. Falls back to English, then to the raw key.
```html
{{ 'PATIENT_NAME' | t }}
{{ 'WEIGHT' | t('fr') }}      {# force a specific locale #}
```

### `| barcode(type, height)`
Generates a barcode as a base64-encoded PNG `<img>` tag. `type` is any valid [bwip-js bcid](https://github.com/metafloor/bwip-js/wiki/BWIPP-Barcode-Types). Output is marked safe — no need to add `| safe`.
```html
{{ computed.patientId | barcode('code128', 40) }}
{{ computed.patientId | barcode('qrcode', 80) }}
```

### `| qrcode(size)`
Generates a QR code as an inline SVG. Output is marked safe.
```html
{{ computed.patientUuid | qrcode(120) }}
```

### `| dateFormat`
Formats an ISO 8601 date string to a locale-aware human-readable date.
```html
{{ computed.visitDate | dateFormat }}   {# → "15 January 2024" #}
```

### `| age`
Computes age from a birthDate string.
```html
{{ computed.birthDate | age }}          {# → "32 years" #}
```

### `| fhirpathEvaluate(expression)`
Evaluates a FHIRPath expression inline in the template. Use sparingly — prefer computed fields in `data-config.json`. Useful for per-row fields inside `{% for %}` loops.
```html
{% for med in sources.medications.entry %}
  {{ med.resource | fhirpathEvaluate("MedicationRequest.status") }}
{% endfor %}
```

### `| round(decimals)`
Rounds a number to N decimal places.
```html
{{ computed.bmi | round(1) }}           {# → "24.3" #}
```

---

## 11. API reference

### `GET /template-service/api/templates`

Returns the list of all registered templates. The React frontend calls this on load to determine which print buttons to show and where.

**Response**
```json
{
  "templates": [
    {
      "id": "PRESCRIPTION_V1",
      "name": "Prescription",
      "outputFormats": ["html", "pdf"],
      "triggers": [
        { "context": "medications", "label": "Print Prescription" }
      ]
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
  "templateId": "PRESCRIPTION_V1",
  "format": "html",
  "locale": "en",
  "context": {
    "patientUuid": "abc-123",
    "visitUuid":   "xyz-456"
  }
}
```

| Field | Required | Default | Description |
|---|---|---|---|
| `templateId` | Yes | — | Must match an `id` in `templates.json` |
| `format` | No | `"html"` | `"html"` or `"pdf"` |
| `locale` | No | `"en"` | BCP 47 language tag |
| `context` | No | `{}` | Key-value pairs substituted into `data-config.json` source params |
| `data` | No | — | Pre-fetched data (passthrough / hybrid mode) |

**Responses**

| Status | Content-Type | Body |
|---|---|---|
| 200 | `text/html` | Full HTML document (format=html) |
| 200 | `application/pdf` | PDF binary (format=pdf) |
| 400 | `application/json` | `{ "error": "..." }` — missing/invalid fields |
| 401 | `application/json` | `{ "error": "OpenMRS session expired..." }` |
| 404 | `application/json` | `{ "error": "Template not found: ..." }` |
| 502 | `application/json` | `{ "error": "OpenMRS API unreachable" }` |

---

### `GET /template-service/health`

Docker health check. Returns `{ "status": "ok", "timestamp": "..." }`.

---

## 12. Authentication

The service needs to call OpenMRS on behalf of the logged-in user. Two auth strategies are supported, selected automatically:

| Environment | Strategy | How |
|---|---|---|
| Production (Docker) | Session cookie forwarding | The browser's `JSESSIONID` cookie from the render request is forwarded to OpenMRS. No credentials stored in the service. |
| Local development | Basic Auth | Set `OPENMRS_USERNAME` + `OPENMRS_PASSWORD` in `.env`. The service uses Basic Auth for every OpenMRS call. |

If both are set, Basic Auth takes precedence.

---

## 13. Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Port the service listens on |
| `OPENMRS_URL` | `http://openmrs:8080` | Base URL for OpenMRS (internal Docker hostname in prod) |
| `TEMPLATES_DIR` | `/etc/bahmni_config/apps/clinical/print-templates` | Absolute path to the templates directory inside the container |
| `CHROMIUM_PATH` | _(auto-detected)_ | Path to Chromium binary. Required for PDF rendering. Provided by the Playwright Docker base image. |
| `OPENMRS_USERNAME` | — | Basic Auth username (local dev only) |
| `OPENMRS_PASSWORD` | — | Basic Auth password (local dev only) |

Copy `.env.example` to `.env` for local development.

---

## 14. Running locally

```bash
# Install dependencies
npm install

# Start in dev mode (auto-restarts on file change)
npm run dev

# Run tests
npm test

# Build for production
npm run build
npm start
```

The service starts on the port set in `.env` (`.env.example` defaults to `8080`). Point `OPENMRS_URL` at your local OpenMRS instance and set Basic Auth credentials in `.env`.

---

## 15. Adding a new template

Everything happens in `standard_config`. No TypeScript changes needed.

**Step 1 — Create a folder** under `openmrs/print-templates/`:
```
print-templates/
└── discharge-summary/
    ├── data-config.json
    └── template.html
```

**Step 2 — Write `data-config.json`** — declare what to fetch and how to transform it. See [Section 5](#5-configuration-data-configjson) and [Section 9](#9-computed-field-reference).

**Step 3 — Write `template.html`** — use `{{ computed.* }}`, `{{ config.* }}`, and the built-in filters. See [Section 6](#6-configuration-templatehtml) and [Section 10](#10-nunjucks-filter-reference).

**Step 4 — Register in `templates.json`**:
```json
{
  "id": "DISCHARGE_SUMMARY_V1",
  "name": "Discharge Summary",
  "folder": "discharge-summary",
  "outputFormats": ["html", "pdf"],
  "triggers": [
    { "context": "discharge", "label": "Print Discharge Summary" }
  ],
  "config": {
    "facilityName": "City Health Centre"
  }
}
```

**Step 5 — Wire the trigger in the React app.** The frontend reads `triggers[].context` from the API and maps it to the component that renders the print button. Add the matching context string there.

No service restart needed for Step 1–4. `templateStore.ts` reads from disk on every request (no in-memory cache). A service restart is only needed if you change environment variables.
