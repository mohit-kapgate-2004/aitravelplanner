import express from "express";
import fetch from "node-fetch";
import Trip from "../models/trip.js";
import User from "../models/user.js";

const router = express.Router();

const MIN_BUDGET_PER_PERSON_PER_DAY = Number(
  process.env.MIN_BUDGET_PER_PERSON_PER_DAY || 1200
);

function estimateMinimumBudget(days, travelers) {
  const safeDays = Math.max(1, Number(days) || 1);
  const safeTravelers = Math.max(1, Number(travelers) || 1);
  return Math.round(MIN_BUDGET_PER_PERSON_PER_DAY * safeDays * safeTravelers);
}

function buildLowBudgetReply({ budget, minBudget, days, travelers }) {
  return `Your budget (${budget} INR) looks too low for a ${days}-day trip for ${travelers} traveler(s). A practical minimum is around ${minBudget} INR. Please increase the budget so I can plan stays, meals, and transport comfortably.`;
}

function extractFirstJsonObject(text) {
  if (!text) return null;
  let depth = 0;
  let start = -1;

  for (let i = 0; i < text.length; i++) {
    if (text[i] === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (text[i] === "}") {
      depth--;
      if (depth === 0 && start !== -1) {
        return text.slice(start, i + 1);
      }
    }
  }
  return null;
}

function getCityBackground(city) {
  if (!city) {
    return "https://via.placeholder.com/800x600?text=Trip";
  }
  const trimmed = city.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  return `https://source.unsplash.com/featured/?${encodeURIComponent(
    `${trimmed} travel`
  )}`;
}

function safeJsonParse(jsonString) {
  if (!jsonString) return null;
  try {
    return JSON.parse(jsonString);
  } catch (err) {
    try {
      const safeJson = jsonString
        .replace(/(\w+):/g, '"$1":')
        .replace(/'/g, '"')
        .replace(/,\s*}/g, "}")
        .replace(/,\s*]/g, "]");
      return JSON.parse(safeJson);
    } catch (err2) {
      return null;
    }
  }
}

function normalizeNameKey(value = "") {
  return String(value).trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizePlaces(places = []) {
  const seen = new Set();
  return places
    .filter((place) => place && typeof place.name === "string")
    .map((place) => ({
      name: place.name.trim(),
      briefDescription: place.briefDescription
    }))
    .filter((place) => {
      if (!place.name) return false;
      const key = normalizeNameKey(place.name);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function detectTripIntent(message = "") {
  const text = String(message).toLowerCase();
  return {
    lowBudget:
      /low budget|cheap|affordable|budget trip|economy|save money/.test(text),
    honeymoon:
      /honeymoon|romantic|couple|anniversary/.test(text),
    adventure:
      /adventure|trek|trekking|hiking|rafting|camping|bike|mountain/.test(text),
    family:
      /family|kids|children|senior|parents/.test(text),
    shortTrip:
      /short trip|weekend|2 day|3 day|nearby|close by|quick trip/.test(text),
  };
}

function shouldAttachSuggestions(message = "") {
  const text = String(message).toLowerCase();
  return /suggest|recommend|recommendation|options|ideas|advice|help me choose|what should|where should|best place|nearby destination|can you suggest/.test(
    text
  );
}

function detectTravelMode(message = "") {
  const text = String(message).toLowerCase();
  if (/walk|walking|on foot/.test(text)) return "walking";
  if (/bike|biking|cycle|cycling/.test(text)) return "cycling";
  if (/train|rail|metro|subway|bus|public transport|transit/.test(text)) return "transit";
  if (/drive|driving|car|cab|taxi/.test(text)) return "driving";
  return null;
}

function detectStartFromCurrentLocation(message = "") {
  const text = String(message).toLowerCase();
  if (
    /don't use my location|do not use my location|without my location|start from first place|start from first stop/.test(
      text
    )
  ) {
    return false;
  }
  if (
    /start from (my|current) location|from my location|from here|use my location/.test(
      text
    )
  ) {
    return true;
  }
  return null;
}

function detectNearbyPreference(message = "") {
  const text = String(message).toLowerCase();
  return /near me|nearby|around me|around here|from my location|current location|from here|close to me/.test(
    text
  );
}

function parseBudget(message = "") {
  const text = String(message).toLowerCase().replace(/[,]/g, "");
  const kMatch =
    text.match(/under\s*(\d+(?:\.\d+)?)\s*k/) ||
    text.match(/budget\s*(\d+(?:\.\d+)?)\s*k/) ||
    text.match(/(\d+(?:\.\d+)?)\s*k\s*budget/);
  if (kMatch) {
    return Math.round(Number(kMatch[1]) * 1000);
  }

  const lakhMatch =
    text.match(/under\s*(\d+(?:\.\d+)?)\s*lakh/) ||
    text.match(/budget\s*(\d+(?:\.\d+)?)\s*lakh/) ||
    text.match(/(\d+(?:\.\d+)?)\s*lakh\s*budget/);
  if (lakhMatch) {
    return Math.round(Number(lakhMatch[1]) * 100000);
  }

  const match =
    text.match(/under\s*(\d{3,})/) ||
    text.match(/budget\s*(\d{3,})/) ||
    text.match(/(\d{3,})\s*budget/);
  if (!match) return null;
  return Number(match[1]);
}

function parseDays(message = "") {
  const text = String(message).toLowerCase();
  const match = text.match(/(\d+)\s*(day|days|night|nights)/);
  if (!match) return null;
  return Number(match[1]);
}

function parseTravelersCount(message = "") {
  const text = String(message).toLowerCase();
  const match = text.match(
    /(\d+)\s*(friend|friends|people|persons|adults|travellers|travelers|members)/
  );
  if (match) {
    const value = Number(match[1]);
    if (Number.isFinite(value) && value > 0) return Math.min(20, value);
  }
  if (/honeymoon|couple/.test(text)) return 2;
  if (/solo|alone/.test(text)) return 1;
  return null;
}

function parseUserLocation(rawLocation) {
  if (!rawLocation || typeof rawLocation !== "object") return null;
  const lat = Number(
    rawLocation.lat ?? rawLocation.latitude ?? rawLocation.coords?.latitude
  );
  const lng = Number(
    rawLocation.lng ?? rawLocation.lon ?? rawLocation.longitude ?? rawLocation.coords?.longitude
  );
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

function toRadians(value) {
  return (value * Math.PI) / 180;
}

function haversineKm(a, b) {
  const R = 6371;
  const dLat = toRadians(b.lat - a.lat);
  const dLon = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLon / 2) *
      Math.sin(dLon / 2) *
      Math.cos(lat1) *
      Math.cos(lat2);
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return R * c;
}

function estimateTravelMinutes(fromLoc, toLoc, speedKmh = 30) {
  if (!fromLoc || !toLoc) return 0;
  const dist = haversineKm(
    { lat: Number(fromLoc.lat), lng: Number(fromLoc.lng) },
    { lat: Number(toLoc.lat), lng: Number(toLoc.lng) }
  );
  if (!Number.isFinite(dist)) return 0;
  return Math.max(10, Math.round((dist / speedKmh) * 60));
}

function estimateVisitDurationMinutes(name = "", description = "") {
  const text = `${name} ${description}`.toLowerCase();

  if (/trek|hike|safari|trail|adventure|rafting|camp/.test(text)) return 180;
  if (/cave|falls|waterfall|water park|theme park/.test(text)) return 120;
  if (/museum|fort|palace|temple|church|monastery|heritage/.test(text)) return 90;
  if (/lake|beach|garden|market|point|sunset|viewpoint|tower|bridge/.test(text))
    return 75;
  return 90;
}

function getPlaceImage(name = "", city = "") {
  const query = `${name} ${city} travel`.trim();
  return `https://source.unsplash.com/featured/?${encodeURIComponent(query)}`;
}

const AI_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS || 12000);
const NOMINATIM_TIMEOUT_MS = Number(process.env.NOMINATIM_TIMEOUT_MS || 9000);
const NOMINATIM_CACHE_TTL_MS = Number(
  process.env.NOMINATIM_CACHE_TTL_MS || 6 * 60 * 60 * 1000
);
const GEO_CACHE_TTL_MS = Number(process.env.GEO_CACHE_TTL_MS || 6 * 60 * 60 * 1000);
const DESTINATION_CACHE_TTL_MS = Number(
  process.env.DESTINATION_CACHE_TTL_MS || 6 * 60 * 60 * 1000
);
const REVERSE_CACHE_TTL_MS = Number(
  process.env.REVERSE_CACHE_TTL_MS || 6 * 60 * 60 * 1000
);
const EXTRA_PLACES_CACHE_TTL_MS = Number(
  process.env.EXTRA_PLACES_CACHE_TTL_MS || 3 * 60 * 60 * 1000
);
const GEOCODE_CONCURRENCY = Number(process.env.GEOCODE_CONCURRENCY || 5);

const nominatimSearchCache = new Map();
const geocodePlaceCache = new Map();
const destinationContextCache = new Map();
const reverseGeocodeCache = new Map();
const extraPlacesCache = new Map();

const cacheGet = (cache, key) => {
  const entry = cache.get(key);
  if (!entry) return { hit: false };
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return { hit: false };
  }
  return { hit: true, value: entry.value };
};

const cacheSet = (cache, key, value, ttlMs) => {
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
};

const fetchWithTimeout = async (url, options = {}, timeoutMs = AI_TIMEOUT_MS) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
};

