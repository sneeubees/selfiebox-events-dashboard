import { bumpStat } from "./websiteStats";
import { v } from "convex/values";
import { mutation } from "./_generated/server";

function createUniqueEventKey() {
  return `evt-${crypto.randomUUID()}`;
}

// Short, human-friendly enquiry ref for email subjects + dashboard linking (ticket-style).
// Excludes ambiguous chars (0/O/1/I/L/U). ~594M combinations.
function createEnquiryRef() {
  const alphabet = "ABCDEFGHJKMNPQRSTVWXYZ23456789";
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  let code = "";
  for (let i = 0; i < 6; i += 1) code += alphabet[bytes[i] % alphabet.length];
  return `SB-${code}`;
}

async function generateUniqueToken(ctx) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    const token = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
    const existing = await ctx.db
      .query("eventBookings")
      .withIndex("by_token", (q) => q.eq("token", token))
      .unique();
    if (!existing) {
      return token;
    }
  }
  throw new Error("Unable to create a unique quote token right now.");
}

function normalizeString(value) {
  return String(value ?? "").trim();
}

function normalizeEmail(value) {
  return normalizeString(value).toLowerCase();
}

function normalizeArray(values) {
  return Array.isArray(values)
    ? Array.from(new Set(values.map((value) => normalizeString(value)).filter(Boolean)))
    : [];
}

