/**
 * LEAD·AI PIPELINE SERVER
 * ─────────────────────────────────────────────
 * One webhook URL. Unlimited sources.
 * Groq → Mailchimp → Gmail notification
 *
 * Deploy to: Railway / Render / VPS
 * Run locally: npm run dev
 */

import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import nodemailer from "nodemailer";
import crypto from "crypto";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // needed for HTML form POSTs

// ─────────────────────────────────────────────
//  GROQ — AI Lead Analysis
// ─────────────────────────────────────────────
async function analyzeLeadWithGroq(lead) {
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: "llama3-8b-8192",
      messages: [
        {
          role: "system",
          content: `You are a lead scoring AI for a marketing agency. 
Return ONLY a valid JSON object — no markdown, no explanation — with these exact fields:
{
  "score": <number 0-100>,
  "tier": <"Hot" | "Warm" | "Cold">,
  "summary": <string, 2 sentences max>,
  "tags": [<string>, <string>, <string>],
  "nextAction": <string, one clear action>,
  "mailchimpTag": <string, one word tag for Mailchimp segmentation>,
  "urgency": <"High" | "Medium" | "Low">
}`,
        },
        {
          role: "user",
          content: `Analyze this inbound lead and score them:
Name: ${lead.firstName} ${lead.lastName}
Email: ${lead.email}
Company: ${lead.company || "Unknown"}
Role: ${lead.role || "Unknown"}
Source: ${lead.source || "Website"}
Message: ${lead.message || "None provided"}`,
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`Groq API error: ${response.status}`);
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content || "{}";

  try {
    return JSON.parse(text.replace(/```json|```/g, "").trim());
  } catch {
    // Fallback if JSON parse fails
    return {
      score: 50,
      tier: "Warm",
      summary: "Lead received. Manual review recommended.",
      tags: ["inbound", lead.source || "web", "review"],
      nextAction: "Review manually and follow up within 24 hours.",
      mailchimpTag: "inbound",
      urgency: "Medium",
    };
  }
}

// ─────────────────────────────────────────────
//  MAILCHIMP — Subscribe + Tag
// ─────────────────────────────────────────────
async function subscribeToMailchimp(lead, analysis) {
  const API_KEY = process.env.MAILCHIMP_API_KEY;
  const LIST_ID = process.env.MAILCHIMP_LIST_ID;
  const DC = API_KEY.split("-").pop(); // e.g. "us21"

  const emailHash = crypto
    .createHash("md5")
    .update(lead.email.toLowerCase())
    .digest("hex");

  const url = `https://${DC}.api.mailchimp.com/3.0/lists/${LIST_ID}/members/${emailHash}`;

  const body = {
    email_address: lead.email,
    status_if_new: "subscribed",
    merge_fields: {
      FNAME: lead.firstName || "",
      LNAME: lead.lastName || "",
      COMPANY: lead.company || "",
    },
    tags: [
      analysis.tier,
      analysis.mailchimpTag,
      lead.source || "website",
    ].filter(Boolean),
  };

  const response = await fetch(url, {
    method: "PUT", // PUT = upsert (add if new, update if exists)
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${Buffer.from(`anystring:${API_KEY}`).toString("base64")}`,
    },
    body: JSON.stringify(body),
  });

  const data = await response.json();

  if (!response.ok && data.title !== "Member Exists") {
    throw new Error(`Mailchimp error: ${data.detail || data.title}`);
  }

  return { success: true, status: data.status };
}

// ─────────────────────────────────────────────
//  GMAIL SMTP — Send Score Report to You
// ─────────────────────────────────────────────
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.GMAIL_USER,           // your Gmail address
    pass: process.env.GMAIL_APP_PASSWORD,   // Gmail App Password (not your login password)
  },
});

function getTierColor(tier) {
  return tier === "Hot" ? "#EF4444" : tier === "Warm" ? "#F59E0B" : "#3B82F6";
}

async function sendEmailReport(lead, analysis, mailchimpResult) {
  const tierColor = getTierColor(analysis.tier);
  const scoreBar = Math.round((analysis.score / 100) * 20); // 0-20 blocks
  const scoreViz = "█".repeat(scoreBar) + "░".repeat(20 - scoreBar);

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#060A14;font-family:Arial,sans-serif;">
  <div style="max-width:580px;margin:0 auto;padding:32px 24px;">
    
    <!-- Header -->
    <div style="margin-bottom:28px;">
      <span style="background:#1D4ED8;color:#fff;font-size:11px;letter-spacing:0.1em;padding:4px 10px;border-radius:4px;text-transform:uppercase;">
        ⚡ LEAD·AI PIPELINE
      </span>
      <h1 style="color:#E2E8F0;font-size:22px;margin:12px 0 4px;">New Lead Scored</h1>
      <p style="color:#475569;font-size:13px;margin:0;">${new Date().toLocaleString("en-US", { dateStyle: "full", timeStyle: "short" })}</p>
    </div>

    <!-- Lead Info -->
    <div style="background:#0B1120;border:1px solid #1E293B;border-radius:10px;padding:20px;margin-bottom:16px;">
      <p style="color:#64748B;font-size:10px;letter-spacing:0.1em;text-transform:uppercase;margin:0 0 12px;">Contact</p>
      <h2 style="color:#E2E8F0;font-size:18px;margin:0 0 6px;">${lead.firstName} ${lead.lastName}</h2>
      <p style="color:#94A3B8;font-size:14px;margin:0 0 4px;">📧 ${lead.email}</p>
      ${lead.company ? `<p style="color:#94A3B8;font-size:14px;margin:0 0 4px;">🏢 ${lead.company}${lead.role ? ` · ${lead.role}` : ""}</p>` : ""}
      <p style="color:#475569;font-size:12px;margin:8px 0 0;">Source: <strong style="color:#64748B;">${lead.source || "Website"}</strong></p>
    </div>

    <!-- Score -->
    <div style="background:#0B1120;border:1px solid #1E293B;border-radius:10px;padding:20px;margin-bottom:16px;">
      <p style="color:#64748B;font-size:10px;letter-spacing:0.1em;text-transform:uppercase;margin:0 0 14px;">AI Score</p>
      <div style="display:flex;align-items:center;gap:16px;margin-bottom:14px;">
        <div style="text-align:center;min-width:72px;">
          <div style="font-size:42px;font-weight:700;color:${tierColor};line-height:1;">${analysis.score}</div>
          <div style="font-size:10px;color:#475569;margin-top:2px;">/ 100</div>
        </div>
        <div>
          <span style="background:${tierColor}22;color:${tierColor};border:1px solid ${tierColor};border-radius:4px;padding:3px 12px;font-size:12px;font-weight:600;">${analysis.tier}</span>
          <span style="margin-left:8px;background:#1E3A5F;color:#60A5FA;border-radius:4px;padding:3px 10px;font-size:12px;">Urgency: ${analysis.urgency}</span>
        </div>
      </div>
      <div style="font-family:monospace;font-size:13px;color:${tierColor};letter-spacing:2px;margin-bottom:14px;">${scoreViz} ${analysis.score}%</div>
      <p style="color:#94A3B8;font-size:14px;line-height:1.6;margin:0 0 14px;">${analysis.summary}</p>
      <div style="display:flex;gap:6px;flex-wrap:wrap;">
        ${(analysis.tags || []).map(t => `<span style="background:#1E293B;color:#64748B;border-radius:4px;padding:2px 8px;font-size:11px;font-family:monospace;">${t}</span>`).join("")}
      </div>
    </div>

    <!-- Next Action -->
    <div style="background:#052E16;border:1px solid #166534;border-radius:10px;padding:16px;margin-bottom:16px;">
      <p style="color:#4ADE80;font-size:10px;letter-spacing:0.1em;text-transform:uppercase;margin:0 0 6px;">Recommended Next Action</p>
      <p style="color:#E2E8F0;font-size:15px;font-weight:600;margin:0;">→ ${analysis.nextAction}</p>
    </div>

    <!-- Mailchimp Status -->
    <div style="background:#0B1120;border:1px solid #1E293B;border-radius:10px;padding:14px;margin-bottom:24px;">
      <p style="color:#64748B;font-size:10px;letter-spacing:0.1em;text-transform:uppercase;margin:0 0 6px;">Mailchimp</p>
      <p style="color:${mailchimpResult.success ? "#10B981" : "#F59E0B"};font-size:13px;margin:0;">
        ${mailchimpResult.success ? `✅ Added to list with tags: ${analysis.tier} · ${analysis.mailchimpTag}` : "⚠️ Mailchimp update had an issue — check manually"}
      </p>
    </div>

    ${lead.message ? `
    <!-- Original Message -->
    <div style="background:#0B1120;border:1px solid #1E293B;border-radius:10px;padding:16px;margin-bottom:24px;">
      <p style="color:#64748B;font-size:10px;letter-spacing:0.1em;text-transform:uppercase;margin:0 0 8px;">Original Message</p>
      <p style="color:#94A3B8;font-size:13px;line-height:1.6;margin:0;font-style:italic;">"${lead.message}"</p>
    </div>
    ` : ""}

    <!-- Footer -->
    <p style="color:#1E293B;font-size:11px;text-align:center;margin:0;font-family:monospace;">
      LEAD·AI · Groq + Mailchimp + Gmail · Auto-generated
    </p>
  </div>
</body>
</html>`;

  await transporter.sendMail({
    from: `"LEAD·AI Pipeline" <${process.env.GMAIL_USER}>`,
    to: process.env.NOTIFY_EMAIL || process.env.GMAIL_USER,
    subject: `[${analysis.tier} · ${analysis.score}/100] New lead: ${lead.firstName} ${lead.lastName} ${lead.company ? `@ ${lead.company}` : ""}`,
    html,
  });
}

// ─────────────────────────────────────────────
//  NORMALIZE — Map any source format to lead shape
// ─────────────────────────────────────────────
function normalizeLead(body, source) {
  // Handles: your own form, Typeform, Webflow, Gravity Forms, raw POST
  return {
    firstName:
      body.firstName ||
      body.first_name ||
      body.answers?.find(a => a.field?.ref === "first_name")?.text ||
      (body.name || "").split(" ")[0] ||
      "Unknown",

    lastName:
      body.lastName ||
      body.last_name ||
      body.answers?.find(a => a.field?.ref === "last_name")?.text ||
      (body.name || "").split(" ").slice(1).join(" ") ||
      "",

    email:
      body.email ||
      body.answers?.find(a => a.type === "email")?.email ||
      "",

    company:
      body.company ||
      body.organization ||
      body.answers?.find(a => a.field?.ref === "company")?.text ||
      "",

    role:
      body.role ||
      body.title ||
      body.job_title ||
      body.answers?.find(a => a.field?.ref === "role")?.text ||
      "",

    message:
      body.message ||
      body.note ||
      body.comments ||
      body.answers?.find(a => a.field?.type === "long_text")?.text ||
      "",

    source: source || body.source || body._source || "website",
  };
}

// ─────────────────────────────────────────────
//  MAIN WEBHOOK — POST /webhook/lead
//
//  Point ALL your sources here:
//  - Typeform:      https://yourserver.com/webhook/lead?source=typeform
//  - Contact form:  https://yourserver.com/webhook/lead?source=contact-form
//  - Webflow:       https://yourserver.com/webhook/lead?source=webflow
//  - Any form:      https://yourserver.com/webhook/lead?source=anything
// ─────────────────────────────────────────────
app.post("/webhook/lead", async (req, res) => {
  const source = req.query.source || req.body.source || "website";

  // Acknowledge immediately (Typeform requires fast response)
  res.status(200).json({ received: true, source });

  let lead;
  try {
    lead = normalizeLead(req.body, source);
  } catch (err) {
    console.error("Normalization error:", err.message);
    return;
  }

  if (!lead.email) {
    console.warn("⚠️  Lead received with no email — skipped:", source);
    return;
  }

  console.log(`\n📥 Lead received [${source}]: ${lead.firstName} ${lead.lastName} <${lead.email}>`);

  // Run pipeline steps
  let analysis, mailchimpResult;

  try {
    console.log("⚡ Running Groq analysis…");
    analysis = await analyzeLeadWithGroq(lead);
    console.log(`   Score: ${analysis.score} · Tier: ${analysis.tier} · Urgency: ${analysis.urgency}`);
  } catch (err) {
    console.error("❌ Groq failed:", err.message);
    analysis = {
      score: 50, tier: "Warm", urgency: "Medium",
      summary: "AI analysis failed. Manual review needed.",
      tags: ["review", source], nextAction: "Follow up manually.",
      mailchimpTag: "review",
    };
  }

  try {
    console.log("📧 Adding to Mailchimp…");
    mailchimpResult = await subscribeToMailchimp(lead, analysis);
    console.log(`   Status: ${mailchimpResult.status}`);
  } catch (err) {
    console.error("❌ Mailchimp failed:", err.message);
    mailchimpResult = { success: false };
  }

  try {
    console.log("📨 Sending email report…");
    await sendEmailReport(lead, analysis, mailchimpResult);
    console.log(`   ✅ Email sent to ${process.env.NOTIFY_EMAIL || process.env.GMAIL_USER}`);
  } catch (err) {
    console.error("❌ Email failed:", err.message);
  }

  console.log(`✅ Pipeline complete for ${lead.email}\n`);
});

// ─────────────────────────────────────────────
//  HEALTH CHECK
// ─────────────────────────────────────────────
app.get("/", (_, res) => {
  res.json({
    status: "LEAD·AI Pipeline running",
    webhook: `POST /webhook/lead?source=YOUR_SOURCE`,
    timestamp: new Date().toISOString(),
  });
});

app.listen(PORT, () => {
  console.log(`\n🚀 LEAD·AI Pipeline running on port ${PORT}`);
  console.log(`   Webhook: POST http://localhost:${PORT}/webhook/lead`);
  console.log(`   Health:  GET  http://localhost:${PORT}/\n`);
});
