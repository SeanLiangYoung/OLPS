exports.handle = async function handle(request, ctx) {
  await ctx.store.set('lastMethod', request.method)
  const stored = await ctx.store.get('lastMethod')
  await ctx.inquiries.create({
    source: 'happy-api',
    path: request.path,
  })
  ctx.log('info', 'handle ok', { stored: stored })
  const remote = await ctx.fetch('https://api.example.com/echo', {
    method: 'GET',
  })
  return {
    status: 200,
    headers: { 'content-type': 'application/json' },
    body: {
      ok: true,
      stored: stored,
      remoteStatus: remote.status,
      query: request.query,
    },
  }
}
