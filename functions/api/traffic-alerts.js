export async function onRequestGet(context) {
  const { env } = context;

  if (!env.NY511_API_KEY) {
    return Response.json(
      { success: false, error: "NY511_API_KEY is not configured", alerts: [] },
      { status: 500 }
    );
  }

  const apiUrl =
    "https://511ny.org/api/GetAlerts?key=" +
    encodeURIComponent(env.NY511_API_KEY) +
    "&format=json";

  try {
    const response = await fetch(apiUrl, {
      headers: {
        Accept: "application/json"
      }
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

    const rawAlerts = Array.isArray(raw)
      ? raw
      : Array.isArray(raw.Alerts)
        ? raw.Alerts
        : Array.isArray(raw.alerts)
          ? raw.alerts
          : [];

    const alerts = rawAlerts.map((alert, index) => ({
      id: String(alert.Id || alert.ID || alert.id || "511ny-" + index),
      source: "511NY",
      severity: "advisory",
      title: String(alert.Message || alert.Title || alert.EventType || "511NY Traffic Alert"),
      message: String(alert.Notes || alert.Description || alert.Message || ""),
      area: Array.isArray(alert.AreaNames)
        ? alert.AreaNames.join(", ")
        : String(alert.AreaName || alert.CountyName || "")
    }));

    return Response.json(
      {
        success: true,
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
