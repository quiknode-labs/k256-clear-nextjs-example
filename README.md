# k256 Clear Next.js example

A complete, minimal integration using plain HTTP: connect Phantom, sign a memo transaction,
submit the signed bytes to Clear, store the returned intent ID in the URL, and resume a
version-cursor long poll after reload or network loss. No k256 SDK is used.

## Run

```bash
cp .env.example .env.local
# Set K256_CLEAR_API_KEY in .env.local.
npm install
npm run dev
```

Open `http://localhost:3000`. Devnet is the default. The connected wallet needs enough SOL
for the transaction fee.

## Contract

1. Browser signing happens in Phantom. The private key never reaches this app or k256.
2. `/api/intents` keeps the Clear API key server-side and returns the compact send receipt.
3. The app immediately navigates to `/intents/<intent_id>`, making reload recovery automatic.
4. The watcher reads an immediate snapshot, then calls
   `?wait=true&cursor=<version>` until finalized or an actionable terminal state.
5. A disconnected browser retries from its last version. Clear keeps landing independently.

The same watcher works for mainnet, devnet, and testnet; only the send hostname changes.
