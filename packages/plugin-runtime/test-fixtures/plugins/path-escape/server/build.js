exports.onBuild = function onBuild() {
  return [
    {
      path: 'public/evil.txt',
      content: 'escaped',
    },
  ]
}
