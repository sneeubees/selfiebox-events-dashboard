"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { buildBookingPdfBase64, sanitizeBookingFilenamePart } from "./bookingPdf";

function buildBookingPdfFilename(payload) {
  const companyPart = sanitizeBookingFilenamePart(payload.eventName).slice(0, 10) || "booking";
  const datePart = sanitizeBookingFilenamePart(payload.formData?.eventDate || "").slice(0, 20) || "date";
  const firstProduct = Array.isArray(payload.productNames) && payload.productNames.length
    ? payload.productNames[0]
    : String(payload.formData?.product || "").split(",")[0];
  const productPart = sanitizeBookingFilenamePart(firstProduct).slice(0, 10) || "product";
  return `${companyPart}_${datePart}_${productPart}.pdf`;
}

function buildBookingSummaryLines(payload) {
  const formData = payload.formData || {};
  return [
    ["Client name", payload.eventName],
    ["Event name", formData.eventName || payload.eventTitle || "-"],
    ["Product", (payload.productNames || []).join(", ") || formData.product || "-"],
    ["Booking type", formData.customerType || "-"],
    ["Contact person", formData.contactPerson || "-"],
    ["Cell", formData.cell || "-"],
    ["Email", formData.email || "-"],
    ["Date", formData.eventDate || "-"],
    ["Region", formData.region || payload.regionName || "-"],
    ["Address", formData.address || "-"],
    ["POC Name", formData.pointOfContactName || "-"],
    ["POC Contact #", formData.pointOfContactNumber || "-"],
    ["Setup time", formData.setupTime || "-"],
    ["Event start time", formData.eventStartTime || "-"],
    ["Event finish time", formData.eventFinishTime || "-"],
    ["Optional extras", Array.isArray(formData.optionalExtras) && formData.optionalExtras.length ? formData.optionalExtras.join(", ") : "-"],
    ["Design yourself", formData.designYourself || "-"],
    ["Design/Artwork Status", payload.designStatus || "N/A"],
    ["Attendant", payload.attendantName || "Attendant not yet assigned"],
    ["Notes / Special Instructions", formData.notes || "-"],
  ];
}

function buildSummaryHtml(payload) {
  const rows = buildBookingSummaryLines(payload)
    .map(([label, value]) => `
      <tr>
        <td style="padding:1px 14px 1px 0;color:#1f2a44;font-weight:700;vertical-align:top;white-space:nowrap;">${label}</td>
        <td style="padding:1px 0;color:#7a8598;vertical-align:top;">${value}</td>
      </tr>
    `)
    .join("");
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:separate;border-spacing:0 1px;margin:8px 0 10px 30px;line-height:1.14;">${rows}</table>`;
}

function buildSummaryText(payload) {
  return buildBookingSummaryLines(payload)
    .map(([label, value]) => `  ${label}: ${value}`)
    .join("\n");
}

export const sendBookingSubmissionEmail = internalAction({
  args: {
    bookingId: v.id("eventBookings"),
    baseUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const payload = await ctx.runQuery(internal.bookings.getSubmissionEmailPayload, args);
    if (!payload) {
      return { sent: false, reason: "missing_payload" };
    }

    const pdfBuffer = buildBookingPdfBase64(payload);
    const fileName = buildBookingPdfFilename(payload);
    const storageId = await ctx.storage.store(
      new Blob([Buffer.from(pdfBuffer, "base64")], { type: "application/pdf" })
    );
    await ctx.runMutation(internal.bookings.saveBookingSnapshot, {
      bookingId: payload.bookingId,
      eventId: payload.eventId,
      storageId,
      fileName,
      sourceIp: payload.sourceIp || undefined,
      submittedAt: payload.submittedAt || Date.now(),
      createdByUserId: payload.submittedByUserId || undefined,
      createdByLabel: payload.submittedByLabel || payload.formData.contactPerson || "Booking form",
    });

    const resendApiKey = process.env.RESEND_API_KEY;
    const fromEmail = process.env.RESEND_FROM_EMAIL;
    if (!resendApiKey || !fromEmail) {
      console.warn("Skipping booking email: missing RESEND_API_KEY or RESEND_FROM_EMAIL.");
      return { sent: false, reason: "missing_email_config" };
    }

    const pdfBase64 = pdfBuffer;
    const subject = `SelfieBox booking form Received - ${payload.eventName} | ${payload.formData.eventDate || "-"}`;
    const ccRecipient = payload.creatorEmail || "selfie@selfiebox.co.za";
    const replyTo = payload.creatorEmail || "selfie@selfiebox.co.za";
    const summaryHtml = buildSummaryHtml(payload);
    const summaryText = buildSummaryText(payload);
    const sentFooter = `Sent from ${payload.sourceIp || "-"} on ${new Date(payload.submittedAt || Date.now()).toLocaleString("en-ZA")} from SelfieBox events dashboard.`;
    const html = `
      <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #7a8598;">
        <h2 style="margin-bottom: 12px; color: #1f2a44;">SelfieBox booking form received</h2>
        <p>Thanks for completing or updating your booking form online. You can use the link below to make any changes, and to view updates about your booking as they become available, so be sure to keep it safe.</p>
        <p><strong style="color: #1f2a44;">Summary of your booking:</strong></p>
        ${summaryHtml}
        <p><a href="${payload.linkUrl}" style="display:inline-block;padding:10px 16px;background:#2e65ff;color:#ffffff;text-decoration:none;border-radius:8px;">Open booking link</a></p>
        <p>Your booking form is attached for easy reference. If you have any questions, just reply to this message, we're happy to help!</p>
        <p style="margin-top:20px;font-size:12px;color:#9aa4b5;">${sentFooter}</p>
      </div>
    `;
    const text = [
      "SelfieBox booking form received",
      "",
      "Thanks for completing or updating your booking form online. You can use the link below to make any changes, and to view updates about your booking as they become available, so be sure to keep it safe.",
      "",
      "Summary of your booking:",
      summaryText,
      "",
      `Booking link: ${payload.linkUrl}`,
      "",
      "Your booking form is attached for easy reference. If you have any questions, just reply to this message, we're happy to help!",
      "",
      sentFooter,
    ].join("\n");

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [payload.formData.email],
        cc: [ccRecipient],
        bcc: ["info@selfiebox.co.za"],
        reply_to: replyTo,
        subject,
        html,
        text,
        attachments: [
          {
            filename: fileName,
            content: pdfBase64,
          },
        ],
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Failed to send booking email: ${response.status} ${body}`);
    }

    const json = await response.json();
    return { sent: true, id: json?.id || null };
  },
});
