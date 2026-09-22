---
name: update-contributions
description: Automatically scans Git commit history and updates CONTRIBUTIONS.md with key functional milestones per team member.
---

# Update Contributions Skill

This skill automates reviewing Git commit logs and updating `CONTRIBUTIONS.md` to reflect the main contributions of each team member in a clean, simple tabular format.

## Workflow

1. **Extract Git Log:**
   ```bash
   git log --format="%h|%an|%ae|%s"
   ```

2. **Filter & Classify Contributions:**
   - Group main features under the respective team member:
     - **Ashin Sabu Mathew (`@AshinSMathew`):** P2P network, encryption, multi-network, in-app file preview, seeding, dashboard.
     - **Abin Raju Daniel (`@abinrd`):** Storage quotas/allocation, Android mobile app screens & background sync.
     - **Goldi Babu (`@goldibabu14`):** Data recovery/erasure coding, chunk protection & deletion, cleanup, public catalog sync.
     - **Ann Maria Jaison (`@Ann-Maria-Jaison`):** Requirements, workflow modeling, QA testing, documentation & reports.

3. **Format Guidelines for `CONTRIBUTIONS.md`:**
   - Keep the format as a single markdown table.
   - Do not include job designations/titles.
   - Keep the language clear, simple, and non-overly technical.
