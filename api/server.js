import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import axios from 'axios';
import nodemailer from 'nodemailer';
import http from 'node:http';
import https from 'node:https';

// Initialize Express app
const app = express();
const port = process.env.PORT || 3000;

import Trip from './models/trip.js';
import User from './models/user.js';
import aiRoutes from "./routes/ai.js";


// Middleware
const corsOrigins = (process.env.CORS_ORIGINS ||
  "http://localhost:8081,https://aitravelplanner-jade.vercel.app")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const isAllowedOrigin = (origin) => {
  if (!origin) return true;
  if (corsOrigins.includes(origin)) return true;
  if (/^https?:\/\/.*\.vercel\.app$/i.test(origin)) return true;
  if (/^https?:\/\/localhost:\d+$/i.test(origin)) return true;
  return false;
};

app.use(
  cors({
    origin: (origin, callback) => callback(null, isAllowedOrigin(origin)),
    credentials: true,
  })
);
app.use((req, res, next) => {
  const auth = req.headers.authorization;

  // Allow requests without auth for now
  if (!auth) return next();

  // Just pass through (no validation yet)
  // This avoids random 401s
  req.user = { token: auth };
  next();
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use("/api/ai", aiRoutes);

const toRadians = (value) => (value * Math.PI) / 180;
const haversineKm = (a, b) => {
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
};

const buildOsmAddress = (tags = {}) => {
  if (!tags || typeof tags !== 'object') return '';
  if (tags['addr:full']) return tags['addr:full'];
  const parts = [
    tags['addr:housenumber'],
    tags['addr:street'],
    tags['addr:suburb'],
    tags['addr:city'],
    tags['addr:district'],
    tags['addr:state'],
    tags['addr:postcode'],
    tags['addr:country'],
  ].filter(Boolean);
  return parts.join(', ');
};

const orderByNearestNeighbor = (activities) => {
  if (activities.length <= 2) return activities;
  const remaining = activities.slice(1);
  const ordered = [activities[0]];
  while (remaining.length) {
    const last = ordered[ordered.length - 1];
    const lastLoc = last.geometry?.location;
    if (!lastLoc) {
      ordered.push(remaining.shift());
      continue;
    }
    let bestIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    remaining.forEach((item, idx) => {
      const loc = item.geometry?.location;
      if (!loc) return;
      const dist = haversineKm(
        { lat: lastLoc.lat, lng: lastLoc.lng },
        { lat: loc.lat, lng: loc.lng }
      );
      if (dist < bestDistance) {
        bestDistance = dist;
        bestIndex = idx;
      }
    });
    const [next] = remaining.splice(bestIndex, 1);
    ordered.push(next);
  }
  return ordered;
};

const ROUTING_TIMEOUT_MS = Number(process.env.ROUTING_TIMEOUT_MS || 12000);
const RETRYABLE_NETWORK_CODES = new Set([
  'ETIMEDOUT',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ECONNABORTED',
]);

const routingHttpAgent = new http.Agent({ keepAlive: true });
const routingHttpsAgent = new https.Agent({ keepAlive: true });

const routingAxios = axios.create({
  timeout: ROUTING_TIMEOUT_MS,
  httpAgent: routingHttpAgent,
  httpsAgent: routingHttpsAgent,
  family: 4,
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const getWithRetry = async (url, config = {}, retries = 1) => {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await routingAxios.get(url, config);
    } catch (error) {
      lastError = error;
      const code = error?.code;
      const shouldRetry =
        RETRYABLE_NETWORK_CODES.has(code) && attempt < retries;
      if (!shouldRetry) break;
      await sleep(300 * (attempt + 1));
    }
  }
  throw lastError;
};

const buildApproxRoute = (points, profile = 'driving') => {
  const speeds = {
    driving: 38,
    cycling: 14,
    walking: 5,
  };
  const speedKmh = speeds[profile] || speeds.driving;

  const legs = [];
  let totalDistanceMeters = 0;
  let totalDurationSeconds = 0;

  for (let i = 1; i < points.length; i++) {
    const [fromLat, fromLng] = points[i - 1];
    const [toLat, toLng] = points[i];
    const distanceKm = haversineKm(
      { lat: fromLat, lng: fromLng },
      { lat: toLat, lng: toLng }
    );
    const distanceMeters = Math.max(0, Math.round(distanceKm * 1000));
    const durationSeconds = Math.max(
      60,
      Math.round((distanceKm / speedKmh) * 3600)
    );
    legs.push({ distance: distanceMeters, duration: durationSeconds });
    totalDistanceMeters += distanceMeters;
    totalDurationSeconds += durationSeconds;
  }

  return {
    route: {
      type: 'LineString',
      coordinates: points.map(([lat, lng]) => [lng, lat]),
    },
    summary: {
      distance: totalDistanceMeters,
      duration: totalDurationSeconds,
      legs,
    },
  };
};

const recentLogByKey = new Map();
const logErrorOncePerWindow = (key, message, windowMs = 30000) => {
  const now = Date.now();
  const last = recentLogByKey.get(key) || 0;
  if (now - last >= windowMs) {
    recentLogByKey.set(key, now);
    console.error(message);
  }
};

const OVERPASS_TIMEOUT_MS = Number(process.env.OVERPASS_TIMEOUT_MS || 10000);
const OVERPASS_CACHE_TTL_MS = Number(process.env.OVERPASS_CACHE_TTL_MS || 5 * 60 * 1000);
const OVERPASS_MIN_INTERVAL_MS = Number(process.env.OVERPASS_MIN_INTERVAL_MS || 1200);
const OVERPASS_ENDPOINTS = (
  process.env.OVERPASS_ENDPOINTS ||
  'https://overpass-api.de/api/interpreter,https://overpass.kumi.systems/api/interpreter,https://overpass.openstreetmap.ru/api/interpreter'
)
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);

const overpassCache = new Map();
let lastOverpassRequestAt = 0;
const nominatimSearchCache = new Map();
const NOMINATIM_SEARCH_TIMEOUT_MS = Number(
  process.env.NOMINATIM_SEARCH_TIMEOUT_MS || 8000
);
const NOMINATIM_SEARCH_CACHE_TTL_MS = Number(
  process.env.NOMINATIM_SEARCH_CACHE_TTL_MS || 10 * 60 * 1000
);
const NOMINATIM_MIN_INTERVAL_MS = Number(
  process.env.NOMINATIM_MIN_INTERVAL_MS || 700
);
let lastNominatimRequestAt = 0;
const TRAVEL_MODES_CACHE_TTL_MS = Number(
  process.env.TRAVEL_MODES_CACHE_TTL_MS || 5 * 60 * 1000
);
const TRAVELTIME_APP_ID = process.env.TRAVELTIME_APP_ID || '';
const TRAVELTIME_API_KEY = process.env.TRAVELTIME_API_KEY || '';
const GOOGLE_MAPS_API_KEY =
  process.env.GOOGLE_MAPS_API_KEY ||
  process.env.GOOGLE_DIRECTIONS_API_KEY ||
  process.env.GOOGLE_PLACES_API_KEY ||
  '';
const travelModesCache = new Map();

const waitOverpassSlot = async () => {
  const now = Date.now();
  const waitMs = lastOverpassRequestAt + OVERPASS_MIN_INTERVAL_MS - now;
  if (waitMs > 0) {
    await sleep(waitMs);
  }
  lastOverpassRequestAt = Date.now();
};

const overpassCacheKey = ({ lat, lng, type, radius }) => {
  const round = (value) => Math.round(Number(value) * 1000) / 1000;
  return `${type}:${round(lat)}:${round(lng)}:${Math.round(Number(radius) || 0)}`;
};

const waitNominatimSlot = async () => {
  const now = Date.now();
  const waitMs = lastNominatimRequestAt + NOMINATIM_MIN_INTERVAL_MS - now;
  if (waitMs > 0) {
    await sleep(waitMs);
  }
  lastNominatimRequestAt = Date.now();
};

const fetchOverpassElements = async (query) => {
  let lastError = null;

  for (let i = 0; i < OVERPASS_ENDPOINTS.length; i++) {
    const endpoint = OVERPASS_ENDPOINTS[i];
    try {
      await waitOverpassSlot();
      const response = await routingAxios.post(
        endpoint,
        `data=${encodeURIComponent(query)}`,
        {
          timeout: OVERPASS_TIMEOUT_MS,
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'ai-travel-planner',
          },
          validateStatus: () => true,
        }
      );

      if (response.status === 429) {
        lastError = new Error(`Overpass rate limited at ${endpoint}`);
        continue;
      }

      if (response.status < 200 || response.status >= 300) {
        lastError = new Error(`Overpass ${endpoint} returned ${response.status}`);
        continue;
      }

      const elements = Array.isArray(response.data?.elements)
        ? response.data.elements
        : [];
      return elements;
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError || new Error('All Overpass endpoints failed');
};

const getSafeRouteProfile = (profileValue = 'driving') => {
  const normalized = profileValue?.toString?.() || 'driving';
  if (['driving', 'walking', 'cycling'].includes(normalized)) {
    return normalized;
  }
  return normalized === 'transit' ? 'driving' : 'driving';
};

const fetchRouteForPoints = async (points, profile = 'driving') => {
  const safeProfile = getSafeRouteProfile(profile);
  const osrmCoords = points
    .map(([lat, lng]) => `${lng},${lat}`)
    .join(';');
  const url = `https://router.project-osrm.org/route/v1/${safeProfile}/${osrmCoords}?overview=full&geometries=geojson&steps=false`;
  const response = await getWithRetry(
    url,
    { validateStatus: () => true },
    1
  );

  if (response.status < 200 || response.status >= 300) {
    const approx = buildApproxRoute(points, safeProfile);
    return {
      route: approx.route,
      summary: approx.summary,
      fallback: true,
      profile: safeProfile,
      warning: `Live routing unavailable (${response.status}). Showing approximate route.`,
    };
  }

  const routeData = response.data?.routes?.[0] || null;
  const route = routeData?.geometry || null;
  const summary = routeData
    ? {
        distance: routeData.distance || 0,
        duration: routeData.duration || 0,
        legs: (routeData.legs || []).map((leg) => ({
          distance: leg.distance || 0,
          duration: leg.duration || 0,
        })),
      }
    : null;

  if (!route) {
    const approx = buildApproxRoute(points, safeProfile);
    return {
      route: approx.route,
      summary: approx.summary,
      fallback: true,
      profile: safeProfile,
      warning: 'Live routing was unavailable. Showing approximate route.',
    };
  }

  return {
    route,
    summary,
    fallback: false,
    profile: safeProfile,
  };
};

const roundCoord = (value) => Math.round(Number(value) * 1000) / 1000;

const getTravelModesCacheKey = (origin, destination) =>
  `${roundCoord(origin.lat)},${roundCoord(origin.lng)}:${roundCoord(
    destination.lat
  )},${roundCoord(destination.lng)}`;

const googleModeMeta = {
  driving: { label: 'Car' },
  transit: { label: 'Transit' },
  bicycling: { label: 'Bike' },
  walking: { label: 'Walk' },
};
const traveltimeModeMeta = {
  driving: { label: 'Car' },
  public_transport: { label: 'Transit' },
  cycling: { label: 'Bike' },
  walking: { label: 'Walk' },
};

const buildGoogleDirectionsUrl = (origin, destination, mode) => {
  const params = new URLSearchParams({
    origin: `${origin.lat},${origin.lng}`,
    destination: `${destination.lat},${destination.lng}`,
    mode,
    units: 'metric',
    key: GOOGLE_MAPS_API_KEY,
  });

  if (mode === 'transit') {
    params.set('departure_time', 'now');
  }

  return `https://maps.googleapis.com/maps/api/directions/json?${params.toString()}`;
};

const fetchGoogleTravelMode = async (origin, destination, mode) => {
  const url = buildGoogleDirectionsUrl(origin, destination, mode);
  const response = await getWithRetry(
    url,
    { validateStatus: () => true },
    1
  );

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Google Directions HTTP ${response.status}`);
  }

  const status = response.data?.status;
  if (status !== 'OK') {
    if (status === 'ZERO_RESULTS') {
      return {
        id: mode,
        label: googleModeMeta[mode]?.label || mode,
        distance: null,
        duration: null,
        provider: 'google',
        available: false,
        note:
          mode === 'transit'
            ? 'No public transit route found for this trip right now.'
            : 'No route found for this mode.',
      };
    }

    throw new Error(
      `Google Directions ${mode} failed with status ${status || 'UNKNOWN'}`
    );
  }

  const route = response.data?.routes?.[0];
  const leg = route?.legs?.[0];
  if (!leg) {
    throw new Error(`Google Directions ${mode} returned no leg data`);
  }

  const noteParts = [];
  if (mode === 'transit' && leg.departure_time?.text) {
    noteParts.push(`Leaves ${leg.departure_time.text}`);
  }
  if (mode === 'transit' && leg.arrival_time?.text) {
    noteParts.push(`arrives ${leg.arrival_time.text}`);
  }

  return {
    id: mode,
    label: googleModeMeta[mode]?.label || mode,
    distance: Number(leg.distance?.value || 0),
    duration: Number(leg.duration?.value || 0),
    provider: 'google',
    available: true,
    note: noteParts.join(' • '),
  };
};

const extractTravelTimeProperty = (resultItem) =>
  resultItem?.locations?.[0]?.properties?.[0] || null;

const fetchTravelTimeModes = async (origin, destination) => {
  const departureTime = new Date().toISOString();
  const modes = ['driving', 'public_transport', 'cycling', 'walking'];

  const response = await routingAxios.post(
    'https://api.traveltimeapp.com/v4/routes',
    {
      locations: [
        {
          id: 'origin',
          coords: {
            lat: origin.lat,
            lng: origin.lng,
          },
        },
        {
          id: 'destination',
          coords: {
            lat: destination.lat,
            lng: destination.lng,
          },
        },
      ],
      departure_searches: modes.map((mode) => ({
        id: mode,
        departure_location_id: 'origin',
        arrival_location_ids: ['destination'],
        departure_time: departureTime,
        transportation: {
          type: mode,
        },
        properties: ['travel_time', 'distance'],
      })),
    },
    {
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Application-Id': TRAVELTIME_APP_ID,
        'X-Api-Key': TRAVELTIME_API_KEY,
      },
      validateStatus: () => true,
    }
  );

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`TravelTime HTTP ${response.status}`);
  }

  const results = Array.isArray(response.data?.results)
    ? response.data.results
    : [];
  const unreachableBySearchId = new Map(
    (Array.isArray(response.data?.unreachable) ? response.data.unreachable : []).map(
      (item) => [item?.search_id, item]
    )
  );

  return modes.map((mode) => {
    const resultItem = results.find((item) => item?.search_id === mode);
    const property = extractTravelTimeProperty(resultItem);
    const unreachable = unreachableBySearchId.get(mode);

    if (!property) {
      return {
        id: mode === 'public_transport' ? 'transit' : mode,
        label: traveltimeModeMeta[mode]?.label || mode,
        distance: null,
        duration: null,
        provider: 'traveltime',
        available: false,
        note:
          mode === 'public_transport'
            ? 'No public transport route found right now.'
            : unreachable
            ? 'This route is currently unreachable for this mode.'
            : 'No route found for this mode.',
      };
    }

    return {
      id: mode === 'public_transport' ? 'transit' : mode,
      label: traveltimeModeMeta[mode]?.label || mode,
      distance: Number(property.distance || 0),
      duration: Number(property.travel_time || 0),
      provider: 'traveltime',
      available: true,
      note:
        mode === 'public_transport'
          ? 'Live multimodal timing from TravelTime.'
          : 'Live timing from TravelTime.',
    };
  });
};

const buildFallbackTravelModes = async (origin, destination) => {
  const points = [
    [origin.lat, origin.lng],
    [destination.lat, destination.lng],
  ];
  const drivingResult = await fetchRouteForPoints(points, 'driving');
  const drivingDistance = Number(drivingResult.summary?.distance || 0);
  const drivingDuration = Number(drivingResult.summary?.duration || 0);
  const modes = [
    { id: 'driving', label: 'Car', profile: 'driving' },
    { id: 'cycling', label: 'Bike', profile: 'cycling' },
    { id: 'walking', label: 'Walk', profile: 'walking' },
  ];
  const speedByProfile = {
    driving: 38,
    cycling: 14,
    walking: 5,
  };

  const settled = await Promise.allSettled(
    modes.map(async (mode) => {
      const result =
        mode.profile === 'driving'
          ? drivingResult
          : await fetchRouteForPoints(points, mode.profile);
      let distanceMeters = Number(result.summary?.distance || 0);
      if (!distanceMeters && drivingDistance) {
        distanceMeters = drivingDistance;
      }
      let durationSeconds = Number(result.summary?.duration || 0);
      if (distanceMeters > 0 && mode.profile !== 'driving') {
        const speed = speedByProfile[mode.profile] || speedByProfile.driving;
        durationSeconds = Math.max(
          60,
          Math.round((distanceMeters / 1000 / speed) * 3600)
        );
      }
      return {
        id: mode.id,
        label: mode.label,
        distance: distanceMeters,
        duration: durationSeconds,
        provider: result.fallback ? 'estimated' : 'osrm',
        available: true,
        note: result.fallback
          ? 'Estimated timing from free routing service.'
          : 'Timing from live routing service.',
      };
    })
  );

  const values = settled
    .filter((item) => item.status === 'fulfilled')
    .map((item) => item.value);

  if (drivingDistance > 0) {
    const transitDistance = Math.round(drivingDistance * 1.05);
    const transitDuration = Math.max(
      60,
      Math.round((drivingDuration || (transitDistance / 1000 / 22) * 3600) * 1.3)
    );
    values.splice(1, 0, {
      id: 'transit',
      label: 'Transit',
      distance: transitDistance,
      duration: transitDuration,
      provider: 'estimated',
      available: true,
      note: 'Estimated public transport timing.',
    });
  } else {
    values.splice(1, 0, {
      id: 'transit',
      label: 'Transit',
      distance: null,
      duration: null,
      provider: 'unavailable',
      available: false,
      note:
        TRAVELTIME_APP_ID && TRAVELTIME_API_KEY
          ? 'Transit timing is temporarily unavailable.'
          : GOOGLE_MAPS_API_KEY
          ? 'Transit timing is temporarily unavailable.'
          : 'Add TravelTime or Google Maps credentials to show live public transit timings.',
    });
  }

  if (drivingDistance > 0) {
    values.forEach((mode) => {
      if (mode.id === 'cycling' && Math.abs(mode.distance - drivingDistance) < drivingDistance * 0.02) {
        mode.distance = Math.round(drivingDistance * 1.05);
        mode.duration = Math.max(
          60,
          Math.round((mode.distance / 1000 / speedByProfile.cycling) * 3600)
        );
      }
      if (mode.id === 'walking' && Math.abs(mode.distance - drivingDistance) < drivingDistance * 0.02) {
        mode.distance = Math.round(drivingDistance * 1.1);
        mode.duration = Math.max(
          60,
          Math.round((mode.distance / 1000 / speedByProfile.walking) * 3600)
        );
      }
    });
  }

  return values;
};

const fetchTravelModes = async (origin, destination) => {
  const cacheKey = getTravelModesCacheKey(origin, destination);
  const cached = travelModesCache.get(cacheKey);
  const now = Date.now();

  if (cached && now - cached.cachedAt < TRAVEL_MODES_CACHE_TTL_MS) {
    return cached.payload;
  }

  let payload = null;

  if (TRAVELTIME_APP_ID && TRAVELTIME_API_KEY) {
    try {
      payload = {
        modes: await fetchTravelTimeModes(origin, destination),
        source: 'traveltime',
      };
    } catch (error) {
      logErrorOncePerWindow(
        `travel_modes_traveltime_${error?.message || 'error'}`,
        `TravelTime mode error: ${error?.message || error}`
      );
    }
  }

  if (!payload && GOOGLE_MAPS_API_KEY) {
    const googleModes = ['driving', 'transit', 'bicycling', 'walking'];
    const settled = await Promise.allSettled(
      googleModes.map((mode) => fetchGoogleTravelMode(origin, destination, mode))
    );

    const googleResults = settled
      .filter((item) => item.status === 'fulfilled')
      .map((item) => item.value);

    if (googleResults.length) {
      const fallbackResults = await buildFallbackTravelModes(origin, destination);
      const merged = fallbackResults.map((fallbackItem) => {
        const googleItem = googleResults.find(
          (item) =>
            item.id === fallbackItem.id ||
            (item.id === 'bicycling' && fallbackItem.id === 'cycling')
        );
        return (
          googleItem || {
            ...fallbackItem,
            note:
              fallbackItem.id === 'transit'
                ? 'Transit timing unavailable from Google right now.'
                : fallbackItem.note,
          }
        );
      });

      payload = {
        modes: merged,
        source: 'google',
      };
    } else {
      logErrorOncePerWindow(
        'travel_modes_google_empty',
        'Google travel modes returned no usable routes. Falling back to OSRM estimates.'
      );
    }

    settled
      .filter((item) => item.status === 'rejected')
      .forEach((item) => {
        logErrorOncePerWindow(
          `travel_modes_google_${item.reason?.message || 'error'}`,
          `Google travel mode error: ${item.reason?.message || item.reason}`
        );
      });
  }

  if (!payload) {
    payload = {
      modes: await buildFallbackTravelModes(origin, destination),
      source: 'fallback',
    };
  }

  const fallbackModes = await buildFallbackTravelModes(origin, destination);
  const fallbackById = new Map(
    fallbackModes.map((mode) => [mode.id, mode])
  );
  const normalizedModes = (payload.modes || []).map((mode) => {
    const fallback =
      fallbackById.get(mode.id) ||
      (mode.id === 'bicycling' ? fallbackById.get('cycling') : null);
    const distance = Number(mode.distance || 0);
    const duration = Number(mode.duration || 0);
    if (
      fallback &&
      (!Number.isFinite(distance) || distance <= 0 || !Number.isFinite(duration) || duration <= 0)
    ) {
      return { ...fallback, ...mode, distance: fallback.distance, duration: fallback.duration };
    }
    return { ...fallback, ...mode, id: fallback?.id || mode.id };
  });

  const nonTransitModes = normalizedModes.filter((mode) => mode.id !== 'transit');
  const timeSignature = nonTransitModes
    .map((mode) => `${Math.round(Number(mode.duration || 0))}:${Math.round(Number(mode.distance || 0))}`)
    .filter(Boolean);
  const allSame =
    timeSignature.length > 1 && timeSignature.every((value) => value === timeSignature[0]);
  if (allSame) {
    const transit = normalizedModes.find((mode) => mode.id === 'transit');
    payload.modes = fallbackModes.map((mode) =>
      mode.id === 'transit' && transit ? transit : mode
    );
  } else {
    payload.modes = normalizedModes;
  }

  travelModesCache.set(cacheKey, { payload, cachedAt: now });
  return payload;
};

// MongoDB Connection with Mongoose
const mongoURI = process.env.MONGODB_URI || "mongodb+srv://sujan:sujan@cluster0.8pdm6fd.mongodb.net/tripPlanner?retryWrites=true&w=majority";
mongoose.connect(mongoURI)
    
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => {
    console.log("MONGO URI =", mongoURI);
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });






// Nodemailer configuration
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'mohitkapgate2413@gmail.com', // Replace with your email
    pass:'mohit1234', // Replace with your app-specific password
  },
});

// Root Route
app.get('/', (req, res) => {
  res.send('Trip Planner API');
});

// Place search (Nominatim proxy to avoid browser CORS + rate-limit pressure)
app.get('/api/places/search', async (req, res) => {
  const { q = '', limit = 8 } = req.query;
  const query = String(q).trim();
  const safeLimit = Math.min(10, Math.max(1, Number(limit) || 8));

  if (query.length < 3) {
    return res.status(200).json({ places: [], cache: false });
  }

  const cacheKey = `${query.toLowerCase()}|${safeLimit}`;
  const now = Date.now();
  const cached = nominatimSearchCache.get(cacheKey);

  if (cached && now - cached.cachedAt < NOMINATIM_SEARCH_CACHE_TTL_MS) {
    return res.status(200).json({ places: cached.places, cache: true });
  }

  try {
    await waitNominatimSlot();
    const response = await routingAxios.get(
      'https://nominatim.openstreetmap.org/search',
      {
        timeout: NOMINATIM_SEARCH_TIMEOUT_MS,
        params: {
          format: 'json',
          q: query,
          addressdetails: 1,
          limit: safeLimit,
        },
        headers: {
          'User-Agent': process.env.NOMINATIM_USER_AGENT || 'ai-travel-planner/1.0',
          Accept: 'application/json',
        },
        validateStatus: () => true,
      }
    );

    if (response.status === 429) {
      if (cached?.places?.length) {
        return res.status(200).json({
          places: cached.places,
          cache: true,
          warning: 'Search provider rate-limited; using cached results.',
        });
      }
      return res.status(200).json({
        places: [],
        cache: false,
        warning: 'Search provider rate-limited. Please retry in a moment.',
      });
    }

    if (response.status < 200 || response.status >= 300) {
      logErrorOncePerWindow(
        'places_search_http',
        `Error searching places: HTTP ${response.status}`
      );
      return res.status(200).json({ places: cached?.places || [], cache: Boolean(cached) });
    }

    const raw = Array.isArray(response.data) ? response.data : [];
    const places = raw
      .map((item) => ({
        display_name: item.display_name || '',
        lat: String(item.lat || ''),
        lon: String(item.lon || ''),
      }))
      .filter((item) => item.display_name && item.lat && item.lon);

    nominatimSearchCache.set(cacheKey, { places, cachedAt: now });
    return res.status(200).json({ places, cache: false });
  } catch (error) {
    logErrorOncePerWindow(
      'places_search_error',
      `Error searching places: ${error?.message || error?.code || 'unknown'}`
    );
    return res.status(200).json({ places: cached?.places || [], cache: Boolean(cached) });
  }
});

// Weather (Open-Meteo, free)
app.get('/api/weather', async (req, res) => {
  try {
    const { lat, lng } = req.query;
    if (!lat || !lng) {
      return res.status(400).json({ error: 'lat and lng are required' });
    }

    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,wind_speed_10m,weather_code&timezone=auto`;
    const response = await axios.get(url);
    res.status(200).json({
      current: response.data?.current || null,
    });
  } catch (error) {
    console.error('Error fetching weather:', error?.message || error);
    res.status(200).json({
      current: null,
      warning: 'Weather provider unavailable. Showing no data.',
    });
  }
});

