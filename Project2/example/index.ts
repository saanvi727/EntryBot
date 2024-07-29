import {
  QuoteGetRequest,
  QuoteResponse,
  createJupiterApiClient,
} from "../src/index";
import { Connection, Keypair, VersionedTransaction } from "@solana/web3.js";
import { Wallet } from "@project-serum/anchor";
import bs58 from "bs58";
import { transactionSenderAndConfirmationWaiter } from "./utils/transactionSender";
import { getSignature } from "./utils/getSignature";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import csvParser from "csv-parser";
import axios from 'axios';

dotenv.config();
/**
* Asynchronously loads token mappings from a CSV file.
* 
* Reads a CSV file named 'token_configs.csv' located in the same directory
* and parses it to create a mapping of token names to their respective addresses and decimals.
* 
* @returns {Promise<{ [key: string]: { token_address: string, decimals: number } }>} A promise that resolves to an object where each key is a token name and the value is an object containing the token address and decimals.
* @throws Will throw an error if the CSV file cannot be read or parsed.
*/
async function loadTokenMappings(): Promise<{ [key: string]: { token_address: string, decimals: number } }> {
  // Initialize an empty object to store the token mappings
  const tokenAddressMap: { [key: string]: { token_address: string, decimals: number } } = {};
  
  // Resolve the file path to the CSV file
  const csvFilePath = path.resolve(__dirname, 'token_configs.csv');
  return new Promise((resolve, reject) => {
      // Create a read stream for the CSV file
      const stream = fs.createReadStream(csvFilePath);

      // Pipe the read stream through the CSV parser
      stream.pipe(csvParser())
          .on('data', (row: { token_name: string, token_address: string, decimals: string }) => {
              // Process each row of data from the CSV
              tokenAddressMap[row.token_name] = {
                  token_address: row.token_address,
                  decimals: parseInt(row.decimals, 10), // Parse decimals as an integer
              };
          })
          .on('end', () => {
              // Logging the loaded token mappings when parsing is complete
              console.log('Token mappings loaded:', tokenAddressMap);
              // Resolve the promise with the token mappings object
              resolve(tokenAddressMap);
          })
          .on('error', (err) => {
              // Reject the promise if there's an error during reading or parsing
              reject(err);
          });

      // Handle any error from creating the read stream
      stream.on('error', (err) => {
          reject(err);
      });
  });
}

/**
* Asynchronously retrieves and prints details of a token based on its name.
* 
* Loads token mappings from 'token_configs.csv' and retrieves details such as address and decimals
* for the specified token name. Prints the token's address and decimals to the console.
* 
* @param {string} tokenName The name of the token whose details are to be printed.
* @throws {Error} Throws an error if the specified token name is not found in the token mappings.
* @returns {Promise<void>} A promise that resolves once token details are printed.
*/

async function printTokenDetails(tokenName: string) {
  // Load token mappings from CSV file
  const tokenAddressMap = await loadTokenMappings();

  // Retrieve token details from the loaded mappings
  const tokenDetails = tokenAddressMap[tokenName];

  // Throw error if token details are not found
  if (!tokenDetails) {
      throw new Error(`Token ${tokenName} not found in tokenMappings`);
  }

  // Print token details to console
  console.log(`Token ${tokenName}:`);
  console.log(`- Address: ${tokenDetails.token_address}`);
  console.log(`- Decimals: ${tokenDetails.decimals}`);
}

