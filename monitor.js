import {
  LAMPORTS_PER_SOL,
  Keypair,
  Connection,
  PublicKey,
} from "@solana/web3.js";
import axios from "axios";
import dotenv from "dotenv";
dotenv.config();

import { getPublicKeys, getTokenPrice } from "./util.js";
import { connectDB } from "./db.js";
import { TOKEN_PROGRAM_ID, NATIVE_MINT } from "@solana/spl-token";
import * as SPLToken from "@solana/spl-token";

const NET_URL = process.env.RPC_CONNECTION || "";

const fetchBalances = async (publicKeys) => {
  try {
    const requests = [];

    // Batch requests in groups of 100 and add them to the requests array
    for (let i = 0; i < publicKeys.length; i += 100) {
      requests.push(
        axios.post(NET_URL, {
          jsonrpc: "2.0",
          id: 1,
          method: "getMultipleAccounts",
          params: [
            publicKeys.slice(i, i + 100),
            {
              encoding: "base58",
            },
          ],
        })
      );
    }

    // Execute all requests in parallel
    const responses = await Promise.all(requests);

    // Sum all balances concurrently
    const totalSolBalance = responses.reduce((acc, response) => {
      const values = response.data.result.value;
      values.forEach((value) => {
        if (value != null) {
          acc += value.lamports;
        }
      });
      return acc;
    }, 0);

    return totalSolBalance / LAMPORTS_PER_SOL;
  } catch (error) {
    console.error(error);
    return 0;
  }
};

const getTokenAccountBalance = async (publicKey) => {
  const payload = {
    jsonrpc: "2.0",
    id: 1,
    method: "getTokenAccountsByOwner",
    params: [
      publicKey,
      { programId: TOKEN_PROGRAM_ID },
      { encoding: "jsonParsed" },
    ],
  };

  try {
    let tokenBalanceInUSDT = 0;
    const response = await fetch(NET_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();

    // Extract and log uiAmounts
    if (data.result && data.result.value.length > 0) {
      const accounts = data.result.value;
      for (const account of accounts) {
        const uiAmount = account.account.data.parsed.info.tokenAmount.uiAmount;
        const mint = account.account.data.parsed.info.mint;

        // Wait before making the next request
        await new Promise((resolve) => setTimeout(resolve, 1000)); // 1 second delay

        const tokenPrice = await getTokenPrice(mint);
        console.log(
          `Wallet address: ${publicKey}, mint: ${mint}, uiAmount: ${uiAmount}, tokenPrice: ${tokenPrice}`
        );

        tokenBalanceInUSDT += uiAmount * tokenPrice;
      }

      return tokenBalanceInUSDT;
    } else {
      console.log("No token accounts found.");
    }
  } catch (error) {
    console.error("Error fetching token accounts:", error);
  }

  // try {
  //   const response = await axios.post(NET_URL, {
  //     jsonrpc: "2.0",
  //     id: 1,
  //     method: "getAssetsByOwner",
  //     params: {
  //       ownerAddress: publicKey,
  //       page: 1, // Starts at 1
  //       limit: 1000,
  //       displayOptions: {
  //         showFungible: true, //return both fungible and non-fungible tokens
  //       },
  //     },
  //   });
  //   const assets = response.data.result.items;
  //   let tokenPrice = 0;
  //   assets.forEach(async (asset) => {
  //     if (asset.interface === "FungibleToken") {
  //       tokenPrice += asset.token_info.price_info?.total_price;
  //     }
  //   });
  //   if (isNaN(tokenPrice)) {
  //     tokenPrice = 0;
  //   }
  //   return tokenPrice;
  // } catch (error) {
  //   console.log("    ERROR :", error);
  //   return 0;
  // }
};

const calculateTotalBalanceInUSDT = async () => {
  const publicKeys = await getPublicKeys();
  const solPriceInUSDT = await getTokenPrice(NATIVE_MINT);
  console.log("[KING] sol price:", solPriceInUSDT);

  const totalSolBalanceInUSDT =
    (await fetchBalances(publicKeys)) * solPriceInUSDT;
  console.log("[KING] sol balance:", totalSolBalanceInUSDT);

  // let totalTokenBalanceInUSDT = 0;

  // for (let i = 0; i < publicKeys.length; i++) {
  //   totalTokenBalanceInUSDT += await getTokenAccountBalance(publicKeys[i]);
  // }

  // console.log("[KING] token balance:", totalTokenBalanceInUSDT);

  return totalSolBalanceInUSDT;
  // return totalSolBalanceInUSDT + totalTokenBalanceInUSDT;
};

connectDB();

const logTotalBalance = () => {
  calculateTotalBalanceInUSDT()
    .then((totalBalance) => console.log("Total Balance:", totalBalance))
    .catch((error) => console.error("Error calculating total balance:", error));
};

setInterval(logTotalBalance, 600000); // 10 minutes in milliseconds

logTotalBalance();
