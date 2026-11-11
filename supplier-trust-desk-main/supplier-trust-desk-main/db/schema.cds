namespace mdcr;

using { cuid, managed, sap.common.CodeList } from '@sap/cds/common';


entity Suppliers : cuid, managed {
  supplierNo : String(10) @mandatory;          // like BusinessPartner
  name       : String(80) @mandatory;          // like BusinessPartnerFullName
  taxNumber  : String(20);                     // like BPTaxNumber
  addresses  : Composition of many Addresses on addresses.supplier = $self;
  requests   : Association to many ChangeRequests on requests.supplier = $self;
}

entity Addresses : cuid {
  supplier    : Association to Suppliers;
  street      : String(60);                    // StreetName
  houseNumber : String(10);                    // HouseNumber
  postalCode  : String(10);                    // PostalCode
  city        : String(40);                    // CityName
  country     : String(2);                     // Country (ISO 3166-1 alpha-2)
}

entity ChangeRequests : cuid, managed {
  supplier     : Association to Suppliers @mandatory;
  address      : Association to Addresses;     // needed when an address field changes
  reason       : String(255) @mandatory;
  status       : Association to RequestStatus default 'N' @readonly;  // only the server's actions change it (fix 9 Nov: was writable in a draft)
  decidedBy    : String(255) @readonly;
  decidedAt    : Timestamp   @readonly;
  decisionNote : String(255) @readonly;
  requestedOn  : Date        @readonly;      // set by the server when the request is first saved
  riskTier     : String(1)   @readonly @assert.range enum { L; M; H; };
  riskReason   : String(255) @readonly;
  approvalMode : String(10)  @readonly @assert.range enum { Auto; FourEyes; };
  items        : Composition of many ChangeItems on items.parent = $self;
}

entity ChangeItems : cuid {
  parent   : Association to ChangeRequests;
  field    : String(20) @mandatory @assert.range enum {
               street; houseNumber; postalCode; city; country; name; taxNumber;
             };
  oldValue : String(80) @readonly;             // filled by the server, never by the client
  newValue : String(80) @mandatory;
}

entity RequestStatus : CodeList {
  key code : String(1) enum { New = 'N'; Submitted = 'S'; Approved = 'A'; Rejected = 'R'; };
}

entity PostalCodeRules : managed {
  key country : String(2);
      pattern : String(100) @mandatory;
      example : String(20);
}

entity RiskRules : managed {
  key field : String(20) @assert.range enum { street; houseNumber; postalCode; city; country; name; taxNumber; };
      tier  : String(1)  @mandatory @assert.range enum { L; M; H; };
      note  : String(255);
}

entity Settings : managed {
  key name        : String(40);
      value       : Integer @mandatory;
      description : String(255);
}

entity OpenLocks {
  key supplier_ID : UUID;
  key fieldGroup  : String(20);   // 'address.postal' for postalCode + country, else the field name
      request_ID  : UUID;
}
