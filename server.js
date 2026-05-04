require("dotenv").config();
const express = require("express");
const Stripe = require("stripe");
const app = express();
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
app.use(express.json());
app.use(express.static(__dirname));
const allowedSlots = ["8:00 PM","10:00 PM","12:00 AM","2:00 AM","4:00 AM","10:00 AM","12:00 PM"];
const BASE_FARE = 20;
const PER_MILE = 2.50;
const MINIMUM_FARE = 50;

app.post("/calculate-fare", async (req, res) => {
  try {
    const { pickup, airport } = req.body;
    if (!pickup || !airport) return res.status(400).json({ error: "Pickup address and airport are required." });
    if (!process.env.GOOGLE_MAPS_API_KEY) return res.status(500).json({ error: "Google Maps API key is missing on the server." });

    const params = new URLSearchParams({ origins: pickup, destinations: airport, units: "imperial", key: process.env.GOOGLE_MAPS_API_KEY });
    const response = await fetch(`https://maps.googleapis.com/maps/api/distancematrix/json?${params.toString()}`);
    const data = await response.json();

    if (data.status !== "OK") return res.status(400).json({ error: "Google Maps could not read that address." });
    const element = data.rows?.[0]?.elements?.[0];
    if (!element || element.status !== "OK") return res.status(400).json({ error: "Could not calculate distance from pickup to airport." });

    const miles = Math.round((element.distance.value / 1609.344) * 10) / 10;
    const duration = element.duration.text;
    const fare = Math.ceil(Math.max(MINIMUM_FARE, BASE_FARE + (miles * PER_MILE)));
    res.json({ miles, duration, fare, baseFare: BASE_FARE, perMile: PER_MILE, minimumFare: MINIMUM_FARE });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Mileage calculation failed." });
  }
});

app.post("/create-checkout-session", async (req, res) => {
  try {
    const { name, phone, pickup, airport, date, slot, miles, duration, fare } = req.body;
    if (!allowedSlots.includes(slot)) return res.status(400).json({ error: "Invalid pickup time." });
    const amount = Math.round(Number(fare) * 100);
    if (!amount || amount < 5000) return res.status(400).json({ error: "Invalid fare amount." });

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [{ price_data: { currency: "usd", product_data: { name: "Houston Airport Slots - Scheduled Airport Ride", description: `${date} at ${slot} | ${miles} miles | ${pickup} to ${airport}` }, unit_amount: amount }, quantity: 1 }],
      metadata: { site: "HoustonAirportSlots.com", customer_name: name || "", customer_phone: phone || "", pickup: pickup || "", airport: airport || "", pickup_date: date || "", pickup_time: slot || "", miles: String(miles || ""), duration: duration || "", fare: String(fare || "") },
      success_url: `${process.env.DOMAIN}/success.html`,
      cancel_url: `${process.env.DOMAIN}/cancel.html`
    });
    res.json({ url: session.url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Stripe checkout error." });
  }
});
const port = process.env.PORT || 4242;
app.listen(port, () => console.log(`Houston Airport Slots running on http://localhost:${port}`));
