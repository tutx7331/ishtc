> ## Documentation Index
> Fetch the complete documentation index at: https://docs.solanatracker.io/llms.txt
> Use this file to discover all available pages before exploring further.

# Get Wallet Trades

> Gets the latest trades of a wallet

## SDK Example

<CodeGroup>
  ```typescript SDK
  import { Client } from '@solana-tracker/data-api';

  const client = new Client({ apiKey: 'YOUR_API_KEY' });

  const data = await client.getWalletTrades('FbMxP3GVq8TQ36nbYgx4NP9iygMpwAwFWJwW81ioCiSF');

  ```
</CodeGroup>


## OpenAPI

````yaml /data-api/openapi.json get /wallet/{owner}/trades
openapi: 3.1.0
info:
  title: Solana Tracker Data API
  description: >-
    Solana Tracker Data API for token prices, holders, trades, charts, wallet
    data, risk signals, and market analytics.
  version: 1.0.0
  contact:
    email: contact@solanatracker.io
servers:
  - url: https://data.solanatracker.io
    description: Production server
security:
  - apiKey: []
paths:
  /wallet/{owner}/trades:
    get:
      tags:
        - Wallet
      summary: Get Wallet Trades
      description: Gets the latest trades of a wallet
      parameters:
        - name: owner
          in: path
          required: true
          schema:
            type: string
        - name: cursor
          in: query
          description: Cursor for pagination
          schema:
            type: string
      responses:
        '200':
          description: Successful response
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/TradesResponse'
              example:
                trades:
                  - tx: >-
                      3wpLJJVCb7Z5ANgtqqkJxkmhEh1y5yvE4GkPESuAtjQWbqFFd2PAzhouVh3Yu4EwTWYXtytptjFy8DHU3L8s6fMg
                    from:
                      address: So11111111111111111111111111111111111111112
                      amount: 0.00009915
                      token:
                        name: Wrapped SOL
                        symbol: SOL
                        image: >-
                          https://image.solanatracker.io/proxy?url=https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png
                        decimals: 9
                      priceUsd: 125.35988901852102
                    to:
                      address: EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm
                      amount: 0.026196
                      token:
                        name: dogwifhat
                        symbol: $WIF
                        image: >-
                          https://image.solanatracker.io/proxy?url=https://bafkreibk3covs5ltyqxa272uodhculbr6kea6betidfwy3ajsav2vjzyum.ipfs.nftstorage.link
                        decimals: 6
                      priceUsd: 0.47447827898100314
                    price:
                      usd: 0.47447827898100314
                      sol: '0.003784928996793404'
                    volume:
                      usd: 0.012429432996186358
                      sol: 0.00009915
                    wallet: FDnJSXgkjxLy74tjKbAT519nh4p1SRXazR7YAgFsGBQb
                    program: jupiter
                    time: 1742287684000
      x-codeSamples:
        - lang: typescript
          label: SDK
          source: >
            import { Client } from '@solana-tracker/data-api';


            const client = new Client({ apiKey: 'YOUR_API_KEY' });


            const data = await
            client.getWalletTrades('FbMxP3GVq8TQ36nbYgx4NP9iygMpwAwFWJwW81ioCiSF');
      x-code-samples:
        - lang: typescript
          label: SDK
          source: >
            import { Client } from '@solana-tracker/data-api';


            const client = new Client({ apiKey: 'YOUR_API_KEY' });


            const data = await
            client.getWalletTrades('FbMxP3GVq8TQ36nbYgx4NP9iygMpwAwFWJwW81ioCiSF');
components:
  schemas:
    TradesResponse:
      type: object
      properties:
        trades:
          type: array
          items:
            $ref: '#/components/schemas/Trade'
        nextCursor:
          type: integer
        hasNextPage:
          type: boolean
    Trade:
      type: object
      properties:
        tx:
          type: string
        from:
          type: object
          properties:
            address:
              type: string
            amount:
              type: number
            token:
              type: object
              properties:
                name:
                  type: string
                symbol:
                  type: string
                image:
                  type: string
                decimals:
                  type: integer
        to:
          type: object
          properties:
            address:
              type: string
            amount:
              type: number
            token:
              type: object
              properties:
                name:
                  type: string
                symbol:
                  type: string
                image:
                  type: string
                decimals:
                  type: integer
        price:
          type: object
          properties:
            usd:
              type: number
            sol:
              type: string
        volume:
          type: object
          properties:
            usd:
              type: number
            sol:
              type: number
        wallet:
          type: string
        program:
          type: string
        time:
          type: integer
  securitySchemes:
    apiKey:
      type: apiKey
      in: header
      name: x-api-key
      description: API Key for authentication

````