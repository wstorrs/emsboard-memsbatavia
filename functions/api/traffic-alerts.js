export async function onRequestGet(context) {
  const { request, env } = context;

  if (!env.NY511_API_KEY) {
    return Response.json(
      { success: false, error: "NY511_API_KEY is not configured", alerts: [] },
      { status: 500 }
    );
  }

  const url = new URL(request.url);
  const region = (url.searchParams.get("region") || "batavias").toLowerCase();

  const regionCountyMap = {
    batavia: ["Genesee", "Wyoming", "Orleans", "Erie"],
    fingerlakes: ["Ontario", "Wayne", "Seneca", "Yates", "Livingston"]
  };

  const allowedCounties = regionCountyMap[region] || regionCountyMap.batavia;

  const apiUrl =
    "https://511ny.org/api/GetEvents?key=" +
    encodeURIComponent(env.NY511_API_KEY) +
    "&format=json";

  try {
    const response = await fetch(apiUrl, {
      headers: { Accept: "application/json" }
    });

    if (!response.ok) {
      return Response.json(
        {
          success: false,
          error: "511NY request failed: " + response.status,
          alerts: []
        },
        { status: 502 }
      );
    }

    const raw = await response.json();

    const rawEvents = Array.isArray(raw)
      ? raw
      : Array.isArray(raw.Events)
        ? raw.Events
        : Array.isArray(raw.events)
          ? raw.events
          : [];

    const allowedTrafficKeywords = [
      "accident",
      "crash",
      "collision",
      "all lanes closed",
      "blocked",
      "overturned",
      "vehicle fire",
      "multi vehicle",
      "multi-vehicle"
    ];

    const relevantEvents = rawEvents.filter(event => {
      const searchableText = [
        event.EventType,
        event.Type,
        event.Description,
        event.Location,
        event.RoadwayName,
        event.Direction,
        event.Notes
      ].filter(Boolean).join(" ").toLowerCase();

      return allowedTrafficKeywords.some(keyword =>
        searchableText.includes(keyword)
      );
    });

    const filteredEvents = relevantEvents.filter(event => {
      const county = String(event.CountyName || event.countyName || "").trim();

      return allowedCounties.some(allowed =>
        county.toLowerCase() === allowed.toLowerCase()
      );
    });

    const alerts = filteredEvents.map((event, index) => {
      const severityRaw = String(event.Severity || event.severity || "").toLowerCase();

      let severity = "advisory";
      if (
        severityRaw.includes("critical") ||
        severityRaw.includes("major") ||
        severityRaw.includes("high")
      ) {
        severity = "critical";
      } else if (
        severityRaw.includes("medium") ||
        severityRaw.includes("moderate")
      ) {
        severity = "warning";
      } else if (
        severityRaw.includes("low") ||
        severityRaw.includes("minor")
      ) {
        severity = "info";
      }

      return {
        id: String(event.ID || event.Id || event.id || "511ny-event-" + index),
        source: "511NY",
        region,
        severity,
        title: String(
          event.EventType ||
          event.Type ||
          event.RoadwayName ||
          "511NY Traffic Event"
        ),
        message: [
          event.Description,
          event.Location,
          event.Direction,
          event.CountyName
        ].filter(Boolean).join(" - "),
        roadway: String(event.RoadwayName || ""),
        county: String(event.CountyName || ""),
        latitude: event.Latitude || null,
        longitude: event.Longitude || null,
        updated: String(event.LastUpdated || event.Updated || "")
      };
    });

    return Response.json(
      {
        success: true,
        region,
        counties: allowedCounties,
        filters: ["accidents", "closures"],
        alerts
      },
      {
        headers: {
          "Cache-Control": "public, max-age=300"
        }
      }
    );
  } catch (error) {
    return Response.json(
      {
        success: false,
        error: String(error),
        alerts: []
      },
      { status: 500 }
    );
  }
}
