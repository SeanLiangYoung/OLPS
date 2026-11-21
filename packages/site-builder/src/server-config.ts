import type { SiteModel } from '@olps/render'
import { resolvedRedirects } from './redirects.js'
import { escapeAttribute } from './html-output.js'
import type { OutputFile } from './types.js'

export function planServerConfig(model: SiteModel): OutputFile[] {
  const prefix = model.publishConfig.hostingBasePath.replace(/\/$/, '')
  const redirects = resolvedRedirects(model).map(({ from, to }) => ({ from: `${prefix}${from}`, to: `${prefix}${to}`, relativeFrom: from.slice(1) }))
  const notFound = `${prefix}/404.html`
  for (const redirect of redirects) {
    if (/[\r\n\s;{}"'$]/.test(redirect.from + redirect.to)) throw new Error(`服务器跳转地址包含非法字符：${redirect.from}`)
  }
  return [
    { relativePath: 'server-config/nginx.conf', content: `error_page 404 ${notFound};\n${redirects.map(r => `location = ${r.from} { return 301 ${r.to}$is_args$args; }`).join('\n')}\n` },
    { relativePath: 'server-config/.htaccess', content: `ErrorDocument 404 ${notFound}\n${redirects.map(r => `RedirectMatch 301 ^${r.from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$ ${r.to}`).join('\n')}\n` },
    { relativePath: 'server-config/_redirects', content: `${redirects.map(r => `${r.from} ${r.to} 301`).join('\n')}\n${prefix}/* ${notFound} 404\n` },
    { relativePath: 'server-config/web.config', content: `<?xml version="1.0" encoding="UTF-8"?><configuration><system.webServer><httpErrors errorMode="Custom"><remove statusCode="404"/><error statusCode="404" path="${escapeAttribute(notFound)}" responseMode="ExecuteURL"/></httpErrors><rewrite><rules>${redirects.map((r, i) => `<rule name="redirect-${i}" stopProcessing="true"><match url="^${escapeAttribute(r.relativeFrom.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))}$"/><action type="Redirect" url="${escapeAttribute(r.to)}" redirectType="Permanent"/></rule>`).join('')}</rules></rewrite></system.webServer></configuration>` },
  ]
}
