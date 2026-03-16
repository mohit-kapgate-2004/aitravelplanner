import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import axios from 'axios';
import nodemailer from 'nodemailer';

// Initialize Express app
const app = express();
const port = process.env.PORT || 3000;

import Trip from './models/trip.js';
import User from './models/user.js';
import aiRoutes from "./routes/ai.js";


// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use("/api/ai", aiRoutes);

// MongoDB Connection with Mongoose
const mongoURI = process.env.MONGODB_URI || "mongodb+srv://sujan:sujan@cluster0.8pdm6fd.mongodb.net/tripPlanner?retryWrites=true&w=majority";
mongoose.connect(mongoURI)
    
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => {
    console.log("MONGO URI =", mongoURI);
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });






// Nodemailer configuration
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'mohitkapgate2413@gmail.com', // Replace with your email
    pass:'mohit1234', // Replace with your app-specific password
  },
});

// Root Route
app.get('/', (req, res) => {
  res.send('Trip Planner API');
});

// Create Trip Endpoint
app.post('/api/trips', async (req, res) => {
  try {
    const {
      tripName,
      startDate,
      endDate,
      startDay,
      endDay,
      background,
      budget = 0,
      expenses = [],
      placesToVisit = [],
      itinerary = [],
      travelers = [],
      clerkUserId,
      userData = {},
    } = req.body;

    if (!clerkUserId) {
      return res.status(401).json({ error: 'User ID is required' });
    }
    if (!tripName || !startDate || !endDate || !startDay || !endDay || !background) {
      return res.status(400).json({ error: 'Missing required trip fields' });
    }

    let user = await User.findOne({ clerkUserId });
    if (!user) {
      const { email, name } = userData;
      if (!email) {
        return res.status(400).json({ error: 'User email is required' });
      }
      user = new User({ clerkUserId, email, name });
      await user.save();
    }

    const trip = new Trip({
      tripName,
      startDate,
      endDate,
      startDay,
      endDay,
      background,
      host: user._id,
      travelers: [user._id, ...travelers],
      budget,
      expenses,
      placesToVisit,
      itinerary,
    });

    await trip.save();
    res.status(201).json({ message: 'Trip created successfully', trip });
  } catch (error) {
    console.error('Error creating trip:', error);
    res.status(500).json({ error: 'Failed to create trip' });
  }
});

// Get Trips for Current User Endpoint
app.get('/api/trips', async (req, res) => {
  try {
    const { clerkUserId, email } = req.query;
    if (!clerkUserId) {
      return res.status(401).json({ error: 'User ID is required' });
    }

    let user = await User.findOne({ clerkUserId });
    if (!user) {
      if (!email) {
        return res.status(400).json({ error: 'User email is required' });
      }
      user = new User({ clerkUserId, email: email.toString(), name: '' });
      await user.save();
    }

    const trips = await Trip.find({
      $or: [{ host: user._id }, { travelers: user._id }],
    }).populate('host travelers');
    res.status(200).json({ trips });
  } catch (error) {
    console.error('Error fetching trips:', error);
    res.status(500).json({ error: 'Failed to fetch trips' });
  }
});

// Get Single Trip Endpoint
app.get('/api/trips/:tripId', async (req, res) => {
  try {
    const { tripId } = req.params;
    const { clerkUserId } = req.query;

    if (!clerkUserId) {
      return res.status(401).json({ error: 'User ID is required' });
    }

    const user = await User.findOne({ clerkUserId });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const trip = await Trip.findById(tripId).populate('host travelers');
    if (!trip) {
      return res.status(404).json({ error: 'Trip not found' });
    }

    res.status(200).json({ trip });
  } catch (error) {
    console.error('Error fetching trip:', error);
    res.status(500).json({ error: 'Failed to fetch trip' });
  }
});

// Add Place to Trip Endpoint
app.post('/api/trips/:tripId/places', async (req, res) => {
  try {
    const { tripId } = req.params;
    const { placeId } = req.body;
    const API_KEY = 'abc';
    if (!placeId) {
      return res.status(400).json({ error: 'Place ID is required' });
    }

    const trip = await Trip.findById(tripId);
    if (!trip) {
      return res.status(404).json({ error: 'Trip not found' });
    }

    const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&key=${API_KEY}`;
    const response = await axios.get(url);
    const { status, result: details } = response.data;

    if (status !== 'OK' || !details) {
      return res.status(400).json({ error: `Google Places API error: ${status}` });
    }

    const placeData = {
      name: details.name || 'Unknown Place',
      phoneNumber: details.formatted_phone_number || '',
      website: details.website || '',
      openingHours: details.opening_hours?.weekday_text || [],
      photos: details.photos?.map(
        photo => `https://maps.googleapis.com/maps/api/place/photo?maxwidth=400&photoreference=${photo.photo_reference}&key=${API_KEY}`
      ) || [],
      reviews: details.reviews?.map(review => ({
        authorName: review.author_name || 'Unknown',
        rating: review.rating || 0,
        text: review.text || '',
      })) || [],
      types: details.types || [],
      formatted_address: details.formatted_address || 'No address available',
      briefDescription:
        details?.editorial_summary?.overview?.slice(0, 200) + "..." ||
        details?.reviews?.[0]?.text?.slice(0, 200) + "..." ||
        `Located in ${details.address_components?.[2]?.long_name || details.formatted_address || "this area"}. A nice place to visit.`,
      geometry: {
        location: {
          lat: details.geometry?.location?.lat || 0,
          lng: details.geometry?.location?.lng || 0,
        },
        viewport: {
          northeast: {
            lat: details.geometry?.viewport?.northeast?.lat || 0,
            lng: details.geometry?.viewport?.northeast?.lng || 0,
          },
          southwest: {
            lat: details.geometry?.viewport?.southwest?.lat || 0,
            lng: details.geometry?.viewport?.southwest?.lng || 0,
          },
        },
      },
    };

    const updatedTrip = await Trip.findByIdAndUpdate(
      tripId,
      { $push: { placesToVisit: placeData } },
      { new: true }
    );

    res.status(200).json({ message: 'Place added successfully', trip: updatedTrip });
  } catch (error) {
    console.error('Error adding place to trip:', error);
    res.status(500).json({ error: 'Failed to add place to trip' });
  }
});

