// Branded contact-form emails, sent server-side from the /website-contact httpAction.
// Office copy -> selfie@selfiebox.co.za, customer copy -> the submitter.
const IMG_BASE = "https://selfiebox.co.za/email-assets";
const NAVY = "#070f24", CARD = "#ffffff", INK = "#14203a", MUTED = "#5b6b86",
  LINE = "#e6ecf5", ACCENT = "#2f9fed", ACC2 = "#54d4ff",
  FONT = "-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif";

function esc(v) {
  return String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function s(v) { return String(v == null ? "" : v).trim(); }
function row(label, value, accent) {
  if (!s(value)) return "";
  const vstyle = accent ? `color:${ACCENT};font-weight:700` : `color:${INK};font-weight:600`;
  return `<tr><td style="padding:11px 0;border-bottom:1px solid ${LINE};font:500 12px/1.4 ${FONT};letter-spacing:.04em;text-transform:uppercase;color:${MUTED};white-space:nowrap;vertical-align:top;width:42%">${esc(label)}</td>`
    + `<td style="padding:11px 0 11px 18px;border-bottom:1px solid ${LINE};font:400 15px/1.5 ${FONT};${vstyle};text-align:right">${esc(value)}</td></tr>`;
}
function secHead(t) {
  return `<div style="font:700 12px/1 ${FONT};letter-spacing:.14em;text-transform:uppercase;color:${ACCENT}">${esc(t)}</div>`
    + `<div style="height:2px;width:34px;margin-top:8px;background:linear-gradient(90deg,${ACCENT},${ACC2})"></div>`;
}
function section(title, rowsHtml) {
  if (!rowsHtml) return "";
  return `<tr><td style="padding:24px 32px 6px">${secHead(title)}</td></tr>`
    + `<tr><td style="padding:2px 32px 4px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">${rowsHtml}</table></td></tr>`;
}
function messageBlock(msg) {
  if (!s(msg)) return "";
  return `<tr><td style="padding:24px 32px 4px">${secHead("Message")}<div style="height:12px;line-height:12px">&nbsp;</div>`
    + `<div style="font:400 15px/1.65 ${FONT};color:${INK};background:#f7fafe;border:1px solid ${LINE};border-left:3px solid ${ACCENT};border-radius:10px;padding:16px 18px">${esc(msg)}</div></td></tr>`;
}

function buildContactEmailHtml(fd, variant, ref, received) {
  const first = (s(fd.name) || "there").split(" ")[0];
  const eyebrow = variant === "customer" ? "Message Received" : "Website Contact Request";

  const details = variant === "office"
    ? section("Contact Details", row("Name", fd.name, true) + row("Email", fd.email)
        + row("Phone", fd.phone) + row("Event type", fd.eventType))
    : section("Your Enquiry", row("Event type", fd.eventType, true));

  const thanks = variant === "customer"
    ? `<tr><td style="padding:24px 32px 6px"><div style="font:700 18px/1.35 ${FONT};color:${INK}">Thanks for reaching out, ${esc(first)}! 🎉</div>`
      + `<div style="margin-top:12px;font:400 15px/1.7 ${FONT};color:#41506e">Your message has landed safely with the SelfieBox team and we'll be in touch very soon. We love a good celebration, and we can't wait to hear more about what you're planning.<br><br>We've popped a copy of your message below for your records. Need to add anything? Just <b style="color:${ACCENT}">reply to this email</b> and it'll come straight to us.</div></td></tr>`
      + `<tr><td style="padding:18px 32px 0"><div style="border-top:1px solid ${LINE};font-size:0;line-height:0">&nbsp;</div></td></tr>`
    : "";

  const href = `mailto:${esc(fd.email)}?subject=Re:%20Your%20SelfieBox%20enquiry%20${esc(ref)}`;
  const label = `Reply to ${esc(first)} &rarr;`;
  const btnw = Math.max(210, first.length * 11 + 155);
  const button = `<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${href}" style="height:48px;v-text-anchor:middle;width:${btnw}px;" arcsize="50%" stroke="f" fillcolor="${ACCENT}"><w:anchorlock/><center style="color:#04121f;font-family:${FONT};font-size:15px;font-weight:bold">${label}</center></v:roundrect><![endif]-->`
    + `<!--[if !mso]><!--><a href="${href}" style="display:inline-block;background:linear-gradient(120deg,${ACCENT},${ACC2});color:#04121f;text-decoration:none;font:800 15px/1 ${FONT};padding:15px 30px;border-radius:999px">${label}</a><!--<![endif]-->`;
  const cta = variant === "customer" ? "" :
    `<tr><td style="padding:28px 32px 30px" align="center">${button}<div style="margin-top:14px;font:400 12px/1.5 ${FONT};color:${MUTED}">Or call them directly on ${esc(fd.phone)}</div></td></tr>`;
  const tail = variant === "customer" ? `<tr><td style="height:18px;line-height:18px;font-size:0">&nbsp;</td></tr>` : "";

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">`
    + `<meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light"><title>${eyebrow}</title>`
    + `<!--[if gte mso 9]><xml><o:OfficeDocumentSettings><o:AllowPNG/><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]--></head>`
    + `<body style="margin:0;padding:0;background:${NAVY};-webkit-text-size-adjust:100%">`
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${NAVY};border-collapse:collapse"><tr><td align="center" style="padding:14px 16px 30px">`
    + `<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;border-collapse:collapse">`
    + `<tr><td style="background:${CARD};border-radius:20px;overflow:hidden;box-shadow:0 30px 80px -30px rgba(0,0,0,.55)"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">`
    + `<tr><td align="center" style="padding:28px 32px 6px"><img src="cid:logo" width="139" height="30" alt="SelfieBox" style="display:block;width:139px;height:30px;border:0;margin:0 auto"></td></tr>`
    + `<tr><td align="center" style="padding:14px 32px 3px"><div style="font:700 13px/1 ${FONT};letter-spacing:.18em;text-transform:uppercase;color:${ACCENT}">${eyebrow}</div></td></tr>`
    + `<tr><td align="center" style="padding:0 32px 20px"><div style="font:500 12px/1.4 ${FONT};color:${MUTED}">Ref ${esc(ref)} &nbsp;&bull;&nbsp; ${esc(received)}</div></td></tr>`
    + `<tr><td style="padding:0 32px"><div style="border-top:1px solid ${LINE};font-size:0;line-height:0">&nbsp;</div></td></tr>`
    + thanks + details + messageBlock(fd.message) + cta + tail
    + `</table></td></tr>`
    + `<tr><td style="padding:22px 24px 8px" align="center"><div style="font:600 14px/1.5 ${FONT};color:#c7d5ee">SelfieBox &mdash; Premium Photo Booth Hire</div>`
    + `<div style="margin-top:6px;font:400 12px/1.6 ${FONT};color:#6d80a6">selfie@selfiebox.co.za &nbsp;&bull;&nbsp; selfiebox.co.za</div>`
    + `<div style="margin-top:12px;font:400 11px/1.5 ${FONT};color:#4c5f83">This message was submitted via the SelfieBox website contact form.</div></td></tr>`
    + `</table></td></tr></table></body></html>`;
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function bytesToB64(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i], b1 = i + 1 < bytes.length ? bytes[i + 1] : 0, b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += B64[b0 >> 2];
    out += B64[((b0 & 3) << 4) | (b1 >> 4)];
    out += i + 1 < bytes.length ? B64[((b1 & 15) << 2) | (b2 >> 6)] : "=";
    out += i + 2 < bytes.length ? B64[b2 & 63] : "=";
  }
  return out;
}
async function fetchB64(url) {
  try {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    return bytesToB64(new Uint8Array(await resp.arrayBuffer()));
  } catch (e) {
    return null;
  }
}

