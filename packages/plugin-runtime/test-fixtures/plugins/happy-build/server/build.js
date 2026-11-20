exports.onBuild = function onBuild(ctx) {
  ctx.log('info', 'onBuild start')
  return [
    {
      path: 'public/plugins/happy-build/marker.txt',
      content: 'built-by=' + String(ctx.settings.marker || 'unknown'),
    },
  ]
}

exports.transformHtml = function transformHtml(html, pageInfo, ctx) {
  const stamp = '<!-- plugin:' + ctx.settings.pluginStamp + ' page:' + pageInfo.path + ' -->'
  return html + stamp
}
