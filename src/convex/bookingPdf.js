import { jsPDF } from "jspdf";
import { BOOKING_TERMS_TEXT } from "../bookingConstants";

function formatDateTime(timestamp) {
  if (!timestamp) {
    return "";
  }
  return new Date(timestamp).toISOString().slice(0, 16).replace("T", " ");
}

export function sanitizeBookingFilenamePart(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "booking";
}

export function buildBookingPdfArrayBuffer(payload) {
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
  };

  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text("SelfieBox Booking Form", left, y);
  y += 26;
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text(`Submitted: ${formatDateTime(payload.submittedAt) || "-"}`, left, y);
  y += 18;
  if (payload.sourceIp) {
    doc.text(`IP: ${payload.sourceIp}`, left, y);
    y += 18;
  }
  y += 6;

  const formData = payload.formData || {};
  [
    ["Booking", payload.eventName],
    ["Product", formData.product],
    ["Booking Type", formData.customerType],
    ["Company Name", formData.companyName],
    ["Event Name", formData.eventName],
    ["Contact Person", formData.contactPerson],
    ["Cell", formData.cell],
    ["Email", formData.email],
    ["Date", formData.eventDate],
    ["Region", formData.region],
    ["Address", formData.address],
    ["POC Name", formData.pointOfContactName],
    ["POC Contact #", formData.pointOfContactNumber],
    ["Setup Time", formData.setupTime],
    ["Event Start Time", formData.eventStartTime],
    ["Event Finish Time", formData.eventFinishTime],
    ["Optional Extras", Array.isArray(formData.optionalExtras) ? formData.optionalExtras.join(", ") : ""],
    ["Design Yourself", formData.designYourself],
    ["Notes", formData.notes],
    ["Accepted Terms", formData.acceptedTerms ? "Yes" : "No"],
  ].forEach(([label, value]) => addLine(label, value));

  y += 6;
  doc.setFont("helvetica", "bold");
  doc.text("Terms & Conditions", left, y);
  y += 18;
  doc.setFont("helvetica", "normal");
  const termsLines = doc.splitTextToSize(BOOKING_TERMS_TEXT, right - left);
  doc.text(termsLines, left, y);

  return doc.output("arraybuffer");
}

export function buildBookingPdfBase64(payload) {
  return Buffer.from(buildBookingPdfArrayBuffer(payload)).toString("base64");
}
