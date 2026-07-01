import { createStartAPIHandler, defaultAPIFileRouteHandler } from '@tanstack/react-start/api';

export default createStartAPIHandler(defaultAPIFileRouteHandler) as (
  event: unknown,
  ctx?: unknown,
) => Response | Promise<Response>;
