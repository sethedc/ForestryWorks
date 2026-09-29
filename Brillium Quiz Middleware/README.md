# Brillium Quiz Middleware (Cloud Run)

A Node.js service that takes Brillium quiz completions, enriches them from the Brillium API,
matches the student and teacher in Airtable, writes a row on **Student Records**, and posts a
structured payload to whatever system sends the teacher email.

```
Brillium webhook
  -> enrich from the Brillium API (assessment + respondent)
  -> match the student in Students, and the teacher linked to that student in Teachers
  -> create a row on Student Records
  -> POST a notification payload (optional)
```

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/webhooks/brillium` | Brillium posts quiz completion data here |
| GET | `/healthz` | Liveness check |

Set `WEBHOOK_SECRET` and the service requires it on every call, either as the header
`x-webhook-secret` or as `?token=`. The Cloud Run URL is public otherwise.

Responses: `200` when handled (including `duplicate` and `needs_review`), `400` when the payload
has no `AID` or `GUID`, `500` when an upstream call failed so Brillium retries.

The response body reports what happened:

```json
{
  "status": "matched",
  "matchedBy": "email",
  "program": "TN Forest Worker",
  "studentRecordId": "recNEWRECORD0001",
  "studentRecordUrl": "https://airtable.com/appwFNJwQTtBif0yT/tblNpWWDu0YSgiark/recNEWRECORD0001",
  "notified": true
}
```

`status` is `matched` when both the student and teacher resolved, `needs_review` when either
did not, and `duplicate` when the same attempt was already on file.

## What it does with a payload

Payload keys are read case-insensitively: `AID`, `GUID`, `GRADE`, `PASSFAIL`, `EMAIL`, `FNAME`,
`LNAME`, plus the custom fields.

1. **Enrich.** GET the assessment by `AID` and the respondent by `GUID` in parallel, then take the
   first record from each. The assessment gives the name and passing score; the respondent gives
   the attempt number, final score, and pass/fail, which fill any gap in the webhook payload.
2. **Deduplicate.** If a Student Records row already carries this `Brillium GUID` and `Attempt #`,
   the service stops and returns `duplicate`. Turn it off with `SKIP_DUPLICATES=false`.
3. **Find the student.** Students by `Email`, then by `Student Name`. A name match with an empty
   email gets the email written back, so the next attempt matches on email.
4. **Find the teacher.** The `Teacher` link on the student record. If the student has no linked
   teacher, the service falls back to the teacher name Brillium carries
   (`BRILLIUM_TEACHER_NAME_FIELD`, default `CUST3`) and looks it up in Teachers by name.
5. **Write the row** on Student Records.
6. **Notify.** POST the structured payload to `NOTIFY_WEBHOOK_URL`. Leave that blank and the
   service writes the row and stops.

### When the student is not in Airtable

`UNMATCHED_STUDENT_MODE` decides:

- `park` (default): the row is written with no `Student` link, the response and notification say
  `needs_review`, and the payload carries the record URL so someone can link it by hand.
- `create`: the service adds the student to the Students table first, with the name, email, grade
  level, and the teacher if one resolved from the Brillium payload, then links the new record.

### Program routing

`src/programs.js` maps the assessment name to the `Program` select. Case-insensitive "contains",
first match wins:

| Program | Assessment name contains |
| --- | --- |
| AL Sawmill Worker | `AL Sawmill Worker`, `AL SW` |
| AL Logging Worker | `AL Logging Worker`, `AL LW` |
| AL Forest Worker | `AL Forest Worker`, `AL FW` |
| GA Forest Worker | `GA Forest Worker`, `GA FW` |
| KY Forest Worker | `KY Forest Worker`, `KY FW` |
| NC Forest Worker | `NC Forest Worker`, `NC FW`, `AN53` |
| TN Forest Worker | `TN Forest Worker`, `TN FW` |
| TX Forest Worker | `TX Forest Worker`, `TX FW` |

Sawmill and Logging sit above the AL Forest Worker rule so an `AL FW` substring cannot steal them.
The eight values match the options on the Program field exactly. A name that matches nothing
leaves Program empty and logs a warning.

