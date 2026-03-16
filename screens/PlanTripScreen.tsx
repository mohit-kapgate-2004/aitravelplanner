import React, { useState, useCallback, useEffect, useMemo } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Image,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons, MaterialIcons } from "@expo/vector-icons";
import {
  RouteProp,
  useNavigation,
  useRoute,
  useFocusEffect,
} from "@react-navigation/native";
import { HomeStackParamList } from "../navigation/HomeStack";
import { GooglePlacesAutocomplete } from "react-native-google-places-autocomplete";
import Modal from "react-native-modal";
import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat";
import { useAuth, useUser } from "@clerk/clerk-expo";
import axios from "axios";
import * as Location from "expo-location";
import { API_BASE_URL } from "../config/api";

dayjs.extend(customParseFormat);

const GOOGLE_API_KEY = "abc";
const DEFAULT_COVER_IMAGE =
  "https://images.unsplash.com/photo-1501785888041-af3ef285b470?auto=format&fit=crop&w=1200&q=80";

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

const getPlaceImageCandidates = (place: any, tripName = "travel") => {
  const list: string[] = [];
  for (const photo of place?.photos || []) {
    const safe = sanitizePhotoUrl(photo);
    if (safe) list.push(safe);
  }
  list.push(
    `https://source.unsplash.com/1200x800/?${encodeURIComponent(
      `${place?.name || tripName} ${place?.formatted_address || ""}`
    )}`
  );
  list.push(
    `https://picsum.photos/seed/${encodeURIComponent(
      `${place?.name || tripName}-${place?.formatted_address || "trip"}`
    )}/1200/800`
  );
  list.push(DEFAULT_COVER_IMAGE);
  return Array.from(new Set(list.filter(Boolean)));
};

const formatDurationShort = (seconds?: number) => {
  if (!Number.isFinite(Number(seconds))) return "N/A";
  const value = Number(seconds || 0);
  const hrs = Math.floor(value / 3600);
  const mins = Math.round((value % 3600) / 60);
  return hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
};

const formatDistanceShort = (meters?: number) => {
  if (!Number.isFinite(Number(meters))) return "N/A";
  return `${(Number(meters || 0) / 1000).toFixed(1)} km`;
};

