# Protected restore credential-activation follow-up

Store PR #128 and licensing PR #3 were merged after passing CI and review with
identical tested/merged trees. Protected run 42461224009 used Store
`de0f0ea9295267a604c0f31d8b325f23fd1baa7f` and authority
`5b5f398a95a7b03ba14a8a51981064ea973432b3`. Its digest-verified sanitized receipt
reports remoteArchive=true, successful source capture/resume and both cleanup
passes; a later authorization assertion returned 403 instead of 200. Independent
Cloudflare reads confirmed no rehearsal Workers, KV namespaces or R2 buckets.
No production write, live payment or real email occurred.

Review found that the new secret-install helper used bulk updates without the
immediate Durable Object deployment already used by the lifecycle helper. The
pinned Wrangler bulk command has no code-update strategy option; active objects
can retain their prior environment. A provider-model regression fails on the old
helper (replacement expected, original retained), then passes when every secret
installation reuses the existing immediate deployment. The setup loop reuses its
returned endpoints, avoiding duplicate deployments. The test also checks private
file removal on failed installation and complete resource cleanup.

Failure receipts now include a fixed acceptance phase and named authorization
assertions, without credentials or response bodies. Deployment and retirement
instructions were updated. Full CI and the subsequent protected run own final
acceptance; the failed run is not evidence of completed rotation.

Paid Entitle sales and scheduled licensing capture remain disabled. Ordinary
backups, archive destinations, retention and protected reviewer rules are unchanged.