### The Student Records row

Written to `tblNpWWDu0YSgiark`, using the field types the base actually has:

| Field | Value |
| --- | --- |
| `Student` | linked record, the matched student |
| `Teacher At Time` | linked record, the matched teacher |
| `Program` | from the assessment name |
| `Assessment Name` | Brillium assessment name |
| `Assessment ID` | webhook `AID` |
| `Assessment Type` | `Exam` when the name contains "exam", else `Quiz` |
| `Attempt #` | respondent `Attempt`, falling back to `TimesTaken` |
| `Pass/Fail` | normalized to `Pass` or `Fail` |
| `Score` | webhook `GRADE`, falling back to the respondent `FinalScore` |
| `Attempt Date` | today in `TIMEZONE` |
| `Semester` | `CURRENT_SEMESTER`, or derived from the attempt date |
| `Grade Level` | the student record's value, else the webhook's `CUST4` |
| `Brillium GUID` | webhook `GUID` |
| `Mailed or Emailed` | `false` |

Single-select values are validated before they are sent, so a bad grade level or pass/fail is
dropped rather than written. `AIRTABLE_TYPECAST=true` exists so the Semester option can roll over
to a new term on its own; the alternative is adding the option in Airtable each semester.

Every field is omitted when empty, so a parked row never carries an empty link.

## The outbound notification

`examples/notification-payload.json` is a full example. Shape:

```
event            "brillium.quiz.completed"
status           matched | needs_review
student          record_id, name, email, grade_level
teacher          record_id, name, school_email, alternate_email, phone, school
assessment       id, name, type, program, passing_score
result           score, pass_fail, attempt, attempt_date, brillium_guid
student_record   id, url
```

The receiving system has everything it needs for the email (teacher name and addresses, student
name, quiz, score, pass/fail, attempt) without calling Airtable.

Set `NOTIFY_WEBHOOK_TOKEN` and it goes out as `Authorization: Bearer`. Set
`NOTIFY_WEBHOOK_SECRET` and each request carries `x-forestryworks-signature:
sha256=<hex>`, an HMAC-SHA256 over the exact JSON body. `NOTIFY_ON=matched` suppresses the
`needs_review` ones.

## Configuration

Copy `.env.example` and fill it in. Required: `BRILLIUM_API_BASE` and `AIRTABLE_TOKEN`. The
Airtable table IDs default to the live base, so the two Brillium settings are the real work:

- `BRILLIUM_ASSESSMENTS_PATH` and `BRILLIUM_RESPONDENTS_PATH` are templates appended to
  `BRILLIUM_API_BASE`, with `{aid}` and `{guid}` substituted. Point them at the exact URLs the two
  `custom_webhook` actions used, and copy the same auth into `BRILLIUM_AUTH_HEADER`,
  `BRILLIUM_API_KEY`, or `BRILLIUM_USERNAME`/`BRILLIUM_PASSWORD`.
- `BRILLIUM_TEACHER_NAME_FIELD` defaults to `CUST3` because the Teachers table notes say teacher
  names live in Brillium Field 3. Check a real payload and correct it if the index differs.

The Airtable token needs `data.records:read` and `data.records:write` on base
`appwFNJwQTtBif0yT`.

## Test it locally

```bash
cd "Brillium Quiz Middleware"
npm install
cp .env.example .env        # fill in your values
set -a && source .env && set +a
npm test                    # 15 unit tests, no network
```

### 1. Check the credentials before anything else

`npm run preflight` reads from Brillium and Airtable and writes nothing. It is the fastest way to
find out whether your Brillium paths and auth are right:

```bash
npm run preflight -- --aid A0HVYA4P6JF7 --guid A9663FEB4B3A4BEBA1A6D2E7B92C2525
```

```
PASS  Configuration: required variables present
PASS  Brillium assessment lookup: "TN FW Module 1 Quiz" -> Program TN Forest Worker, type Quiz, passing score 70
PASS  Brillium respondent lookup: attempt 9 of 9, score 80, student@example.com
PASS  Airtable read: Students: tblO81d82Ulhxz9np, 1 record read
PASS  Airtable read: Teachers: tbl5eFPrtLsStLKQe, 1 record read
PASS  Airtable read: Student Records: tblNpWWDu0YSgiark, 1 record read
PASS  Date and semester: 2026-09-28 -> "Fall 2026" in America/Chicago
PASS  Write mode: live writes; unmatched students: park; notify: not configured
```

