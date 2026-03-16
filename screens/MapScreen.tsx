import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  FlatList,
  Dimensions,
  Image,
  TouchableOpacity,
  Platform,
  ScrollView,
  Linking,
  NativeScrollEvent,
  NativeSyntheticEvent,
} from "react-native";
import MapView, { Marker, Polyline, Region, UrlTile } from "react-native-maps";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import dayjs from "dayjs";
import axios from "axios";
import * as Location from "expo-location";
import { API_BASE_URL } from "../config/api";

const { width } = Dimensions.get("window");
const CARD_WIDTH = width * 0.8;
const SPACING = 12;

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

type NearbyPlace = {
  id: string;
  name: string;
  lat: number;
  lng: number;
};

type RouteSummary = {
  distance: number;
  duration: number;
  legs: { distance: number; duration: number }[];
};

type TravelMode = "driving" | "walking" | "cycling" | "transit";

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

const toRadians = (value: number) => (value * Math.PI) / 180;

const haversineKm = (
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number }
) => {
  const R = 6371;
  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLon / 2) *
      Math.sin(dLon / 2) *
      Math.cos(lat1) *
      Math.cos(lat2);
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return R * c;
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
  const [showRoute, setShowRoute] = useState(true);
  const [travelMode, setTravelMode] = useState<TravelMode>(
    trip?.preferences?.travelMode || "driving"
  );
  const [useCurrentLocation, setUseCurrentLocation] = useState(
    trip?.preferences?.startFromCurrentLocation ?? true
  );
  const [userLocation, setUserLocation] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const [locationStatus, setLocationStatus] = useState<
    "idle" | "loading" | "denied" | "ready"
  >("idle");

  const [routePath, setRoutePath] = useState<
    { latitude: number; longitude: number }[]
  >([]);
  const [routeSummary, setRouteSummary] = useState<RouteSummary | null>(null);

  const [weather, setWeather] = useState<{
    temperature: number;
    windSpeed: number;
    code: number;
  } | null>(null);
  const [weatherLoading, setWeatherLoading] = useState(false);

  const [nearbyLoading, setNearbyLoading] = useState(false);
  const [nearbyType, setNearbyType] = useState<
    "hotel" | "restaurant" | "attraction" | "transport" | null
  >(null);
  const [nearbyPlaces, setNearbyPlaces] = useState<NearbyPlace[]>([]);

  const [mealStops, setMealStops] = useState<{
    legIndex: number;
    places: NearbyPlace[];
  } | null>(null);
  const [hotelStops, setHotelStops] = useState<NearbyPlace[]>([]);
  const [smartLoading, setSmartLoading] = useState(false);
  const [imageFallbackIndex, setImageFallbackIndex] = useState<Record<string, number>>({});
  const lastRouteFetchKeyRef = useRef("");
  const lastSmartStopsKeyRef = useRef("");

  const mapRef = useRef<MapView>(null);
  const flatListRef = useRef<FlatList>(null);

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
        : itineraryDays.find(
            (day) => dayjs(day.date).format("YYYY-MM-DD") === selectedDay
          )?.activities || [],
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

  const activePlace = places[selectedIndex] || places[0];

  const dayOptions = useMemo(
    () => Array.from(new Set(itineraryDays.map((day) => dayjs(day.date).format("YYYY-MM-DD")))),
    [itineraryDays]
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

  const routeCoordinates = useMemo(
    () =>
      places.map((place) => ({
        latitude: place.geometry.location.lat,
        longitude: place.geometry.location.lng,
      })),
    [places]
  );

  const routePoints = useMemo(() => {
    if (useCurrentLocation && userLocation) {
      return [userLocation, ...routeCoordinates];
    }
    return routeCoordinates;
  }, [routeCoordinates, useCurrentLocation, userLocation]);

  const routePointsKey = useMemo(
    () => routePoints.map((p) => `${p.latitude.toFixed(5)},${p.longitude.toFixed(5)}`).join("|"),
    [routePoints]
  );

  const fallbackDistanceKm = routePoints.reduce((sum, point, index) => {
    if (index === 0) return sum;
    return sum + haversineKm(routePoints[index - 1], point);
  }, 0);

  const totalDistanceKm = routeSummary?.distance
    ? routeSummary.distance / 1000
    : fallbackDistanceKm;
  const totalDurationSec = routeSummary?.duration || (totalDistanceKm / 40) * 3600;

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

  const getPlaceImage = (place: Activity, key: string) => {
    const candidates = getImageCandidates(place);
    const index = Math.min(
      imageFallbackIndex[key] || 0,
      Math.max(0, candidates.length - 1)
    );
    return candidates[index] || DEFAULT_PLACE_IMAGE;
  };

  const requestLocation = async () => {
    try {
      setLocationStatus("loading");
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        setLocationStatus("denied");
        return;
      }

      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      setUserLocation({
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
      });
      setLocationStatus("ready");
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
      const coords = routePoints
        .map((point) => `${point.latitude},${point.longitude}`)
        .join("|");
      const response = await axios.get(`${API_BASE_URL}/api/route`, {
        params: {
          coords,
          profile: getOsrmProfile(travelMode),
        },
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

      const meals = (mealRes.data?.places || []).slice(0, 5);
      setMealStops({ legIndex: longLeg.index, places: meals });

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

    const googleMode = getGoogleMode(travelMode);
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
    }&travelmode=${googleMode}`;
    Linking.openURL(url);
  };

  const openRouteFromCurrentLocation = () => {
    if (!routeCoordinates.length) return;

    const googleMode = getGoogleMode(travelMode);
    const destination = `${
      routeCoordinates[routeCoordinates.length - 1].latitude
    },${routeCoordinates[routeCoordinates.length - 1].longitude}`;
    const waypoints = routeCoordinates
      .slice(0, -1)
      .map((p) => `${p.latitude},${p.longitude}`)
      .join("|");

    const url = `https://www.google.com/maps/dir/?api=1&origin=Current+Location&destination=${destination}${
      waypoints ? `&waypoints=${waypoints}` : ""
    }&travelmode=${googleMode}`;
    Linking.openURL(url);
  };

  const openNearbySearch = (
    kind: "hotels" | "restaurants",
    place?: Activity
  ) => {
    const target = place || activePlace;
    const query = target
      ? `${kind} near ${target.geometry.location.lat},${target.geometry.location.lng}`
      : `${kind} near me`;
    const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
      query
    )}`;
    Linking.openURL(url);
  };

  const openNearbyFromCurrentLocation = (kind: "hotels" | "restaurants") => {
    const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
      `${kind} near me`
    )}`;
    Linking.openURL(url);
  };

  const moveToRegion = (place: Activity) => {
    const region: Region = {
      latitude: place.geometry.location.lat,
      longitude: place.geometry.location.lng,
      latitudeDelta: 0.05,
      longitudeDelta: 0.05,
    };
    mapRef.current?.animateToRegion(region, 350);
  };

  const onMarkerPress = (index: number) => {
    setSelectedIndex(index);
    flatListRef.current?.scrollToIndex({
      index,
      animated: true,
      viewPosition: 0.5,
    });
    moveToRegion(places[index]);
  };

  const onCardScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const index = Math.round(e.nativeEvent.contentOffset.x / (CARD_WIDTH + SPACING));
    if (index !== selectedIndex && places[index]) {
      setSelectedIndex(index);
      moveToRegion(places[index]);
    }
  };

  const fitToRoute = () => {
    const coords = routePath.length > 1 ? routePath : routePoints;
    if (coords.length > 0 && mapRef.current) {
      mapRef.current.fitToCoordinates(coords, {
        edgePadding: { top: 120, right: 120, bottom: 240, left: 120 },
        animated: true,
      });
    }
  };

  useEffect(() => {
    if (useCurrentLocation) {
      requestLocation();
    }
  }, [useCurrentLocation]);

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
    fitToRoute();
  }, [routePath.length, routePoints.length]);

  if (!places.length) {
    return (
      <View className="flex-1 items-center justify-center bg-white">
        <TouchableOpacity
          onPress={goBackSafe}
          className="absolute top-6 left-4 bg-white px-3 py-2 rounded-full shadow"
        >
          <Ionicons name="chevron-back" size={18} color="#111" />
        </TouchableOpacity>
        <Text className="text-gray-700">No places to show on map</Text>
      </View>
    );
  }

  return (
    <View className="flex-1">
      <MapView
        ref={mapRef}
        style={{ flex: 1 }}
        mapType={Platform.OS === "android" ? "none" : "standard"}
        initialRegion={{
          latitude: places[0].geometry.location.lat,
          longitude: places[0].geometry.location.lng,
          latitudeDelta: 1,
          longitudeDelta: 1,
        }}
      >
        <UrlTile
          urlTemplate="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          maximumZ={19}
        />

        {showRoute && routePoints.length > 1 && (
          <Polyline
            coordinates={routePath.length > 1 ? routePath : routePoints}
            strokeColor="#2563EB"
            strokeWidth={4}
          />
        )}

        {places.map((place, index) => (
          <Marker
            key={place._id || `${place.name}-${index}`}
            coordinate={{
              latitude: place.geometry.location.lat,
              longitude: place.geometry.location.lng,
            }}
            onPress={() => onMarkerPress(index)}
            title={place.name}
            description={place.formatted_address}
          >
            <View
              style={{
                backgroundColor:
                  index === 0
                    ? "#16A34A"
                    : index === places.length - 1
                    ? "#DC2626"
                    : index === selectedIndex
                    ? "#2563EB"
                    : "#6B7280",
                padding: index === selectedIndex ? 10 : 8,
                borderRadius: 999,
                borderWidth: 2,
                borderColor: "#fff",
                minWidth: 28,
                alignItems: "center",
              }}
            >
              <Text className="text-white text-xs font-bold">{index + 1}</Text>
            </View>
          </Marker>
        ))}

        {useCurrentLocation && userLocation && (
          <Marker
            coordinate={userLocation}
            pinColor="#0284C7"
            title="You"
            description="Current location"
          />
        )}

        {nearbyPlaces.map((place, index) => (
          <Marker
            key={`nearby-${place.id}-${index}`}
            coordinate={{ latitude: place.lat, longitude: place.lng }}
            pinColor={
              nearbyType === "hotel"
                ? "#10B981"
                : nearbyType === "transport"
                ? "#6366F1"
                : "#F59E0B"
            }
            title={place.name}
            description={`Nearby ${nearbyType || "place"}`}
          />
        ))}
      </MapView>

      <View className="absolute top-4 left-4 right-4">
        <View className="bg-white/95 rounded-2xl px-4 py-3 shadow">
          <View className="flex-row items-center justify-between">
            <View>
              <Text className="text-xs text-gray-500">Trip route</Text>
              <Text className="text-sm font-semibold text-gray-900">
                {places.length} stops | {Math.round(totalDistanceKm * 10) / 10} km |{" "}
                {formatDuration(totalDurationSec)}
              </Text>
            </View>
            <TouchableOpacity
              onPress={goBackSafe}
              className="p-2 rounded-full bg-white border border-gray-200"
            >
              <Ionicons name="chevron-back" size={16} color="#111" />
            </TouchableOpacity>
          </View>

          <View className="flex-row items-center flex-wrap mt-3">
            {[
              { id: "driving", label: "Car" },
              { id: "walking", label: "Walk" },
              { id: "cycling", label: "Bike" },
              { id: "transit", label: "Transit" },
            ].map((mode) => (
              <TouchableOpacity
                key={mode.id}
                onPress={() => setTravelMode(mode.id as TravelMode)}
                className={`px-3 py-1.5 rounded-full mr-2 mb-2 border ${
                  travelMode === mode.id
                    ? "bg-black border-black"
                    : "bg-white border-gray-200"
                }`}
              >
                <Text
                  className={`text-xs font-semibold ${
                    travelMode === mode.id ? "text-white" : "text-gray-700"
                  }`}
                >
                  {mode.label}
                </Text>
              </TouchableOpacity>
            ))}

            <TouchableOpacity
              onPress={() => setUseCurrentLocation((prev) => !prev)}
              className={`px-3 py-1.5 rounded-full mr-2 mb-2 border ${
                useCurrentLocation
                  ? "bg-sky-600 border-sky-600"
                  : "bg-white border-gray-200"
              }`}
            >
              <Text
                className={`text-xs font-semibold ${
                  useCurrentLocation ? "text-white" : "text-gray-700"
                }`}
              >
                {useCurrentLocation ? "Start From Me" : "Start Stop 1"}
              </Text>
            </TouchableOpacity>
          </View>

          <View className="flex-row items-center flex-wrap">
            <TouchableOpacity
              onPress={openInMaps}
              className="px-3 py-1.5 rounded-full bg-blue-600 mr-2 mb-2"
            >
              <Text className="text-white text-xs font-semibold">Open Maps</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={openRouteFromCurrentLocation}
              className="px-3 py-1.5 rounded-full bg-indigo-600 mr-2 mb-2"
            >
              <Text className="text-white text-xs font-semibold">Route from Me</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => fetchNearby("hotel")}
              className="px-3 py-1.5 rounded-full bg-emerald-600 mr-2 mb-2"
            >
              <Text className="text-white text-xs font-semibold">Hotels Near Stop</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => fetchNearby("restaurant")}
              className="px-3 py-1.5 rounded-full bg-amber-600 mr-2 mb-2"
            >
              <Text className="text-white text-xs font-semibold">Food Near Stop</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => fetchNearby("transport")}
              className="px-3 py-1.5 rounded-full bg-indigo-600 mr-2 mb-2"
            >
              <Text className="text-white text-xs font-semibold">Transport Near Stop</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => openNearbyFromCurrentLocation("hotels")}
              className="px-3 py-1.5 rounded-full bg-emerald-700 mr-2 mb-2"
            >
              <Text className="text-white text-xs font-semibold">Hotels Near Me</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => openNearbyFromCurrentLocation("restaurants")}
              className="px-3 py-1.5 rounded-full bg-amber-700 mr-2 mb-2"
            >
              <Text className="text-white text-xs font-semibold">Food Near Me</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={fitToRoute}
              className="px-3 py-1.5 rounded-full bg-gray-900 mr-2 mb-2"
            >
              <Text className="text-white text-xs font-semibold">Fit Route</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setShowRoute((prev) => !prev)}
              className="px-3 py-1.5 rounded-full bg-gray-200 mr-2 mb-2"
            >
              <Text className="text-gray-900 text-xs font-semibold">
                {showRoute ? "Hide" : "Show"} Route
              </Text>
            </TouchableOpacity>
          </View>

          {locationStatus === "denied" && (
            <Text className="text-[11px] text-red-500 mt-1">
              Location access denied. Enable location permission for "start from me".
            </Text>
          )}

          {firstLeg && (
            <View className="mt-2">
              <Text className="text-xs text-gray-500">
                First leg {useCurrentLocation ? "(from current location)" : ""}
              </Text>
              <Text className="text-xs text-gray-800">
                {formatDistance(firstLeg.distance)} | {formatDuration(firstLeg.duration)}
              </Text>
            </View>
          )}

          {(weather || weatherLoading) && (
            <View className="mt-2">
              <Text className="text-xs text-gray-500">
                Weather near {activePlace?.name || "this stop"}
              </Text>
              {weatherLoading ? (
                <Text className="text-xs text-gray-700">Loading...</Text>
              ) : weather ? (
                <Text className="text-xs text-gray-800">
                  {weather.temperature} C | {weatherCodeLabel(weather.code)} | Wind {" "}
                  {weather.windSpeed} km/h
                </Text>
              ) : (
                <Text className="text-xs text-gray-500">Weather unavailable</Text>
              )}
            </View>
          )}

          {nearbyType && (
            <View className="mt-2">
              <Text className="text-xs text-gray-500 mb-1">Nearby {nearbyType}s</Text>
              {nearbyLoading ? (
                <Text className="text-xs text-gray-700">Loading...</Text>
              ) : nearbyPlaces.length > 0 ? (
                nearbyPlaces.slice(0, 3).map((item) => (
                  <Text key={item.id} className="text-xs text-gray-800">
                    {item.name}
                  </Text>
                ))
              ) : (
                <Text className="text-xs text-gray-500">No nearby results</Text>
              )}
            </View>
          )}

          {(smartLoading || mealStops || hotelStops.length > 0) && (
            <View className="mt-2">
              <Text className="text-xs text-gray-500">Smart travel breaks</Text>
              {smartLoading ? (
                <Text className="text-xs text-gray-700">Finding meal/hotel stops...</Text>
              ) : (
                <>
                  {mealStops && mealStops.places.length > 0 && (
                    <Text className="text-xs text-gray-800">
                      Meal stop suggestion: {mealStops.places[0].name}
                    </Text>
                  )}
                  {hotelStops.length > 0 && (
                    <Text className="text-xs text-gray-800">
                      Stay suggestion: {hotelStops[0].name}
                    </Text>
                  )}
                </>
              )}
            </View>
          )}

          {dayOptions.length > 0 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              className="mt-3"
            >
              <TouchableOpacity
                onPress={() => setSelectedDay("all")}
                className={`px-3 py-1.5 rounded-full mr-2 border ${
                  selectedDay === "all"
                    ? "bg-gray-900 border-gray-900"
                    : "bg-white border-gray-200"
                }`}
              >
                <Text
                  className={`text-xs font-medium ${
                    selectedDay === "all" ? "text-white" : "text-gray-700"
                  }`}
                >
                  All
                </Text>
              </TouchableOpacity>

              {dayOptions.map((day) => (
                <TouchableOpacity
                  key={day}
                  onPress={() => setSelectedDay(day)}
                  className={`px-3 py-1.5 rounded-full mr-2 border ${
                    selectedDay === day
                      ? "bg-gray-900 border-gray-900"
                      : "bg-white border-gray-200"
                  }`}
                >
                  <Text
                    className={`text-xs font-medium ${
                      selectedDay === day ? "text-white" : "text-gray-700"
                    }`}
                  >
                    {dayjs(day).format("ddd D")}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
        </View>
      </View>

      <View className="absolute bottom-6">
        <FlatList
          ref={flatListRef}
          data={places}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          keyExtractor={(item, index) => item._id || `${item.name}-${index}`}
          snapToInterval={CARD_WIDTH + SPACING}
          decelerationRate="fast"
          contentContainerStyle={{ paddingHorizontal: SPACING }}
          onScroll={onCardScroll}
          scrollEventThrottle={16}
          renderItem={({ item, index }) => {
            const cardKey = item._id || `${item.name}-${item.formatted_address}-${index}`;
            return (
              <TouchableOpacity
                activeOpacity={0.9}
                onPress={() => onMarkerPress(index)}
                style={{ width: CARD_WIDTH, marginRight: SPACING }}
                className="bg-white rounded-2xl shadow-lg p-4 border border-gray-100"
              >
                <Text className="text-base font-semibold text-black">{item.name}</Text>

                <Image
                  source={{ uri: getPlaceImage(item, cardKey) }}
                  className="h-24 w-full rounded-lg mt-2"
                  resizeMode="cover"
                  onError={() => {
                    const candidateCount = getImageCandidates(item).length;
                    setImageFallbackIndex((prev) => {
                      const nextIndex = Math.min(
                        (prev[cardKey] || 0) + 1,
                        Math.max(0, candidateCount - 1)
                      );
                      if (nextIndex === (prev[cardKey] || 0)) return prev;
                      return { ...prev, [cardKey]: nextIndex };
                    });
                  }}
                />

                {item.briefDescription && (
                  <Text className="text-xs text-gray-600 mt-2" numberOfLines={2}>
                    {item.briefDescription}
                  </Text>
                )}

                <Text className="text-xs text-gray-700 mt-1">
                  ~{item.estimatedDurationMinutes || 90} min
                  {item.travelFromPreviousMinutes
                    ? ` • travel ${item.travelFromPreviousMinutes} min`
                    : ""}
                </Text>

                <Text className="text-xs text-gray-500 mt-2">{item.formatted_address}</Text>

                <View className="flex-row items-center mt-3">
                  <TouchableOpacity
                    onPress={() => openNearbySearch("hotels", item)}
                    className="px-2.5 py-1 rounded-full bg-emerald-100 mr-2"
                  >
                    <Text className="text-[11px] font-medium text-emerald-700">Hotels</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => openNearbySearch("restaurants", item)}
                    className="px-2.5 py-1 rounded-full bg-amber-100"
                  >
                    <Text className="text-[11px] font-medium text-amber-700">Food</Text>
                  </TouchableOpacity>
                </View>
              </TouchableOpacity>
            );
          }}
        />
      </View>
    </View>
  );
};

export default MapScreen;


