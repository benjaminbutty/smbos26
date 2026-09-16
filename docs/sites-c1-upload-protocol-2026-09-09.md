# Sites C1 public-upload protocol

**Status:** C1 contract decision. No public upload route, provider grant, or
anonymous submission handler is implemented in this checkpoint.

## Purpose and boundary

Public Forms need private file attachments without sending a 10 MiB PDF
through a hosted request body. The application therefore uses a narrow
database-backed grant and a private Supabase Storage upload capability. A Site
release never grants access to a bucket or to arbitrary storage paths.

This protocol is a reusable Form attachment capability for C3. It is not a
Sites-only storage bucket, and it does not change the existing managed-image
boundary.

## Finite grant contract

One application grant authorises one immutable storage key for one configured
public Form submission attempt. It contains trusted Business/Form/release and
attempt identities, a random grant ID, one unique file position from one to
five, a 64-character HMAC client subject, maximum byte size, reserved bytes,
exact application/provider/reservation expiry, grant state and independent
reservation state:

`reserved -> issued -> uploaded -> finalized`

`reserved | issued | uploaded -> expired | rejected | cleaned`, and
`expired | rejected -> cleaned`.

Every grant begins with `reservation_state: reserved`. A reconciler may set
`reservation_state: released` only at or after `reservation_expires_at`, after
it locks the grant and rechecks the provider window, asset authority and
submission references. Releasing capacity never deletes a finalized managed
asset or its immutable submission-attempt attachment reference.

A `reserved` grant has no provider issue timestamps. If provider issuance
never completes or its outcome is uncertain, it may reach a terminal state
with both provider timestamps absent, while its conservative reservation stays
active until reconciliation releases it.

The server creates the key; callers cannot supply a storage path, overwrite an
old key, extend a grant, or re-open a terminal grant. The provider capability
is deliberately treated as reusable until its full provider expiry. The
application grant is the one-time finalisation authority. A retry against a
`finalized` grant returns its original immutable managed-asset result. A
finalizer may move `issued` to `uploaded` only after it has verified the object;
it may move `uploaded` to `finalized`. It rejects the other terminal states.

| Limit | Decision |
| --- | --- |
| Files per submission | 5 |
| PDF limit | 10 MiB |
| Accepted image limit | Existing 3 MiB / 20 MP managed-image boundary |
| Shared quarantine provider limit | 10 MiB per upload capability |
| Application grant lifetime | 15 minutes |
| Provider signed-upload capability | Exactly Supabase’s two-hour capability lifetime |
| Reservation lifetime | Two hours and 15 minutes from application issuance, conservatively covering the 15-minute application grant plus the provider’s two-hour capability lifetime |
| Bucket | Private quarantine prefix; never a public bucket |
| Issue rate | 10 grant issues per Form/client HMAC/minute |
| Attempt quota | 5 unique file positions and at most 50 MiB reserved per attempt |
| In-flight Business reservation | 512 MiB across unreleased reservations |
| In-flight Form reservation | 256 MiB across unreleased reservations |
| In-flight client reservation | 100 MiB across unreleased reservations |

The application refuses an expired grant after 15 minutes. Provider issuance
is recorded with its actual issue and two-hour expiry timestamp. A conservative
reservation lasts for 15 minutes plus two hours from the application issue, so
it covers provider-capability creation or one bounded retry at the end of the
application window. It continues through finalized quarantine state until a
locked reconciliation releases capacity. This short-lived attachment
reservation is distinct from a Business's long-term Storage quota.

