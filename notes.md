1. 1_sfdc_pipeline_current.csv checksum:
Scorecard:  006PF000001T001
Salesforce: 006PF000001T001YAC
Salesforce: 006PF000001T001ABC
this is not possible due to checksum
- checksum: deterministic value calculated from data (006PF000001T001 → always → YAC)
- why use checksum? excel is case-insensitive, so including YAC at the end will be unique always:
takeaways about checksum:
1. The checksum is irrelevant for the scorecard-to-Salesforce join, because the scorecard only contains 15-character IDs. It is not completely irrelevant in the CSV; retaining the full ID still helps with validation and other system integrations.
2. The scorecard has a weak data design, but its creator is not necessarily stupid. Fifteen-character Salesforce IDs are valid, especially in older or Salesforce-internal workflows. However, using 18-character IDs would be safer in Excel.

