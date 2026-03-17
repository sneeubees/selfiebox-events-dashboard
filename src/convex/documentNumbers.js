"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";
import { api, internal } from "./_generated/api";
import pdfParse from "pdf-parse/lib/pdf-parse.js";

function isPdfUpload(name, contentType) {
  return String(contentType || "").toLowerCase().includes("pdf") || /\.pdf$/i.test(String(name || ""));
}

function normalizeExtractedText(value) {
  return String(value || "")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

function detectDocumentType(name, text) {
  const haystack = `${name || ""}\n${text || ""}`.toLowerCase();
  const hasInvoice = /\btax invoice\b|\binvoice\b/.test(haystack);
  const hasQuote = /\bquotation\b|\bquote\b/.test(haystack);

  if (hasInvoice && !hasQuote) {
    return "invoice";
  }
  if (hasQuote && !hasInvoice) {
    return "quote";
  }

  const fileName = String(name || "").toLowerCase();
  if (/\binvoice\b/.test(fileName)) {
    return "invoice";
  }
  if (/\bquote\b|\bquotation\b/.test(fileName)) {
    return "quote";
  }

  return null;
}

function extractDocumentNumber(text, fileName, type) {
  const normalized = normalizeExtractedText(text);
  const patterns = type === "invoice"
    ? [
        /\b(?:tax invoice|invoice)\s*(?:number|no\.?|#|nr)?\s*[:\-]?\s*([A-Z0-9][A-Z0-9\/\-]{2,})/i,
        /\binv(?:oice)?\s*(?:number|no\.?|#)\s*[:\-]?\s*([A-Z0-9][A-Z0-9\/\-]{2,})/i,
      ]
    : [
        /\b(?:quotation|quote)\s*(?:number|no\.?|#|nr)?\s*[:\-]?\s*([A-Z0-9][A-Z0-9\/\-]{2,})/i,
        /\bqt(?:e)?\s*(?:number|no\.?|#)\s*[:\-]?\s*([A-Z0-9][A-Z0-9\/\-]{2,})/i,
      ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match?.[1]) {
      return match[1].replace(/[)\],.;]+$/, "");
    }
  }

  const fallbackFromName = String(fileName || "").match(/(?:quote|quotation|invoice)[^\w]?([A-Z0-9][A-Z0-9\-\/]{2,})/i);
  return fallbackFromName?.[1] || "";
}

export const extractUploadedDocumentNumber = action({
  args: {
    eventKey: v.string(),
    storageId: v.id("_storage"),
    name: v.string(),
    contentType: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const currentUser = await ctx.runQuery(api.users.current, {});
    if (!currentUser || !currentUser.isApproved || !currentUser.isActive) {
      throw new Error("User access is pending approval.");
    }

    if (!isPdfUpload(args.name, args.contentType)) {
      return { processed: false, reason: "not_pdf" };
    }

    const fileUrl = await ctx.storage.getUrl(args.storageId);
    if (!fileUrl) {
      return { processed: false, reason: "missing_storage_url" };
    }

    const response = await fetch(fileUrl);
    if (!response.ok) {
      return { processed: false, reason: `fetch_failed_${response.status}` };
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const parsed = await pdfParse(buffer);
    const text = normalizeExtractedText(parsed.text || "");
    const documentType = detectDocumentType(args.name, text);

    if (!documentType) {
      return { processed: false, reason: "not_quote_or_invoice" };
    }

    const documentNumber = extractDocumentNumber(text, args.name, documentType);
    if (!documentNumber) {
      return { processed: false, reason: "number_not_found", documentType };
    }

    await ctx.runMutation(internal.events.setDocumentNumberFromUpload, {
      eventKey: args.eventKey,
      documentType,
      documentNumber,
    });

    return { processed: true, documentType, documentNumber };
  },
});
