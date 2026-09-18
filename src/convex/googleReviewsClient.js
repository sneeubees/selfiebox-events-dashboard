export function locationResource(value) {
  if (!/^accounts\/[0-9]+\/locations\/[0-9]+$/.test(value)) throw new Error("Invalid Google location");
  return value;
}

export async function googleGet(url, accessToken, fetcher = fetch) {
  const response = await fetcher(url, {
    headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) {
    if (response.status === 403) throw new Error("Google denied access. Check Business Profile API approval, enabled APIs and profile permissions.");
    if (response.status === 401) throw new Error("Google connection expired. Reconnect Google Reviews.");
    if (response.status === 429) throw new Error("Google request limit reached. Please try again later.");
    throw new Error(`Google Reviews request failed (${response.status}).`);
  }
  return response.json();
}

export async function allPages(base, key, token, fetcher = fetch) {
  const rows = [];
  const seen = new Set();
  let pageToken = "";
  do {
    const url = new URL(base);
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const data = await googleGet(url.toString(), token, fetcher);
    rows.push(...(data[key] || []));
    pageToken = data.nextPageToken || "";
    if (pageToken && seen.has(pageToken)) throw new Error("Google returned a repeated page token. Retry loading profiles.");
    seen.add(pageToken);
    if (seen.size > 100) throw new Error("Too many Google account pages. Use an account limited to SelfieBox profiles.");
  } while (pageToken);
  return rows;
}
