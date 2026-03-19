export const BOOKING_CUSTOMER_TYPE_OPTIONS = [
  'Corporate function',
  'Private Function',
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

export const BOOKING_TERMS_TEXT = `By submitting this booking form, you confirm that the details supplied are correct and may be used by SelfieBox to plan, coordinate, and deliver the event. Final bookings remain subject to availability, travel requirements, setup constraints, and SelfieBox standard terms and conditions.`;

export const BOOKING_TERMS_TITLE = 'SelfieBox - Terms & Conditions';

export const BOOKING_TERMS_CONTENT = [
  {
    title: '1. Provisional Booking',
    body: [
      'All bookings made with SelfieBox are considered provisional until confirmed in writing.',
      'A SelfieBox representative will contact the client to confirm availability and provide a final quotation based on the submitted details.',
      'A booking is only secured once 50% of the total fee has been received.',
    ],
  },
  {
    title: '2. Payment Terms',
    body: [
      'A 50% deposit is required to confirm the booking.',
      'The remaining balance must be paid no later than 48 hours before the event, unless otherwise agreed in writing.',
      'Failure to complete payment may result in cancellation of the booking without refund of the deposit.',
    ],
  },
  {
    title: '3. Cancellation Policy',
    body: [
      'If the client cancels the booking more than 7 days before the event, the deposit will be forfeited.',
      'If cancellation occurs within 7 days of the event, the full booking fee may be charged.',
      'All cancellations may be subject to a R350 administration fee.',
    ],
  },
  {
    title: '4. Changes to Booking Details',
    body: [
      'Any changes to booking details (event time, location, duration, etc.) must be communicated as soon as possible.',
      'SelfieBox will make reasonable efforts to accommodate changes but cannot guarantee availability.',
      'Additional costs may apply depending on the nature of the changes.',
    ],
  },
  {
    title: '5. Service Provision',
    body: [
      'A SelfieBox attendant will be present for the duration of the hire period.',
      'The attendant may either actively engage with guests or remain in the background, depending on the client’s preference.',
      'The client must communicate their preference before or at the event.',
    ],
  },
  {
    title: '6. Client Responsibilities',
    body: [
      'Provide accurate and complete information at the time of booking.',
      'Ensure a safe, covered, and suitable space for the photo booth setup.',
      'Provide access to a reliable power source within reasonable distance.',
      'Ensure the venue allows sufficient setup and breakdown time.',
      'SelfieBox shall not be held liable for issues arising from incorrect or incomplete information provided by the client.',
    ],
  },
  {
    title: '7. Equipment & Damage',
    body: [
      'All equipment remains the property of SelfieBox at all times.',
      'The client is responsible for any loss, theft, or damage caused by guests or venue staff during the hire period.',
      'Repair or replacement costs will be charged accordingly.',
    ],
  },
  {
    title: '8. Setup & Breakdown',
    body: [
      'Setup typically requires 30–60 minutes prior to the event start time.',
      'Breakdown will occur immediately after the agreed hire period.',
      'Early access to the venue must be arranged by the client.',
    ],
  },
  {
    title: '9. Technical Issues',
    body: [
      'While SelfieBox takes all reasonable steps to ensure smooth operation, technical failures may occasionally occur.',
      'In the event of equipment malfunction:',
      'SelfieBox will attempt to resolve the issue promptly.',
      'If unresolved, a partial refund or compensation may be offered at the company’s discretion.',
    ],
  },
  {
    title: '10. Liability',
    body: [
      'SelfieBox is not liable for:',
      'Any indirect or consequential loss',
      'Venue-related issues (e.g., power failure, access restrictions)',
      'Delays caused by factors outside of its control',
      'The client agrees to indemnify SelfieBox against any claims arising from misuse of the equipment.',
    ],
  },
  {
    title: '11. Media & Usage Rights',
    body: [
      'By using SelfieBox services, the client grants permission for photos to be used for marketing and promotional purposes, unless otherwise requested in writing.',
      'All digital images remain the property of SelfieBox but are shared with the client for personal use.',
    ],
  },
  {
    title: '12. Force Majeure',
    body: [
      'SelfieBox shall not be held responsible for failure to perform due to circumstances beyond its control, including but not limited to:',
      'Natural disasters',
      'Government restrictions',
      'Power outages',
      'Civil unrest',
      'In such cases, alternative arrangements or refunds will be considered.',
    ],
  },
  {
    title: '13. Acceptance of Terms',
    body: [
      'By paying the deposit and proceeding with the booking, the client confirms that they have read, understood, and agreed to these Terms & Conditions.',
    ],
  },
];

export const SPIN_PRODUCT_NAMES = [
  '360 blk inflatabooth',
  '360 curve',
  '360 orbit',
  'aerial spin',
  'iled 360',
];

export const BOOTH_PRODUCT_NAMES = [
  'halobox ai',
  'halobox black',
  'halobox digital',
  'halobox white',
  'hb digital',
  'hb black',
  'hb white',
  'mirror booth',
  'nano',
  'nano d',
  'retro pod',
  'selfiebox',
  'side kick',
  'tuxedo',
  'vintage',
  'cruise',
  'mosaic',
  'mosaic digital',
];

export const BOOKING_SPIN_EXTRAS = [
  'LED Lighting - Dimmable - R500',
  'Stanchions & Rope - R400',
  'Vinyl Sticker branding - R900',
  'Data Capture - R200',
  'Disclaimer & Survey - R500',
];

export const BOOKING_BOOTH_EXTRAS = [
  'Green/Blue Screen - R300',
  'Inflatable LED enclosure - R1200',
  'Vinyl Sticker branding - R900',
  'Data Capture - R200',
  'Disclaimer & Survey - R500',
  'Interface & Microsite branding - R900',
  "Animated GIF's - R900",
  'Contest Mode - R200',
];

export function normalizeBookingProductName(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\uFFFD/g, '')
    .replace(/°/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function getOptionalExtrasForProducts(products) {
  const normalized = Array.isArray(products) ? products.map(normalizeBookingProductName) : [];
  const hasSpinProduct = normalized.some((product) => SPIN_PRODUCT_NAMES.includes(product));
  const hasBoothProduct = normalized.some((product) => BOOTH_PRODUCT_NAMES.includes(product));
  const values = [];
  if (hasSpinProduct) {
    values.push(...BOOKING_SPIN_EXTRAS);
  }
  if (hasBoothProduct) {
    values.push(...BOOKING_BOOTH_EXTRAS);
  }
  return Array.from(new Set(values));
}

export function createEmptyBookingForm() {
  return {
    product: '',
    customerType: '',
    eventName: '',
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
    setupTime: '',
    eventStartTime: '',
    eventFinishTime: '',
    durationHours: '',
    optionalExtras: [],
    designYourself: '',
    notes: '',
    acceptedTerms: false,
    companyName: '',
  };
}
