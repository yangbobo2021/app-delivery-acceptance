# Scenario importance for requirement-owned designs

Read the complete original requirements, the current business goal, confirmed scope and relevant context groups before grading one requirement's scenarios. The single requirement owns each scene; grouping only supplies dependencies. Analyst and independent Reviewer use this same standard in generation, repair and resumed work.

| Grade | Use when failure would mean |
| --- | --- |
| P0 | An essential step or outcome of an admitted core business closure fails, or a concrete major risk such as serious data corruption, money loss or access-control exposure occurs. |
| P1 | An important common operation, branch or recovery behavior substantially harms users while the core closure and major-risk invariants remain available. |
| P2 | Secondary or less frequent behavior has lower impact and an acceptable alternative when needed. |
| P3 | Minor experience or low-impact edge combination. |

Judge the *specific failure proved by the scene*, not a keyword in its requirement. Explain the consequence, affected users, actual safeguards and whether an alternative is already verified and acceptable in the agreed scope. Later code repair, rollback, manual reconciliation or changing a valid configuration do not downgrade a broken core path. An invalid input corrected by the user can have a different grade; decide from the actual business effect. No fixed percentage or number of scenes per grade applies, and a requirement does not automatically receive a P0.

Review the whole scene list for a requirement together. Independently ask which plausible incorrect implementation could still pass it, whether scenes test distinct failure mechanisms, and whether their P0 set jointly proves the applicable core closure or major risks. Check consistency with other requirements under the same business goal. A scene that primarily tests another requirement should move to that requirement's list; retain a cross-requirement dependency only as context. A scene may combine multiple input groups when they share one testing purpose. Do not broaden the admitted scope merely to improve completeness or code coverage.

Design approval does not prove the product. Actual execution, evidence and independent case assessment are separate gates. If an implementation or requirement version changes, re-evaluate the affected grading and review before reusing a verdict.