The private quarantine bucket must allow the 10 MiB PDF capability. [Supabase
Storage applies file limits at the bucket boundary](https://supabase.com/docs/guides/storage/uploads/file-limits),
not to an individual signed upload capability, so every grant reserves that
full 10 MiB provider maximum.
An image grant still accepts only 3 MiB after the server verifies its stored
object. C3 must prove this bucket configuration and rejection path against
Storage; a 3 MiB image reservation would undercount a malicious 10 MiB upload.

## Issue, upload and finalise

1. A narrow authenticated or anonymous issue endpoint resolves the current
   release/Form server-side. It allocates a server random submission-attempt
   ID and position, rejects a sixth position or duplicate position, applies the
   stated Business/Form/client rate limit in a database transaction, locks the
   stable Business issuance row before summing Business/Form/client active
   reservations (so an empty set cannot admit concurrent phantom grants),
   reserves maximum bytes and records `reserved`.
2. The server obtains a private signed upload URL for its random quarantine
   key. It sets no upsert/overwrite mode, records the actual provider issue and
   expiry timestamps, then changes that same reservation to `issued`. If the
   provider call has an uncertain outcome, the reservation stays active through
   its conservative expiry rather than being released early. The response
   contains only that URL, key-specific capability and bounded file
   requirements.
3. The browser uploads directly to private Storage. The application has not
   accepted an attachment merely because Storage returned success.
4. Finalisation locks the grant and rechecks its exact release/Form/attempt
   binding and 15-minute application lifetime. It reads authoritative object
   metadata and bounded bytes, validates detected type against the declared
   MIME family, validates PDF structure or decodes/re-encodes images as
   applicable, then records `uploaded`. A transaction then creates the
   immutable managed asset and an attachment reference bound to that exact
   submission attempt, then records `finalized`. A later Business-submission
   transaction consumes only finalized attachment references for the same
   Business/Form/release/attempt; it never accepts a browser-provided asset ID.
   Repeating finalisation returns the same internal asset binding. An
   expired/rejected/cleaned grant cannot be resurrected.
5. The finalised asset is readable only through a narrow authorised download
   resolver. It sends private attachment headers, including disposition,
   `nosniff`, an exact content type and no shared public cache. Anonymous
   receipts do not expose the underlying asset ID or match state.

The database asset/reference transaction is atomic. The managed asset ID is
internal-only: public responses identify an opaque grant or receipt, never the
asset. Storage inspection and any
later physical promotion are not database transactions: the final asset keeps
the verified quarantine key and hash until the provider capability expires.
The signed URL uses no-upsert, so it cannot overwrite that verified object.
Only after expiry may a separately locked reconciler copy/move it to a durable
private prefix; it must preserve the hash and asset authority before cleaning
the quarantine key. A network response after bytes were written is therefore a
retry of the same grant, not a second finalisation.

## Abuse, cleanup and evidence requirements

Client identity is an HMAC of a server-derived network signal. On Vercel the
issue route accepts only `x-vercel-forwarded-for`; local development may use
the local proxy signal; an unknown production proxy is denied rather than
falling back to browser-supplied forwarding headers. The raw address is never
stored. The one-minute counter is keyed by Business, Form and HMAC subject;
attempt reservations are keyed by Business, Form and attempt ID. Neither is
process-local. The issue transaction takes the stable Business issuance lock
and then locks and sums every unreleased reservation, including finalized
quarantine objects, and rejects the stated Business/Form/client in-flight byte
caps before it issues another provider capability.

Cleanup may remove only an expired, rejected or cleaned-but-unfinalised
quarantine object after provider expiry and a locked recheck of grant state,
submission references and managed-asset references. A reconciliation can
release its separate short-lived reservation counter at that point, including
for a finalized quarantine object, while the finalized asset and its attempt
reference remain protected by submission/business retention. Finalized
attachments are not orphan cleanup candidates.

The current C1 tests can validate deterministic request/grant schemas only.
They do **not** prove Supabase signed-upload expiry, object metadata, byte
inspection, private download headers, proxy identity or storage cleanup. C3
must run those against a disposable Storage target before this protocol is
accepted as implementation evidence.

The provider-lifetime decision follows [Supabase's documented two-hour signed
upload capability](https://supabase.com/docs/reference/javascript/file-buckets-createsigneduploadurl),
and the Vercel-only proxy-header rule follows its [documented request
headers](https://vercel.com/docs/headers/request-headers). C3 must verify both
with deployed provider behavior rather than treating these deterministic
contract tests as enforcement proof.
