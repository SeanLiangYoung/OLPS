import { appConfig } from '../config.js'

process.stdout.write(
  JSON.stringify({
    host: appConfig.host,
    remoteServiceUrl: appConfig.remoteServiceUrl,
    remoteServiceToken: appConfig.remoteServiceToken,
  }),
)
