# X12 834 Benefit Enrollment Converter

A production-ready full-stack web application for bidirectional conversion between flat CSV rosters and HIPAA-compliant ANSI ASC X12 834 (005010X220A1) EDI files.

## Overview

The X12 834 transaction set is the HIPAA standard for communicating benefit enrollment and maintenance information between employers, TPAs, and health insurance payers. This tool converts between a human-friendly CSV format and fully-structured 834 EDI, covering the complete specification including all required and optional loops.

### What it does

- **CSV → EDI**: Upload a member roster CSV, download a standards-compliant 834 EDI file ready to send to a payer
- **EDI → CSV**: Upload any 834 EDI file, extract all member data into a flat CSV for review or processing

---

## Architecture

```
834/
├── server.js                  # Express entry point (port 4000)
├── routes/
│   └── conversion.js          # POST /api/convert/csv-to-edi
│                              # POST /api/convert/edi-to-csv
├── services/
│   └── ediConverter.js        # Core conversion logic (CSV↔EDI)
├── docs/
│   └── sample_members.csv     # Full-featured sample with all 98 columns
└── client/                    # React + Vite frontend (port 5173)
    └── src/
        └── App.jsx            # UI: toggle, drag-drop zone, field reference
```

### Tech stack

| Layer | Technology |
|---|---|
| Backend | Node.js 18+, Express 4 |
| File parsing | multer (memoryStorage), csv-parser, json2csv |
| Frontend | React 18, Vite 5, Tailwind CSS 3 |
| EDI standard | ANSI ASC X12 005010X220A1 |

Files are processed entirely **in memory** — nothing is written to disk.

---

## Getting started

### Prerequisites

- Node.js 18 or higher
- npm 9 or higher

### Install

```bash
# Install backend dependencies
npm install

# Install frontend dependencies
cd client && npm install && cd ..
```

### Run (development)

Open two terminals:

```bash
# Terminal 1 — backend (port 4000)
npm run dev

# Terminal 2 — frontend (port 5173, proxies /api/* to :4000)
npm run client
```

Then open **http://localhost:5173** in a browser.

Alternatively, run both together:

```bash
npm run dev:full
```

### Run (production)

```bash
# Build the React app
cd client && npm run build && cd ..

# Serve everything from Express
NODE_ENV=production npm start
```

The Express server will serve the static React build from `client/dist/` and handle all API calls on port 4000.

### Deploy to Vercel

1. **Push to GitHub**
   ```bash
   git remote add origin https://github.com/your-username/your-repo.git
   git push -u origin main
   ```

