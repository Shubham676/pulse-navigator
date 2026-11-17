# Pulse Seller Platform

Sales, ads and inventory analytics for Indian Amazon sellers, with an AI copilot and pay-per-run AI agents.
This is the e-commerce (Sellers) product. The Businesses product for Meta, Google and WhatsApp is separate.

One Node.js service serves the web app, the API and a background worker. Data lives in PostgreSQL.

## What works

| Area | Status |
| --- | --- |
| Accounts | Sign-up, sign-in, several brands per account, team invites with owner, admin, member and viewer roles |
| Data in | Upload of 20 Amazon report types (auto-detected from their columns), plus live sync through the Selling Partner API and the Amazon Ads API |
| Analytics | Overview with account health, 8 sales pages, 4 inventory pages, 4 business pages including profit and loss |
| Ads | Overview with rule-based insights, campaign manager (pause, enable, budget, pushed to Amazon when Ads is connected), 7 report tabs, trackers, dayparting (runs automatically on synced campaigns), bid analysis, keyword next steps |
| AI | Copilot answers with Claude when `ANTHROPIC_API_KEY` is set, otherwise with rules. Listing optimizer, listing creator and keyword agents use Claude |
| Wallet | Razorpay top-ups with 18% GST, credited once through either the browser callback or the webhook, GST invoice page, automatic refund when an agent fails |

### Not done yet

- **Image and video agents** (A+, lifestyle, infographic, banner, colour variant, background remover, video) are listed but switched off until an image-generation service is chosen. Set `IMAGE_PROVIDER` once one is integrated in `server/src/routes/ai.js`.
- **Keyword search volumes** need Brand Analytics data; the keyword page uses the seller's own search term results instead.
- **Keyword-level bid changes** are suggestions to copy into Amazon's bulk sheet, because Amazon's reports do not include each keyword's current bid or ID. Campaign status and budgets are pushed.
- **Flipkart, Meesho, Myntra** connections.
- **Alerts by WhatsApp or email.** Alerts show in the bell panel only.
- **Password reset by email.** Needs an email service; until then an admin removes and re-invites the person.

## Run it locally

Needs Node 22 and PostgreSQL 14 or later.

```bash
cd server
npm install
cp ../.env.example ../.env          # then fill in APP_SECRET and DATABASE_URL
export $(grep -v '^#' ../.env | xargs)
npm start                           # creates the tables on first start, serves http://localhost:8080
```

With Docker instead:

```bash
cp .env.example .env                # fill in APP_SECRET and PUBLIC_URL at least
docker compose up --build
```

Sign up, then use **Try with sample data** on the overview to load 90 days of invented reports for a food brand.
`node tools/sample-reports.js <folder>` writes the same sample files if you want to try the upload page by hand.

For a quick trial without Razorpay, set `NODE_ENV=development` and `ALLOW_TEST_CREDIT=true`; wallet top-ups are then credited without payment. Never set this in production.

## Deploy

Any host that runs a Docker container next to a PostgreSQL database works. The worker runs inside the web process, so keep at least one instance always on (no scale-to-zero).

### Recommended: GitHub → Supabase (database) → Render (app) → Cloudflare (domain)

About $7/month to start: Render Starter is paid; Supabase Free and Cloudflare DNS are free.

**1. GitHub.** Create a **private** repository and push this folder. `.env` is in `.gitignore`; never commit real keys.

**2. Supabase (database).**
- Create a project at supabase.com. Pick the Mumbai (ap-south-1) region and save the database password.
- Open **Connect**, choose **Session pooler**, and copy the URI. It looks like `postgresql://postgres.xxxx:[PASSWORD]@aws-0-ap-south-1.pooler.supabase.com:5432/postgres`. Put your password in it.
- Use the session pooler (port 5432), not the transaction pooler (port 6543): the app uses advisory locks and row locks that need session mode.
- The app creates all tables itself on first start. You do not run any SQL.
- Free plan limits: 500 MB database, and the project pauses after 7 days with no activity. The app's background worker keeps it active. Move to Supabase Pro when the database nears 500 MB.

**3. Render (app).**
- On render.com: **New → Blueprint**, connect GitHub, pick the repository. Render reads `render.yaml`.
- Fill in the blank variables: `DATABASE_URL` (the Supabase URI), `PUBLIC_URL` (your final address, e.g. `https://app.yourdomain.com`), and the Amazon, Razorpay, Anthropic and company values you have. Leave unknown ones blank and add them later under **Environment**.
- Deploy. When the logs show the server listening, open the `onrender.com` address and sign up. The first account becomes the owner of its organisation.
- Keep the **Starter** plan. The free plan sleeps after 15 minutes, which stops Amazon syncs and dayparting.
- `APP_SECRET` is generated once. Never change it: it decrypts the saved Amazon keys.

