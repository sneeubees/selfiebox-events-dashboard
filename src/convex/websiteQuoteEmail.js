// Branded quote-enquiry emails, sent server-side from the /website-quote httpAction.
// Office copy -> province mailbox (cc selfie@), customer copy -> the submitter.
const IMG_BASE = "https://selfiebox.co.za/email-assets";
const NAVY = "#070f24", CARD = "#ffffff", INK = "#14203a", MUTED = "#5b6b86",
  LINE = "#e6ecf5", ACCENT = "#2f9fed", ACC2 = "#54d4ff",
  FONT = "-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif";

const BOOTH_IMG = {
  "Nano Box": "booth-nano", "Halo Box": "booth-halobox", "Selfie Box": "booth-selfie",
  Vintage: "booth-vintage", Mirror: "booth-mirror", "Retro Pod": "booth-retro",
  Cruise: "booth-cruise", Tuxedo: "booth-tuxedo", Shift: "booth-shift",
  InstaBox: "booth-instabox", SideKick: "booth-sidekick",
};
const SERVICE_IMG = {
  "360° Video": "booth-360", Mosaic: "booth-mosaic", "Sketch Bot (NEW!)": "booth-sketchbot",
  "Video (Slow-Mo / Messages)": "booth-halo",
};

// Deep-link the selected booth to its section on the site.
// TODO (GO-LIVE): pointing at the preview site (selfiebox.co.za) during build/testing.
// At go-live, change back to "https://selfiebox.co.za/our-booths" (redesign replaces production).
const BOOTHS_URL = "https://selfiebox.co.za/our-booths";
const BOOTH_ANCHOR = {
  "Nano Box": "nanobox", "Halo Box": "halobox", "Selfie Box": "selfiebox-elite",
  Vintage: "vintage-booth", Mirror: "mirrorbooth", "Retro Pod": "retro-booth",
  Cruise: "cruise", Tuxedo: "tuxedo", Shift: "shift",
  InstaBox: "instabox", SideKick: "sidekick",
};
const SERVICE_ANCHOR = {
  "360° Video": "360-spin", Mosaic: "mosaic", "Sketch Bot (NEW!)": "sketchbot", Karaoke: "karaoke",
};
function boothLink(fd) {
  const a = BOOTH_ANCHOR[s(fd.photoBoothChoice)] || SERVICE_ANCHOR[s(fd.primarySelection)] || "";
  return a ? `${BOOTHS_URL}/#${a}` : `${BOOTHS_URL}/`;
}

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
function chips(items) {
  if (!items || !items.length) return "";
  const pills = items.map((i) =>
    `<table role="presentation" align="left" border="0" cellpadding="0" cellspacing="0" style="float:left"><tr><td style="padding:0 9px 9px 0">`
    + `<table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr><td bgcolor="#eef6ff" style="background:#eef6ff;border:1px solid #d5e8fb;border-radius:999px;padding:7px 14px;font:600 13px/1.1 ${FONT};color:${ACCENT};mso-padding-alt:7px 14px 7px 14px;white-space:nowrap">${esc(i)}</td></tr></table>`
    + `</td></tr></table>`).join("");
  return `<tr><td style="padding:22px 32px 8px">${secHead("Optional Extras")}<div style="height:14px;line-height:14px;font-size:0">&nbsp;</div>${pills}<br clear="all" style="clear:both;line-height:0;font-size:0"></td></tr>`;
}
function messageBlock(msg) {
  if (!s(msg)) return "";
  return `<tr><td style="padding:24px 32px 4px">${secHead("Message")}<div style="height:12px;line-height:12px">&nbsp;</div>`
    + `<div style="font:400 15px/1.65 ${FONT};color:${INK};background:#f7fafe;border:1px solid ${LINE};border-left:3px solid ${ACCENT};border-radius:10px;padding:16px 18px">${esc(msg)}</div></td></tr>`;
}

function boothImageSlug(fd) {
  return BOOTH_IMG[s(fd.photoBoothChoice)] || SERVICE_IMG[s(fd.primarySelection)] || "";
}