2. **Connect to Vercel**
   - Go to [vercel.com](https://vercel.com) and sign in with GitHub
   - Click "Add New" → "Project"
   - Select your repository
   - Vercel will auto-detect the build command (`npm run build`)

3. **Set environment variables** (if needed)
   - In Vercel dashboard → Project Settings → Environment Variables
   - Add `NODE_ENV=production` if not already set

4. **Deploy**
   - Vercel will automatically deploy on every push to `main`
   - Your app will be live at `your-project.vercel.app`

The `vercel.json` configuration tells Vercel to:
- Build the React client first with `npm run build`
- Route `/api/*` and `/*` requests to the Express server
- Serve the React static files from `client/dist/`

---

## API reference

All endpoints accept `multipart/form-data` with a field named `file`.

### `POST /api/convert/csv-to-edi`

Converts a CSV roster to an X12 834 EDI file.

| | |
|---|---|
| **Input** | `.csv` file (max 50 MB) |
| **Output** | `.edi` file download |
| **Success** | `200` with `Content-Disposition: attachment` |
| **Validation error** | `422` with `{ "error": "..." }` |
| **Parse error** | `500` with `{ "error": "..." }` |

### `POST /api/convert/edi-to-csv`

Parses an X12 834 EDI file into a CSV roster.

| | |
|---|---|
| **Input** | `.edi`, `.x12`, `.txt`, or `.834` file (max 50 MB) |
| **Output** | `.csv` file download |
| **Success** | `200` with `Content-Disposition: attachment` |
| **Malformed EDI** | `422` with `{ "error": "..." }` |

### `GET /api/health`

Returns `{ "status": "ok", "ts": "<ISO timestamp>" }`.

---

## CSV format

### Required columns

| Column | Notes |
|---|---|
| `subscriber_id` | Member's plan ID — written to `REF*0F` |
| `first_name` | |
| `last_name` | |
| `dob` | Accepts `YYYY-MM-DD`, `MM/DD/YYYY`, or `YYYYMMDD` |
| `gender` | `M`, `F`, or `U` |
| `effective_date` | Coverage start date (`DTP*348`) |

### Core optional columns

| Column | X12 location | Notes |
|---|---|---|
| `middle_name` | NM1-05 | |
| `ssn` | REF\*SY / NM1-09 | Digits only |
| `name_prefix` | NM1-06 | `Mr.` `Dr.` etc. |
| `name_suffix` | NM1-07 | `Jr.` `Sr.` `III` etc. |
| `relationship_code` | INS-02 | `18`=Self, `01`=Spouse, `19`=Child |
| `maintenance_type_code` | INS-03 | `021`=Add, `030`=Change, `024`=Cancel |
| `maintenance_reason_code` | INS-04 | `25`=Active, `20`=Active FT |
| `employment_status` | INS-08 | `FT`=Full-time, `PT`=Part-time |
| `student_status` | INS-09 | `F`=Full-time, `P`=Part-time |
| `handicap_indicator` | INS-10 | `Y` or `N` |
| `death_date` | INS-11/12 | Member's date of death |
| `confidentiality_code` | INS-13 | `R`=Restricted |
| `birth_sequence` | INS-17 | `1`, `2`… for multiple births |
| `address1`, `address2` | N3 | |
| `city`, `state`, `zip` | N4 | |
| `phone` | PER-04 | Digits only |
| `email` | PER-06 | |
| `marital_status` | DMG-04 | `I`=Single, `M`=Married, `U`=Unknown |
| `race_ethnicity_code` | DMG-05 | |
| `citizenship_status_code` | DMG-06 | `1`=US Citizen |
| `plan_id` | HD-04 | |
| `coverage_type_code` | HD-03 | `HLT`, `DEN`, `VIS` |
| `coverage_level_code` | HD-05 | `EMP`, `FAM`, `ESP`, `ECH` |
| `termination_date` | DTP\*349 | Coverage end date |
| `late_enrollment_indicator` | HD-09 | `Y` or `N` |
| `enrollment_signature_date` | DTP\*300 | |
| `maintenance_effective_date` | DTP\*303 | |
| `last_premium_paid_date` | DTP\*543 | |
| `employer_name`, `employer_id` | N1\*P5 | Loop 1000A — shared across all rows |
| `payer_name`, `payer_id` | N1\*IN | Loop 1000B — shared across all rows |
| `group_number` | REF\*38 | Transaction-level group/policy number |
| `employment_begin_date` | DTP\*336 | |
| `prior_coverage_months` | REF\*QQ | |
| `coverage_amount_qualifier` | AMT-01 | `B9`=Premium, `FK`=Deductible |
| `coverage_amount` | AMT-02 | Dollar amount |
| `id_card_type` | IDC-02 | `H`=Health, `D`=Drug, `P`=Prescription |

### Loop 2100B — Incorrect Member Name

Used to correct a name already on file.

| Column | Notes |
|---|---|
| `incorrect_last_name` | Prior last name — triggers NM1\*70 |
| `incorrect_first_name` | |
| `incorrect_dob` | Prior DOB |
| `incorrect_gender` | Prior gender |

### Loop 2100C — Mailing Address

Separate mailing address when different from residential.

| Column | Notes |
|---|---|
| `mail_address1`, `mail_address2` | Triggers NM1\*31 + N3 |
| `mail_city`, `mail_state`, `mail_zip` | |

### Loop 2100D — Member Employer

Override employer details at the member level.

| Column | Notes |
|---|---|
| `emp_org_name` | Triggers NM1\*36 |
| `emp_org_id` | EIN or other identifier |
| `emp_org_id_qual` | `FI`=Federal Tax ID (default) |
| `emp_org_phone` | HR department phone |
| `emp_org_address1`, `emp_org_city`, `emp_org_state`, `emp_org_zip` | |

### Loop 2100E / F / G / H

| Column | Loop | Notes |
|---|---|---|
| `school_name` | 2100E (NM1\*M8) | Student's school |
| `custodial_last_name`, `custodial_first_name` | 2100F (NM1\*S3) | Custodial parent |
| `responsible_entity_code` | 2100G | `QD`=Other, `GB`=Guardian — see codes below |
| `responsible_last_name`, `responsible_first_name` | 2100G | Responsible person |
| `dropoff_location_name` | 2100H (NM1\*45) | Day-care / drop-off site |
| `dropoff_address1`, `dropoff_city`, `dropoff_state`, `dropoff_zip` | 2100H | |

Valid `responsible_entity_code` values: `6Y` `9K` `E1` `EI` `EXS` `GB` `GD` `J6` `LR` `QD` `S1` `TZ` `X4`

### Loop 2200 — Disability

| Column | Notes |
|---|---|
| `disability_type_code` | `1`=Illness, `2`=Injury, `3`=Pregnancy, `4`=Other — triggers DSB |
| `disability_begin_date` | DTP\*360 |
| `disability_end_date` | DTP\*361 |

### Loop 2310 — Provider

One provider per member row (LX + NM1).

| Column | Notes |
|---|---|
| `provider_entity_code` | `P3`=PCP, `FA`=Facility, `QA`=Dentist, `80`=Hospital, `OD`=Other — triggers LX |
| `provider_entity_type` | `1`=Person, `2`=Non-Person |
| `provider_last_name` | Org name if entity type is 2 |
| `provider_first_name` | |
| `provider_id_qual` | `XX`=NPI, `SV`=Service Provider |
| `provider_id` | NPI or provider number |
| `provider_patient_status` | `25`=Not Yet Assigned, `26`=Enrolled, `72`=Declined |

### Loop 2320/2330 — Coordination of Benefits

One COB entry per member row.

| Column | Notes |
|---|---|
| `cob_payer_responsibility` | `P`=Primary, `S`=Secondary, `T`=Tertiary — triggers COB |
| `cob_group_number` | Other plan's group/policy number |
| `cob_code` | `1`=Subscriber, `5`=Unknown |
| `cob_begin_date` | DTP\*344 |
| `cob_end_date` | DTP\*345 |
| `cob_insurer_name` | COB insurer name (Loop 2330 NM1) |
| `cob_insurer_id_qual` | `XV`=NAIC, `FI`=Federal Tax ID |
| `cob_insurer_id` | Insurer ID |
| `cob_contact_phone` | PER\*CN contact phone |

### Loop 2700 — Reporting Categories

Used to assign members to departments, cost centers, or benefit classes.

| Column | Notes |
|---|---|
| `reporting_category` | Category name — triggers LS\*2700 envelope |
| `reporting_category_ref_qual` | `ZZ`=Mutually Defined, `17`=Department |
| `reporting_category_ref_id` | Category code or ID |
| `reporting_category_date` | DTP\*007 effective date |

---

## X12 834 structure produced

```
ISA   Interchange Control Header
  GS    Functional Group Header
    ST*834         Transaction Set Header
    BGN            Beginning Segment
    REF*38         Transaction Set Policy Number (group)
    N1*P5          Loop 1000A — Sponsor/Employer
    N1*IN          Loop 1000B — Payer

    ── per member ──────────────────────────────────────────
    INS            Loop 2000 — Member (relationship, maint type, INS-08 employment)
    REF*0F         Subscriber ID
    REF*SY         SSN
    REF*1L         Member-level group number (if overriding)
    DTP*336        Employment begin date

    NM1*IL         Loop 2100A — Member Name
    PER*IP         Member contact (phone, email)
    N3, N4         Member residential address
    DMG            DOB, gender, marital status, race, citizenship

    NM1*70         Loop 2100B — Incorrect member name (if present)
    NM1*31         Loop 2100C — Mailing address (if different)
    NM1*36         Loop 2100D — Member employer override (if present)
    NM1*M8         Loop 2100E — School (if student)
    NM1*S3         Loop 2100F — Custodial parent (if present)
    NM1*xx         Loop 2100G — Responsible person (if present)
    NM1*45         Loop 2100H — Drop-off location (if present)

    DSB            Loop 2200 — Disability (if present)
    DTP*360/361    Disability begin/end dates

    HD             Loop 2300 — Health coverage
    DTP*348/349    Coverage begin/end dates
    DTP*300/303    Enrollment signature / maintenance effective dates
    DTP*543        Last premium paid date
    REF*QQ         Prior coverage months
    AMT            Coverage amounts
    IDC            ID card type

    LX             Loop 2310 — Provider (if present)
    NM1*xx         Provider name and ID

    COB            Loop 2320 — COB (if present)
    DTP*344/345    COB begin/end dates
    NM1*IN         Loop 2330 — COB insurer
    PER*CN         COB contact

    LS*2700        Loop 2700 — Reporting categories (if present)
    LX, N1*75      Reporting category name
    REF, DTP*007   Category reference and date
    LE*2700
    ────────────────────────────────────────────────────────

    SE    Transaction Set Trailer (count includes ST + SE)
  GE    Functional Group Trailer
IEA   Interchange Control Trailer
```

### X12 delimiters

| Delimiter | Character | Purpose |
|---|---|---|
| Element separator | `*` | Between elements within a segment |
| Composite separator | `:` | Between sub-elements (composite) |
| Segment terminator | `~` | End of each segment |

The ISA header is fixed-width (106 characters). Delimiters are auto-detected when parsing incoming EDI files.

---

## Known limitations

- **One coverage loop (2300) per member row** — members with multiple simultaneous benefit plans require multiple CSV rows with the same `subscriber_id`.
- **One provider (2310) per row** — for multiple providers, repeat the member row.
- **One COB entry (2320/2330) per row** — same pattern for multiple COB plans.
- **One reporting category (2700) per row** — repeat the row for multiple categories.
- The SE segment count is validated on parse but not enforced on generation beyond correct counting.

---

## Development notes

### Running tests manually

```bash
# Unit test the converter directly
node -e "
const { convertCsvTo834, convert834ToCsv } = require('./services/ediConverter');
// ... your test code
"

# End-to-end via curl (server must be running)
curl -F 'file=@docs/sample_members.csv' http://localhost:4000/api/convert/csv-to-edi
```

### Adding a new segment

1. Add the new CSV column(s) to the `emptyRecord()` factory in `convert834ToCsv`
2. Add the emit call in the correct loop position inside `convertCsvTo834`
3. Add a case or condition in the parser switch inside `convert834ToCsv`
4. Add the new column to `docs/sample_members.csv`
5. Add a row to the field reference table in `client/src/App.jsx`

### Environment variables

| Variable | Default | Notes |
|---|---|---|
| `PORT` | `4000` | Express listen port |
| `NODE_ENV` | `development` | Set to `production` to serve React build |
| `CLIENT_ORIGIN` | — | Extra CORS origin to whitelist |

---

## License

MIT
