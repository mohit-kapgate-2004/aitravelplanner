import mongoose from "mongoose";

/* ===============================
   ACTIVITY (OSM ONLY)
=============================== */
const activitySchema = new mongoose.Schema({
  date: {
    type: Date,
    required: true
  },
  name: {
    type: String,
    required: true
  },
  formatted_address: {
    type: String,
    required: true
  },
  geometry: {
    location: {
      lat: { type: Number, required: true },
      lng: { type: Number, required: true }
    }
  }
});

/* ===============================
   DAY ITINERARY
=============================== */
const daySchema = new mongoose.Schema({
  date: {
    type: Date,
    required: true
  },
  activities: [activitySchema]
});

/* ===============================
   TRIP
=============================== */
const tripSchema = new mongoose.Schema(
  {
    tripName: {
      type: String,
      required: true
    },
    background: {
      type: String,
      required: true
    },
    startDate: {
      type: Date,
      required: true
    },
    endDate: {
      type: Date,
      required: true
    },
    startDay: {
      type: Number,
      required: true
    },
    endDay: {
      type: Number,
      required: true
    },
    itinerary: [daySchema],

    travelers: [],
    budget: {
      type: Number,
      default: 0
    },
    expenses: [],
    placesToVisit: []
  },
  { timestamps: true }
);

export default mongoose.model("Trip", tripSchema);
