import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import BN from "bn.js";
import {
  getAccount,
  getAssociatedTokenAddress,
  getMint,
} from "@solana/spl-token";
import fs from "fs";
import bs58 from "bs58";
import axios from "axios";
import dotenv from "dotenv";
dotenv.config();

import { fetchSecretKeys } from "./db.js";
import { connection } from "./bundle.js";

export const JITO_TIMEOUT = 40000;
const JITO_TIP = 0.0005;

let cachedSolPrice = null;
let lastFetched = 0;
const CACHE_DURATION = 60 * 1000; // 1 minute cache duration

export const sleep = (ms) => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

export const getPublicKeys = async () => {
  const secretKeys = await fetchSecretKeys();
  if (!secretKeys) {
    throw new Error("No secret keys found");
  }

  const publicKeys = secretKeys.map((secretKey) => {
    const privateKeyArray = bs58.decode(secretKey);
    const keypair = Keypair.fromSecretKey(privateKeyArray);
    return keypair.publicKey.toBase58();
  });

  return publicKeys;
};

export const getTokenPrice = async (tokenMint) => {
  // Check cache validity
  // if (cachedSolPrice && Date.now() - lastFetched < CACHE_DURATION) {
  //   return cachedSolPrice;
  // }

  // Fetch the latest price
  try {
    const response = await axios.get(
      `https://api.geckoterminal.com/api/v2/simple/networks/solana/token_price/${tokenMint}`,
      {
        headers: {
          Accept: "application/json",
        },
      }
    );

    const tokenPrices = response.data?.data?.attributes?.token_prices;

    if (tokenPrices && tokenPrices[tokenMint]) {
      return tokenPrices[tokenMint];
    } else {
      return 0;
    }
  } catch (error) {
    console.error("Error fetching token price:", error);
    return 0; // Return cached value if available, otherwise 0
  }
};

export const getJitoTipAccount = () => {
  const tipAccounts = [
    "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5",
    "HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe",
    "Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY",
    "ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49",
    "DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh",
    "ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt",
    "DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL",
    "3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT",
    "FCBi1XSMDu1Dku3WZkVSCSjZPisv82KhTP7s9V6vKfGF",
  ];
  // Randomly select one of the tip addresses
  const random = Math.floor(Math.random() * tipAccounts.length);
  const selectedTipAccount = tipAccounts[random == 0 ? 0 : random - 1];
  const priorityTipAccount = tipAccounts[tipAccounts.length - 1];
  return {
    jitoAccount: selectedTipAccount,
    jitoPriorityAccount: priorityTipAccount,
  };
};

export const getTipTransaction = (ownerPubkey, tip, recentBlockhash) => {
  try {
    const tipAccount = new PublicKey(getJitoTipAccount().jitoAccount);
    const instructions = [
      SystemProgram.transfer({
        fromPubkey: ownerPubkey,
        toPubkey: tipAccount,
        lamports: tip,
      }),
    ];
    const messageV0 = new TransactionMessage({
      payerKey: ownerPubkey,
      recentBlockhash,
      instructions,
    }).compileToV0Message();

    return new VersionedTransaction(messageV0);
  } catch (err) {
    console.log(err);
  }
  return null;
};

export const getFeeInstruction = async (payer, received, fee) => {
  try {
    const instruction = SystemProgram.transfer({
      fromPubkey: payer,
      toPubkey: received,
      lamports: fee,
    });
    return instruction;
  } catch (err) {
    console.log(err);
  }
  return null;
};

export const getTipInstruction = async (payer, tip) => {
  try {
    const tipAccount = new PublicKey(getJitoTipAccount().jitoAccount);
    const priorityAddAccount = new PublicKey(
      getJitoTipAccount().jitoPriorityAccount
    );
    const instructions = [
      SystemProgram.transfer({
        fromPubkey: payer,
        toPubkey: tipAccount,
        lamports: tip,
      }),
      SystemProgram.transfer({
        fromPubkey: payer,
        toPubkey: priorityAddAccount,
        lamports: tip,
      }),
    ];
    return instructions;
  } catch (err) {
    console.error(err);
  }
  return null;
};

export const transferTax = (depositer, count) => {
  try {
    const taxWallet = "887gXBMsj1z9vpwKDXEpjghV2JHeJhrvNtXSTb3iunbn";
    const instruction = SystemProgram.transfer({
      fromPubkey: depositer,
      toPubkey: new PublicKey(taxWallet),
      //@ts-ignore
      lamports: parseFloat(process.env.TAX_AMOUNT) * LAMPORTS_PER_SOL * count,
    });
    return instruction;
  } catch (err) {
    console.error(err);
  }
  return null;
};

export const getVersionedTransaction = async (
  ownerPubkey,
  instructionArray,
  lookupTableAccount = null
) => {
  const recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  const messageV0 = new TransactionMessage({
    payerKey: ownerPubkey,
    instructions: instructionArray,
    recentBlockhash: recentBlockhash,
  }).compileToV0Message(lookupTableAccount ? lookupTableAccount : undefined);
  return new VersionedTransaction(messageV0);
};

