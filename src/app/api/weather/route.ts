export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type GeocodingResult = { name: string; admin1?: string; country?: string; latitude: number; longitude: number; timezone?: string };
type HourlyWeather = { time?: string[]; temperature_2m?: (number | null)[] };

function temperatureAt(hourly: HourlyWeather, date: string, time: string) {
  const target = Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
  const times = hourly.time || [];
  const values = hourly.temperature_2m || [];
  let nearest = -1;
  let distance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < times.length; index += 1) {
    if (!times[index]?.startsWith(date + "T")) continue;
    const hour = Number(times[index].slice(11, 13)) * 60 + Number(times[index].slice(14, 16));
    const difference = Math.abs(hour - target);
    if (difference < distance && values[index] != null) { nearest = index; distance = difference; }
  }
  if (nearest < 0) return null;
  const temp = Number(values[nearest]);
  return { label: temp.toFixed(1) + "°C (nearest hour " + times[nearest].slice(11, 16) + ")", value: temp };
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { location?: string; date?: string; startTime?: string; endTime?: string };
    const location = body.location?.trim() || "";
    const date = body.date || "";
    const startTime = body.startTime || "";
    const endTime = body.endTime || "";
    if (!location || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(startTime) || !/^\d{2}:\d{2}$/.test(endTime)) {
      return Response.json({ error: "Enter a location, run date, start time, and finish time to look up weather." }, { status: 400 });
    }

    const geoUrl = new URL("https://geocoding-api.open-meteo.com/v1/search");
    geoUrl.searchParams.set("name", location);
    geoUrl.searchParams.set("count", "1");
    geoUrl.searchParams.set("language", "en");
    const geoResponse = await fetch(geoUrl, { cache: "no-store", signal: AbortSignal.timeout(12000) });
    if (!geoResponse.ok) return Response.json({ error: "Open-Meteo could not find that location." }, { status: 502 });
    const geo = await geoResponse.json() as { results?: GeocodingResult[] };
    const place = geo.results?.[0];
    if (!place) return Response.json({ error: "No matching location found. Try adding a city, region, and country." }, { status: 404 });

    const dateParts = new Intl.DateTimeFormat("en-CA", { timeZone: place.timezone || "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
    const today = `${dateParts.find((part) => part.type === "year")?.value}-${dateParts.find((part) => part.type === "month")?.value}-${dateParts.find((part) => part.type === "day")?.value}`;
    const isForecast = date > today;
    const weatherUrl = new URL(isForecast ? "https://api.open-meteo.com/v1/forecast" : "https://archive-api.open-meteo.com/v1/archive");
    weatherUrl.searchParams.set("latitude", String(place.latitude));
    weatherUrl.searchParams.set("longitude", String(place.longitude));
    weatherUrl.searchParams.set("start_date", date);
    weatherUrl.searchParams.set("end_date", date);
    weatherUrl.searchParams.set("hourly", "temperature_2m");
    weatherUrl.searchParams.set("timezone", "auto");
    weatherUrl.searchParams.set("temperature_unit", "celsius");
    if (isForecast) weatherUrl.searchParams.set("forecast_days", "16");
    const weatherResponse = await fetch(weatherUrl, { cache: "no-store", signal: AbortSignal.timeout(15000) });
    const weather = await weatherResponse.json() as { hourly?: HourlyWeather; reason?: string; error?: boolean };
    if (!weatherResponse.ok || !weather.hourly) {
      return Response.json({ error: weather.reason || "Hourly weather is unavailable for that date. You can still enter temperatures manually." }, { status: 502 });
    }
    const start = temperatureAt(weather.hourly, date, startTime);
    const end = temperatureAt(weather.hourly, date, endTime);
    if (!start || !end) return Response.json({ error: "No hourly temperature was available for one of those times. You can enter the temperatures manually." }, { status: 404 });
    const label = [place.name, place.admin1, place.country].filter(Boolean).join(", ");
    return Response.json({ weatherStart: start.label, weatherEnd: end.label, location: label, source: isForecast ? "forecast" : "historical" }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error && error.name === "TimeoutError" ? "Weather lookup timed out. Try again or enter temperatures manually." : "Weather lookup failed. You can enter temperatures manually.";
    return Response.json({ error: message }, { status: 502 });
  }
}