Add `--email someone@school.edu` or `--name "Gregory Kulikov"` and it also resolves that student
and their teacher, so you can confirm a real record links the way you expect.

Take the `--aid` and `--guid` from any recent row on Student Records.

### 2. Run the service against real data without writing

`DRY_RUN=true` keeps every lookup live and turns off the two writes and the outbound webhook. The
response carries the exact fields it would have sent to Airtable:

```bash
DRY_RUN=true npm start

curl -sX POST localhost:8080/webhooks/brillium \
  -H 'content-type: application/json' \
  -H "x-webhook-secret: $WEBHOOK_SECRET" \
  -d @examples/sample-webhook.json | jq
```

```json
{
  "status": "matched",
  "matchedBy": "email",
  "program": "TN Forest Worker",
  "dryRun": true,
  "fields": {
    "Assessment Name": "TN FW Module 1 Quiz",
    "Student": ["recdCAFQMi8BPyDfE"],
    "Teacher At Time": ["rec98w3s3zQd55kA2"],
    "Pass/Fail": "Pass",
    "Score": "80"
  }
}
```

Edit `examples/sample-webhook.json` to use a real student email and a real `AID`/`GUID` from your
base, and check that `Student`, `Teacher At Time`, and `Program` come back filled in.

### 3. Let it write one row

Drop `DRY_RUN`, post the same payload, and open the `studentRecordUrl` from the response. Delete
the row afterwards. The second post of the same payload returns `"status": "duplicate"` and writes
nothing, which is the deduplication working.

To watch the outbound payload without a receiving system yet, point `NOTIFY_WEBHOOK_URL` at a
throwaway bin (webhook.site, requestbin) and compare what arrives to
`examples/notification-payload.json`.

## Deploy from the Cloud Console

No terminal needed. Console labels shift from time to time, so match on the nearest wording if one
has moved.

### 1. Pick the branch Cloud Build will watch

The service code lives on `dev/ecstatic-cray-90s5zl`. Either merge it to `main` first, or enter
that branch name in step 4 below. Whatever you pick, every push to it redeploys the service.

### 2. Create the secrets

1. Console search bar, go to **Secret Manager**. Click **Enable** if the API is not on yet.
2. **Create secret**. Name `airtable-token`, paste the Airtable personal access token into
   **Secret value**, click **Create secret**.
3. Repeat for `brillium-api-key` (whatever key or password Brillium needs) and `webhook-secret`
   (any long random string you make up; you will put it on the Brillium URL later).

The Airtable token needs `data.records:read` and `data.records:write` on base
`appwFNJwQTtBif0yT`, set at https://airtable.com/create/tokens.

### 3. Start the service

1. Console search bar, go to **Cloud Run**. Click **Create service**.
2. Choose **Continuously deploy from a repository (source or function)**, then
   **Set up with Cloud Build**.
3. **Repository provider**: GitHub. Authenticate, then install the Google Cloud Build app on
   `sethedc/ForestryWorks` if you are asked. Select the repository. Click **Next**.
4. **Branch**: `^dev/ecstatic-cray-90s5zl$`, or `^main$` if you merged. This field takes a regular
   expression, so keep the `^` and `$`.
5. **Build type**: **Dockerfile**. Source location `/Brillium Quiz Middleware/Dockerfile`, since
   the service lives in a subfolder of the repository. Click **Save**.
6. **Service name**: `brillium-quiz-webhook`. **Region**: `us-central1`, or whichever is closest
   to you.
7. **Authentication**: **Allow unauthenticated invocations** (newer consoles call this
   **Allow public access**). Brillium cannot sign a Google token, which is why `WEBHOOK_SECRET`
   protects the endpoint instead.
8. **Ingress**: **All**.

### 4. Container settings

Expand **Container(s), Volumes, Networking, Security**, then the **Container** section:

