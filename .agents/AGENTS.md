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
