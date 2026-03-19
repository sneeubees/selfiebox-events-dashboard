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
import { extractPlaceResult, hasGoogleMapsApiKey, loadGooglePlacesLibrary } from "./googleMaps";

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
    product: String(next.product || (pageState?.productNames || []).join(", ")),
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

function BookingAddressInput({ value, readOnly, onChange, onPlaceSelect }) {
  const wrapperRef = useRef(null);
  const autocompleteContainerRef = useRef(null);
  const autocompleteElementRef = useRef(null);
  const placeSelectHandlerRef = useRef(null);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (readOnly || !hasGoogleMapsApiKey()) {
      return;
    }
    void loadGooglePlacesLibrary().catch((error) => {
      console.error("Failed to preload Google Places for booking page", error);
    });
  }, [readOnly]);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const handlePointerDown = (event) => {
      if (wrapperRef.current?.contains(event.target)) {
        return;
      }
      setIsOpen(false);
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || readOnly || !hasGoogleMapsApiKey()) {
      return undefined;
    }

    let cancelled = false;
    let autocompleteElement = autocompleteElementRef.current;
    let selectHandler = placeSelectHandlerRef.current;

    const mountAutocomplete = async () => {
      const placesLibrary = await loadGooglePlacesLibrary();
      if (cancelled || !autocompleteContainerRef.current) {
        return;
      }

      if (!autocompleteElement) {
        autocompleteElement = new placesLibrary.PlaceAutocompleteElement();
        autocompleteElementRef.current = autocompleteElement;
      }

      autocompleteElement.placeholder = "Start typing address";
      autocompleteElement.style.width = "100%";

      if (selectHandler) {
        autocompleteElement.removeEventListener("gmp-select", selectHandler);
      }

      selectHandler = async (event) => {
        const nextPlace = event?.placePrediction?.toPlace ? await event.placePrediction.toPlace() : null;
        if (!nextPlace) {
          return;
        }
        const parsed = await extractPlaceResult(nextPlace);
        onChange(parsed.address);
        onPlaceSelect(parsed);
        setIsOpen(false);
      };

      placeSelectHandlerRef.current = selectHandler;
      autocompleteElement.addEventListener("gmp-select", selectHandler);

      autocompleteContainerRef.current.innerHTML = "";
      autocompleteContainerRef.current.appendChild(autocompleteElement);
    };

    void mountAutocomplete().catch((error) => {
      console.error("Failed to mount booking address autocomplete", error);
    });

    return () => {
      cancelled = true;
      if (autocompleteElement && selectHandler) {
        autocompleteElement.removeEventListener("gmp-select", selectHandler);
      }
    };
  }, [isOpen, onChange, onPlaceSelect, readOnly]);

  return (
    <div className="booking-address-field" ref={wrapperRef}>
      <input
        className="text-input"
        value={value}
        readOnly={readOnly}
        placeholder={hasGoogleMapsApiKey() ? "Search or type the event address" : "Enter the event address"}
        onFocus={() => !readOnly && setIsOpen(true)}
        onChange={(event) => onChange(event.target.value)}
      />
      {isOpen && !readOnly && hasGoogleMapsApiKey() ? (
        <div className="booking-address-popover">
          <div className="booking-address-autocomplete" ref={autocompleteContainerRef} />
          <div className="booking-address-actions">
            <button className="ghost-button" type="button" onClick={() => setIsOpen(false)}>
              Close
            </button>
          </div>
        </div>
      ) : null}
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
  const [setupTouched, setSetupTouched] = useState(false);
  const loadKeyRef = useRef("");
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
    setIsSubmitting(true);
    setFormNotice("");
    try {
      const result = await submitPublicForm({
        token,
        baseUrl: window.location.origin,
        formData: buildSubmitPayload(form, pageState),
      });
      setPageState(result);
      if (result?.status === "ok") {
        setForm((current) => ({
          ...createEmptyBookingForm(),
          ...(result.formData || {}),
          companyName: result.eventName || "",
          eventName: result.formData?.eventName || "",
          product: (result.productNames || []).join(", "),
          region: result.regionName || result.formData?.region || "",
          eventDate: result.eventDate || result.formData?.eventDate || "",
        }));
        setFormNotice("Booking form submitted successfully.");
      }
    } catch (error) {
      setFormNotice(error?.message || "The booking form could not be submitted.");
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
        <h1>Booking Form</h1>
        <p className="booking-page-meta">{pageState.eventName}</p>
        <p className="booking-page-products">{selectedProducts.join(", ")}</p>
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
            <input className="text-input" value={form.contactPerson} readOnly={isLocked} onChange={(event) => updateField("contactPerson", event.target.value)} />
          </BookingFormField>
          <BookingFormField label="Cell">
            <input className="text-input" value={form.cell} readOnly={isLocked} onChange={(event) => updateField("cell", event.target.value)} />
          </BookingFormField>
          <BookingFormField label="Email">
            <input className="text-input" type="email" value={form.email} readOnly={isLocked} onChange={(event) => updateField("email", event.target.value)} />
          </BookingFormField>

          <BookingStaticField label="Date of event" value={form.eventDate || pageState.eventDate} />
          <BookingStaticField label="Region" value={form.region || pageState.regionName} />

          <BookingFormField label="Address" className="full-span">
            <BookingAddressInput
              value={form.address}
              readOnly={isLocked}
              onChange={(nextValue) => updateField("address", nextValue)}
              onPlaceSelect={(place) =>
                setForm((current) => ({
                  ...current,
                  address: place.location || "",
                  addressPlaceId: place.locationPlaceId || "",
                  addressLat: typeof place.locationLat === "number" ? place.locationLat : null,
                  addressLng: typeof place.locationLng === "number" ? place.locationLng : null,
                }))
              }
            />
          </BookingFormField>

          <BookingFormField label="POC Name:" tooltip="Point of Contact">
            <input className="text-input" value={form.pointOfContactName} readOnly={isLocked} onChange={(event) => updateField("pointOfContactName", event.target.value)} />
          </BookingFormField>
          <BookingFormField label="POC Contact #">
            <input className="text-input" value={form.pointOfContactNumber} readOnly={isLocked} onChange={(event) => updateField("pointOfContactNumber", event.target.value)} />
          </BookingFormField>

          <div className="booking-time-row full-span">
            <BookingFormField label="Event start time">
              <input className="text-input" type="time" value={form.eventStartTime} readOnly={isLocked} onChange={(event) => updateStartTime(event.target.value)} />
            </BookingFormField>
            <BookingFormField
              label="Setup time"
              tooltip="Setup time is one hour before the event start and is free and not part of your quoted times"
            >
              <input
                className="text-input"
                type="time"
                value={form.setupTime}
                readOnly={isLocked}
                onChange={(event) => {
                  setSetupTouched(true);
                  updateField("setupTime", event.target.value);
                }}
              />
            </BookingFormField>
            <BookingFormField label="Event finish time">
              <input className="text-input" type="time" value={form.eventFinishTime} readOnly={isLocked} onChange={(event) => updateField("eventFinishTime", event.target.value)} />
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
              {["Yes", "No"].map((option) => (
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
              <input type="checkbox" checked={form.acceptedTerms} disabled={isLocked} onChange={(event) => updateField("acceptedTerms", event.target.checked)} />
              <span>I accept the SelfieBox terms and conditions.</span>
            </label>
          </div>
        </div>

        {formNotice ? <div className="auth-error booking-form-notice">{formNotice}</div> : null}
        {isLocked ? <div className="booking-lock-note">This booking form is locked on the day of the event and can no longer be edited.</div> : null}

        <div className="booking-form-actions">
          <button className="primary-button" type="button" onClick={() => void handleSubmit()} disabled={isSubmitting || isLocked}>
            {isSubmitting ? "Submitting..." : "Submit"}
          </button>
        </div>
      </div>
      {termsOpen ? <TermsModal onClose={() => setTermsOpen(false)} /> : null}
    </div>
  );
}
