import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { useUser } from "@clerk/clerk-expo";
import axios from "axios";
import dayjs from "dayjs";
import { API_BASE_URL } from "../config/api";


type FlowItem = {
  id: string;
  type: "travel" | "hotel" | "activity";
  title: string;
  detail?: string;
  transport?: string;
  day?: string;
};

type Trip = {
  _id: string;
  tripName: string;
  startDate: string;
  endDate: string;
  createdAt?: string;
  itinerary?: { date: string; activities: any[] }[];
  flow?: FlowItem[];
};

const typeMeta = {
  travel: { label: "Travel", color: "#3B82F6", icon: "airplane" as const },
  hotel: { label: "Hotel", color: "#F59E0B", icon: "bed" as const },
  activity: { label: "Activity", color: "#22C55E", icon: "location" as const },
};

const ItineraryFlowScreen = () => {
  const navigation = useNavigation<any>();
  const { user } = useUser();
  const [trips, setTrips] = useState<Trip[]>([]);
  const [activeTripId, setActiveTripId] = useState<string | null>(null);
  const [activeTrip, setActiveTrip] = useState<Trip | null>(null);
  const [flow, setFlow] = useState<FlowItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<string>("all");

  const sortedTrips = useMemo(
    () =>
      trips
        .slice()
        .sort(
          (a, b) =>
            new Date(b.createdAt || 0).getTime() -
            new Date(a.createdAt || 0).getTime()
        ),
    [trips]
  );

  const buildFlowFromTrip = (trip: Trip): FlowItem[] => {
    const items: FlowItem[] = [];
    const days = (trip.itinerary || [])
      .slice()
      .sort(
        (a, b) =>
          new Date(a.date).getTime() - new Date(b.date).getTime()
      );

    days.forEach((day, dayIndex) => {
      const dayKey = dayjs(day.date).format("YYYY-MM-DD");

      items.push({
        id: `travel-${dayIndex}-${Date.now()}`,
        type: "travel",
        title: `Travel for Day ${dayIndex + 1}`,
        detail: `Arrive and get ready for ${trip.tripName}.`,
        transport: "Car",
        day: dayKey,
      });

      (day.activities || []).forEach((act: any, idx: number) => {
        items.push({
          id: `act-${dayIndex}-${idx}-${Date.now()}`,
          type: "activity",
          title: act.name || "Activity",
          detail: act.briefDescription || act.formatted_address || "",
          day: dayKey,
        });
      });

      items.push({
        id: `hotel-${dayIndex}-${Date.now()}`,
        type: "hotel",
        title: "Hotel / Rest",
        detail: "Check in, relax, and prepare for the next day.",
        day: dayKey,
      });
    });

    return items;
  };

  const fetchTrips = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const clerkUserId = user?.id;
      const email = user?.primaryEmailAddress?.emailAddress;
      if (!clerkUserId) {
        setError("User not authenticated");
        return;
      }

      const response = await axios.get(`${API_BASE_URL}/api/trips`, {
        params: { clerkUserId, email },
      });

      setTrips(response.data.trips || []);
    } catch (err: any) {
      setError(err.response?.data?.error || "Failed to fetch trips");
    } finally {
      setLoading(false);
    }
  }, [user]);

  const fetchTrip = useCallback(
    async (tripId: string) => {
      try {
        setLoading(true);
        setError(null);
        const clerkUserId = user?.id;
        if (!clerkUserId) {
          setError("User not authenticated");
          return;
        }

        const response = await axios.get(`${API_BASE_URL}/api/trips/${tripId}`, {
          params: { clerkUserId },
        });

        const trip: Trip = response.data.trip;
        setActiveTrip(trip);

        if (trip.flow && trip.flow.length > 0) {
          setFlow(trip.flow);
        } else {
          const generated = buildFlowFromTrip(trip);
          setFlow(generated);
        }
      } catch (err: any) {
        setError(err.response?.data?.error || "Failed to fetch trip");
      } finally {
        setLoading(false);
      }
    },
    [user]
  );

  const saveFlow = async () => {
    if (!activeTripId) return;
    try {
      setSaving(true);
      const clerkUserId = user?.id;
      if (!clerkUserId) {
        setError("User not authenticated");
        return;
      }
      await axios.put(
        `${API_BASE_URL}/api/trips/${activeTripId}/flow`,
        { flow },
        { params: { clerkUserId } }
      );
    } catch (err: any) {
      setError(err.response?.data?.error || "Failed to save flow");
    } finally {
      setSaving(false);
    }
  };

  const resetFromItinerary = () => {
    if (!activeTrip) return;
    const generated = buildFlowFromTrip(activeTrip);
    setFlow(generated);
    setSelectedDay("all");
  };

  const addStep = (type: FlowItem["type"]) => {
    setFlow((prev) => [
      ...prev,
      {
        id: `custom-${type}-${Date.now()}`,
        type,
        title: "New step",
        detail: "",
        transport: type === "travel" ? "Car" : undefined,
        day: dayjs().format("YYYY-MM-DD"),
      },
    ]);
  };

  const updateItem = (id: string, field: "title" | "detail", value: string) => {
    setFlow((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, [field]: value } : item
      )
    );
  };

  const updateTransport = (id: string, transport: string) => {
    setFlow((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, transport } : item
      )
    );
  };

  const moveItem = (id: string, direction: -1 | 1) => {
    setFlow((prev) => {
      const index = prev.findIndex((item) => item.id === id);
      if (index === -1) return prev;
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= prev.length) return prev;
      const list = prev.slice();
      const temp = list[index];
      list[index] = list[nextIndex];
      list[nextIndex] = temp;
      return list;
    });
  };

  const removeItem = (id: string) => {
    setFlow((prev) => prev.filter((item) => item.id !== id));
  };

  useFocusEffect(
    useCallback(() => {
      fetchTrips();
    }, [fetchTrips])
  );

  useEffect(() => {
    if (sortedTrips.length > 0 && !activeTripId) {
      setActiveTripId(sortedTrips[0]._id);
    }
  }, [sortedTrips, activeTripId]);

  useEffect(() => {
    if (activeTripId) {
      fetchTrip(activeTripId);
    }
  }, [activeTripId, fetchTrip]);

  useEffect(() => {
    setSelectedDay("all");
  }, [activeTripId]);

  const dayOptions = useMemo(() => {
    const unique = Array.from(
      new Set(flow.map((item) => item.day).filter(Boolean))
    ) as string[];
    unique.sort(
      (a, b) => new Date(a).getTime() - new Date(b).getTime()
    );
    return unique;
  }, [flow]);

  const displayedFlow =
    selectedDay === "all"
      ? flow
      : flow.filter((item) => item.day === selectedDay);

  const goBackSafe = () => {
    if (navigation?.canGoBack?.()) {
      navigation.goBack();
      return;
    }
    navigation.navigate("Guides", { screen: "GuideMain" });
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <View className="px-4 py-4 border-b border-gray-200">
        <View className="flex-row items-center">
          <TouchableOpacity
            onPress={goBackSafe}
            className="p-2 rounded-full bg-gray-100 mr-2"
          >
            <Ionicons name="chevron-back" size={18} color="#111" />
          </TouchableOpacity>
          <Text className="text-2xl font-bold text-gray-800">Trip Flow</Text>
        </View>
        <Text className="text-sm font-medium text-gray-600 mt-1">
          Manage travel, stay, and activities in one connected timeline.
        </Text>
      </View>

      {error && (
        <Text className="text-red-500 text-sm px-4 mt-3">{error}</Text>
      )}

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 120 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Trip Selector */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          className="mt-4"
          contentContainerStyle={{ paddingHorizontal: 16 }}
        >
          {sortedTrips.map((trip) => (
            <TouchableOpacity
              key={trip._id}
              onPress={() => setActiveTripId(trip._id)}
              className={`px-4 py-2 rounded-full mr-2 border ${
                activeTripId === trip._id
                  ? "bg-orange-500 border-orange-500"
                  : "bg-white border-gray-200"
              }`}
            >
              <Text
                className={`text-sm font-medium ${
                  activeTripId === trip._id ? "text-white" : "text-gray-700"
                }`}
              >
                {trip.tripName}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Day Filter */}
        {dayOptions.length > 0 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            className="mt-3"
            contentContainerStyle={{ paddingHorizontal: 16 }}
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

        <View className="px-4 mt-4">
          <View className="flex-row items-center justify-between">
            <View>
              <Text className="text-lg font-semibold text-gray-900">
                {activeTrip?.tripName || "Select a trip"}
              </Text>
              {activeTrip && (
                <Text className="text-xs text-gray-500 mt-1">
                  {dayjs(activeTrip.startDate).format("MMM D")} -{" "}
                  {dayjs(activeTrip.endDate).format("MMM D")}
                </Text>
              )}
            </View>
            <TouchableOpacity
              disabled={saving}
              onPress={saveFlow}
              className="px-4 py-2 rounded-full bg-black"
            >
              {saving ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text className="text-white text-xs font-semibold">Save</Text>
              )}
            </TouchableOpacity>
          </View>

          <View className="flex-row items-center mt-3">
            <TouchableOpacity
              onPress={resetFromItinerary}
              className="px-3 py-2 rounded-full bg-gray-100 mr-2"
            >
              <Text className="text-xs text-gray-700">Reset from itinerary</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => addStep("travel")}
              className="px-3 py-2 rounded-full bg-blue-100 mr-2"
            >
              <Text className="text-xs text-blue-700">Add Travel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => addStep("hotel")}
              className="px-3 py-2 rounded-full bg-amber-100 mr-2"
            >
              <Text className="text-xs text-amber-700">Add Hotel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => addStep("activity")}
              className="px-3 py-2 rounded-full bg-green-100"
            >
              <Text className="text-xs text-green-700">Add Activity</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View className="px-4 mt-6">
          {loading ? (
            <ActivityIndicator size="large" color="#FF5722" />
          ) : flow.length === 0 ? (
            <Text className="text-gray-500">No flow items yet.</Text>
          ) : (
            displayedFlow.map((item, index) => {
              const meta = typeMeta[item.type];
              const prevItem = displayedFlow[index - 1];
              const showDayLabel = index === 0 || prevItem?.day !== item.day;

              return (
                <View key={item.id} className="mb-6">
                  {showDayLabel && item.day && (
                    <Text className="text-xs text-gray-500 mb-2">
                      {dayjs(item.day).format("ddd, MMM D")}
                    </Text>
                  )}

                  <View className="flex-row">
                    <View className="items-center mr-3">
                      <View
                        style={{ backgroundColor: meta.color }}
                        className="w-3 h-3 rounded-full"
                      />
                      {index < flow.length - 1 && (
                        <View className="flex-1 w-px bg-gray-200" />
                      )}
                    </View>

                    <View className="flex-1 bg-white rounded-xl border border-gray-100 p-3">
                    <View className="flex-row items-center justify-between mb-2">
                      <View className="flex-row items-center">
                        <Ionicons name={meta.icon} size={14} color={meta.color} />
                        <Text className="text-xs text-gray-500 ml-2 uppercase">
                          {meta.label}
                        </Text>
                      </View>
                      <View className="flex-row items-center">
                        <TouchableOpacity
                          onPress={() => moveItem(item.id, -1)}
                          className="mr-2"
                        >
                          <Ionicons name="chevron-up" size={16} color="#9CA3AF" />
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => moveItem(item.id, 1)}
                          className="mr-2"
                        >
                          <Ionicons name="chevron-down" size={16} color="#9CA3AF" />
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => removeItem(item.id)}>
                          <Ionicons name="trash" size={16} color="#9CA3AF" />
                        </TouchableOpacity>
                      </View>
                    </View>

                      <TextInput
                        value={item.title}
                        onChangeText={(text) => updateItem(item.id, "title", text)}
                        className="text-base font-semibold text-gray-900"
                        placeholder="Title"
                      />
                      {item.type === "travel" && (
                        <View className="flex-row flex-wrap mt-2">
                          {["Flight", "Train", "Car", "Bus"].map((mode) => (
                            <TouchableOpacity
                              key={mode}
                              onPress={() => updateTransport(item.id, mode)}
                              className={`px-2.5 py-1 rounded-full mr-2 mb-2 border ${
                                item.transport === mode
                                  ? "bg-blue-500 border-blue-500"
                                  : "bg-white border-gray-200"
                              }`}
                            >
                              <Text
                                className={`text-[11px] font-medium ${
                                  item.transport === mode
                                    ? "text-white"
                                    : "text-gray-700"
                                }`}
                              >
                                {mode}
                              </Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      )}
                      <TextInput
                        value={item.detail}
                        onChangeText={(text) => updateItem(item.id, "detail", text)}
                        className="text-xs text-gray-500 mt-2"
                        placeholder="Details"
                        multiline
                      />
                    </View>
                  </View>
                </View>
              );
            })
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

export default ItineraryFlowScreen;

