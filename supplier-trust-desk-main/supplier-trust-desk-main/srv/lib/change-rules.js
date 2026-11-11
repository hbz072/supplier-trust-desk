const cds = require('@sap/cds')

const ADDRESS_FIELDS = ['street', 'houseNumber', 'postalCode', 'city', 'country']
const SUPPLIER_FIELDS = ['name', 'taxNumber']
const TIER_RANK = { L: 1, M: 2, H: 3 }
const TIER_NAME = { L: 'low', M: 'medium', H: 'high' }

const T = {
  Requests: 'mdcr.ChangeRequests',
  Items: 'mdcr.ChangeItems',
  Suppliers: 'mdcr.Suppliers',
  Addresses: 'mdcr.Addresses',
  Rules: 'mdcr.PostalCodeRules',
  RiskRules: 'mdcr.RiskRules',
  Settings: 'mdcr.Settings',
  Holds: 'mdcr.HoldList',
  Locks: 'mdcr.OpenLocks'
}

async function assessRisk(supplier, items, excludeID) {
  const rules = Object.fromEntries((await SELECT.from(T.RiskRules)).map(r => [r.field, r.tier]))
  let tier = 'L', reason = 'Only format corrections (street, house number, postal code)'
  for (const i of items) {
    const t = rules[i.field] ?? 'M'                          // a field without a rule needs a steward
    if (TIER_RANK[t] > TIER_RANK[tier]) { tier = t; reason = `Field "${i.field}" is ${TIER_NAME[t]} risk` }
  }
  if (tier !== 'L') return { tier, reason }

  const setting = async (name, fallback) => (await SELECT.one.from(T.Settings).where({ name }))?.value ?? fallback
  const maxFields = await setting('lowRiskMaxFields', 2)
  if (items.length > maxFields)
    return { tier: 'M', reason: `${items.length} fields changed at once (low risk allows ${maxFields}): treated as a relocation` }

  const maxPer30 = await setting('lowRiskMaxPer30Days', 2)
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString()
  const recent = (await SELECT.from(T.Requests).columns('ID')
    .where({ supplier_ID: supplier.ID, status_code: 'A', decidedAt: { '>=': since } }))
    .filter(r => r.ID !== excludeID).length
  if (recent >= maxPer30)
    return { tier: 'M', reason: `${recent} changes applied to this supplier in the last 30 days (low risk allows ${maxPer30})` }

  const today = new Date().toISOString().slice(0, 10)
  const hold = await SELECT.one.from(T.Holds).where({ supplierNo: supplier.supplierNo, holdUntil: { '>=': today } })
  if (hold) return { tier: 'M', reason: `Supplier is on payment hold until ${hold.holdUntil}` }

  return { tier, reason }
}

const currentValue = (field, supplier, address) =>
  ADDRESS_FIELDS.includes(field) ? address?.[field] : supplier?.[field]

async function loadContext(stored) {
  const items = await SELECT.from(T.Items).where({ parent_ID: stored.ID })
  const supplier = await SELECT.one.from(T.Suppliers).where({ ID: stored.supplier_ID })
  const address = stored.address_ID ? await SELECT.one.from(T.Addresses).where({ ID: stored.address_ID }) : null
  return { items, supplier, address }
}

function staleItem({ items, supplier, address }) {
  return items.find(i => (currentValue(i.field, supplier, address) ?? null) !== (i.oldValue ?? null))
}

async function applyItems(stored, items) {
  for (const item of items) {
    if (ADDRESS_FIELDS.includes(item.field)) await UPDATE(T.Addresses).set({ [item.field]: item.newValue }).where({ ID: stored.address_ID })
    else if (SUPPLIER_FIELDS.includes(item.field)) await UPDATE(T.Suppliers).set({ [item.field]: item.newValue }).where({ ID: stored.supplier_ID })
  }
}

