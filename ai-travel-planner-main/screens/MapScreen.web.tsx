import React from "react";
import {
  View,
  Text,
  ScrollView,
  Dimensions,
  Image,
} from "react-native";
import { useRoute } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";

const { width } = Dimensions.get("window");
const CARD_WIDTH = Math.min(width * 0.8, 600);

type Place = {
  id: string;
  name: string;
  briefDescription: string;
  photos: string[];
  formatted_address: string;
  geometry: {
    location: {
      lat: number;
      lng: number;
    };
  };
};

type MapRouteParams = {
  MapScreen: {
    places: Place[];
  };
};

const MapScreen = () => {
  const route = useRoute<RouteProp<MapRouteParams, "MapScreen">>();
  const places = route.params?.places || [];

  return (
    <View style={{ flex: 1, backgroundColor: "#f5f5f5" }}>
      {/* Web Notice */}
      <View style={{ padding: 16, backgroundColor: "#007AFF" }}>
        <Text style={{ color: "white", fontSize: 16, fontWeight: "600", textAlign: "center" }}>
          📍 Map View (Web Version)
        </Text>
        <Text style={{ color: "white", fontSize: 12, textAlign: "center", marginTop: 4 }}>
          Interactive maps require native device. Showing list of places below.
        </Text>
      </View>

      {/* Places List */}
      <ScrollView 
        contentContainerStyle={{ 
          padding: 16,
          alignItems: "center"
        }}
      >
        {places.map((place, index) => (
          <View
            key={index}
            style={{
              width: CARD_WIDTH,
              backgroundColor: "white",
              borderRadius: 16,
              padding: 16,
              marginBottom: 16,
              shadowColor: "#000",
              shadowOffset: { width: 0, height: 2 },
              shadowOpacity: 0.1,
              shadowRadius: 4,
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 8 }}>
              <View style={{
                backgroundColor: "#007AFF",
                width: 32,
                height: 32,
                borderRadius: 16,
                justifyContent: "center",
                alignItems: "center",
                marginRight: 12
              }}>
                <Text style={{ color: "white", fontWeight: "bold" }}>{index + 1}</Text>
              </View>
              <Text style={{ fontSize: 18, fontWeight: "600", flex: 1 }}>
                {place.name || "Unknown Place"}
              </Text>
            </View>

            {place.photos?.[0] && (
              <Image
                source={{ uri: place.photos[0] }}
                style={{ height: 200, width: "100%", borderRadius: 12, marginBottom: 12 }}
                resizeMode="cover"
              />
            )}

            {place.briefDescription && (
              <Text style={{ fontSize: 14, color: "#666", marginBottom: 8, lineHeight: 20 }}>
                {place.briefDescription}
              </Text>
            )}

            {place.formatted_address && (
              <Text style={{ fontSize: 12, color: "#999", marginTop: 4 }}>
                📍 {place.formatted_address}
              </Text>
            )}

            {place.geometry?.location && (
              <Text style={{ fontSize: 11, color: "#999", marginTop: 4 }}>
                Coordinates: {place.geometry.location.lat.toFixed(4)}, {place.geometry.location.lng.toFixed(4)}
              </Text>
            )}
          </View>
        ))}

        {places.length === 0 && (
          <View style={{ padding: 32, alignItems: "center" }}>
            <Text style={{ fontSize: 16, color: "#999" }}>
              No places to display
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
};

export default MapScreen;
