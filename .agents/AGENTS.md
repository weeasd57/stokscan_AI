# Agent Workflow and Rules

## Workflow
```mermaid
graph TD
    Planner --> DeveloperAgent[Developer Agent]
    DeveloperAgent --> QAReviewer[QA Reviewer Agent]
    QAReviewer --> Check{Passed?}
    Check -- Yes --> NextTask[✅ Pass - Next Task]
    Check -- No --> DeveloperAgent[❌ Fail - Back to Developer]
```

## Rules
- **Rule**: After completing every task, the Developer must invoke the QA Reviewer.
- **Rule**: No task may be marked complete until the QA Reviewer returns PASS.
- **Rule**: If FAIL is returned, the Developer must fix all issues and repeat the review.
- **Rule**: All requests from Vercel must go directly to Supabase. All website data must be stored in Supabase, and updated only from Hugging Face via the daily automated jobs.
- **Rule**: Never push/upload any changes to GitHub unless the user explicitly requests it.