const buildNearbyPlaceData = (
  place: any,
  category: "attraction" | "restaurant" | "hotel",
  destinationLabel: string
) => {
  const lat = Number(place?.lat);
  const lng = Number(place?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const estimatedDurationMinutes =
    category === "restaurant" ? 60 : category === "hotel" ? 45 : 90;

  return {
    name: place?.name || "Nearby place",
    briefDescription:
      category === "restaurant"
        ? `Food stop near ${destinationLabel}.`
        : category === "hotel"
        ? `Stay option near ${destinationLabel}.`
        : `Popular attraction near ${destinationLabel}.`,
    formatted_address: place?.address || `Near ${destinationLabel}`,
    estimatedDurationMinutes,
    photos: [
      `https://source.unsplash.com/900x600/?${encodeURIComponent(
        `${place?.name || category} ${destinationLabel}`
      )}`,
    ],
    types: [category],
    geometry: {
      location: { lat, lng },
      viewport: {
        northeast: { lat: lat + 0.01, lng: lng + 0.01 },
        southwest: { lat: lat - 0.01, lng: lng - 0.01 },
      },
    },
  };
};

const PlaceImageWithFallback = ({
  place,
  tripName,
  className,
  style,
}: {
  place: any;
  tripName?: string;
  className?: string;
  style?: any;
}) => {
  const sources = useMemo(
    () => getPlaceImageCandidates(place, tripName || "trip"),
    [
      place?.name,
      place?.formatted_address,
      tripName,
      JSON.stringify(place?.photos || []),
    ]
  );
  const [imageIndex, setImageIndex] = useState(0);

  useEffect(() => {
    setImageIndex(0);
  }, [sources.join("|")]);

  const uri = sources[Math.min(imageIndex, sources.length - 1)] || DEFAULT_COVER_IMAGE;

  return (
    <Image
      source={{ uri }}
      className={className}
      style={style}
      resizeMode="cover"
      onError={() =>
        setImageIndex((prev) => (prev < sources.length - 1 ? prev + 1 : prev))
      }
    />
  );
};

const PlanTripScreen = () => {
  const navigation = useNavigation();
  const navAny = navigation as any;
  const route = useRoute<RouteProp<HomeStackParamList, "PlanTrip">>();
  const { trip: initialTrip } = route.params ?? {};

  const formatTripName = (name?: string) =>
    name ? name.replace(/^AI Trip to\s+/i, "") : "Your Trip";

  const [trip, setTrip] = useState<any | null>(initialTrip ?? null);
  const [aiLoading, setAiLoading] = useState(false);
  const [autoGenerationTried, setAutoGenerationTried] = useState(false);
  const [showNotes, setShowNotes] = useState(true);
  const [showPlaces, setShowPlaces] = useState(true);
  const initialTab = route.params?.initialTab || "Overview";
  const [selectedTab, setSelectedTab] = useState(initialTab);
  const [modalVisible, setModalVisible] = useState(false);
  const [modalMode, setModalMode] = useState<
    "place" | "expense" | "editExpense" | "ai"
  >("place");
  const [activePlace, setActivePlace] = useState(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [expenses, setExpenses] = useState<any[]>(
  Array.isArray(trip?.expenses) ? trip.expenses : []
);

  const [editingExpense, setEditingExpense] = useState<any | null>(null);
  const [expenseForm, setExpenseForm] = useState({
    description: "",
    category: "",
    amount: "",
    paidBy: "Sujan Anand",
    splitOption: "Don't Split",
  });
  const [openSplitDropdown, setOpenSplitDropdown] = useState(false);
  const [aiPlaces, setAiPlaces] = useState<any[]>([]);
  
  const [error, setError] = useState<string | null>(null);
  const { getToken } = useAuth();
  const { user } = useUser();
  const [optimizingDate, setOptimizingDate] = useState<string | null>(null);
  const [weather, setWeather] = useState<{
    temperature: number;
    windSpeed: number;
    code: number;
  } | null>(null);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [overviewHotels, setOverviewHotels] = useState<any[]>([]);
  const [overviewTransport, setOverviewTransport] = useState<any[]>([]);
  const [overviewNearbyLoading, setOverviewNearbyLoading] = useState(false);
  const [exploreAttractions, setExploreAttractions] = useState<any[]>([]);
  const [exploreRestaurants, setExploreRestaurants] = useState<any[]>([]);
  const [exploreHotels, setExploreHotels] = useState<any[]>([]);
  const [exploreLoading, setExploreLoading] = useState(false);
  const [exploreLoadedKey, setExploreLoadedKey] = useState<string | null>(null);
  const [reachLoading, setReachLoading] = useState(false);
  const [reachEstimates, setReachEstimates] = useState<
    { id: string; label: string; distance: number; duration: number }[]
  >([]);
  const [userLocation, setUserLocation] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const [locationDenied, setLocationDenied] = useState(false);

  const categories = [
    "Flight",
    "Lodging",
    "Shopping",
    "Activities",
    "Sightseeing",
    "Drinks",
    "Food",
    "Transportation",
    "Entertainment",
    "Miscellaneous",
  ];
  const tripId = trip?._id || initialTrip?._id || null;

  const weatherTarget = useMemo(() => {
    const firstItineraryPlace =
      trip?.itinerary?.[0]?.activities?.[0] || null;
    const firstPlace = trip?.placesToVisit?.[0] || null;
    return firstItineraryPlace || firstPlace;
  }, [trip]);

  const overviewTarget = weatherTarget;

  const overviewPlaces = useMemo(() => {
    if (!trip) return [];
    if (Array.isArray(trip.placesToVisit) && trip.placesToVisit.length > 0) {
      return trip.placesToVisit;
    }
    return (trip.itinerary || []).flatMap((day: any) => day.activities || []);
  }, [trip]);

  const totalTripDays = useMemo(() => {
    if (!trip?.startDate || !trip?.endDate) return 0;
    return dayjs(trip.endDate).diff(dayjs(trip.startDate), "day") + 1;
  }, [trip?.startDate, trip?.endDate]);

  const defaultItineraryDate = useMemo(
    () => trip?.itinerary?.[0]?.date || trip?.startDate || dayjs().format("YYYY-MM-DD"),
    [trip]
  );

  const backToPrevious = useCallback(() => {
    if (navAny?.canGoBack?.()) {
      navAny.goBack();
      return;
    }
    navAny?.navigate?.("HomeMain");
  }, [navAny]);

  const formatWeather = (code?: number) => {
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

  const fetchWeather = useCallback(async () => {
    if (!weatherTarget?.geometry?.location) return;
    try {
      setWeatherLoading(true);
      const response = await axios.get(`${API_BASE_URL}/api/weather`, {
        params: {
          lat: weatherTarget.geometry.location.lat,
          lng: weatherTarget.geometry.location.lng,
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
  }, [weatherTarget]);

  const requestUserLocation = useCallback(async () => {
    try {
      setLocationDenied(false);
      if (Platform.OS === "web") {
        if (!navigator.geolocation) {
          setLocationDenied(true);
          return;
        }
        navigator.geolocation.getCurrentPosition(
          (position) => {
            setUserLocation({
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
            });
          },
          () => setLocationDenied(true),
          { enableHighAccuracy: true, timeout: 8000 }
        );
        return;
      }

      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        setLocationDenied(true);
        return;
      }
      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      setUserLocation({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      });
    } catch (err) {
      setLocationDenied(true);
    }
  }, []);

  const fetchOverviewNearby = useCallback(async () => {
    const location = overviewTarget?.geometry?.location;
    if (!location) return;
    try {
      setOverviewNearbyLoading(true);
      const [hotelsRes, transportRes] = await Promise.all([
        axios.get(`${API_BASE_URL}/api/places/nearby`, {
          params: {
            lat: location.lat,
            lng: location.lng,
            type: "hotel",
            radius: 7000,
          },
        }),
        axios.get(`${API_BASE_URL}/api/places/nearby`, {
          params: {
            lat: location.lat,
            lng: location.lng,
            type: "transport",
            radius: 9000,
          },
        }),
      ]);
      setOverviewHotels((hotelsRes.data?.places || []).slice(0, 5));
      setOverviewTransport((transportRes.data?.places || []).slice(0, 5));
    } catch (err) {
      setOverviewHotels([]);
      setOverviewTransport([]);
    } finally {
      setOverviewNearbyLoading(false);
    }
  }, [overviewTarget]);

  const fetchExploreRecommendations = useCallback(
    async (force = false) => {
      const location = overviewTarget?.geometry?.location;
      if (!location) return;

      const locationKey = `${Number(location.lat).toFixed(3)},${Number(
        location.lng
      ).toFixed(3)}`;

      if (!force && exploreLoadedKey === locationKey) {
        return;
      }

      try {
        setExploreLoading(true);
        const [attractionsRes, restaurantsRes, hotelsRes] = await Promise.all([
          axios.get(`${API_BASE_URL}/api/places/nearby`, {
            params: {
              lat: location.lat,
              lng: location.lng,
              type: "attraction",
              radius: 12000,
            },
          }),
          axios.get(`${API_BASE_URL}/api/places/nearby`, {
            params: {
              lat: location.lat,
              lng: location.lng,
              type: "restaurant",
              radius: 8000,
            },
          }),
          axios.get(`${API_BASE_URL}/api/places/nearby`, {
            params: {
              lat: location.lat,
              lng: location.lng,
              type: "hotel",
              radius: 9000,
            },
          }),
        ]);

        setExploreAttractions((attractionsRes.data?.places || []).slice(0, 10));
        setExploreRestaurants((restaurantsRes.data?.places || []).slice(0, 10));
        setExploreHotels((hotelsRes.data?.places || []).slice(0, 10));
        setExploreLoadedKey(locationKey);
      } catch (err) {
        setExploreAttractions([]);
        setExploreRestaurants([]);
        setExploreHotels([]);
      } finally {
        setExploreLoading(false);
      }
    },
    [overviewTarget, exploreLoadedKey]
  );

  const fetchReachEstimates = useCallback(async () => {
    const location = overviewTarget?.geometry?.location;
    if (!location || !userLocation) {
      setReachEstimates([]);
      return;
    }
    const coords = `${userLocation.latitude},${userLocation.longitude}|${location.lat},${location.lng}`;
    const modes = [
      { id: "driving", label: "Car" },
      { id: "cycling", label: "Bike" },
      { id: "walking", label: "Walk" },
    ];
    try {
      setReachLoading(true);
      const responses = await Promise.all(
        modes.map(async (mode) => {
          const res = await axios.get(`${API_BASE_URL}/api/route`, {
            params: { coords, profile: mode.id },
          });
          return {
            id: mode.id,
            label: mode.label,
            distance: Number(res.data?.summary?.distance || 0),
            duration: Number(res.data?.summary?.duration || 0),
          };
        })
      );
      setReachEstimates(responses);
    } catch (err) {
      setReachEstimates([]);
    } finally {
      setReachLoading(false);
    }
  }, [overviewTarget, userLocation]);

  const splitOptions = [
    { label: "Don't Split", value: "Don't Split" },
    { label: "Everyone", value: "Everyone" },
  ];

  const fetchTrip = useCallback(async () => {
  const clerkUserId = user?.id;

  if (!clerkUserId || !tripId) {
    return; // Do nothing until auth and trip are ready
  }

  try {
    const token = await getToken();
    const response = await axios.get(
      `${API_BASE_URL}/api/trips/${tripId}`,
      {
        params: { clerkUserId },
        headers: { Authorization: `Bearer ${token}` },
      }
    );

    const fetchedTrip = response.data.trip;

    setTrip({
      expenses: [],
      itinerary: [],
      placesToVisit: [],
      ...fetchedTrip,
    });

    setExpenses(
      Array.isArray(fetchedTrip?.expenses) ? fetchedTrip.expenses : []
    );

    setError(null);
  } catch (err: any) {
    console.error("Error fetching trip:", err);
    setError("Failed to fetch trip");
  }
}, [tripId, user]);

  useFocusEffect(
    useCallback(() => {
      fetchTrip();
    }, [fetchTrip])
  );

  useEffect(() => {
    if (route.params?.initialTab) {
      setSelectedTab(route.params.initialTab);
    }
  }, [route.params?.initialTab]);

  useEffect(() => {
    setAutoGenerationTried(false);
  }, [trip?._id]);

  useEffect(() => {
    if (weatherTarget) {
      fetchWeather();
    }
  }, [weatherTarget, fetchWeather]);

  useEffect(() => {
    if (overviewTarget?.geometry?.location) {
      fetchOverviewNearby();
    } else {
      setOverviewHotels([]);
      setOverviewTransport([]);
    }
  }, [overviewTarget, fetchOverviewNearby]);

  useEffect(() => {
    if (selectedTab === "Explore" && overviewTarget?.geometry?.location) {
      fetchExploreRecommendations();
    }
  }, [selectedTab, overviewTarget, fetchExploreRecommendations]);

  useEffect(() => {
    requestUserLocation();
  }, [requestUserLocation]);

  useEffect(() => {
    fetchReachEstimates();
  }, [fetchReachEstimates]);

  const fetchAIPlaces = useCallback(async () => {
    try {
      if (!trip?._id) {
        setError("Trip not loaded yet");
        return;
      }

      setAiLoading(true);
      setError("");

      const res = await axios.post(`${API_BASE_URL}/api/ai/chat`, {
        tripId: trip._id,
        message: `Create a detailed itinerary for ${trip.tripName} with 2 to 4 places per day.`,
      });

      const updatedTrip = res.data?.trip || res.data;
      if (updatedTrip?._id) {
        setTrip(updatedTrip);
        setSelectedTab("Itinerary");
      }
    } catch (err: any) {
      setError(err.response?.data?.error || "Failed to generate AI itinerary");
    } finally {
      setAiLoading(false);
    }
  }, [trip?._id, trip?.tripName]);

  useEffect(() => {
    const hasActivities = Array.isArray(trip?.itinerary)
      ? trip.itinerary.some(
          (day: any) => Array.isArray(day?.activities) && day.activities.length > 0
        )
      : false;

    if (!trip?._id || hasActivities || aiLoading || autoGenerationTried) {
      return;
    }

    setAutoGenerationTried(true);
    fetchAIPlaces();
  }, [trip?._id, trip?.itinerary, aiLoading, autoGenerationTried, fetchAIPlaces]);



  const handleAddPlace = async (data: any) => {
    try {
      const placeId = data.place_id;
      if (!placeId || !trip._id) {
        setError("Place or trip ID missing");
        return;
      }

      const token = await getToken();
      await axios.post(
        `${API_BASE_URL}/api/trips/${trip._id}/places`,    //ip - 172.29.72.217
        { placeId },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      await fetchTrip();
      setModalVisible(false);
      setSelectedDate(null);
    } catch (error: any) {
      console.error("Error adding place:", error);
      setError(error.response?.data?.error || "Failed to add place");
    }
  };

  const handleAddPlaceToItinerary = async (place: any, date: string) => {
    try {
      if (!trip._id || !date) {
        setError("Trip ID or date missing");
        return;
      }

      const token = await getToken();
      const payload =
        place.id || place.place_id
          ? { placeId: place.id || place.place_id, date }
          : { placeData: place, date };

      await axios.post(
        `${API_BASE_URL}/api/trips/${trip._id}/itinerary`,
        payload,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      await fetchTrip();
      setModalVisible(false);
      setSelectedDate(null);
    } catch (error: any) {
      console.error("Error adding place to itinerary:", error);
      setError(
        error.response?.data?.error || "Failed to add place to itinerary"
      );
    }
  };

  const handleOptimizeItinerary = async (date: string) => {
    try {
      if (!trip?._id) {
        setError("Trip not loaded yet");
        return;
      }
      setOptimizingDate(date);
      const clerkUserId = user?.id;
      if (!clerkUserId) {
        setError("User not authenticated");
        return;
      }
      const token = await getToken();
      const response = await axios.post(
        `${API_BASE_URL}/api/trips/${trip._id}/itinerary/optimize`,
        { date },
        { params: { clerkUserId }, headers: { Authorization: `Bearer ${token}` } }
      );
      const updatedTrip = response.data?.trip;
      if (updatedTrip) {
        setTrip({
          expenses: [],
          itinerary: [],
          placesToVisit: [],
          ...updatedTrip,
        });
      } else {
        await fetchTrip();
      }
    } catch (error: any) {
      setError(
        error.response?.data?.error || "Failed to optimize route"
      );
    } finally {
      setOptimizingDate(null);
    }
  };

  const handleAddExpense = () => {
    if (
      !expenseForm.description ||
      !expenseForm.category ||
      !expenseForm.amount
    ) {
      setError("Please fill all expense fields");
      return;
    }

    const newExpense = {
      id: Date.now().toString(),
      ...expenseForm,
      price: parseFloat(expenseForm.amount),
      date: dayjs().format("YYYY-MM-DD"),
    };

    setExpenses((prev) => [...prev, newExpense]);
    setExpenseForm({
      description: "",
      category: "",
      amount: "",
      paidBy: "Sujan Anand",
      splitOption: "Don't Split",
    });
    setModalVisible(false);
    setModalMode("place");
  };

  const handleEditExpense = () => {
    if (
      !editingExpense ||
      !expenseForm.description ||
      !expenseForm.category ||
      !expenseForm.amount
    ) {
      setError("Please fill all expense fields");
      return;
    }

    setExpenses((prev) =>
      prev.map((expense) =>
        expense.id === editingExpense.id
          ? {
              ...expense,
              ...expenseForm,
              price: parseFloat(expenseForm.amount),
            }
          : expense
      )
    );
    setExpenseForm({
      description: "",
      category: "",
      amount: "",
      paidBy: "Sujan Anand",
      splitOption: "Don't Split",
    });
    setEditingExpense(null);
    setModalVisible(false);
    setModalMode("place");
  };

  const handleDeleteExpense = (id: string) => {
    setExpenses((prev) => prev.filter((expense) => expense.id !== id));
  };

  const generateTripDates = () => {
    const start = dayjs(trip.startDate || new Date());
    const end = dayjs(trip.endDate || new Date());
    const days = [];

    for (let d = start; d.isBefore(end) || d.isSame(end); d = d.add(1, "day")) {
      days.push(d);
    }

    return days.map((d) => ({
      label: d.format("ddd D/M"),
      value: d.format("YYYY-MM-DD"),
    }));
  };

  const getCurrentDayHours = (openingHours: string[]) => {
    if (!openingHours || openingHours.length === 0) return "Hours unavailable";
    const today = dayjs().format("dddd").toLowerCase();
    const todayHours = openingHours.find((line) =>
      line.toLowerCase().startsWith(today)
    );
    return todayHours || openingHours[0] || "Hours unavailable";
  };

  const getAverageRating = (reviews: any[]) => {
    if (!reviews || reviews.length === 0) return 0;
    const total = reviews.reduce(
      (sum, review) => sum + (review.rating || 0),
      0
    );
    return (total / reviews.length).toFixed(1);
  };

  const renderStars = (rating: number) => {
    const stars = [];
    const fullStars = Math.floor(rating);
    const hasHalfStar = rating % 1 >= 0.5;

    for (let i = 0; i < 5; i++) {
      if (i < fullStars) {
        stars.push(<Ionicons key={i} name="star" size={14} color="#FFD700" />);
      } else if (i === fullStars && hasHalfStar) {
        stars.push(
          <Ionicons key={i} name="star-half" size={14} color="#FFD700" />
        );
      } else {
        stars.push(
          <Ionicons key={i} name="star-outline" size={14} color="#FFD700" />
        );
      }
    }
    return stars;
  };

  const renderPlaceTypes = (types: string[]) => {
    const allowedTypes = [
      "rv_park",
      "tourist_attraction",
      "lodging",
      "point_of_interest",
      "establishment",
    ];
    const filteredTypes =
      types?.filter((type) => allowedTypes.includes(type)) || [];
    const typeColors = {
      rv_park: "text-green-600",
      tourist_attraction: "text-blue-600",
      lodging: "text-purple-600",
      point_of_interest: "text-orange-600",
      establishment: "text-gray-600",
    };

    return filteredTypes.map((type, index) => (
      <View
        key={index}
        className="bg-gray-100 px-3 py-1 rounded-full mr-2 mb-1"
      >
        <Text
          className={`text-xs font-medium ${
            typeColors[type] || "text-gray-700"
          } capitalize`}
        >
          {type.replace(/_/g, " ")}
        </Text>
      </View>
    ));
  };

  const renderPlaceCard = (
    place: any,
    index: number,
    isItinerary: boolean = false
  ) => {
    const isActive = activePlace?.name === place.name;
    return (
      <View
        key={index}
        className="mb-4 bg-white rounded-xl shadow-sm overflow-hidden border border-gray-100"
      >
        <TouchableOpacity
          onPress={() => setActivePlace(isActive ? null : place)}
          className="flex-row items-center"
        >
          <PlaceImageWithFallback
            place={place}
            tripName={trip?.tripName}
            className="w-24 h-24 rounded-l-xl"
          />
          <View className="flex-1 p-3">
            {isItinerary && (
              <View className="self-start bg-blue-100 px-2 py-0.5 rounded-full mb-1">
                <Text className="text-[10px] text-blue-700 font-semibold">
                  Stop {index + 1}
                </Text>
              </View>
            )}
            <Text className="text-gray-800 font-bold text-base mb-1">
              {place.name || "Unknown Place"}
            </Text>
            <Text className="text-gray-600 text-sm leading-5" numberOfLines={2}>
              {place.briefDescription || "No description available"}
            </Text>
            <View className="flex-row items-center mt-1">
              {renderStars(getAverageRating(place.reviews))}
              <Text className="text-xs text-gray-500 ml-1">
                ({getAverageRating(place.reviews)}/5)
              </Text>
            </View>
          </View>
        </TouchableOpacity>

        {isActive && (
          <View className="p-4 bg-gray-50 border-t border-gray-200">
            <View className="mb-4">
              <View className="flex-row items-center">
                <Ionicons name="location" size={16} color="#4B5563" />
                <Text className="text-sm font-semibold text-gray-700 ml-1">
                  Address
                </Text>
              </View>
              <Text className="text-sm text-gray-600 mt-1">
                {place.formatted_address || "No address available"}
              </Text>
            </View>

            {place.openingHours?.length > 0 && (
              <View className="mb-4">
                <View className="flex-row items-center">
                  <Ionicons name="time" size={16} color="#4B5563" />
                  <Text className="text-sm font-semibold text-gray-700 ml-1">
                    Today's Hours
                  </Text>
                </View>
                <Text className="text-sm text-gray-600 mt-1">
                  {getCurrentDayHours(place.openingHours)}
                </Text>
              </View>
            )}

            {place.phoneNumber && (
              <View className="mb-4">
                <View className="flex-row items-center">
                  <Ionicons name="call" size={16} color="#4B5563" />
                  <Text className="text-sm font-semibold text-gray-700 ml-1">
                    Phone
                  </Text>
                </View>
                <Text className="text-sm text-gray-600 mt-1">
                  {place.phoneNumber}
                </Text>
              </View>
            )}

            {place.website && (
              <View className="mb-4">
                <View className="flex-row items-center">
                  <Ionicons name="globe" size={16} color="#4B5563" />
                  <Text className="text-sm font-semibold text-gray-700 ml-1">
                    Website
                  </Text>
                </View>
                <Text
                  className="text-sm text-blue-600 underline mt-1"
                  numberOfLines={1}
                >
                  {place.website}
                </Text>
              </View>
            )}

            {place.reviews?.length > 0 && (
              <View className="mb-4">
                <View className="flex-row items-center">
                  <Ionicons name="star" size={16} color="#4B5563" />
                  <Text className="text-sm font-semibold text-gray-700 ml-1">
                    Review
                  </Text>
                </View>
                <Text className="text-sm text-gray-600 italic mt-1">
                  "{place.reviews[0].text.slice(0, 100)}
                  {place.reviews[0].text.length > 100 ? "..." : ""}"
                </Text>
                <View className="flex-row items-center mt-1">
                  {renderStars(place.reviews[0].rating)}
                  <Text className="text-xs text-gray-500 ml-1">
                    - {place.reviews[0].authorName} ({place.reviews[0].rating}
                    /5)
                  </Text>
                </View>
              </View>
            )}

            {place.types?.length > 0 && (
              <View>
                <View className="flex-row items-center">
                  <Ionicons name="pricetag" size={16} color="#4B5563" />
                  <Text className="text-sm font-semibold text-gray-700 ml-1">
                    Categories
                  </Text>
                </View>
                <View className="flex-row flex-wrap mt-1">
                  {renderPlaceTypes(place.types)}
                </View>
              </View>
            )}
          </View>
        )}
      </View>
    );
  };

  const renderItineraryTab = () => {
    const dates = generateTripDates();

    return (
      <ScrollView className="px-4 pt-4 bg-white">
        <TouchableOpacity
          onPress={fetchAIPlaces}
          className="bg-blue-500 p-3 rounded-lg mb-4 items-center"
          disabled={aiLoading}
        >
          <View className="flex-row items-center">
            {aiLoading ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <MaterialIcons name="auto-awesome" size={20} color="#fff" />
            )}
            <Text className="text-white font-medium ml-2">
              {aiLoading
                ? "Fetching AI Suggestions..."
                : "Use AI to Create Itinerary"}
            </Text>
          </View>
        </TouchableOpacity>

        <View className="flex-row mb-4">
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {dates.map((date, index) => (
              <TouchableOpacity
                key={index}
                onPress={() => setSelectedDate(date.value)}
                className={`px-4 py-2 mr-2 rounded-lg ${
                  selectedDate === date.value ? "bg-blue-500" : "bg-gray-100"
                }`}
              >
                <Text
                  className={`font-semibold text-sm ${
                    selectedDate === date.value ? "text-white" : "text-gray-700"
                  }`}
                >
                  {date.label}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        {dates.map((date, index) => {
          const itineraryForDate = (trip.itinerary || []).find(
            (item: any) =>
              dayjs(item.date).format("YYYY-MM-DD") === date.value
          );
          const activities = itineraryForDate?.activities || [];

          return (
            <View key={index} className="mb-8">
              <View className="flex-row items-center mb-2">
                <Text className="text-2xl font-extrabold mr-2">
                  {date.label}
                </Text>
                <Text className="text-gray-400 font-medium">
                  Add subheading
                </Text>
              </View>

              <View className="flex-row items-center mb-2">
                <TouchableOpacity className="mr-3">
                  <Text className="text-blue-600 text-sm font-semibold">
                    Auto-fill day
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => handleOptimizeItinerary(date.value)}
                  disabled={optimizingDate === date.value}
                >
                  <Text className="text-blue-600 text-sm font-semibold">
                    {optimizingDate === date.value
                      ? "Optimizing..."
                      : "Optimize route"}
                  </Text>
                </TouchableOpacity>
                <Text className="text-xs bg-orange-400 text-white px-1.5 py-0.5 rounded ml-2">
                  PRO
                </Text>
              </View>

              {activities.length > 0 ? (
                activities.map((place: any, idx: number) =>
                  renderPlaceCard(place, idx, true)
                )
              ) : (
                <Text className="text-sm text-gray-500 mb-3">
                  No activities added for this date
                </Text>
              )}

              <TouchableOpacity
                onPress={() => {
                  setSelectedDate(date.value);
                  setModalMode("place");
                  setModalVisible(true);
                }}
                className="flex-row items-center bg-gray-100 rounded-lg px-4 py-3 mb-3"
              >
                <Ionicons name="location-outline" size={18} color="#777" />
                <Text className="ml-2 text-gray-500">Add a place</Text>
              </TouchableOpacity>
            </View>
          );
        })}
      </ScrollView>
    );
  };

  const renderExpenseTab = () => {
    const total = expenses.reduce(
      (sum, expense) => sum + (expense.price || expense.amount || 0),
      0
    );

    return (
      <ScrollView className="px-4 pt-4 bg-white">
        <View className="mb-6">
          <Text className="text-2xl font-extrabold">Budget</Text>
          <Text className="text-sm text-gray-500 mb-4">
            Track your expenses for this trip
          </Text>
          <View className="bg-gray-100 p-4 rounded-lg mb-4">
            <Text className="text-lg font-semibold">
              Total: ${total.toFixed(2)}
            </Text>
          </View>
          <TouchableOpacity
            onPress={() => {
              setModalMode("expense");
              setModalVisible(true);
            }}
            className="bg-blue-500 p-3 rounded-lg items-center"
          >
            <Text className="text-white font-medium">Add New Expense</Text>
          </TouchableOpacity>
        </View>

        {expenses.map((expense, index) => (
          <View key={index} className="mb-4 bg-gray-50 rounded-lg p-3 shadow">
            <View className="flex-row justify-between">
              <View>
                <Text className="text-sm font-semibold">
                  {expense.description}
                </Text>
                <Text className="text-xs text-gray-500">
                  {expense.category}
                </Text>
                <Text className="text-xs text-gray-500">
                  Paid by: {expense.paidBy}
                </Text>
                <Text className="text-xs text-gray-500">
                  Split: {expense.splitOption}
                </Text>
              </View>
              <View className="items-end">
                <Text className="text-sm font-semibold">
                  ${(expense.price || expense.amount || 0).toFixed(2)}
                </Text>
                <Text className="text-xs text-gray-400">
                  {dayjs(expense.date).format("MMM D, YYYY")}
                </Text>
              </View>
            </View>
            <View className="flex-row justify-end mt-2 space-x-2">
              <TouchableOpacity
                onPress={() => {
                  setEditingExpense(expense);
                  setExpenseForm({
                    description: expense.description,
                    category: expense.category,
                    amount: (expense.price || expense.amount || 0).toString(),
                    paidBy: expense.paidBy,
                    splitOption: expense.splitOption,
                  });
                  setModalMode("editExpense");
                  setModalVisible(true);
                }}
                className="bg-blue-100 p-2 rounded"
              >
                <Ionicons name="pencil" size={16} color="#2563eb" />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => handleDeleteExpense(expense.id)}
                className="bg-red-100 p-2 rounded"
              >
                <Ionicons name="trash" size={16} color="#dc2626" />
              </TouchableOpacity>
            </View>
          </View>
        ))}
      </ScrollView>
    );
  };
  return (
  <SafeAreaView className="flex-1 bg-white">
    {!trip || !trip._id ? (
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator size="large" />
        <Text className="mt-2 text-gray-500">Loading trip...</Text>
      </View>
    ) : (
      <>
        {/* ================= EXISTING UI (UNCHANGED) ================= */}

        <View className="relative w-full bg-slate-900 pt-4 pb-14">
          <TouchableOpacity
            onPress={backToPrevious}
            className="absolute top-4 left-4 p-2 bg-white rounded-full"
          >
            <Ionicons name="arrow-back" size={24} color="#000" />
          </TouchableOpacity>

          <View className="px-4 pt-12">
            <Text className="text-xs text-white/70 uppercase tracking-wide">
              Trip Planner
            </Text>
            <Text className="text-white text-2xl font-bold mt-1">
              {formatTripName(trip?.tripName)}
            </Text>
            <Text className="text-white/80 text-sm mt-1">
              {trip.startDate ? dayjs(trip.startDate).format("MMM D") : "N/A"}{" "}
              -{" "}
              {trip.endDate ? dayjs(trip.endDate).format("MMM D") : "N/A"}
            </Text>
          </View>

          <View className="absolute bottom-[-32px] left-4 right-4 bg-white p-4 rounded-xl shadow-md flex-row justify-between items-center">
            <View>
              <Text className="text-lg font-semibold">
                Trip to {formatTripName(trip?.tripName)}
              </Text>
              <Text className="text-sm text-gray-500 mt-1">
                {trip.startDate
                  ? dayjs(trip.startDate).format("MMM D")
                  : "N/A"}{" "}
                -{" "}
                {trip.endDate
                  ? dayjs(trip.endDate).format("MMM D")
                  : "N/A"}
              </Text>
            </View>

            <View className="items-center">
              <Image
                source={{
                  uri:
                    user?.imageUrl ||
                    "https://randomuser.me/api/portraits/women/1.jpg",
                }}
                className="w-8 h-8 rounded-full mb-1"
              />
              <TouchableOpacity className="bg-black rounded-full px-3 py-1">
                <Text className="text-white text-xs">Share</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
        {/* Main content */}
        {error && <Text className="text-red-500 text-sm px-4 mt-4">{error}</Text>}

      <View className="flex-row px-4 mt-12 border-b border-gray-200">
        {["Overview", "Itinerary", "Explore", "$"].map((tab, index) => (
          <TouchableOpacity
            key={index}
            onPress={() => setSelectedTab(tab)}
            className={`mr-6 pb-2 ${
              selectedTab === tab ? "border-b-2 border-orange-500" : ""
            }`}
          >
            <Text
              className={`text-base font-medium ${
                selectedTab === tab ? "text-orange-500" : "text-gray-500"
              }`}
            >
              {tab}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {selectedTab === "Overview" && (
        <ScrollView className="px-4 pt-4">
          <View className="mb-6 bg-white rounded-xl border border-gray-200 overflow-hidden">
            <PlaceImageWithFallback
              place={{
                ...(overviewTarget || {}),
                photos: [...(overviewTarget?.photos || []), trip?.background],
                name: overviewTarget?.name || formatTripName(trip?.tripName),
              }}
              tripName={trip?.tripName}
              className="w-full h-52"
            />
            <View className="p-4">
              <Text className="text-lg font-bold text-gray-900">
                {overviewTarget?.name || `Trip to ${formatTripName(trip?.tripName)}`}
              </Text>
              <Text className="text-sm text-gray-600 mt-1" numberOfLines={2}>
                {overviewTarget?.formatted_address ||
                  `Explore ${formatTripName(trip?.tripName)}`}
              </Text>
              <View className="flex-row flex-wrap mt-3">
                <View className="bg-blue-50 rounded-full px-3 py-1 mr-2 mb-2">
                  <Text className="text-xs text-blue-700 font-semibold">
                    {totalTripDays} days
                  </Text>
                </View>
                <View className="bg-green-50 rounded-full px-3 py-1 mr-2 mb-2">
                  <Text className="text-xs text-green-700 font-semibold">
                    {overviewPlaces.length} places
                  </Text>
                </View>
                <View className="bg-orange-50 rounded-full px-3 py-1 mr-2 mb-2">
                  <Text className="text-xs text-orange-700 font-semibold">
                    Budget: INR {trip?.budget || 0}
                  </Text>
                </View>
              </View>
            </View>
          </View>

          <View className="mb-6 bg-white rounded-lg p-4 border border-gray-200">
            <View className="flex-row items-center justify-between">
              <View>
                <Text className="text-sm text-gray-500 mb-1">
                  Weather near {overviewTarget?.name || "destination"}
                </Text>
                {weatherLoading ? (
                  <Text className="text-sm text-gray-700">Loading weather...</Text>
                ) : weather ? (
                  <Text className="text-lg font-semibold text-gray-900">
                    {weather.temperature}°C • {formatWeather(weather.code)}
                  </Text>
                ) : (
                  <Text className="text-sm text-gray-500">Weather unavailable</Text>
                )}
                {weather && (
                  <Text className="text-xs text-gray-500 mt-1">
                    Wind {weather.windSpeed} km/h
                  </Text>
                )}
              </View>
              <TouchableOpacity
                onPress={fetchWeather}
                className="px-3 py-1.5 rounded-full bg-gray-100"
              >
                <Text className="text-xs text-gray-700">Refresh</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View className="mb-6 bg-white rounded-lg p-4 border border-gray-200">
            <View className="flex-row items-center justify-between mb-2">
              <Text className="font-semibold text-base text-gray-900">
                Travel modes to reach here
              </Text>
              <TouchableOpacity
                onPress={requestUserLocation}
                className="px-3 py-1.5 rounded-full bg-gray-100"
              >
                <Text className="text-xs text-gray-700">Use my location</Text>
              </TouchableOpacity>
            </View>

            {reachLoading ? (
              <Text className="text-sm text-gray-500">Calculating travel times...</Text>
            ) : reachEstimates.length > 0 ? (
              <View className="flex-row flex-wrap">
                {reachEstimates.map((item) => (
                  <View
                    key={item.id}
                    className="w-[48%] mr-[2%] mb-2 p-3 bg-gray-50 rounded-lg"
                  >
                    <Text className="text-sm font-semibold text-gray-900">
                      {item.label}
                    </Text>
                    <Text className="text-xs text-gray-600 mt-1">
                      {formatDistanceShort(item.distance)} • {formatDurationShort(item.duration)}
                    </Text>
                  </View>
                ))}
              </View>
            ) : (
              <Text className="text-sm text-gray-500">
                {locationDenied
                  ? "Location permission denied. Enable location and retry."
                  : "Allow location to see travel time by car, bike and walk."}
              </Text>
            )}
          </View>

          <View className="mb-6 bg-white rounded-lg p-4 border border-gray-200">
            <Text className="font-semibold text-base mb-2 text-gray-900">
              Nearby hotels and transport
            </Text>
            {overviewNearbyLoading ? (
              <Text className="text-sm text-gray-500">Loading nearby stays and transport...</Text>
            ) : (
              <View className="flex-row justify-between">
                <View className="w-[48%]">
                  <Text className="text-sm font-medium text-gray-800 mb-1">Hotels</Text>
                  {overviewHotels.length > 0 ? (
                    overviewHotels.map((item, idx) => (
                      <Text key={`${item.id || item.name}-${idx}`} className="text-xs text-gray-600 mb-1">
                        • {item.name}
                      </Text>
                    ))
                  ) : (
                    <Text className="text-xs text-gray-500">No nearby hotels found</Text>
                  )}
                </View>
                <View className="w-[48%]">
                  <Text className="text-sm font-medium text-gray-800 mb-1">Transport</Text>
                  {overviewTransport.length > 0 ? (
                    overviewTransport.map((item, idx) => (
                      <Text key={`${item.id || item.name}-${idx}`} className="text-xs text-gray-600 mb-1">
                        • {item.name}
                      </Text>
                    ))
                  ) : (
                    <Text className="text-xs text-gray-500">No transport hubs found</Text>
                  )}
                </View>
              </View>
            )}
          </View>

          <View className="mb-6 bg-white rounded-lg p-4 border border-gray-200">
            <Text className="font-semibold text-base mb-2 text-gray-900">
              Trip place highlights
            </Text>
            {overviewPlaces.length > 0 ? (
              overviewPlaces.slice(0, 6).map((place: any, index: number) => (
                <View
                  key={`${place?.name || "place"}-${index}`}
                  className="flex-row items-start justify-between mb-2 pb-2 border-b border-gray-100"
                >
                  <View className="flex-1 pr-2">
                    <Text className="text-sm font-semibold text-gray-900">
                      {index + 1}. {place?.name || "Place"}
                    </Text>
                    <Text className="text-xs text-gray-500" numberOfLines={2}>
                      {place?.formatted_address || "Address unavailable"}
                    </Text>
                  </View>
                  <Text className="text-xs text-blue-600 font-medium mt-0.5">
                    ~{place?.estimatedDurationMinutes || 90} min
                  </Text>
                </View>
              ))
            ) : (
              <Text className="text-sm text-gray-500">No places available yet</Text>
            )}
          </View>
          <View className="border-t border-gray-200 bg-white">
            <TouchableOpacity
              onPress={() => setShowNotes(!showNotes)}
              className="p-4 flex-row justify-between items-center"
            >
              <Text className="text-lg font-semibold">Notes</Text>
              <Ionicons
                name={showNotes ? "chevron-up" : "chevron-down"}
                size={20}
                color="gray"
              />
            </TouchableOpacity>
            {showNotes && (
              <View className="px-4 pb-4">
                <Text className="text-gray-500 text-sm">
                  Write or paste general notes here, e.g. how to get around,
                  local tips, reminders
                </Text>
              </View>
            )}
          </View>

          <View className="border-t border-gray-200 bg-white">
            <TouchableOpacity
              onPress={() => setShowPlaces(!showPlaces)}
              className="p-4 flex-row justify-between items-center"
            >
              <Text className="text-lg font-semibold">Places to visit</Text>
              <Ionicons
                name={showPlaces ? "chevron-up" : "chevron-down"}
                size={20}
                color="gray"
              />
            </TouchableOpacity>
            {showPlaces && (
              <View className="px-4 pb-4">
                {(trip.placesToVisit || []).map((place: any, index: number) =>
                  renderPlaceCard(place, index)
                )}

                {(!trip.placesToVisit || trip.placesToVisit.length === 0) && (
                  <Text className="text-sm text-gray-500">
                    No places added yet
                  </Text>
                )}

                <TouchableOpacity
                  onPress={() => {
                    setSelectedDate(null);
                    setModalMode("place");
                    setModalVisible(true);
                  }}
                  className="border border-gray-300 rounded-lg px-4 py-2"
                >
                  <Text className="text-sm text-gray-500">Add a place</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </ScrollView>
      )}
      {selectedTab === "Itinerary" && renderItineraryTab()}
      {selectedTab === "Explore" && (
        <ScrollView className="px-4 pt-4">
          <View className="flex-row items-center justify-between mb-3">
            <View>
              <Text className="text-lg font-semibold">Explore</Text>
              <Text className="text-sm text-gray-500">
                Nearby options for {formatTripName(trip.tripName || "this destination")}
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => fetchExploreRecommendations(true)}
              className="px-3 py-1.5 rounded-full bg-gray-100"
            >
              <Text className="text-xs text-gray-700">Refresh</Text>
            </TouchableOpacity>
          </View>

          {exploreLoading ? (
            <View className="py-8 items-center">
              <ActivityIndicator />
              <Text className="text-sm text-gray-500 mt-2">
                Loading nearby places...
              </Text>
            </View>
          ) : (
            <>
              {[
                {
                  title: "Top Attractions",
                  category: "attraction" as const,
                  data: exploreAttractions,
                },
                {
                  title: "Restaurants",
                  category: "restaurant" as const,
                  data: exploreRestaurants,
                },
                {
                  title: "Hotels",
                  category: "hotel" as const,
                  data: exploreHotels,
                },
              ].map((section) => (
                <View
                  key={section.title}
                  className="mb-4 bg-white rounded-xl border border-gray-200 p-3"
                >
                  <Text className="text-base font-semibold text-gray-900 mb-2">
                    {section.title}
                  </Text>
                  {section.data.length === 0 ? (
                    <Text className="text-sm text-gray-500">
                      No suggestions found right now.
                    </Text>
                  ) : (
                    section.data.slice(0, 5).map((item: any, idx: number) => (
                      <View
                        key={`${section.title}-${item.id || item.name}-${idx}`}
                        className="flex-row items-start justify-between py-2 border-b border-gray-100"
                      >
                        <View className="flex-1 pr-2">
                          <Text className="text-sm font-medium text-gray-900">
                            {item.name || "Place"}
                          </Text>
                          <Text className="text-xs text-gray-500">
                            {Number.isFinite(Number(item.lat)) &&
                            Number.isFinite(Number(item.lng))
                              ? `${Number(item.lat).toFixed(3)}, ${Number(item.lng).toFixed(3)}`
                              : "Coordinates unavailable"}
                          </Text>
                        </View>
                        <TouchableOpacity
                          onPress={async () => {
                            const placeData = buildNearbyPlaceData(
                              item,
                              section.category,
                              formatTripName(trip.tripName || "destination")
                            );
                            if (!placeData) {
                              setError("Selected place has invalid coordinates");
                              return;
                            }
                            await handleAddPlaceToItinerary(
                              placeData,
                              defaultItineraryDate
                            );
                          }}
                          className="px-3 py-1.5 rounded-full bg-blue-600"
                        >
                          <Text className="text-xs text-white">Add</Text>
                        </TouchableOpacity>
                      </View>
                    ))
                  )}
                </View>
              ))}

              <Text className="text-xs text-gray-500 mb-8">
                Added places go to {dayjs(defaultItineraryDate).format("ddd, MMM D")}
                . You can move them later in Itinerary.
              </Text>
            </>
          )}
        </ScrollView>
      )}
      {selectedTab === "$" && renderExpenseTab()}

      <View className="absolute right-4 bottom-20 space-y-3 items-end">
        <TouchableOpacity
          onPress={() =>
            navigation.navigate("AIChat", {
              tripId: trip._id,
              tripName: trip.tripName || "Unknown",
            })
          }
          className="w-12 h-12 rounded-full bg-gradient-to-tr from-pink-400 to-purple-600 items-center justify-center shadow"
        >
          <MaterialIcons name="auto-awesome" size={24} color="#fff" />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() =>
            navigation.navigate("MapScreen", {
              trip,
              places: trip.placesToVisit || [],
            })
          }
          className="w-12 h-12 rounded-full bg-black items-center justify-center shadow"
        >
          <Ionicons name="map" size={22} color="#fff" />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => {
            setSelectedDate(null);
            setModalMode("place");
            setModalVisible(true);
          }}
          className="w-12 h-12 rounded-full bg-black items-center justify-center shadow"
        >
          <Ionicons name="add" size={24} color="#fff" />
        </TouchableOpacity>
      </View>
      <Modal
        isVisible={modalVisible}
        onBackdropPress={() => {
          setModalVisible(false);
          setSelectedDate(null);
          setModalMode("place");
          setEditingExpense(null);
          setAiPlaces([]);
          setExpenseForm({
            description: "",
            category: "",
            amount: "",
            paidBy: "Sujan Anand",
            splitOption: "Don't Split",
          });
        }}
        style={{ justifyContent: "flex-end", margin: 0 }}
      >
        <View className="bg-white p-4 rounded-t-2xl h-[60%]">
          {modalMode === "place" && selectedTab !== "Itinerary" ? (
            <>
              <Text className="text-lg font-semibold mb-4">
                Search for a place
              </Text>
              <GooglePlacesAutocomplete
                placeholder="Search for a place"
                fetchDetails={true}
                enablePoweredByContainer={false}
                onPress={async (data, details = null) => {
                  try {
                    const placeId = data.place_id;
                    const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&key=${GOOGLE_API_KEY}`;
                    const res = await fetch(url);
                    const json = await res.json();

                    if (json.status !== "OK" || !json.result) {
                      throw new Error(
                        `Google Places API error: ${
                          json.status || "No result found"
                        }`
                      );
                    }

                    const d = json.result;
                    const place = {
                      id: placeId,
                      name: d.name || "Unknown Place",
                      briefDescription:
                        d.editorial_summary?.overview?.slice(0, 200) + "..." ||
                        d.reviews?.[0]?.text?.slice(0, 200) + "..." ||
                        `Located in ${
                          d.address_components?.[2]?.long_name ||
                          d.formatted_address ||
                          "this area"
                        }. A nice place to visit.`,
                      photos:
                        d.photos?.map(
                          (photo: any) =>
                            `https://maps.googleapis.com/maps/api/place/photo?maxwidth=400&photoreference=${photo.photo_reference}&key=${GOOGLE_API_KEY}`
                        ) || [],
                      formatted_address:
                        d.formatted_address || "No address available",
                      openingHours: d.opening_hours?.weekday_text || [],
                      phoneNumber: d.formatted_phone_number || "",
                      website: d.website || "",
                      geometry: d.geometry || {
                        location: { lat: 0, lng: 0 },
                        viewport: {
                          northeast: { lat: 0, lng: 0 },
                          southwest: { lat: 0, lng: 0 },
                        },
                      },
                      types: d.types || [],
                      reviews:
                        d.reviews?.map((review: any) => ({
                          authorName: review.author_name || "Unknown",
                          rating: review.rating || 0,
                          text: review.text || "",
                        })) || [],
                    };

                    await handleAddPlace(data);
                  } catch (error: any) {
                    console.error("Place detail error:", error.message);
                    setError(`Failed to fetch place details: ${error.message}`);
                  }
                }}
                query={{
                  key: GOOGLE_API_KEY,
                  language: "en",
                }}
                styles={{
                  container: { flex: 0 },
                  textInputContainer: {
                    flexDirection: "row",
                    backgroundColor: "#f1f1f1",
                    borderRadius: 30,
                    paddingHorizontal: 10,
                    alignItems: "center",
                  },
                  textInput: {
                    flex: 1,
                    height: 44,
                    color: "#333",
                    fontSize: 16,
                    backgroundColor: "#f1f1f1",
                    borderRadius: 25,
                  },
                  listView: {
                    marginTop: 10,
                    backgroundColor: "#fff",
                  },
                }}
              />
            </>
          ) : modalMode === "place" && selectedTab === "Itinerary" ? (
            <>
              <Text className="text-lg font-semibold mb-2">
                {selectedDate
                  ? `Add Place to ${dayjs(selectedDate).format("ddd D/M")}`
                  : "Search for a place"}
              </Text>
              <GooglePlacesAutocomplete
                placeholder="Search for a place"
                fetchDetails={true}
                enablePoweredByContainer={false}
                onPress={async (data, details = null) => {
                  try {
                    const placeId = data.place_id;
                    const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&key=${GOOGLE_API_KEY}`;
                    const res = await fetch(url);
                    const json = await res.json();

                    if (json.status !== "OK" || !json.result) {
                      throw new Error(
                        `Google Places API error: ${
                          json.status || "No result found"
                        }`
                      );
                    }

                    const d = json.result;
                    const place = {
                      id: placeId,
                      name: d.name || "Unknown Place",
                      briefDescription:
                        d.editorial_summary?.overview?.slice(0, 200) + "..." ||
                        d.reviews?.[0]?.text?.slice(0, 200) + "..." ||
                        `Located in ${
                          d.address_components?.[2]?.long_name ||
                          d.formatted_address ||
                          "this area"
                        }. A nice place to visit.`,
                      photos:
                        d.photos?.map(
                          (photo: any) =>
                            `https://maps.googleapis.com/maps/api/place/photo?maxwidth=400&photoreference=${photo.photo_reference}&key=${GOOGLE_API_KEY}`
                        ) || [],
                      formatted_address:
                        d.formatted_address || "No address available",
                      openingHours: d.opening_hours?.weekday_text || [],
                      phoneNumber: d.formatted_phone_number || "",
                      website: d.website || "",
                      geometry: d.geometry || {
                        location: { lat: 0, lng: 0 },
                        viewport: {
                          northeast: { lat: 0, lng: 0 },
                          southwest: { lat: 0, lng: 0 },
                        },
                      },
                      types: d.types || [],
                      reviews:
                        d.reviews?.map((review: any) => ({
                          authorName: review.author_name || "Unknown",
                          rating: review.rating || 0,
                          text: review.text || "",
                        })) || [],
                    };

                    if (selectedDate) {
                      await handleAddPlaceToItinerary(place, selectedDate);
                    } else {
                      setError(
                        "Please select a date to add this place to the itinerary"
                      );
                    }
                  } catch (error: any) {
                    console.error("Place detail error:", error.message);
                    setError(`Failed to fetch place details: ${error.message}`);
                  }
                }}
                query={{
                  key: GOOGLE_API_KEY,
                  language: "en",
                }}
                styles={{
                  container: { flex: 0 },
                  textInputContainer: {
                    flexDirection: "row",
                    backgroundColor: "#f1f1f1",
                    borderRadius: 30,
                    paddingHorizontal: 10,
                    alignItems: "center",
                  },
                  textInput: {
                    flex: 1,
                    height: 44,
                    color: "#333",
                    fontSize: 16,
                    backgroundColor: "#f1f1f1",
                    borderRadius: 25,
                  },
                  listView: {
                    marginTop: 10,
                    backgroundColor: "#fff",
                  },
                }}
              />

              <Text className="text-sm font-semibold mt-2 mb-1">
                Select Date
              </Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{
                  flexDirection: "row",
                  alignItems: "center",
                  paddingVertical: 4,
                }}
              >
                {generateTripDates().map((date, index) => (
                  <TouchableOpacity
                    key={index}
                    onPress={() => setSelectedDate(date.value)}
                    className={`px-3 py-1.5 mr-2 rounded-full border ${
                      selectedDate === date.value
                        ? "bg-blue-500 border-blue-500"
                        : "bg-white border-gray-300"
                    }`}
                  >
                    <Text
                      className={`text-xs font-medium ${
                        selectedDate === date.value
                          ? "text-white"
                          : "text-gray-700"
                      }`}
                    >
                      {date.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              {(trip.placesToVisit || []).length > 0 && (
                <View className="flex-1 mt-2">
                  <Text className="text-sm font-semibold mb-1">
                    Previously Added Places
                  </Text>
                  <ScrollView className="flex-1">
                    {trip.placesToVisit.map((place: any, index: number) => (
                      <TouchableOpacity
                        key={index}
                        onPress={() => {
                          if (selectedDate) {
                            handleAddPlaceToItinerary(place, selectedDate);
                          } else {
                            setError(
                              "Please select a date to add this place to the itinerary"
                            );
                          }
                        }}
                        className="flex-row items-center p-2 border-b border-gray-200"
                      >
                        <Image
                          source={{
                            uri:
                              place.photos?.[0] ||
                              "https://via.placeholder.com/150",
                          }}
                          className="w-12 h-12 rounded-md mr-2"
                          resizeMode="cover"
                        />
                        <View>
                          <Text className="text-sm font-medium">
                            {place.name || "Unknown Place"}
                          </Text>
                          <Text
                            className="text-xs text-gray-500"
                            numberOfLines={1}
                          >
                            {place.formatted_address || "No address available"}
                          </Text>
                        </View>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              )}
            </>
          ) : modalMode === "ai" ? (
            <>
              <Text className="text-lg font-semibold mb-2">
                {selectedDate
                  ? `Add AI-Suggested Place to ${dayjs(selectedDate).format(
                      "ddd D/M"
                    )}`
                  : "Select a date for AI-Suggested Places"}
              </Text>
              <Text className="text-sm font-semibold mt-2 mb-1">
                Select Date
              </Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{
                  flexDirection: "row",
                  alignItems: "center",
                  paddingVertical: 4,
                }}
              >
                {generateTripDates().map((date, index) => (
                  <TouchableOpacity
                    key={index}
                    onPress={() => setSelectedDate(date.value)}
                    className={`px-3 py-1.5 mr-2 rounded-full border ${
                      selectedDate === date.value
                        ? "bg-blue-500 border-blue-500"
                        : "bg-white border-gray-300"
                    }`}
                  >
                    <Text
                      className={`text-xs font-medium ${
                        selectedDate === date.value
                          ? "text-white"
                          : "text-gray-700"
                      }`}
                    >
                      {date.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              {aiPlaces.length > 0 && (
                <View className="flex-1 mt-2">
                  <Text className="text-sm font-semibold mb-1">
                    AI-Suggested Places
                  </Text>
                  <ScrollView className="flex-1">
                    {aiPlaces.map((place, index) => (
                      <TouchableOpacity
                        key={index}
                        onPress={() => {
                          if (selectedDate) {
                            handleAddPlaceToItinerary(place, selectedDate);
                          } else {
                            setError(
                              "Please select a date to add this place to the itinerary"
                            );
                          }
                        }}
                        className="flex-row items-center p-2 border-b border-gray-200"
                      >
                        <Image
                          source={{
                            uri:
                              place.photos?.[0] ||
                              "https://via.placeholder.com/150",
                          }}
                          className="w-12 h-12 rounded-md mr-2"
                          resizeMode="cover"
                        />
                        <View>
                          <Text className="text-sm font-medium">
                            {place.name || "Unknown Place"}
                          </Text>
                          <Text
                            className="text-xs text-gray-500"
                            numberOfLines={1}
                          >
                            {place.formatted_address || "No address available"}
                          </Text>
                        </View>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              )}
            </>
          ) : (
            <>
              <Text className="text-lg font-semibold mb-4">
                {modalMode === "editExpense"
                  ? "Edit Expense"
                  : "Add New Expense"}
              </Text>
              <ScrollView>
                <Text className="text-sm font-medium mb-2">Description</Text>
                <TextInput
                  value={expenseForm.description}
                  onChangeText={(text) =>
                    setExpenseForm({ ...expenseForm, description: text })
                  }
                  placeholder="Enter expense description"
                  className="bg-gray-100 p-3 rounded-lg mb-4"
                />

                <Text className="text-sm font-medium mb-2">Category</Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  className="mb-4"
                >
                  {categories.map((category, index) => (
                    <TouchableOpacity
                      key={index}
                      onPress={() =>
                        setExpenseForm({ ...expenseForm, category })
                      }
                      className={`px-4 py-2 mr-2 rounded-lg ${
                        expenseForm.category === category
                          ? "bg-blue-500"
                          : "bg-gray-100"
                      }`}
                    >
                      <Text
                        className={`text-sm font-medium ${
                          expenseForm.category === category
                            ? "text-white"
                            : "text-gray-700"
                        }`}
                      >
                        {category}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>

                <Text className="text-sm font-medium mb-2">Amount</Text>
                <TextInput
                  value={expenseForm.amount}
                  onChangeText={(text) =>
                    setExpenseForm({ ...expenseForm, amount: text })
                  }
                  placeholder="Enter amount"
                  keyboardType="numeric"
                  className="bg-gray-100 p-3 rounded-lg mb-4"
                />

                <Text className="text-sm font-medium mb-2">Paid By</Text>
                <TextInput
                  value={expenseForm.paidBy}
                  onChangeText={(text) =>
                    setExpenseForm({ ...expenseForm, paidBy: text })
                  }
                  placeholder="Enter name"
                  className="bg-gray-100 p-3 rounded-lg mb-4"
                />

                <Text className="text-sm font-medium mb-2">Split Option</Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  className="mb-4"
                >
                  {splitOptions.map((option, index) => (
                    <TouchableOpacity
                      key={index}
                      onPress={() =>
                        setExpenseForm({
                          ...expenseForm,
                          splitOption: option.value,
                        })
                      }
                      className={`px-4 py-2 mr-2 rounded-lg ${
                        expenseForm.splitOption === option.value
                          ? "bg-blue-500"
                          : "bg-gray-100"
                      }`}
                    >
                      <Text
                        className={`text-sm font-medium ${
                          expenseForm.splitOption === option.value
                            ? "text-white"
                            : "text-gray-700"
                        }`}
                      >
                        {option.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>

                <TouchableOpacity
                  onPress={
                    modalMode === "editExpense"
                      ? handleEditExpense
                      : handleAddExpense
                  }
                  className="bg-blue-500 p-3 rounded-lg items-center"
                >
                  <Text className="text-white font-medium">
                    {modalMode === "editExpense"
                      ? "Save Changes"
                      : "Add Expense"}
                  </Text>
                </TouchableOpacity>
              </ScrollView>
            </>
          )}
        </View>
      </Modal>

      </>
    )}
  </SafeAreaView>
);

  // return (
  //   <SafeAreaView className="flex-1 bg-white">
      
  //     <View className="relative w-full h-48">
  //       <Image
  //        source={{
  //                 uri: trip?.background || "https://via.placeholder.com/150",
  //           }}
  //        className="w-full h-full"
  //        resizeMode="cover"
  //       />

  //       <View className="absolute top-0 left-0 w-full h-full bg-black/30" />
  //       <TouchableOpacity
  //         onPress={() => navigation.goBack()}
  //         className="absolute top-4 left-4 p-2 bg-white rounded-full"
  //       >
  //         <Ionicons name="arrow-back" size={24} color="#000" />
  //       </TouchableOpacity>
  //       <View className="absolute bottom-[-32px] left-4 right-4 bg-white p-4 rounded-xl shadow-md flex-row justify-between items-center">
  //         <View>
  //           <Text className="text-lg font-semibold">
  //            Trip to {trip?.tripName || "Your Trip"}
  //           </Text>
  //           <Text className="text-sm text-gray-500 mt-1">
  //             {trip.startDate ? dayjs(trip.startDate).format("MMM D") : "N/A"} â€“{" "}
  //             {trip.endDate ? dayjs(trip.endDate).format("MMM D") : "N/A"}
  //           </Text>
  //         </View>
  //         <View className="items-center">
  //           <Image
  //             source={{
  //               uri:
  //                 user?.imageUrl ||
  //                 "https://randomuser.me/api/portraits/women/1.jpg",
  //             }}
  //             className="w-8 h-8 rounded-full mb-1"
  //           />
  //           <TouchableOpacity className="bg-black rounded-full px-3 py-1">
  //             <Text className="text-white text-xs">Share</Text>
  //           </TouchableOpacity>
  //         </View>
  //       </View>
  //     </View>

  //     {error && <Text className="text-red-500 text-sm px-4 mt-4">{error}</Text>}

  //     <View className="flex-row px-4 mt-12 border-b border-gray-200">
  //       {["Overview", "Itinerary", "Explore", "$"].map((tab, index) => (
  //         <TouchableOpacity
  //           key={index}
  //           onPress={() => setSelectedTab(tab)}
  //           className={`mr-6 pb-2 ${
  //             selectedTab === tab ? "border-b-2 border-orange-500" : ""
  //           }`}
  //         >
  //           <Text
  //             className={`text-base font-medium ${
  //               selectedTab === tab ? "text-orange-500" : "text-gray-500"
  //             }`}
  //           >
  //             {tab}
  //           </Text>
  //         </TouchableOpacity>
  //       ))}
  //     </View>

  //     {selectedTab === "Overview" && (
  //       <ScrollView className="px-4 pt-4">
  //         <View className="mb-6 bg-white rounded-lg p-4">
  //           <Text className="text-sm text-gray-500 mb-1">
  //             Wanderlog level: <Text className="text-blue-500">Basic</Text>
  //           </Text>
  //           <View className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
  //             <View className="w-1/4 h-full bg-blue-500" />
  //           </View>
  //           <Text className="text-xs text-gray-400 mt-1">4 of 12</Text>
  //         </View>

  //         <View className="flex-row justify-between mb-6">
  //           {[
  //             {
  //               title: "Add a reservation",
  //               subtitle: "Forward an email or add reservation details",
  //             },
  //             {
  //               title: "Explore things to do",
  //               subtitle: "Add places from top blogs",
  //             },
  //           ].map((card, idx) => (
  //             <View
  //               key={idx}
  //               className="w-[48%] bg-white p-4 rounded-lg shadow-sm"
  //             >
  //               <Text className="font-semibold mb-2 text-sm">{card.title}</Text>
  //               <Text className="text-xs text-gray-500 mb-3">
  //                 {card.subtitle}
  //               </Text>
  //               <View className="flex-row justify-between">
  //                 <Text className="text-blue-500 text-xs font-medium">
  //                   Skip
  //                 </Text>
  //                 <Text className="text-blue-500 text-xs font-medium">
  //                   Start
  //                 </Text>
  //               </View>
  //             </View>
  //           ))}
  //         </View>

  //         <View className="mb-6 bg-white rounded-lg p-4">
  //           <Text className="font-semibold mb-3 text-base">
  //             Reservations and attachments
  //           </Text>
  //           <ScrollView horizontal showsHorizontalScrollIndicator={false}>
  //             {[
  //               { label: "Flight", icon: "airplane" },
  //               { label: "Lodging", icon: "bed" },
  //               { label: "Rental car", icon: "car" },
  //               { label: "Restaurant", icon: "restaurant" },
  //               { label: "Attachment", icon: "attach" },
  //               { label: "Other", icon: "ellipsis-horizontal" },
  //             ].map((item, idx) => (
  //               <View key={idx} className="items-center mr-6">
  //                 <Ionicons name={item.icon as any} size={24} />
  //                 <Text className="text-xs mt-1">{item.label}</Text>
  //               </View>
  //             ))}
  //           </ScrollView>
  //         </View>

  //         <View className="border-t border-gray-200 bg-white">
  //           <TouchableOpacity
  //             onPress={() => setShowNotes(!showNotes)}
  //             className="p-4 flex-row justify-between items-center"
  //           >
  //             <Text className="text-lg font-semibold">Notes</Text>
  //             <Ionicons
  //               name={showNotes ? "chevron-up" : "chevron-down"}
  //               size={20}
  //               color="gray"
  //             />
  //           </TouchableOpacity>
  //           {showNotes && (
  //             <View className="px-4 pb-4">
  //               <Text className="text-gray-500 text-sm">
  //                 Write or paste general notes here, e.g. how to get around,
  //                 local tips, reminders
  //               </Text>
  //             </View>
  //           )}
  //         </View>

  //         <View className="border-t border-gray-200 bg-white">
  //           <TouchableOpacity
  //             onPress={() => setShowPlaces(!showPlaces)}
  //             className="p-4 flex-row justify-between items-center"
  //           >
  //             <Text className="text-lg font-semibold">Places to visit</Text>
  //             <Ionicons
  //               name={showPlaces ? "chevron-up" : "chevron-down"}
  //               size={20}
  //               color="gray"
  //             />
  //           </TouchableOpacity>
  //           {showPlaces && (
  //             <View className="px-4 pb-4">
  //               {(trip.placesToVisit || []).map((place: any, index: number) =>
  //                 renderPlaceCard(place, index)
  //               )}

  //               {(!trip.placesToVisit || trip.placesToVisit.length === 0) && (
  //                 <Text className="text-sm text-gray-500">
  //                   No places added yet
  //                 </Text>
  //               )}

  //               <TouchableOpacity
  //                 onPress={() => {
  //                   setSelectedDate(null);
  //                   setModalMode("place");
  //                   setModalVisible(true);
  //                 }}
  //                 className="border border-gray-300 rounded-lg px-4 py-2"
  //               >
  //                 <Text className="text-sm text-gray-500">Add a place</Text>
  //               </TouchableOpacity>
  //             </View>
  //           )}
  //         </View>
  //       </ScrollView>
  //     )}
  //     {selectedTab === "Itinerary" && renderItineraryTab()}
  //     {selectedTab === "Explore" && (
  //       <ScrollView className="px-4 pt-4">
  //         <Text className="text-lg font-semibold">Explore</Text>
  //         <Text className="text-sm text-gray-500">
  //           Discover more places and activities in{" "}
  //           {trip.tripName || "this destination"}.
  //         </Text>
  //       </ScrollView>
  //     )}
  //     {selectedTab === "$" && renderExpenseTab()}

  //     <View className="absolute right-4 bottom-20 space-y-3 items-end">
  //       <TouchableOpacity
  //         onPress={() =>
  //           navigation.navigate("AIChat", {
  //             location: trip.tripName || "Unknown",
  //           })
  //         }
  //         className="w-12 h-12 rounded-full bg-gradient-to-tr from-pink-400 to-purple-600 items-center justify-center shadow"
  //       >
  //         <MaterialIcons name="auto-awesome" size={24} color="#fff" />
  //       </TouchableOpacity>
  //       <TouchableOpacity
  //         onPress={() =>
  //           navigation.navigate("MapScreen", {
  //             places: trip.placesToVisit || [],
  //           })
  //         }
  //         className="w-12 h-12 rounded-full bg-black items-center justify-center shadow"
  //       >
  //         <Ionicons name="map" size={22} color="#fff" />
  //       </TouchableOpacity>
  //       <TouchableOpacity
  //         onPress={() => {
  //           setSelectedDate(null);
  //           setModalMode("place");
  //           setModalVisible(true);
  //         }}
  //         className="w-12 h-12 rounded-full bg-black items-center justify-center shadow"
  //       >
  //         <Ionicons name="add" size={24} color="#fff" />
  //       </TouchableOpacity>
  //     </View>
  //     <Modal
  //       isVisible={modalVisible}
  //       onBackdropPress={() => {
  //         setModalVisible(false);
  //         setSelectedDate(null);
  //         setModalMode("place");
  //         setEditingExpense(null);
  //         setAiPlaces([]);
  //         setExpenseForm({
  //           description: "",
  //           category: "",
  //           amount: "",
  //           paidBy: "Sujan Anand",
  //           splitOption: "Don't Split",
  //         });
  //       }}
  //       style={{ justifyContent: "flex-end", margin: 0 }}
  //     >
  //       <View className="bg-white p-4 rounded-t-2xl h-[60%]">
  //         {modalMode === "place" && selectedTab !== "Itinerary" ? (
  //           <>
  //             <Text className="text-lg font-semibold mb-4">
  //               Search for a place
  //             </Text>
  //             <GooglePlacesAutocomplete
  //               placeholder="Search for a place"
  //               fetchDetails={true}
  //               enablePoweredByContainer={false}
  //               onPress={async (data, details = null) => {
  //                 try {
  //                   const placeId = data.place_id;
  //                   const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&key=${GOOGLE_API_KEY}`;
  //                   const res = await fetch(url);
  //                   const json = await res.json();

  //                   if (json.status !== "OK" || !json.result) {
  //                     throw new Error(
  //                       `Google Places API error: ${
  //                         json.status || "No result found"
  //                       }`
  //                     );
  //                   }

  //                   const d = json.result;
  //                   const place = {
  //                     id: placeId,
  //                     name: d.name || "Unknown Place",
  //                     briefDescription:
  //                       d.editorial_summary?.overview?.slice(0, 200) + "..." ||
  //                       d.reviews?.[0]?.text?.slice(0, 200) + "..." ||
  //                       `Located in ${
  //                         d.address_components?.[2]?.long_name ||
  //                         d.formatted_address ||
  //                         "this area"
  //                       }. A nice place to visit.`,
  //                     photos:
  //                       d.photos?.map(
  //                         (photo: any) =>
  //                           `https://maps.googleapis.com/maps/api/place/photo?maxwidth=400&photoreference=${photo.photo_reference}&key=${GOOGLE_API_KEY}`
  //                       ) || [],
  //                     formatted_address:
  //                       d.formatted_address || "No address available",
  //                     openingHours: d.opening_hours?.weekday_text || [],
  //                     phoneNumber: d.formatted_phone_number || "",
  //                     website: d.website || "",
  //                     geometry: d.geometry || {
  //                       location: { lat: 0, lng: 0 },
  //                       viewport: {
  //                         northeast: { lat: 0, lng: 0 },
  //                         southwest: { lat: 0, lng: 0 },
  //                       },
  //                     },
  //                     types: d.types || [],
  //                     reviews:
  //                       d.reviews?.map((review: any) => ({
  //                         authorName: review.author_name || "Unknown",
  //                         rating: review.rating || 0,
  //                         text: review.text || "",
  //                       })) || [],
  //                   };

  //                   await handleAddPlace(data);
  //                 } catch (error: any) {
  //                   console.error("Place detail error:", error.message);
  //                   setError(`Failed to fetch place details: ${error.message}`);
  //                 }
  //               }}
  //               query={{
  //                 key: GOOGLE_API_KEY,
  //                 language: "en",
  //               }}
  //               styles={{
  //                 container: { flex: 0 },
  //                 textInputContainer: {
  //                   flexDirection: "row",
  //                   backgroundColor: "#f1f1f1",
  //                   borderRadius: 30,
  //                   paddingHorizontal: 10,
  //                   alignItems: "center",
  //                 },
  //                 textInput: {
  //                   flex: 1,
  //                   height: 44,
  //                   color: "#333",
  //                   fontSize: 16,
  //                   backgroundColor: "#f1f1f1",
  //                   borderRadius: 25,
  //                 },
  //                 listView: {
  //                   marginTop: 10,
  //                   backgroundColor: "#fff",
  //                 },
  //               }}
  //             />
  //           </>
  //         ) : modalMode === "place" && selectedTab === "Itinerary" ? (
  //           <>
  //             <Text className="text-lg font-semibold mb-2">
  //               {selectedDate
  //                 ? `Add Place to ${dayjs(selectedDate).format("ddd D/M")}`
  //                 : "Search for a place"}
  //             </Text>
  //             <GooglePlacesAutocomplete
  //               placeholder="Search for a place"
  //               fetchDetails={true}
  //               enablePoweredByContainer={false}
  //               onPress={async (data, details = null) => {
  //                 try {
  //                   const placeId = data.place_id;
  //                   const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&key=${GOOGLE_API_KEY}`;
  //                   const res = await fetch(url);
  //                   const json = await res.json();

  //                   if (json.status !== "OK" || !json.result) {
  //                     throw new Error(
  //                       `Google Places API error: ${
  //                         json.status || "No result found"
  //                       }`
  //                     );
  //                   }

  //                   const d = json.result;
  //                   const place = {
  //                     id: placeId,
  //                     name: d.name || "Unknown Place",
  //                     briefDescription:
  //                       d.editorial_summary?.overview?.slice(0, 200) + "..." ||
  //                       d.reviews?.[0]?.text?.slice(0, 200) + "..." ||
  //                       `Located in ${
  //                         d.address_components?.[2]?.long_name ||
  //                         d.formatted_address ||
  //                         "this area"
  //                       }. A nice place to visit.`,
  //                     photos:
  //                       d.photos?.map(
  //                         (photo: any) =>
  //                           `https://maps.googleapis.com/maps/api/place/photo?maxwidth=400&photoreference=${photo.photo_reference}&key=${GOOGLE_API_KEY}`
  //                       ) || [],
  //                     formatted_address:
  //                       d.formatted_address || "No address available",
  //                     openingHours: d.opening_hours?.weekday_text || [],
  //                     phoneNumber: d.formatted_phone_number || "",
  //                     website: d.website || "",
  //                     geometry: d.geometry || {
  //                       location: { lat: 0, lng: 0 },
  //                       viewport: {
  //                         northeast: { lat: 0, lng: 0 },
  //                         southwest: { lat: 0, lng: 0 },
  //                       },
  //                     },
  //                     types: d.types || [],
  //                     reviews:
  //                       d.reviews?.map((review: any) => ({
  //                         authorName: review.author_name || "Unknown",
  //                         rating: review.rating || 0,
  //                         text: review.text || "",
  //                       })) || [],
  //                   };

  //                   if (selectedDate) {
  //                     await handleAddPlaceToItinerary(place, selectedDate);
  //                   } else {
  //                     setError(
  //                       "Please select a date to add this place to the itinerary"
  //                     );
  //                   }
  //                 } catch (error: any) {
  //                   console.error("Place detail error:", error.message);
  //                   setError(`Failed to fetch place details: ${error.message}`);
  //                 }
  //               }}
  //               query={{
  //                 key: GOOGLE_API_KEY,
  //                 language: "en",
  //               }}
  //               styles={{
  //                 container: { flex: 0 },
  //                 textInputContainer: {
  //                   flexDirection: "row",
  //                   backgroundColor: "#f1f1f1",
  //                   borderRadius: 30,
  //                   paddingHorizontal: 10,
  //                   alignItems: "center",
  //                 },
  //                 textInput: {
  //                   flex: 1,
  //                   height: 44,
  //                   color: "#333",
  //                   fontSize: 16,
  //                   backgroundColor: "#f1f1f1",
  //                   borderRadius: 25,
  //                 },
  //                 listView: {
  //                   marginTop: 10,
  //                   backgroundColor: "#fff",
  //                 },
  //               }}
  //             />

  //             <Text className="text-sm font-semibold mt-2 mb-1">
  //               Select Date
  //             </Text>
  //             <ScrollView
  //               horizontal
  //               showsHorizontalScrollIndicator={false}
  //               contentContainerStyle={{
  //                 flexDirection: "row",
  //                 alignItems: "center",
  //                 paddingVertical: 4,
  //               }}
  //             >
  //               {generateTripDates().map((date, index) => (
  //                 <TouchableOpacity
  //                   key={index}
  //                   onPress={() => setSelectedDate(date.value)}
  //                   className={`px-3 py-1.5 mr-2 rounded-full border ${
  //                     selectedDate === date.value
  //                       ? "bg-blue-500 border-blue-500"
  //                       : "bg-white border-gray-300"
  //                   }`}
  //                 >
  //                   <Text
  //                     className={`text-xs font-medium ${
  //                       selectedDate === date.value
  //                         ? "text-white"
  //                         : "text-gray-700"
  //                     }`}
  //                   >
  //                     {date.label}
  //                   </Text>
  //                 </TouchableOpacity>
  //               ))}
  //             </ScrollView>

  //             {(trip.placesToVisit || []).length > 0 && (
  //               <View className="flex-1 mt-2">
  //                 <Text className="text-sm font-semibold mb-1">
  //                   Previously Added Places
  //                 </Text>
  //                 <ScrollView className="flex-1">
  //                   {trip.placesToVisit.map((place: any, index: number) => (
  //                     <TouchableOpacity
  //                       key={index}
  //                       onPress={() => {
  //                         if (selectedDate) {
  //                           handleAddPlaceToItinerary(place, selectedDate);
  //                         } else {
  //                           setError(
  //                             "Please select a date to add this place to the itinerary"
  //                           );
  //                         }
  //                       }}
  //                       className="flex-row items-center p-2 border-b border-gray-200"
  //                     >
  //                       <Image
  //                         source={{
  //                           uri:
  //                             place.photos?.[0] ||
  //                             "https://via.placeholder.com/150",
  //                         }}
  //                         className="w-12 h-12 rounded-md mr-2"
  //                         resizeMode="cover"
  //                       />
  //                       <View>
  //                         <Text className="text-sm font-medium">
  //                           {place.name || "Unknown Place"}
  //                         </Text>
  //                         <Text
  //                           className="text-xs text-gray-500"
  //                           numberOfLines={1}
  //                         >
  //                           {place.formatted_address || "No address available"}
  //                         </Text>
  //                       </View>
  //                     </TouchableOpacity>
  //                   ))}
  //                 </ScrollView>
  //               </View>
  //             )}
  //           </>
  //         ) : modalMode === "ai" ? (
  //           <>
  //             <Text className="text-lg font-semibold mb-2">
  //               {selectedDate
  //                 ? `Add AI-Suggested Place to ${dayjs(selectedDate).format(
  //                     "ddd D/M"
  //                   )}`
  //                 : "Select a date for AI-Suggested Places"}
  //             </Text>
  //             <Text className="text-sm font-semibold mt-2 mb-1">
  //               Select Date
  //             </Text>
  //             <ScrollView
  //               horizontal
  //               showsHorizontalScrollIndicator={false}
  //               contentContainerStyle={{
  //                 flexDirection: "row",
  //                 alignItems: "center",
  //                 paddingVertical: 4,
  //               }}
  //             >
  //               {generateTripDates().map((date, index) => (
  //                 <TouchableOpacity
  //                   key={index}
  //                   onPress={() => setSelectedDate(date.value)}
  //                   className={`px-3 py-1.5 mr-2 rounded-full border ${
  //                     selectedDate === date.value
  //                       ? "bg-blue-500 border-blue-500"
  //                       : "bg-white border-gray-300"
  //                   }`}
  //                 >
  //                   <Text
  //                     className={`text-xs font-medium ${
  //                       selectedDate === date.value
  //                         ? "text-white"
  //                         : "text-gray-700"
  //                     }`}
  //                   >
  //                     {date.label}
  //                   </Text>
  //                 </TouchableOpacity>
  //               ))}
  //             </ScrollView>

  //             {aiPlaces.length > 0 && (
  //               <View className="flex-1 mt-2">
  //                 <Text className="text-sm font-semibold mb-1">
  //                   AI-Suggested Places
  //                 </Text>
  //                 <ScrollView className="flex-1">
  //                   {aiPlaces.map((place, index) => (
  //                     <TouchableOpacity
  //                       key={index}
  //                       onPress={() => {
  //                         if (selectedDate) {
  //                           handleAddPlaceToItinerary(place, selectedDate);
  //                         } else {
  //                           setError(
  //                             "Please select a date to add this place to the itinerary"
  //                           );
  //                         }
  //                       }}
  //                       className="flex-row items-center p-2 border-b border-gray-200"
  //                     >
  //                       <Image
  //                         source={{
  //                           uri:
  //                             place.photos?.[0] ||
  //                             "https://via.placeholder.com/150",
  //                         }}
  //                         className="w-12 h-12 rounded-md mr-2"
  //                         resizeMode="cover"
  //                       />
  //                       <View>
  //                         <Text className="text-sm font-medium">
  //                           {place.name || "Unknown Place"}
  //                         </Text>
  //                         <Text
  //                           className="text-xs text-gray-500"
  //                           numberOfLines={1}
  //                         >
  //                           {place.formatted_address || "No address available"}
  //                         </Text>
  //                       </View>
  //                     </TouchableOpacity>
  //                   ))}
  //                 </ScrollView>
  //               </View>
  //             )}
  //           </>
  //         ) : (
  //           <>
  //             <Text className="text-lg font-semibold mb-4">
  //               {modalMode === "editExpense"
  //                 ? "Edit Expense"
  //                 : "Add New Expense"}
  //             </Text>
  //             <ScrollView>
  //               <Text className="text-sm font-medium mb-2">Description</Text>
  //               <TextInput
  //                 value={expenseForm.description}
  //                 onChangeText={(text) =>
  //                   setExpenseForm({ ...expenseForm, description: text })
  //                 }
  //                 placeholder="Enter expense description"
  //                 className="bg-gray-100 p-3 rounded-lg mb-4"
  //               />

  //               <Text className="text-sm font-medium mb-2">Category</Text>
  //               <ScrollView
  //                 horizontal
  //                 showsHorizontalScrollIndicator={false}
  //                 className="mb-4"
  //               >
  //                 {categories.map((category, index) => (
  //                   <TouchableOpacity
  //                     key={index}
  //                     onPress={() =>
  //                       setExpenseForm({ ...expenseForm, category })
  //                     }
  //                     className={`px-4 py-2 mr-2 rounded-lg ${
  //                       expenseForm.category === category
  //                         ? "bg-blue-500"
  //                         : "bg-gray-100"
  //                     }`}
  //                   >
  //                     <Text
  //                       className={`text-sm font-medium ${
  //                         expenseForm.category === category
  //                           ? "text-white"
  //                           : "text-gray-700"
  //                       }`}
  //                     >
  //                       {category}
  //                     </Text>
  //                   </TouchableOpacity>
  //                 ))}
  //               </ScrollView>

  //               <Text className="text-sm font-medium mb-2">Amount</Text>
  //               <TextInput
  //                 value={expenseForm.amount}
  //                 onChangeText={(text) =>
  //                   setExpenseForm({ ...expenseForm, amount: text })
  //                 }
  //                 placeholder="Enter amount"
  //                 keyboardType="numeric"
  //                 className="bg-gray-100 p-3 rounded-lg mb-4"
  //               />

  //               <Text className="text-sm font-medium mb-2">Paid By</Text>
  //               <TextInput
  //                 value={expenseForm.paidBy}
  //                 onChangeText={(text) =>
  //                   setExpenseForm({ ...expenseForm, paidBy: text })
  //                 }
  //                 placeholder="Enter name"
  //                 className="bg-gray-100 p-3 rounded-lg mb-4"
  //               />

  //               <Text className="text-sm font-medium mb-2">Split Option</Text>
  //               <ScrollView
  //                 horizontal
  //                 showsHorizontalScrollIndicator={false}
  //                 className="mb-4"
  //               >
  //                 {splitOptions.map((option, index) => (
  //                   <TouchableOpacity
  //                     key={index}
  //                     onPress={() =>
  //                       setExpenseForm({
  //                         ...expenseForm,
  //                         splitOption: option.value,
  //                       })
  //                     }
  //                     className={`px-4 py-2 mr-2 rounded-lg ${
  //                       expenseForm.splitOption === option.value
  //                         ? "bg-blue-500"
  //                         : "bg-gray-100"
  //                     }`}
  //                   >
  //                     <Text
  //                       className={`text-sm font-medium ${
  //                         expenseForm.splitOption === option.value
  //                           ? "text-white"
  //                           : "text-gray-700"
  //                       }`}
  //                     >
  //                       {option.label}
  //                     </Text>
  //                   </TouchableOpacity>
  //                 ))}
  //               </ScrollView>

  //               <TouchableOpacity
  //                 onPress={
  //                   modalMode === "editExpense"
  //                     ? handleEditExpense
  //                     : handleAddExpense
  //                 }
  //                 className="bg-blue-500 p-3 rounded-lg items-center"
  //               >
  //                 <Text className="text-white font-medium">
  //                   {modalMode === "editExpense"
  //                     ? "Save Changes"
  //                     : "Add Expense"}
  //                 </Text>
  //               </TouchableOpacity>
  //             </ScrollView>
  //           </>
  //         )}
  //       </View>
  //     </Modal>
    
  //   </SafeAreaView>

  // );
};

export default PlanTripScreen;


