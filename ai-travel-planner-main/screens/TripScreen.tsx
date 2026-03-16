import { View, Text, ScrollView } from "react-native";
import { useRoute } from "@react-navigation/native";

export default function TripScreen() {
  const route = useRoute<any>();
  const { trip } = route.params;

  return (
    <ScrollView className="flex-1 p-4 bg-white">
      <Text className="text-2xl font-bold mb-4">{trip.tripName}</Text>

      {trip.itinerary.map((day: any, i: number) => (
        <View key={i} className="mb-6">
          <Text className="text-lg font-semibold mb-2">
            Day {i + 1}
          </Text>

          {day.activities.map((a: any, j: number) => (
            <View key={j} className="bg-gray-100 p-3 rounded mb-2">
              <Text className="font-semibold">{a.name}</Text>
              <Text className="text-sm text-gray-600">
                {a.formatted_address}
              </Text>
            </View>
          ))}
        </View>
      ))}
    </ScrollView>
  );
}
