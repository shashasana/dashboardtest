export default async function handler(req, res) {
  const { lat, lng } = req.query;                  // get lat/lng from client
  const apiKey = process.env.OPENWEATHER_API_KEY; // secret key from Vercel env

  try {
    const response = await fetch(
      `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lng}&appid=${apiKey}&units=metric`
    );
    const data = await response.json();
    res.status(200).json(data);                   // send JSON back to browser
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch weather" });
  }
}