// Route (OSRM, free)
app.get('/api/route', async (req, res) => {
  let points = [];
  let requestedProfile = 'driving';
  try {
    const { coords, profile = 'driving' } = req.query;
    requestedProfile = profile;
    if (!coords) {
      return res.status(400).json({ error: 'coords is required' });
    }
    points = coords
      .toString()
      .split('|')
      .map((pair) => pair.split(',').map((n) => Number(n)));
    if (points.length < 2 || points.some((p) => p.length !== 2 || p.some(Number.isNaN))) {
      return res.status(400).json({ error: 'coords must be lat,lng pairs' });
    }
    const result = await fetchRouteForPoints(points, profile);
    res.status(200).json({
      route: result.route,
      summary: result.summary,
      fallback: result.fallback,
      warning: result.warning,
    });
  } catch (error) {
    const approx =
      points.length >= 2
        ? buildApproxRoute(points, getSafeRouteProfile(requestedProfile))
        : null;
    if (approx) {
      return res.status(200).json({
        route: approx.route,
        summary: approx.summary,
        fallback: true,
        warning: 'Routing service timeout. Showing approximate route.',
      });
    }
    console.error(
      'Error fetching route:',
      error?.code || error?.message || error
    );
    res.status(500).json({ error: 'Failed to fetch route' });
  }
});

