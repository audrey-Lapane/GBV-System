// Reporter read access without an account: the browser signs a short-lived read request with
// the key derived from the secret, and the contract's stored reporter address must match.
import { ethers } from "ethers";
import { registry, deployed } from "../modules/blockchain/index.js";
import { config } from "../config.js";
import { HttpError, isBytes32, isSignature, isUint } from "./http.js";

const READ_TAG = ethers.keccak256(ethers.toUtf8Bytes("GBV.READ"));

export function readDigest(reportId, ts) {
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "uint256", "bytes32", "bytes32", "uint256"],
      [deployed.ReportRegistry, deployed.chainId, READ_TAG, reportId, ts]
    )
  );
}

/** Throws 401 unless `proof` = { ts, signature } was signed by this report's reporter key recently. */
export async function verifyReporter(reportId, proof) {
  if (!isBytes32(reportId) || !proof || !isUint(proof.ts) || !isSignature(proof.signature)) {
    throw new HttpError(401, "The report ID or secret is not correct.");
  }
  const age = Math.abs(Date.now() / 1000 - Number(proof.ts));
  if (age > config.reporterProofMaxAge) throw new HttpError(401, "This page has been open too long. Please enter your details again.");
  const signer = ethers.verifyMessage(ethers.getBytes(readDigest(reportId, proof.ts)), proof.signature);
  const reporter = await registry.reporterOf(reportId);
  if (reporter === ethers.ZeroAddress || signer.toLowerCase() !== reporter.toLowerCase()) {
    throw new HttpError(401, "The report ID or secret is not correct.");
  }
}