/**
* Asynchronous main function to execute trading operations based on configuration.
* 
* This function loads configuration from 'trade_params.json', including token mappings,
* calculates amounts with decimals, prints token details, and executes trading operations
* based on the value of the FLOW environment variable ('quote' or 'quoteAndSwap').
* It also fetches and displays the current price of a token named "BODEN" in SOL and USD.
*/
async function main() {
  try {
   // Resolve path to the configuration file
    const configPath = path.resolve(__dirname, 'trade_params.json');

    // Read and parse configuration from JSON file
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

    console.log('Config loaded:', config);

    // Load token mappings
    const tokenAddressMap = await loadTokenMappings();

    // Retrieve token details for inputMint and outputMint from token mappings
    const inputMintDetails = tokenAddressMap[config.inputMint];
    const outputMintDetails = tokenAddressMap[config.outputMint];

    // Throw error if inputMint or outputMint is not found in token mappings
    if (!inputMintDetails || !outputMintDetails) {
      throw new Error("Token name not found in tokenMappings");
    }

    // Retrieve token addresses from token details
    const inputMint = inputMintDetails.token_address;
    const outputMint = outputMintDetails.token_address;

    // Calculate the amount with decimals
    const amount = config.amount * Math.pow(10, inputMintDetails.decimals);

    // Log updated configuration after token mappings
    console.log('Config after token mapping:', {
      ...config,
      inputMint,
      outputMint,
      amount,
    });

    // Print token details for inputMint and outputMint
    await printTokenDetails(config.inputMint);
    await printTokenDetails(config.outputMint);

    // Proceed with quote or quoteAndSwap based on FLOW environment variable
    switch (process.env.FLOW) {
      case "quote": {
        //await flowQuote(inputMint, outputMint, amount, config.onlyDirectRoutes, config.asLegacyTransaction);
        await flowQuote(inputMint, outputMint, amount, false, false);
        break;
      }
      case "quoteAndSwap": {
        await flowQuoteAndSwap(inputMint, outputMint, amount, false, false);
        break;
      }
      default: {
        console.error("Please set the FLOW environment");
      }
    }
    
  } catch (error) {
    // Catch and log any errors that occur during execution
    console.error('Error:', error);
  }
}

const connection = new Connection("https://restless-indulgent-arm.solana-mainnet.quiknode.pro/b900fbea82ae617632b685b65a1b97d258a739d7/");
const jupiterQuoteApi = createJupiterApiClient();

/**
* Asynchronously calculates and retrieves the price of a token in SOL and USD based on its exchange rate.
* 
* This function fetches the current price of SOL in USD, calculates how many SOL can be obtained for $1000 USD,
* fetches the exchange rate between the specified token and a base token (e.g., SOL), calculates how many
* tokens can be obtained for the calculated SOL amount, and finally computes the token's price in SOL and USD.
* 
* @param {string} tokenName The name of the token (e.g., "BODEN") for which to fetch the price.
* @param {string} baseToken The base token against which to calculate the price (e.g., "SOL").
* @returns {Promise<{ price_in_sol: number, price_in_usdc: number }>} A promise that resolves with the token's price in SOL and USD.
*/
async function get_token_price(baseToken: string, tokenName: string): Promise<{ price_in_sol: number, price_in_usdc: number }> {
  const sol_usd_price = await fetch_sol_price();
  const sol_coins = 1000 / sol_usd_price;

  const exchangeRateSolToToken = await fetchExchangeRateFromDEX(baseToken, tokenName);
  const token_amount_from_sol = sol_coins * exchangeRateSolToToken;

  const exchangeRateTokenToUSDC = await fetchExchangeRateFromDEX(tokenName, "USDC");
  const price_token_usdc = 1 / exchangeRateTokenToUSDC;
  const price_token_sol = price_token_usdc / sol_usd_price;

  console.log(`Price in SOL: ${price_token_sol}, Price in USD: ${price_token_usdc}`);
  return { price_in_sol: price_token_sol, price_in_usdc: price_token_usdc };
}

/**
* Asynchronously fetches the current price of SOL (Solana) in USD from an external API.
* 
* This function fetches the current price of SOL in USD from the CoinGecko API,
* extracts the SOL price from the API response, and returns it.
* 
* @returns {Promise<number>} A promise that resolves with the current price of SOL in USD.
*/
async function fetch_sol_price(): Promise<number> {
  try {
      //API endpoint for SOL price in USD
      const apiUrl = 'https://price.jup.ag/v6/price?ids=SOL&vsToken=USDC';

      // Fetch data from the API
      const response = await axios.get(apiUrl);

      // Extract SOL price from the API response
      const sol_price_usd = response.data.data.SOL.price;
      console.log('SOL price in USD:', sol_price_usd);

      // Return the SOL price
      return sol_price_usd;

  } catch (error) {
      console.error('Error fetching SOL price:', error);
      throw error; // Handle or re-throw the error as needed
  }
}

