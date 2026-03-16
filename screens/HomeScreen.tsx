import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  ScrollView,
} from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { SafeAreaView } from "react-native-safe-area-context";
import WeekendTrips from "../components/WeekendTrips";
import PopularDestinations from "../components/PopularDestinations";
import FeaturedGuides from "../components/FeaturedGuides";
import { useUser } from "@clerk/clerk-expo";
import axios from "axios";
import { API_BASE_URL } from "../config/api";

// Define HomeStackParamList (adjust path if needed)
export type HomeStackParamList = {
  HomeMain: undefined;
  NewTrip: undefined;
  PlanTrip: { trip: any; initialTab?: string }; // Replace 'any' with your Trip type
  AIChat: undefined;
  MapScreen: undefined;
};

// Define TabNavigatorParamList
export type TabNavigatorParamList = {
  Home: undefined;
  AIChat: undefined;
  Guides: undefined;
  Profile: undefined;
};

// Combined navigation prop type
type HomeScreenNavigationProp = NativeStackNavigationProp<
  HomeStackParamList & TabNavigatorParamList
>;

const DEFAULT_TRIP_IMAGE =
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

const getTripImageCandidates = (trip: any) => {
  const list: string[] = [];
  const firstPlacePhoto = sanitizePhotoUrl(trip?.placesToVisit?.[0]?.photos?.[0]);
  const firstItineraryPhoto = sanitizePhotoUrl(
    trip?.itinerary?.[0]?.activities?.[0]?.photos?.[0]
  );
  const tripBackground = sanitizePhotoUrl(trip?.background);
  const tripName = String(trip?.tripName || "trip");

  if (firstPlacePhoto) list.push(firstPlacePhoto);
  if (firstItineraryPhoto) list.push(firstItineraryPhoto);
  if (tripBackground) list.push(tripBackground);

  list.push(
    `https://source.unsplash.com/900x600/?${encodeURIComponent(
      `${tripName.replace(/^AI Trip to\s+/i, "")} travel destination`
    )}`
  );
  list.push(`https://picsum.photos/seed/${encodeURIComponent(tripName)}/900/600`);
  list.push(DEFAULT_TRIP_IMAGE);

  return Array.from(new Set(list.filter(Boolean)));
};

const TripCoverImage = ({ trip }: { trip: any }) => {
  const candidates = React.useMemo(() => getTripImageCandidates(trip), [trip]);
  const [index, setIndex] = useState(0);

  React.useEffect(() => {
    setIndex(0);
  }, [candidates.join("|")]);

  const uri = candidates[Math.min(index, candidates.length - 1)] || DEFAULT_TRIP_IMAGE;

  return (
    <Image
      source={{ uri }}
      className="w-full h-full"
      onError={() =>
        setIndex((prev) => (prev < candidates.length - 1 ? prev + 1 : prev))
      }
    />
  );
};

