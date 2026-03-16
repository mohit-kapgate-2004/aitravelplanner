import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Modal,
  Pressable,
  ActivityIndicator,
  FlatList,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Calendar, DateObject } from "react-native-calendars";
import dayjs from "dayjs";
import { useNavigation } from "@react-navigation/native";
import { useTrip } from "../context/TripContext";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { RootStackParamList } from "../navigation/RootNavigator";
import { useAuth, useUser } from "@clerk/clerk-expo";
import axios from "axios";

const NewTripScreen = () => {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  // const { addTrip } = useTrip();
  const { getToken } = useAuth();
  const { user } = useUser();
  const { addTrip, setActiveTrip } = useTrip();

  const [calendarVisible, setCalendarVisible] = useState(false);
  const [searchVisible, setSearchVisible] = useState(false);
  const [chosenLocation, setChosenLocation] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedRange, setSelectedRange] = useState<{
    startDate?: string;
    endDate?: string;
  }>({});
  const [displayStart, setDisplayStart] = useState("");
  const [displayEnd, setDisplayEnd] = useState("");

  /* ============================
     🔍 OSM AUTOCOMPLETE STATE
  ============================ */
  const [searchText, setSearchText] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);

  const today = dayjs().format("YYYY-MM-DD");

  const searchPlaces = async (text: string) => {
    setSearchText(text);

    if (text.length < 2) {
      setResults([]);
      return;
    }

    try {
      setSearchLoading(true);
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
          text
        )}&limit=10`,
        {
          headers: {
            "User-Agent": "ai-travel-planner",
          },
        }
      );
      const data = await res.json();
      setResults(data);
    } catch {
      setResults([]);
    } finally {
      setSearchLoading(false);
    }
  };

  /* ============================
     📅 CALENDAR LOGIC
  ============================ */
  const handleDayPress = (day: DateObject) => {
    const selected = day.dateString;

    if (
      !selectedRange.startDate ||
      (selectedRange.startDate && selectedRange.endDate)
    ) {
      setSelectedRange({ startDate: selected });
    } else if (
      selectedRange.startDate &&
      dayjs(selected).isAfter(selectedRange.startDate)
    ) {
      setSelectedRange({
        ...selectedRange,
        endDate: selected,
      });
    }
  };

  const getMarkedDates = () => {
    const marks: any = {};
    const { startDate, endDate } = selectedRange;

    if (startDate && !endDate) {
      marks[startDate] = {
        startingDay: true,
        endingDay: true,
        color: "#FF5722",
        textColor: "white",
      };
    } else if (startDate && endDate) {
      let curr = dayjs(startDate);
      const end = dayjs(endDate);

      while (curr.isBefore(end) || curr.isSame(end)) {
        const d = curr.format("YYYY-MM-DD");
        marks[d] = {
          color: "#FF5722",
          textColor: "white",
          ...(d === startDate && { startingDay: true }),
          ...(d === endDate && { endingDay: true }),
        };
        curr = curr.add(1, "day");
      }
    }
    return marks;
  };

  const onSaveDates = () => {
    if (selectedRange.startDate) setDisplayStart(selectedRange.startDate);
    if (selectedRange.endDate) setDisplayEnd(selectedRange.endDate);
    setCalendarVisible(false);
  };

  /* ============================
     🚀 CREATE TRIP
  ============================ */
  const handleCreateTrip = async () => {
  try {
    setIsLoading(true);
    setError(null);

    if (!chosenLocation || !selectedRange.startDate || !selectedRange.endDate) {
      setError("Please select a location and date range");
      return;
    }

    if (!user?.id || !user?.primaryEmailAddress?.emailAddress) {
      setError("User not authenticated");
      return;
    }

    const start = dayjs(selectedRange.startDate);
    const end = dayjs(selectedRange.endDate);
    const days = end.diff(start, "day") + 1;

    // 🔑 Minimal valid itinerary
    const itinerary = Array.from({ length: days }, (_, i) => ({
      date: start.add(i, "day").toISOString(),
      activities: [],
    }));

    const tripData = {
      tripName: `Trip to ${chosenLocation}`,
      background: chosenLocation, // OSM-only (no Google)
      startDate: selectedRange.startDate,
      endDate: selectedRange.endDate,
      startDay: "1",
      endDay: String(days),
      itinerary,
      clerkUserId: user.id,
      userData: {
        email: user.primaryEmailAddress.emailAddress,
        name: user.fullName || "",
      },
    };

    const token = await getToken();

    const res = await axios.post(
      "http://localhost:3000/api/trips",
      tripData,
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      }
    );

    const createdTrip = res.data.trip;

    // ✅ UPDATE CONTEXT
    addTrip(createdTrip);
    setActiveTrip(createdTrip);

    // ✅ GO TO OVERVIEW
    navigation.navigate("TripOverview");

  } catch (e: any) {
    console.error(e?.response?.data || e.message);
   setError(
  e?.response?.data?.error ||
  JSON.stringify(e?.response?.data) ||
  e.message
);

  } finally {
    setIsLoading(false);
  }
};




  return (
    <SafeAreaView className="flex-1 bg-white px-5">
      {/* HEADER */}
      <TouchableOpacity onPress={() => navigation.goBack()} className="mt-2">
        <Ionicons name="close" size={28} />
      </TouchableOpacity>

      <Text className="text-2xl font-bold mt-4">Plan a new trip</Text>
      <Text className="text-gray-500 mb-6">
        Build an itinerary and map out your travel
      </Text>

      {/* WHERE TO */}
      <TouchableOpacity
        onPress={() => setSearchVisible(true)}
        className="border rounded-xl px-4 py-3 mb-4"
      >
        <Text className="text-sm font-semibold">Where to?</Text>
        <Text className="text-gray-500">
          {chosenLocation || "e.g., Paris, Japan"}
        </Text>
      </TouchableOpacity>

      {/* DATES */}
      <TouchableOpacity
        className="border rounded-xl px-4 py-3 mb-6"
        onPress={() => setCalendarVisible(true)}
      >
        <Text className="text-sm font-semibold">Dates</Text>
        <Text className="text-gray-500">
          {displayStart && displayEnd
            ? `${dayjs(displayStart).format("MMM D")} - ${dayjs(displayEnd).format(
                "MMM D"
              )}`
            : "Select dates"}
        </Text>
      </TouchableOpacity>

      {error && <Text className="text-red-500 mb-3">{error}</Text>}

      <TouchableOpacity
        onPress={handleCreateTrip}
        className="bg-orange-500 py-3 rounded-full items-center"
        disabled={isLoading}
      >
        {isLoading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text className="text-white font-semibold">Start planning</Text>
        )}
      </TouchableOpacity>

      {/* 📅 CALENDAR MODAL */}
      <Modal transparent visible={calendarVisible}>
        <View className="flex-1 bg-black/60 justify-center">
          <View className="bg-white rounded-2xl mx-4">
            <Calendar
              markingType="period"
              markedDates={getMarkedDates()}
              onDayPress={handleDayPress}
              minDate={today}
            />
            <Pressable
              onPress={onSaveDates}
              className="p-4 items-center border-t"
            >
              <Text className="font-semibold">Save</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* 🔍 SEARCH MODAL */}
      <Modal visible={searchVisible} animationType="fade">
        <SafeAreaView className="flex-1 bg-white px-4 pt-8">
          <View className="flex-row items-center mb-4">
            <TouchableOpacity
              onPress={() => setSearchVisible(false)}
              className="mr-3"
            >
              <Ionicons name="arrow-back" size={24} />
            </TouchableOpacity>
            <Text className="text-lg font-semibold">Search for a place</Text>
          </View>

          <TextInput
            value={searchText}
            onChangeText={searchPlaces}
            placeholder="Search for a place"
            className="bg-gray-100 rounded-full px-4 py-3 mb-2"
          />

          {searchLoading && <ActivityIndicator className="mt-2" />}

          <FlatList
            data={results}
            keyExtractor={(_, i) => i.toString()}
            renderItem={({ item }) => (
              <TouchableOpacity
                className="p-3 border-b"
                onPress={() => {
                  setChosenLocation(item.display_name);
                  setSearchVisible(false);
                  setSearchText("");
                  setResults([]);
                }}
              >
                <Text>{item.display_name}</Text>
              </TouchableOpacity>
            )}
          />
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
};

export default NewTripScreen;
