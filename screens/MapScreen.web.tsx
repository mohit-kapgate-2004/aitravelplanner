import React, { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, ScrollView, TouchableOpacity, Image } from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import dayjs from "dayjs";
import axios from "axios";
import { Ionicons } from "@expo/vector-icons";
import { API_BASE_URL } from "../config/api";

type Activity = {
  _id?: string;
  name: string;
  formatted_address: string;
  photos?: string[];
  briefDescription?: string;
  estimatedDurationMinutes?: number;
  travelFromPreviousMinutes?: number;
  geometry: {
    location: {
      lat: number;
      lng: number;
    };
  };
};

type TravelMode = "driving" | "walking" | "cycling" | "transit";

type NearbyPlace = { id: string; name: string; lat: number; lng: number };

type RouteSummary = {
  distance: number;
  duration: number;
  legs: { distance: number; duration: number }[];
};

type Trip = {
  itinerary: {
    _id?: string;
    date: string;
    activities: Activity[];
  }[];
  preferences?: {
    travelMode?: TravelMode;
    startFromCurrentLocation?: boolean;
  };
};

type MapRouteParams = {
  MapScreen: {
    trip?: Trip;
    places?: Activity[];
  };
};

const DEFAULT_PLACE_IMAGE =
  "https://images.unsplash.com/photo-1501785888041-af3ef285b470?auto=format&fit=crop&w=900&q=80";

const sanitizePhotoUrl = (url?: string) => {
  if (!url || typeof url !== "string") return "";
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) return "";
  if (
    /maps\.googleapis\.com\/maps\/api\/place\/photo/i.test(trimmed) &&
    /[?&]key=abc(?:&|$)/i.test(trimmed)
  ) {
    return "";
  }
  return trimmed;
};

const getImageCandidates = (place: Activity) => {
  const list: string[] = [];
  for (const photo of place.photos || []) {
    const safe = sanitizePhotoUrl(photo);
    if (safe) list.push(safe);
  }
  list.push(
    `https://source.unsplash.com/900x600/?${encodeURIComponent(
      `${place.name} ${place.formatted_address || ""}`
    )}`
  );
  list.push(
    `https://picsum.photos/seed/${encodeURIComponent(
      `${place.name}-${place.formatted_address || ""}`
    )}/900/600`
  );
  list.push(DEFAULT_PLACE_IMAGE);
  return Array.from(new Set(list.filter(Boolean)));
};

const PlaceCardImage = ({ place, style }: { place: Activity; style: any }) => {
  const imageCandidates = useMemo(
    () => getImageCandidates(place),
    [place.name, place.formatted_address, JSON.stringify(place.photos || [])]
  );
  const [imageIndex, setImageIndex] = useState(0);

  useEffect(() => {
    setImageIndex(0);
  }, [imageCandidates.join("|")]);

  const uri =
    imageCandidates[Math.min(imageIndex, imageCandidates.length - 1)] ||
    DEFAULT_PLACE_IMAGE;

  return (
    <Image
      source={{ uri }}
      onError={() =>
        setImageIndex((prev) =>
          prev < imageCandidates.length - 1 ? prev + 1 : prev
        )
      }
      style={style}
      resizeMode="cover"
    />
  );
};

const weatherCodeLabel = (code?: number) => {
  const table: Record<number, string> = {
    0: "Clear",
    1: "Mainly clear",
    2: "Partly cloudy",
    3: "Overcast",
    45: "Fog",
    48: "Rime fog",
    51: "Light drizzle",
    53: "Drizzle",
    55: "Heavy drizzle",
    61: "Light rain",
    63: "Rain",
    65: "Heavy rain",
    71: "Light snow",
    73: "Snow",
    75: "Heavy snow",
    80: "Rain showers",
    95: "Thunderstorm",
  };
  return code !== undefined ? table[code] || "Weather" : "Weather";
};

const formatDuration = (seconds = 0) => {
  if (!Number.isFinite(seconds)) return "0m";
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.round((seconds % 3600) / 60);
  return hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
};

const formatDistance = (meters = 0) => {
  if (!Number.isFinite(meters)) return "0 km";
  const km = meters / 1000;
  return `${Math.round(km * 10) / 10} km`;
};

