import React, { useEffect, useRef, useState } from 'react';
import { useAction, useMutation, useQuery } from 'convex/react';
import { Button, Alert, Select, Empty, Spin } from 'antd';
import { ReloadOutlined, LinkOutlined, DisconnectOutlined } from '@ant-design/icons';
import { api } from './convex/_generated/api';
import './GoogleReviewsView.css';

const stars = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
const googleLink = value => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && (url.hostname === 'google.com' || url.hostname.endsWith('.google.com') ||
      url.hostname === 'g.page' || url.hostname === 'maps.app.goo.gl') ? url.href : undefined;
  } catch { return undefined; }
};

export default function GoogleReviewsView({ isAdmin }) {
  const status = useQuery(api.googleReviews.status, isAdmin ? {} : 'skip');
  const connect = useAction(api.googleReviewsActions.connect);
  const loadProfiles = useAction(api.googleReviewsActions.profiles);
  const loadReviews = useAction(api.googleReviewsActions.reviews);
  const disconnect = useMutation(api.googleReviews.disconnect);
  const [profiles, setProfiles] = useState([]);
  const [location, setLocation] = useState('');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  useEffect(() => () => { generation.current += 1; }, []);
  useEffect(() => {
    if (!status?.connected) {
      generation.current += 1;
      setProfiles([]); setLocation(''); setResult(null); setBusy(false);
    }
  }, [status?.connected]);

  async function run(operation) {
    setError(''); setBusy(true);
    try { await operation(); } catch (e) { setError(e.message || 'Google Reviews could not load.'); }
    finally { setBusy(false); }
  }
  async function choose(value, more = false) {
    const request = ++generation.current;
    setLocation(value);
    if (!more) setResult(null);
    setBusy(true); setError('');
    try {
      const page = await loadReviews({ location: value, ...(more && result?.nextPageToken ? { pageToken: result.nextPageToken } : {}) });
      if (request !== generation.current) return;
      setResult(previous => ({ ...page, reviews: more ?
        [...new Map([...(previous?.reviews || []), ...page.reviews].map(review => [review.reviewId || review.name, review])).values()] : page.reviews }));
    } catch (e) { if (request === generation.current) setError(e.message || 'Reviews could not load.'); }
    finally { if (request === generation.current) setBusy(false); }
  }
  const selected = profiles.find(profile => profile.resource === location);
  if (!isAdmin) return <Alert type="info" message="Google Reviews is available to administrators." />;
  if (!status) return <Spin />;
  return <section className="google-reviews">
    <div className="google-reviews-heading"><h2>Google Reviews</h2>
      <div className="google-reviews-actions">
        <Button icon={<LinkOutlined />} disabled={!status.configured || busy} onClick={() => run(async () => {
          const url = await connect(); window.location.assign(url);
        })}>{status.connected ? 'Reconnect Google' : 'Connect Google'}</Button>
        {status.connected && <Button icon={<DisconnectOutlined />} disabled={busy} onClick={() => run(async () => {
          generation.current += 1; await disconnect(); setProfiles([]); setLocation(''); setResult(null);
        })}>Disconnect</Button>}
      </div>
    </div>
    {!status.configured && <Alert type="warning" showIcon message="Google Reviews setup pending" description="The Google OAuth callback must be configured before connecting." />}
    {error && <Alert type="error" showIcon message={error} />}
    {status.connected && <div className="google-reviews-toolbar">
      <Button icon={<ReloadOutlined />} loading={busy && !location} disabled={busy} onClick={() => run(async () => {
        const data = await loadProfiles(); setProfiles(data.profiles); setError(data.errors.join(' '));
      })}>Load profiles</Button>
      <Select aria-label="Google Business Profile" placeholder="Select branch" value={location || undefined} disabled={busy}
        onChange={value => choose(value)} options={profiles.map(profile => ({ value: profile.resource,
          label: `${profile.title} ${profile.address?.locality ? `- ${profile.address.locality}` : ''}` }))} />
      {location && <Button icon={<ReloadOutlined />} title="Refresh reviews" aria-label="Refresh reviews" disabled={busy} onClick={() => choose(location)} />}
    </div>}
    {selected && <div className="google-reviews-summary">
      <h3>{selected.title}</h3>
      <p>{[...(selected.address?.addressLines || []), selected.address?.locality].filter(Boolean).join(', ')}</p>
      {result && <p><strong>{result.averageRating === null ? 'No rating' : `${result.averageRating.toFixed(1)} / 5`}</strong> &middot; {result.totalReviewCount} Google reviews</p>}
      <div className="google-reviews-actions">
        {googleLink(selected.mapsUrl) && <a href={googleLink(selected.mapsUrl)} target="_blank" rel="noreferrer">View on Google Maps</a>}
        {googleLink(selected.reviewUrl) && <a href={googleLink(selected.reviewUrl)} target="_blank" rel="noreferrer">Write a review on Google</a>}
      </div>
      {result && <small>Retrieved {new Date(result.fetchedAt).toLocaleString('en-ZA')}</small>}
    </div>}
    {busy && <Spin />}
    {!busy && !result && <Empty description={status.connected ? 'Select a profile to view reviews' : 'Google Reviews is not connected'} />}
    {result && result.reviews.length === 0 && <Empty description="No reviews for this profile" />}
    <div className="google-reviews-list">{result?.reviews.map(review => <article key={review.reviewId || review.name}>
      <div className="google-reviews-review-heading"><strong>{review.reviewer?.displayName || 'Google reviewer'}</strong>
        <span>{stars[review.starRating] || 'Unrated'} / 5</span></div>
      <time dateTime={review.createTime}>{review.createTime ? new Date(review.createTime).toLocaleDateString('en-ZA') : ''}</time>
      {review.comment && <p>{review.comment}</p>}
      <small>via Google</small>
      {review.reviewReply?.comment && <blockquote><strong>SelfieBox reply</strong><p>{review.reviewReply.comment}</p></blockquote>}
    </article>)}</div>
    {result && <div className="google-reviews-toolbar"><span>{result.reviews.length} of {result.totalReviewCount} reviews loaded</span>
      {result.nextPageToken && <Button disabled={busy} onClick={() => choose(location, true)}>Load more reviews</Button>}
    </div>}
  </section>;
}
