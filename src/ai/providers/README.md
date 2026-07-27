# AI provider boundary

Provider adapters belong here when the AI builder milestone begins.

The application must use structured, allow-listed operations. Providers must
not receive arbitrary SQL, shell, source-editing, or unvalidated HTTP tools,
and the deterministic SMBOS runtime must continue working when a provider is
unavailable.

No provider SDK or runtime call is part of Milestone 0.
