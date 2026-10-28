# LEAD·AI Pipeline

One webhook URL → unlimited lead sources → Groq scores → Mailchimp tags → Gmail report lands in your inbox.

---

## Setup (5 minutes)

```bash
# 1. Install
npm install

# 2. Copy env file and fill in your keys
cp .env.example .env

# 3. Run
npm run dev
```

---

## Your keys — where to find them

### Groq
1. Go to https://console.groq.com
2. API Keys → Create new key
3. Paste into `GROQ_API_KEY`

### Mailchimp
1. Account → Extras → API Keys → Create a key
2. Paste into `MAILCHIMP_API_KEY` (includes the `-us21` at the end — keep it)
3. Audience → Settings → Audience name and defaults → Audience ID
4. Paste into `MAILCHIMP_LIST_ID`

### Gmail App Password
1. Go to https://myaccount.google.com/apppasswords
2. Select app: Mail / device: Other → name it "Lead Pipeline"
3. Copy the 16-character password → paste into `GMAIL_APP_PASSWORD`
4. This is NOT your Gmail login password

---

## Connect your sources

All sources point to the same URL, just with a different `?source=` tag:

```
POST https://yourserver.com/webhook/lead?source=typeform
POST https://yourserver.com/webhook/lead?source=contact-form
POST https://yourserver.com/webhook/lead?source=webflow
POST https://yourserver.com/webhook/lead?source=crestivo-site
POST https://yourserver.com/webhook/lead?source=apex-site
```

### Typeform
Settings → Webhooks → Add webhook → paste the URL above

### Webflow
Site Settings → Forms → Notifications → Webhook → paste URL

### Your own HTML form
```html
<form action="https://yourserver.com/webhook/lead?source=contact-form" method="POST">
  <input name="firstName" />
  <input name="email" />
  <input name="company" />
  <input name="message" />
  <button type="submit">Send</button>
</form>
```

### Gravity Forms (WordPress)
Use the "Zapier" or "Webhooks" addon → POST to your URL

---

## What you get in your inbox

Every lead triggers an email to `NOTIFY_EMAIL` with:
- Lead name, email, company, role, source
- AI score (0–100) with visual bar
- Tier: Hot / Warm / Cold
- Urgency: High / Medium / Low
- 2-sentence AI summary
- Tags
- Recommended next action
- Mailchimp status confirmation

Subject line example:
`[Hot · 87/100] New lead: Jane Smith @ Acme Corp`

---

## Deploy (so it's always on)

### Railway (easiest)
1. Push to GitHub
2. railway.app → New Project → Deploy from GitHub
3. Add env variables in Railway dashboard
4. Your webhook URL = `https://your-app.railway.app/webhook/lead`

### Render
1. render.com → New Web Service → connect GitHub
2. Build command: `npm install`
3. Start command: `node server.js`
4. Add env variables

### VPS (DigitalOcean, Linode)
```bash
npm install pm2 -g
pm2 start server.js --name lead-pipeline
pm2 save
pm2 startup
```

---

## Field mapping (auto-handled)

The server automatically maps any of these to the right field:

| Your field name | Also accepts |
|----------------|-------------|
| `firstName`    | `first_name`, `name` (splits on space) |
| `lastName`     | `last_name` |
| `email`        | Typeform email answer type |
| `company`      | `organization` |
| `role`         | `title`, `job_title` |
| `message`      | `note`, `comments`, Typeform long_text |
