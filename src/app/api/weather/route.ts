export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type GeocodingResult = { name: string; admin1?: string; country?: string; latitude: number; longitude: number; timezone?: string };
type HourlyWeather = { time?: string[]; temperature_2m?: (number | null)[] };

const ONE_DAY = 24 * 60 * 60 * 1000;

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

async function resolveWeatherLocation(location: string): Promise<GeocodingResult | null> {
  const normalized = location.toLowerCase().replace(/[‐‑‒–—-]/g, " ").replace(/\s+/g, " ").trim();
  // The runner's saved default includes city, province and country. Open-Meteo's
  // geocoder accepts only one qualifier; resolve this known place unambiguously.
  // Coordinates: GeoNames ID 1707267 (central Lapu-Lapu City, Cebu).
  if (/\blapu\s+lapu\b/.test(normalized) && /\bcebu\b/.test(normalized)) {
    return { name: "Lapu-Lapu City", admin1: "Cebu", country: "Philippines", latitude: 10.31028, longitude: 123.94944, timezone: "Asia/Manila" };
  }
  const parts = location.split(",").map(part => part.trim()).filter(Boolean);
  const candidates = [...new Set([
    parts.length > 2 ? [parts[0], parts.at(-1)].join(", ") : location,
    parts[0],
    parts[0]?.replace(/[‐‑‒–—-]/g, " "),
  ].filter((name): name is string => Boolean(name)))];

  for (const name of candidates) {
    const geoUrl = new URL("https://geocoding-api.open-meteo.com/v1/search");
    geoUrl.searchParams.set("name", name);
    geoUrl.searchParams.set("count", "5");
    geoUrl.searchParams.set("language", "en");
    const geoResponse = await fetch(geoUrl, { cache: "no-store", signal: AbortSignal.timeout(12000) });
    if (!geoResponse.ok) continue;
    const geo = await geoResponse.json() as { results?: GeocodingResult[] };
    if (geo.results?.length) return geo.results[0];
  }
  return null;
}

function todayInTimezone(timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  return [
    parts.find(part => part.type === "year")?.value,
    parts.find(part => part.type === "month")?.value,
    parts.find(part => part.type === "day")?.value,
  ].join("-");
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { location?: string; date?: string; startTime?: string; endTime?: string };
    const location = body.location?.trim() || "";
    const date = body.date || "";
    const startTime = body.startTime || "";
    const endTime = body.endTime || "";
    if (!location || !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        !/^\d{2}:\d{2}$/.test(startTime) ||
        (endTime && !/^\d{2}:\d{2}$/.test(endTime))) {
      return Response.json({ error: "Enter a location, run date and start time to look up weather." }, { status: 400 });
    }

    const place = await resolveWeatherLocation(location);
    if (!place) return Response.json({ error: "No matching location found. Try a city name with a country." }, { status: 404 });

    const today = todayInTimezone(place.timezone || "UTC");
    const requestedDay = Date.parse(date + "T00:00:00Z");
    const localToday = Date.parse(today + "T00:00:00Z");
    // The historical archive may lag several days. Forecast API supports
    // past_days, allowing weather for today and recent completed runs.
    const useForecast = requestedDay >= localToday - 14 * ONE_DAY;
    if (requestedDay > localToday + 15 * ONE_DAY) {
      return Response.json({ error: "Hourly forecast is not available that far ahead." }, { status: 400 });
    }
    const weatherUrl = new URL(useForecast ? "https://api.open-meteo.com/v1/forecast" : "https://archive-api.open-meteo.com/v1/archive");
    weatherUrl.searchParams.set("latitude", String(place.latitude));
    weatherUrl.searchParams.set("longitude", String(place.longitude));
    weatherUrl.searchParams.set("hourly", "temperature_2m");
    weatherUrl.searchParams.set("timezone", "auto");
    weatherUrl.searchParams.set("temperature_unit", "celsius");
    if (useForecast) {
      // Open-Meteo rejects past_days combined with start_date/end_date.
      // Request the smallest relative window that contains the workout day.
      const dayOffset = Math.round((requestedDay - localToday) / ONE_DAY);
      weatherUrl.searchParams.set("past_days", String(Math.min(14, Math.max(0, -dayOffset))));
      weatherUrl.searchParams.set("forecast_days", String(Math.min(16, Math.max(1, dayOffset + 1))));
    } else {
      weatherUrl.searchParams.set("start_date", date);
      weatherUrl.searchParams.set("end_date", date);
    }
    const weatherResponse = await fetch(weatherUrl, { cache: "no-store", signal: AbortSignal.timeout(15000) });
    const weather = await weatherResponse.json() as { hourly?: HourlyWeather; reason?: string; error?: boolean };
    if (!weatherResponse.ok || !weather.hourly) {
      return Response.json({ error: weather.reason || "Hourly weather is unavailable for that date. You can still enter temperatures manually." }, { status: 502 });
    }
    const start = temperatureAt(weather.hourly, date, startTime);
    const end = endTime ? temperatureAt(weather.hourly, date, endTime) : null;
    if (!start || (endTime && !end)) return Response.json({ error: "Hourly temperatures are unavailable for one of those times. You can enter temperatures manually." }, { status: 404 });
    const label = [place.name, place.admin1, place.country].filter(Boolean).join(", ");
    return Response.json({
      weatherStart: start.label,
      weatherEnd: end?.label || "",
      location: label,
      source: useForecast ? "forecast" : "historical",
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error && error.name === "TimeoutError" ? "Weather lookup timed out. Try again or enter temperatures manually." : "Weather lookup failed. You can enter temperatures manually.";
    return Response.json({ error: message }, { status: 502 });
  }
}