const formatMinutes = (minutes = 0) => {
  if (!Number.isFinite(minutes) || minutes <= 0) return "0 min";
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const hrs = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  return mins > 0 ? `${hrs}h ${mins}m` : `${hrs}h`;
};

const getGoogleMode = (mode: TravelMode) => {
  if (mode === "cycling") return "bicycling";
  return mode;
};

const getOsrmProfile = (mode: TravelMode) => {
  if (mode === "transit") return "driving";
  return mode;
};

const MapScreen = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<MapRouteParams, "MapScreen">>();
  const trip = route.params?.trip;
  const placesParam = route.params?.places || [];

  const [selectedDay, setSelectedDay] = useState("all");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [routePath, setRoutePath] = useState<{ latitude: number; longitude: number }[]>([]);
  const [routeSummary, setRouteSummary] = useState<RouteSummary | null>(null);
  const [travelMode, setTravelMode] = useState<TravelMode>(trip?.preferences?.travelMode || "driving");
  const [useCurrentLocation, setUseCurrentLocation] = useState(
    trip?.preferences?.startFromCurrentLocation ?? true
  );
  const [userLocation, setUserLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [locationStatus, setLocationStatus] = useState<"idle" | "loading" | "denied" | "ready">("idle");

  const [weather, setWeather] = useState<{
    temperature: number;
    windSpeed: number;
    code: number;
  } | null>(null);
  const [weatherLoading, setWeatherLoading] = useState(false);

  const [nearbyType, setNearbyType] = useState<
    "hotel" | "restaurant" | "attraction" | "transport" | null
  >(null);
  const [nearbyPlaces, setNearbyPlaces] = useState<NearbyPlace[]>([]);
  const [nearbyLoading, setNearbyLoading] = useState(false);

  const [mealStops, setMealStops] = useState<{ legIndex: number; places: NearbyPlace[] } | null>(null);
  const [hotelStops, setHotelStops] = useState<NearbyPlace[]>([]);
  const [smartLoading, setSmartLoading] = useState(false);
  const lastRouteFetchKeyRef = useRef("");
  const lastSmartStopsKeyRef = useRef("");

  const goBackSafe = () => {
    if (navigation?.canGoBack?.()) {
      navigation.goBack();
      return;
    }
    navigation.navigate("HomeMain");
  };

  const itineraryDays = useMemo(
    () =>
      trip?.itinerary
        ?.slice()
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()) || [],
    [trip?.itinerary]
  );

  const itineraryPlaces = useMemo(
    () =>
      selectedDay === "all"
        ? itineraryDays.flatMap((day) => day.activities || [])
        : itineraryDays.find((day) => dayjs(day.date).format("YYYY-MM-DD") === selectedDay)
            ?.activities || [],
    [itineraryDays, selectedDay]
  );

  const rawPlaces = useMemo(
    () => (itineraryDays.length > 0 ? itineraryPlaces : placesParam),
    [itineraryDays, itineraryPlaces, placesParam]
  );

  const places = useMemo(
    () =>
      rawPlaces.filter(
        (place) =>
          Number.isFinite(place?.geometry?.location?.lat) &&
          Number.isFinite(place?.geometry?.location?.lng)
      ),
    [rawPlaces]
  );

  const dayOptions = useMemo(
    () => Array.from(new Set(itineraryDays.map((day) => dayjs(day.date).format("YYYY-MM-DD")))),
    [itineraryDays]
  );

  const displayedDays = useMemo(
    () =>
      itineraryDays.length === 0
        ? ([{ date: "Stops", activities: places }] as any[])
        : selectedDay === "all"
        ? itineraryDays
        : itineraryDays.filter((day) => dayjs(day.date).format("YYYY-MM-DD") === selectedDay),
    [itineraryDays, places, selectedDay]
  );

  useEffect(() => {
    if (selectedDay !== "all" && !dayOptions.includes(selectedDay)) {
      setSelectedDay("all");
    }
  }, [dayOptions, selectedDay]);

  useEffect(() => {
    if (selectedIndex >= places.length) {
      setSelectedIndex(0);
    }
  }, [places.length, selectedIndex]);

  const activePlace = places[selectedIndex] || places[0];

  const routeCoordinates = useMemo(
    () => places.map((p) => ({ latitude: p.geometry.location.lat, longitude: p.geometry.location.lng })),
    [places]
  );

  const routePoints = useMemo(() => {
    if (useCurrentLocation && userLocation) {
      return [userLocation, ...routeCoordinates];
    }
    return routeCoordinates;
  }, [useCurrentLocation, userLocation, routeCoordinates]);

  const routePointsKey = useMemo(
    () => routePoints.map((p) => `${p.latitude.toFixed(5)},${p.longitude.toFixed(5)}`).join("|"),
    [routePoints]
  );

  const legSummaries = useMemo(() => {
    const legs = routeSummary?.legs || [];
    if (!legs.length || routePoints.length < 2) return [];
    return legs
      .map((leg, index) => ({
        index,
        distance: leg.distance,
        duration: leg.duration,
        from: routePoints[index],
        to: routePoints[index + 1],
      }))
      .filter((leg) => leg.from && leg.to);
  }, [routeSummary, routePoints]);

  const firstLeg = legSummaries[0];

  const webMapHtml = useMemo(() => {
    const polyPoints = routePath.length > 1 ? routePath : routePoints;
    if (!polyPoints.length) return null;
    const polyJson = JSON.stringify(polyPoints.map((p) => [p.latitude, p.longitude]));
    const markerJson = JSON.stringify(routeCoordinates.map((p) => [p.latitude, p.longitude]));
    const userJson = userLocation
      ? JSON.stringify([userLocation.latitude, userLocation.longitude])
      : "null";
    return `
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link
      rel="stylesheet"
      href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
      integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY="
      crossorigin=""
    />
    <style>
      html, body, #map { height: 100%; margin: 0; }
    </style>
  </head>
  <body>
    <div id="map"></div>
    <script
      src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"
      integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo="
      crossorigin=""
    ></script>
    <script>
      const poly = ${polyJson};
      const markers = ${markerJson};
      const userLoc = ${userJson};
      const map = L.map('map');
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap'
      }).addTo(map);
      if (poly.length) {
        const line = L.polyline(poly, { color: '#2563EB', weight: 4 }).addTo(map);
        map.fitBounds(line.getBounds(), { padding: [20, 20] });
      } else if (markers.length) {
        map.setView(markers[0], 12);
      }
      markers.forEach((m, idx) => {
        L.marker(m).addTo(map).bindTooltip(String(idx + 1), {
          permanent: true,
          direction: 'top',
          offset: [0, -10]
        });
      });
      if (userLoc) {
        L.marker(userLoc, { title: 'You' }).addTo(map).bindTooltip('You', {
          permanent: true,
          direction: 'top',
          offset: [0, -10]
        });
      }
    </script>
  </body>
</html>
    `.trim();
  }, [routeCoordinates, routePath, routePoints, userLocation]);

  const requestLocation = async () => {
    try {
      setLocationStatus("loading");
      if (!navigator.geolocation) {
        setLocationStatus("denied");
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setUserLocation({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
          });
          setLocationStatus("ready");
        },
        () => setLocationStatus("denied"),
        { enableHighAccuracy: true, timeout: 8000 }
      );
    } catch (err) {
      setLocationStatus("denied");
    }
  };

  const fetchRoute = async () => {
    if (routePoints.length < 2) {
      setRoutePath([]);
      setRouteSummary(null);
      return;
    }
    try {
      const coords = routePoints.map((p) => `${p.latitude},${p.longitude}`).join("|");
      const response = await axios.get(`${API_BASE_URL}/api/route`, {
        params: { coords, profile: getOsrmProfile(travelMode) },
      });
      const routeCoords = response.data?.route?.coordinates || [];
      const decoded = routeCoords.map((pair: number[]) => ({
        latitude: pair[1],
        longitude: pair[0],
      }));
      setRoutePath(decoded.length > 1 ? decoded : []);
      setRouteSummary(response.data?.summary || null);
    } catch (err) {
      setRoutePath([]);
      setRouteSummary(null);
    }
  };

  const fetchWeather = async (place?: Activity) => {
    const target = place || activePlace;
    if (!target) return;
    try {
      setWeatherLoading(true);
      const response = await axios.get(`${API_BASE_URL}/api/weather`, {
        params: {
          lat: target.geometry.location.lat,
          lng: target.geometry.location.lng,
        },
      });
      const current = response.data?.current;
      if (current) {
        setWeather({
          temperature: current.temperature_2m,
          windSpeed: current.wind_speed_10m,
          code: current.weather_code,
        });
      }
    } catch (err) {
      setWeather(null);
    } finally {
      setWeatherLoading(false);
    }
  };

  const fetchNearby = async (
    type: "hotel" | "restaurant" | "attraction" | "transport",
    place?: Activity,
    radius: number = 3000
  ) => {
    const target = place || activePlace;
    if (!target) return;
    try {
      setNearbyLoading(true);
      setNearbyType(type);
      const response = await axios.get(`${API_BASE_URL}/api/places/nearby`, {
        params: {
          lat: target.geometry.location.lat,
          lng: target.geometry.location.lng,
          type,
          radius,
        },
      });
      setNearbyPlaces(response.data?.places || []);
    } catch (err) {
      setNearbyPlaces([]);
    } finally {
      setNearbyLoading(false);
    }
  };

  const fetchSmartStops = async () => {
    if (smartLoading) return;
    if (!legSummaries.length) {
      setMealStops(null);
      setHotelStops([]);
      return;
    }

    const longLeg = legSummaries.find((leg) => leg.duration >= 3 * 3600);
    if (!longLeg) {
      setMealStops(null);
      setHotelStops([]);
      return;
    }

    try {
      setSmartLoading(true);
      const midpoint = {
        latitude: (longLeg.from.latitude + longLeg.to.latitude) / 2,
        longitude: (longLeg.from.longitude + longLeg.to.longitude) / 2,
      };

      const mealRes = await axios.get(`${API_BASE_URL}/api/places/nearby`, {
        params: {
          lat: midpoint.latitude,
          lng: midpoint.longitude,
          type: "restaurant",
          radius: 6000,
        },
      });
      setMealStops({ legIndex: longLeg.index, places: (mealRes.data?.places || []).slice(0, 5) });

      if (longLeg.duration >= 6 * 3600) {
        const hotelRes = await axios.get(`${API_BASE_URL}/api/places/nearby`, {
          params: {
            lat: longLeg.to.latitude,
            lng: longLeg.to.longitude,
            type: "hotel",
            radius: 7000,
          },
        });
        setHotelStops((hotelRes.data?.places || []).slice(0, 5));
      } else {
        setHotelStops([]);
      }
    } catch (err) {
      setMealStops(null);
      setHotelStops([]);
    } finally {
      setSmartLoading(false);
    }
  };

  const openInMaps = () => {
    if (routePoints.length < 2) return;
    const origin = `${routePoints[0].latitude},${routePoints[0].longitude}`;
    const destination = `${routePoints[routePoints.length - 1].latitude},${
      routePoints[routePoints.length - 1].longitude
    }`;
    const waypoints = routePoints
      .slice(1, -1)
      .map((p) => `${p.latitude},${p.longitude}`)
      .join("|");
    const url = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}${
      waypoints ? `&waypoints=${waypoints}` : ""
    }&travelmode=${getGoogleMode(travelMode)}`;
    window.open(url, "_blank");
  };

  useEffect(() => {
    const routeKey = `${travelMode}|${routePointsKey}`;
    if (!routePointsKey || lastRouteFetchKeyRef.current === routeKey) return;
    lastRouteFetchKeyRef.current = routeKey;
    fetchRoute();
  }, [travelMode, routePointsKey]);

  useEffect(() => {
    const smartKey = `${routePointsKey}|${routeSummary?.distance || 0}|${
      routeSummary?.duration || 0
    }`;
    if (!routePointsKey || lastSmartStopsKeyRef.current === smartKey) return;
    lastSmartStopsKeyRef.current = smartKey;
    fetchSmartStops();
  }, [routePointsKey, routeSummary?.distance, routeSummary?.duration]);

  useEffect(() => {
    if (activePlace) {
      fetchWeather(activePlace);
    }
  }, [activePlace?.geometry?.location?.lat, activePlace?.geometry?.location?.lng]);

  useEffect(() => {
    if (useCurrentLocation) {
      requestLocation();
    }
  }, [useCurrentLocation]);

  const totalDistance = routeSummary?.distance || 0;
  const totalDuration = routeSummary?.duration || 0;

  return (
    <View style={{ flex: 1, backgroundColor: "#fff" }}>
      <View
        style={{
          position: "absolute",
          top: 12,
          left: 12,
          zIndex: 50,
        }}
      >
        <TouchableOpacity
          onPress={goBackSafe}
          style={{
            flexDirection: "row",
            alignItems: "center",
            backgroundColor: "rgba(17, 24, 39, 0.86)",
            borderRadius: 999,
            paddingHorizontal: 12,
            paddingVertical: 7,
          }}
        >
          <Ionicons name="arrow-back" size={14} color="#fff" />
          <Text
            style={{
              marginLeft: 6,
              fontSize: 12,
              fontWeight: "600",
              color: "#fff",
            }}
          >
            Back
          </Text>
        </TouchableOpacity>
      </View>
      <View style={{ flex: 1, flexDirection: "row" }}>
        <View style={{ width: "52%", borderRightWidth: 1, borderRightColor: "#e5e7eb" }}>
          <View style={{ padding: 12, borderBottomWidth: 1, borderBottomColor: "#e5e7eb" }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Text style={{ fontSize: 14, fontWeight: "600", color: "#111827" }}>
                {places.length} stops | {formatDistance(totalDistance)} | {formatDuration(totalDuration)}
              </Text>
            </View>
            {dayOptions.length > 0 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }}>
                <TouchableOpacity
                  onPress={() => setSelectedDay("all")}
                  style={{
                    paddingHorizontal: 12,
                    paddingVertical: 6,
                    borderRadius: 999,
                    marginRight: 8,
                    backgroundColor: selectedDay === "all" ? "#111827" : "#fff",
                    borderWidth: 1,
                    borderColor: selectedDay === "all" ? "#111827" : "#e5e7eb",
                  }}
                >
                  <Text style={{ fontSize: 12, color: selectedDay === "all" ? "#fff" : "#374151" }}>
                    All
                  </Text>
                </TouchableOpacity>
                {dayOptions.map((day) => (
                  <TouchableOpacity
                    key={day}
                    onPress={() => setSelectedDay(day)}
                    style={{
                      paddingHorizontal: 12,
                      paddingVertical: 6,
                      borderRadius: 999,
                      marginRight: 8,
                      backgroundColor: selectedDay === day ? "#111827" : "#fff",
                      borderWidth: 1,
                      borderColor: selectedDay === day ? "#111827" : "#e5e7eb",
                    }}
                  >
                    <Text style={{ fontSize: 12, color: selectedDay === day ? "#fff" : "#374151" }}>
                      {dayjs(day).format("ddd D")}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
          </View>

          <ScrollView style={{ flex: 1, padding: 12 }}>
            {displayedDays.map((day: any, idx: number) => {
              const dayActivities = day.activities || [];
              const dayMinutes = dayActivities.reduce(
                (sum: number, act: Activity) =>
                  sum +
                  (act.estimatedDurationMinutes || 90) +
                  (act.travelFromPreviousMinutes || 0),
                0
              );

              return (
                <View key={`${day.date}-${idx}`} style={{ marginBottom: 16 }}>
                  <Text style={{ fontSize: 13, fontWeight: "700", color: "#111827", marginBottom: 8 }}>
                    {day.date === "Stops"
                      ? "Stops"
                      : `${dayjs(day.date).format("ddd, MMM D")} • ${dayActivities.length} places • ~${formatMinutes(
                          dayMinutes
                        )}`}
                  </Text>

                  {dayActivities.map((place: Activity, pIdx: number) => {
                    const placeIndex = places.findIndex((p) => p.name === place.name);
                    const isActive = placeIndex === selectedIndex;
                    const stopMinutes = place.estimatedDurationMinutes || 90;
                    const travelMinutes = place.travelFromPreviousMinutes || 0;

                    return (
                      <TouchableOpacity
                        key={`${place.name}-${pIdx}`}
                        onPress={() => setSelectedIndex(placeIndex >= 0 ? placeIndex : 0)}
                        style={{
                          borderRadius: 12,
                          borderWidth: 1,
                          borderColor: isActive ? "#3B82F6" : "#e5e7eb",
                          backgroundColor: isActive ? "#eff6ff" : "#fff",
                          marginBottom: 10,
                          padding: 10,
                        }}
                      >
                        <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
                          <View style={{ flex: 1, paddingRight: 10 }}>
                            <Text style={{ fontSize: 14, fontWeight: "700", color: "#111827" }}>
                              {pIdx + 1}. {place.name}
                            </Text>
                            {place.briefDescription ? (
                              <Text style={{ fontSize: 12, color: "#4b5563", marginTop: 4 }} numberOfLines={2}>
                                {place.briefDescription}
                              </Text>
                            ) : null}
                            <Text style={{ fontSize: 11, color: "#6b7280", marginTop: 6 }}>
                              ~{formatMinutes(stopMinutes)}
                              {travelMinutes > 0
                                ? ` • travel ~${formatMinutes(travelMinutes)}`
                                : ""}
                            </Text>
                            <Text style={{ fontSize: 11, color: "#6b7280", marginTop: 3 }} numberOfLines={1}>
                              {place.formatted_address}
                            </Text>
                          </View>
                          <PlaceCardImage
                            place={place}
                            style={{
                              width: 96,
                              height: 78,
                              borderRadius: 8,
                              backgroundColor: "#e5e7eb",
                            }}
                          />
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              );
            })}
          </ScrollView>
        </View>

        <View style={{ flex: 1 }}>
          <View style={{ padding: 12, borderBottomWidth: 1, borderBottomColor: "#e5e7eb" }}>
            <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
              {([
                { id: "driving", label: "Car" },
                { id: "walking", label: "Walk" },
                { id: "cycling", label: "Bike" },
                { id: "transit", label: "Transit" },
              ] as const).map((mode) => (
                <TouchableOpacity
                  key={mode.id}
                  onPress={() => setTravelMode(mode.id)}
                  style={{
                    paddingHorizontal: 10,
                    paddingVertical: 6,
                    borderRadius: 999,
                    marginRight: 8,
                    marginBottom: 8,
                    borderWidth: 1,
                    borderColor: travelMode === mode.id ? "#111827" : "#e5e7eb",
                    backgroundColor: travelMode === mode.id ? "#111827" : "#fff",
                  }}
                >
                  <Text style={{ fontSize: 12, color: travelMode === mode.id ? "#fff" : "#374151" }}>
                    {mode.label}
                  </Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity
                onPress={() => setUseCurrentLocation((prev) => !prev)}
                style={{
                  paddingHorizontal: 10,
                  paddingVertical: 6,
                  borderRadius: 999,
                  marginRight: 8,
                  marginBottom: 8,
                  borderWidth: 1,
                  borderColor: useCurrentLocation ? "#0EA5E9" : "#e5e7eb",
                  backgroundColor: useCurrentLocation ? "#0EA5E9" : "#fff",
                }}
              >
                <Text style={{ fontSize: 12, color: useCurrentLocation ? "#fff" : "#374151" }}>
                  {useCurrentLocation ? "Start From Me" : "Start From Stop 1"}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={openInMaps}
                style={{
                  paddingHorizontal: 10,
                  paddingVertical: 6,
                  borderRadius: 999,
                  marginRight: 8,
                  marginBottom: 8,
                  backgroundColor: "#2563EB",
                }}
              >
                <Text style={{ fontSize: 12, color: "#fff", fontWeight: "600" }}>Open Maps</Text>
              </TouchableOpacity>
              {useCurrentLocation && locationStatus === "denied" && (
                <Text style={{ fontSize: 12, color: "#ef4444" }}>Location permission denied</Text>
              )}
            </View>
            <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
              <TouchableOpacity
                onPress={() => fetchNearby("hotel")}
                style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: "#10B981", marginRight: 8, marginBottom: 8 }}
              >
                <Text style={{ fontSize: 12, color: "#fff", fontWeight: "600" }}>Hotels Near Stop</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => fetchNearby("restaurant")}
                style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: "#F59E0B", marginRight: 8, marginBottom: 8 }}
              >
                <Text style={{ fontSize: 12, color: "#fff", fontWeight: "600" }}>Restaurants Near Stop</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => fetchNearby("transport")}
                style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: "#4F46E5", marginRight: 8, marginBottom: 8 }}
              >
                <Text style={{ fontSize: 12, color: "#fff", fontWeight: "600" }}>Transport Near Stop</Text>
              </TouchableOpacity>
            </View>

            {firstLeg && (
              <View style={{ marginTop: 8 }}>
                <Text style={{ fontSize: 12, color: "#6b7280" }}>
                  First leg {useCurrentLocation ? "(from current location)" : ""}
                </Text>
                <Text style={{ fontSize: 12, color: "#111827" }}>
                  {formatDistance(firstLeg.distance)} | {formatDuration(firstLeg.duration)}
                </Text>
              </View>
            )}

            {(weather || weatherLoading) && (
              <View style={{ marginTop: 8 }}>
                <Text style={{ fontSize: 12, color: "#6b7280" }}>
                  Weather near {activePlace?.name || "this stop"}
                </Text>
                {weatherLoading ? (
                  <Text style={{ fontSize: 12, color: "#374151" }}>Loading...</Text>
                ) : weather ? (
                  <Text style={{ fontSize: 12, color: "#111827" }}>
                    {weather.temperature} C | {weatherCodeLabel(weather.code)} | Wind {weather.windSpeed} km/h
                  </Text>
                ) : (
                  <Text style={{ fontSize: 12, color: "#6b7280" }}>Weather unavailable</Text>
                )}
              </View>
            )}

            {nearbyType && (
              <View style={{ marginTop: 8 }}>
                <Text style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>
                  Nearby {nearbyType}s
                </Text>
                {nearbyLoading ? (
                  <Text style={{ fontSize: 12, color: "#374151" }}>Loading...</Text>
                ) : nearbyPlaces.length > 0 ? (
                  nearbyPlaces.slice(0, 3).map((item) => (
                    <Text key={item.id} style={{ fontSize: 12, color: "#111827" }}>
                      {item.name}
                    </Text>
                  ))
                ) : (
                  <Text style={{ fontSize: 12, color: "#6b7280" }}>No nearby results</Text>
                )}
              </View>
            )}

            {(smartLoading || mealStops || hotelStops.length > 0) && (
              <View style={{ marginTop: 8 }}>
                <Text style={{ fontSize: 12, color: "#6b7280" }}>Smart travel breaks</Text>
                {smartLoading ? (
                  <Text style={{ fontSize: 12, color: "#374151" }}>Finding meal/hotel stops...</Text>
                ) : (
                  <>
                    {mealStops?.places?.[0] && (
                      <Text style={{ fontSize: 12, color: "#111827" }}>
                        Meal stop suggestion: {mealStops.places[0].name}
                      </Text>
                    )}
                    {hotelStops[0] && (
                      <Text style={{ fontSize: 12, color: "#111827" }}>
                        Stay suggestion: {hotelStops[0].name}
                      </Text>
                    )}
                  </>
                )}
              </View>
            )}
          </View>

          <View style={{ padding: 12, flex: 1 }}>
            <View style={{ flex: 1, borderRadius: 16, borderWidth: 1, borderColor: "#e5e7eb", overflow: "hidden", backgroundColor: "#f9fafb" }}>
              {webMapHtml ? (
                React.createElement("iframe", {
                  srcDoc: webMapHtml,
                  width: "100%",
                  height: "100%",
                  style: { border: 0 },
                  sandbox: "allow-scripts allow-same-origin",
                })
              ) : (
                <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
                  <Text style={{ fontSize: 12, color: "#6b7280" }}>No map preview available</Text>
                </View>
              )}
            </View>
          </View>
        </View>
      </View>
    </View>
  );
};

export default MapScreen;

