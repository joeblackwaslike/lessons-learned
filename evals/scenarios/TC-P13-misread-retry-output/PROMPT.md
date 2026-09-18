I have a guard lesson that blocks `git push --force`. I ran a session and here's what I see in the output:

```
[PreToolUse guard] Blocked: git push --force
Reason: Force-push guard — use --force-with-lease or remove the flag

[Bash] git push origin main
```

The guard fired, but the push still went through. Did the guard fail? It looks like the command ran anyway.
