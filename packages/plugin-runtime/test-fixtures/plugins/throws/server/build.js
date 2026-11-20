exports.onBuild = function onBuild() {
  throw new Error('boom-from-plugin')
}
