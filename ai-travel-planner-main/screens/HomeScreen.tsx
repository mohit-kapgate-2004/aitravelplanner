import React, { useCallback } from "react";
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
import { useTrip } from "../context/TripContext";

/* ---------------- NAV TYPES ---------------- */

export type HomeStackParamList = {
  HomeMain: undefined;
  NewTrip: undefined;
  TripOverview: undefined;
};

type HomeScreenNavigationProp =
  NativeStackNavigationProp<HomeStackParamList>;

/* ---------------- SCREEN ---------------- */

const HomeScreen = () => {
  const navigation = useNavigation<HomeScreenNavigationProp>();
  const { user } = useUser();

  const {
    trips,
    loading,
    loadTrips,
    setActiveTrip,
  } = useTrip();

  /* ---------------- LOAD TRIPS ---------------- */

  useFocusEffect(
    useCallback(() => {
      if (user?.id && user?.primaryEmailAddress?.emailAddress) {
        loadTrips(
          user.id,
          user.primaryEmailAddress.emailAddress
        );
      }
    }, [user])
  );

  /* ---------------- UI ---------------- */

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScrollView className="flex-1">

        {/* HEADER */}
        <View className="flex-row justify-between items-center px-4 pt-4 pb-2">
          <Image
            source={{
              uri: "https://dummyimage.com/200x60/000/fff&text=TRAVEL",
            }}
            className="w-36 h-8"
            resizeMode="contain"
          />
          <TouchableOpacity className="bg-yellow-400 px-3 py-1 rounded-full">
            <Text className="text-sm font-semibold text-white">PRO</Text>
          </TouchableOpacity>
        </View>

        {/* DIVIDER */}
        <View className="border-b border-gray-200 mx-4" />

        {/* BANNER */}
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

        {/* LOADING */}
        {loading && (
          <Text className="text-center mt-4 text-gray-500">
            Loading trips...
          </Text>
        )}

        {/* CONTINUE PLANNING */}
        {!loading && trips.length > 0 && (
          <View className="px-4 mt-6">
            <Text className="text-xl font-semibold mb-3">
              Continue Planning
            </Text>

            {trips.slice(0, 1).map((trip) => (
              <TouchableOpacity
                key={trip._id}
                className="flex-row mb-4 items-center"
                onPress={() => {
                  setActiveTrip(trip);
                  navigation.navigate("TripOverview");
                }}
              >
                <Image
                  source={{ uri: trip.background }}
                  className="w-24 h-24 rounded-xl mr-4"
                />
                <View className="flex-1">
                  <Text className="text-lg font-semibold">
                    {trip.tripName}
                  </Text>
                  <Text className="text-sm text-gray-500 mt-1">
                    {trip.itinerary?.length || 0} days
                  </Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* FEATURED */}
        <View className="p-4">
          <Text className="text-2xl font-semibold mb-4">
            Featured guides from users
          </Text>
          <FeaturedGuides />
        </View>

        {/* WEEKEND */}
        <View className="p-4">
          <Text className="text-2xl font-semibold mb-4">
            Weekend trips
          </Text>
          <WeekendTrips />
        </View>

        {/* POPULAR */}
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