function formatActivityTimestamp(timestamp) {
  try {
    return new Date(timestamp).toLocaleString("en-ZA", {
      timeZone: "Africa/Johannesburg",
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return new Date(timestamp).toISOString();
  }
}

function createActivityEntry(text, user, timestamp) {
  return {
    id: crypto.randomUUID(),
    text,
    user,
    date: formatActivityTimestamp(timestamp),
  };
}

function getMonthLabel(dateText) {
  const parsed = new Date(`${dateText}T12:00:00`);
  if (!Number.isFinite(parsed.getTime())) {
    return "";
  }
  return parsed.toLocaleString("en-ZA", {
    timeZone: "Africa/Johannesburg",
    month: "long",
  });
}

function getWorkspaceYear(dateText) {
  const parsed = new Date(`${dateText}T12:00:00`);
  if (!Number.isFinite(parsed.getTime())) {
    return new Date().getFullYear();
  }
  return parsed.getFullYear();
}

function parseTimeValue(value) {
  const match = normalizeString(value).match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    return null;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return null;
  }
  return hours * 60 + minutes;
}

function getDurationHours(startTime, finishTime) {
  const start = parseTimeValue(startTime);
  const finish = parseTimeValue(finishTime);
  if (start == null || finish == null) {
    return "";
  }
  let duration = finish - start;
  if (duration <= 0) {
    duration += 24 * 60;
  }
  return String(Math.ceil(duration / 60));
}

function getSetupTime(startTime) {
  const start = parseTimeValue(startTime);
  if (start == null) {
    return "";
  }
  const setup = ((start - 60) % (24 * 60) + (24 * 60)) % (24 * 60);
  const hours = Math.floor(setup / 60);
  const minutes = setup % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

const SA_PROVINCES = [
  "Eastern Cape",
  "Free State",
  "Gauteng",
  "KwaZulu-Natal",
  "Limpopo",
  "Mpumalanga",
  "North West",
  "Northern Cape",
  "Western Cape",
];

const PRIMARY_OPTIONS = [
  "Photo Booth (Printing or Digital)",
  "360 Video",
  "Video (Slow-Mo / Messages)",
  "Sketch Bot (NEW!)",
  "Mosaic (Digital or Print wall)",
  "Karaoke",
  "Insta Print Station",
  "Other",
];

const PHOTO_OUTPUT_OPTIONS = ["Printing", "Digital"];
const PHOTO_BOOTH_OPTIONS = [
  "Any, you can decide",
  "Nano Box",
  "Halo Box",
  "Selfie Box",
  "Vintage",
  "Mirror",
  "Retro Pod",
  "Cruise",
  "Tuxedo",
  "Shift",
];
const SPIN_OPTIONS = ["Infinity LED 360", "Orbit 360 Spin"];
const VIDEO_OPTIONS = ["Slow-Motion Video", "Testimonials / Messages", "Other"];

const BASE_EXTRAS = [
  "Vinyl Sticker branding - R900",
  "Data Capture - R200",
  "Disclaimer and Survey - R500",
];

const SPIN_EXTRAS = [
  "LED Light - R500",
  "Stanchions and Rope - R400",
];

const REGION_TO_BRANCH = {
  "Eastern Cape": "CT",
  "Free State": "GP",
  Gauteng: "GP",
  "KwaZulu-Natal": "KZN",
  Limpopo: "GP",
  Mpumalanga: "GP",
  "North West": "GP",
  "Northern Cape": "CT",
  "Western Cape": "CT",
};

// Booth choice -> dashboard product. The board's Products column stores the
// ABBREVIATED code (e.g. "RETRO", not "Retro Pod") — that's the value the product
// selector toggles on/off — so we map straight to the abbreviation. Keys = the exact
// value the website form submits (photoBoothChoice); values = the live product
// abbreviation (column 3 of Johan's PRODUCTS MAP.xlsx). Must match live exactly.
// Used for Photo Booth, AI Experience (booth chosen further down) and Hashtag (InstaBox/SideKick only).
const PHOTO_BOOTH_TO_PRODUCT = {
  "Any, you can decide": "",       // "Select" / leave blank
  Nano: "NANO",
  HaloBox: "HBWHITE",
  SelfieBox: "SELFI",
  Vintage: "VINTA",
  Mirror: "MIRRO",
  "Retro Pod": "RETRO",
  Cruise: "CRUIS",
  Tuxedo: "TUXED",
  Shift: "SHIFT",
  InstaBox: "INSTABO",
  SideKick: "SIDEK",
};

const SPIN_TO_PRODUCT = {
  "Infinity LED 360°": "ILED3",
  "Orbit 360° Spin": "360 ORB",
};

// Experiences that resolve straight to a product from primarySelection (no booth
// sub-choice). Keys = the form's primarySelection value; values = live product
// abbreviation. "Other" is intentionally absent -> leaves the product blank.
const PRIMARY_TO_PRODUCT = {
  "Sketch Bot (NEW!)": "AI SKET",
  Mosaic: "MOSAIC",
  Karaoke: "KARA",
  "Video (Slow-Mo / Messages)": "VIDEO",
  "Magazine Booth": "MAGAZ",
  "Audio Guest Book": "AUDIOGB",
};

function normalizeDashboardCustomerType(value) {
  return value === "Corporate Function" ? "Corporate function" : "Private Function";
}

function buildQuoteSelectionNotes(formData) {
  const parts = [formData.primarySelection];

  if (formData.primarySelection === "Photo Booth (Printing or Digital)") {
    parts.push(formData.photoOutput);
    parts.push(formData.photoBoothChoice);
  } else if (formData.primarySelection === "360 Video") {
    parts.push(formData.spinChoice);
  } else if (formData.primarySelection === "Video (Slow-Mo / Messages)") {
    parts.push(formData.videoChoice);
  }

  if (formData.primaryOther) parts.push(formData.primaryOther);
  if (formData.videoOther) parts.push(formData.videoOther);

  return parts.map((value) => normalizeString(value)).filter(Boolean).join(" - ");
}

async function resolveBranchAbbreviation(ctx, region) {
  const activeBranchOptions = await ctx.db
    .query("labelOptions")
    .withIndex("by_column", (q) => q.eq("columnKey", "branch"))
    .collect();
  const activeSet = new Set(
    activeBranchOptions
      .filter((option) => option.isActive !== false)
      .map((option) => normalizeString(option.abbreviation || option.optionKey || option.name))
      .filter(Boolean)
  );

  // A dedicated, active branch matching the submitted province's name wins
  // first (branches for North West / Limpopo / Mpumalanga have since been
  // added with their own office + email) - REGION_TO_BRANCH is only the
  // fallback for provinces that have never had their own branch (e.g. Free
  // State, Northern Cape), so it must not pre-empt a more specific match.
  const exactMatch = activeBranchOptions.find(
    (option) =>
      option.isActive !== false &&
      normalizeString(option.name) === region
  );
  if (exactMatch) {
    return normalizeString(exactMatch.abbreviation || exactMatch.optionKey || exactMatch.name);
  }

  const preferred = REGION_TO_BRANCH[region] || "";
  if (preferred && activeSet.has(preferred)) {
    return preferred;
  }

  return activeSet.has("GP") ? "GP" : Array.from(activeSet)[0] || "";
}

async function resolveProducts(ctx, formData) {
  const activeProductOptions = await ctx.db
    .query("labelOptions")
    .withIndex("by_column", (q) => q.eq("columnKey", "products"))
    .collect();
  const activeProducts = activeProductOptions.filter((option) => option.isActive !== false);
  // Validate against the ABBREVIATION (what the board stores in event.products),
  // mirroring resolveBranchAbbreviation. A mapped code that isn't an active product
  // abbreviation is dropped rather than written as an unselectable raw string.
  const activeProductCodes = new Set(
    activeProducts
      .map((option) => normalizeString(option.abbreviation || option.optionKey || option.name))
      .filter(Boolean)
  );

  const sel = formData.primarySelection;
  let mappedProduct = "";
  if (
    sel === "Photo Booth (Printing or Digital)" ||
    sel === "AI Experience" ||        // AI runs on a booth chosen further down
    sel === "Hashtag Printing"        // hashtag = InstaBox / SideKick (via photoBoothChoice)
  ) {
    mappedProduct = PHOTO_BOOTH_TO_PRODUCT[formData.photoBoothChoice] || "";
  } else if (sel === "360° Video") {
    mappedProduct = SPIN_TO_PRODUCT[formData.spinChoice] || "";
  } else {
    mappedProduct = PRIMARY_TO_PRODUCT[sel] || "";
  }
  const desiredProducts = mappedProduct ? [mappedProduct] : [];

  return desiredProducts.filter((product) => {
    const normalizedProduct = normalizeString(product);
    return normalizedProduct && activeProductCodes.has(normalizedProduct);
  });
}

function validateSubmission(formData) {
  // Option vocabularies (primary selection / booth / output / spin / video) are
  // controlled by the website form and evolve there, so we no longer hard-reject
  // on exact option membership — only require that a selection was made. The full
  // selection is preserved verbatim in the booking notes regardless.
  if (!normalizeString(formData.primarySelection)) {
    return "Please choose a quote option.";
  }

  if (!["Private Function", "Corporate Function"].includes(formData.functionType)) {
    return "Please choose whether this is a private or corporate function.";
  }
  if (!normalizeString(formData.contactPerson)) {
    return "Please enter the contact person.";
  }
  if (!normalizeString(formData.cell)) {
    return "Please enter the cell phone number.";
  }
  if (!normalizeEmail(formData.email).includes("@")) {
    return "Please enter a valid email address.";
  }
  if (!normalizeString(formData.eventDate)) {
    return "Please choose the date of the event.";
  }
  if (!SA_PROVINCES.includes(formData.region)) {
    return "Please choose a South African province.";
  }
  if (formData.functionType === "Corporate Function" && !normalizeString(formData.companyName)) {
    return "Please enter the company name.";
  }
  return "";
}

export const submitWebsiteQuote = mutation({
  args: {
    formData: v.object({
      primarySelection: v.string(),
      photoOutput: v.optional(v.string()),
      photoBoothChoice: v.optional(v.string()),
      spinChoice: v.optional(v.string()),
      videoChoice: v.optional(v.string()),
      functionType: v.string(),
      companyName: v.optional(v.string()),
      contactPerson: v.string(),
      cell: v.string(),
      email: v.string(),
      eventDate: v.string(),
      region: v.string(),
      address: v.optional(v.string()),
      addressPlaceId: v.optional(v.string()),
      addressLat: v.optional(v.union(v.number(), v.null())),
      addressLng: v.optional(v.union(v.number(), v.null())),
      eventStartTime: v.optional(v.string()),
      eventFinishTime: v.optional(v.string()),
      numberOfHours: v.optional(v.string()),
      primaryOther: v.optional(v.string()),
      videoOther: v.optional(v.string()),
      message: v.optional(v.string()),
      optionalExtras: v.optional(v.array(v.string())),
    }),
  },
  handler: async (ctx, args) => {
    const formData = {
      primarySelection: normalizeString(args.formData.primarySelection),
      photoOutput: normalizeString(args.formData.photoOutput),
      photoBoothChoice: normalizeString(args.formData.photoBoothChoice),
      spinChoice: normalizeString(args.formData.spinChoice),
      videoChoice: normalizeString(args.formData.videoChoice),
      functionType: normalizeString(args.formData.functionType),
      companyName: normalizeString(args.formData.companyName),
      contactPerson: normalizeString(args.formData.contactPerson),
      cell: normalizeString(args.formData.cell),
      email: normalizeEmail(args.formData.email),
      eventDate: normalizeString(args.formData.eventDate),
      region: normalizeString(args.formData.region),
      address: normalizeString(args.formData.address),
      addressPlaceId: normalizeString(args.formData.addressPlaceId),
      addressLat: typeof args.formData.addressLat === "number" ? args.formData.addressLat : null,
      addressLng: typeof args.formData.addressLng === "number" ? args.formData.addressLng : null,
      eventStartTime: normalizeString(args.formData.eventStartTime),
      eventFinishTime: normalizeString(args.formData.eventFinishTime),
      numberOfHours: normalizeString(args.formData.numberOfHours),
      primaryOther: normalizeString(args.formData.primaryOther),
      videoOther: normalizeString(args.formData.videoOther),
      message: normalizeString(args.formData.message),
      optionalExtras: normalizeArray(args.formData.optionalExtras),
    };

    const validationMessage = validateSubmission(formData);
    if (validationMessage) {
      throw new Error(validationMessage);
    }

    const extras = normalizeArray([
      ...(formData.optionalExtras || []),
    ]);
    const products = await resolveProducts(ctx, formData);
    const branchAbbreviation = await resolveBranchAbbreviation(ctx, formData.region);
    const now = Date.now();
    const workspaceYear = getWorkspaceYear(formData.eventDate);
    const eventKey = createUniqueEventKey();
    const token = await generateUniqueToken(ctx);
    const enquiryRef = createEnquiryRef();
    const name =
      formData.functionType === "Corporate Function"
        ? formData.companyName
        : formData.contactPerson;
    // hours column = duration; new time column = start–finish range
    const hours = formData.numberOfHours || getDurationHours(formData.eventStartTime, formData.eventFinishTime);
    const time = [formData.eventStartTime, formData.eventFinishTime]
      .map((value) => normalizeString(value))
      .filter(Boolean)
      .join(" - ");
    // AI Experience selected (as the primary pick, an extra, or "other") => flag G/AI.
    const gsAi = [formData.primarySelection, formData.primaryOther, ...(formData.optionalExtras || [])]
      .some((value) => /AI Experience/i.test(String(value || ""))) ? "Yes" : "";
    const bookingCustomerType = normalizeDashboardCustomerType(formData.functionType);
    const selectionNotes = buildQuoteSelectionNotes(formData);

    const eventId = await ctx.db.insert("events", {
      eventKey,
      workspaceYear,
      name,
      eventTitle: "",
      date: formData.eventDate,
      draftMonth: getMonthLabel(formData.eventDate),
      hours,
      time,
      branch: branchAbbreviation ? [branchAbbreviation] : [],
      products,
      // Photo-booth "Digital Only" output (no printing) => tick the Digital Only column.
      digitalOnly: normalizeString(formData.photoOutput) === "Digital Only",
      status: "Web Request",
      location: formData.address || "",
      locationPlaceId: formData.addressPlaceId || "",
      locationLat: typeof formData.addressLat === "number" ? formData.addressLat : undefined,
      locationLng: typeof formData.addressLng === "number" ? formData.addressLng : undefined,
      paymentStatus: "",
      accounts: "",
      quoteNumber: "",
      invoiceNumber: "",
      exVatAuto: "",
      vinyl: "",
      gsAi,
      imagesSent: "",
      snappic: "",
      attendants: [],
      exVat: "",
      packageOnly: "",
      notes: "",
      customFields: {},
      updates: [],
      files: [],
      activity: [
        createActivityEntry(
          "Website quote submitted.",
          formData.contactPerson || "Website Quote",
          now
        ),
      ],
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("eventBookings", {
      eventId,
      eventKey,
      token,
      formData: {
        product: products.join(", "),
        customerType: bookingCustomerType,
        eventName: "",
        companyName: formData.companyName || "",
        contactPerson: formData.contactPerson,
        cell: formData.cell,
        email: formData.email,
        eventDate: formData.eventDate,
        region: formData.region,
        address: formData.address || "",
        addressPlaceId: formData.addressPlaceId || "",
        addressLat: typeof formData.addressLat === "number" ? formData.addressLat : null,
        addressLng: typeof formData.addressLng === "number" ? formData.addressLng : null,
        pointOfContactName: "",
        pointOfContactNumber: "",
        setupTime: getSetupTime(formData.eventStartTime),
        eventStartTime: formData.eventStartTime || "",
        eventFinishTime: formData.eventFinishTime || "",
        durationHours: formData.numberOfHours || getDurationHours(formData.eventStartTime, formData.eventFinishTime),
        optionalExtras: extras,
        designYourself: "",
        notes: `Enquiry Ref: ${enquiryRef}\n\n` + (formData.message ? `${selectionNotes}\n\nMessage: ${formData.message}` : selectionNotes),
        acceptedTerms: false,
      },
      publicAccessCount: 0,
      createdAt: now,
      updatedAt: now,
      submittedAt: now,
    });

    await ctx.db.insert("activityLog", {
      workspaceYear,
      eventId,
      eventName: name,
      text: "Website quote submitted on staging.",
      shortText: `${name}: Website quote submitted on staging.`.slice(0, 120),
      actorName: formData.contactPerson || "Website Quote",
      createdAt: now,
    });

    await bumpStat(ctx, "quotes");
    return {
      ok: true,
      eventKey,
      bookingToken: token,
      eventId: String(eventId),
      name,
      eventTitle: "",
      ref: enquiryRef,
    };
  },
});
