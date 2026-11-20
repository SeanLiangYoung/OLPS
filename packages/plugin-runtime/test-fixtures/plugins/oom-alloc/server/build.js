exports.onBuild = function onBuild(ctx) {
  const storage = []
  const twoMegabytes = 1024 * 1024 * 2
  while (true) {
    const array = new Uint8Array(twoMegabytes)
    for (let i = 0; i < twoMegabytes; i += 4096) {
      array[i] = 1
    }
    storage.push(array)
    ctx.log('info', 'allocated_mb=' + storage.length * 2)
  }
}
