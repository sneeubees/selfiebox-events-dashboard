"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { buildBookingPdfBase64, sanitizeBookingFilenamePart } from "./bookingPdf";

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
    const storageId = await ctx.storage.store(
      new Blob([Buffer.from(pdfBuffer, "base64")], { type: "application/pdf" })
    );
    const fileName = `${sanitizeBookingFilenamePart(payload.eventName)}-booking-${new Date(payload.submittedAt || Date.now())
      .toISOString()
      .replace(/[:.]/g, "-")}.pdf`;
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
    const subject = `Booking form received - ${payload.eventName}`;
    const html = `
      <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #1f2a44;">
        <h2 style="margin-bottom: 12px;">SelfieBox booking form received</h2>
        <p>Thank you for completing your booking form.</p>
        <p><strong>Booking:</strong> ${payload.eventName}</p>
        <p><strong>Event name:</strong> ${payload.formData.eventName || "-"}</p>
        <p><strong>Contact person:</strong> ${payload.formData.contactPerson}</p>
        <p><strong>Email:</strong> ${payload.formData.email}</p>
        <p><strong>Date:</strong> ${payload.formData.eventDate || "-"}</p>
        <p><strong>Product:</strong> ${payload.formData.product || "-"}</p>
        <p><a href="${payload.linkUrl}" style="display:inline-block;padding:10px 16px;background:#2e65ff;color:#ffffff;text-decoration:none;border-radius:8px;">Open booking link</a></p>
        <p>The completed booking form PDF is attached for reference.</p>
      </div>
    `;
    const text = [
      "SelfieBox booking form received",
      "",
      `Booking: ${payload.eventName}`,
      `Event name: ${payload.formData.eventName || "-"}`,
      `Contact person: ${payload.formData.contactPerson}`,
      `Email: ${payload.formData.email}`,
      `Date: ${payload.formData.eventDate || "-"}`,
      `Product: ${payload.formData.product || "-"}`,
      "",
      `Booking link: ${payload.linkUrl}`,
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
        cc: ["info@selfiebox.co.za"],
        subject,
        html,
        text,
        attachments: [
          {
            filename: `${sanitizeBookingFilenamePart(payload.eventName)}-booking-form.pdf`,
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
