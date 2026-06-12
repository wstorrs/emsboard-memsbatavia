export async function onRequest(context) {
  const fallback = {
    revisionId: "initial-revision-v1",
    operations: {
      crewChief: "",
      assistantChief: "",
      dispatcher: "",
      onCallOfficer: "",
      comsSupervisor: "",
      medicalDirection: "716-626-4011" // Matched to your HTML field mapping
    },
    vehicles: [],
    hospitals: [
      { facility: "NWCH", status: "OPEN", comment: "" },
      { facility: "FFTH", status: "OPEN", comment: "" },
      { facility: "CSHC", status: "OPEN", comment: "" },
      { facility: "GGH", status: "OPEN", comment: "" },
      { facility: "SSH", status: "OPEN", comment: "" },
      { facility: "SMH", status: "OPEN", comment: "" },
      { facility: "RGH", status: "OPEN", comment: "" }
    ],
    oos: [],
    dailyInfo: ""
  };

  function sanitizeRichText(html) {
    if (typeof html !== "string") return "";

    return html
      // Remove script/style/iframe/object/embed blocks completely
      .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, "")
      .replace(/<iframe[\s\S]*?>[\s\S]*?<\/iframe>/gi, "")
      .replace(/<object[\s\S]*?>[\s\S]*?<\/object>/gi, "")
      .replace(/<embed[\s\S]*?>/gi, "")

      // Remove inline event handlers like onclick, onerror, onload, etc.
      .replace(/\son\w+="[^"]*"/gi, "")
      .replace(/\son\w+='[^']*'/gi, "")
      .replace(/\son\w+=\S+/gi, "")

      // Prevent javascript: links
      .replace(/href\s*=\s*["']?\s*javascript:[^"'\s>]*/gi, "href=\"#\"");
  }

  function normalizeBoardData(input) {
    const data = input && typeof input === "object" ? input : {};

    return {
      // Pass along the existing revision ID or anchor a base string if it's new
      revisionId: typeof data.revisionId === "string" ? data.revisionId : "initial-revision-v1",

      operations: {
        crewChief: typeof data.operations?.crewChief === "string" ? data.operations.crewChief : "",
        assistantChief: typeof data.operations?.assistantChief === "string" ? data.operations.assistantChief : "",
        dispatcher: typeof data.operations?.dispatcher === "string" ? data.operations.dispatcher : "",
        onCallOfficer: typeof data.operations?.onCallOfficer === "string" ? data.operations.onCallOfficer : "",
        comsSupervisor: typeof data.operations?.comsSupervisor === "string" ? data.operations.comsSupervisor : "",
        medicalDirection: typeof data.operations?.medicalDirection === "string" ? data.operations.medicalDirection : "716-626-4011"
      },

      vehicles: Array.isArray(data.vehicles)
        ? data.vehicles.map(v => ({
            vehicle: typeof v?.vehicle === "string" ? v.vehicle : "",
            time: typeof v?.time === "string" ? v.time : "",
            crew1: typeof v?.crew1 === "string" ? v.crew1 : "",
            crew2: typeof v?.crew2 === "string" ? v.crew2 : "",
            crew3: typeof v?.crew3 === "string" ? v.crew3 : "",
            levelOfCare: typeof v?.levelOfCare === "string" ? v.levelOfCare : "",
            comments: typeof v?.comments === "string" ? v.comments : ""
          }))
        : [],

      hospitals: Array.isArray(data.hospitals) && data.hospitals.length > 0
        ? data.hospitals.map(h => ({
            facility: typeof h?.facility === "string" ? h.facility : "",
            status: typeof h?.status === "string" ? h.status : "OPEN",
            comment: typeof h?.comment === "string" ? h.comment : ""
          }))
        : fallback.hospitals,

      oos: Array.isArray(data.oos)
        ? data.oos.map(o => ({
            vehicle: typeof o?.vehicle === "string" ? o.vehicle : "",
            reason: typeof o?.reason === "string" ? o.reason : ""
          }))
        : [],

      dailyInfo: sanitizeRichText(data.dailyInfo || "")
    };
  }

  try {
    // --- METHOD HANDLING: GET (LOAD) ---
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

      return new Response(
        JSON.stringify(data),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-store"
          }
        }
      );
    }

    // --- METHOD HANDLING: POST (SAVE) ---
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

      // Read current state from storage directly to handle collision verification
      let currentStoredRaw = await context.env.BOARD_DATA.get("current");
      let currentStoredData = currentStoredRaw ? JSON.parse(currentStoredRaw) : fallback;
      
      const currentStoredRevision = currentStoredData.revisionId || "initial-revision-v1";
      const incomingClientRevision = body.revisionId;

      // OPTIMISTIC LOCK VERIFICATION:
      // If the revision ID from the browser doesn't match the database, another admin hit save first.
      if (incomingClientRevision !== currentStoredRevision) {
        return new Response(
          JSON.stringify({
            success: false,
            error: "Conflict detected",
            details: "Another user has saved updates since you loaded this board layout."
          }),
          {
            status: 409, // Conflict
            headers: { "Content-Type": "application/json" }
          }
        );
      }

      // Everything looks safe! Normalize dataset and increment revision string
      const normalized = normalizeBoardData(body);
      const freshlyGeneratedRevision = "rev-" + Date.now().toString(36);
      normalized.revisionId = freshlyGeneratedRevision;

      try {
        await context.env.BOARD_DATA.put("current", JSON.stringify(normalized));
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

      // Return success along with the new locked version sequence back to the client browser
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