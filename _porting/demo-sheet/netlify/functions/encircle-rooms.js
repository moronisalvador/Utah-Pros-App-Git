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

  const { claim_id } = event.queryStringParameters || {};
  if (!claim_id) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "claim_id required" }) };
  }

  const encircleHeaders = {
    Authorization: `Bearer ${ENCIRCLE_API_KEY}`,
    "Content-Type": "application/json",
    "X-Encircle-Attribution": "UtahProsRestorationDemoSheet",
  };

  try {
    // Step 1: fetch all structures for this claim
    const structRes = await fetch(
      `https://api.encircleapp.com/v1/property_claims/${claim_id}/structures?limit=100`,
      { headers: encircleHeaders }
    );
    const structData = await structRes.json();
    if (!structRes.ok) throw new Error(structData.error || "Failed to fetch structures");

    const structures = structData.list || [];

    // Step 2: fetch rooms for each structure in parallel
    const roomFetches = structures.map(struct =>
      fetch(
        `https://api.encircleapp.com/v1/property_claims/${claim_id}/structures/${struct.id}/rooms?limit=100`,
        { headers: encircleHeaders }
      ).then(r => r.json()).then(d => ({
        structure: struct,
        rooms: d.list || [],
      }))
    );

    const results = await Promise.all(roomFetches);

    // Flatten: combine all room names across all structures
    // If multiple structures, prefix with structure name
    const multiStruct = structures.length > 1;
    const allRooms = results.flatMap(({ structure, rooms }) =>
      rooms.map(room => ({
        id: room.id,
        name: multiStruct && structure.name
          ? `${structure.name} — ${room.name}`
          : room.name,
        structureId: structure.id,
        structureName: structure.name,
      }))
    );

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ rooms: allRooms, structures }),
    };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
