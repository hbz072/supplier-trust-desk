namespace mdcr;

using { cuid, managed } from '@sap/cds/common';


entity InvoiceDecisions : managed {
  key source          : String(5) @assert.range enum { S4; STORY; };  // S4 = sandbox invoice, STORY = seeded demo invoice
  key SupplierInvoice : String(10);                                   // S/4 field name (A_SupplierInvoice)
  key FiscalYear      : String(4);                                    // S/4 field name (A_SupplierInvoice)
      decision        : String(12) @mandatory @assert.range enum { Release; KeepBlocked; Escalate; };
      rootCause       : String(20) @assert.range enum { Duplicate; Overdue; AboveThreshold; PaymentBlock; SupplierData; Other; };
      note            : String(1000);                                 // required when decision = Escalate (checked in the service)
      aiAssisted      : Boolean default false;                        // true if the note started from an AI draft
      decidedBy       : String(100) @mandatory;                       // the person in P2 (P4 only sees the technical client)
      decidedAt       : Timestamp;                                    // set by P4 when missing
}

entity HoldList {
  key supplierNo : String(10);                                        // S/4 supplier number (InvoicingParty)
      holdUntil  : Date @mandatory;
      reason     : String(255);
}

entity Thresholds {
  key currency : String(3);
      amount   : Decimal(15, 2) @mandatory;
}

@assert.unique: { finding: [ partnerId, addressId, field, rule ] }
entity Issues : cuid, managed {
  partnerId        : String(10) @mandatory;                           // BusinessPartner
  addressId        : String(10) @mandatory;                           // AddressID
  field            : String(30) @mandatory @assert.range enum { StreetName; HouseNumber; PostalCode; CityName; Country; };
  rule             : String(40) @mandatory;                           // e.g. POSTAL_FORMAT, STREET_MISSING
  severity         : String(6)  @assert.range enum { High; Medium; Low; } default 'Medium';
  status           : String(12) @assert.range enum { Open; InProgress; Fixed; FalseAlarm; } default 'Open';
  owner            : String(100);
  falseAlarmReason : String(500);
  currentValue     : String(255);
  lastCheckedAt    : Timestamp;
  questionText     : String(2000);
  aiAssisted       : Boolean default false;
}