const mapWithConcurrency = async (items, limit, mapper) => {
  if (!items.length) return [];
  const results = new Array(items.length);
  let index = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    () =>
      (async () => {
        while (true) {
          const current = index++;
          if (current >= items.length) break;
          try {
            results[current] = await mapper(items[current], current);
          } catch (err) {
            results[current] = null;
          }
        }
      })()
  );
  await Promise.all(workers);
  return results;
};

async function searchNominatim(query, options = {}) {
  const params = new URLSearchParams({
    format: "json",
    q: query,
    addressdetails: "1",
    limit: String(options.limit || 6),
  });

  if (options.countryCode) {
    params.append("countrycodes", String(options.countryCode).toLowerCase());
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), NOMINATIM_TIMEOUT_MS);

  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?${params.toString()}`,
      {
        signal: controller.signal,
        headers: {
          "User-Agent":
            process.env.NOMINATIM_USER_AGENT ||
            "ai-travel-planner/1.0",
          Accept: "application/json",
        },
      }
    );

    if (!response.ok) {
      return [];
    }

    const contentType = String(response.headers.get("content-type") || "");
    if (!contentType.includes("application/json")) {
      return [];
    }

    const data = await response.json();
    return Array.isArray(data) ? data : [];
  } catch (err) {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

async function cachedSearchNominatim(query, options = {}) {
  const key = `${String(query).toLowerCase()}|${options.countryCode || ""}|${
    options.limit || 6
  }`;
  const cached = cacheGet(nominatimSearchCache, key);
  if (cached.hit) return cached.value || [];
  const results = await searchNominatim(query, options);
  cacheSet(nominatimSearchCache, key, results, NOMINATIM_CACHE_TTL_MS);
  return results;
}

async function reverseGeocodeLocation(lat, lng) {
  const params = new URLSearchParams({
    format: "jsonv2",
    lat: String(lat),
    lon: String(lng),
    addressdetails: "1",
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), NOMINATIM_TIMEOUT_MS);

  try {
    const response = await fetchWithTimeout(
      `https://nominatim.openstreetmap.org/reverse?${params.toString()}`,
      {
        headers: {
          "User-Agent":
            process.env.NOMINATIM_USER_AGENT || "ai-travel-planner/1.0",
          Accept: "application/json",
        },
      },
      NOMINATIM_TIMEOUT_MS
    );

    if (!response.ok) return null;
    const contentType = String(response.headers.get("content-type") || "");
    if (!contentType.includes("application/json")) return null;
    return await response.json();
  } catch (err) {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function getLocationContextFromCoordinates(userLocation = null) {
  if (!userLocation) return null;
  const lat = Number(userLocation.lat);
  const lng = Number(userLocation.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const key = `${lat.toFixed(3)},${lng.toFixed(3)}`;
  const cached = cacheGet(reverseGeocodeCache, key);
  if (cached.hit) return cached.value;

  const reverse = await reverseGeocodeLocation(lat, lng);
  const address = reverse?.address || {};
  const locality =
    address.city ||
    address.town ||
    address.village ||
    address.suburb ||
    address.county ||
    address.state_district ||
    address.state ||
    "";
  const countryName = String(address.country || "").trim();
  const countryCode = String(address.country_code || "").toLowerCase();
  const cityHint = locality
    ? countryName
      ? `${locality}, ${countryName}`
      : locality
    : String(reverse?.display_name || "")
        .split(",")
        .slice(0, 2)
        .join(",")
        .trim();

  const context = {
    cityHint,
    center: { lat, lng },
    countryCode,
    countryName,
    maxRadiusKm: 180,
  };
  cacheSet(reverseGeocodeCache, key, context, REVERSE_CACHE_TTL_MS);
  return context;
}

async function getDestinationContext(cityHint = "") {
  if (!cityHint) return null;

  const cacheKey = String(cityHint).toLowerCase();
  const cached = cacheGet(destinationContextCache, cacheKey);
  if (cached.hit) return cached.value;

  const results = await cachedSearchNominatim(cityHint, { limit: 1 });
  const best = results[0];
  if (!best) return null;

  const lat = Number(best.lat);
  const lng = Number(best.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  let maxRadiusKm = 120;
  const bb = Array.isArray(best.boundingbox)
    ? best.boundingbox.map((value) => Number(value))
    : [];

  if (bb.length === 4 && bb.every(Number.isFinite)) {
    const [south, north, west, east] = bb;
    const center = { lat, lng };
    const corners = [
      { lat: south, lng: west },
      { lat: south, lng: east },
      { lat: north, lng: west },
      { lat: north, lng: east },
    ];
    const farthest = Math.max(
      ...corners.map((corner) => haversineKm(center, corner))
    );
    maxRadiusKm = Math.min(320, Math.max(35, Math.round(farthest * 2.5)));
  }

  const context = {
    cityHint,
    center: { lat, lng },
    countryCode: String(best?.address?.country_code || "").toLowerCase(),
    countryName: String(best?.address?.country || ""),
    maxRadiusKm,
  };
  cacheSet(destinationContextCache, cacheKey, context, DESTINATION_CACHE_TTL_MS);
  return context;
}

function isCandidateWithinDestination(candidate, destinationContext) {
  if (!destinationContext?.center) return true;
  const lat = Number(candidate?.lat);
  const lng = Number(candidate?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  const distanceKm = haversineKm(destinationContext.center, { lat, lng });
  const allowedRadius = Math.max(25, Number(destinationContext.maxRadiusKm || 120) * 1.15);

  if (distanceKm > allowedRadius) {
    return false;
  }

  const candidateCountry = String(candidate?.address?.country_code || "").toLowerCase();
  if (
    destinationContext.countryCode &&
    candidateCountry &&
    candidateCountry !== destinationContext.countryCode
  ) {
    return false;
  }

  return true;
}

function scoreGeocodeCandidate(candidate, destinationContext, cityHint = "") {
  const lat = Number(candidate?.lat);
  const lng = Number(candidate?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return Number.POSITIVE_INFINITY;
  }

  let score = 0;
  const display = String(candidate?.display_name || "").toLowerCase();
  const cityToken = String(cityHint || "")
    .split(",")[0]
    .trim()
    .toLowerCase();

  if (destinationContext?.center) {
    const distanceKm = haversineKm(destinationContext.center, { lat, lng });
    score += distanceKm;
    if (distanceKm > destinationContext.maxRadiusKm) {
      score += 1000;
    }
  }

  if (cityToken && display.includes(cityToken)) {
    score -= 20;
  } else if (cityToken) {
    score += 30;
  }

  const candidateCountry = String(candidate?.address?.country_code || "").toLowerCase();
  if (destinationContext?.countryCode) {
    if (candidateCountry && candidateCountry !== destinationContext.countryCode) {
      score += 800;
    } else if (candidateCountry === destinationContext.countryCode) {
      score -= 10;
    }
  }

  return score;
}

function orderActivitiesByNearest(activities = []) {
  if (activities.length <= 2) return activities;
  const ordered = [activities[0]];
  const remaining = activities.slice(1);

  while (remaining.length) {
    const last = ordered[ordered.length - 1];
    const lastLoc = last?.geometry?.location;
    if (!lastLoc) {
      ordered.push(remaining.shift());
      continue;
    }

    let bestIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    remaining.forEach((candidate, idx) => {
      const loc = candidate?.geometry?.location;
      if (!loc) return;
      const d = haversineKm(
        { lat: Number(lastLoc.lat), lng: Number(lastLoc.lng) },
        { lat: Number(loc.lat), lng: Number(loc.lng) }
      );
      if (d < bestDistance) {
        bestDistance = d;
        bestIndex = idx;
      }
    });
    const [next] = remaining.splice(bestIndex, 1);
    ordered.push(next);
  }
  return ordered;
}

function scheduleActivitiesByTime(activities = [], days = 1, startDateValue) {
  const dayCount = Math.max(1, Number(days) || 1);
  const ordered = orderActivitiesByNearest(activities);
  const total = ordered.length;
  const dayLimitMinutes = 9 * 60;

  const minPerDay =
    total >= dayCount * 3 ? 3 : Math.max(1, Math.floor(total / dayCount));
  const maxPerDay = 5;

  const startDate = new Date(startDateValue);
  const itinerary = Array.from({ length: dayCount }, (_, i) => ({
    date: new Date(startDate.getTime() + i * 86400000)
      .toISOString()
      .slice(0, 10),
    activities: [],
    approxMinutes: 0,
  }));

  let dayIndex = 0;

  for (let i = 0; i < ordered.length; i++) {
    const activity = ordered[i];
    if (!activity) continue;

    const placeMinutes = Number(activity.estimatedDurationMinutes) || 90;
    const remainingPlaces = total - i;

    while (dayIndex < dayCount) {
      const day = itinerary[dayIndex];
      const remainingDays = dayCount - dayIndex;
      const maxAllowedToday = Math.min(
        maxPerDay,
        Math.max(1, remainingPlaces - (remainingDays - 1) * minPerDay)
      );
      const minRequiredToday = Math.max(
        1,
        remainingPlaces - (remainingDays - 1) * maxPerDay
      );

      const prevAct = day.activities[day.activities.length - 1];
      const travelMinutes = prevAct
        ? estimateTravelMinutes(
            prevAct.geometry?.location,
            activity.geometry?.location
          )
        : 0;
      const projected = day.approxMinutes + travelMinutes + placeMinutes;

      const canMoveNext =
        dayIndex < dayCount - 1 &&
        day.activities.length >= minRequiredToday &&
        (projected > dayLimitMinutes || day.activities.length >= maxAllowedToday);

      if (canMoveNext) {
        dayIndex += 1;
        continue;
      }

      day.activities.push({
        ...activity,
        date: day.date,
        travelFromPreviousMinutes: travelMinutes,
      });
      day.approxMinutes += travelMinutes + placeMinutes;
      break;
    }
  }

  return itinerary.map((day) => ({
    date: day.date,
    activities: day.activities,
  }));
}

async function geocodePlace(placeName, cityHint = "", destinationContext = null) {
  const cacheKey = `${String(placeName).toLowerCase()}|${String(
    cityHint || ""
  ).toLowerCase()}|${destinationContext?.countryCode || ""}`;
  const cached = cacheGet(geocodePlaceCache, cacheKey);
  if (cached.hit) return cached.value;

  const queries = cityHint
    ? [`${placeName}, ${cityHint}`, `${placeName} ${cityHint}`, placeName]
    : [placeName];

  let bestCandidate = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const query of queries) {
    const scopedResults = await cachedSearchNominatim(query, {
      limit: 8,
      countryCode: destinationContext?.countryCode,
    });
    const fallbackResults =
      scopedResults.length > 0
        ? scopedResults
        : await cachedSearchNominatim(query, { limit: 8 });

    for (const candidate of fallbackResults) {
      const score = scoreGeocodeCandidate(candidate, destinationContext, cityHint);
      if (!Number.isFinite(score)) continue;
      if (score < bestScore) {
        bestScore = score;
        bestCandidate = candidate;
      }
    }

    if (
      bestCandidate &&
      (!destinationContext ||
        isCandidateWithinDestination(bestCandidate, destinationContext))
    ) {
      break;
    }
  }

  if (!bestCandidate) {
    cacheSet(geocodePlaceCache, cacheKey, null, GEO_CACHE_TTL_MS);
    return null;
  }
  if (
    destinationContext &&
    !isCandidateWithinDestination(bestCandidate, destinationContext)
  ) {
    cacheSet(geocodePlaceCache, cacheKey, null, GEO_CACHE_TTL_MS);
    return null;
  }
  cacheSet(geocodePlaceCache, cacheKey, bestCandidate, GEO_CACHE_TTL_MS);
  return bestCandidate;
}

async function buildActivitiesFromPlaces(places = [], cityHint = "", destinationContext = null) {
  const seenNames = new Set();
  const uniquePlaces = (places || []).filter((place) => {
    const name = String(place?.name || "").trim();
    if (!name) return false;
    const key = normalizeNameKey(name);
    if (seenNames.has(key)) return false;
    seenNames.add(key);
    return true;
  });

  const tasks = await mapWithConcurrency(uniquePlaces, GEOCODE_CONCURRENCY, async (place) => {
    const name = String(place?.name || "").trim();
    const geo = await geocodePlace(name, cityHint, destinationContext);
    if (!geo) return null;
    if (
      destinationContext &&
      !isCandidateWithinDestination(geo, destinationContext)
    ) {
      return null;
    }

    const lat = Number(geo.lat);
    const lon = Number(geo.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

    return {
      name,
      briefDescription:
        place.briefDescription || `${name} in your destination.`,
      formatted_address: geo.display_name,
      estimatedDurationMinutes: estimateVisitDurationMinutes(
        name,
        place.briefDescription || ""
      ),
      photos: [
        getPlaceImage(name, cityHint || destinationContext?.cityHint || ""),
      ],
      geometry: {
        location: {
          lat,
          lng: lon,
        },
        viewport: {
          northeast: {
            lat: lat + 0.01,
            lng: lon + 0.01,
          },
          southwest: {
            lat: lat - 0.01,
            lng: lon - 0.01,
          },
        },
      },
    };
  });

  return tasks.filter(Boolean);
}

async function fetchNearbyAttractions(destinationContext, existingNames = [], needed = 0) {
  if (!destinationContext?.center || needed <= 0) return [];

  const lat = Number(destinationContext.center.lat);
  const lng = Number(destinationContext.center.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [];

  const radiusMeters = Math.min(
    25000,
    Math.max(5000, Math.round((destinationContext.maxRadiusKm || 120) * 1000 * 0.6))
  );

  const query = `
[out:json][timeout:25];
(
  node["tourism"~"attraction|museum|viewpoint|zoo|theme_park|gallery|artwork"](around:${radiusMeters},${lat},${lng});
  node["historic"](around:${radiusMeters},${lat},${lng});
  node["natural"~"peak|waterfall|beach|cave|bay"](around:${radiusMeters},${lat},${lng});
  way["tourism"~"attraction|museum|viewpoint|zoo|theme_park|gallery|artwork"](around:${radiusMeters},${lat},${lng});
  way["historic"](around:${radiusMeters},${lat},${lng});
  relation["tourism"~"attraction|museum|viewpoint|zoo|theme_park|gallery|artwork"](around:${radiusMeters},${lat},${lng});
);
out center 120;
`;

  try {
    const endpoints = [
      "https://overpass-api.de/api/interpreter",
      "https://overpass.kumi.systems/api/interpreter",
      "https://overpass.openstreetmap.ru/api/interpreter",
    ];
    let elements = [];

    for (const endpoint of endpoints) {
      const response = await fetchWithTimeout(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `data=${encodeURIComponent(query)}`,
      }, AI_TIMEOUT_MS);

      if (!response.ok) {
        if (response.status === 429) {
          continue;
        }
        continue;
      }

      const data = await response.json();
      elements = Array.isArray(data?.elements) ? data.elements : [];
      if (elements.length > 0) break;
    }

    if (elements.length === 0) return [];
    const seen = new Set((existingNames || []).map((name) => normalizeNameKey(name)));
    const places = [];

    for (const el of elements) {
      const name = String(el?.tags?.name || "").trim();
      if (!name) continue;
      const key = normalizeNameKey(name);
      if (seen.has(key)) continue;

      seen.add(key);
      const type =
        el?.tags?.tourism || el?.tags?.historic || el?.tags?.natural || "attraction";

      places.push({
        name,
        briefDescription: `Popular local ${type} near ${destinationContext.cityHint}.`,
      });

      if (places.length >= needed * 3) break;
    }

    return normalizePlaces(places).slice(0, needed * 2);
  } catch (err) {
    console.error("Failed to fetch nearby attractions:", err);
    return [];
  }
}

function getTripDestinationHint(trip = {}) {
  const fromName = String(trip?.tripName || "")
    .replace(/^AI Trip to\s+/i, "")
    .replace(/^Trip to\s+/i, "")
    .trim();
  if (fromName) return fromName;

  const firstAddress =
    trip?.itinerary?.[0]?.activities?.[0]?.formatted_address ||
    trip?.placesToVisit?.[0]?.formatted_address ||
    "";
  if (!firstAddress) return "";

  const parts = String(firstAddress)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length >= 3) {
    return `${parts[parts.length - 3]}, ${parts[parts.length - 1]}`;
  }
  return parts[parts.length - 1] || "";
}

function buildSmartSuggestions(intent, city = "") {
  const lines = [];
  const cityLabel = city ? ` in ${city}` : "";

  if (intent.lowBudget) {
    lines.push(
      `Budget tip: Prefer hostels/guesthouses, public transport, and free attractions${cityLabel}.`
    );
    lines.push(
      "Budget-friendly destination ideas: Jaipur, Rishikesh, Hampi, Varanasi."
    );
  }
  if (intent.honeymoon) {
    lines.push(
      `Romantic tip: Include sunset points, private dinner spots, and scenic stays${cityLabel}.`
    );
    lines.push(
      "Romantic destination ideas: Udaipur, Munnar, Manali, Andaman."
    );
  }
  if (intent.adventure) {
    lines.push(
      `Adventure tip: Add trekking, rafting, zipline, or off-road activities${cityLabel} with buffer time for weather.`
    );
    lines.push(
      "Adventure destination ideas: Leh-Ladakh, Rishikesh, Spiti, Bir Billing."
    );
  }
  if (intent.family) {
    lines.push(
      `Family tip: Prioritize safe areas, shorter transfers, kid-friendly activities, and nearby medical access${cityLabel}.`
    );
    lines.push(
      "Family-friendly destination ideas: Ooty, Mysore, Nainital, Udaipur."
    );
  }
  if (intent.shortTrip) {
    lines.push(
      "Short-trip tip: Keep travel time low, cluster places by area, and limit daily stops to avoid rush."
    );
    lines.push(
      city
        ? `Nearby short-trip idea from ${city}: prioritize day trips and places within 2-4 hours.`
        : "Short-trip destination ideas: nearby hill stations, heritage towns, and one-region city breaks."
    );
  }

  return lines;
}

async function fetchExtraPlaces(
  city,
  existingNames,
  needed,
  destinationContext = null
) {
  if (!city || needed <= 0) return [];

  const cacheKey = `${String(city).toLowerCase()}|${existingNames
    .map((name) => normalizeNameKey(name))
    .sort()
    .join(",")}|${needed}`;
  const cached = cacheGet(extraPlacesCache, cacheKey);
  if (cached.hit) return cached.value || [];

  const extraRes = await fetchWithTimeout(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "llama-3.1-8b-instant",
        messages: [
          {
            role: "system",
            content: `
Return ONLY JSON.
Format:
{
  "places": [
    { "name": "", "briefDescription": "" }
  ]
}
Rules:
- Provide real attractions only.
- Do not repeat any names.
- Keep every place inside or very near ${city}.
${
  destinationContext?.countryName
    ? `- Keep every place in ${destinationContext.countryName}; never include other countries.`
    : ""
}
`
          },
          {
            role: "user",
            content: `Give ${needed} additional attractions in ${city} that are not in this list: ${existingNames.join(
              ", "
            )}.`
          }
        ]
      })
    },
    AI_TIMEOUT_MS
  );

  const extraData = await extraRes.json();
  const extraContent = extraData?.choices?.[0]?.message?.content || "";
  const raw = extraContent
    .replace(/```json/g, "")
    .replace(/```/g, "")
    .trim();

  const jsonString = extractFirstJsonObject(raw);
  if (!jsonString) return [];

  const parsed = safeJsonParse(jsonString);
  if (!parsed || !Array.isArray(parsed.places)) return [];

  const normalized = normalizePlaces(parsed.places);
  cacheSet(extraPlacesCache, cacheKey, normalized, EXTRA_PLACES_CACHE_TTL_MS);
  return normalized;
}

