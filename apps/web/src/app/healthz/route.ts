// Liveness: the process is up. No dependencies are checked.
export function GET(): Response {
  return Response.json({ status: 'ok' });
}
