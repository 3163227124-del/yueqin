const EARTH_RADIUS_METERS = 6371008.8;

function toRadians(value) {
  return (Number(value) * Math.PI) / 180;
}

function haversineMeters(a, b) {
  const lng1 = Number(a.lng);
  const lat1 = Number(a.lat);
  const lng2 = Number(b.lng);
  const lat2 = Number(b.lat);
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const s1 = Math.sin(dLat / 2);
  const s2 = Math.sin(dLng / 2);
  const h = s1 * s1 + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * s2 * s2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

function directCandidateScore(originA, originB, shop) {
  const distanceA = haversineMeters(originA, shop.location);
  const distanceB = haversineMeters(originB, shop.location);
  const max = Math.max(distanceA, distanceB);
  const avg = (distanceA + distanceB) / 2;
  const diff = Math.abs(distanceA - distanceB);

  return {
    distanceA,
    distanceB,
    directScore: max * 0.55 + avg * 0.25 + diff * 0.2,
  };
}

function scoreCommute(minutesA, minutesB, maxMinutes = 75, availabilityPenalty = 0) {
  if (!Number.isFinite(minutesA) || !Number.isFinite(minutesB)) {
    return 0;
  }

  const max = Math.max(minutesA, minutesB);
  const avg = (minutesA + minutesB) / 2;
  const diff = Math.abs(minutesA - minutesB);
  const overtime = Math.max(0, max - maxMinutes);
  const raw = 120 - max * 0.5 - avg * 0.2 - diff * 0.45 - overtime * 1.1 - availabilityPenalty;

  return Math.max(0, Math.min(100, Math.round(raw)));
}

module.exports = {
  directCandidateScore,
  haversineMeters,
  scoreCommute,
};
