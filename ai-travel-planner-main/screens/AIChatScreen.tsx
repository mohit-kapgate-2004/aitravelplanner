import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
} from "react-native";
import { useState } from "react";
import { useRoute, useNavigation } from "@react-navigation/native";

export default function AIChatScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();

  // ✅ SAFETY GUARD
  if (!route.params || !route.params.trip) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
        <Text style={{ color: "red" }}>
          ❌ Trip data missing. Please reopen this screen from Trip Overview.
        </Text>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={{ marginTop: 10, color: "blue" }}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const { trip } = route.params;

  const [messages, setMessages] = useState([
    {
      role: "assistant",
      content:
        "Hi 👋\nYou can modify your trip.\n\nExamples:\n• Remove beaches\n• Add nightlife\n• Regenerate day 2",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  const sendMessage = async () => {
    if (!input.trim() || loading) return;

    const userMsg = { role: "user", content: input };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("http://localhost:3000/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userMsg.content,
          tripId: trip._id,
        }),
      });

      const updatedTrip = await res.json();

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "✅ I’ve updated your itinerary.",
        },
      ]);

      // 🔁 Go back with updated trip
      navigation.replace("TripOverview", { trip: updatedTrip });
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "❌ Failed to update trip." },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: "#fff", padding: 16 }}>
      <FlatList
        data={messages}
        keyExtractor={(_, i) => i.toString()}
        style={{ flex: 1 }}
        renderItem={({ item }) => (
          <View
            style={{
              alignSelf: item.role === "user" ? "flex-end" : "flex-start",
              backgroundColor: item.role === "user" ? "#2563eb" : "#e5e7eb",
              padding: 10,
              borderRadius: 12,
              marginVertical: 4,
              maxWidth: "85%",
            }}
          >
            <Text style={{ color: item.role === "user" ? "#fff" : "#000" }}>
              {item.content}
            </Text>
          </View>
        )}
      />

      <View style={{ flexDirection: "row", marginTop: 8 }}>
        <TextInput
          value={input}
          onChangeText={setInput}
          placeholder="Tell me how to change the trip…"
          style={{
            flex: 1,
            borderWidth: 1,
            borderColor: "#ddd",
            borderRadius: 20,
            paddingHorizontal: 12,
            marginRight: 8,
          }}
        />
        <TouchableOpacity
          onPress={sendMessage}
          style={{
            backgroundColor: "#000",
            paddingHorizontal: 16,
            justifyContent: "center",
            borderRadius: 20,
          }}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={{ color: "#fff" }}>Send</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}