app.get('/api/travel-modes', async (req, res) => {
  try {
    const { originLat, originLng, destLat, destLng } = req.query;
    const origin = {
      lat: Number(originLat),
      lng: Number(originLng),
    };
    const destination = {
      lat: Number(destLat),
      lng: Number(destLng),
    };

    if (
      !Number.isFinite(origin.lat) ||
      !Number.isFinite(origin.lng) ||
      !Number.isFinite(destination.lat) ||
      !Number.isFinite(destination.lng)
    ) {
      return res.status(400).json({
        error: 'originLat, originLng, destLat and destLng are required',
      });
    }

    const payload = await fetchTravelModes(origin, destination);
    res.status(200).json(payload);
  } catch (error) {
    console.error(
      'Error fetching travel modes:',
      error?.message || error?.code || error
    );
    res.status(500).json({ error: 'Failed to fetch travel modes' });
  }
});

// Nearby places (Overpass, free)
app.get('/api/places/nearby', async (req, res) => {
  const { lat, lng, type = 'attraction', radius = 2000 } = req.query;
  const cacheKey = overpassCacheKey({ lat, lng, type, radius });
  const cached = overpassCache.get(cacheKey);
  const now = Date.now();

  if (cached && now - cached.cachedAt < OVERPASS_CACHE_TTL_MS) {
    return res.status(200).json({ places: cached.places, cache: true });
  }

  try {
    if (!lat || !lng) {
      return res.status(400).json({ error: 'lat and lng are required' });
    }

    const latNum = Number(lat);
    const lngNum = Number(lng);
    if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) {
      return res.status(400).json({ error: 'lat and lng must be valid numbers' });
    }

    const r = Math.min(Number(radius) || 2000, 10000);
    let filter = '["tourism"~"attraction|museum|viewpoint|zoo|theme_park"]';
    if (type === 'hotel') {
      filter = '["tourism"~"hotel|guest_house|hostel|resort|motel"]';
    } else if (type === 'restaurant') {
      filter = '["amenity"~"restaurant|cafe|fast_food"]';
    } else if (type === 'transport') {
      filter = '["amenity"~"bus_station|taxi|fuel|parking|ferry_terminal"]';
    }

    const query = `
[out:json][timeout:25];
(
  node${filter}(around:${r},${latNum},${lngNum});
  way${filter}(around:${r},${latNum},${lngNum});
  relation${filter}(around:${r},${latNum},${lngNum});
);
out center 30;
`;

    const elements = await fetchOverpassElements(query);
    const seen = new Set();
    const places = elements
      .map((el) => ({
        id: String(el.id),
        name: el.tags?.name || 'Unnamed place',
        address: buildOsmAddress(el.tags),
        category: type,
        lat: el.lat || el.center?.lat,
        lng: el.lon || el.center?.lon,
      }))
      .filter((p) => {
        if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return false;
        const key = `${(p.name || '').toLowerCase().trim()}|${p.lat.toFixed(4)}|${p.lng.toFixed(4)}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => {
        const da = haversineKm({ lat: latNum, lng: lngNum }, { lat: a.lat, lng: a.lng });
        const db = haversineKm({ lat: latNum, lng: lngNum }, { lat: b.lat, lng: b.lng });
        return da - db;
      })
      .slice(0, 40);

    overpassCache.set(cacheKey, { places, cachedAt: now });
    res.status(200).json({ places, cache: false });
  } catch (error) {
    const stale = overpassCache.get(cacheKey);
    logErrorOncePerWindow(
      'nearby_places',
      `Error fetching nearby places: ${error?.message || error?.code || 'unknown error'}`
    );

    if (stale?.places?.length) {
      return res.status(200).json({
        places: stale.places,
        cache: true,
        warning: 'Using cached nearby places due to provider rate limit.',
      });
    }

    res.status(200).json({
      places: [],
      warning: 'Nearby provider is rate-limited. Please retry in a minute.',
    });
  }
});

// Create Trip Endpoint
app.post('/api/trips', async (req, res) => {
  try {
    const {
      tripName,
      startDate,
      endDate,
      startDay,
      endDay,
      background,
      budget = 0,
      expenses = [],
      placesToVisit = [],
      itinerary = [],
      travelers = [],
      preferences = {
        travelMode: 'driving',
        startFromCurrentLocation: true,
      },
      manualPreferences = {},
      clerkUserId,
      userData = {},
    } = req.body;

    if (!clerkUserId) {
      return res.status(401).json({ error: 'User ID is required' });
    }
    if (!tripName || !startDate || !endDate || !startDay || !endDay || !background) {
      return res.status(400).json({ error: 'Missing required trip fields' });
    }

    let user = await User.findOne({ clerkUserId });
    if (!user) {
      const { email, name } = userData;
      if (!email) {
        return res.status(400).json({ error: 'User email is required' });
      }
      user = new User({ clerkUserId, email, name });
      await user.save();
    }

    const trip = new Trip({
      tripName,
      startDate,
      endDate,
      startDay,
      endDay,
      background,
      host: user._id,
      travelers: [user._id, ...travelers],
      budget,
      expenses,
      placesToVisit,
      itinerary,
      preferences,
      manualPreferences,
    });

    await trip.save();
    res.status(201).json({ message: 'Trip created successfully', trip });
  } catch (error) {
    console.error('Error creating trip:', error);
    res.status(500).json({ error: 'Failed to create trip' });
  }
});

// Get Trips for Current User Endpoint
app.get('/api/trips', async (req, res) => {
  try {
    const { clerkUserId, email } = req.query;
    if (!clerkUserId) {
      return res.status(401).json({ error: 'User ID is required' });
    }

    let user = await User.findOne({ clerkUserId });
    if (!user) {
      if (!email) {
        return res.status(400).json({ error: 'User email is required' });
      }
      user = new User({ clerkUserId, email: email.toString(), name: '' });
      await user.save();
    }

    const trips = await Trip.find({
      $or: [{ host: user._id }, { travelers: user._id }],
    }).populate('host travelers');
    res.status(200).json({ trips });
  } catch (error) {
    console.error('Error fetching trips:', error);
    res.status(500).json({ error: 'Failed to fetch trips' });
  }
});

// Get Single Trip Endpoint
app.get('/api/trips/:tripId', async (req, res) => {
  try {
    const { tripId } = req.params;
    const { clerkUserId } = req.query;

    if (!clerkUserId) {
      return res.status(401).json({ error: 'User ID is required' });
    }

    const user = await User.findOne({ clerkUserId });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const trip = await Trip.findById(tripId).populate('host travelers');
    if (!trip) {
      return res.status(404).json({ error: 'Trip not found' });
    }

    res.status(200).json({ trip });
  } catch (error) {
    console.error('Error fetching trip:', error);
    res.status(500).json({ error: 'Failed to fetch trip' });
  }
});

// Delete Trip Endpoint
app.delete('/api/trips/:tripId', async (req, res) => {
  try {
    const { tripId } = req.params;
    const { clerkUserId, email } = req.query;

    if (!clerkUserId) {
      return res.status(401).json({ error: 'User ID is required' });
    }

    let user = await User.findOne({ clerkUserId });
    if (!user) {
      if (!email) {
        return res.status(404).json({ error: 'User not found' });
      }
      user = await User.findOne({ email: email.toString() });
      if (!user) {
        user = new User({ clerkUserId, email: email.toString(), name: '' });
        await user.save();
      }
    }

    const trip = await Trip.findById(tripId);
    if (!trip) {
      return res.status(404).json({ error: 'Trip not found' });
    }

    const isHost = String(trip.host) === String(user._id);
    const isTraveler = (trip.travelers || []).some(
      (traveler) => String(traveler) === String(user._id)
    );

    if (!isHost && !isTraveler) {
      return res.status(403).json({ error: 'Not authorized to delete this trip' });
    }

    await Trip.findByIdAndDelete(tripId);
    res.status(200).json({ message: 'Trip deleted successfully' });
  } catch (error) {
    console.error('Error deleting trip:', error);
    res.status(500).json({ error: 'Failed to delete trip' });
  }
});

// Get Trip Flow Endpoint
app.get('/api/trips/:tripId/flow', async (req, res) => {
  try {
    const { tripId } = req.params;
    const { clerkUserId } = req.query;

    if (!clerkUserId) {
      return res.status(401).json({ error: 'User ID is required' });
    }

    const user = await User.findOne({ clerkUserId });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const trip = await Trip.findById(tripId);
    if (!trip) {
      return res.status(404).json({ error: 'Trip not found' });
    }

    const isHost = String(trip.host) === String(user._id);
    const isTraveler = (trip.travelers || []).some(
      (traveler) => String(traveler) === String(user._id)
    );
    if (!isHost && !isTraveler) {
      return res.status(403).json({ error: 'Not authorized to view this trip flow' });
    }

    res.status(200).json({ flow: trip.flow || [] });
  } catch (error) {
    console.error('Error fetching trip flow:', error);
    res.status(500).json({ error: 'Failed to fetch trip flow' });
  }
});

// Update Trip Flow Endpoint
app.put('/api/trips/:tripId/flow', async (req, res) => {
  try {
    const { tripId } = req.params;
    const { clerkUserId } = req.query;
    const { flow } = req.body;

    if (!clerkUserId) {
      return res.status(401).json({ error: 'User ID is required' });
    }
    if (!Array.isArray(flow)) {
      return res.status(400).json({ error: 'Flow must be an array' });
    }

    const user = await User.findOne({ clerkUserId });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const existingTrip = await Trip.findById(tripId);
    if (!existingTrip) {
      return res.status(404).json({ error: 'Trip not found' });
    }

    const isHost = String(existingTrip.host) === String(user._id);
    const isTraveler = (existingTrip.travelers || []).some(
      (traveler) => String(traveler) === String(user._id)
    );
    if (!isHost && !isTraveler) {
      return res.status(403).json({ error: 'Not authorized to update this trip flow' });
    }

    const trip = await Trip.findByIdAndUpdate(
      tripId,
      { flow },
      { new: true }
    );
    if (!trip) {
      return res.status(404).json({ error: 'Trip not found' });
    }

    res.status(200).json({ flow: trip.flow, trip });
  } catch (error) {
    console.error('Error updating trip flow:', error);
    res.status(500).json({ error: 'Failed to update trip flow' });
  }
});

// Optimize itinerary route for a specific date (free OSRM)
app.post('/api/trips/:tripId/itinerary/optimize', async (req, res) => {
  try {
    const { tripId } = req.params;
    const { clerkUserId } = req.query;
    const { date } = req.body;

    if (!clerkUserId) {
      return res.status(401).json({ error: 'User ID is required' });
    }
    if (!date) {
      return res.status(400).json({ error: 'date is required' });
    }

    const user = await User.findOne({ clerkUserId });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const trip = await Trip.findById(tripId);
    if (!trip) {
      return res.status(404).json({ error: 'Trip not found' });
    }

    const isHost = String(trip.host) === String(user._id);
    const isTraveler = (trip.travelers || []).some(
      (traveler) => String(traveler) === String(user._id)
    );
    if (!isHost && !isTraveler) {
      return res.status(403).json({ error: 'Not authorized to edit this trip' });
    }

    const dayIndex = (trip.itinerary || []).findIndex(
      (item) => String(item.date) === String(date)
    );
    if (dayIndex === -1) {
      return res.status(404).json({ error: 'Itinerary date not found' });
    }

    const activities = trip.itinerary[dayIndex]?.activities || [];
    if (activities.length <= 2) {
      return res.status(200).json({ trip, optimized: false });
    }

    const coords = activities
      .map((a) => a.geometry?.location)
      .filter((loc) => loc && Number.isFinite(loc.lat) && Number.isFinite(loc.lng))
      .map((loc) => `${loc.lng},${loc.lat}`)
      .join(';');

    let orderedActivities = activities;
    if (coords.split(';').length >= 2) {
      try {
        const mode = trip?.preferences?.travelMode || 'driving';
        const profile = ['driving', 'walking', 'cycling'].includes(mode)
          ? mode
          : 'driving';
        const url = `https://router.project-osrm.org/trip/v1/${profile}/${coords}?roundtrip=false&geometries=geojson`;
        const response = await getWithRetry(url, {}, 1);
        const waypoints = response.data?.waypoints || [];
        if (waypoints.length === activities.length) {
          const order = waypoints
            .map((wp, idx) => ({ idx, order: wp.waypoint_index }))
            .sort((a, b) => a.order - b.order)
            .map((o) => o.idx);
          orderedActivities = order.map((i) => activities[i]);
        } else {
          orderedActivities = orderByNearestNeighbor(activities);
        }
      } catch (err) {
        console.error('OSRM optimize fallback:', err?.code || err?.message || err);
        orderedActivities = orderByNearestNeighbor(activities);
      }
    }

    trip.itinerary[dayIndex].activities = orderedActivities;
    await trip.save();

    res.status(200).json({ trip, optimized: true });
  } catch (error) {
    console.error('Error optimizing itinerary:', error);
    res.status(500).json({ error: 'Failed to optimize itinerary' });
  }
});

