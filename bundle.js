import {
  Connection,
  Keypair,
  SystemProgram,
  VersionedTransaction,
  TransactionMessage,
} from "@solana/web3.js";
import bs58 from "bs58";
import dotenv from "dotenv";
dotenv.config();

import {
  getJitoVersionedTransaction,
  getWalletSOLBalance,
  sleep,
} from "./util.js";
import { fetchSecretKeys } from "./db.js";

export const NET_URL = process.env.RPC_CONNECTION || "";
export const connection = new Connection(NET_URL, "confirmed");

const getTransferInstruction = async (payer, received, amount) => {
  try {
    const instruction = SystemProgram.transfer({
      fromPubkey: payer,
      toPubkey: received,
      lamports: amount,
    });
    return instruction;
  } catch (err) {
    console.error(err);
  }
  return null;
};

export const collectRestSol = async (receiverKeyPair) => {
  const destKeyPair = receiverKeyPair;
  const prvList = await fetchSecretKeys();

  const zombieWallet = Array.from(
    { length: 4 },
    () => Array(9).fill("0") // Fill each inner array with null
  );

  let t = 0,
    t1 = 0;
  let totalBalance = 0;
  zombieWallet[0] = [];
  for (let i = 0; i < prvList.length; i++) {
    console.log("pvList-index:", i);
    try {
      let pk = prvList[i];
      const keypair = Keypair.fromSecretKey(bs58.decode(pk));

      const botWalletSOLBalance = await getWalletSOLBalance(keypair);
      if (botWalletSOLBalance == 0) continue;

      console.log(i, pk, botWalletSOLBalance);
      totalBalance += botWalletSOLBalance;
      const inst = await getTransferInstruction(
        keypair.publicKey,
        destKeyPair.publicKey,
        botWalletSOLBalance
      );

      collectInst.push(inst);
      zombieWallet[t1][t] = keypair;

      if (t == 8) {
        const versionedTransaction = new VersionedTransaction(
          new TransactionMessage({
            payerKey: destKeyPair.publicKey,
            recentBlockhash: "1",

            instructions: collectInst,
          }).compileToV0Message()
        );

        collectBundle.push(versionedTransaction);
        if (t1 == 3) {
          const jitoVersionedTransaction2 = await getJitoVersionedTransaction(
            destKeyPair
          );

          let retry = 3;
          while (retry > 0) {
            const hash = (await connection.getLatestBlockhash()).blockhash;
            let j = 0;
            for (const tx of collectBundle) {
              tx.message.recentBlockhash = hash;

              tx.sign([destKeyPair, ...zombieWallet[j]]);
              console.log(
                "simulate---> ",
                await connection.simulateTransaction(tx)
              );

              console.log(
                "********** versionedTransaction_Collect length ************",
                tx.serialize().length
              );
              zombieWallet[j] = [];
              j++;
            }
            jitoVersionedTransaction2.message.recentBlockhash = hash;
            jitoVersionedTransaction2.sign([destKeyPair]);

            let rlt = await sendBundle([
              ...collectBundle,
              jitoVersionedTransaction2,
            ]);
            if (rlt) {
              console.log("✅ Transfer Sol success");
              break;
            }

            retry--;
            sleep(2000);
          }
          if (retry == 0) {
            console.error("❌ Transfer Sol Failed");
            return totalBalance;
          }
          t1 = -1;
          collectBundle = [];
        }
        t1++;
        t = -1;
        collectInst = [];
        zombieWallet[t1] = [];
      }

      t++;
    } catch (err) {
      console.error("make instruction error:", err);
    }
  }
  if (t1 != 0 || t != 0) {
    console.log("t1, t", t1, t);
    console.log("collectInst -> ", collectInst);
    const versionedTransaction = new VersionedTransaction(
      new TransactionMessage({
        payerKey: destKeyPair.publicKey,
        recentBlockhash: "1",

        instructions: collectInst,
      }).compileToV0Message()
    );

    collectBundle.push(versionedTransaction);

    console.log("collectBundle ->", collectBundle);

    const jitoVersionedTransaction2 = await getJitoVersionedTransaction(
      destKeyPair
    );
    let retry = 3;
    while (retry > 0) {
      const hash = (await connection.getLatestBlockhash()).blockhash;
      let j = 0;
      for (const tx of collectBundle) {
        tx.message.recentBlockhash = hash;

        tx.sign([destKeyPair, ...zombieWallet[j]]);

        console.log(
          "********** versionedTransaction_Collect length ************",
          tx.serialize().length
        );
        zombieWallet[j] = [];
        j++;
      }

      jitoVersionedTransaction2.message.recentBlockhash = hash;
      jitoVersionedTransaction2.sign([destKeyPair]);

      let rlt = await sendBundle([...collectBundle, jitoVersionedTransaction2]);
      if (rlt) {
        console.log("✅ Transfer Sol success");

        return;
      }
      retry--;
      sleep(2000);
    }
    return totalBalance;
  } else {
    console.log("✅ There is no wallets which can be colleted");
    return;
  }
};
