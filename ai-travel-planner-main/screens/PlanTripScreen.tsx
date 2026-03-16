import { View, Text, TextInput, FlatList, TouchableOpacity } from "react-native";
import { useState } from "react";
import { useNavigation, useRoute } from "@react-navigation/native";

export default function PlanTripScreen() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const navigation = useNavigation<any>();
  const route = useRoute<any>();

  // ✅ Current trip comes from navigation
  const { trip } = route.params || {};

  const searchPlaces = async (text: string) => {
    setQuery(text);
    if (text.length < 3) return;

    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
        text
      )}&limit=8`,
      { headers: { "User-Agent": "ai-travel-planner" } }
    );
    const data = await res.json();
    setResults(data);
  };

  const handleSelectPlace = (item: any) => {
    const place = {
      name: item.display_name,
      formatted_address: item.display_name,
      geometry: {
        location: {
          lat: Number(item.lat),
          lng: Number(item.lon),
        },
        viewport: {
          northeast: {
            lat: Number(item.lat) + 0.01,
            lng: Number(item.lon) + 0.01,
          },
          southwest: {
            lat: Number(item.lat) - 0.01,
            lng: Number(item.lon) - 0.01,
          },
        },
      },
    };

    // ✅ Go to MapScreen with selected place
    navigation.navigate("MapScreen", {
      places: [place],
      trip,
    });
  };

  return (
    <View className="flex-1 bg-white p-4">
      <Text className="text-xl font-bold mb-4">Plan Your Trip</Text>

      <TextInput
        value={query}
        onChangeText={searchPlaces}
        placeholder="Search place to add"
        className="border p-3 rounded mb-4"
      />

      <FlatList
        data={results}
        keyExtractor={(_, i) => i.toString()}
        renderItem={({ item }) => (
          <TouchableOpacity
            className="p-3 border-b"
            onPress={() => handleSelectPlace(item)}
          >
            <Text>{item.display_name}</Text>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}
