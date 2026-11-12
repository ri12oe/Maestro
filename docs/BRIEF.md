# Group Project Referee — Concept Brief

AI Builders Challenge – North America · Wildcard track · Primary development tool: IBM Bob

## The problem

**Group Project Referee is an AI teammate that reads a student team's repo and task board, shows who is carrying what, and flags trouble before the deadline.**

In most group projects, the instructor only sees the final product. Uneven workloads surface at the end, through peer evaluations written from memory, after it is too late to fix anything. Students rarely raise the issue mid-project because it feels like accusing a teammate.

The tools teams already use do not help. Commit counts and lines changed reward the wrong things: one reformatting commit can outweigh a week of careful design work. Nobody has a neutral, evidence-backed view of the project while there is still time to rebalance.

## The solution

A team connects its GitHub repo and task list once. From then on, the Referee keeps a shared, live picture of the project that every member sees.

| Feature | What it does | Why it matters |
| --- | --- | --- |
| Contribution map | Breaks down each member's work by substance, not line count: features, fixes, tests, docs, design | Shows real effort, including work that counts poorly in raw stats |
| Risk radar | Compares the plan to actual activity; flags stalled tasks, single points of failure and deadline risk | Catches problems while there is still time |
| Rebalance suggestions | Proposes concrete task swaps based on the skills each member has shown in their work | Turns "this isn't fair" into a specific, actionable fix |
| Weekly digest (stretch) | Plain-language team summary, plus a neutral check-in message the team can send | Lowers the social cost of raising problems |
| End-of-project report (stretch) | Evidence-linked contribution summary for peer evaluations (team opt-in) | Replaces memory and bias with a record |

The MVP covers the first three.

## AI approach

AI does the judging that raw stats can't: what a change actually was, which task it served, and whether the plan is on track.

1. **Classify each contribution.** An LLM reads each commit and PR diff with its message and labels it with structured JSON output: type (feature, fix, test, refactor, docs, formatting, generated/boilerplate), estimated substance (low, medium or high) and a one-line summary. Cache results by commit SHA.
2. **Match work to the plan.** Embeddings match each contribution to the GitHub Issue it serves, so the Referee knows how far along each task is, not just who committed.
3. **Reason about risk.** A reasoning step compares task status, due dates and who has touched which part of the codebase. It returns flagged risks, each with evidence links (e.g. "Auth task: no activity for 6 days, due Friday, only Sam has touched the backend").
4. **Suggest a rebalance.** Using the skills each member has shown, the model proposes specific reassignments and drafts a neutral check-in message.

Every AI judgment links back to the commits or tasks behind it, so students can check it and dispute it.

Model: IBM Granite via watsonx.ai preferred (sponsor fit); any capable LLM API works. Keep the LLM behind one provider interface so it can be swapped.

## Architecture

Data flow, left to right:

```
Sources                 Ingestion              AI layer                      Dashboard
- Commits and PRs  -->  GitHub API sync  -->   1. Classifier          -->    - Contribution map
- Issues / tasks        event store            2. Task matcher               - Member evidence
- Manual work log       (SQLite)               3. Risk reasoner              - Risk radar
                                                  (risks + rebalance)        - Rebalance panel
                                                                             - Log work
```

| Layer | Choice | Notes |
| --- | --- | --- |
| Frontend | React + TypeScript (Vite), Sass | Monorepo package `client/` |
| Backend | Node + TypeScript (Express) | Monorepo package `server/`; REST API plus sync jobs |
| Data sources | GitHub REST API (commits, PRs, Issues) | Personal access token in `.env` for the MVP (read-only) |
| Storage | SQLite (MVP) | Tables: teams, members, tasks, contributions, classifications, risks, suggestions |
| AI | LLM + embeddings | Classifier, task matcher, risk reasoner, all with structured JSON output |
| Hosting | Vercel (frontend) + Render or Railway (API) | Public demo link for judges |

## Screens (from the UI draft)

1. **Connect your team** — repo input, task source (GitHub Issues or uploaded list), invite teammates, fairness promise.
2. **Team overview** — stat cards (tasks done, tasks at risk, suggestions waiting), contribution map with a stacked bar per member by work type, risk preview, suggested swap preview.
3. **Member evidence** — AI summary, work-type breakdown, table of contributions (date, change, AI label, substance, linked task, "Wrong label?" dispute button).
4. **Risk radar** — risk cards (high/medium/low) with evidence chips, task progress table.
5. **Rebalance suggestions** — from/to task swap with reasons, Accept / Discuss / Dismiss, drafted check-in message.
6. **Log off-repo work** — form (type, related task, description, link) and recently logged list.

Look: off-white background (#F6F6F3), dark sidebar (#16181D), one blue accent (#1F5FBF), orange for risk (#A34A06 on #FDF0E4). Fonts: Space Grotesk (headings), Inter (body).

## Fairness rules (product requirements)

- Every member sees the same view; no hidden admin view.
- Work artifacts only: no keystroke, screen or activity tracking.
- Off-repo work (design, research, meetings, coordination) can be logged.
- Every AI judgment links to its evidence and can be disputed.
- The AI never scores, grades or ranks people. No leaderboards.
- Suggestions are framed around the project, not the person.

## MVP scope and milestones

**In the MVP:** GitHub ingestion, contribution classifier, matching work to GitHub Issues, contribution map, member evidence, risk radar, rebalance suggestions, manual work log.

**Out of scope:** Google Docs and Slack sources, weekly digest, instructor report, multi-team classrooms, real-time webhooks, user accounts beyond a simple team setup.

1. **Nov 12–17: Foundations.** Monorepo scaffold, TypeScript and test tooling, SQLite schema and migrations, GitHub ingestion service.
2. **Nov 18–24: AI core.** Contribution classifier with JSON schema and caching, embedding-based task matching, a hand-labeled test set of about 30 commits to measure accuracy.
3. **Nov 25–Dec 1: Product.** Dashboard screens, risk reasoner, rebalance panel, manual work log.
4. **Dec 2–7: Demo-ready.** Seeded demo repo with 4 simulated teammates and a planted problem (one stalled task, one overloaded member), deployment, README.
5. **Dec 8–10: Submit.** 3-minute video, slides, project page, BOB_LOG.md. Deadline: Dec 10, 5:00 PM ET.

## Constraints

- Keep secrets (GitHub token, LLM API key) in `.env`, never committed; provide `.env.example`.
- Keep a `BOB_LOG.md` with dated entries of what IBM Bob built in each session.
- Prefer simple, readable code over clever abstractions; this is a 4-week student build.