**4. Cloudflare (domain).**
- In Render: the service → **Settings → Custom Domains → Add**, e.g. `app.yourdomain.com`.
- In Cloudflare DNS: add a `CNAME` record from `app` to `your-service.onrender.com`. Wait until Render shows the domain as verified, then you can turn on the orange-cloud proxy.
- Cloudflare → **SSL/TLS**: set the mode to **Full (strict)**.
- Update `PUBLIC_URL` in Render to the new domain.

**Other options.** Any host that runs this Docker image next to PostgreSQL works; keep one instance always on. Railway works the same way as Render. On your own server (VPS or AWS EC2 Mumbai), run `docker compose up -d --build` and put Caddy or Nginx in front for HTTPS. Cloudflare Containers can run the image only with a Worker in front and a minimum of one instance. Neon's free plan is not a good fit: the always-on worker uses up its monthly compute hours.

**Not a fit:** Vercel, Cloudflare Pages or plain Workers (no long-running worker), and Google Sheets as the database (no transactions, 60 requests per minute per user).

**Your own server (VPS or AWS EC2 in Mumbai, for Indian data location).** Install Docker, copy the repository and `.env`, run `docker compose up -d --build`, and put Caddy or Nginx in front for HTTPS. Back up the `pgdata` volume daily.

**Vercel** is not a good fit: it does not keep a long-running worker for Amazon syncs and dayparting.

After deploying:
1. Set `PUBLIC_URL` to the real address, or invite links and Amazon sign-in redirects will point to localhost.
2. In Razorpay, add a webhook to `https://<your-domain>/api/webhooks/razorpay` for `payment.captured` and `order.paid`, with the same secret as `RAZORPAY_WEBHOOK_SECRET`.
3. Set `ALLOW_SIGNUP=false` if only invited people should get in.

## Connecting Amazon

**Our own seller account (works now).** In Seller Central go to Apps and Services > Develop Apps and register as a private developer. Create an app with the roles for orders, inventory, reports and finance, then click Authorize to get a refresh token for your own account. In Pulse, open Data and account > Amazon connections and paste the refresh token with the app's LWA client ID and secret. The first sync pulls 90 days of orders and takes 10 to 30 minutes.

**Other sellers (needs Amazon approval).** Register Pulse as a public developer, get the app listed, then set `AMAZON_LWA_CLIENT_ID`, `AMAZON_LWA_CLIENT_SECRET` and `AMAZON_SP_APP_ID`. Sellers then click Sign in with Amazon. Amazon reviews the app, the website and the data protection policy first; allow several weeks.

**Amazon Ads.** Apply for Amazon Ads API access at advertising.amazon.com/API, create a Login with Amazon security profile, and set `AMAZON_ADS_CLIENT_ID` and `AMAZON_ADS_CLIENT_SECRET`. Add `https://<your-domain>/api/connections/ads-api/oauth/callback` as an allowed return URL.

The Amazon code was tested against a mock of Amazon's APIs, not the real ones. Expect small fixes on the first real sync; check the import history and the connection's error message.

## Project layout

```
server/src/index.js          start-up: migrations, web server, worker
server/src/app.js            security headers, rate limits, routes, static files
server/src/routes/           auth, data, imports, ads, ai, wallet, connections
server/src/parsers/          report readers (CSV, TXT, XLSX) and the 20 report definitions
server/src/amazon/           Login with Amazon, Selling Partner API, Ads API
server/src/jobs/worker.js    Postgres job queue: scheduled syncs, dayparting
server/migrations/           SQL, applied in order on start
web/public/                  the web app (no build step)
tools/                       sample report generator, bulk import
```

## Tests

```bash
createdb pulse_test
cd server && TEST_DATABASE_URL=postgres://.../pulse_test npm test
```

The tests use a mock Amazon, a mock AI model and Razorpay signatures. They cover Amazon sync, uploads, copilot fallback, agent charging and refunds, payments credited exactly once, roles and brand isolation.

## Security notes

- Passwords are hashed with bcrypt; sessions are random tokens stored hashed, in an HTTP-only cookie.
- Amazon refresh tokens and app secrets are encrypted with AES-256-GCM using a key derived from `APP_SECRET`.
- Every API call that changes data needs the `x-pulse` header, which blocks cross-site form attacks.
- Every query is scoped to the signed-in user's current brand.
- Known audit warning: `exceljs` depends on an older `uuid` with a moderate advisory that does not affect how Pulse uses it.