router.post("/chat", async (req, res) => {
  try {
    const {
      message,
      tripId,
      clerkUserId,
      userData = {},
      userLocation: rawUserLocation = null,
    } = req.body;

    if (!message) {
      return res.status(400).json({ error: "Message is required" });
    }
    if (!process.env.GROQ_API_KEY) {
      return res.status(400).json({
        error:
          "GROQ_API_KEY is missing on the server. Add it in your backend environment variables.",
      });
    }

    /* ======================================================
       PHASE 3 - MODIFY EXISTING TRIP
    ====================================================== */
    const userIntent = detectTripIntent(message);
    const requestedTravelMode = detectTravelMode(message);
    const requestedStartFromCurrentLocation =
      detectStartFromCurrentLocation(message);
    const wantsNearbyPlan = detectNearbyPreference(message);
    const requestedBudget = parseBudget(message);
    const requestedDays = parseDays(message);
    const requestedTravelers = parseTravelersCount(message);
    const parsedUserLocation = parseUserLocation(rawUserLocation);
    const userLocationContext = await getLocationContextFromCoordinates(
      parsedUserLocation
    );

    if (tripId) {
      const existingTrip = await Trip.findById(tripId);
      if (!existingTrip) {
        return res.status(404).json({ error: "Trip not found" });
      }
      const effectiveDays = requestedDays
        ? Math.max(1, Math.min(30, requestedDays))
        : Math.max(1, existingTrip.itinerary.length || 1);
      const travelerCount =
        requestedTravelers ||
        existingTrip.manualPreferences?.travelersCount ||
        (Array.isArray(existingTrip.travelers) && existingTrip.travelers.length) ||
        1;

      if (requestedBudget !== null) {
        const minBudget = estimateMinimumBudget(effectiveDays, travelerCount);
        if (requestedBudget < minBudget) {
          return res.json({
            reply: buildLowBudgetReply({
              budget: requestedBudget,
              minBudget,
              days: effectiveDays,
              travelers: travelerCount,
            }),
          });
        }
      }
      const baseCityHint = getTripDestinationHint(existingTrip);
      const cityHint =
        wantsNearbyPlan && userLocationContext?.cityHint
          ? userLocationContext.cityHint
          : baseCityHint;
      const destinationContext =
        (await getDestinationContext(cityHint)) || userLocationContext;

      const modifyRes = await fetch(
        "https://api.groq.com/openai/v1/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model: "llama-3.1-8b-instant",
            messages: [
              {
                role: "system",
                content: `
You are an intelligent travel planner assistant.
You must understand user intent and adapt the plan.

Current itinerary:
${JSON.stringify(existingTrip.itinerary)}

User request:
"${message}"

Return ONLY JSON in this format:
{
  "reply": "",
  "places": [
    { "name": "", "briefDescription": "" }
  ]
}
Rules:
- Use real attractions, avoid placeholders like "Day 1" or "Trip 1".
- Trip length is ${effectiveDays} days.
- Return enough places so final plan can have roughly 3 to 5 places per day.
- Keep all places inside or very near ${cityHint || "the trip destination"}.
- Never include far away cities or another country.
${
  destinationContext?.countryName
    ? `- Every place must be inside ${destinationContext.countryName}.`
    : ""
}
- If user asks for low budget: prefer affordable attractions and transport.
- If honeymoon: include romantic experiences.
- If adventure: include outdoor/adventure activities.
- If family: include safe, family-friendly attractions.
- If short trip: optimize for fewer transfers and nearby clusters.
- Keep places geographically efficient with minimal backtracking.
- If long transfer legs are likely, include practical meal break points and stay options.
- If user asks for nearby/current-location planning, keep places around ${
                  cityHint || "the active trip city"
                }.
- Travel mode preference: ${
                  requestedTravelMode || existingTrip.preferences?.travelMode || "driving"
                }.
- Start point preference: ${
                  requestedStartFromCurrentLocation === null
                    ? existingTrip.preferences?.startFromCurrentLocation
                      ? "current location"
                      : "first planned stop"
                    : requestedStartFromCurrentLocation
                    ? "current location"
                    : "first planned stop"
                }.
${
  requestedBudget
    ? `- Budget cap: keep plan practical under ${requestedBudget} INR.`
    : ""
}
${
  requestedTravelers
    ? `- Group size preference: ${requestedTravelers} travelers.`
    : ""
}
${
  userLocationContext?.cityHint
    ? `- User current location context: ${userLocationContext.cityHint}.`
    : ""
}
- In "reply", do not include extra suggestions unless the user explicitly asked for recommendations.
`
              },
              { role: "user", content: message }
            ]
          })
        }
      );

      const modifyData = await modifyRes.json();
      const modifyContent = modifyData?.choices?.[0]?.message?.content || "";

      let raw = modifyContent
        .replace(/```json/g, "")
        .replace(/```/g, "")
        .trim();

      const jsonString = extractFirstJsonObject(raw);

      if (!jsonString) {
        console.error("AI RAW RESPONSE:", raw);
        return res.status(500).json({ error: "AI did not return valid JSON" });
      }

      let updatedPlan;
      try {
        updatedPlan = JSON.parse(jsonString);
      } catch (err) {
        try {
          const safeJson = jsonString
            .replace(/(\w+):/g, '"$1":')
            .replace(/'/g, '"')
            .replace(/,\s*}/g, "}")
            .replace(/,\s*]/g, "]");

          updatedPlan = JSON.parse(safeJson);
        } catch (err2) {
          console.error("JSON PARSE FAILED:", jsonString);
          return res.status(500).json({ error: "Invalid AI JSON structure" });
        }
      }

      if (!updatedPlan || !Array.isArray(updatedPlan.places)) {
        return res
          .status(500)
          .json({ error: "AI returned invalid update format" });
      }

      const days = effectiveDays;
      const maxPlaces = Math.max(1, days * 5);
      let requestedPlaces = normalizePlaces(updatedPlan.places || []);
      const minPlaces = days * 3;

      if (requestedPlaces.length < minPlaces) {
        const needed = minPlaces - requestedPlaces.length;
        try {
          const extra = await fetchExtraPlaces(
            cityHint || destinationContext?.cityHint || "destination",
            requestedPlaces.map((p) => p.name),
            needed,
            destinationContext
          );
          requestedPlaces = normalizePlaces([...requestedPlaces, ...extra]);
        } catch (err) {
          console.error("Failed to fetch extra places:", err);
        }
      }
      requestedPlaces = requestedPlaces.slice(0, maxPlaces);
      const startDate = new Date(existingTrip.startDate);
      let geoActivities = await buildActivitiesFromPlaces(
        requestedPlaces,
        cityHint,
        destinationContext
      );

      if (geoActivities.length < minPlaces && destinationContext) {
        const needed = minPlaces - geoActivities.length;
        const nearbyPlaces = await fetchNearbyAttractions(
          destinationContext,
          [
            ...requestedPlaces.map((p) => p.name),
            ...geoActivities.map((a) => a.name),
          ],
          needed
        );
        if (nearbyPlaces.length > 0) {
          const nearbyActivities = await buildActivitiesFromPlaces(
            nearbyPlaces,
            cityHint,
            destinationContext
          );
          const seen = new Set();
          geoActivities = [...geoActivities, ...nearbyActivities].filter((activity) => {
            const key = normalizeNameKey(activity?.name || "");
            if (!key || seen.has(key)) return false;
            seen.add(key);
            return true;
          });
        }
      }

      geoActivities = geoActivities.slice(0, maxPlaces);
      if (geoActivities.length === 0) {
        return res.status(500).json({
          error: "Could not build a local itinerary for this destination. Please try a clearer destination name.",
        });
      }

      const newItinerary = scheduleActivitiesByTime(
        geoActivities,
        days,
        startDate
      );

      existingTrip.itinerary = newItinerary;
      existingTrip.placesToVisit = newItinerary
        .flatMap((day) => day.activities || [])
        .slice(0, Math.max(1, days * 5));
      if (requestedBudget !== null) {
        existingTrip.budget = requestedBudget;
      }
      existingTrip.startDay = "1";
      existingTrip.endDay = String(days);
      const newEndDate = new Date(startDate);
      newEndDate.setDate(startDate.getDate() + days - 1);
      existingTrip.endDate = newEndDate.toISOString().slice(0, 10);

      if (
        requestedTravelMode ||
        requestedStartFromCurrentLocation !== null
      ) {
        existingTrip.preferences = {
          ...(existingTrip.preferences || {}),
          travelMode:
            requestedTravelMode ||
            existingTrip.preferences?.travelMode ||
            "driving",
          startFromCurrentLocation:
            requestedStartFromCurrentLocation === null
              ? existingTrip.preferences?.startFromCurrentLocation || false
              : requestedStartFromCurrentLocation,
        };
      }
      if (requestedTravelers) {
        existingTrip.manualPreferences = {
          ...(existingTrip.manualPreferences || {}),
          travelersCount: requestedTravelers,
        };
      }
      await existingTrip.save();

      const suggestionLines = buildSmartSuggestions(userIntent, cityHint);
      const attachSuggestions = shouldAttachSuggestions(message);
      const budgetReply =
        requestedBudget !== null ? ` Budget set to ${requestedBudget} INR.` : "";
      const dayReply =
        requestedDays ? ` Trip length set to ${days} days.` : "";
      const replyText =
        updatedPlan.reply ||
        `Got it. I updated your itinerary based on your request.${budgetReply}${dayReply}`;

      return res.json({
        trip: existingTrip,
        reply:
          attachSuggestions && suggestionLines.length > 0
            ? `${replyText}\n\nSuggestions:\n- ${suggestionLines.join("\n- ")}`
            : replyText
      });
    }

    /* ======================================================
       CREATE NEW TRIP
    ====================================================== */
    if (wantsNearbyPlan && !userLocationContext?.cityHint) {
      return res.status(200).json({
        reply:
          "Please share your current location (or enable location access), and I will plan a nearby trip with budget, travel mode, and day-wise itinerary.",
      });
    }

    if (requestedBudget !== null) {
      const plannedDays = requestedDays ? Math.max(1, Math.min(30, requestedDays)) : 3;
      const travelerCount = requestedTravelers || 1;
      const minBudget = estimateMinimumBudget(plannedDays, travelerCount);
      if (requestedBudget < minBudget) {
        return res.status(200).json({
          reply: buildLowBudgetReply({
            budget: requestedBudget,
            minBudget,
            days: plannedDays,
            travelers: travelerCount,
          }),
        });
      }
    }

    let plan;
    let aiContent = "";
    try {
      const aiRes = await fetchWithTimeout(
        "https://api.groq.com/openai/v1/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model: "llama-3.1-8b-instant",
            messages: [
              {
                role: "system",
                content: `
You are an intelligent AI travel planner.
You must understand user constraints and travel style.

Return ONLY JSON.
Format:
{
  "reply": "",
  "city": "",
  "days": number,
  "places": [
    { "name": "", "briefDescription": "" }
  ]
}
Rules:
- Provide 3 to 5 real attractions per day (total places = days * 3 to days * 5).
- Do not use placeholders like "Day 1" or "Trip 1".
- All places must belong to the same destination region and same country.
- Do not mix places from different cities/states/countries in one trip.
- Infer user intent from message and align places accordingly:
  - low budget -> budget-friendly attractions and practical routing
  - honeymoon -> romantic places/experiences
  - adventure -> trekking, rafting, outdoor activities
  - family -> safer, family-friendly spots
  - short trip -> nearby, low-transit plan
- If the user asks for nearby/current-location planning, prioritize destinations near user location context: ${
                userLocationContext?.cityHint || "not provided"
              }.
- Keep places geographically efficient with minimal backtracking.
- Prefer realistic travel flow: travel, meals, sightseeing, stay.
- Travel mode preference: ${requestedTravelMode || "driving"}.
- Start point preference: ${
                requestedStartFromCurrentLocation === null
                  ? "current location"
                  : requestedStartFromCurrentLocation
                  ? "current location"
                  : "first planned stop"
              }.
${
  requestedDays
    ? `- The trip must be exactly ${requestedDays} days.`
    : ""
}
${
  requestedBudget
    ? `- Budget cap: keep plan practical under ${requestedBudget} INR.`
    : ""
}
${
  requestedTravelers
    ? `- Group size preference: ${requestedTravelers} travelers.`
    : ""
}
- In "reply", do not include extra suggestions unless the user explicitly asked for recommendations.
`
              },
              { role: "user", content: message }
            ]
          })
        },
        AI_TIMEOUT_MS
      );

      const aiData = await aiRes.json();
      aiContent = aiData?.choices?.[0]?.message?.content || "";
      let raw = aiContent
        .replace(/```json/g, "")
        .replace(/```/g, "")
        .trim();

      const jsonString = extractFirstJsonObject(raw);

      if (!jsonString) {
        throw new Error("AI did not return valid JSON");
      }

      try {
        plan = JSON.parse(jsonString);
      } catch (e) {
        const safeJson = jsonString
          .replace(/(\w+):/g, '"$1":')
          .replace(/'/g, '"')
          .replace(/,\s*}/g, "}")
          .replace(/,\s*]/g, "]");
        plan = JSON.parse(safeJson);
      }
    } catch (err) {
      plan = {
        reply:
          "I generated a quick plan using nearby attractions. You can refine it anytime.",
        city: "",
        days: requestedDays || 3,
        places: []
      };
    }

    const aiDays = Number(plan?.days);
    if (
      !plan ||
      (!requestedDays &&
        (!Number.isFinite(aiDays) || aiDays <= 0))
    ) {
      return res.status(500).json({ error: "AI returned invalid trip plan" });
    }

    const aiCity = String(plan?.city || "").trim();
    const planningCity =
      (wantsNearbyPlan && userLocationContext?.cityHint
        ? userLocationContext.cityHint
        : aiCity) || userLocationContext?.cityHint || "";

    if (!planningCity) {
      return res.status(200).json({
        reply:
          "Please share destination or enable current location so I can build your trip plan.",
      });
    }

    const days = requestedDays
      ? Math.max(1, Math.min(30, requestedDays))
      : Math.max(1, Math.round(aiDays));
    if (!clerkUserId) {
      return res.status(401).json({ error: "User ID is required" });
    }

    let user = await User.findOne({ clerkUserId });
    if (!user) {
      const { email, name } = userData;
      if (!email) {
        return res.status(400).json({ error: "User email is required" });
      }
      user = new User({ clerkUserId, email, name });
      await user.save();
    }

    const startDate = new Date();
    const endDate = new Date(startDate);
    endDate.setDate(startDate.getDate() + days - 1);

    const itinerary = [];
    const placesToVisit = [];
    const destinationContext =
      (await getDestinationContext(planningCity)) || userLocationContext;

    let requestedPlaces = normalizePlaces(
      Array.isArray(plan.places) ? plan.places : []
    );
    const minPlaces = days * 3;
    const maxPlaces = Math.max(1, days * 5);
    if (requestedPlaces.length < minPlaces) {
      const needed = minPlaces - requestedPlaces.length;
      try {
        const extra = await fetchExtraPlaces(
          planningCity,
          requestedPlaces.map((p) => p.name),
          needed,
          destinationContext
        );
        requestedPlaces = normalizePlaces([...requestedPlaces, ...extra]);
      } catch (err) {
        console.error("Failed to fetch extra places:", err);
      }
    }

    requestedPlaces = requestedPlaces.slice(0, maxPlaces);
    let geoActivities = await buildActivitiesFromPlaces(
      requestedPlaces,
      planningCity,
      destinationContext
    );

    if (geoActivities.length < minPlaces && destinationContext) {
      const needed = minPlaces - geoActivities.length;
      const nearbyPlaces = await fetchNearbyAttractions(
        destinationContext,
        [
          ...requestedPlaces.map((p) => p.name),
          ...geoActivities.map((a) => a.name),
        ],
        needed
      );
      if (nearbyPlaces.length > 0) {
        const nearbyActivities = await buildActivitiesFromPlaces(
          nearbyPlaces,
          planningCity,
          destinationContext
        );
        const seen = new Set();
        geoActivities = [...geoActivities, ...nearbyActivities].filter((activity) => {
          const key = normalizeNameKey(activity?.name || "");
          if (!key || seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      }
    }

    geoActivities = geoActivities.slice(0, maxPlaces);
    if (geoActivities.length === 0) {
      return res.status(500).json({
        error: "Could not build a local itinerary for this destination. Try a more specific city/region.",
      });
    }

    const scheduled = scheduleActivitiesByTime(geoActivities, days, startDate);
    itinerary.push(...scheduled);
    for (const day of itinerary) {
      for (const activityData of day.activities || []) {
        if (!placesToVisit.find((p) => p.name === activityData.name)) {
          placesToVisit.push(activityData);
        }
      }
    }

    const tripCityLabel = planningCity.split(",")[0].trim() || planningCity;
    const trip = await Trip.create({
      tripName: `AI Trip to ${tripCityLabel}`,
      background: getCityBackground(tripCityLabel),
      startDate: startDate.toISOString().slice(0, 10),
      endDate: endDate.toISOString().slice(0, 10),
      startDay: "1",
      endDay: String(days),
      placesToVisit,
      expenses: [],
      budget: requestedBudget || 0,
      itinerary,
      host: user._id,
      travelers: [user._id],
      preferences: {
        travelMode: requestedTravelMode || "driving",
        startFromCurrentLocation:
          requestedStartFromCurrentLocation === null
            ? true
            : requestedStartFromCurrentLocation,
      },
      manualPreferences: {
        travelersCount: requestedTravelers || 1,
      },
    });

    const suggestionLines = buildSmartSuggestions(userIntent, tripCityLabel);
    const attachSuggestions = shouldAttachSuggestions(message);
    const replyText =
      plan.reply ||
      `I created a ${days}-day trip to ${tripCityLabel}${
        requestedBudget !== null ? ` within ${requestedBudget} INR budget` : ""
      }.`;

    res.json({
      trip,
      reply:
        attachSuggestions && suggestionLines.length > 0
          ? `${replyText}\n\nSuggestions:\n- ${suggestionLines.join("\n- ")}`
          : replyText
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

export default router;

