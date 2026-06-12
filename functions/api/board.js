export async function onRequest(context) {
  const fallback = {
    revisionId: "initial-revision-v1",
    operations: {
      crewChief: "",
      assistantChief: "",
      onCallOfficer: "",
      medicalDirection: "716-626-4011"
    },
    vehicles: [],
    hospitals: [
      { facility: "UMMC", status: "OPEN", comment: "" },
      { facility: "Strong West", status: "OPEN", comment: "" },
      { facility: "Millard Fillmore Suburban", status: "OPEN", comment: "" },
      { facility: "ECMC", status: "OPEN", comment: "" },
      { facility: "Strong Memorial", status: "OPEN", comment: "" },
      { facility: "RGH", status: "OPEN", comment: "" }
    ],
    dailyInfo: ""
  };

  function sanitizeRichText(html) {
    if (typeof html !== "string") return "";

    return html
      .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, "")
      .replace(/<iframe[\s\S]*?>[\s\S]*?<\/iframe>/gi, "")
      .replace(/<object[\s\S]*?>[\s\S]*?<\/object>/gi, "")
      .replace(/<embed[\s\S]*?>/gi, "")
      .replace(/\son\w+="[^"]*"/gi, "")
      .replace(/\son\w+='[^']*'/gi, "")
      .replace(/\son\w+=\S+/gi, "")
      .replace(/href\s*=\s*["']?\s*javascript:[^"'\s>]*/gi, "href=\"#\"");
  }

  function normalizeBoardData(input) {
    const data = input && typeof input === "object" ? input : {};

    return {
      revisionId:
        typeof data.revisionId === "string"
          ? data.revisionId
          : "initial-revision-v1",

      operations: {
        crewChief:
          typeof data.operations?.crewChief === "string"
            ? data.operations.crewChief
            : "",

        assistantChief:
          typeof data.operations?.assistantChief === "string"
            ? data.operations.assistantChief
            : "",

        onCallOfficer:
          typeof data.operations?.onCallOfficer === "string"
            ? data.operations.onCallOfficer
            : "",

        medicalDirection:
          typeof data.operations?.medicalDirection === "string"
            ? data.operations.medicalDirection
            : "716-626-4011"
      },

      vehicles: Array.isArray(data.vehicles)
        ? data.vehicles.map(v => ({
            vehicle: typeof v?.vehicle === "string" ? v.vehicle : "",
            shiftId: typeof v?.shiftId === "string" ? v.shiftId : "",
            time: typeof v?.time === "string" ? v.time : "",
            crew1: typeof v?.crew1 === "string" ? v.crew1 : "",
            crew2: typeof v?.crew2 === "string" ? v.crew2 : "",
            crew3: typeof v?.crew3 === "string" ? v.crew3 : "",
            ctyId: typeof v?.ctyId === "string" ? v.ctyId : "",
            comments: typeof v?.comments === "string" ? v.comments : ""
          }))
        : [],

      hospitals:
        Array.isArray(data.hospitals) && data.hospitals.length > 0
          ? data.hospitals.map(h => ({
              facility: typeof h?.facility === "string" ? h.facility : "",
              status: typeof h?.status === "string" ? h.status : "OPEN",
              comment: typeof h?.comment === "string" ? h.comment : ""
            }))
          : fallback.hospitals,

      dailyInfo: sanitizeRichText(data.dailyInfo || "")
    };
  }

  try {
    if (context.request.method === "GET") {
      let raw = null;

      try {
        raw = await context.env.BOARD_DATA.get("current");
      } catch (kvError) {
        return new Response(
          JSON.stringify({
            success: false,
            error: "KV read failed",
            details: String(kvError)
          }),
          {
            status: 500,
            headers: {
              "Content-Type": "application/json",
              "Cache-Control": "no-store"
            }
          }
        );
      }

      let data = fallback;

      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          data = normalizeBoardData(parsed);
        } catch (parseError) {
          data = fallback;
        }
      }

      return new Response(JSON.stringify(data), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store"
        }
      });
    }

    if (context.request.method === "POST") {
      let body;

      try {
        body = await context.request.json();
      } catch (parseError) {
        return new Response(
          JSON.stringify({
            success: false,
            error: "Invalid JSON body",
            details: String(parseError)
          }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" }
          }
        );
      }

      let currentStoredRaw = await context.env.BOARD_DATA.get("current");
      let currentStoredData = currentStoredRaw
        ? JSON.parse(currentStoredRaw)
        : fallback;

      const currentStoredRevision =
        currentStoredData.revisionId || "initial-revision-v1";

      const incomingClientRevision = body.revisionId;

      if (incomingClientRevision !== currentStoredRevision) {
        return new Response(
          JSON.stringify({
            success: false,
            error: "Conflict detected",
            details:
              "Another user has saved updates since you loaded this board layout."
          }),
          {
            status: 409,
            headers: { "Content-Type": "application/json" }
          }
        );
      }

      const normalized = normalizeBoardData(body);
      const freshlyGeneratedRevision = "rev-" + Date.now().toString(36);
      normalized.revisionId = freshlyGeneratedRevision;

      try {
        await context.env.BOARD_DATA.put(
          "current",
          JSON.stringify(normalized)
        );
      } catch (kvWriteError) {
        return new Response(
          JSON.stringify({
            success: false,
            error: "KV write failed",
            details: String(kvWriteError)
          }),
          {
            status: 500,
            headers: { "Content-Type": "application/json" }
          }
        );
      }

      return new Response(
        JSON.stringify({
          success: true,
          revisionId: freshlyGeneratedRevision
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-store"
          }
        }
      );
    }

    return new Response(
      JSON.stringify({
        success: false,
        error: "Method not allowed"
      }),
      {
        status: 405,
        headers: {
          "Content-Type": "application/json",
          "Allow": "GET, POST"
        }
      }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({
        success: false,
        error: "Unhandled function error",
        details: String(err)
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store"
        }
      }
    );
  }
}
