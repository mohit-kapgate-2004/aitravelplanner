import React from "react";
import { View, Text, ScrollView } from "react-native";
import { useTrip } from "../context/TripContext";

/**
 * This screen is used to render itinerary data
 * coming from AI or backend.
 * It relies ONLY on TripContext.
 */

export default function TripScreen({ embedded }: any) {
  const { itinerary } = useTrip();

  if (!itinerary || itinerary.length === 0) {
    return (
      <View style={{ padding: 16 }}>
        <Text style={{ fontSize: 14, color: "#666" }}>
          No itinerary generated yet
        </Text>
      </View>
    );
  }

  return (
    <ScrollView style={{ padding: 16 }}>
      {itinerary.map((day: any, index: number) => (
        <View key={index} style={{ marginBottom: 20 }}>
          <Text style={{ fontWeight: "bold", fontSize: 16, marginBottom: 6 }}>
            Day {index + 1}
          </Text>

          {day.activities && day.activities.length > 0 ? (
            day.activities.map((activity: any, i: number) => (
              <View key={i} style={{ marginBottom: 6 }}>
                <Text style={{ fontSize: 14 }}>
                  • {activity.name || "Unnamed place"}
                </Text>
                {activity.formatted_address && (
                  <Text style={{ fontSize: 12, color: "#777" }}>
                    {activity.formatted_address}
                  </Text>
                )}
              </View>
            ))
          ) : (
            <Text style={{ fontSize: 13, color: "#999" }}>
              No activities planned
            </Text>
          )}
        </View>
      ))}
    </ScrollView>
  );
}
