using { mdcr } from '../db/schema';

@path: '/odata/v4/requests'
service RequestService @(requires: 'Requester') {

  @odata.draft.enabled
  @restrict: [{ grant: '*', to: 'Requester', where: 'createdBy = $user' }]
  entity ChangeRequests as projection on mdcr.ChangeRequests {
    *,
    case when status.code = 'N' then true else false end                         as canSubmit         : Boolean,
    case when status.code = 'A' then 3 when status.code = 'R' then 1 when status.code = 'S' then 2 else 0 end  as statusCriticality : Integer,
    case when riskTier = 'L' then 3 when riskTier = 'M' then 2 when riskTier = 'H' then 1 else 0 end     as riskCriticality   : Integer,
    case when riskTier = 'L' then 'Low' when riskTier = 'M' then 'Medium' when riskTier = 'H' then 'High' end as riskTierText : String(10)
  } actions {
    action submit() returns ChangeRequests;
  };

  @restrict: [{ grant: '*', to: 'Requester', where: 'parent.createdBy = $user' }]
  entity ChangeItems as projection on mdcr.ChangeItems;

  @readonly entity Suppliers     as projection on mdcr.Suppliers excluding { requests };
  @readonly entity Addresses     as projection on mdcr.Addresses;
  @readonly entity RequestStatus as projection on mdcr.RequestStatus;
  @readonly entity ChangeableFields as projection on mdcr.RiskRules { key field, tier, note };
}