function registerRequesterRules(srv) {
  const { ChangeRequests, ChangeItems } = srv.entities

  srv.before(['CREATE', 'UPDATE', 'DELETE'], ChangeItems, req =>
    req.reject(405, 'Change items can only be changed by editing their request.'))

  srv.before('CREATE', ChangeRequests, req => {
    req.data.status_code = 'N'                               // the client never chooses the status
    req.data.requestedOn = new Date().toISOString().slice(0, 10)
  })

  srv.before('UPDATE', ChangeRequests, async req => {
    const stored = await SELECT.one.from(T.Requests).where({ ID: req.data.ID })
    if (!stored) return
    if (stored.createdBy !== req.user.id) return req.reject(403, 'Only the requester who created this request can change it.')
    if (stored.status_code !== 'N') return req.reject(409, `Request is ${stored.status_code === 'S' ? 'already submitted' : 'already decided'} and can no longer be changed.`)
  })

  srv.before(['CREATE', 'UPDATE'], ChangeRequests, async req => {
    const cr = req.data
    const items = cr.items ?? await SELECT.from(T.Items).where({ parent_ID: cr.ID })
    if (!items.length) return req.reject(400, 'Add at least one field change.')

    const supplierID = cr.supplier_ID ?? (await SELECT.one.from(T.Requests).columns('supplier_ID').where({ ID: cr.ID }))?.supplier_ID
    const supplier = await SELECT.one.from(T.Suppliers).where({ ID: supplierID })
    if (!supplier) return req.reject(400, 'Choose an existing supplier.')

    const addressID = 'address_ID' in cr ? cr.address_ID : (await SELECT.one.from(T.Requests).columns('address_ID').where({ ID: cr.ID }))?.address_ID
    const needsAddress = items.some(i => ADDRESS_FIELDS.includes(i.field))
    const address = addressID ? await SELECT.one.from(T.Addresses).where({ ID: addressID }) : null
    if (needsAddress && !address) return req.reject(400, 'Choose the address you want to change.')
    if (address && address.supplier_ID !== supplier.ID) return req.reject(400, 'The address does not belong to this supplier.')

    const seen = new Set()
    for (const item of items) {
      if (seen.has(item.field)) return req.reject(400, `Field "${item.field}" appears twice in this request.`)
      seen.add(item.field)
      const current = currentValue(item.field, supplier, address)
      item.oldValue = current ?? null
      if (String(item.newValue ?? '').trim() === String(current ?? '').trim())
        return req.reject(400, `New value for "${item.field}" is the same as the current value.`)
    }

    if (address && (seen.has('postalCode') || seen.has('country'))) {
      const country = items.find(i => i.field === 'country')?.newValue ?? address.country
      const postalCode = items.find(i => i.field === 'postalCode')?.newValue ?? address.postalCode
      const rule = await SELECT.one.from(T.Rules).where({ country })
      if (!rule) return req.reject(400, `No postal-code rule is defined for country "${country}".`)
      if (!new RegExp(rule.pattern).test(String(postalCode ?? '').trim()))
        return req.reject(400, `Postal code "${postalCode}" does not match the format for ${country} (example: ${rule.example}).`)
    }

    const risk = await assessRisk(supplier, items, cr.ID)
    cr.riskTier = risk.tier
    cr.riskReason = risk.reason
  })

  srv.before(['EDIT', 'DELETE'], ChangeRequests, async req => {
    const stored = await SELECT.one.from(T.Requests).where({ ID: keyOf(req) })
    if (!stored) return
    if (stored.createdBy !== req.user.id) return req.reject(403, 'Only the requester who created this request can change it.')
    if (stored.status_code !== 'N') return req.reject(409, 'Only new (not yet submitted) requests can be changed or deleted.')
  })

  srv.on('submit', ChangeRequests, async req => {
    const ID = keyOf(req)
    const stored = await mustExist(req, ID)
    if (!stored) return
    if (stored.createdBy !== req.user.id) return req.reject(403, 'Only the requester who created this request can submit it.')
    if (stored.status_code !== 'N') return req.reject(409, `Request cannot be submitted: its status is "${stored.status_code}", not "N".`)

    const ctx = await loadContext(stored)
    const risk = await assessRisk(ctx.supplier, ctx.items, ID)

    const groups = [...new Set(ctx.items.map(i => fieldGroupOf(i.field)))]
    try {
      await INSERT.into(T.Locks).entries(groups.map(fieldGroup => ({ supplier_ID: stored.supplier_ID, fieldGroup, request_ID: ID })))
    } catch (e) {
      if (!isDuplicateKey(e)) throw e
      return req.reject(409, 'Another submitted request already changes this supplier field. Wait until it is decided.')
    }

    if (risk.tier === 'L') {
      const stale = staleItem(ctx)
      if (stale) return req.reject(409, `Supplier data changed since the request was saved ("${stale.field}" is now "${currentValue(stale.field, ctx.supplier, ctx.address)}"). Create a new request.`)
      const n = await UPDATE(T.Requests).set({
        status_code: 'A', riskTier: 'L', riskReason: risk.reason, approvalMode: 'Auto',
        decidedBy: req.user.id, decidedAt: new Date().toISOString(),
        decisionNote: 'Low risk: applied on submit without a second approver; rules R0 and R1 passed.'
      }).where({ ID, status_code: 'N' })
      if (n !== 1) return req.reject(409, 'Request cannot be submitted: its status changed meanwhile.')
      await applyItems(stored, ctx.items)                    // same transaction: all or nothing
      await DELETE.from(T.Locks).where({ request_ID: ID })
    } else {
      const n = await UPDATE(T.Requests).set({ status_code: 'S', riskTier: risk.tier, riskReason: risk.reason, approvalMode: 'FourEyes' })
        .where({ ID, status_code: 'N' })
      if (n !== 1) return req.reject(409, 'Request cannot be submitted: its status changed meanwhile.')
    }
    return SELECT.one.from(req.subject)     // the service view, incl. calculated fields such as canSubmit
  })
}