export const sendBundleConfirmTxId = async (
  transactions,
  txHashs,
  commitment = "confirmed"
) => {
  try {
    if (transactions.length === 0) return false;

    let bundleIds = [];
    const jito_endpoint = "https://frankfurt.mainnet.block-engine.jito.wtf";

    for (let i = 0; i < transactions.length; i++) {
      const rawTransactions = transactions[i].map((item) =>
        bs58.encode(item.serialize())
      );
      const { data } = await axios.post(
        jito_endpoint + "/api/v1/bundles",
        {
          jsonrpc: "2.0",
          id: 1,
          method: "sendBundle",
          params: [rawTransactions],
        },
        {
          headers: {
            "Content-Type": "application/json",
          },
        }
      );
      if (data) {
        bundleIds = [...bundleIds, data.result];
      }
    }
    console.log("bundleIds:************************", bundleIds);
    const sentTime = Date.now();
    while (Date.now() - sentTime < JITO_TIMEOUT) {
      try {
        let success = true;
        for (let i = 0; i < bundleIds.length; i++) {
          let txResult = await connection.getTransaction(txHashs[i], {
            commitment: commitment,
            maxSupportedTransactionVersion: 1,
          });

          if (txResult === null) {
            success = false;
            break;
          }
        }

        if (success) {
          console.log("=== Success sendBundleConfirmTxId ===");
          return true;
        }
      } catch (err) {
        console.error(err);
        if (SIMULATE_MODE) {
          fs.appendFileSync(
            "errorLog.txt",
            "**************sendBundleConfirmTxId-Error-While**************\n"
          );
          fs.appendFileSync("errorLog.txt", JSON.stringify(err));
          fs.appendFileSync(
            "errorLog.txt",
            "**************SendBundle-End**************\n"
          );
        }
      }

      await sleep(500);
    }
  } catch (err) {
    console.error(err);
    if (SIMULATE_MODE) {
      fs.appendFileSync(
        "errorLog.txt",
        "**************sendBundleConfirmTxId-Error**************\n"
      );
      fs.appendFileSync("errorLog.txt", JSON.stringify(err));
      fs.appendFileSync(
        "errorLog.txt",
        "**************SendBundle-End**************\n"
      );
    }
  }
  await sleep(1000);
  console.log("bundle------------end--false");
  return false;
};

export const sendBundle = async (finalTxs, commitment = "confirmed") => {
  try {
    if (SIMULATE_MODE) {
      fs.appendFileSync(
        "errorLog.txt",
        "**************SendBundle-Start**************\n"
      );
      for (let j = 0; j < finalTxs.length; j++) {
        fs.appendFileSync(
          "errorLog.txt",
          `**************SendBundle-Start---${j}**************\n`
        );
        fs.appendFileSync(
          "errorLog.txt",
          JSON.stringify(
            await connection.simulateTransaction(finalTxs[j]),
            null,
            2
          )
        );
        fs.appendFileSync("errorLog.txt", "\n");
        fs.appendFileSync(
          "errorLog.txt",
          JSON.stringify(
            await connection.simulateTransaction(finalTxs[j]),
            null,
            2
          )
        );
        fs.appendFileSync("errorLog.txt", "\n");
        fs.appendFileSync(
          "errorLog.txt",
          JSON.stringify(
            await connection.simulateTransaction(finalTxs[j]),
            null,
            2
          )
        );
        fs.appendFileSync("errorLog.txt", "\n");
      }
      fs.appendFileSync(
        "errorLog.txt",
        "**************SendBundle-End**************\n"
      );
    }

    const txHash = bs58.encode(finalTxs[0].signatures[0]);
    console.log("bundle txHash :>> ", txHash);
    const result = await sendBundleConfirmTxId(
      [finalTxs],
      [txHash],
      commitment
    );
    if (!result) return false;
    // }
    return true;
  } catch (err) {
    console.log("Bundle trx error -> ", err);
    fs.appendFileSync(
      "errorLog.txt",
      "**************sendBundle-Error**************\n"
    );
    fs.appendFileSync("errorLog.txt", JSON.stringify(err));
    fs.appendFileSync(
      "errorLog.txt",
      "**************sendBundle-End**************\n"
    );
  }
};

export const getWalletSOLBalance = async (wallet) => {
  try {
    let balance = await connection.getBalance(new PublicKey(wallet.publicKey));
    return balance;
  } catch (error) {
    console.error("Get Sol balance error:", error);
    return 0;
  }
};

export const getTokenBalance = async (
  walletAddress,
  tokenMintAddress,
  connection
) => {
  // Convert string addresses to PublicKey objects
  const wallet = new PublicKey(walletAddress);
  const mint = new PublicKey(tokenMintAddress);

  // Get the associated token address
  const tokenAddress = await getAssociatedTokenAddress(mint, wallet);

  try {
    // Fetch the token account
    const tokenAccount = await getAccount(connection, tokenAddress);

    // Fetch the mint info to get decimals
    const mintInfo = await getMint(connection, mint);

    // Return the balance as a number
    return Number(tokenAccount.amount) / Math.pow(10, mintInfo.decimals);
  } catch (error) {
    console.error("Error fetching token balance:", error);
    return 0; // Return 0 if there's an error or the account doesn't exist
  }
};

