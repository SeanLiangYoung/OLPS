import { rootCertificates } from 'node:tls'
import { writeFileSync } from 'node:fs'

writeFileSync('/opt/olps-bootstrap-ca.pem', rootCertificates.join('\n') + '\n')