async function sendOne(apiKey, payload) {
  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "User-Agent": "SelfieBox-Convex/1.0" },
    body: JSON.stringify(payload),
  });
  const text = await resp.text();
  return { ok: resp.ok, status: resp.status, body: text };
}

function createEnquiryRef() {
  const alphabet = "ABCDEFGHJKMNPQRSTVWXYZ23456789";
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  let code = "";
  for (let i = 0; i < 6; i += 1) code += alphabet[bytes[i] % alphabet.length];
  return `SB-${code}`;
}

export async function sendContactEmails(fd) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { sent: false, reason: "no RESEND_API_KEY" };
  const from = process.env.RESEND_FROM_EMAIL || "SelfieBox <hello@events.selfiebox.co.za>";
  const now = new Date();
  const ref = createEnquiryRef();
  const received = "Received " + now.toLocaleString("en-ZA", {
    timeZone: "Africa/Johannesburg", day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
  const first = (s(fd.name) || "there").split(" ")[0];
  const logo = await fetchB64(`${IMG_BASE}/logo.png`);
  const attachments = logo ? [{ filename: "logo.png", content: logo, content_id: "logo" }] : [];
  const out = {};

  out.office = await sendOne(apiKey, {
    from, to: ["selfie@selfiebox.co.za"], reply_to: s(fd.email) || undefined,
    subject: `Website Contact Request — ${s(fd.name) || "New enquiry"}${s(fd.eventType) ? " (" + s(fd.eventType) + ")" : ""} [${ref}]`,
    html: buildContactEmailHtml(fd, "office", ref, received),
    attachments,
  });
  if (s(fd.email) && s(fd.email).includes("@")) {
    out.customer = await sendOne(apiKey, {
      from, to: [s(fd.email)], reply_to: "selfie@selfiebox.co.za",
      subject: `Thanks for reaching out to SelfieBox, ${first}! [${ref}]`,
      html: buildContactEmailHtml(fd, "customer", ref, received),
      attachments,
    });
  }
  return { sent: true, ...out };
}
