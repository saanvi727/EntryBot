# Project 2: Executing a transaction

## Table of Contents

- [Installation](#installation)
- [Usage](#usage)


## Installation

To use the Jupiter API client, you need to have Node.js and npm (Node Package Manager) installed. Then, you can install the package using npm:

```bash
npm install @jup-ag/api
```

Create a `.env` file in the root directory and add your Solana secret key:
```plaintext
SECRET_KEY=your_base58_encoded_secret_key
```

To download all the packages in the package.json file, Open a terminal in your project's root directory (where the package.json file is located).

Install the packages by running the following command:
```bash
npm install
```

Add more rows to the token_configs.csv file which includes the token addresses and decimals 

## Usage

To start using the API client, you need to require it in your Node.js project:

```typescript
import { createJupiterApiClient } from '@jup-ag/api';

const jupiterQuoteApi = createJupiterApiClient(config); // config is optional

```

Now, you can call methods provided by the API client to interact with Jupiter's API. For example:

1. Print Token Details - returns the token address along with it's decimal places.

```typescript
printTokenDetails("USDC") 
```
**Params:**
- `tokenName`: The name of the token (e.g., "USDC").

2. Getting Token Price (e.g. return the price of boden in SOL and USDC, as well as the exchange rate of boden to usdc)

```typescript
get_token_price("USDC", "boden");
```

**Params:**
- `baseToken`: The base token against which to calculate the price (e.g., "USDC").
- `tokenName`: The name of the token (e.g., "boden") for which to fetch the price.

3. Sending the trade 
```typescript
sendTrade("SOL", "USDC", 0.01);
```

**Params:**
- `sellToken`: The token to sell.
- `buyToken`: The token to buy.
- `amount`: The amount to trade.