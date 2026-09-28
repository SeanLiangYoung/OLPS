export const NOT_IMPLEMENTED = 'NOT_IMPLEMENTED'

export function notImplementedResponse(): Response {
  return Response.json({ error: NOT_IMPLEMENTED }, { status: 501 })
}
