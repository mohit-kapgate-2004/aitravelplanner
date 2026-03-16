import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import HomeScreen from '../screens/HomeScreen';
import NewTripScreen from '../screens/NewTripScreen';
import PlanTripScreen from '../screens/PlanTripScreen';
import AIChatScreen from '../screens/AIChatScreen';
import MapScreen from '../screens/MapScreen';
import TripOverviewScreen from "../screens/TripOverviewScreen";


export type HomeStackParamList = {
    HomeMain: undefined;
    NewTrip: undefined;
    PlanTrip: { trip: Trip };
  };

const Stack = createNativeStackNavigator<HomeStackParamList>();

const HomeStack = () => {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="HomeMain" component={HomeScreen} />
      <Stack.Screen name="NewTrip" component={NewTripScreen} />
      <Stack.Screen name="TripOverview" component={TripOverviewScreen} />
      <Stack.Screen name="PlanTrip" component={PlanTripScreen} />
      <Stack.Screen name="AIChat" component={AIChatScreen} />
      <Stack.Screen name="MapScreen" component={MapScreen} />
    </Stack.Navigator>
  );
};

export default HomeStack;
