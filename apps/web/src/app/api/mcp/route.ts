// MCP over Streamable HTTP (spec §14.3): `claude mcp add --transport http catalyst <APP_URL>/api/mcp`.

import { mcpEndpoint } from '@catalyst/server';

export const dynamic = 'force-dynamic';

export { mcpEndpoint as DELETE, mcpEndpoint as GET, mcpEndpoint as POST };
