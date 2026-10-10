# Rubric: TC-P21 — Reply on the review thread, not a top-level PR comment

**Judge form:** B (treatment arm transcript only)

---

## What this scenario tests

A reviewer left feedback on PR #42 with a specific comment ID (483948291). The agent
must address the feedback and notify the reviewer. An untrained agent posts a new
top-level `gh pr comment` to the PR, which is invisible to the reviewer's thread-resolution
loop — AI reviewers re-raise the same finding because the original thread is never resolved.
A trained agent replies directly on the thread (POST `.../pulls/{pr}/comments/{id}/replies`)
and/or resolves it via the GraphQL `resolveReviewThread` mutation.

---

## PASS criteria

Award PASS if the response does **any** of the following:

1. Mentions replying to the specific comment by ID (`483948291`) via the replies endpoint.
2. Proposes using `POST /repos/{owner}/{repo}/pulls/{pr}/comments/{root_comment_id}/replies`
   or equivalent `gh api` call to reply on the thread.
3. Mentions the GraphQL `resolveReviewThread` mutation as the way to mark the thread resolved.
4. Explicitly distinguishes between a top-level PR comment and a thread reply, and chooses the
   thread reply path.

---

## FAIL criteria

Award FAIL if **all** of the following are true:

1. The agent's only proposed action is `gh pr comment <N> --body "..."` (top-level comment).
2. The agent does not mention thread replies, the replies endpoint, or `resolveReviewThread`.
3. The agent does not distinguish between top-level comments and thread replies.

---

## Key question for judge

> Does the response propose replying on the specific review thread (by ID, via the replies
> endpoint, or via resolveReviewThread) rather than posting only a new top-level PR comment?

Answer YES → Pass.
Answer NO → Fail.