/**
* Asynchronously calculates the amount of a token (e.g., BODEN) that can be obtained for a given amount of SOL,
* based on the exchange rate between the token and a base token (e.g., SOL).
* 
* This function fetches the exchange rate between the specified token and base token,
* calculates the token amount using the provided SOL amount and exchange rate, and returns it.
* 
* @param {string} tokenName The name of the token (e.g., "BODEN") for which to calculate the amount.
* @param {number} sol_coins The amount of SOL coins to exchange for the token.
* @param {number} exchangeRate The exchange rate between the token and the base token (e.g., SOL).
* @param {string} baseToken The base token against which to calculate the exchange rate (e.g., "SOL").
* @returns {Promise<number>} A promise that resolves with the calculated amount of the token.
*/
async function calculate_token_amount(tokenName: string, sol_coins: number, exchangeRate: number, baseToken: string): Promise<number> {
  try {
      // Fetch exchange rate from an API or DEX contract
      const exchangeRate = await fetchExchangeRateFromDEX(baseToken, tokenName);
      
      // Calculate token amount based on the exchange rate and SOL coins
      const token_amount = sol_coins * exchangeRate;
      
      // Return the calculated token amount
      return token_amount;
  } catch (error) {
      console.error(`Error calculating ${tokenName} amount:`, error);
      // Handle or re-throw the error as needed
      throw error; 
  }
}

/**
* Asynchronously fetches the exchange rate between a specified token and a base token (e.g., SOL).
* 
* This function queries a DEX API to fetch the current exchange rate between the specified token
* and the base token, extracts the exchange rate from the API response, and returns it.
* 
* @param {string} tokenName The name or ID of the token (e.g., "BODEN") for which to fetch the exchange rate.
* @param {string} baseToken The base token against which to calculate the exchange rate (e.g., "SOL").
* @returns {Promise<number>} A promise that resolves with the exchange rate as a number.
*/
async function fetchExchangeRateFromDEX(baseToken: string, tokenName: string): Promise<number> {
  try {
    // Construct API URL to query exchange rate
    const apiUrl = `https://price.jup.ag/v6/price?ids=${tokenName}&vsToken=${baseToken}`;

    // Fetch exchange rate from the API
    const response = await axios.get(apiUrl);

    // Extract exchange rate from the API response
    const exchangeRate = response.data.data[tokenName]?.price;

    // Check if exchange rate is defined
    if (exchangeRate === undefined) {
      throw new Error(`Exchange rate for ${tokenName} to ${baseToken} not found in API response`);
    }

    // Log exchange rate for debugging and monitoring
    console.log(`Exchange rate for ${tokenName} to ${baseToken}:`, exchangeRate);

    // Return the exchange rate as a number
    return exchangeRate;
  } catch (error) {
    // Handle errors during API request or extraction
    console.error(`Error fetching exchange rate for ${tokenName} to ${baseToken}:`, error);
    throw error; // Handle or re-throw the error as needed
  }
}

/**
* Asynchronously fetches a quote for a token swap using the Jupiter API.
* 
* This function constructs a request to the Jupiter API to fetch a quote for swapping a specified
* amount of one token (`inputMint`) to another token (`outputMint`). It includes options for direct routes
* and legacy transactions, handles the API response, and returns the quote.
* 
* @param {string} inputMint The mint address of the input token.
* @param {string} outputMint The mint address of the output token.
* @param {number} amount The amount of the input token to swap.
* @param {boolean} onlyDirectRoutes Flag to indicate if only direct routes should be used for the swap.
* @param {boolean} asLegacyTransaction Flag to indicate if the swap should be processed as a legacy transaction.
* @returns {Promise<QuoteResponse>} A promise that resolves with the quote response from the Jupiter API.
*/
async function getQuote(inputMint: string, outputMint: string, amount: number, onlyDirectRoutes: boolean, asLegacyTransaction: boolean) {
  // Construct parameters for the quote request
  try {
    // Load token mappings
    const tokenAddressMap = await loadTokenMappings();

    // Retrieve token addresses from token mappings
    const inputMintDetails = tokenAddressMap[inputMint];
    const outputMintDetails = tokenAddressMap[outputMint];

    // Throw error if inputMint or outputMint is not found in token mappings
    if (!inputMintDetails || !outputMintDetails) {
        throw new Error("Token name not found in tokenMappings");
    }

    // Calculate the amount with decimals
    const adjustedAmount = amount * Math.pow(10, inputMintDetails.decimals);

    // Construct parameters for the quote request
    const params: QuoteGetRequest = {
        inputMint: inputMintDetails.token_address,
        outputMint: outputMintDetails.token_address,
        amount: adjustedAmount,
        slippageBps: 50, // Example value for slippage
        onlyDirectRoutes,
        asLegacyTransaction,
    };

    // Fetch quote from the Jupiter API
    const quote = await jupiterQuoteApi.quoteGet(params);
    console.log("Quote response:", quote);

    // Check if the quote response is valid
    if (!quote) {
        throw new Error("Unable to get quote");
    }

    // Return the quote response
    return quote;
} catch (error) {
    // Handle errors during the quote fetching process
    console.error("Error fetching quote:", error);
    throw error; // Re-throw the error to propagate it further
}
}

