exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  const ENCIRCLE_API_KEY = process.env.ENCIRCLE_API_KEY;
  if (!ENCIRCLE_API_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "ENCIRCLE_API_KEY not set" }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch(e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid JSON body" }) };
  }

  const { claim_id, title, text } = body;
  if (!claim_id) return { statusCode: 400, headers, body: JSON.stringify({ error: "claim_id required" }) };
  if (!text)     return { statusCode: 400, headers, body: JSON.stringify({ error: "text required" }) };

  const url = `https://api.encircleapp.com/v2/property_claims/${claim_id}/notes`;

  // Try both schema variants — title required first, then text required
  // Per API docs: oneOf {title* + text?} or {title? + text*}
  // Send only title + text, no extra fields
  const payload = {
    title: title || "Demo Sheet",
    text: text,
  };

  console.log("POST", url);
  console.log("Payload:", JSON.stringify(payload).slice(0, 200));

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ENCIRCLE_API_KEY}`,
        "Content-Type": "application/json",
        "Accept": "application/json",
        "X-Encircle-Attribution": "UtahProsRestorationDemoSheet",
      },
      body: JSON.stringify(payload),
    });
  } catch(e) {
    console.error("Fetch error:", e.message);
    return { statusCode: 502, headers, body: JSON.stringify({ error: `Network error: ${e.message}` }) };
  }

  const responseText = await res.text();
  console.log("Encircle status:", res.status);
  console.log("Encircle response:", responseText.slice(0, 500));

  if (!res.ok) {
    return { statusCode: 502, headers, body: JSON.stringify({ error: `Encircle ${res.status}: ${responseText}` }) };
  }

  let result;
  try { result = JSON.parse(responseText); } catch(e) { result = {}; }
  return { statusCode: 200, headers, body: JSON.stringify({ ok: true, id: result.id }) };
};
