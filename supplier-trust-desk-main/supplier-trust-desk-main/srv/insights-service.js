const cds = require('@sap/cds')
const { backfillRequestedOn } = require('./lib/backfill')

module.exports = class InsightsService extends cds.ApplicationService {
  init() {
    cds.once('served', () => backfillRequestedOn().catch(e => cds.log('backfill').error(e)))
    return super.init()
  }
}