// Add Place to Trip Endpoint
app.post('/api/trips/:tripId/places', async (req, res) => {
  try {
    const { tripId } = req.params;
    const { placeId } = req.body;
    const API_KEY = 'abc';
    if (!placeId) {
      return res.status(400).json({ error: 'Place ID is required' });
    }

    const trip = await Trip.findById(tripId);
    if (!trip) {
      return res.status(404).json({ error: 'Trip not found' });
    }

    const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&key=${API_KEY}`;
    const response = await axios.get(url);
    const { status, result: details } = response.data;

    if (status !== 'OK' || !details) {
      return res.status(400).json({ error: `Google Places API error: ${status}` });
    }

    const placeData = {
      name: details.name || 'Unknown Place',
      phoneNumber: details.formatted_phone_number || '',
      website: details.website || '',
      openingHours: details.opening_hours?.weekday_text || [],
      photos: details.photos?.map(
        photo => `https://maps.googleapis.com/maps/api/place/photo?maxwidth=400&photoreference=${photo.photo_reference}&key=${API_KEY}`
      ) || [],
      reviews: details.reviews?.map(review => ({
        authorName: review.author_name || 'Unknown',
        rating: review.rating || 0,
        text: review.text || '',
      })) || [],
      types: details.types || [],
      formatted_address: details.formatted_address || 'No address available',
      briefDescription:
        details?.editorial_summary?.overview?.slice(0, 200) + "..." ||
        details?.reviews?.[0]?.text?.slice(0, 200) + "..." ||
        `Located in ${details.address_components?.[2]?.long_name || details.formatted_address || "this area"}. A nice place to visit.`,
      geometry: {
        location: {
          lat: details.geometry?.location?.lat || 0,
          lng: details.geometry?.location?.lng || 0,
        },
        viewport: {
          northeast: {
            lat: details.geometry?.viewport?.northeast?.lat || 0,
            lng: details.geometry?.viewport?.northeast?.lng || 0,
          },
          southwest: {
            lat: details.geometry?.viewport?.southwest?.lat || 0,
            lng: details.geometry?.viewport?.southwest?.lng || 0,
          },
        },
      },
    };

    const updatedTrip = await Trip.findByIdAndUpdate(
      tripId,
      { $push: { placesToVisit: placeData } },
      { new: true }
    );

    res.status(200).json({ message: 'Place added successfully', trip: updatedTrip });
  } catch (error) {
    console.error('Error adding place to trip:', error);
    res.status(500).json({ error: 'Failed to add place to trip' });
  }
});

