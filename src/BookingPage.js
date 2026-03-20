import React, { useEffect, useMemo, useRef, useState } from "react";
import { SignIn, useUser } from "@clerk/react";
import { useMutation, useQuery } from "convex/react";
import { api } from "./convex/_generated/api";
import {
  BOOKING_CUSTOMER_TYPE_OPTIONS,
  BOOKING_TERMS_CONTENT,
  BOOKING_TERMS_TITLE,
  createEmptyBookingForm,
  getOptionalExtrasForProducts,
} from "./bookingConstants";
import { extractPlaceResult, hasGoogleMapsApiKey, loadGoogleMapsApi } from "./googleMaps";

export function getBookingTokenFromPath(pathname) {
  const normalized = String(pathname || "").trim();
  if (!normalized || normalized === "/") {
    return "";
  }
  return normalized.replace(/^\/+|\/+$/g, "");
}

function buildClerkAppearance() {
  return {
    elements: {
      cardBox: "clerk-cardbox",
      card: "clerk-card",
      headerTitle: "clerk-header-title",
      headerSubtitle: "clerk-header-subtitle",
      socialButtonsBlockButton: "clerk-social-button",
      socialButtonsBlockButtonText: "clerk-social-button-text",
      formButtonPrimary: "clerk-primary-button",
      footerActionLink: "clerk-footer-link",
      formFieldInput: "clerk-input",
      formFieldLabel: "clerk-label",
    },
  };
}

function formatTimeOffset(value, minutesDelta) {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    return "";
  }
  const totalMinutes = Number(match[1]) * 60 + Number(match[2]) + minutesDelta;
  const wrapped = ((totalMinutes % (24 * 60)) + (24 * 60)) % (24 * 60);
  const hours = Math.floor(wrapped / 60);
  const minutes = wrapped % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function buildSubmitPayload(form, pageState) {
  const base = createEmptyBookingForm();
  const next = { ...base, ...(form || {}) };

  return {
    product: String((pageState?.productNames || []).join(", ")),
    customerType: String(next.customerType || ""),
    eventName: String(next.eventName || ""),
    companyName: String(pageState?.eventName || next.companyName || ""),
    contactPerson: String(next.contactPerson || ""),
    cell: String(next.cell || ""),
    email: String(next.email || ""),
    eventDate: String(next.eventDate || pageState?.eventDate || ""),
    region: String(next.region || pageState?.regionName || ""),
    address: String(next.address || ""),
    addressPlaceId: String(next.addressPlaceId || ""),
    addressLat: typeof next.addressLat === "number" ? next.addressLat : null,
    addressLng: typeof next.addressLng === "number" ? next.addressLng : null,
    pointOfContactName: String(next.pointOfContactName || ""),
    pointOfContactNumber: String(next.pointOfContactNumber || ""),
    setupTime: String(next.setupTime || ""),
    eventStartTime: String(next.eventStartTime || ""),
    eventFinishTime: String(next.eventFinishTime || ""),
    durationHours: "",
    optionalExtras: Array.isArray(next.optionalExtras) ? next.optionalExtras.map((value) => String(value || "")) : [],
    designYourself: String(next.designYourself || ""),
    notes: String(next.notes || ""),
    acceptedTerms: Boolean(next.acceptedTerms),
  };
}

function getFriendlyBookingValidationMessage(form, pageState) {
  const payload = buildSubmitPayload(form, pageState);
  if (!payload.contactPerson) return "Please complete Contact person.";
  if (!payload.cell) return "Please complete Cell.";
  if (!payload.email) return "Please complete Email.";
  if (!payload.email.includes("@")) return "Please enter a valid Email address.";
  if (!payload.designYourself) return "Please complete Design yourself.";
  if (!payload.acceptedTerms) return "Please accept the Terms and Conditions.";
  return "";
}

function getBookingErrorMessage(error) {
  const raw = String(error?.message || "").trim();
  if (!raw) {
    return "The booking form could not be saved. Please try again.";
  }
  const matched = raw.match(/Please (?:enter|choose|accept|complete) (.+?)(?:\.|$)/i);
  if (matched?.[1]) {
    const cleaned = matched[1]
      .replace(/^a valid\s+/i, "")
      .replace(/^the\s+/i, "")
      .trim();
    if (/email address/i.test(matched[1])) {
      return "Please enter a valid Email address.";
    }
    return `Please complete ${cleaned.charAt(0).toUpperCase()}${cleaned.slice(1)}.`;
  }
  return "The booking form could not be saved. Please check the required fields and try again.";
}

