import express from "express";
import fetch from "node-fetch";
import Trip from "../models/trip.js";

const router = express.Router();

router.post("/chat", async (req, res) => {
  try {
    const { message, tripId } = req.body;

    if (!message) {
      return res.status(400).json({ error: "Message is required" });
    }

    /* ======================================
       MODIFY EXISTING TRIP (PHASE 3)
    ====================================== */
    if (tripId) {
      const trip = await Trip.findById(tripId);
      if (!trip) {
        return res.status(404).json({ error: "Trip not found" });
      }

      const aiRes = await fetch(
        "https://api.groq.com/openai/v1/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model: "llama-3.1-8b-instant",
            messages: [
              {
                role: "system",
                content: `
You modify an existing trip.
Return ONLY JSON:
{
  "places": [{ "name": "" }]
}
`
              },
              { role: "user", content: message }
            ]
          })
        }
      );

      const aiData = await aiRes.json();
      if (!aiData.choices || !aiData.choices.length) {
  return res.status(500).json({ error: "AI did not return choices" });
}

      let raw = aiData.choices[0].message.content
        .replace(/```json/g, "")
        .replace(/```/g, "")
        .trim();

      const parsed = JSON.parse(
        raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)
      );

      const days = trip.itinerary.length;
      const startDate = new Date(trip.startDate);

      const newItinerary = Array.from({ length: days }, (_, i) => ({
        date: new Date(startDate.getTime() + i * 86400000),
        activities: []
      }));

      let dayIndex = 0;

      for (const place of parsed.places) {
        const geoRes = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&q=${place.name}`,
          { headers: { "User-Agent": "ai-travel-planner" } }
        );
        const geo = await geoRes.json();
        if (!geo.length) continue;

        newItinerary[dayIndex].activities.push({
          name: place.name,
          date: newItinerary[dayIndex].date,
          formatted_address: geo[0].display_name,
          geometry: {
            location: {
              lat: Number(geo[0].lat),
              lng: Number(geo[0].lon)
            }
          }
        });

        dayIndex = (dayIndex + 1) % days;
      }

      trip.itinerary = newItinerary;
      await trip.save();

      return res.json(trip);
    }

    /* ======================================
       CREATE NEW TRIP (PHASE 1)
    ====================================== */
    const aiRes = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "llama-3.1-8b-instant",
          messages: [
            {
              role: "system",
              content: `
Return ONLY JSON:
{
  "city": "",
  "days": number,
  "places": [{ "name": "" }]
}
`
            },
            { role: "user", content: message }
          ]
        })
      }
    );

    const aiData = await aiRes.json();
    if (!aiData.choices || !aiData.choices.length) {
  return res.status(500).json({ error: "AI did not return choices" });
}

    let raw = aiData.choices[0].message.content
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();

    const plan = JSON.parse(
      raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)
    );

    const startDate = new Date();
    const endDate = new Date(startDate);
    endDate.setDate(startDate.getDate() + plan.days - 1);

    const itinerary = Array.from({ length: plan.days }, (_, i) => ({
      date: new Date(startDate.getTime() + i * 86400000),
      activities: []
    }));

    let dayIndex = 0;

    for (const place of plan.places) {
      const geoRes = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${place.name}`,
        { headers: { "User-Agent": "ai-travel-planner" } }
      );
      const geo = await geoRes.json();
      if (!geo.length) continue;

      itinerary[dayIndex].activities.push({
        name: place.name,
        date: itinerary[dayIndex].date,
        formatted_address: geo[0].display_name,
        geometry: {
          location: {
            lat: Number(geo[0].lat),
            lng: Number(geo[0].lon)
          },
          viewport: {
    northeast: {
      lat: Number(geo[0].lat) + 0.01,
      lng: Number(geo[0].lon) + 0.01
    },
    southwest: {
      lat: Number(geo[0].lat) - 0.01,
      lng: Number(geo[0].lon) - 0.01
    }
  }
        }
      });

      dayIndex = (dayIndex + 1) % itinerary.length;
    }

    const trip = await Trip.create({
      tripName: `AI Trip to ${plan.city}`,
      background: plan.city,
      startDate,
      endDate,
      startDay: 1,
      endDay: plan.days,
      itinerary
    });

    res.json(trip);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
