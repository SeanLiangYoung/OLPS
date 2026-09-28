import { appConfig } from '../config.js'

process.stdout.write(
  JSON.stringify({
    remoteServiceUrl: appConfig.remoteServiceUrl,
    remoteServiceToken: appConfig.remoteServiceToken,
  }),
)
