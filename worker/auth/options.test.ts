import { describe, expect, it } from "vitest";
import { passkeyRpId } from "./options";

describe("which addresses a passkey works on", () => {
  it("is the account's workers.dev subdomain on every preview link", () => {
    expect(passkeyRpId("pr-15-fennl-preview.terrastak.workers.dev")).toBe("terrastak.workers.dev");
    expect(passkeyRpId("pr-16-fennl-preview.terrastak.workers.dev")).toBe("terrastak.workers.dev");
    expect(passkeyRpId("fennl-preview.terrastak.workers.dev")).toBe("terrastak.workers.dev");
  });

  it("is the exact address everywhere else", () => {
    expect(passkeyRpId("admin.fennl.app")).toBe("admin.fennl.app");
    expect(passkeyRpId("localhost")).toBe("localhost");
    // Never workers.dev itself, which is a public suffix.
    expect(passkeyRpId("terrastak.workers.dev")).toBe("terrastak.workers.dev");
  });
});