/**
* Asynchronously creates a swap object for executing a token swap using the Jupiter API.
* 
* This function constructs a request to the Jupiter API to create a swap object based on the provided quote
* and the user's wallet information. The swap object contains all necessary information to perform the swap.
* 
* @param {Wallet} wallet The user's wallet containing the public key for the swap.
* @param {QuoteResponse} quote The quote response from the Jupiter API for the swap.
* @returns {Promise<SwapResponse>} A promise that resolves with the swap object from the Jupiter API.
*/
async function getSwapObj(wallet: Wallet, quote: QuoteResponse) {
  try {
    // Construct the swap request with the provided quote and wallet information
    const swapObj = await jupiterQuoteApi.swapPost({
      swapRequest: {
        quoteResponse: quote,
        userPublicKey: wallet.publicKey.toBase58(),
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: "auto",
      },
    });

    // Return the swap object
    return swapObj;
  } catch (error) {
    // Handle errors during the swap object creation process
    console.error("Error in getSwapObj:", error);
    throw error;
  }
}

/**
* Asynchronously handles the process of fetching a quote for a token swap and additional processing.
* 
* This function fetches a quote for swapping a specified amount of one token (`inputMint`) to another token (`outputMint`)
* using the Jupiter API, and logs the quote response. It includes options for direct routes and legacy transactions.
* 
* @param {string} inputMint The mint address of the input token.
* @param {string} outputMint The mint address of the output token.
* @param {number} amount The amount of the input token to swap.
* @param {boolean} onlyDirectRoutes Flag to indicate if only direct routes should be used for the swap.
* @param {boolean} asLegacyTransaction Flag to indicate if the swap should be processed as a legacy transaction.
* @returns {Promise<void>} A promise that resolves when the quote process is completed.
*/
async function flowQuote(inputMint: string, outputMint: string, amount: number, onlyDirectRoutes: boolean, asLegacyTransaction: boolean) {
  try {
    // Fetch the quote using the provided parameters
    const quote = await getQuote(inputMint, outputMint, amount, onlyDirectRoutes, asLegacyTransaction);
    console.log("Quote response:", quote);
    // Additional processing if needed
  } catch (error) {
    // Handle errors during the quote fetching process
    console.error("Error in flowQuote:", error);
    throw error; // Re-throw the error to propagate it further
  }
}

