using { mdcr } from '../db/schema';

@path: '/odata/v4/config'
service ConfigService @(requires: 'RuleAdmin') {
  @odata.draft.enabled entity PostalCodeRules as projection on mdcr.PostalCodeRules;
  @odata.draft.enabled entity RiskRules       as projection on mdcr.RiskRules;
  @odata.draft.enabled entity Thresholds      as projection on mdcr.Thresholds;

  @odata.draft.enabled
  @restrict: [{ grant: ['READ', 'UPDATE'], to: 'RuleAdmin' }]
  entity Settings as projection on mdcr.Settings;

  @readonly entity HoldList as projection on mdcr.HoldList;
}
