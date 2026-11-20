exports.handle = async function handle(_request, ctx) {
  await ctx.store.set('k', 'v')
  return { status: 200, body: { ok: true } }
}