| Setting | Value |
| --- | --- |
| Container port | `8080` |
| Request timeout | `120` |
| Memory | `512 MiB` |
| CPU | `1` |
| Maximum number of instances | `10` |

### 5. Variables and secrets

Same panel, **Variables & Secrets** tab.

Under **Environment variables**, click **Add variable** for each:

| Name | Value |
| --- | --- |
| `BRILLIUM_API_BASE` | `https://yoursubdomain.brillium.com/api/v2` |
| `AIRTABLE_BASE_ID` | `appwFNJwQTtBif0yT` |
| `TIMEZONE` | `America/Chicago` |
| `UNMATCHED_STUDENT_MODE` | `park` |
| `NOTIFY_WEBHOOK_URL` | your notifier URL, or leave it out for now |
| `DRY_RUN` | `true` for the first deploy |

Under **Secrets**, click **Reference a secret** for each:

| Secret | Exposed as | Environment variable | Version |
| --- | --- | --- | --- |
| `airtable-token` | Environment variable | `AIRTABLE_TOKEN` | `latest` |
| `brillium-api-key` | Environment variable | `BRILLIUM_API_KEY` | `latest` |
| `webhook-secret` | Environment variable | `WEBHOOK_SECRET` | `latest` |

The console offers to grant the service account the **Secret Manager Secret Accessor** role.
Accept it, or the container fails to start.

Click **Create**. The first build takes two to four minutes.

### 6. Check it came up

1. The service page shows the URL at the top. Open `<URL>/healthz` in a browser. You want
   `{"status":"ok"}`.
2. Open the **Logs** tab. `Listening` means the container started.

### 7. Send a real quiz through

1. In Brillium, point the results webhook at
   `<URL>/webhooks/brillium?token=<the webhook-secret value>`.
2. Take a quiz as a test student.
3. Back on the **Logs** tab, look for `Processing Brillium quiz webhook`, then
   `DRY_RUN, student record not created` with the exact fields it would have written. Check that
   `Student` and `Teacher At Time` carry record IDs and `Program` is right.

To read the secret value: **Secret Manager**, click `webhook-secret`, the **Versions** tab, the
three-dot menu on the latest version, **View secret value**.

### 8. Turn on writing

1. Cloud Run, the service, **Edit & deploy new revision**.
2. **Variables & Secrets**, delete the `DRY_RUN` variable (or set it to `false`).
3. **Deploy**. Take another quiz and confirm the row appears on Student Records.

Every later change works the same way: **Edit & deploy new revision** for settings, a push to the
watched branch for code.

### Testing without a terminal

The service only answers POST, so a browser alone cannot exercise it. Options, in order of how
close they are to the real thing:

1. Take a quiz in Brillium. This is the real payload and the real path.
2. Use a GUI HTTP client (Postman, Insomnia, Hoppscotch in a browser). POST to
   `<URL>/webhooks/brillium`, header `Content-Type: application/json`, header
   `x-webhook-secret: <your secret>`, body from `examples/sample-webhook.json`.
3. To watch the outbound notification, put a webhook.site URL in `NOTIFY_WEBHOOK_URL` and compare
   what lands there to `examples/notification-payload.json`.

Reading the logs: the **Logs** tab on the service, or **Logging** then **Logs Explorer** for
filtering. Every line is JSON with a `severity`, so `severity>=WARNING` narrows it to problems.

## Deploy from the command line

One-time setup:

```bash
PROJECT_ID=your-project
REGION=us-central1

gcloud config set project "$PROJECT_ID"
gcloud services enable run.googleapis.com cloudbuild.googleapis.com \
  artifactregistry.googleapis.com secretmanager.googleapis.com

printf '%s' 'pat_xxx'   | gcloud secrets create airtable-token   --data-file=-
printf '%s' 'xxx'       | gcloud secrets create brillium-api-key --data-file=-
printf '%s' "$(openssl rand -hex 24)" | gcloud secrets create webhook-secret --data-file=-
```

The Airtable token is a personal access token with `data.records:read` and `data.records:write`
on base `appwFNJwQTtBif0yT`.

