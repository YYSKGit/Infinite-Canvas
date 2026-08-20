# Project Agent Guidelines

## Browser testing

- Do not run browser-based tests by default. The user will normally perform manual browser verification.
- Run browser tests only when they are necessary to complete the current task, are expected to substantially improve execution efficiency, or have a high probability of directly diagnosing or resolving the issue.
- Prefer targeted static checks, unit tests, source-level regression tests, and non-browser integration tests when they provide adequate confidence.
- If browser testing is warranted, keep it narrowly scoped to the behavior that cannot be verified reliably by lighter-weight methods.