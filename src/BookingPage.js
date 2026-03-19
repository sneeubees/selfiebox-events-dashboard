import React, { useEffect, useMemo, useRef, useState } from "react";
import { SignIn, useUser } from "@clerk/react";
import { useMutation, useQuery } from "convex/react";
import { api } from "./convex/_generated/api";
import {
  BOOKING_CUSTOMER_TYPE_OPTIONS,
  BOOKING_DURATION_OPTIONS,
  BOOKING_OPTIONAL_EXTRA_OPTIONS,
  BOOKING_PRODUCT_OPTIONS,
  BOOKING_REGION_OPTIONS,
  BOOKING_TERMS_TEXT,
  createEmptyBookingForm,
} from "./bookingConstants";
import { extractPlaceResult, hasGoogleMapsApiKey, loadGooglePlacesLibrary } from "./googleMaps";

export function getBookingTokenFromPath(pathname) {
  const normalized = String(pathname || "").trim();
  if (!normalized || normalized === "/") {
    return "";
  }
  return normalized.replace(/^\/+|\/+$/g, "");
}

function BookingAddressInput({ value, onChange, onPlaceSelect }) {
  const wrapperRef = useRef(null);
  const autocompleteContainerRef = useRef(null);
  const autocompleteElementRef = useRef(null);
  const placeSelectHandlerRef = useRef(null);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (!hasGoogleMapsApiKey()) {
      return;
    }
    void loadGooglePlacesLibrary().catch((error) => {
      console.error("Failed to preload Google Places for booking page", error);
    });
  }, []);

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
    if (!isOpen || !hasGoogleMapsApiKey()) {
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
  }, [isOpen, onChange, onPlaceSelect]);

  return (
    <div className="booking-address-field" ref={wrapperRef}>
      <input
        className="text-input"
        value={value}
        placeholder={hasGoogleMapsApiKey() ? "Search or type the event address" : "Enter the event address"}
        onFocus={() => setIsOpen(true)}
        onChange={(event) => onChange(event.target.value)}
      />
      {isOpen && hasGoogleMapsApiKey() ? (
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

function BookingFormField({ label, children }) {
  return (
    <label className="booking-form-field">
      <span>{label}</span>
      {children}
    </label>
  );
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

function buildSubmitPayload(form) {
  const base = createEmptyBookingForm();
  const next = { ...base, ...(form || {}) };

  return {
    product: String(next.product || ""),
    customerType: String(next.customerType || ""),
    companyName: String(next.companyName || ""),
    contactPerson: String(next.contactPerson || ""),
    cell: String(next.cell || ""),
    email: String(next.email || ""),
    eventDate: String(next.eventDate || ""),
    region: String(next.region || ""),
    address: String(next.address || ""),
    addressPlaceId: String(next.addressPlaceId || ""),
    addressLat: typeof next.addressLat === "number" ? next.addressLat : null,
    addressLng: typeof next.addressLng === "number" ? next.addressLng : null,
    pointOfContactName: String(next.pointOfContactName || ""),
    pointOfContactNumber: String(next.pointOfContactNumber || ""),
    eventStartTime: String(next.eventStartTime || ""),
    eventFinishTime: String(next.eventFinishTime || ""),
    durationHours: String(next.durationHours || ""),
    optionalExtras: Array.isArray(next.optionalExtras) ? next.optionalExtras.map((value) => String(value || "")) : [],
    designYourself: String(next.designYourself || ""),
    notes: String(next.notes || ""),
    acceptedTerms: Boolean(next.acceptedTerms),
  };
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
          setForm({ ...createEmptyBookingForm(), ...(result.formData || {}) });
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

  const updateField = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
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
        formData: buildSubmitPayload(form),
      });
      setPageState(result);
      if (result?.status === "ok") {
        setForm({ ...createEmptyBookingForm(), ...(result.formData || {}) });
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
        <div className="booking-form-grid">
          <BookingFormField label="Product">
            <select value={form.product} onChange={(event) => updateField("product", event.target.value)}>
              <option value="">Select product</option>
              {BOOKING_PRODUCT_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </BookingFormField>

          <div className="booking-form-field booking-radio-group">
            <span>Booking Type</span>
            <div className="booking-choice-row">
              {BOOKING_CUSTOMER_TYPE_OPTIONS.map((option) => (
                <label key={option} className="booking-inline-choice">
                  <input
                    type="radio"
                    name="customerType"
                    checked={form.customerType === option}
                    onChange={() => updateField("customerType", option)}
                  />
                  <span>{option}</span>
                </label>
              ))}
            </div>
          </div>

          <BookingFormField label="Company Name">
            <input className="text-input" value={form.companyName} onChange={(event) => updateField("companyName", event.target.value)} />
          </BookingFormField>
          <BookingFormField label="Contact person">
            <input className="text-input" value={form.contactPerson} onChange={(event) => updateField("contactPerson", event.target.value)} />
          </BookingFormField>
          <BookingFormField label="Cell">
            <input className="text-input" value={form.cell} onChange={(event) => updateField("cell", event.target.value)} />
          </BookingFormField>
          <BookingFormField label="Email">
            <input className="text-input" type="email" value={form.email} onChange={(event) => updateField("email", event.target.value)} />
          </BookingFormField>
          <BookingFormField label="Date of event">
            <input className="text-input" type="date" value={form.eventDate} onChange={(event) => updateField("eventDate", event.target.value)} />
          </BookingFormField>
          <BookingFormField label="Region">
            <select value={form.region} onChange={(event) => updateField("region", event.target.value)}>
              <option value="">Select region</option>
              {BOOKING_REGION_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </BookingFormField>
          <BookingFormField label="Address (Google Maps)">
            <BookingAddressInput
              value={form.address}
              onChange={(nextValue) => updateField("address", nextValue)}
              onPlaceSelect={(place) =>
                setForm((current) => ({
                  ...current,
                  address: place.address,
                  addressPlaceId: place.placeId || "",
                  addressLat: typeof place.locationLat === "number" ? place.locationLat : null,
                  addressLng: typeof place.locationLng === "number" ? place.locationLng : null,
                }))
              }
            />
          </BookingFormField>
          <BookingFormField label="Point of contact on the day - Name">
            <input className="text-input" value={form.pointOfContactName} onChange={(event) => updateField("pointOfContactName", event.target.value)} />
          </BookingFormField>
          <BookingFormField label="Point of Contact on the day - Contact Number">
            <input className="text-input" value={form.pointOfContactNumber} onChange={(event) => updateField("pointOfContactNumber", event.target.value)} />
          </BookingFormField>
          <BookingFormField label="Event start time">
            <input className="text-input" type="time" value={form.eventStartTime} onChange={(event) => updateField("eventStartTime", event.target.value)} />
          </BookingFormField>
          <BookingFormField label="Event finish time">
            <input className="text-input" type="time" value={form.eventFinishTime} onChange={(event) => updateField("eventFinishTime", event.target.value)} />
          </BookingFormField>
          <BookingFormField label="Or Duration">
            <select value={form.durationHours} onChange={(event) => updateField("durationHours", event.target.value)}>
              <option value="">Select duration</option>
              {BOOKING_DURATION_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option} Hours
                </option>
              ))}
            </select>
          </BookingFormField>

          <div className="booking-form-field full-span">
            <span>Optional Extras</span>
            <div className="booking-extras-grid">
              {BOOKING_OPTIONAL_EXTRA_OPTIONS.map((option) => (
                <label key={option} className="booking-inline-choice">
                  <input type="checkbox" checked={(form.optionalExtras || []).includes(option)} onChange={() => toggleExtra(option)} />
                  <span>{option}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="booking-form-field booking-radio-group full-span">
            <span>Design Yourself</span>
            <div className="booking-choice-row">
              {["Yes", "No"].map((option) => (
                <label key={option} className="booking-inline-choice">
                  <input
                    type="radio"
                    name="designYourself"
                    checked={form.designYourself === option}
                    onChange={() => updateField("designYourself", option)}
                  />
                  <span>{option}</span>
                </label>
              ))}
            </div>
          </div>

          <BookingFormField label="Notes / Special Instructions">
            <textarea rows={5} value={form.notes} onChange={(event) => updateField("notes", event.target.value)} />
          </BookingFormField>

          <div className="booking-form-field full-span booking-terms-card">
            <span>Ts and Cs</span>
            <p>{BOOKING_TERMS_TEXT}</p>
            <label className="booking-inline-choice booking-terms-accept">
              <input type="checkbox" checked={form.acceptedTerms} onChange={(event) => updateField("acceptedTerms", event.target.checked)} />
              <span>I accept the SelfieBox terms and conditions.</span>
            </label>
          </div>
        </div>

        {formNotice ? <div className="auth-error booking-form-notice">{formNotice}</div> : null}

        <div className="booking-form-actions">
          <button className="primary-button" type="button" onClick={() => void handleSubmit()} disabled={isSubmitting}>
            {isSubmitting ? "Submitting..." : "Submit"}
          </button>
        </div>
      </div>
    </div>
  );
}