Deploy:

```bash
gcloud run deploy brillium-quiz-webhook \
  --source . \
  --region "$REGION" \
  --allow-unauthenticated \
  --timeout 120 \
  --memory 512Mi \
  --max-instances 10 \
  --set-env-vars "BRILLIUM_API_BASE=https://yoursubdomain.brillium.com/api/v2,AIRTABLE_BASE_ID=appwFNJwQTtBif0yT,TIMEZONE=America/Chicago,UNMATCHED_STUDENT_MODE=park,NOTIFY_WEBHOOK_URL=https://your-notifier.example.com/hooks/quiz-results" \
  --set-secrets "AIRTABLE_TOKEN=airtable-token:latest,BRILLIUM_API_KEY=brillium-api-key:latest,WEBHOOK_SECRET=webhook-secret:latest"
```

Run it from inside `Brillium Quiz Middleware`, or pass `--source "Brillium Quiz Middleware"` from
the repository root. `--source` builds from the Dockerfile with Cloud Build, so there is nothing to
push by hand.
`--allow-unauthenticated` is needed because Brillium cannot sign a Google IAM token, which is why
`WEBHOOK_SECRET` matters.

Deploy the first version with `DRY_RUN=true` in `--set-env-vars`, send a real quiz through, read
the logs, then redeploy without it.

### Verify the deployment

```bash
URL=$(gcloud run services describe brillium-quiz-webhook --region "$REGION" --format 'value(status.url)')
SECRET=$(gcloud secrets versions access latest --secret webhook-secret)

curl -s "$URL/healthz"

curl -sX POST "$URL/webhooks/brillium?token=$SECRET" \
  -H 'content-type: application/json' \
  -d @examples/sample-webhook.json | jq
```

Then point Brillium at:

```
https://brillium-quiz-webhook-xxxx-uc.a.run.app/webhooks/brillium?token=YOUR_SECRET
```

Take a real quiz in Brillium and watch it land:

```bash
gcloud run services logs tail brillium-quiz-webhook --region "$REGION"
```

Every log line is JSON with a `severity`, so in Cloud Logging you can filter to the failures with
`severity>=WARNING`. The lines to look for are `Processing Brillium quiz webhook`, then
`Created student record` with the record ID and status.

### Updating

```bash
gcloud run deploy brillium-quiz-webhook --source . --region "$REGION"   # code, from this folder
gcloud run services update brillium-quiz-webhook --region "$REGION" \
  --update-env-vars UNMATCHED_STUDENT_MODE=create                       # settings
```

### When something looks wrong

| Symptom | Where to look |
| --- | --- |
| `500` with a Brillium error | `BRILLIUM_*` paths and auth. Run `npm run preflight -- --aid ... --guid ...` |
| `status: needs_review` on every result | the student email in Brillium does not match the Students table. Check with `npm run preflight -- --email ...` |
| Row written with no teacher | the student record has no `Teacher` link, and `CUST3` did not match a teacher name |
| `Program` empty | the assessment name matched no rule in `src/programs.js` |
| `422` from Airtable | a select value outside the options. `AIRTABLE_TYPECAST=true` covers the semester rollover |
| Nothing arrives at all | Brillium is posting to the wrong URL or without `?token=` |
| Cloud Build cannot find `package.json` | the build context is the repository root rather than this folder. Deploy with `gcloud run deploy --source "Brillium Quiz Middleware"` instead |

## Layout

All paths below are relative to `Brillium Quiz Middleware/`.

```
src/server.js           Express app, routing, webhook auth
src/workflow.js         The pipeline, with injectable clients
src/clients/brillium.js Assessment and respondent lookups
src/clients/airtable.js Students, Teachers, Student Records
src/notifier.js         Outbound payload, bearer token, HMAC signature
src/programs.js         Assessment name to Program and Assessment Type
src/airtable-schema.js  Table and field names, with the field IDs noted
src/dates.js            Attempt date and semester
src/config.js           Environment configuration and startup validation
src/http.js             JSON fetch with timeouts and backoff
scripts/preflight.js    Read-only credential and lookup check
test/                   Node test runner specs
```
