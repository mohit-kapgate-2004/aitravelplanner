import { createNativeStackNavigator } from '@react-navigation/native-stack';
import AIChatScreen from '../screens/AIChatScreen';

export type AIChatStackParamList = {
  AIChatMain: undefined;
};

const Stack = createNativeStackNavigator<AIChatStackParamList>();

const AIChatStack = () => {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="AIChatMain" component={AIChatScreen} />
    </Stack.Navigator>
  );
};

export default AIChatStack;
