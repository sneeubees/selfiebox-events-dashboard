// What a board row save sends to events.upsert.

export function serializeEventForConvex(event) {
  const workspaceYear = event.date ? new Date(event.date).getFullYear() : event.workspaceYear || 2026;
  return {
    id: event.id,
    workspaceYear,
    name: event.name || '',
    eventTitle: event.eventTitle || '',
    date: event.date || '',
    draftMonth: event.draftMonth || '',
    hours: event.hours || '',
    time: event.time || '',
    branch: event.branch || [],
    products: event.products || [],
    // Missing until 2026-09-21: the server defaulted it to {} on every save, so
    // product quantities (x2, x3...) never survived a save.
    productQuantities: event.productQuantities || {},
    status: event.status || '',
    digitalOnly: Boolean(event.digitalOnly),
    location: event.location || '',
    locationPlaceId: event.locationPlaceId || '',
    locationLat: typeof event.locationLat === 'number' ? event.locationLat : null,
    locationLng: typeof event.locationLng === 'number' ? event.locationLng : null,
    paymentStatus: event.paymentStatus || '',
    accounts: event.accounts || '',
    quoteNumber: event.quoteNumber || '',
    invoiceNumber: event.invoiceNumber || '',
    exVatAuto: event.exVatAuto ?? '',
    vinyl: event.vinyl || '',
    gsAi: event.gsAi || '',
    imagesSent: event.imagesSent || '',
    snappic: event.snappic || '',
    attendants: event.attendants || [],
    exVat: event.exVat ?? '',
    packageOnly: event.packageOnly || '',
    notes: event.notes || '',
    customFields: event.customFields || {},
    updates: event.updates || [],
    files: event.files || [],
    activity: event.activity || [],
  };
}

// The fields that differ between two versions of a row, as events.upsert's
// changedFields: top-level keys, and "customFields.<key>" per custom column.
// The save then writes only these, so a colleague's newer value in any other
// field is not overwritten by this browser's older copy of the row.
export function changedEventFieldsForSave(previousEvent, nextEvent) {
  const before = serializeEventForConvex(previousEvent);
  const after = serializeEventForConvex(nextEvent);
  const changed = [];
  Object.keys(after).forEach((key) => {
    if (key === 'id' || key === 'customFields') return;
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) changed.push(key);
  });
  const customKeys = new Set([...Object.keys(before.customFields || {}), ...Object.keys(after.customFields || {})]);
  customKeys.forEach((key) => {
    if (JSON.stringify((before.customFields || {})[key]) !== JSON.stringify((after.customFields || {})[key])) {
      changed.push(`customFields.${key}`);
    }
  });
  return changed;
}
