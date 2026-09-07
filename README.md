# DBZ Fuzion Calibrated QA

Foundry VTT QA harness for `dbz-fuzion-calibrated`.

The QA panel covers calculation, transformation, sheet, item, roll, attack, compendium, and migration smoke tests. It creates temporary fixtures and includes a fixture cleanup action.

The compendium tools populate starter species, qualities, transformations, sample items, and a baseline sample actor. The compendium QA test verifies that seeding remains idempotent.
