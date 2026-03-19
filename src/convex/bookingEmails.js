"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { jsPDF } from "jspdf";
import { BOOKING_TERMS_TEXT } from "../bookingConstants";

function formatDateTime(timestamp) {
  if (!timestamp) {
    return "";
  }
  return new Date(timestamp).toISOString().slice(0, 16).replace("T", " ");
}

function sanitizeFilenamePart(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "booking";
}

function buildBookingPdf(payload) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const left = 48;
  const right = pageWidth - 48;
  let y = 54;

  const addLine = (label, value) => {
    doc.setFont("helvetica", "bold");
    doc.text(`${label}:`, left, y);
    doc.setFont("helvetica", "normal");
    const wrapped = doc.splitTextToSize(String(value || "-"), right - left - 120);
    doc.text(wrapped, left + 120, y);
    y += Math.max(22, wrapped.length * 16);
    if (y > 740) {
      doc.addPage();
      y = 54;
    }
  };

  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  doc.text("SelfieBox Booking Form", left, y);
  y += 28;
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text(`Submitted: ${formatDateTime(payload.submittedAt) || "Pending"}`, left, y);
  y += 16;
  doc.text(`Booking link: ${payload.linkUrl}`, left, y, { maxWidth: right - left });
  y += 26;

  doc.setDrawColor(210, 217, 228);
  doc.line(left, y, right, y);
  y += 24;

  addLine("Product", payload.formData.product);
  addLine("Booking Type", payload.formData.customerType);
  addLine("Company Name", payload.formData.companyName);
  addLine("Event Name", payload.formData.eventName);
  addLine("Contact Person", payload.formData.contactPerson);
  addLine("Cell", payload.formData.cell);
  addLine("Email", payload.formData.email);
  addLine("Date of Event", payload.formData.eventDate);
  addLine("Region", payload.formData.region);
  addLine("Address", payload.formData.address);
  addLine("Point of Contact", payload.formData.pointOfContactName);
  addLine("Point of Contact Number", payload.formData.pointOfContactNumber);
  addLine("Setup Time", payload.formData.setupTime || "-");
  addLine("Event Start Time", payload.formData.eventStartTime || "-");
  addLine("Event Finish Time", payload.formData.eventFinishTime || "-");
  addLine("Optional Extras", payload.formData.optionalExtras.length ? payload.formData.optionalExtras.join(", ") : "-");
  addLine("Design Yourself", payload.formData.designYourself || "-");
  addLine("Notes / Special Instructions", payload.formData.notes || "-");
  addLine("Terms Accepted", payload.formData.acceptedTerms ? "Yes" : "No");

  doc.setFont("helvetica", "bold");
  doc.text("Terms and Conditions", left, y);
  y += 18;
  doc.setFont("helvetica", "normal");
  const termsLines = doc.splitTextToSize(BOOKING_TERMS_TEXT, right - left);
  doc.text(termsLines, left, y);
  y += termsLines.length * 14 + 26;

  doc.setDrawColor(180, 180, 180);
  doc.line(left, y + 24, left + 180, y + 24);
  doc.line(left + 240, y + 24, left + 420, y + 24);
  doc.text("Signature", left, y + 40);
  doc.text("Date", left + 240, y + 40);

  return Buffer.from(doc.output("arraybuffer")).toString("base64");
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

    const resendApiKey = process.env.RESEND_API_KEY;
    const fromEmail = process.env.RESEND_FROM_EMAIL;
    if (!resendApiKey || !fromEmail) {
      console.warn("Skipping booking email: missing RESEND_API_KEY or RESEND_FROM_EMAIL.");
      return { sent: false, reason: "missing_email_config" };
    }

    const pdfBase64 = buildBookingPdf(payload);
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
            filename: `${sanitizeFilenamePart(payload.eventName)}-booking-form.pdf`,
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
