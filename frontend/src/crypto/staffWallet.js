// Staff and administrator sign with MetaMask, using the wallet bound to their account,
// so every access event on-chain is attributable to them and cannot be produced by the server.
import { connectMetaMask, signWithMetaMask } from "./signing.js";

export async function signAsBoundWallet(boundWallet, digest) {
  if (!boundWallet) throw new Error("Your account has no wallet bound yet. Contact the administrator.");
  const account = await connectMetaMask();
  if (account.toLowerCase() !== boundWallet.toLowerCase()) {
    throw new Error(`MetaMask is using ${short(account)}. Switch to the account bound to you: ${short(boundWallet)}.`);
  }
  return signWithMetaMask(account, digest);
}

export const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");
