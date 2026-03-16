import { View, Text, ScrollView, TouchableOpacity } from "react-native";
import MapView, { Marker } from "react-native-maps";
import { useRoute } from "@react-navigation/native";
import { useRef, useState } from "react";

export default function TripOverviewScreen() {
  const route = useRoute<any>();
  const { trip } = route.params;

  const mapRef = useRef<MapView>(null);
  const [selectedPlace, setSelectedPlace] = useState<any>(null);

  const allPlaces = trip.itinerary.flatMap((day: any) => day.activities);

  const focusPlace = (place: any) => {
    setSelectedPlace(place);

    mapRef.current?.animateToRegion({
      latitude: place.geometry.location.lat,
      longitude: place.geometry.location.lng,
      latitudeDelta: 0.05,
      longitudeDelta: 0.05,
    });
  };

  return (
    <View className="flex-1 bg-white">
      {/* ITINERARY */}
      <ScrollView className="flex-1 p-4">
        {trip.itinerary.map((day: any, index: number) => (
          <View key={index} className="mb-6">
            <Text className="text-lg font-bold mb-2">
              Day {index + 1}
            </Text>

            {day.activities.map((place: any, i: number) => (
              <TouchableOpacity
                key={i}
                onPress={() => focusPlace(place)}
                className={`rounded-lg p-3 mb-2 ${
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
      <MapView
        ref={mapRef}
        style={{ height: 300 }}
        initialRegion={{
          latitude: allPlaces[0].geometry.location.lat,
          longitude: allPlaces[0].geometry.location.lng,
          latitudeDelta: 1,
          longitudeDelta: 1,
        }}
      >
        {allPlaces.map((place: any, index: number) => (
          <Marker
            key={index}
            coordinate={{
              latitude: place.geometry.location.lat,
              longitude: place.geometry.location.lng,
            }}
            title={place.name}
          />
        ))}
      </MapView>
    </View>
  );
}
