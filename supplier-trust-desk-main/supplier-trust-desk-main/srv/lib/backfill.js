const cds = require('@sap/cds')
const LOG = cds.log('backfill')

async function backfillRequestedOn() {
  const rows = await SELECT.from('mdcr.ChangeRequests').columns('ID', 'createdAt').where({ requestedOn: null })
  for (const r of rows) {
    const day = String(r.createdAt ?? '').slice(0, 10)
    if (/^\d{4}-\d{2}-\d{2}$/.test(day)) await UPDATE('mdcr.ChangeRequests').set({ requestedOn: day }).where({ ID: r.ID, requestedOn: null })
  }
  if (rows.length) LOG.info(`requestedOn filled for ${rows.length} older change request(s)`)
  return rows.length
}

module.exports = { backfillRequestedOn }