function registerStewardRules(srv) {
  const { ChangeRequests } = srv.entities

  srv.on('approve', ChangeRequests, async req => {
    const ID = keyOf(req)
    const stored = await mustExist(req, ID)
    if (!stored) return
    if (!fourEyesOk(req, stored)) return
    if (stored.status_code !== 'S') return req.reject(409, `Request cannot be approved: its status is "${stored.status_code}", not "S".`)

    const ctx = await loadContext(stored)
    const stale = staleItem(ctx)
    if (stale) return req.reject(409, `Supplier data changed since the request was created ("${stale.field}" is now "${currentValue(stale.field, ctx.supplier, ctx.address)}"). Create a new request.`)

    const n = await UPDATE(T.Requests)
      .set({ status_code: 'A', decidedBy: req.user.id, decidedAt: new Date().toISOString(), decisionNote: req.data.note ?? null })
      .where({ ID, status_code: 'S' })
    if (n !== 1) return req.reject(409, 'Request cannot be approved: its status changed meanwhile.')
    await applyItems(stored, ctx.items)                      // same transaction: all or nothing
    await DELETE.from(T.Locks).where({ request_ID: ID })
    return SELECT.one.from(req.subject)
  })

  srv.on('rejectRequest', ChangeRequests, async req => {
    const ID = keyOf(req)
    const stored = await mustExist(req, ID)
    if (!stored) return
    if (!fourEyesOk(req, stored)) return
    if (!String(req.data.note ?? '').trim()) return req.reject(400, 'A rejection needs a reason.')
    const n = await UPDATE(T.Requests)
      .set({ status_code: 'R', decidedBy: req.user.id, decidedAt: new Date().toISOString(), decisionNote: req.data.note })
      .where({ ID, status_code: 'S' })
    if (n !== 1) return req.reject(409, `Request cannot be rejected: its status is "${stored.status_code}", not "S".`)
    await DELETE.from(T.Locks).where({ request_ID: ID })
    return SELECT.one.from(req.subject)
  })
}

function fourEyesOk(req, stored) {
  if (stored.createdBy === req.user.id) { req.reject(403, 'Four-eyes rule: you cannot decide a request you created yourself.'); return false }
  return true
}

async function mustExist(req, ID) {
  const stored = await SELECT.one.from(T.Requests).where({ ID })
  if (!stored) req.reject(404, `Change request ${ID} not found.`)
  return stored
}

function keyOf(req) {
  const p = req.params?.[0]
  return typeof p === 'object' ? p.ID : p ?? req.data?.ID
}

function fieldGroupOf(field) {
  return (field === 'postalCode' || field === 'country') ? 'address.postal' : field
}
function isDuplicateKey(e) {
  const text = `${e.code} ${e.message} ${e.sqlState ?? ''}`
  return /UNIQUE_CONSTRAINT_VIOLATION|ENTITY_ALREADY_EXISTS|SQLITE_CONSTRAINT|UNIQUE constraint failed|unique constraint violated|\b301\b|23000/i.test(text)
}

module.exports = { registerRequesterRules, registerStewardRules, assessRisk, T, ADDRESS_FIELDS, SUPPLIER_FIELDS }
