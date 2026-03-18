const GOOGLE_MAPS_SCRIPT_ID = 'selfiebox-google-maps-api';
const GOOGLE_MAPS_VERSION = 'weekly';

let googleMapsPromise = null;
let googlePlacesPromise = null;

export function getGoogleMapsApiKey() {
  return process.env.REACT_APP_GOOGLE_MAPS_API_KEY || '';
}

export function hasGoogleMapsApiKey() {
  return Boolean(getGoogleMapsApiKey());
}

export function loadGoogleMapsApi() {
  if (typeof window === 'undefined') {
    return Promise.resolve(null);
  }

  if (!hasGoogleMapsApiKey()) {
    return Promise.resolve(null);
  }

  if (window.google?.maps) {
    return Promise.resolve(window.google);
  }

  if (googleMapsPromise) {
    return googleMapsPromise;
  }

  googleMapsPromise = new Promise((resolve, reject) => {
    const existingScript = document.getElementById(GOOGLE_MAPS_SCRIPT_ID);
    if (existingScript) {
      existingScript.addEventListener('load', () => resolve(window.google), { once: true });
      existingScript.addEventListener('error', () => reject(new Error('Google Maps failed to load.')), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.id = GOOGLE_MAPS_SCRIPT_ID;
    script.async = true;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(getGoogleMapsApiKey())}&libraries=places&loading=async&v=${GOOGLE_MAPS_VERSION}`;
    script.onload = () => resolve(window.google);
    script.onerror = () => reject(new Error('Google Maps failed to load.'));
    document.head.appendChild(script);
  }).catch((error) => {
    googleMapsPromise = null;
    throw error;
  });

  return googleMapsPromise;
}

export async function loadGooglePlacesLibrary() {
  const google = await loadGoogleMapsApi();
  if (!google?.maps?.importLibrary) {
    return null;
  }

  if (googlePlacesPromise) {
    return googlePlacesPromise;
  }

  googlePlacesPromise = google.maps.importLibrary('places').catch((error) => {
    googlePlacesPromise = null;
    throw error;
  });

  return googlePlacesPromise;
}

export function extractPlaceResult(place, fallbackValue = '', explicitPlaceId = '') {
  const resolvedAddress = place?.formattedAddress || place?.formatted_address || place?.displayName || place?.name || fallbackValue || '';
  const location = place?.location || place?.geometry?.location;
  const latitude = typeof location?.lat === 'function' ? location.lat() : typeof location?.lat === 'number' ? location.lat : null;
  const longitude = typeof location?.lng === 'function' ? location.lng() : typeof location?.lng === 'number' ? location.lng : null;
  return {
    location: resolvedAddress,
    locationPlaceId: explicitPlaceId || place?.id || place?.placeId || place?.place_id || '',
    locationLat: latitude,
    locationLng: longitude,
  };
}
