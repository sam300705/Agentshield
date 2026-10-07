import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { getRuntimeConfig } from "../config.js";
import { receiptSignerFromEnvironment } from "./receiptSigner.js";
const env = {
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://app:synthetic@db.example.com/db?sslmode=require",
  CORS_ORIGIN: "https://web.example.com",
  AUTH_MODE: "oidc",
  OIDC_ISSUER: "https://oidc.example.com",
  OIDC_JWKS_URL: "https://oidc.example.com/keys",
  OIDC_AUDIENCE: "api",
  REDIS_REST_URL: "https://redis.example.com",
  REDIS_REST_TOKEN: "synthetic",
  RECEIPT_SIGNING_REQUIRED: "false",
};
describe("production fail-closed configuration", () => {
  it("requires shared protection and forbids disabling the limiter", () => {
    expect(() => getRuntimeConfig({ ...env, REDIS_REST_TOKEN: undefined })).toThrow("REDIS_REST");
    expect(() => getRuntimeConfig({ ...env, RATE_LIMIT_ENABLED: "false" })).toThrow(
      "cannot be false",
    );
  });
  it("rejects insecure identity/limiter endpoints and broad proxy trust", () => {
    expect(() =>
      getRuntimeConfig({ ...env, OIDC_JWKS_URL: "http://oidc.example.com/keys" }),
    ).toThrow("HTTPS");
    expect(() => getRuntimeConfig({ ...env, TRUST_PROXY_HOPS: "3" })).toThrow("TRUST_PROXY_HOPS");
  });
  it("requires signing by default and never invents a key", () => {
    expect(() => getRuntimeConfig({ ...env, RECEIPT_SIGNING_REQUIRED: undefined })).toThrow(
      "Receipt signing keys",
    );
    expect(() => receiptSignerFromEnvironment({ NODE_ENV: "production" })).toThrow(
      "RECEIPT_SIGNER_UNAVAILABLE",
    );
  });
  it("validates Ed25519 platform keys without echoing invalid key material", () => {
    const key = generateKeyPairSync("ed25519")
      .privateKey.export({ format: "pem", type: "pkcs8" })
      .toString();
    expect(
      getRuntimeConfig({
        ...env,
        RECEIPT_SIGNING_REQUIRED: "true",
        RECEIPT_SIGNING_KEY_ID: "v1",
        RECEIPT_SIGNING_PRIVATE_KEY: key,
      }).RECEIPT_SIGNING_KEY_ID,
    ).toBe("v1");
    expect(() =>
      getRuntimeConfig({
        ...env,
        RECEIPT_SIGNING_KEY_ID: "v1",
        RECEIPT_SIGNING_PRIVATE_KEY: "synthetic-invalid-material",
      }),
    ).toThrow("RECEIPT_SIGNING_PRIVATE_KEY is invalid");
  });
});