// Add Place to Itinerary Endpoint
app.post('/api/trips/:tripId/itinerary', async (req, res) => {
  try {
    const { tripId } = req.params;
    const { placeId, date, placeData } = req.body;
    const API_KEY = 'abc';

    if (!date) {
      return res.status(400).json({ error: 'Date is required' });
    }
    if (!placeId && !placeData) {
      return res.status(400).json({ error: 'Either placeId or placeData is required' });
    }

    const trip = await Trip.findById(tripId);
    if (!trip) {
      return res.status(404).json({ error: 'Trip not found' });
    }

    let activityData;

    if (placeData) {
      activityData = {
        date,
        name: placeData.name || 'Unknown Place',
        phoneNumber: placeData.phoneNumber || '',
        website: placeData.website || '',
        openingHours: placeData.openingHours || [],
        photos: placeData.photos || [],
        reviews: placeData.reviews || [],
        types: placeData.types || [],
        formatted_address: placeData.formatted_address || 'No address available',
        briefDescription: placeData.briefDescription || 'No description available',
        geometry: placeData.geometry || {
          location: { lat: 0, lng: 0 },
          viewport: {
            northeast: { lat: 0, lng: 0 },
            southwest: { lat: 0, lng: 0 },
          },
        },
      };
    } else {
      const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&key=${API_KEY}`;
      const response = await axios.get(url);
      const { status, result: details } = response.data;

      if (status !== 'OK' || !details) {
        return res.status(400).json({ error: `Google Places API error: ${status}` });
      }

      activityData = {
        date,
        name: details.name || 'Unknown Place',
        phoneNumber: details.formatted_phone_number || '',
        website: details.website || '',
        openingHours: details.opening_hours?.weekday_text || [],
        photos: details.photos?.map(
          photo => `https://maps.googleapis.com/maps/api/place/photo?maxwidth=400&photoreference=${photo.photo_reference}&key=${API_KEY}`
        ) || [],
        reviews: details.reviews?.map(review => ({
          authorName: review.author_name || 'Unknown',
          rating: review.rating || 0,
          text: review.text || '',
        })) || [],
        types: details.types || [],
        formatted_address: details.formatted_address || 'No address available',
        briefDescription:
          details?.editorial_summary?.overview?.slice(0, 200) + "..." ||
          details?.reviews?.[0]?.text?.slice(0, 200) + "..." ||
          `Located in ${details.address_components?.[2]?.long_name || details.formatted_address || "this area"}. A nice place to visit.`,
        geometry: {
          location: {
            lat: details.geometry?.location?.lat || 0,
            lng: details.geometry?.location?.lng || 0,
          },
          viewport: {
            northeast: {
              lat: details.geometry?.viewport?.northeast?.lat || 0,
              lng: details.geometry?.viewport?.northeast?.lng || 0,
            },
            southwest: {
              lat: details.geometry?.viewport?.southwest?.lat || 0,
              lng: details.geometry?.viewport?.southwest?.lng || 0,
            },
          },
        },
      };
    }

    const existingItinerary = trip.itinerary.find(item => item.date === date);
    let updatedTrip;
    if (existingItinerary) {
      updatedTrip = await Trip.findByIdAndUpdate(
        tripId,
        { $push: { 'itinerary.$[elem].activities': activityData } },
        { arrayFilters: [{ 'elem.date': date }], new: true }
      );
    } else {
      updatedTrip = await Trip.findByIdAndUpdate(
        tripId,
        { $push: { itinerary: { date, activities: [activityData] } } },
        { new: true }
      );
    }

    res.status(200).json({ message: 'Activity added to itinerary successfully', trip: updatedTrip });
  } catch (error) {
    console.error('Error adding activity to itinerary:', error);
    res.status(500).json({ error: 'Failed to add activity to itinerary' });
  }
});

// Send Email Endpoint
app.post('/api/send-email', async (req, res) => {
  try {
    const { email, subject, message } = req.body;

    if (!email || !subject || !message) {
      return res.status(400).json({ error: 'Email, subject, and message are required' });
    }

    const mailOptions = {
      from: 'sujananand0@gmail.com',
      to: email,
      subject: subject,
      text: message,
    };

    await transporter.sendMail(mailOptions);
    res.status(200).json({ message: 'Email sent successfully' });
  } catch (error) {
    console.error('Error sending email:', error);
    res.status(500).json({ error: 'Failed to send email' });
  }
});

// Start Server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});