"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";
import { api } from "./_generated/api";
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

function stripReferenceValues(value) {
  return normalizeExtractedText(value).replace(/\breference\s*:\s*[^\n]+/gi, "REFERENCE:");
}

function detectDocumentType(name, text) {
  const haystack = `${name || ""}\n${stripReferenceValues(text || "")}`.toLowerCase();
  const hasInvoice = /\btax invoice\b|\binvoice\b|inv[-_ ]?\d{3,}|\bi\d{5,}\b/.test(haystack);
  const hasQuote = /\bquotation\b|\bquote\b|q\d{4,}/.test(haystack);

  if (hasInvoice && !hasQuote) {
    return "invoice";
  }
  if (hasQuote && !hasInvoice) {
    return "quote";
  }

  const fileName = String(name || "").toLowerCase();
  if (/\bq\d{4,}\b/.test(fileName)) {
    return "quote";
  }
  if (/\binv[-_ ]?\d{3,}\b|\bi\d{5,}\b/.test(fileName)) {
    return "invoice";
  }
  if (/\binvoice\b/.test(fileName)) {
    return "invoice";
  }
  if (/\bquote\b|\bquotation\b/.test(fileName)) {
    return "quote";
  }

  return null;
}

function extractKnownDocument(text, fileName) {
  const normalized = stripReferenceValues(text);
  const quotePatterns = [
    /\b(?:quotation|quote)\s*(?:number|no\.?|#|nr)?\s*[:\-]?\s*(Q\d{4,})\b/i,
    /\bnumber\s*[:\-]?\s*(Q\d{4,})\b/i,
    /\b(Q\d{4,})\b/i,
  ];
  const invoicePatterns = [
    /\b(?:tax invoice|invoice)\s*(?:number|no\.?|#|nr)?\s*[:\-]?\s*((?:INV[-_ ]?\d{3,})|(?:I\d{5,}))\b/i,
    /\bnumber\s*[:\-]?\s*((?:INV[-_ ]?\d{3,})|(?:I\d{5,}))\b/i,
    /\b(INV[-_ ]?\d{3,}|I\d{5,})\b/i,
  ];

  for (const pattern of quotePatterns) {
    const match = normalized.match(pattern) || String(fileName || "").match(pattern);
    if (match?.[1]) {
      return {
        documentType: "quote",
        documentNumber: match[1].replace(/[_ ]+/g, "-"),
      };
    }
  }

  for (const pattern of invoicePatterns) {
    const match = normalized.match(pattern) || String(fileName || "").match(pattern);
    if (match?.[1]) {
      return {
        documentType: "invoice",
        documentNumber: match[1].replace(/[_ ]+/g, "-"),
      };
    }
  }

  return null;
}

function extractDocumentNumber(text, fileName, type) {
  const normalized = stripReferenceValues(text);
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

  const fallbackFromName = String(fileName || "").match(
    type === "quote"
      ? /\b(Q\d{4,})\b/i
      : /\b(INV[-_ ]?\d{3,}|I\d{5,})\b/i,
  );
  if (fallbackFromName?.[1]) {
    return fallbackFromName[1].replace(/[_ ]+/g, "-");
  }

  const genericFallbackFromName = String(fileName || "").match(/(?:quote|quotation|invoice)[^\w]?([A-Z0-9][A-Z0-9\-\/]{2,})/i);
  return genericFallbackFromName?.[1] || "";
}

function extractExVatAuto(text) {
  const normalized = normalizeExtractedText(text);
  const patterns = [
    /\btotal\s+exclusive\s*[:\-]?\s*(?:r|zar)?\s*([\d.,\s]+)/i,
    /\btotal\s+ex(?:clusive)?\s*vat\s*[:\-]?\s*(?:r|zar)?\s*([\d.,\s]+)/i,
    /\bsubtotal\s*[:\-]?\s*(?:r|zar)?\s*([\d.,\s]+)/i,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (!match?.[1]) {
      continue;
    }
    const cleaned = match[1].replace(/\s+/g, "").replace(/(?<=\d),(?=\d{3}\b)/g, "");
    if (!/[0-9]/.test(cleaned)) {
      continue;
    }
    return cleaned;
  }

  return "";
}

export const extractUploadedDocumentNumber = action({
  args: {
    eventKey: v.string(),
    storageId: v.id("_storage"),
    name: v.string(),
    contentType: v.optional(v.string()),
    fileUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => processUploadedDocument(ctx, args),
});

async function processUploadedDocument(ctx, args, { skipUserCheck = false } = {}) {
  if (!skipUserCheck) {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }
  }

  if (!isPdfUpload(args.name, args.contentType)) {
    return { processed: false, reason: "not_pdf" };
  }

  const fileUrl = String(args.fileUrl || "").trim();
  if (!fileUrl) {
    console.log("Document extraction skipped: storage URL missing", {
      eventKey: args.eventKey,
      name: args.name,
      storageId: args.storageId,
    });
    return { processed: false, reason: "missing_storage_url" };
  }

  const fileResponse = await fetch(fileUrl);
  if (!fileResponse.ok) {
    console.log("Document extraction skipped: storage fetch failed", {
      eventKey: args.eventKey,
      name: args.name,
      storageId: args.storageId,
      fileUrl,
      status: fileResponse.status,
    });
    return { processed: false, reason: "storage_fetch_failed", status: fileResponse.status };
  }

  const buffer = Buffer.from(await fileResponse.arrayBuffer());
  const parsed = await pdfParse(buffer);
  const text = normalizeExtractedText(parsed.text || "");
  const knownDocument = extractKnownDocument(text, args.name);
  const documentType = knownDocument?.documentType || detectDocumentType(args.name, text);
  const exVatAuto = extractExVatAuto(text);

  if (!documentType) {
    if (exVatAuto) {
      console.log("Document extraction applied ExVAT Auto only", {
        eventKey: args.eventKey,
        name: args.name,
        exVatAuto,
      });
      return { processed: true, exVatAuto, reason: "exvat_only" };
    }
    console.log("Document extraction could not detect document type", {
      eventKey: args.eventKey,
      name: args.name,
      preview: text.slice(0, 240),
    });
    return { processed: false, reason: "not_quote_or_invoice" };
  }

  const documentNumber = knownDocument?.documentNumber || extractDocumentNumber(text, args.name, documentType);
  if (!documentNumber) {
    if (exVatAuto) {
      console.log("Document extraction applied ExVAT Auto without number", {
        eventKey: args.eventKey,
        name: args.name,
        documentType,
        exVatAuto,
      });
      return { processed: true, documentType, exVatAuto, reason: "number_not_found_exvat_saved" };
    }
    console.log("Document extraction found type but no number", {
      eventKey: args.eventKey,
      name: args.name,
      documentType,
      preview: text.slice(0, 240),
    });
    return { processed: false, reason: "number_not_found", documentType };
  }

  console.log("Document extraction succeeded", {
    eventKey: args.eventKey,
    name: args.name,
    documentType,
    documentNumber,
    exVatAuto: exVatAuto || undefined,
  });

  return { processed: true, documentType, documentNumber, exVatAuto: exVatAuto || "" };
}

export const backfillLatestPdfDocumentNumbers = action({
  args: {},
  handler: async (ctx) => {
    const candidates = await ctx.runQuery(api.files.listPdfCandidatesForDocumentNumbers, {});
    const seen = new Set();
    let updated = 0;
    let skipped = 0;

    for (const candidate of candidates) {
      const result = await processUploadedDocument(ctx, candidate, { skipUserCheck: true });
      if (!result.processed) {
        skipped += 1;
        continue;
      }

      const key = `${candidate.eventKey}:${result.documentType}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      updated += 1;
    }

    return { updated, skipped, scanned: candidates.length };
  },
});
