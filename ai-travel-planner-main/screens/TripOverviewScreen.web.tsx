import { View, Text, ScrollView, TouchableOpacity, Modal, TextInput } from "react-native";
import { useRoute } from "@react-navigation/native";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import { useState } from "react";
import "leaflet/dist/leaflet.css";
import L from "leaflet";

// Fix marker icons for web
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl:
    "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl:
    "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl:
    "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

export default function TripOverviewScreen() {
  const route = useRoute<any>();
  const { trip } = route.params;

  // ✅ LOCAL STATE (IMPORTANT)
  const [localTrip, setLocalTrip] = useState(trip);
  const [selectedPlace, setSelectedPlace] = useState<any>(null);

  // ✅ AI STATE
  const [aiOpen, setAiOpen] = useState(false);
  const [aiText, setAiText] = useState("");
  const [aiLoading, setAiLoading] = useState(false);

  // ✅ USE localTrip (NOT trip)
  const allPlaces = localTrip.itinerary.flatMap((day: any) => day.activities);

  const center = selectedPlace
    ? [
        selectedPlace.geometry.location.lat,
        selectedPlace.geometry.location.lng,
      ]
    : [
        allPlaces[0].geometry.location.lat,
        allPlaces[0].geometry.location.lng,
      ];

  // ✅ AI MODIFY FUNCTION
  const modifyWithAI = async () => {
    if (!aiText.trim()) return;

    try {
      setAiLoading(true);

      const res = await fetch("http://localhost:3000/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: aiText,
          tripId: localTrip._id,
        }),
      });

      const updatedTrip = await res.json();
      setLocalTrip(updatedTrip);
      setSelectedPlace(null);
      setAiText("");
      setAiOpen(false);
    } catch (e) {
      console.error("AI modify failed", e);
    } finally {
      setAiLoading(false);
    }
  };

  return (
    <View className="flex-1 flex-row bg-white">
      {/* ITINERARY */}
      <ScrollView className="w-1/2 p-4">
        <TouchableOpacity
          onPress={() => setAiOpen(true)}
          className="bg-black px-4 py-2 rounded-full mb-4 self-start"
        >
          <Text className="text-white font-semibold">✨ Modify with AI</Text>
        </TouchableOpacity>

        {localTrip.itinerary.map((day: any, index: number) => (
          <View key={index} className="mb-6">
            <Text className="text-lg font-bold mb-2">
              Day {index + 1}
            </Text>

            {day.activities.map((place: any, i: number) => (
              <TouchableOpacity
                key={i}
                onPress={() => setSelectedPlace(place)}
                className={`rounded-xl p-3 mb-2 ${
                  selectedPlace?.name === place.name
                    ? "bg-orange-200"
                    : "bg-gray-100"
                }`}
              >
                <Text className="font-semibold">{place.name}</Text>
                <Text className="text-gray-500 text-sm">
                  {place.formatted_address}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        ))}
      </ScrollView>

      {/* MAP */}
      <View className="w-1/2">
        <MapContainer
          key={selectedPlace?.name}
          center={center}
          zoom={9}
          style={{ height: "100%", width: "100%" }}
        >
          <TileLayer
            attribution="© OpenStreetMap contributors"
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          {allPlaces.map((place: any, index: number) => (
            <Marker
              key={index}
              position={[
                place.geometry.location.lat,
                place.geometry.location.lng,
              ]}
            >
              <Popup>{place.name}</Popup>
            </Marker>
          ))}
        </MapContainer>
      </View>

      {/* AI MODAL */}
      <Modal transparent visible={aiOpen}>
        <View className="flex-1 bg-black/60 justify-center p-6">
          <View className="bg-white rounded-xl p-4">
            <Text className="font-bold mb-2">Modify itinerary</Text>

            <TextInput
              value={aiText}
              onChangeText={setAiText}
              placeholder="e.g. remove beaches, add nightlife"
              className="border rounded-lg p-3 mb-3"
            />

            <TouchableOpacity
              onPress={modifyWithAI}
              className="bg-orange-500 rounded-lg p-3 items-center"
              disabled={aiLoading}
            >
              <Text className="text-white font-semibold">
                {aiLoading ? "Updating..." : "Apply"}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => setAiOpen(false)}
              className="mt-2 items-center"
            >
              <Text className="text-gray-500">Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}
