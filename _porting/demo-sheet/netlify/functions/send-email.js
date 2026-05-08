exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  const { subject, message } = JSON.parse(event.body || "{}");

  const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
  const FROM_EMAIL = process.env.FROM_EMAIL || "restoration@utah-pros.com";
  const TO_EMAILS = (process.env.TO_EMAILS || "moroni.s@utah-pros.com,restoration@utah-pros.com")
    .split(",").map(e => e.trim()).filter(Boolean);

  try {
    const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SENDGRID_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        personalizations: [{ to: TO_EMAILS.map(email => ({ email })) }],
        from: { email: FROM_EMAIL, name: "Utah Pros Restoration" },
        subject,
        content: [{ type: "text/html", value: message }],
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error("SendGrid error:", err);
      return { statusCode: 502, headers, body: JSON.stringify({ error: err }) };
    }

    return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    console.error("Send error:", err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
