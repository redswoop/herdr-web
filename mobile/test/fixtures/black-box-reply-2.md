Still "Permission denied" for `deploy`, with the key offered correctly on my end, so the build host isn't accepting it yet. Either the paste hasn't gone in, or remote login is scoped to specific users. Two things to check on the host:

```
grep -c ci-runner-key ~/.ssh/authorized_keys     # should print 1
sudo dscl . -read /Groups/com.apple.access_ssh GroupMembership   # deploy should be listed, or the group shouldn't exist
```

If the first prints 0, run the paste from before. If the second lists users and `deploy` isn't among them, System Settings → General → Sharing → Remote Login → "Allow access for: All users" (or add deploy). Then I'll retry.