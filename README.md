# Brillium Quiz Webhook (Cloud Run)

A Node.js service that replaces the GoHighLevel "Brillium quiz results" workflow. Brillium posts
quiz completions to this service, and the service runs the same steps the workflow ran: Brillium
lookups, CRM contact resolution, program routing, Airtable logging, and the teacher and Maggie
emails.

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/webhooks/brillium` | Brillium posts quiz completion data here |
| GET | `/healthz` | Liveness check |

Set `WEBHOOK_SECRET` and the service requires it on every webhook, either as the header
`x-webhook-secret` or as `?token=`. The Cloud Run URL is public otherwise.

Response codes: `200` when the payload was handled (including the ignored and unlinked cases),
`400` when the payload has no `AID` or `GUID`, `500` when an upstream call failed so the sender
retries.

## What the service does with a payload

The webhook payload keys are read case-insensitively: `AID`, `GUID`, `GRADE`, `PASSFAIL`, `EMAIL`,
`FNAME`, `LNAME`, `CUST4`.

1. Fetch the assessment from Brillium by `AID` and the respondent by `GUID`, then take the first
   record from each response. Both calls run in parallel.
2. Find the CRM contact by email. If none exists, create one with the name, email, and the Grade
   Level custom field from `CUST4`, then email Maggie the "Orphaned Brillium Quiz" notice.
3. Map the quiz name to an FW Program and write it to the contact's FW Program custom field.
4. Stop if the contact carries the `teacher` tag, or if it carries neither `teacher` nor `student`.
5. Find the student in Airtable by email. If that misses, search by student name and write the
   email back onto the record so the next quiz matches by email.
6. Read the linked teacher from the student record, fetch the teacher record, create the attempt
   row, and email the teacher the results (CC alternate email, BCC Maggie).
7. If no student record matches, or the student has no linked teacher, create the attempt row
   without a teacher and email Maggie the "Unlinked Brillium Quiz" notice with a link to the row.

### Program routing

`src/programs.js` holds the rules. Matching is case-insensitive "contains", first match wins:

| Program | Quiz name contains |
| --- | --- |
| AL Sawmill Worker | `AL Sawmill Worker` |
| AL Logging Worker | `AL Logging Worker` |
| AL Forest Worker | `AL Forest Worker`, `AL FW` |
| GA Forest Worker | `GA Forest Worker`, `GA FW` |
| KY Forest Worker | `KY Forest Worker`, `KY FW` |
| NC Forest Worker | `NC Forest Worker`, `NC FW`, `AN53` |
| TN Forest Worker | `TN Forest Worker`, `TN FW` |
| TX Forest Worker | `TX Forest Worker`, `TX FW` |

Sawmill and Logging sit above the AL Forest Worker rule so an "AL FW" substring cannot steal them.
A quiz that matches nothing leaves the FW Program field alone and logs a warning.

### Attempt record fields

Written to `tblNpWWDu0YSgiark`:

`Student`, `Program`, `Teacher At Time`, `Semester`, `Assessment Name`, `Assessment ID`,
`Attempt #`, `Assessment Type` (always `Quiz`), `Pass/Fail`, `Score`, `Brillium GUID`,
`Mailed or Emailed` (always `false`).

`Attempt #` uses the respondent's `Attempt` on the matched paths and `TimesTaken` on the unmatched
path, which is what the workflow did. `Teacher At Time` is sent as an array of record IDs because
it is a linked field. `Student` is sent as text; set `AIRTABLE_ATTEMPT_STUDENT_AS_LINK=true` if
that column is a linked-record field in your base.

## Configuration

Copy `.env.example` and fill it in. Required: `BRILLIUM_API_BASE`, `GHL_API_TOKEN`,
`GHL_LOCATION_ID`, `AIRTABLE_TOKEN`, and `SMTP_HOST` when `EMAIL_TRANSPORT=smtp`. Everything else
has a default.

Two settings deserve attention:

- `BRILLIUM_ASSESSMENTS_PATH` and `BRILLIUM_RESPONDENTS_PATH` are templates appended to
  `BRILLIUM_API_BASE`, with `{aid}` and `{guid}` substituted. Point them at the exact URLs the two
  `custom_webhook` actions used in GHL, and copy the same auth into `BRILLIUM_AUTH_HEADER`,
  `BRILLIUM_API_KEY`, or `BRILLIUM_USERNAME`/`BRILLIUM_PASSWORD`.