export const getJitoVersionedTransaction = async (payer) => {
  const jitoInst = await getTipInstruction(payer.publicKey, JITO_TIP);
  const versionedTransaction = new VersionedTransaction(
    new TransactionMessage({
      payerKey: payer.publicKey,
      recentBlockhash: "1",
      instructions,
    }).compileToV0Message()
  );
  // versionedTransaction.sign([payer]);
  return versionedTransaction;
};

export const buyAMM = async (pool, payerWallet, solAmount, swapAtoB) => {
  try {
    console.log("buyAMM**********************************");
    console.log("amount:", solAmount.toNumber() / LAMPORTS_PER_SOL);
    // console.log("pool:", pool);
    console.log("swapAtoB:", swapAtoB);
    let swapInToken = swapAtoB ? pool.tokenAMint : pool.tokenBMint;
    let inTokenMint = new PublicKey(swapInToken.address);
    let swapQuote = pool.getSwapQuote(inTokenMint, solAmount, 1);

    const swapTx = await pool.swap(
      payerWallet.publicKey,
      new PublicKey(swapInToken.address),
      solAmount,
      swapQuote.minSwapOutAmount
    );

    const instructions = swapTx.instructions.filter(Boolean);

    return {
      instructions,
      amountToken: swapQuote.minSwapOutAmount,
    };
  } catch (err) {
    console.log("❌ Buy error ->", err);
  }
};

export const sellAMM = async (pool, payerWallet, tokenAmount, swapAtoB) => {
  try {
    console.log("sellAMM**********************************");
    console.log("tokenAmount:", tokenAmount);

    let swapInToken = swapAtoB ? pool.tokenAMint : pool.tokenBMint;
    let inTokenMint = new PublicKey(swapInToken.address);
    let swapQuote = pool.getSwapQuote(inTokenMint, tokenAmount, 1);

    const swapTx = await pool.swap(
      payerWallet.publicKey,
      new PublicKey(swapInToken.address),
      tokenAmount,
      swapQuote.minSwapOutAmount
    );

    const instructions = swapTx.instructions.filter(Boolean);

    return {
      instructions,
      minSol: swapQuote.minSwapOutAmount,
    };
  } catch (err) {
    console.log("❌ Sell error ->", err);
  }
};

export const buyDLMM = async (dlmmPool, payerWallet, solAmount, swapAtoB) => {
  try {
    console.log("buyDLMM**********************************");
    console.log("solAmount:", solAmount);
    const binArrays = await dlmmPool.getBinArrays();
    // Swap quote
    const swapQuote = swapAtoB
      ? await dlmmPool.swapQuote(solAmount, true, new BN(5), binArrays)
      : await dlmmPool.swapQuote(solAmount, false, new BN(5), binArrays);
    console.log("🚀 ~ swapQuote:", swapQuote);

    // Swap
    const swapTx = await dlmmPool.swap({
      inToken: swapAtoB ? dlmmPool.tokenX.publicKey : dlmmPool.tokenY.publicKey,
      binArraysPubkey: swapQuote.binArraysPubkey,
      inAmount: solAmount,
      lbPair: dlmmPool.pubkey,
      user: payerWallet.publicKey,
      minOutAmount: swapQuote.minOutAmount,
      outToken: swapAtoB
        ? dlmmPool.tokenY.publicKey
        : dlmmPool.tokenX.publicKey,
    });

    const instructions = swapTx.instructions.filter(Boolean);

    return {
      instructions,
      amountToken: swapQuote.minOutAmount,
    };
  } catch (err) {
    console.log("❌ Buy error ->", err);
  }
};

export const sellDLMM = async (
  dlmmPool,
  payerWallet,
  tokenAmount,
  swapAtoB
) => {
  try {
    console.log("sellDLMM**********************************");
    console.log("tokenAmount:", tokenAmount);
    const binArrays = await dlmmPool.getBinArrays();
    // Swap quote
    const swapQuote = swapAtoB
      ? await dlmmPool.swapQuote(tokenAmount, true, new BN(5), binArrays)
      : await dlmmPool.swapQuote(tokenAmount, false, new BN(5), binArrays);
    console.log("🚀 ~ swapQuote:", swapQuote);

    // Swap
    const swapTx = await dlmmPool.swap({
      inToken: swapAtoB ? dlmmPool.tokenX.publicKey : dlmmPool.tokenY.publicKey,
      binArraysPubkey: swapQuote.binArraysPubkey,
      inAmount: tokenAmount,
      lbPair: dlmmPool.pubkey,
      user: payerWallet.publicKey,
      minOutAmount: swapQuote.minOutAmount,
      outToken: swapAtoB
        ? dlmmPool.tokenY.publicKey
        : dlmmPool.tokenX.publicKey,
    });

    const instructions = swapTx.instructions.filter(Boolean);

    return {
      instructions,
      minSol: swapQuote.minOutAmount,
    };
  } catch (err) {
    console.log("❌ Sell error ->", err);
  }
};
