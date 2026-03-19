export const BOOKING_PRODUCT_OPTIONS = [
  'Print Booth',
  'Spin Booth',
  'Video Booth',
  'Mosaic',
  'SketchBot',
];

export const BOOKING_CUSTOMER_TYPE_OPTIONS = [
  'Corporate - Expo/Year-end/Exhibition/Launch etc',
  'Private - wedding/birthday/anniversary etc',
];

export const BOOKING_REGION_OPTIONS = [
  'Gauteng',
  'Cape Town',
  'KwaZulu-Natal',
  'Free-State',
  'North West',
  'Port Elizabeth',
  'Limpopo',
];

export const BOOKING_DURATION_OPTIONS = ['2', '3', '4', '5', '6', '7', '8', '9', '10'];

export const BOOKING_OPTIONAL_EXTRA_OPTIONS = [
  'LED Lighting - Dimmable',
  'Round Top Stanchions & Rope',
  'Vinyl Sticker Branding',
  'Interface & Microsite Branding',
  'Data Capture & Analytics',
  'Disclaimer & Survey',
];

export const BOOKING_TERMS_TEXT = `By submitting this booking form, you confirm that the details supplied are correct and may be used by SelfieBox to plan, coordinate, and deliver the event. Final bookings remain subject to availability, travel requirements, setup constraints, and SelfieBox standard terms and conditions.`;

export function createEmptyBookingForm() {
  return {
    product: '',
    customerType: '',
    companyName: '',
    contactPerson: '',
    cell: '',
    email: '',
    eventDate: '',
    region: '',
    address: '',
    addressPlaceId: '',
    addressLat: null,
    addressLng: null,
    pointOfContactName: '',
    pointOfContactNumber: '',
    eventStartTime: '',
    eventFinishTime: '',
    durationHours: '',
    optionalExtras: [],
    designYourself: '',
    notes: '',
    acceptedTerms: false,
  };
}