function buildQuoteEmailHtml(fd, variant, ref, submitted) {
  const first = (s(fd.contactPerson) || "there").split(" ")[0];
  const boothName = s(fd.photoBoothChoice) || s(fd.primarySelection) || "Your selection";
  const slug = boothImageSlug(fd);
  const boothUrl = boothLink(fd);
  const imgTag = `<img src="cid:booth0" width="64" height="64" alt="${esc(boothName)}" style="display:block;width:64px;height:64px;border-radius:12px;border:1px solid ${LINE};object-fit:cover">`;
  const boothThumb = slug
    ? `<td width="72" valign="top" style="width:72px;padding:10px 0"><a href="${boothUrl}" target="_blank" style="text-decoration:none">${imgTag}</a></td>`
    : "";
  const boothRow = `<tr><td style="padding:8px 32px 2px">${secHead("Selected Booth")}</td></tr>`
    + `<tr><td style="padding:2px 32px 4px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr>${boothThumb}`
    + `<td valign="middle" style="padding:10px 0 10px ${slug ? "16px" : "0"}"><div style="font:700 16px/1.2 ${FONT}"><a href="${boothUrl}" target="_blank" style="color:${INK};text-decoration:none">${esc(boothName)}</a></div>`
    + `<div style="margin-top:5px;font:600 12px/1.4 ${FONT}"><a href="${boothUrl}" target="_blank" style="color:${ACCENT};text-decoration:none">View this booth &rarr;</a></div></td></tr></table></td></tr>`;

  const selRows = row("Experience", fd.primarySelection, true) + row("Photo output", fd.photoOutput)
    + row("360° option", fd.spinChoice) + row("Video option", fd.videoChoice);
  const eventRows = row("Function type", fd.functionType) + row("Event date", fd.eventDate)
    + row("Start time", fd.eventStartTime) + row("Finish time", fd.eventFinishTime)
    + row("Duration", fd.numberOfHours ? `${s(fd.numberOfHours)} hours` : "") + row("Province", fd.region);
  const contactRows = row("Contact person", fd.contactPerson) + row("Company", fd.companyName)
    + row("Email", fd.email) + row("Cell", fd.cell) + row("Address", fd.address);

  const thanks = variant === "customer"
    ? `<tr><td style="padding:24px 32px 6px"><div style="font:700 18px/1.35 ${FONT};color:${INK}">Thank you, ${esc(first)} &mdash; we've got your enquiry! 🎉</div>`
      + `<div style="margin-top:12px;font:400 15px/1.7 ${FONT};color:#41506e">We're so glad you reached out to SelfieBox. Your enquiry has landed safely with our team and we're already excited about your ${esc((s(fd.functionType) || "event").toLowerCase())}! One of us will be in touch very soon with a tailored quote.<br><br>Below is a summary of everything you sent through &mdash; if anything's changed or you'd like to add to it, simply <b style="color:${ACCENT}">reply to this email</b> and we'll take care of it. We can't wait to help make your event one to remember.</div></td></tr>`
      + `<tr><td style="padding:18px 32px 0"><div style="border-top:1px solid ${LINE};font-size:0;line-height:0">&nbsp;</div></td></tr>`
    : "";

  const href = `mailto:${esc(fd.email)}?subject=Re:%20Your%20SelfieBox%20enquiry%20${esc(ref)}`;
  const label = `Reply to ${esc(first)} &rarr;`;
  const btnw = Math.max(210, first.length * 11 + 155);
  const button = `<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${href}" style="height:48px;v-text-anchor:middle;width:${btnw}px;" arcsize="50%" stroke="f" fillcolor="${ACCENT}"><w:anchorlock/><center style="color:#04121f;font-family:${FONT};font-size:15px;font-weight:bold">${label}</center></v:roundrect><![endif]-->`
    + `<!--[if !mso]><!--><a href="${href}" style="display:inline-block;background:linear-gradient(120deg,${ACCENT},${ACC2});color:#04121f;text-decoration:none;font:800 15px/1 ${FONT};padding:15px 30px;border-radius:999px">${label}</a><!--<![endif]-->`;
  const cta = variant === "customer" ? "" :
    `<tr><td style="padding:28px 32px 30px" align="center">${button}<div style="margin-top:14px;font:400 12px/1.5 ${FONT};color:${MUTED}">Or call them directly on ${esc(fd.cell)}</div></td></tr>`;
  const tail = variant === "customer" ? `<tr><td style="height:14px;line-height:14px;font-size:0">&nbsp;</td></tr>` : "";
  const eyebrow = variant === "customer" ? "Enquiry Received" : "New Booking Enquiry";

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">`
    + `<meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light"><title>${eyebrow}</title>`
    + `<!--[if gte mso 9]><xml><o:OfficeDocumentSettings><o:AllowPNG/><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]--></head>`
    + `<body style="margin:0;padding:0;background:${NAVY};-webkit-text-size-adjust:100%">`
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${NAVY};border-collapse:collapse"><tr><td align="center" style="padding:14px 16px 30px">`
    + `<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;border-collapse:collapse">`
    + `<tr><td style="background:${CARD};border-radius:20px;overflow:hidden;box-shadow:0 30px 80px -30px rgba(0,0,0,.55)"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">`
    + `<tr><td align="center" style="padding:28px 32px 6px"><img src="cid:logo" width="139" height="30" alt="SelfieBox" style="display:block;width:139px;height:30px;border:0;margin:0 auto"></td></tr>`
    + `<tr><td align="center" style="padding:14px 32px 3px"><div style="font:700 13px/1 ${FONT};letter-spacing:.18em;text-transform:uppercase;color:${ACCENT}">${eyebrow}</div></td></tr>`
    + `<tr><td align="center" style="padding:0 32px 20px"><div style="font:500 12px/1.4 ${FONT};color:${MUTED}">Ref ${esc(ref)} &nbsp;&bull;&nbsp; ${esc(submitted)}</div></td></tr>`
    + `<tr><td style="padding:0 32px"><div style="border-top:1px solid ${LINE};font-size:0;line-height:0">&nbsp;</div></td></tr>`
    + thanks + boothRow + section("Your Selection", selRows) + section("Event Details", eventRows)
    + section("Contact Details", contactRows) + chips(fd.optionalExtras) + messageBlock(fd.message) + cta + tail
    + `</table></td></tr>`
    + `<tr><td style="padding:22px 24px 8px" align="center"><div style="font:600 14px/1.5 ${FONT};color:#c7d5ee">SelfieBox &mdash; Premium Photo Booth Hire</div>`
    + `<div style="margin-top:6px;font:400 12px/1.6 ${FONT};color:#6d80a6">selfie@selfiebox.co.za &nbsp;&bull;&nbsp; selfiebox.co.za</div>`
    + `<div style="margin-top:12px;font:400 11px/1.5 ${FONT};color:#4c5f83">This enquiry was submitted via the SelfieBox website quote form.</div></td></tr>`
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
async function buildAttachments(fd) {
  const atts = [];
  const logo = await fetchB64(`${IMG_BASE}/logo.png`);
  if (logo) atts.push({ filename: "logo.png", content: logo, content_id: "logo" });
  const slug = boothImageSlug(fd);
  if (slug) {
    const booth = await fetchB64(`${IMG_BASE}/${slug}.jpg`);
    if (booth) atts.push({ filename: "booth.jpg", content: booth, content_id: "booth0" });
  }
  return atts;
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

const OFFICE_MAIN = "selfie@selfiebox.co.za";
const PROVINCE_EMAIL = {
  "eastern cape": "capetown@selfiebox.co.za",
  "free state": OFFICE_MAIN,
  "gauteng": OFFICE_MAIN,
  "kwazulu-natal": "kzn@selfiebox.co.za",
  "kwazulu natal": "kzn@selfiebox.co.za",
  "limpopo": OFFICE_MAIN,
  "mpumalanga": OFFICE_MAIN,
  "north west": "northwest@selfiebox.co.za",
  "northern cape": "northwest@selfiebox.co.za",
  "western cape": "capetown@selfiebox.co.za",
};
function officeRecipients(region) {
  const key = String(region == null ? "" : region).trim().toLowerCase();
  const primary = PROVINCE_EMAIL[key] || OFFICE_MAIN;
  const cc = primary === OFFICE_MAIN ? undefined : [OFFICE_MAIN];
  const replyAll = Array.from(new Set([primary, OFFICE_MAIN]));
  return { to: [primary], cc, replyAll };
}

export async function sendQuoteEmails(fd, result) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { sent: false, reason: "no RESEND_API_KEY" };
  const from = process.env.RESEND_FROM_EMAIL || "SelfieBox <bookings@events.selfiebox.co.za>";
  const ref = s(result && result.ref) || s(result && result.eventKey) || "SB-QUOTE";
  const submitted = "Submitted " + new Date().toLocaleString("en-ZA", {
    timeZone: "Africa/Johannesburg", day: "2-digit", month: "long", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
  const first = (s(fd.contactPerson) || "there").split(" ")[0];
  const attachments = await buildAttachments(fd);
  const out = {};

  // office copy -> province mailbox (always cc selfie@)
  const rcpt = officeRecipients(fd.region);
  out.office = await sendOne(apiKey, {
    from, to: rcpt.to, cc: rcpt.cc, reply_to: s(fd.email) || undefined,
    subject: `New Booking Enquiry — ${s(fd.functionType) || "Event"}, ${s(fd.eventDate)} [${ref}]`,
    html: buildQuoteEmailHtml(fd, "office", ref, submitted),
    attachments,
  });
  // customer copy -> submitter
  if (s(fd.email) && s(fd.email).includes("@")) {
    out.customer = await sendOne(apiKey, {
      from, to: [s(fd.email)], reply_to: rcpt.replyAll,
      subject: `Thanks for your SelfieBox enquiry, ${first}! [${ref}]`,
      html: buildQuoteEmailHtml(fd, "customer", ref, submitted),
      attachments,
    });
  }
  return { sent: true, ...out };
}

export { buildQuoteEmailHtml };