// Add Place to Itinerary Endpoint
app.post('/api/trips/:tripId/itinerary', async (req, res) => {
  try {
    const { tripId } = req.params;
    const { placeId, date, placeData } = req.body;
    const API_KEY = 'abc';

    if (!date) {
      return res.status(400).json({ error: 'Date is required' });
    }
    if (!placeId && !placeData) {
      return res.status(400).json({ error: 'Either placeId or placeData is required' });
    }

    const trip = await Trip.findById(tripId);
    if (!trip) {
      return res.status(404).json({ error: 'Trip not found' });
    }

    let activityData;

    if (placeData) {
      activityData = {
        date,
        name: placeData.name || 'Unknown Place',
        phoneNumber: placeData.phoneNumber || '',
        website: placeData.website || '',
        openingHours: placeData.openingHours || [],
        photos: placeData.photos || [],
        reviews: placeData.reviews || [],
        types: placeData.types || [],
        formatted_address: placeData.formatted_address || 'No address available',
        briefDescription: placeData.briefDescription || 'No description available',
        geometry: placeData.geometry || {
          location: { lat: 0, lng: 0 },
          viewport: {
            northeast: { lat: 0, lng: 0 },
            southwest: { lat: 0, lng: 0 },
          },
        },
      };
    } else {
      const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&key=${API_KEY}`;
      const response = await axios.get(url);
      const { status, result: details } = response.data;

      if (status !== 'OK' || !details) {
        return res.status(400).json({ error: `Google Places API error: ${status}` });
      }

      activityData = {
        date,
        name: details.name || 'Unknown Place',
        phoneNumber: details.formatted_phone_number || '',
        website: details.website || '',
        openingHours: details.opening_hours?.weekday_text || [],
        photos: details.photos?.map(
          photo => `https://maps.googleapis.com/maps/api/place/photo?maxwidth=400&photoreference=${photo.photo_reference}&key=${API_KEY}`
        ) || [],
        reviews: details.reviews?.map(review => ({
          authorName: review.author_name || 'Unknown',
          rating: review.rating || 0,
          text: review.text || '',
        })) || [],
        types: details.types || [],
        formatted_address: details.formatted_address || 'No address available',
        briefDescription:
          details?.editorial_summary?.overview?.slice(0, 200) + "..." ||
          details?.reviews?.[0]?.text?.slice(0, 200) + "..." ||
          `Located in ${details.address_components?.[2]?.long_name || details.formatted_address || "this area"}. A nice place to visit.`,
        geometry: {
          location: {
            lat: details.geometry?.location?.lat || 0,
            lng: details.geometry?.location?.lng || 0,
          },
          viewport: {
            northeast: {
              lat: details.geometry?.viewport?.northeast?.lat || 0,
              lng: details.geometry?.viewport?.northeast?.lng || 0,
            },
            southwest: {
              lat: details.geometry?.viewport?.southwest?.lat || 0,
              lng: details.geometry?.viewport?.southwest?.lng || 0,
            },
          },
        },
      };
    }

    const existingItinerary = trip.itinerary.find(item => item.date === date);
    let updatedTrip;
    if (existingItinerary) {
      updatedTrip = await Trip.findByIdAndUpdate(
        tripId,
        { $push: { 'itinerary.$[elem].activities': activityData } },
        { arrayFilters: [{ 'elem.date': date }], new: true }
      );
    } else {
      updatedTrip = await Trip.findByIdAndUpdate(
        tripId,
        { $push: { itinerary: { date, activities: [activityData] } } },
        { new: true }
      );
    }

    res.status(200).json({ message: 'Activity added to itinerary successfully', trip: updatedTrip });
  } catch (error) {
    console.error('Error adding activity to itinerary:', error);
    res.status(500).json({ error: 'Failed to add activity to itinerary' });
  }
});

// Send Email Endpoint
app.post('/api/send-email', async (req, res) => {
  try {
    const { email, subject, message } = req.body;

    if (!email || !subject || !message) {
      return res.status(400).json({ error: 'Email, subject, and message are required' });
    }

    const mailOptions = {
      from: 'sujananand0@gmail.com',
      to: email,
      subject: subject,
      text: message,
    };

    await transporter.sendMail(mailOptions);
    res.status(200).json({ message: 'Email sent successfully' });
  } catch (error) {
    console.error('Error sending email:', error);
    res.status(500).json({ error: 'Failed to send email' });
  }
});

// Start Server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

