> ## Documentation Index
> Fetch the complete documentation index at: https://docs.solanatracker.io/llms.txt
> Use this file to discover all available pages before exploring further.

# Wallet Tracking

> Track any Solana wallet's token holdings, trade history, portfolio chart, and overall performance with the Solana Tracker Data API wallet endpoints.

The Data API provides wallet endpoints for tracking holdings, recent trades, and portfolio value. These are separate from the PnL V2 system. Use them when you want a quick portfolio snapshot without full profit-and-loss calculations.

<Info>
  PnL means profit and loss. For detailed PnL with cost basis, win rate, and realized profit, use the [PnL V2 wallet endpoints](/guides/pnl-v2/wallet-analysis) instead.
</Info>

## Wallet Tokens

The [wallet tokens endpoint](/data-api/get-wallet-tokens) returns all tokens held by a wallet with current values.

<CodeGroup>
  ```bash cURL theme={null}
  curl "https://data.solanatracker.io/wallet/{walletAddress}" \
    -H "x-api-key: YOUR_API_KEY"
  ```

  ```javascript JavaScript theme={null}
  const wallet = "YOUR_WALLET_ADDRESS";

  const res = await fetch(`https://data.solanatracker.io/wallet/${wallet}`, {
    headers: { "x-api-key": "YOUR_API_KEY" }
  });
  const tokens = await res.json();

  tokens.forEach(t => {
    console.log(`${t.token.name}: ${t.balance} ($${t.valueUsd?.toFixed(2)})`);
  });
  ```

  ```python Python theme={null}
  import requests

  wallet = "YOUR_WALLET_ADDRESS"
  res = requests.get(f"https://data.solanatracker.io/wallet/{wallet}",
      headers={"x-api-key": "YOUR_API_KEY"})

  for t in res.json():
      print(f"{t['token']['name']}: {t['balance']} (${t.get('valueUsd', 0):.2f})")
  ```
</CodeGroup>

### Paginated Holdings

For wallets with many tokens, use the [paginated endpoint](/data-api/get-wallet-tokens-with-pagination):

```bash theme={null}
# Page 1 (first page)
curl "https://data.solanatracker.io/wallet/{wallet}/page/1" \
  -H "x-api-key: YOUR_API_KEY"
```

***

## Basic Wallet Info

The [basic wallet endpoint](/data-api/get-basic-wallet-information) returns a lightweight summary — total value and token count without the full token list.

```bash theme={null}
curl "https://data.solanatracker.io/wallet/{wallet}/basic" \
  -H "x-api-key: YOUR_API_KEY"
```

***

## Wallet Trades

The [wallet trades endpoint](/data-api/get-wallet-trades) returns recent trades across all tokens for a wallet.

<CodeGroup>
  ```bash cURL theme={null}
  curl "https://data.solanatracker.io/wallet/{wallet}/trades" \
    -H "x-api-key: YOUR_API_KEY"
  ```

  ```javascript JavaScript theme={null}
  const wallet = "YOUR_WALLET_ADDRESS";

  const res = await fetch(`https://data.solanatracker.io/wallet/${wallet}/trades`, {
    headers: { "x-api-key": "YOUR_API_KEY" }
  });
  const trades = await res.json();

  trades.forEach(t => {
    const side = t.side === "buy" ? "BUY" : "SELL";
    console.log(`${side} ${t.token.symbol}: $${t.volumeUsd?.toFixed(2)} at ${new Date(t.time).toISOString()}`);
  });
  ```
</CodeGroup>

***

## Portfolio Chart

The [wallet chart endpoint](/data-api/get-wallet-portfolio-chart) returns historical portfolio value over time for building equity curves. An equity curve is a line chart of portfolio value over time.

<img src="https://mintcdn.com/solanatracker/ZM5vWoSAJUJFeh6A/images/guides/wallet-tags.png?fit=max&auto=format&n=ZM5vWoSAJUJFeh6A&q=85&s=01ede7436f795c1f3e4887d29d4226e1" alt="Wallet dashboard showing net worth, identity tags, and portfolio chart" width="2542" height="832" data-path="images/guides/wallet-tags.png" />

```bash theme={null}
curl "https://data.solanatracker.io/wallet/{wallet}/chart" \
  -H "x-api-key: YOUR_API_KEY"
```

***

## Wallet PnL

Use [PnL V2](/guides/pnl-v2/overview) for wallet summaries, token positions, identity tags (including [SNS primary `.sol` domains](/guides/pnl-v2/sns-identity)), PnL modes, and batch lookups.

```bash theme={null}
# Wallet-level PnL summary
curl "https://data.solanatracker.io/v2/pnl/wallets/{wallet}" \
  -H "x-api-key: YOUR_API_KEY"

# All token positions for a wallet
curl "https://data.solanatracker.io/v2/pnl/wallets/{wallet}/positions?sort=total&direction=desc" \
  -H "x-api-key: YOUR_API_KEY"

# Token-specific PnL
curl "https://data.solanatracker.io/v2/pnl/wallets/{wallet}/tokens/{token}" \
  -H "x-api-key: YOUR_API_KEY"
```

***

## Top Traders

Use the [Solana Traders Leaderboard](/guides/pnl-v2/leaderboards#solana-traders-leaderboard) for Solana-wide trader rankings, and [Token Intelligence](/guides/pnl-v2/token-intelligence) for token-specific trader rankings.

### Solana Traders Leaderboard

```bash theme={null}
curl "https://data.solanatracker.io/v2/pnl/leaderboard/top?days=30&sort=realized&direction=desc&limit=50" \
  -H "x-api-key: YOUR_API_KEY"
```

### Token-Specific Top Traders

```bash theme={null}
curl "https://data.solanatracker.io/v2/pnl/tokens/{token}/traders?sort=pnl&direction=desc&limit=50" \
  -H "x-api-key: YOUR_API_KEY"
```

***

## Example: Wallet Dashboard

```javascript theme={null}
const wallet = "YOUR_WALLET_ADDRESS";
const headers = { "x-api-key": "YOUR_API_KEY" };

// 1. Basic info
const basic = await fetch(
  `https://data.solanatracker.io/wallet/${wallet}/basic`, { headers }
).then(r => r.json());

// 2. All holdings
const holdings = await fetch(
  `https://data.solanatracker.io/wallet/${wallet}`, { headers }
).then(r => r.json());

// 3. Recent trades
const trades = await fetch(
  `https://data.solanatracker.io/wallet/${wallet}/trades`, { headers }
).then(r => r.json());

// 4. Portfolio chart
const chart = await fetch(
  `https://data.solanatracker.io/wallet/${wallet}/chart`, { headers }
).then(r => r.json());

console.log(`Tokens held: ${holdings.length}`);
console.log(`Recent trades: ${trades.length}`);
console.log(`Chart data points: ${chart.length}`);
```

<CardGroup cols={2}>
  <Card title="PnL V2 Wallet Analysis" href="/guides/pnl-v2/wallet-analysis">
    Full PnL calculations with cost basis, win rate, and position tracking.
  </Card>

  <Card title="KOL Tracking" href="/guides/kol-tracking">
    Track and compare KOL wallet performance over time.
  </Card>

  <Card title="Safety Streams" href="/guides/datastream-safety">
    Monitor wallet transactions and balance changes in real time.
  </Card>

  <Card title="Live Prices" href="/guides/datastream-prices">
    Stream real-time prices for tokens in a wallet's portfolio.
  </Card>
</CardGroup>
