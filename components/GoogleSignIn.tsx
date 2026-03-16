import { useOAuth } from "@clerk/clerk-expo";
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";
import { View, Text, TouchableOpacity, Image, ActivityIndicator } from "react-native";
import React, { useCallback, useEffect, useState } from "react";

const useWarmUpBrowser = () => {
  useEffect(() => {
    void WebBrowser.warmUpAsync();
    return () => {
      void WebBrowser.coolDownAsync();
    };
  }, []);
};

export default function GoogleSignIn() {
  const { startOAuthFlow } = useOAuth({ strategy: "oauth_google" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useWarmUpBrowser();

  const onGoogleSignInPress = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const { createdSessionId, setActive } = await startOAuthFlow({
        redirectUrl: Linking.createURL("/"),
      });

      if (createdSessionId) {
        await setActive!({ session: createdSessionId });
      } else {
        setError("Google Sign-In incomplete. Please try again.");
      }
    } catch (err: any) {
      console.error("Google Sign-In error:", JSON.stringify(err, null, 2));
      setError(err.errors[0]?.message || "Google Sign-In failed");
    } finally {
      setLoading(false);
    }
  }, [startOAuthFlow]);

  return (
    <View className="w-full">
      {error ? <Text className="text-red-500 text-sm text-center mb-3">{error}</Text> : null}
      <TouchableOpacity
        className="w-full border border-gray-300 py-3 mt-3 rounded-lg flex-row justify-center items-center"
        onPress={onGoogleSignInPress}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color="#FF5722" />
        ) : (
          <>
            <Image
              source={{ uri: "https://www.google.com/favicon.ico" }}
              className="w-5 h-5 mr-2"
            />
            <Text className="text-gray-900 text-base font-semibold">Sign In with Google</Text>
          </>
        )}
      </TouchableOpacity>
    </View>
  );
}