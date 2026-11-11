using { mdcr } from '../db/schema';
using from '../db/integration';

@title: 'Supplier Trust Desk - P4 integration API'
@Core.Description: 'Central data for P2 (invoice decisions) and P3 (supplier data issues). Technical client only (scope Integration).'
@path: '/odata/v4/integration'
@requires: 'Integration'
service IntegrationService {

  @readonly entity Suppliers as projection on mdcr.Suppliers { ID, supplierNo, name, taxNumber, addresses };
  @readonly entity Addresses as projection on mdcr.Addresses;

  @readonly entity ChangeRequests as projection on mdcr.ChangeRequests {
    ID, supplier.supplierNo as supplierNo, status.code as status, reason, createdAt, modifiedAt,
    riskTier, approvalMode, decidedAt   // P2 counts recent applied changes per supplier (priority signal)
  };

  @readonly entity HoldList   as projection on mdcr.HoldList;
  @readonly entity Thresholds as projection on mdcr.Thresholds;

  entity InvoiceDecisions as projection on mdcr.InvoiceDecisions;
  entity Issues           as projection on mdcr.Issues;

  type Finding {
    partnerId    : String(10);
    addressId    : String(10);
    field        : String(30);
    rule         : String(40);
    severity     : String(6);
    currentValue : String(255);
  }
  type ImportReport {
    created  : Integer;
    merged   : Integer;
    rejected : Integer;
    errors   : many String;
  }
  action importFindings(findings : many Finding) returns ImportReport;
}