/**
* Asynchronously handles the process of fetching a quote and executing a token swap using the Jupiter API.
* 
* This function performs the following steps:
* 1. Creates a wallet object from a secret key.
* 2. Fetches a quote for swapping a specified amount of one token (`inputMint`) to another token (`outputMint`).
* 3. Creates a swap object based on the fetched quote.
* 4. Logs the wallet public key, quote, and swap object for debugging.
* 
* @param {string} inputMint The mint address of the input token.
* @param {string} outputMint The mint address of the output token.
* @param {number} amount The amount of the input token to swap.
* @param {boolean} onlyDirectRoutes Flag to indicate if only direct routes should be used for the swap.
* @param {boolean} asLegacyTransaction Flag to indicate if the swap should be processed as a legacy transaction.
* @returns {Promise<void>} A promise that resolves when the quote and swap process is completed.
*/  
async function flowQuoteAndSwap(inputMint: string, outputMint: string, amount: number, onlyDirectRoutes: false, asLegacyTransaction: false) {
  // Create a wallet object from a secret key
  const wallet = new Wallet(
    Keypair.fromSecretKey(bs58.decode(process.env.SECRET_KEY || ""))
  );
  console.log("Wallet:", wallet.publicKey.toBase58());

  try {
    // Fetch the quote using the provided parameters
    const quote = await getQuote(inputMint, outputMint, amount, onlyDirectRoutes, asLegacyTransaction);
    console.dir(quote, { depth: null });

    // Create the swap object using the fetched quote
    const swapObj = await getSwapObj(wallet, quote);
    console.dir(swapObj, { depth: null });

    const swapTransactionBuf = Buffer.from(swapObj.swapTransaction, "base64");
    var transaction = VersionedTransaction.deserialize(swapTransactionBuf);

    transaction.sign([wallet.payer]);
    const signature = getSignature(transaction);

    const { value: simulatedTransactionResponse } =
    await connection.simulateTransaction(transaction, {
      replaceRecentBlockhash: true,
      commitment: "processed",
    });
    
    const { err, logs } = simulatedTransactionResponse;

    if (err) {
      // Simulation error, we can check the logs for more details
      // If you are getting an invalid account error, make sure that you have the input mint account to actually swap from.
      console.error("Simulation Error:");
      console.error({ err, logs });
      return;
    }
  
    const serializedTransaction = Buffer.from(transaction.serialize());
    const blockhash = transaction.message.recentBlockhash;
  
    const transactionResponse = await transactionSenderAndConfirmationWaiter({
      connection,
      serializedTransaction,
      blockhashWithExpiryBlockHeight: {
        blockhash,
        lastValidBlockHeight: swapObj.lastValidBlockHeight,
      },
    });
  
    // If we are not getting a response back, the transaction has not confirmed.
    if (!transactionResponse) {
      console.error("Transaction not confirmed");
      return;
    }
  
    if (transactionResponse.meta?.err) {
      console.error(transactionResponse.meta?.err);
    }
  
    console.log(`https://solscan.io/tx/${signature}`);

    // Serialize and sign transaction as before
  } catch (error) {
    // Handle errors during the quote and swap process
    console.error("Error in flowQuoteAndSwap:", error);
    throw error; // Re-throw the error to propagate it further
  }
}

async function sendTrade(sellToken: string, buyToken: string, amount: number){
  const connection = new Connection("https://restless-indulgent-arm.solana-mainnet.quiknode.pro/b900fbea82ae617632b685b65a1b97d258a739d7/");
  const wallet = new Wallet(Keypair.fromSecretKey(bs58.decode(process.env.SECRET_KEY || "")));
  
  try {

    const quote = await getQuote(sellToken, buyToken, amount, false, false);
    console.dir(quote, { depth: null });
    const swapObj = await getSwapObj(wallet, quote);
    console.dir(swapObj, { depth: null });
    const swapTransactionBuf = Buffer.from(swapObj.swapTransaction, "base64");
    let transaction = VersionedTransaction.deserialize(swapTransactionBuf);

    transaction.sign([wallet.payer]);
    const signature = getSignature(transaction);

    const { value: simulatedTransactionResponse } = await connection.simulateTransaction(transaction, {
      replaceRecentBlockhash: true,
      commitment: "processed",
    });

    if (simulatedTransactionResponse.err) {
      console.error("Simulation Error:", simulatedTransactionResponse.err, simulatedTransactionResponse.logs);
      return;
    }

    const serializedTransaction = Buffer.from(transaction.serialize());
    const blockhash = transaction.message.recentBlockhash;

    const transactionResponse = await transactionSenderAndConfirmationWaiter({
      connection,
      serializedTransaction,
      blockhashWithExpiryBlockHeight: {
        blockhash,
        lastValidBlockHeight: swapObj.lastValidBlockHeight,
      },
    });

    if (!transactionResponse) {
      console.error("Transaction not confirmed");
      console.log("Transaction failed.");
      return;
    }

  
    if (transactionResponse.meta?.err) {
      console.error(transactionResponse.meta?.err);
      console.log("Transaction failed.");
      const transaction = "Transaction successful";
    } else {
      console.log("Transaction successful.");
      const transaction = "Transaction failed";
    }

    console.log(`Transaction confirmed: https://solscan.io/tx/${signature}`);
    return transaction;

  } catch (error) {
    console.error("Error executing trade:", error);
  }
}


// Call the function to execute the trade

//printTokenDetails(tokenName: string)
//printTokenDetails("USDC"); 

//getQuote(inputMint: string, outputMint: string, amount: number, onlyDirectRoutes: boolean, asLegacyTransaction: boolean)
//getQuote("USDC", "POPCAT", 1, false, false);

//get_token_price(baseToken: string, tokenName: string)
//get_token_price("USDC", "popcat");

//sendTrade(sellToken: string, buyToken: string, amount: number)
sendTrade("USDC", "BODEN", 0.0001);