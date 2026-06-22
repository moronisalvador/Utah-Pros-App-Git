// UPR MCP — entry point.
// @cloudflare/workers-oauth-provider implements the full OAuth 2.1 server
// (dynamic client registration, /authorize, /token, token validation) and only
// forwards authenticated requests to the MCP API handler, with the owner's
// identity on ctx.props. Unauthenticated/login traffic goes to authHandler.

import OAuthProvider from '@cloudflare/workers-oauth-provider';
import { mcpApiHandler } from './mcp.js';
import { authHandler } from './auth.js';

export default new OAuthProvider({
  apiRoute: '/mcp',
  apiHandler: mcpApiHandler,
  defaultHandler: authHandler,
  authorizeEndpoint: '/authorize',
  tokenEndpoint: '/token',
  clientRegistrationEndpoint: '/register',
});
