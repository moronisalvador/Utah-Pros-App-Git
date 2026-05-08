exports.handler = async (event) => {
  const ENCIRCLE_API_KEY = process.env.ENCIRCLE_API_KEY;
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  const params = event.queryStringParameters || {};
  const query = new URLSearchParams();

  if (params.policyholder_name) query.set("policyholder_name", params.policyholder_name);
  if (params.contractor_identifier) query.set("contractor_identifier", params.contractor_identifier);
  if (params.assignment_identifier) query.set("assignment_identifier", params.assignment_identifier);
  query.set("limit", "20");
  query.set("order", "newest");

  try {
    const res = await fetch(`https://api.encircleapp.com/v1/property_claims?${query.toString()}`, {
      headers: {
        Authorization: `Bearer ${ENCIRCLE_API_KEY}`,
        "Content-Type": "application/json",
        "X-Encircle-Attribution": "UtahProsRestorationDemoSheet",
      },
    });

    const data = await res.json();

    if (!res.ok) {
      return { statusCode: res.status, headers, body: JSON.stringify({ error: data.error || "Encircle error" }) };
    }

    return { statusCode: 200, headers, body: JSON.stringify(data) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
