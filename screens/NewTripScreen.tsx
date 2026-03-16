import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Modal,
  Pressable,
  ActivityIndicator,
  FlatList,
  ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Calendar, DateObject } from "react-native-calendars";
import dayjs from "dayjs";
import { useNavigation } from "@react-navigation/native";
import { useAuth, useUser } from "@clerk/clerk-expo";
import axios from "axios";
import { API_BASE_URL } from "../config/api";

type PlaceSuggestion = {
  display_name: string;
  lat: string;
  lon: string;
};

const TRIP_TYPES = [
  "Leisure",
  "Adventure",
  "Family",
  "Honeymoon",
  "Solo",
  "Friends",
  "Business",
];

const STAY_OPTIONS = [
  { id: "budget", label: "Budget" },
  { id: "mid-range", label: "Mid-range" },
  { id: "premium", label: "Premium" },
];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const NewTripScreen = () => {
  const navigation = useNavigation<any>();
  const { getToken } = useAuth();
  const { user } = useUser();

  const [calendarVisible, setCalendarVisible] = useState(false);
  const [searchVisible, setSearchVisible] = useState(false);

  const [selectedRange, setSelectedRange] = useState<{
    startDate?: string;
    endDate?: string;
  }>({});

  const [displayStart, setDisplayStart] = useState("");
  const [displayEnd, setDisplayEnd] = useState("");

  const [searchText, setSearchText] = useState("");
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);

  const [chosenLocation, setChosenLocation] = useState<string | null>(null);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestSearchIdRef = useRef(0);

  const [budgetText, setBudgetText] = useState("");
  const [travelersCount, setTravelersCount] = useState(1);
  const [tripType, setTripType] = useState("Leisure");
  const [accommodationType, setAccommodationType] = useState("mid-range");

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const goBackSafe = () => {
    if (navigation?.canGoBack?.()) {
      navigation.goBack();
      return;
    }
    navigation.navigate("HomeMain");
  };

  const today = dayjs().format("YYYY-MM-DD");

  const totalDays = useMemo(() => {
    if (!selectedRange.startDate || !selectedRange.endDate) return 0;
    return dayjs(selectedRange.endDate).diff(dayjs(selectedRange.startDate), "day") + 1;
  }, [selectedRange.endDate, selectedRange.startDate]);

  const handleDayPress = (day: DateObject) => {
    const selected = day.dateString;

    if (!selectedRange.startDate || (selectedRange.startDate && selectedRange.endDate)) {
      setSelectedRange({ startDate: selected, endDate: undefined });
      return;
    }

    if (dayjs(selected).isBefore(dayjs(selectedRange.startDate))) {
      setSelectedRange({ startDate: selected, endDate: undefined });
      return;
    }

    setSelectedRange({ ...selectedRange, endDate: selected });
  };

  const getMarkedDates = () => {
    const marks: Record<string, any> = {};
    const { startDate, endDate } = selectedRange;

    if (startDate && !endDate) {
      marks[startDate] = {
        startingDay: true,
        endingDay: true,
        color: "#FF5722",
        textColor: "white",
      };
      return marks;
    }

    if (startDate && endDate) {
      let curr = dayjs(startDate);
      const end = dayjs(endDate);

      while (curr.isBefore(end) || curr.isSame(end)) {
        const formatted = curr.format("YYYY-MM-DD");
        marks[formatted] = {
          color: "#FF5722",
          textColor: "white",
          ...(formatted === startDate && { startingDay: true }),
          ...(formatted === endDate && { endingDay: true }),
        };
        curr = curr.add(1, "day");
      }
    }

    return marks;
  };

  const onSaveDates = () => {
    if (!selectedRange.startDate) {
      setCalendarVisible(false);
      return;
    }

    const resolvedEnd = selectedRange.endDate || selectedRange.startDate;
    setSelectedRange({
      startDate: selectedRange.startDate,
      endDate: resolvedEnd,
    });
    setDisplayStart(selectedRange.startDate);
    setDisplayEnd(resolvedEnd);
    setCalendarVisible(false);
  };

  const fetchPlaces = async (text: string) => {
    setSearchText(text);
    const query = text.trim();

    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
      searchDebounceRef.current = null;
    }

    if (query.length < 3) {
      setSuggestions([]);
      setSearchLoading(false);
      return;
    }

    const requestId = latestSearchIdRef.current + 1;
    latestSearchIdRef.current = requestId;
    setSearchLoading(true);

    searchDebounceRef.current = setTimeout(async () => {
      try {
        const res = await axios.get(`${API_BASE_URL}/api/places/search`, {
          params: { q: query, limit: 8 },
        });
        if (latestSearchIdRef.current !== requestId) return;
        const places = Array.isArray(res.data?.places) ? res.data.places : [];
        setSuggestions(places);
      } catch (err) {
        if (latestSearchIdRef.current !== requestId) return;
        setSuggestions([]);
      } finally {
        if (latestSearchIdRef.current === requestId) {
          setSearchLoading(false);
        }
      }
    }, 350);
  };

  useEffect(() => {
    return () => {
      if (searchDebounceRef.current) {
        clearTimeout(searchDebounceRef.current);
      }
    };
  }, []);

  const buildInitialFlow = (startDate: string, dayCount: number) => {
    const flow: any[] = [];

    for (let dayIndex = 0; dayIndex < dayCount; dayIndex++) {
      const date = dayjs(startDate).add(dayIndex, "day").format("YYYY-MM-DD");

      flow.push({
        id: `travel-${dayIndex}-${Date.now()}`,
        type: "travel",
        title: dayIndex === 0 ? "Start journey" : `Transfer for Day ${dayIndex + 1}`,
        detail: "Travel by car and begin the day.",
        transport: "Car",
        day: date,
      });

      flow.push({
        id: `activity-${dayIndex}-${Date.now()}`,
        type: "activity",
        title: `${tripType} plan`,
        detail: `Main ${tripType.toLowerCase()} activities for day ${dayIndex + 1}.`,
        day: date,
      });

      flow.push({
        id: `hotel-${dayIndex}-${Date.now()}`,
        type: "hotel",
        title: "Stay / Rest",
        detail: `${accommodationType} stay for overnight rest.`,
        day: date,
      });
    }

    return flow;
  };

  const buildEmptyItinerary = (startDate: string, dayCount: number) =>
    Array.from({ length: dayCount }, (_, index) => ({
      date: dayjs(startDate).add(index, "day").format("YYYY-MM-DD"),
      activities: [],
    }));

  const buildManualPrompt = ({
    destination,
    dayCount,
    budget,
    travelerCount,
    type,
    stayType,
  }: {
    destination: string;
    dayCount: number;
    budget: number;
    travelerCount: number;
    type: string;
    stayType: string;
  }) =>
    [
      `Plan a ${dayCount} day ${type.toLowerCase()} trip in ${destination}.`,
      `Keep total budget under ${budget} INR.`,
      `Group size is ${travelerCount} friends.`,
      `Preferred stay style: ${stayType}.`,
      `Return a practical itinerary with 3 to 5 places each day, realistic travel flow, and all places only in or near ${destination}.`,
    ].join(" ");

  const generateManualTripDetails = async ({
    tripId,
    prompt,
    clerkUserId,
    email,
  }: {
    tripId: string;
    prompt: string;
    clerkUserId: string;
    email: string;
  }) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await axios.post(`${API_BASE_URL}/api/ai/chat`, {
          tripId,
          message: prompt,
          clerkUserId,
          userData: {
            email,
            name: user?.fullName || "",
          },
        });
        const updatedTrip = res.data?.trip;
        if (updatedTrip?._id) {
          return updatedTrip;
        }
      } catch (err) {
        if (attempt === 0) {
          await sleep(1200);
          continue;
        }
      }
    }
    return null;
  };

  const handleCreateTrip = async () => {
    try {
      setIsLoading(true);
      setError(null);

      if (!chosenLocation || !selectedRange.startDate || !selectedRange.endDate) {
        setError("Please select destination and date range");
        return;
      }

      const budgetValue = Number((budgetText || "").replace(/[^\d]/g, ""));
      if (!Number.isFinite(budgetValue) || budgetValue <= 0) {
        setError("Please enter a valid budget");
        return;
      }

      const clerkUserId = user?.id;
      const email = user?.primaryEmailAddress?.emailAddress;
      if (!clerkUserId || !email) {
        setError("User not authenticated");
        return;
      }

      const dayCount =
        dayjs(selectedRange.endDate).diff(dayjs(selectedRange.startDate), "day") + 1;

      const locationShort = chosenLocation.split(",")[0]?.trim() || chosenLocation;

      const tripData = {
        tripName: `Trip to ${locationShort}`,
        startDate: selectedRange.startDate,
        endDate: selectedRange.endDate,
        startDay: "1",
        endDay: String(dayCount),
        background: `https://source.unsplash.com/featured/?${encodeURIComponent(
          `${locationShort} travel`
        )}`,
        budget: budgetValue,
        itinerary: buildEmptyItinerary(selectedRange.startDate, dayCount),
        flow: buildInitialFlow(selectedRange.startDate, dayCount),
        preferences: {
          travelMode: "driving",
          startFromCurrentLocation: true,
        },
        manualPreferences: {
          tripType,
          activityInterests: [],
          travelPace: "balanced",
          travelersCount,
          accommodationType,
          transportModes: ["driving"],
        },
        placesToVisit: [],
        clerkUserId,
        userData: {
          email,
          name: user?.fullName || "",
        },
      };

      const token = await getToken();
      const res = await axios.post(`${API_BASE_URL}/api/trips`, tripData, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const createdTrip = res.data?.trip;
      if (!createdTrip?._id) {
        setError("Trip created but failed to open details");
        return;
      }

      const aiPrompt = buildManualPrompt({
        destination: chosenLocation,
        dayCount,
        budget: budgetValue,
        travelerCount: travelersCount,
        type: tripType,
        stayType: accommodationType,
      });

      const detailedTrip = await generateManualTripDetails({
        tripId: createdTrip._id,
        prompt: aiPrompt,
        clerkUserId,
        email,
      });

      navigation.navigate("PlanTrip", { trip: detailedTrip || createdTrip });
    } catch (err: any) {
      setError(err?.response?.data?.error || "Failed to create trip");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-white px-5">
      <View className="flex-row items-center justify-between mt-2 mb-4">
        <TouchableOpacity onPress={goBackSafe}>
          <Ionicons name="chevron-back" size={24} color="#111" />
        </TouchableOpacity>
        <Text className="text-sm text-gray-500">Manual Planner</Text>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 120 }}
      >
        <Text className="text-2xl font-bold mb-1">Plan a new trip</Text>
        <Text className="text-gray-500 mb-6">
          Quick setup with only essential details
        </Text>

        <View className="bg-gray-50 border border-gray-200 rounded-2xl p-3 mb-4">
          <Text className="text-sm font-semibold text-gray-800 mb-3">Basic Details</Text>

          <View className="flex-row justify-between">
            <TouchableOpacity
              onPress={() => setSearchVisible(true)}
              className="border border-gray-200 bg-white rounded-xl px-3 py-3"
              style={{ width: "48.5%" }}
            >
              <Text className="text-[11px] text-gray-500 mb-1">Destination</Text>
              <Text className="text-sm text-gray-800" numberOfLines={2}>
                {chosenLocation || "Choose place"}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              className="border border-gray-200 bg-white rounded-xl px-3 py-3"
              onPress={() => setCalendarVisible(true)}
              style={{ width: "48.5%" }}
            >
              <Text className="text-[11px] text-gray-500 mb-1">Dates</Text>
              <Text className="text-sm text-gray-800" numberOfLines={2}>
                {displayStart && displayEnd
                  ? `${dayjs(displayStart).format("MMM D")} - ${dayjs(displayEnd).format(
                      "MMM D"
                    )}`
                  : "Select dates"}
              </Text>
              {totalDays > 0 && (
                <Text className="text-[11px] text-blue-600 mt-1">{totalDays} days</Text>
              )}
            </TouchableOpacity>
          </View>

          <View className="flex-row justify-between mt-3">
            <View style={{ width: "48.5%" }}>
              <Text className="text-[11px] text-gray-500 mb-1">Budget (INR)</Text>
              <TextInput
                placeholder="e.g. 15000"
                keyboardType="numeric"
                value={budgetText}
                onChangeText={setBudgetText}
                className="border border-gray-200 bg-white rounded-xl px-3 py-3"
              />
            </View>

            <View style={{ width: "48.5%" }}>
              <Text className="text-[11px] text-gray-500 mb-1">Travelers</Text>
              <View className="border border-gray-200 bg-white rounded-xl px-3 py-3 flex-row items-center justify-between">
                <TouchableOpacity
                  onPress={() => setTravelersCount((prev) => Math.max(1, prev - 1))}
                  className="w-7 h-7 rounded-full bg-gray-100 items-center justify-center"
                >
                  <Ionicons name="remove" size={14} color="#111" />
                </TouchableOpacity>
                <Text className="font-semibold text-sm">{travelersCount}</Text>
                <TouchableOpacity
                  onPress={() => setTravelersCount((prev) => Math.min(20, prev + 1))}
                  className="w-7 h-7 rounded-full bg-gray-100 items-center justify-center"
                >
                  <Ionicons name="add" size={14} color="#111" />
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>

        <View className="bg-gray-50 border border-gray-200 rounded-2xl p-3 mb-4">
          <Text className="text-sm font-semibold text-gray-800 mb-2">Trip Type</Text>
          <View className="flex-row flex-wrap justify-between">
            {TRIP_TYPES.map((item) => (
              <TouchableOpacity
                key={item}
                onPress={() => setTripType(item)}
                className={`rounded-lg border items-center mb-2 py-2 ${
                  tripType === item
                    ? "bg-orange-500 border-orange-500"
                    : "bg-white border-gray-300"
                }`}
                style={{ width: "31.5%" }}
              >
                <Text
                  className={`text-[11px] font-medium ${
                    tripType === item ? "text-white" : "text-gray-700"
                  }`}
                >
                  {item}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View className="bg-gray-50 border border-gray-200 rounded-2xl p-3 mb-4">
          <Text className="text-sm font-semibold text-gray-800 mb-2">Stay Preference</Text>
          <View className="flex-row justify-between">
            {STAY_OPTIONS.map((item) => (
              <TouchableOpacity
                key={item.id}
                onPress={() => setAccommodationType(item.id)}
                className={`rounded-lg border items-center py-2 ${
                  accommodationType === item.id
                    ? "bg-green-600 border-green-600"
                    : "bg-white border-gray-300"
                }`}
                style={{ width: "31.5%" }}
              >
                <Text
                  className={`text-[11px] font-medium ${
                    accommodationType === item.id ? "text-white" : "text-gray-700"
                  }`}
                >
                  {item.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {error && <Text className="text-red-500 mb-3">{error}</Text>}

        <TouchableOpacity
          onPress={handleCreateTrip}
          disabled={isLoading}
          className="bg-orange-500 rounded-full py-3 items-center"
        >
          {isLoading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text className="text-white font-semibold">Start planning</Text>
          )}
        </TouchableOpacity>
      </ScrollView>

      <Modal transparent visible={calendarVisible}>
        <View className="flex-1 justify-center bg-black/60">
          <View className="bg-white rounded-xl mx-4">
            <Calendar
              markingType="period"
              markedDates={getMarkedDates()}
              onDayPress={handleDayPress}
              minDate={today}
            />
            <Pressable className="p-4 items-center" onPress={onSaveDates}>
              <Text className="font-semibold">Save</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={searchVisible}>
        <SafeAreaView className="flex-1 px-4 pt-10">
          <View className="flex-row items-center mb-4">
            <TouchableOpacity onPress={() => setSearchVisible(false)}>
              <Ionicons name="arrow-back" size={24} />
            </TouchableOpacity>
            <Text className="ml-3 text-lg font-semibold">Search destination</Text>
          </View>

          <TextInput
            placeholder="Type at least 3 letters"
            value={searchText}
            onChangeText={fetchPlaces}
            className="bg-gray-100 rounded-full px-4 py-3 mb-3"
          />

          {searchLoading && <ActivityIndicator />}

          <FlatList
            data={suggestions}
            keyExtractor={(item, index) => `${item.display_name}-${index}`}
            renderItem={({ item }) => (
              <TouchableOpacity
                className="py-3 border-b"
                onPress={() => {
                  setChosenLocation(item.display_name);
                  setSearchVisible(false);
                  setSearchText("");
                  setSuggestions([]);
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

