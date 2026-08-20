# k256 Clear Next.js example

A complete, minimal integration using plain HTTP: connect Phantom, sign a memo transaction,
submit the signed bytes to Clear, store the returned intent ID in the URL, and resume a
version-cursor long poll after reload or network loss. No k256 SDK is used.

## Run

```bash
cp .env.example .env.local
# Set K256_CLEAR_API_KEY in .env.local.
npm install
npm test
npm run typecheck
npm run dev
```

Open `http://localhost:3000`. Devnet is the default. The connected wallet needs enough SOL
for the transaction fee.

The API routes spend the server's `K256_CLEAR_API_KEY`. Add authentication before deploying
this example publicly so visitors cannot use your account. The status route holds a request
for up to 20 seconds; configure a serverless function duration of at least 30 seconds.
`K256_CLEAR_READ_ORIGIN` optionally overrides the default `https://api.k256.xyz` read and
control origin for a private environment.

## Contract

1. Browser signing happens in Phantom. The private key never reaches this app or k256.
2. `/api/intents` keeps the Clear API key server-side and returns the compact send receipt.
3. The app immediately navigates to `/intents/<intent_id>`, making reload recovery automatic.
4. The watcher reads an immediate snapshot, then calls
   the realtime lifecycle stream (`GET /v1/clear/events?id=…`, JSON long-poll rendering,
   resumed by `seq` cursor) and re-reads the canonical snapshot once per real transition,
   until finalized or an actionable terminal state.
5. A disconnected browser retries from its last version with bounded backoff. Clear keeps
   landing independently.
6. If signed bytes expire, the intent page rebuilds the same memo with fresh validity and
   sends the new signature back under the same intent ID. The original action is kept in the
   URL fragment so it survives reload without being sent to the server; treat the URL like the
   public on-chain memo it contains. The page rejects fragments whose cluster or gate does not
   match the authoritative intent. Re-signing must preserve the original message exactly apart
   from fresh validity; adding or changing instructions creates a different action and Clear
   rejects it.
7. While an intent is still active, **Stop further attempts** calls Clear's cancel control and
   reports the exact stop outcome; bytes already sent to Solana cannot be revoked.

The same watcher works for mainnet, devnet, and testnet; only the send hostname changes.