async function getPublicIpAddress() {
  try {
    const response = await fetch("https://api.ipify.org?format=json");
    if (!response.ok) {
      return "";
    }
    const payload = await response.json();
    return String(payload?.ip || "").trim();
  } catch {
    return "";
  }
}

function BookingAddressInput({ value, readOnly, onChange, onPlaceSelect, inputElementRef }) {
  const inputRef = useRef(null);
  const autocompleteRef = useRef(null);
  const listenerRef = useRef(null);

  useEffect(() => {
    if (inputElementRef) {
      inputElementRef.current = inputRef.current;
    }
  }, [inputElementRef, value]);

  useEffect(() => {
    if (readOnly || !hasGoogleMapsApiKey()) {
      return;
    }
    if (!inputRef.current) {
      return undefined;
    }

    let cancelled = false;
    void loadGoogleMapsApi()
      .then((google) => {
        if (cancelled || !google?.maps?.places || !inputRef.current) {
          return;
        }
        if (listenerRef.current) {
          google.maps.event.removeListener(listenerRef.current);
        }
        autocompleteRef.current = new google.maps.places.Autocomplete(inputRef.current, {
          componentRestrictions: { country: "za" },
          fields: ["formatted_address", "geometry", "place_id", "name"],
          types: ["geocode"],
        });
        listenerRef.current = autocompleteRef.current.addListener("place_changed", () => {
          const place = autocompleteRef.current?.getPlace?.();
          const parsed = extractPlaceResult(place, "");
          window.setTimeout(() => {
            const committedAddress =
              inputRef.current?.value ||
              parsed.location ||
              place?.formatted_address ||
              place?.name ||
              "";
            if (inputRef.current && committedAddress) {
              inputRef.current.value = committedAddress;
            }
            onChange(committedAddress);
            onPlaceSelect({
              ...parsed,
              location: committedAddress,
            });
          }, 0);
        });
      })
      .catch((error) => {
        console.error("Failed to mount booking address autocomplete", error);
      });

    return () => {
      cancelled = true;
      if (listenerRef.current && window.google?.maps?.event) {
        window.google.maps.event.removeListener(listenerRef.current);
        listenerRef.current = null;
      }
    };
  }, [onChange, onPlaceSelect, readOnly]);

  return (
    <input
      ref={inputRef}
      className="text-input"
      value={value}
      readOnly={readOnly}
      autoComplete="new-password"
      spellCheck={false}
      placeholder={hasGoogleMapsApiKey() ? "Search or type the event address" : "Enter the event address"}
      onChange={(event) => onChange(event.target.value)}
      onBlur={() => {
        const nextValue = inputRef.current?.value || "";
        onChange(nextValue);
      }}
    />
  );
}

function TimeSpinnerInput({ value, onChange, readOnly }) {
  const safeValue = String(value || "");
  const match = safeValue.match(/^(\d{1,2}):(\d{2})$/);
  const hourValue = match ? Number(match[1]) : "";
  const minuteValue = match ? Number(match[2]) : "";

  const updatePart = (part, rawValue) => {
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed)) {
      onChange("");
      return;
    }
    const hours = part === "hour" ? parsed : (Number.isFinite(hourValue) ? hourValue : 0);
    const minutes = part === "minute" ? parsed : (Number.isFinite(minuteValue) ? minuteValue : 0);
    const clampedHours = Math.max(0, Math.min(23, hours));
    const clampedMinutes = Math.max(0, Math.min(59, minutes));
    onChange(`${String(clampedHours).padStart(2, "0")}:${String(clampedMinutes).padStart(2, "0")}`);
  };

  return (
    <div className="time-spinner-input">
      <input
        className="time-spinner-field"
        type="number"
        min="0"
        max="23"
        step="1"
        value={hourValue}
        readOnly={readOnly}
        onChange={(event) => updatePart("hour", event.target.value)}
      />
      <span className="time-spinner-separator">:</span>
      <input
        className="time-spinner-field"
        type="number"
        min="0"
        max="59"
        step="5"
        value={minuteValue}
        readOnly={readOnly}
        onChange={(event) => updatePart("minute", event.target.value)}
      />
    </div>
  );
}