- `CURRENT_SEMESTER` replaces `{{custom_values.current_semester}}`. Update it each semester with
  `gcloud run services update`, or move it to Secret Manager if you prefer.

The GHL custom field IDs resolve by name at runtime (`FW Program`, `Grade Level`). Pin them with
`GHL_FW_PROGRAM_FIELD_ID` and `GHL_GRADE_LEVEL_FIELD_ID` to skip that lookup.

## Run it locally

```bash
npm install
cp .env.example .env        # fill in your values
set -a && source .env && set +a
EMAIL_TRANSPORT=console npm start
```

Then post the sample payload:

```bash
curl -X POST localhost:8080/webhooks/brillium \
  -H 'content-type: application/json' \
  -H "x-webhook-secret: $WEBHOOK_SECRET" \
  -d @examples/sample-webhook.json
```

`EMAIL_TRANSPORT=console` prints each email to the log instead of sending it.

Run the tests with `npm test`. They cover the program rules, payload parsing, and all five
branches of the workflow using stubbed clients.

## Deploy to Cloud Run

Store the secrets in Secret Manager first:

```bash
PROJECT_ID=your-project
REGION=us-central1

for name in brillium-api-key ghl-api-token airtable-token smtp-pass webhook-secret; do
  gcloud secrets create "$name" --replication-policy=automatic --project "$PROJECT_ID"
done
# then add a version to each, e.g.
printf '%s' 'the-value' | gcloud secrets versions add ghl-api-token --data-file=- --project "$PROJECT_ID"
```

Deploy from source:

```bash
gcloud run deploy brillium-quiz-webhook \
  --source . \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --allow-unauthenticated \
  --timeout 300 \
  --memory 512Mi \
  --max-instances 10 \
  --set-env-vars "BRILLIUM_API_BASE=https://yoursubdomain.brillium.com/api/v2,GHL_LOCATION_ID=xxxx,CURRENT_SEMESTER=Fall 2026,AIRTABLE_BASE_ID=appwFNJwQTtBif0yT,EMAIL_TRANSPORT=smtp,SMTP_HOST=smtp.sendgrid.net,SMTP_PORT=587,SMTP_USER=apikey,MAIL_FROM=ForestryWorks <no-reply@forestryworks.com>,MAGGIE_EMAIL=mpope@forestryworks.com" \
  --set-secrets "BRILLIUM_API_KEY=brillium-api-key:latest,GHL_API_TOKEN=ghl-api-token:latest,AIRTABLE_TOKEN=airtable-token:latest,SMTP_PASS=smtp-pass:latest,WEBHOOK_SECRET=webhook-secret:latest"
```

`--allow-unauthenticated` is needed because Brillium cannot sign a Google IAM token. The
`WEBHOOK_SECRET` is what protects the endpoint, so set it.

Point Brillium at the service URL:

```
https://brillium-quiz-webhook-xxxx-uc.a.run.app/webhooks/brillium?token=YOUR_SECRET
```

## Differences from the GHL workflow

- The workflow re-fetched the student record from Airtable to read the linked teacher. The search
  response already carries the fields, so that extra call is gone.
- The workflow's "Go To" nodes and duplicated branches collapse into one linear path, so the
  teacher-email and attempt-logging logic exists once instead of twice.
- A student record found without a linked teacher used to fall through the teacher lookup with an
  empty ID. Here it takes the unlinked path: the attempt is still logged and Maggie gets the
  notice.
- The service does not deduplicate. If Brillium retries a delivery you get a second attempt row.
  Add a check against `Brillium GUID` in the Attempts table before creating the row if that turns
  into a problem.

## Layout

```
src/server.js          Express app, routing, webhook auth
src/workflow.js        The workflow, step by step, with injectable clients
src/programs.js        Quiz name to FW Program rules
src/templates.js       The three email bodies
src/mailer.js          SMTP and console transports
src/config.js          Environment configuration and startup validation
src/http.js            JSON fetch with timeouts and backoff
src/clients/           Brillium, GoHighLevel, and Airtable API wrappers
test/                  Node test runner specs
```
