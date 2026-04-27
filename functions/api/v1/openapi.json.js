// GET /api/v1/openapi.json
// OpenAPI 3.1.0 spec for the Utah Pros public read-only API.
// Paste this URL into a ChatGPT Custom GPT > Actions > "Import from URL".
// No auth required for the spec itself; endpoints it describes are bearer-gated.

export async function onRequestGet(context) {
  const { request } = context;
  const url = new URL(request.url);
  const serverUrl = `${url.protocol}//${url.host}`;

  const spec = {
    openapi: '3.1.0',
    info: {
      title: 'Utah Pros Restoration API',
      version: '1.0.0',
      description:
        'Read-only access to claims and jobs in the Utah Pros Restoration platform. ' +
        'All endpoints require an `Authorization: Bearer <API_KEY>` header.',
    },
    servers: [{ url: serverUrl }],
    security: [{ bearerAuth: [] }],
    paths: {
      '/api/v1/claims': {
        get: {
          operationId: 'listClaims',
          summary: 'List insurance claims',
          parameters: [
            { name: 'status', in: 'query', schema: { type: 'string' }, description: 'Filter by claim status (exact)' },
            { name: 'q', in: 'query', schema: { type: 'string' }, description: 'Fuzzy match on claim_number or insurance_carrier' },
            { name: 'since', in: 'query', schema: { type: 'string', format: 'date' }, description: 'date_of_loss >= this ISO date' },
            { name: 'until', in: 'query', schema: { type: 'string', format: 'date' }, description: 'date_of_loss <= this ISO date' },
            { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 25 } },
            { name: 'offset', in: 'query', schema: { type: 'integer', minimum: 0, default: 0 } },
          ],
          responses: {
            200: {
              description: 'Paginated list of claims',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: { type: 'array', items: { $ref: '#/components/schemas/Claim' } },
                      limit: { type: 'integer' },
                      offset: { type: 'integer' },
                      count: { type: 'integer' },
                    },
                  },
                },
              },
            },
            401: { $ref: '#/components/responses/Unauthorized' },
          },
        },
      },
      '/api/v1/claims/{id}': {
        get: {
          operationId: 'getClaim',
          summary: 'Get a single claim with linked jobs and primary contact',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          responses: {
            200: {
              description: 'Claim detail',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: {
                        allOf: [
                          { $ref: '#/components/schemas/Claim' },
                          {
                            type: 'object',
                            properties: {
                              contact: { $ref: '#/components/schemas/Contact' },
                              jobs: { type: 'array', items: { $ref: '#/components/schemas/JobSummary' } },
                            },
                          },
                        ],
                      },
                    },
                  },
                },
              },
            },
            401: { $ref: '#/components/responses/Unauthorized' },
            404: { $ref: '#/components/responses/NotFound' },
          },
        },
      },
      '/api/v1/jobs': {
        get: {
          operationId: 'listJobs',
          summary: 'List jobs',
          parameters: [
            { name: 'status', in: 'query', schema: { type: 'string' }, description: 'Filter by job status (exact). Default excludes deleted.' },
            { name: 'phase', in: 'query', schema: { type: 'string' }, description: 'Filter by phase key (exact)' },
            { name: 'division', in: 'query', schema: { type: 'string' } },
            { name: 'claim_id', in: 'query', schema: { type: 'string', format: 'uuid' }, description: 'Only jobs linked to this claim' },
            { name: 'q', in: 'query', schema: { type: 'string' }, description: 'Fuzzy match on job_number or insured_name' },
            { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 25 } },
            { name: 'offset', in: 'query', schema: { type: 'integer', minimum: 0, default: 0 } },
          ],
          responses: {
            200: {
              description: 'Paginated list of jobs',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: { type: 'array', items: { $ref: '#/components/schemas/Job' } },
                      limit: { type: 'integer' },
                      offset: { type: 'integer' },
                      count: { type: 'integer' },
                    },
                  },
                },
              },
            },
            401: { $ref: '#/components/responses/Unauthorized' },
          },
        },
      },
      '/api/v1/jobs/{id}': {
        get: {
          operationId: 'getJob',
          summary: 'Get a single job with linked claim and contacts',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          responses: {
            200: {
              description: 'Job detail',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: {
                        allOf: [
                          { $ref: '#/components/schemas/Job' },
                          {
                            type: 'object',
                            properties: {
                              claim: { $ref: '#/components/schemas/ClaimSummary' },
                              primary_contact: { $ref: '#/components/schemas/Contact' },
                              contacts: { type: 'array', items: { $ref: '#/components/schemas/ContactWithRole' } },
                            },
                          },
                        ],
                      },
                    },
                  },
                },
              },
            },
            401: { $ref: '#/components/responses/Unauthorized' },
            404: { $ref: '#/components/responses/NotFound' },
          },
        },
      },
    },
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer' },
      },
      responses: {
        Unauthorized: {
          description: 'Missing or invalid Authorization header',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
        NotFound: {
          description: 'Record not found',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
      },
      schemas: {
        Error: {
          type: 'object',
          properties: { error: { type: 'string' } },
        },
        Claim: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            claim_number: { type: 'string' },
            contact_id: { type: 'string', format: 'uuid', nullable: true },
            date_of_loss: { type: 'string', format: 'date', nullable: true },
            status: { type: 'string', nullable: true },
            insurance_carrier: { type: 'string', nullable: true },
            policy_number: { type: 'string', nullable: true },
            adjuster_name: { type: 'string', nullable: true },
            adjuster_phone: { type: 'string', nullable: true },
            adjuster_email: { type: 'string', nullable: true },
            type_of_loss: { type: 'string', nullable: true },
            loss_address: { type: 'string', nullable: true },
            loss_city: { type: 'string', nullable: true },
            loss_state: { type: 'string', nullable: true },
            loss_zip: { type: 'string', nullable: true },
            created_at: { type: 'string', format: 'date-time' },
            updated_at: { type: 'string', format: 'date-time' },
          },
        },
        ClaimSummary: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            claim_number: { type: 'string' },
            date_of_loss: { type: 'string', format: 'date', nullable: true },
            status: { type: 'string', nullable: true },
            insurance_carrier: { type: 'string', nullable: true },
            policy_number: { type: 'string', nullable: true },
          },
        },
        Job: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            job_number: { type: 'string' },
            insured_name: { type: 'string', nullable: true },
            division: { type: 'string', nullable: true },
            phase: { type: 'string', nullable: true },
            status: { type: 'string', nullable: true },
            address: { type: 'string', nullable: true },
            city: { type: 'string', nullable: true },
            state: { type: 'string', nullable: true },
            zip: { type: 'string', nullable: true },
            claim_id: { type: 'string', format: 'uuid', nullable: true },
            claim_number: { type: 'string', nullable: true },
            insurance_company: { type: 'string', nullable: true },
            date_of_loss: { type: 'string', format: 'date', nullable: true },
            received_date: { type: 'string', format: 'date', nullable: true },
            target_completion: { type: 'string', format: 'date', nullable: true },
            actual_completion: { type: 'string', format: 'date', nullable: true },
            estimated_value: { type: 'number', nullable: true },
            approved_value: { type: 'number', nullable: true },
            invoiced_value: { type: 'number', nullable: true },
            priority: { type: 'string', nullable: true },
            created_at: { type: 'string', format: 'date-time' },
            updated_at: { type: 'string', format: 'date-time' },
          },
        },
        JobSummary: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            job_number: { type: 'string' },
            insured_name: { type: 'string', nullable: true },
            division: { type: 'string', nullable: true },
            phase: { type: 'string', nullable: true },
            status: { type: 'string', nullable: true },
            address: { type: 'string', nullable: true },
            city: { type: 'string', nullable: true },
            state: { type: 'string', nullable: true },
            zip: { type: 'string', nullable: true },
            date_of_loss: { type: 'string', format: 'date', nullable: true },
            estimated_value: { type: 'number', nullable: true },
            approved_value: { type: 'number', nullable: true },
            created_at: { type: 'string', format: 'date-time' },
          },
        },
        Contact: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            name: { type: 'string', nullable: true },
            phone: { type: 'string', nullable: true },
            email: { type: 'string', nullable: true },
            role: { type: 'string', nullable: true },
          },
        },
        ContactWithRole: {
          allOf: [
            { $ref: '#/components/schemas/Contact' },
            {
              type: 'object',
              properties: {
                link_role: { type: 'string', nullable: true },
                is_primary: { type: 'boolean', nullable: true },
              },
            },
          ],
        },
      },
    },
  };

  return new Response(JSON.stringify(spec, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=300',
    },
  });
}