function BookingFormField({ label, helper, tooltip, className = "", children }) {
  return (
    <label className={`booking-form-field ${className}`.trim()}>
      <span>
        {label}
        {helper ? <small>{helper}</small> : null}
        {tooltip ? <button className="booking-help-dot" type="button" title={tooltip}>?</button> : null}
      </span>
      {children}
    </label>
  );
}

function BookingStaticField({ label, value }) {
  return (
    <div className="booking-static-field">
      <span>{label}</span>
      <strong>{value || "-"}</strong>
    </div>
  );
}

function TermsModal({ onClose }) {
  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal-panel booking-terms-modal" role="dialog" aria-modal="true" aria-label={BOOKING_TERMS_TITLE} onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <h3>{BOOKING_TERMS_TITLE}</h3>
          <button className="modal-close-x" type="button" onClick={onClose}>x</button>
        </div>
        <div className="booking-terms-modal-body">
          {BOOKING_TERMS_CONTENT.map((section) => (
            <section key={section.title} className="booking-terms-section">
              <h4>{section.title}</h4>
              {section.body.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function BookingPage({ token }) {
  const { isLoaded, isSignedIn } = useUser();
  const currentUser = useQuery(api.users.current, isSignedIn ? {} : "skip");
  const openPublicLink = useMutation(api.bookings.openPublicLink);
  const submitPublicForm = useMutation(api.bookings.submitPublicForm);
  const [form, setForm] = useState(createEmptyBookingForm());
  const [pageState, setPageState] = useState({ status: "loading" });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formNotice, setFormNotice] = useState("");
  const [termsOpen, setTermsOpen] = useState(false);
  const [submitModalOpen, setSubmitModalOpen] = useState(false);
  const [setupTouched, setSetupTouched] = useState(false);
  const loadKeyRef = useRef("");
  const addressInputElementRef = useRef(null);
  const addressDraftRef = useRef("");
  const addressPlaceRef = useRef({
    placeId: "",
    lat: null,
    lng: null,
  });
  const clerkAppearance = useMemo(() => buildClerkAppearance(), []);

  useEffect(() => {
    if (!isLoaded) {
      return;
    }

    const nextLoadKey = `${token}:${isSignedIn ? "auth" : "anon"}:${currentUser?.id || ""}`;
    if (loadKeyRef.current === nextLoadKey) {
      return;
    }
    loadKeyRef.current = nextLoadKey;

    let cancelled = false;
    setPageState({ status: "loading" });

    void openPublicLink({ token })
      .then((result) => {
        if (cancelled) {
          return;
        }
        setPageState(result);
        if (result?.status === "ok") {
          const nextForm = { ...createEmptyBookingForm(), ...(result.formData || {}) };
          if (!nextForm.eventName) {
            nextForm.eventName = result.eventTitle || "";
          }
          if (!nextForm.companyName) {
            nextForm.companyName = result.eventName || "";
          }
          if (!nextForm.product) {
            nextForm.product = (result.productNames || []).join(", ");
          }
          if (!nextForm.region) {
            nextForm.region = result.regionName || "";
          }
          if (!nextForm.eventDate) {
            nextForm.eventDate = result.eventDate || "";
          }
          if (!nextForm.setupTime && nextForm.eventStartTime) {
            nextForm.setupTime = formatTimeOffset(nextForm.eventStartTime, -60);
          }
          setSetupTouched(
            Boolean(nextForm.setupTime) &&
            nextForm.setupTime !== formatTimeOffset(nextForm.eventStartTime, -60)
          );
          addressDraftRef.current = nextForm.address || "";
          addressPlaceRef.current = {
            placeId: nextForm.addressPlaceId || "",
            lat: typeof nextForm.addressLat === "number" ? nextForm.addressLat : null,
            lng: typeof nextForm.addressLng === "number" ? nextForm.addressLng : null,
          };
          setForm(nextForm);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          console.error("Failed to open booking link", error);
          setPageState({ status: "error", message: error?.message || "The booking link could not be opened." });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [currentUser?.id, isLoaded, isSignedIn, openPublicLink, token]);

  const selectedProducts = useMemo(() => pageState.productNames || [], [pageState.productNames]);
  const optionalExtrasOptions = useMemo(() => getOptionalExtrasForProducts(selectedProducts), [selectedProducts]);
  const isLocked = Boolean(pageState.isLocked);

  const updateField = (key, value) => {
    if (key === "address") {
      addressDraftRef.current = value;
      addressPlaceRef.current = {
        placeId: "",
        lat: null,
        lng: null,
      };
    }
    setForm((current) => ({ ...current, [key]: value }));
    setFormNotice("");
  };

  const updateStartTime = (value) => {
    setForm((current) => ({
      ...current,
      eventStartTime: value,
      setupTime: setupTouched ? current.setupTime : formatTimeOffset(value, -60),
    }));
    setFormNotice("");
  };

  const toggleExtra = (option) => {
    setForm((current) => {
      const selected = new Set(current.optionalExtras || []);
      if (selected.has(option)) {
        selected.delete(option);
      } else {
        selected.add(option);
      }
      return { ...current, optionalExtras: Array.from(selected) };
    });
  };

  const handleSubmit = async () => {
    const liveAddressValue = String(addressInputElementRef.current?.value || "").trim();
    const submitForm = {
      ...form,
      address: liveAddressValue || addressDraftRef.current || form.address || "",
      addressPlaceId: addressPlaceRef.current.placeId || form.addressPlaceId || "",
      addressLat:
        typeof addressPlaceRef.current.lat === "number"
          ? addressPlaceRef.current.lat
          : form.addressLat,
      addressLng:
        typeof addressPlaceRef.current.lng === "number"
          ? addressPlaceRef.current.lng
          : form.addressLng,
    };
    const validationMessage = getFriendlyBookingValidationMessage(submitForm, pageState);
    if (validationMessage) {
      setFormNotice(validationMessage);
      return;
    }
    setIsSubmitting(true);
    setFormNotice("");
    try {
      const clientIp = await getPublicIpAddress();
      const result = await submitPublicForm({
        token,
        baseUrl: window.location.origin,
        clientIp,
        formData: buildSubmitPayload(submitForm, pageState),
      });
      setPageState(result);
      if (result?.status === "ok") {
        const nextForm = {
          ...createEmptyBookingForm(),
          ...(result.formData || {}),
          companyName: result.eventName || "",
          eventName: result.formData?.eventName || "",
          product: (result.productNames || []).join(", "),
          region: result.regionName || result.formData?.region || "",
          eventDate: result.eventDate || result.formData?.eventDate || "",
        };
        addressDraftRef.current = nextForm.address || "";
        addressPlaceRef.current = {
          placeId: nextForm.addressPlaceId || "",
          lat: typeof nextForm.addressLat === "number" ? nextForm.addressLat : null,
          lng: typeof nextForm.addressLng === "number" ? nextForm.addressLng : null,
        };
        setForm((current) => ({
          ...current,
          ...nextForm,
        }));
        setSubmitModalOpen(true);
      }
    } catch (error) {
      setFormNotice(getBookingErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isLoaded || pageState.status === "loading") {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <div className="auth-brand">SelfieBox Events Platform</div>
          <h1>Loading booking form</h1>
          <p>Please wait while we prepare your booking form.</p>
        </div>
      </div>
    );
  }

  if (pageState.status === "not_found") {
    return (
      <div className="auth-shell">
        <div className="auth-card booking-status-card">
          <div className="auth-brand">SelfieBox Events Platform</div>
          <h1>Booking link not found</h1>
          <p>This booking link is invalid or no longer available.</p>
        </div>
      </div>
    );
  }

  if (pageState.status === "requires_auth" || pageState.status === "public_limit_reached") {
    return (
      <div className="auth-shell">
        <div className="auth-card booking-status-card">
          <div className="auth-brand">SelfieBox Events Platform</div>
          <h1>Registered user access required</h1>
          <p>
            {pageState.status === "public_limit_reached"
              ? "This booking link has reached its public click limit. Please sign in with a registered platform account to continue."
              : "This booking link is now restricted to registered SelfieBox platform users."}
          </p>
          {isSignedIn && !currentUser ? <p>Your user account is signed in, but it is not approved for platform access yet.</p> : null}
          {!isSignedIn ? <div className="clerk-auth-shell"><SignIn routing="hash" appearance={clerkAppearance} /></div> : null}
        </div>
      </div>
    );
  }

  if (pageState.status === "error") {
    return (
      <div className="auth-shell">
        <div className="auth-card booking-status-card">
          <div className="auth-brand">SelfieBox Events Platform</div>
          <h1>Booking form unavailable</h1>
          <p>{pageState.message || "The booking form could not be loaded right now."}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="booking-page-shell">
      <div className="booking-page-card">
        <div className="auth-brand">SelfieBox Events Platform</div>
        <h1>Booking Form: <span className="booking-page-client-name">{pageState.eventName}</span></h1>
        <p className="booking-page-subtitle">Event Name: <span className="booking-page-client-name">{pageState.eventTitle || "N/A"}</span></p>
        <p className="booking-page-meta">{[pageState.eventDate, pageState.venueAddress].filter(Boolean).join(" · ")}</p>
        <p className="booking-page-products"><span>Your product:</span> <strong>{selectedProducts.join(", ") || "N/A"}</strong></p>
        <div className="booking-document-meta">
          <div><span>Your Quote:</span>{pageState.quoteNumber ? (pageState.quoteUrl ? <a href={pageState.quoteUrl} target="_blank" rel="noreferrer">{pageState.quoteNumber}</a> : <strong>{pageState.quoteNumber}</strong>) : <strong>N/A</strong>}</div>
          <div><span>Your Invoice:</span>{pageState.invoiceNumber ? (pageState.invoiceUrl ? <a href={pageState.invoiceUrl} target="_blank" rel="noreferrer">{pageState.invoiceNumber}</a> : <strong>{pageState.invoiceNumber}</strong>) : <strong>N/A</strong>}</div>
          <div><span>Design/Artwork Status:</span><strong>{pageState.designStatus || "N/A"}</strong></div>
          <div><span>Your attendant is:</span><strong>{pageState.attendantName || "Attendant not yet assigned"}</strong></div>
        </div>
        <div className="booking-form-grid">
          <div className="booking-form-field full-span booking-radio-inline">
            <div className="booking-choice-row">
              {BOOKING_CUSTOMER_TYPE_OPTIONS.map((option) => (
                <label key={option} className="booking-inline-choice">
                  <input
                    type="radio"
                    name="customerType"
                    checked={form.customerType === option}
                    disabled={isLocked}
                    onChange={() => updateField("customerType", option)}
                  />
                  <span>{option}</span>
                </label>
              ))}
            </div>
          </div>

          <BookingFormField label="Event Name">
            <input className="text-input" value={form.eventName} readOnly={isLocked} onChange={(event) => updateField("eventName", event.target.value)} />
          </BookingFormField>
          <BookingFormField label="Contact person">
            <input className="text-input" required value={form.contactPerson} readOnly={isLocked} onChange={(event) => updateField("contactPerson", event.target.value)} />
          </BookingFormField>
          <BookingFormField label="Cell">
            <input className="text-input" required value={form.cell} readOnly={isLocked} onChange={(event) => updateField("cell", event.target.value)} />
          </BookingFormField>
          <BookingFormField label="Email">
            <input className="text-input" required type="email" value={form.email} readOnly={isLocked} onChange={(event) => updateField("email", event.target.value)} />
          </BookingFormField>

          <BookingStaticField label="Date of event" value={form.eventDate || pageState.eventDate} />
          <BookingStaticField label="Region" value={form.region || pageState.regionName} />

          <BookingFormField label="Address" className="full-span">
            <BookingAddressInput
              value={form.address}
              readOnly={isLocked}
              inputElementRef={addressInputElementRef}
              onChange={(nextValue) => updateField("address", nextValue)}
              onPlaceSelect={(place) => {
                addressDraftRef.current = place.location || "";
                addressPlaceRef.current = {
                  placeId: place.locationPlaceId || "",
                  lat: typeof place.locationLat === "number" ? place.locationLat : null,
                  lng: typeof place.locationLng === "number" ? place.locationLng : null,
                };
                setForm((current) => ({
                  ...current,
                  address: place.location || "",
                  addressPlaceId: place.locationPlaceId || "",
                  addressLat: typeof place.locationLat === "number" ? place.locationLat : null,
                  addressLng: typeof place.locationLng === "number" ? place.locationLng : null,
                }));
              }}
            />
          </BookingFormField>

          <BookingFormField label="POC Name:" tooltip="Point of Contact">
            <input className="text-input" value={form.pointOfContactName} readOnly={isLocked} onChange={(event) => updateField("pointOfContactName", event.target.value)} />
          </BookingFormField>
          <BookingFormField label="POC Contact #">
            <input className="text-input" value={form.pointOfContactNumber} readOnly={isLocked} onChange={(event) => updateField("pointOfContactNumber", event.target.value)} />
          </BookingFormField>

          <div className="booking-time-row full-span">
            <BookingFormField
              label="Setup time"
              tooltip="Setup time is one hour before the event start and is free and not part of your quoted times"
            >
              <TimeSpinnerInput value={form.setupTime} readOnly={isLocked} onChange={(nextValue) => {
                setSetupTouched(true);
                updateField("setupTime", nextValue);
              }} />
            </BookingFormField>
            <BookingFormField label="Event start time">
              <TimeSpinnerInput value={form.eventStartTime} readOnly={isLocked} onChange={updateStartTime} />
            </BookingFormField>
            <BookingFormField label="Event finish time">
              <TimeSpinnerInput value={form.eventFinishTime} readOnly={isLocked} onChange={(nextValue) => updateField("eventFinishTime", nextValue)} />
            </BookingFormField>
          </div>

          <div className="booking-form-field full-span">
            <span>Optional Extras</span>
            <div className="booking-extras-grid">
              {optionalExtrasOptions.length ? optionalExtrasOptions.map((option) => (
                <label key={option} className="booking-inline-choice">
                  <input type="checkbox" checked={(form.optionalExtras || []).includes(option)} disabled={isLocked} onChange={() => toggleExtra(option)} />
                  <span>{option}</span>
                </label>
              )) : <div className="booking-empty-state">No optional extras for the selected product mix.</div>}
            </div>
          </div>

          <div className="booking-form-field booking-radio-group full-span">
            <span>Design yourself</span>
            <div className="booking-choice-row">
              {["Yes", "No", "Not sure yet"].map((option) => (
                <label key={option} className="booking-inline-choice">
                  <input
                    type="radio"
                    name="designYourself"
                    checked={form.designYourself === option}
                    disabled={isLocked}
                    onChange={() => updateField("designYourself", option)}
                  />
                  <span>{option}</span>
                </label>
              ))}
            </div>
          </div>

          <BookingFormField
            label="Notes / Special Instructions"
            helper="Venue access instructions - Specific dress code requests etc."
            className="full-span"
          >
            <textarea rows={5} value={form.notes} readOnly={isLocked} onChange={(event) => updateField("notes", event.target.value)} />
          </BookingFormField>

          <div className="booking-form-field full-span booking-terms-card">
            <span>Ts and Cs</span>
            <p>
              By submitting this booking form, you confirm that the details supplied are correct and may be used by SelfieBox to plan,
              coordinate, and deliver the event. Final bookings remain subject to availability, travel requirements, setup constraints,
              and{" "}
              <button className="booking-inline-link" type="button" onClick={() => setTermsOpen(true)}>
                standard terms and conditions
              </button>.
            </p>
            <label className="booking-inline-choice booking-terms-accept">
              <input required type="checkbox" checked={form.acceptedTerms} disabled={isLocked} onChange={(event) => updateField("acceptedTerms", event.target.checked)} />
              <span>I accept the SelfieBox terms and conditions.</span>
            </label>
          </div>
        </div>

        {formNotice ? <div className="auth-error booking-form-notice">{formNotice}</div> : null}
        {isLocked ? <div className="booking-lock-note">This booking form is locked on the day of the event and can no longer be edited.</div> : null}

        <div className="booking-form-actions">
          <button className="primary-button" type="button" onClick={() => void handleSubmit()} disabled={isSubmitting || isLocked}>
            {isSubmitting ? "Saving..." : "Save & Email"}
          </button>
        </div>
      </div>
      {termsOpen ? <TermsModal onClose={() => setTermsOpen(false)} /> : null}
      {submitModalOpen ? <div className="modal-scrim" onClick={() => setSubmitModalOpen(false)}><div className="modal-panel booking-submit-modal" role="dialog" aria-modal="true" aria-label="Booking saved" onClick={(event) => event.stopPropagation()}><div className="modal-header"><h3>Booking updated</h3><button className="modal-close-x" type="button" onClick={() => setSubmitModalOpen(false)}>x</button></div><div className="simple-stack"><p>Thank you for completing/updating your booking. You will receive an email with the new booking form shortly. Come back any time to make more changes.</p><div className="modal-actions"><button className="ghost-button" type="button" onClick={() => setSubmitModalOpen(false)}>Back to booking form</button><button className="primary-button" type="button" onClick={() => { window.close(); setTimeout(() => { if (typeof window !== "undefined") { window.location.replace("about:blank"); } }, 120); }}>Close Form</button></div></div></div></div> : null}
    </div>
  );
}
