import MapView, { Marker } from "react-native-maps";
import { useRoute } from "@react-navigation/native";
import { View, Text } from "react-native";

export default function MapScreen() {
  const route = useRoute<any>();
  const { trip } = route.params;

  const places = trip.itinerary.flatMap((d: any) => d.activities);

  if (!places.length) {
    return (
      <View className="flex-1 items-center justify-center">
        <Text>No places found</Text>
      </View>
    );
  }

  return (
    <MapView
      className="flex-1"
      initialRegion={{
        latitude: places[0].geometry.location.lat,
        longitude: places[0].geometry.location.lng,
        latitudeDelta: 0.5,
        longitudeDelta: 0.5
      }}
    >
      {places.map((p: any, i: number) => (
        <Marker
          key={i}
          coordinate={{
            latitude: p.geometry.location.lat,
            longitude: p.geometry.location.lng
          }}
          title={p.name}
          description={p.formatted_address}
        />
      ))}
    </MapView>
  );
}
