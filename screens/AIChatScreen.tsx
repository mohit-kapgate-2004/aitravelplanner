import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import axios from "axios";
import { Ionicons } from "@expo/vector-icons";
import { useUser } from "@clerk/clerk-expo";
import * as Location from "expo-location";
import { API_BASE_URL } from "../config/api";
import { safeGoBack } from "../utils/navigation";

type Message = {
  role: "user" | "assistant";
  content: string;
};

type UserLocation = {
  lat: number;
  lng: number;
};

const AIChatScreen = ({ navigation, route }: any) => {
  const { user } = useUser();
  const { tripId: initialTripId, tripName: initialTripName } =
    route.params || {};
  const [activeTripId, setActiveTripId] = useState<string | null>(
    initialTripId || null
  );
  const [activeTripName, setActiveTripName] = useState(
    initialTripName || "your trip"
  );

  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content: `Hi! I can plan and update your trip for ${activeTripName}. Tell me your budget, trip type (honeymoon/adventure/family), and days, and I will tailor places and suggestions.`,
    },
  ]);

  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [locationStatus, setLocationStatus] = useState<
    "idle" | "loading" | "ready" | "denied"
  >("idle");
  const [userLocation, setUserLocation] = useState<UserLocation | null>(null);
  const quickPrompts = [
    "Low budget weekend trip near Delhi with food and transport plan",
    "Plan a 5-day honeymoon trip in Kerala with romantic places",
    "Create a 4-day adventure trip with trekking and rafting",
    "Suggest a safe family trip with kids for 3 days",
    "I have only 2 days, suggest nearby short trip options",
  ];

  const flatListRef = useRef<FlatList>(null);

  useEffect(() => {
    flatListRef.current?.scrollToEnd({ animated: true });
  }, [messages]);

  const goBackSafe = () => {
    safeGoBack(navigation);
  };

  const needsCurrentLocation = (text: string) =>
    /near me|nearby|around me|around here|from my location|current location|from here|close to me/i.test(
      text
    );

  const requestCurrentLocation = async () => {
    try {
      setLocationStatus("loading");

      if (Platform.OS === "web") {
        const position = await new Promise<any>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 10000,
          });
        });

        const next = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        };
        setUserLocation(next);
        setLocationStatus("ready");
        return next;
      }

      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        setLocationStatus("denied");
        return null;
      }
      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const next = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
      };
      setUserLocation(next);
      setLocationStatus("ready");
      return next;
    } catch (err) {
      setLocationStatus("denied");
      return null;
    }
  };

  const sendMessage = async (forcedMessage?: string) => {
    const prompt = (forcedMessage || input).trim();
    if (!prompt) return;

    const userMessage: Message = {
      role: "user",
      content: prompt,
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setLoading(true);

    try {
      let locationForRequest = userLocation;
      if (needsCurrentLocation(prompt) && !locationForRequest) {
        locationForRequest = await requestCurrentLocation();
      }

      if (needsCurrentLocation(prompt) && !locationForRequest) {
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content:
              "Please allow location access (or type a city name). Then I can plan a nearby trip from your current location.",
          },
        ]);
        return;
      }

      const payload: any = {
        message: prompt,
        tripId: activeTripId,
        userLocation: locationForRequest || undefined,
      };

      if (!activeTripId) {
        payload.clerkUserId = user?.id;
        payload.userData = {
          email: user?.primaryEmailAddress?.emailAddress,
          name: user?.fullName || user?.firstName || "",
        };
      }

      const res = await axios.post(`${API_BASE_URL}/api/ai/chat`, payload);

      const reply =
        res.data?.reply ||
        "I updated your itinerary. Check the Itinerary tab to see changes.";

      const createdNewTrip = !activeTripId && res.data?.trip?._id;

      if (res.data?.trip?._id && res.data.trip._id !== activeTripId) {
        setActiveTripId(res.data.trip._id);
      }
      if (res.data?.trip?.tripName) {
        setActiveTripName(res.data.trip.tripName);
      }

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: reply,
        },
      ]);

      if (createdNewTrip && res.data?.trip) {
        navigation.navigate("Home", {
          screen: "PlanTrip",
          params: { trip: res.data.trip, initialTab: "Itinerary" },
        });
      }

    } catch (err) {
      console.error("AI Chat error:", err);
      const errorMessage =
        err?.response?.data?.error ||
        "Sorry, I couldn't process that request. Please try again.";
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: errorMessage,
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const renderMessage = ({ item }: { item: Message }) => {
    const isUser = item.role === "user";

    return (
      <View
        className={`my-2 px-4 py-3 rounded-2xl max-w-[80%] ${
          isUser
            ? "bg-blue-500 self-end"
            : "bg-gray-100 self-start"
        }`}
      >
        <Text
          className={`text-sm ${
            isUser ? "text-white" : "text-gray-800"
          }`}
        >
          {item.content}
        </Text>
      </View>
    );
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      className="flex-1 bg-white"
    >
      {/* HEADER */}
      <View className="flex-row items-center px-4 py-3 border-b border-gray-200">
        <TouchableOpacity onPress={goBackSafe}>
          <Ionicons name="arrow-back" size={24} color="#000" />
        </TouchableOpacity>
        <View className="ml-3">
          <Text className="text-lg font-semibold">AI Trip Assistant</Text>
          <Text className="text-xs text-gray-500">
            Ask naturally. I will adapt to budget and trip style.
          </Text>
        </View>
      </View>

      {/* CHAT */}
      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={(_, index) => index.toString()}
        renderItem={renderMessage}
        contentContainerStyle={{ padding: 16 }}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
        <View className="mb-3">
          <View className="flex-row items-center justify-between mb-2">
            <Text className="text-xs font-semibold text-gray-500">
              Quick prompts
            </Text>
            <TouchableOpacity
              onPress={() => {
                void requestCurrentLocation();
              }}
              disabled={loading || locationStatus === "loading"}
              className="px-2.5 py-1 rounded-full border border-sky-200 bg-sky-50"
            >
              <Text className="text-[10px] font-semibold text-sky-700">
                {locationStatus === "ready"
                  ? "Location ready"
                  : locationStatus === "loading"
                  ? "Locating..."
                  : "Use my location"}
              </Text>
            </TouchableOpacity>
          </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {quickPrompts.map((prompt, index) => (
                <TouchableOpacity
                  key={`${prompt}-${index}`}
                  onPress={() => sendMessage(prompt)}
                  disabled={loading}
                  className="mr-2 px-3 py-2 rounded-full bg-orange-50 border border-orange-200"
                >
                  <Text className="text-xs text-orange-700" numberOfLines={1}>
                    {prompt.length > 46 ? `${prompt.slice(0, 46)}...` : prompt}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        }
      />

      {loading && (
        <View className="px-4 pb-1">
          <Text className="text-xs text-gray-500">AI is preparing your plan...</Text>
        </View>
      )}

      {/* INPUT */}
      <View className="flex-row items-center px-3 py-2 border-t border-gray-200">
        <TextInput
          value={input}
          onChangeText={setInput}
          placeholder="Example: Low budget 3-day adventure trip near Delhi"
          className="flex-1 bg-gray-100 rounded-full px-4 py-2 text-sm"
          returnKeyType="send"
          onSubmitEditing={() => {
            void sendMessage();
          }}
        />
        <TouchableOpacity
          onPress={() => {
            void sendMessage();
          }}
          disabled={loading}
          className="ml-2 bg-black w-10 h-10 rounded-full items-center justify-center"
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Ionicons name="send" size={18} color="#fff" />
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
};

export default AIChatScreen;





