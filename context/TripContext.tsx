// context/TripContext.tsx
import React, { createContext, useContext, useState } from "react";

export type Trip = {
  id: string;
  location: string;
  startDate?: string;
  endDate?: string;
  image?: string;
  places: string[];
};

type TripContextType = {
  trips: Trip[];
  addTrip: (trip: Trip) => void;

  itinerary: any;
  setItinerary: (itinerary: any) => void;

  messages: any[];
  setMessages: (messages: any[]) => void;
};

const TripContext = createContext<TripContextType | undefined>(undefined);

export const TripProvider = ({ children }: { children: React.ReactNode }) => {
  // ✅ EXISTING STATE (KEPT)
  const [itinerary, setItinerary] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);

  // ✅ REQUIRED STATE (ADDED)
  const [trips, setTrips] = useState<Trip[]>([]);

  // ✅ REQUIRED FUNCTION (ADDED)
  const addTrip = (trip: Trip) => {
    setTrips((prev) => [...prev, trip]);
  };

  return (
    <TripContext.Provider
      value={{
        trips,
        addTrip,

        itinerary,
        setItinerary,

        messages,
        setMessages,
      }}
    >
      {children}
    </TripContext.Provider>
  );
};

export const useTrip = () => {
  const context = useContext(TripContext);
  if (!context) {
    throw new Error("useTrip must be used within TripProvider");
  }
  return context;
};
