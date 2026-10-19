Still "Permission denied" for `armen`, with the key offered correctly on my end, so the Mac isn't accepting it yet. Either the paste hasn't gone in, or Remote Login is scoped to specific users. Two things to check on the Mac:

```
grep -c stormer-claudecode ~/.ssh/authorized_keys     # should print 1
sudo dscl . -read /Groups/com.apple.access_ssh GroupMembership   # armen should be listed, or the group shouldn't exist
```

If the first prints 0, run the paste from before. If the second lists users and `armen` isn't among them, System Settings → General → Sharing → Remote Login → "Allow access for: All users" (or add armen). Then I'll retry.