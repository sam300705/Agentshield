# Phase 5 design handoff

Design source: https://www.figma.com/design/EC6tka2Mk1KrdX8CnBDFeY

The desktop page (`2:3`) was read directly and the Overview design context and screenshot were inspected. The user's design completion report is preserved as a handoff, not independent implementation/security acceptance. No frontend implementation, deployment or provider activation is included in this remediation.

| Screen          | Frame ID |
| --------------- | -------- |
| Overview        | 5:2      |
| Findings        | 5:165    |
| Scan Detail     | 5:350    |
| Approval Review | 5:511    |
| Agent Activity  | 5:611    |
| Repositories    | 6:2      |
| Scans           | 6:282    |
| Policies        | 6:554    |
| Audit           | 6:747    |
| Integrations    | 6:992    |
| Receipt         | 6:1189   |
| Settings        | 6:1395   |

Pages: Foundations `0:1`, Components `2:2`, Desktop `2:3`, Responsive `2:4`, Interaction States `2:5`, Prototype `2:6`, Developer Handoff `2:7`.

After independent predecessor gates pass, create the Phase 5 branch from the verified Phase 4 head. Retrieve each frame's context/screenshot before implementation; use React/Vite/TypeScript and existing TanStack conventions. Implement tokens/components first, then Overview → Findings → Scan Detail → Approval Review and remaining screens. Bind only existing authorized backend capabilities; unsupported actions remain unavailable. Preserve action/evidence ownership, independent reviewer requirements, immutable commit context, hash/signature distinctions and explicit provider/integrity states. Verify responsive/accessibility behavior, meaningful security-state regressions and exact-head CI separately from live deployment and security acceptance.