const HomeScreen = () => {
  const navigation = useNavigation<HomeScreenNavigationProp>();
  const { user } = useUser();
  const [trips, setTrips] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);

  const formatTripName = (name?: string) =>
    name ? name.replace(/^AI Trip to\s+/i, "") : "Trip";
  const isAITrip = (name?: string) => /^AI Trip to\s+/i.test(name || "");

  const fetchTrips = useCallback(async () => {
    try {
      const clerkUserId = user?.id;
      const email = user?.primaryEmailAddress?.emailAddress; // Get user's email from Clerk
      if (!clerkUserId) {
        setError("User not authenticated");
        return;
      }

      const response = await axios.get(`${API_BASE_URL}/api/trips`, {
        params: { clerkUserId, email }, // Include email in query params
      });

      setTrips(response.data.trips);
      setError(null);
    } catch (error: any) {
      console.error("Error fetching trips:", error);
      setError(error.response?.data?.error || "Failed to fetch trips");
    }
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      fetchTrips();
    }, [fetchTrips])
  );

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScrollView className="flex-1">
        {/* Header */}
        <View className="flex-row justify-between items-center px-4 pt-4 pb-2">
          <View>
            <Text className="text-2xl font-extrabold text-gray-900">
              AI Travel Planner
            </Text>
            <Text className="text-[11px] text-gray-500">
              Plan smarter, travel better
            </Text>
          </View>
          <View className="flex-row items-center space-x-3">
            <TouchableOpacity className="p-2 bg-gray-100 rounded-full">
              <Text className="text-lg">🔍</Text>
            </TouchableOpacity>
            <TouchableOpacity className="bg-yellow-400 px-3 py-1 rounded-full">
              <Text className="text-sm font-semibold text-white">PRO</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Divider */}
        <View className="border-b border-gray-200 mx-4" />

        {/* Banner */}
        <View className="relative">
          <Image
            source={{
              uri: "https://images.unsplash.com/photo-1501785888041-af3ef285b470",
            }}
            className="w-full h-80"
            resizeMode="cover"
          />
          <View className="absolute inset-0 flex items-center justify-center">
            <Text className="text-white text-4xl font-bold text-center px-6">
              Plan your next adventure
            </Text>
            <TouchableOpacity
              onPress={() => navigation.navigate("NewTrip")}
              className="bg-orange-500 px-6 py-2 rounded-full mt-4"
            >
              <Text className="text-white font-semibold text-base">
                Create new trip plan
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Error Message */}
        {error && (
          <Text className="text-red-500 text-sm px-4 mt-4">{error}</Text>
        )}

        {/* User's Trips */}
        {trips.length === 0 && !error && (
          <View className="px-4 mt-6">
            <Text className="text-sm text-gray-500">
              No trips yet. Create your first plan.
            </Text>
          </View>
        )}
        {trips.length > 0 && (
          <View className="px-4 mt-6">
            <View className="flex-row justify-between items-center mb-3">
              <Text className="text-xl font-semibold">Continue Planning</Text>
              <TouchableOpacity
                onPress={() => navigation.navigate("Profile")}
              >
                <Text className="text-sm font-medium text-blue-500">
                  See all
                </Text>
              </TouchableOpacity>
            </View>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 4 }}
              className="mb-2"
            >
              {trips
                .slice()
                .sort(
                  (a, b) =>
                    new Date(b.createdAt || 0).getTime() -
                    new Date(a.createdAt || 0).getTime()
                )
                .slice(0, 4)
                .map((trip) => (
                <TouchableOpacity
                  key={trip._id}
                  className="mr-4"
                  onPress={() => navigation.navigate("PlanTrip", { trip })}
                >
                  <View className="w-44 h-44 rounded-2xl overflow-hidden">
                    <TripCoverImage trip={trip} />
                    <View className="absolute inset-0 bg-black/25" />
                    <View className="absolute bottom-0 left-0 right-0 p-3">
                      <View className="flex-row items-center">
                        <Text
                          className="text-white text-base font-semibold"
                          numberOfLines={1}
                        >
                          Trip to {formatTripName(trip.tripName)}
                        </Text>
                        {isAITrip(trip.tripName) ? (
                          <View className="ml-2 bg-blue-500/80 px-2 py-0.5 rounded-full">
                            <Text className="text-[10px] text-white font-semibold">
                              AI
                            </Text>
                          </View>
                        ) : (
                          <View className="ml-2 bg-white/80 px-2 py-0.5 rounded-full">
                            <Text className="text-[10px] text-gray-800 font-semibold">
                              Manual
                            </Text>
                          </View>
                        )}
                      </View>
                      <Text className="text-white/90 text-xs mt-1">
                        {(trip.placesToVisit || []).length} place
                        {(trip.placesToVisit || []).length !== 1 ? "s" : ""}
                      </Text>
                    </View>
                  </View>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        {/* Featured Guides */}
        <View className="p-4">
          <Text className="text-2xl font-semibold mb-4">
            Featured guides from users
          </Text>
          <FeaturedGuides />
        </View>

        {/* Weekend Trips */}
        <View className="p-4">
          <Text className="text-2xl font-semibold mb-4">Weekend trips</Text>
          <WeekendTrips />
        </View>

        {/* Popular Destinations */}
        <View className="p-4">
          <Text className="text-2xl font-semibold mb-4">
            Popular destinations
          </Text>
          <PopularDestinations />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

export default HomeScreen;
