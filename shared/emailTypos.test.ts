import { describe, expect, it } from "vitest";
import { suggestEmail, typoDistance } from "./emailTypos";

describe("typoDistance", () => {
  it("counts a swap of two neighbouring letters as one edit", () => {
    expect(typoDistance("gmial", "gmail")).toBe(1);
    expect(typoDistance("gmail", "gmail")).toBe(0);
    expect(typoDistance("gmal", "gmail")).toBe(1);
    expect(typoDistance("gmaill", "gmail")).toBe(1);
    expect(typoDistance("", "abc")).toBe(3);
    expect(typoDistance("kitten", "sitting")).toBe(3);
  });
});

describe("suggestEmail", () => {
  it("puts right a provider's domain typed a letter wrong", () => {
    expect(suggestEmail("sarah.lee@gmial.com")).toBe("sarah.lee@gmail.com");
    expect(suggestEmail("sarah.lee@gmal.com")).toBe("sarah.lee@gmail.com");
    expect(suggestEmail("sarah.lee@gnail.com")).toBe("sarah.lee@gmail.com");
    expect(suggestEmail("bob@yaho.com")).toBe("bob@yahoo.com");
    expect(suggestEmail("bob@hotmial.com")).toBe("bob@hotmail.com");
    expect(suggestEmail("bob@outlok.com")).toBe("bob@outlook.com");
    expect(suggestEmail("bob@icloud.co")).toBe("bob@icloud.com");
    expect(suggestEmail("bob@iclod.com")).toBe("bob@icloud.com");
    expect(suggestEmail("bob@comcast.com")).toBeNull();
    expect(suggestEmail("bob@comcats.net")).toBe("bob@comcast.net");
    expect(suggestEmail("bob@yaho.co.uk")).toBe("bob@yahoo.co.uk");
  });

  it("allows two slips in long names, one in shorter ones, besides a slip in the ending", () => {
    expect(suggestEmail("bob@gmaiil.co")).toBe("bob@gmail.com");
    expect(suggestEmail("bob@hotmal.cm")).toBe("bob@hotmail.com");
    expect(suggestEmail("bob@protnmial.com")).toBe("bob@protonmail.com");
    expect(suggestEmail("bob@gmaiil.com")).toBe("bob@gmail.com");
    expect(suggestEmail("bob@gmaaiil.com")).toBeNull();
    expect(suggestEmail("bob@xy.com")).toBeNull();
  });

  it("matches the shortest providers' names only exactly, and a four-letter one only swapped", () => {
    expect(suggestEmail("bob@me.co")).toBe("bob@me.com");
    expect(suggestEmail("bob@aol.con")).toBe("bob@aol.com");
    expect(suggestEmail("bob@lvie.com")).toBe("bob@live.com");
    expect(suggestEmail("bob@ao.com")).toBeNull();
    expect(suggestEmail("bob@lve.com")).toBeNull();
  });

  it("puts right a mistyped ending", () => {
    expect(suggestEmail("bob@gmail.con")).toBe("bob@gmail.com");
    expect(suggestEmail("bob@gmail.cmo")).toBe("bob@gmail.com");
    expect(suggestEmail("bob@gmail.ocm")).toBe("bob@gmail.com");
    expect(suggestEmail("bob@gmail.om")).toBe("bob@gmail.com");
    expect(suggestEmail("bob@gmail.comm")).toBe("bob@gmail.com");
    expect(suggestEmail("bob@gmail.co")).toBe("bob@gmail.com");
    expect(suggestEmail("bob@yahoo.co")).toBe("bob@yahoo.com");
    expect(suggestEmail("bob@me.co")).toBe("bob@me.com");
    expect(suggestEmail("bob@att.nett")).toBe("bob@att.net");
    expect(suggestEmail("bob@example.con")).toBe("bob@example.com");
    expect(suggestEmail("bob@gmial.con")).toBe("bob@gmail.com");
  });

  it("leaves “.co”, “.cm” and “.om” alone for anything but a provider", () => {
    expect(suggestEmail("bob@example.co")).toBeNull();
    expect(suggestEmail("bob@bakery.co")).toBeNull();
  });

  it("says nothing about an address that looks right", () => {
    expect(suggestEmail("sarah.lee@gmail.com")).toBeNull();
    expect(suggestEmail("Sarah.Lee@GMAIL.COM")).toBeNull();
    expect(suggestEmail("bob@hotmail.co.uk")).toBeNull();
    expect(suggestEmail("bob@proton.me")).toBeNull();
    expect(suggestEmail("bob@example.com")).toBeNull();
    expect(suggestEmail("bob@fennl.app")).toBeNull();
  });

  it("never corrects real domains close to a provider's", () => {
    expect(suggestEmail("bob@ymail.com")).toBeNull();
    expect(suggestEmail("bob@mail.com")).toBeNull();
    expect(suggestEmail("bob@email.com")).toBeNull();
    expect(suggestEmail("bob@att.com")).toBeNull();
    expect(suggestEmail("bob@verizon.com")).toBeNull();
    expect(suggestEmail("bob@live.co.uk")).toBeNull();
    for (const domain of [
      "ms.com",
      "ge.com",
      "aon.com",
      "cloud.com",
      "max.com",
      "amc.com",
      "alo.com",
      "life.com",
      "love.com",
      "lie.com",
      "mymail.com",
    ]) {
      expect(suggestEmail(`bob@${domain}`), domain).toBeNull();
    }
  });

  it("leaves a country's own ending alone", () => {
    expect(suggestEmail("bob@yahoo.fr")).toBeNull();
    expect(suggestEmail("bob@yahoo.ca")).toBeNull();
    expect(suggestEmail("bob@yahoo.co.jp")).toBeNull();
    expect(suggestEmail("bob@protonmail.ch")).toBeNull();
    expect(suggestEmail("bob@live.ca")).toBeNull();
    expect(suggestEmail("bob@squ.edu.om")).toBeNull();
    expect(suggestEmail("bob@omantel.net.om")).toBeNull();
    expect(suggestEmail("bob@company.cm")).toBeNull();
  });

  it("keeps the part before the @ exactly as typed", () => {
    expect(suggestEmail("  Sarah.Lee+fennl@GMIAL.com ")).toBe("Sarah.Lee+fennl@gmail.com");
  });

  it("says nothing about something that isn't an address", () => {
    expect(suggestEmail("")).toBeNull();
    expect(suggestEmail("gmial.com")).toBeNull();
    expect(suggestEmail("@gmial.com")).toBeNull();
    expect(suggestEmail("bob@")).toBeNull();
    expect(suggestEmail("bob@gmial")).toBeNull();
    expect(suggestEmail("bob@gm ial.com")).toBeNull();
  });
});
