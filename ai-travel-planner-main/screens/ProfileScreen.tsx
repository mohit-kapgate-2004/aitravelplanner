import { useClerk, useUser } from "@clerk/clerk-expo";
import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  Image,
  TouchableOpacity,
  Pressable,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons, Entypo } from "@expo/vector-icons";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import axios from "axios";
import dayjs from "dayjs";
import { HomeStackParamList } from "./HomeStack"; // Adjust path if needed

// Define TabNavigatorParamList
export type TabNavigatorParamList = {
  Home: { screen?: string; params?: any }; // Allow nested navigation
  Guides: undefined;
  Profile: undefined;
};

// Combined navigation prop type
type ProfileScreenNavigationProp = NativeStackNavigationProp<
  TabNavigatorParamList & HomeStackParamList
>;

const ProfileScreen = () => {
  const { signOut } = useClerk();
  const { user } = useUser();
  const navigation = useNavigation<ProfileScreenNavigationProp>();
  const [trips, setTrips] = useState<any[]>([]); // Formatted trips for UI
  const [rawTrips, setRawTrips] = useState<any[]>([]); // Original backend trips for navigation
  const [error, setError] = useState<string | null>(null);

  const fetchTrips = useCallback(async () => {
    try {
      const clerkUserId = user?.id;
      if (!clerkUserId) {
        setError("User not authenticated");
        return;
      }

      const response = await axios.get("http://172.29.72.217:3000/api/trips", {
        params: { clerkUserId },
      });

      const formattedTrips = response.data.trips.map((trip: any) => ({
        id: trip._id,
        name: trip.tripName,
        date: `${dayjs(trip.startDate).format("D MMM")} – ${dayjs(trip.endDate).format("D MMM, YYYY")}`,
        image: trip.background || "https://via.placeholder.com/150",
        places: trip.placesToVisit?.length || 0,
        daysLeft: dayjs(trip.startDate).isAfter(dayjs())
          ? dayjs(trip.startDate).diff(dayjs(), "day")
          : null,
      }));

      setTrips(formattedTrips);
      setRawTrips(response.data.trips); // Store original trips
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

  if (!user) {
    return (
      <View className="flex-1 justify-center items-center bg-white">
        <Text className="text-lg text-gray-500">Please sign in</Text>
      </View>
    );
  }

  const profileImage = user.imageUrl && user.externalAccounts.some(acc => acc.provider === 'oauth_google')
    ? user.imageUrl
    : "https://cdn-icons-png.flaticon.com/128/3177/3177440.png"; // Blank avatar

  const email = user.primaryEmailAddress?.emailAddress || "No email available";
  const name = user.fullName || "Anonymous User";
  const handle = `@${user.username || user.id.slice(0, 8)}`;

  const handleSignOut = async () => {
    try {
      await signOut();
      // No manual navigation needed; RootNavigator redirects to SignIn
    } catch (err) {
      console.error("Sign-out error:", JSON.stringify(err, null, 2));
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 100 }}>
        {/* Header */}
        <View className="bg-pink-100 items-center pb-6 rounded-b-3xl relative">
          {/* PRO Badge */}
          <View className="absolute top-4 left-4 bg-yellow-400 px-3 py-1 rounded-full">
            <Text className="text-xs text-white font-semibold">PRO</Text>
          </View>

          {/* Profile Image */}
          <View className="mt-8 relative">
            <Image
              source={{ uri: profileImage }}
              className="w-24 h-24 rounded-full"
            />
            <TouchableOpacity className="absolute -bottom-1 -right-1 bg-white p-1 rounded-full border border-gray-300">
              <Ionicons name="pencil" size={12} color="#555" />
            </TouchableOpacity>
          </View>

          {/* Name, Handle & Email */}
          <Text className="mt-3 text-lg font-semibold">{name}</Text>
          <Text className="text-gray-500">{handle}</Text>
          <Text className="text-gray-500 text-sm mt-1">{email}</Text>

          {/* Followers / Following */}
          <View className="flex-row justify-center mt-4 space-x-12">
            <View className="items-center">
              <Text className="font-bold text-base">0</Text>
              <Text className="text-xs text-gray-500 tracking-wide">FOLLOWERS</Text>
            </View>
            <View className="items-center">
              <Text className="font-bold text-base">0</Text>
              <Text className="text-xs text-gray-500 tracking-wide">FOLLOWING</Text>
            </View>
          </View>

          {/* Sign Out Button */}
          <TouchableOpacity
            className="bg-orange-500 px-6 py-3 rounded-lg mt-4"
            onPress={handleSignOut}
          >
            <Text className="text-white text-base font-semibold">Sign Out</Text>
          </TouchableOpacity>
        </View>

        {/* Tabs */}
        <View className="flex-row items-center px-4 py-3 border-b border-gray-200">
          <Text className="text-sm text-orange-500 font-semibold mr-6">Trips</Text>
          <Text className="text-sm text-gray-400 mr-auto">Guides</Text>
          <TouchableOpacity className="flex-row items-center space-x-1">
            <Ionicons name="swap-vertical-outline" size={16} color="#666" />
            <Text className="text-sm text-gray-500">Sort</Text>
          </TouchableOpacity>
        </View>

        {/* Error Message */}
        {error && (
          <View className="px-4 mt-4">
            <Text className="text-red-500 text-sm">{error}</Text>
          </View>
        )}

        {/* Trip Cards */}
        {trips.length === 0 && !error && (
          <View className="px-4 mt-4">
            <Text className="text-gray-500 text-sm">No trips found. Create a new trip!</Text>
          </View>
        )}

        {trips.map((trip, index) => (
          <Pressable
            key={trip.id}
            onPress={() => navigation.navigate("Home", { screen: "PlanTrip", params: { trip: rawTrips[index] } })}
            className="flex-row items-start bg-white rounded-xl shadow-sm mx-4 mt-4 p-3"
          >
            <Image source={{ uri: trip.image }} className="w-16 h-16 rounded-lg mr-3" />
            <View className="flex-1">
              {trip.daysLeft && (
                <Text className="text-xs text-orange-600 bg-orange-100 px-2 py-0.5 rounded-full self-start font-semibold mb-1">
                  In {trip.daysLeft} days
                </Text>
              )}
              <Text className="text-sm font-semibold text-gray-900 mb-1">
                {trip.name}
              </Text>
              <View className="flex-row items-center">
                <Image
                  source={{ uri: "https://randomuser.me/api/portraits/men/32.jpg" }}
                  className="w-4 h-4 rounded-full mr-2"
                />
                <Text className="text-xs text-gray-500">
                  {trip.date} • {trip.places} places
                </Text>
              </View>
            </View>
            <Entypo name="dots-three-vertical" size={14} color="#999" />
          </Pressable>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
};

export default ProfileScreen;