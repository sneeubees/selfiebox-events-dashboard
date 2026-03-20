import { jsPDF } from "jspdf";

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
  const pageHeight = doc.internal.pageSize.getHeight();
  const left = 48;
  const right = pageWidth - 48;
  let y = 54;

  const ensurePageSpace = (heightNeeded = 24) => {
    if (y + heightNeeded <= doc.internal.pageSize.getHeight() - 60) {
      return;
    }
    doc.addPage();
    y = 54;
  };

  const addSectionTitle = (label) => {
    ensurePageSpace(24);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(38, 66, 123);
    doc.text(label, left, y);
    y += 18;
  };

  const addField = (label, value) => {
    ensurePageSpace(24);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(38, 66, 123);
    doc.text(`${label}:`, left, y);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(90, 99, 118);
    const wrapped = doc.splitTextToSize(String(value || "-"), right - left - 150);
    doc.text(wrapped, left + 150, y);
    y += Math.max(20, wrapped.length * 15);
  };

  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(29, 53, 95);
  doc.text("SelfieBox Booking Form", left, y);
  y += 22;
  doc.setFontSize(16);
  doc.setTextColor(122, 133, 152);
  doc.text(payload.eventName || "-", left, y);
  y += 22;
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(90, 99, 118);
  const eventLine = [payload.formData?.eventDate, payload.formData?.address].filter(Boolean).join(" · ");
  if (payload.eventTitle) {
    doc.text(`Event Name: ${payload.eventTitle}`, left, y);
    y += 16;
  }
  if (eventLine) {
    doc.text(eventLine, left, y);
    y += 16;
  }
  const summaryLine = [
    `Your product: ${(payload.productNames || []).join(", ") || payload.formData?.product || "N/A"}`,
    `Your Quote: ${payload.quoteNumber || "N/A"}`,
    `Your Invoice: ${payload.invoiceNumber || "N/A"}`,
    `Design/Artwork Status: ${payload.designStatus || "N/A"}`,
  ].join(", ");
  doc.text(summaryLine, left, y);
  y += 14;
  doc.text(`Your attendant is: ${payload.attendantName || "Attendant not yet assigned"}`, left, y);
  y += 18;

  const formData = payload.formData || {};
  addSectionTitle("Booking Details");
  [
    ["Booking Type", formData.customerType],
    ["Contact Person", formData.contactPerson],
    ["Cell", formData.cell],
    ["Email", formData.email],
    ["Date of Event", formData.eventDate],
    ["Region", formData.region],
    ["Address", formData.address],
    ["POC Name", formData.pointOfContactName],
    ["POC Contact #", formData.pointOfContactNumber],
    ["Setup Time", formData.setupTime],
    ["Event Start Time", formData.eventStartTime],
    ["Event Finish Time", formData.eventFinishTime],
    ["Optional Extras", Array.isArray(formData.optionalExtras) ? formData.optionalExtras.join(", ") : ""],
    ["Design Yourself", formData.designYourself],
    ["Notes / Special Instructions", formData.notes],
  ].forEach(([label, value]) => addField(label, value));

  y += 8;
  addSectionTitle("Terms & Conditions");
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(90, 99, 118);
  const termsLines = doc.splitTextToSize(
    "You confirmed the Terms and Conditions on the online booking form.",
    right - left
  );
  doc.text(termsLines, left, y);

  const footerY = pageHeight - 34;
  doc.setFontSize(9);
  doc.setTextColor(90, 99, 118);
  doc.text("www.selfiebox.co.za", left, footerY - 14);
  doc.text(
    `Submitted: ${formatDateTime(payload.submittedAt) || "-"}    IP: ${payload.sourceIp || "-"}`,
    left,
    footerY
  );

  return doc.output("arraybuffer");
}

export function buildBookingPdfBase64(payload) {
  return Buffer.from(buildBookingPdfArrayBuffer(payload)).toString("base64");
}
