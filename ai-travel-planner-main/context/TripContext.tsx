import React, { createContext, useContext, useEffect, useState } from "react";
import axios from "axios";

/* =========================
   TYPES
========================= */

export type Trip = {
  _id: string;
  tripName: string;
  background: string;
  startDate: string;
  endDate: string;
  itinerary: any[];
};

type TripContextType = {
  trips: Trip[];
  activeTrip: Trip | null;
  loading: boolean;

  loadTrips: () => Promise<void>;
  setActiveTrip: (trip: Trip) => void;
  updateTrip: (updatedTrip: Trip) => void;
  addTrip: (trip: Trip) => void;   // ✅ ADD THIS
  clearActiveTrip: () => void;
};


/* =========================
   CONTEXT
========================= */

const TripContext = createContext<TripContextType | undefined>(undefined);

/* =========================
   PROVIDER
========================= */

export const TripProvider = ({ children }: { children: React.ReactNode }) => {
  const [trips, setTrips] = useState<Trip[]>([]);
  const [activeTrip, setActiveTripState] = useState<Trip | null>(null);
  const [loading, setLoading] = useState(false);

  /* =========================
     LOAD ALL TRIPS
  ========================= */
  const loadTrips = async (clerkUserId?: string, email?: string) => {
  try {
    setLoading(true);

    const res = await axios.get("http://localhost:3000/api/trips", {
      params: { clerkUserId, email },
    });

    setTrips(res.data.trips || []);
  } catch (err) {
    console.error("Failed to load trips", err);
  } finally {
    setLoading(false);
  }
  const addTrip = (trip: Trip) => {
  setTrips((prev) => [trip, ...prev]);
  };
};


  /* =========================
     SET ACTIVE TRIP
  ========================= */
  const setActiveTrip = (trip: Trip) => {
    setActiveTripState(trip);
  };

  /* =========================
     UPDATE TRIP (AI / EDITS)
  ========================= */
  const updateTrip = (updatedTrip: Trip) => {
    setTrips((prev) =>
      prev.map((t) => (t._id === updatedTrip._id ? updatedTrip : t))
    );

    setActiveTripState((prev) =>
      prev && prev._id === updatedTrip._id ? updatedTrip : prev
    );
  };

  /* =========================
     CLEAR ACTIVE TRIP
  ========================= */
  const clearActiveTrip = () => {
    setActiveTripState(null);
  };

  /* =========================
     CONTEXT VALUE
  ========================= */
  const value: TripContextType = {
    trips,
    activeTrip,
    loading,
    loadTrips,
    setActiveTrip,
    updateTrip,
    addTrip,
    clearActiveTrip,
  };

  return (
    <TripContext.Provider value={value}>
      {children}
    </TripContext.Provider>
  );
};

/* =========================
   HOOK
========================= */

export const useTrip = () => {
  const context = useContext(TripContext);
  if (!context) {
    throw new Error("useTrip must be used within TripProvider");
  }
  return context;
};
