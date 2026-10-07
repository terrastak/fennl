import { describe, expect, it } from "vitest";
import { feedbackStatus, replyLink, type FeedbackItem } from "./feedback";

const item: FeedbackItem = {
  id: "f1",
  message: "Cook mode is great.\nCould it keep the screen on? 100% + more",
  page: "/settings",
  appVersion: "abc1234",
  device: "Safari on iPhone",
  createdAt: "2026-10-07T12:00:00.000Z",
  readAt: null,
  repliedAt: null,
  doneAt: null,
  note: null,
  sender: { id: "u1", name: "Rosa Lee", email: "rosa@example.com" },
};

describe("feedbackStatus", () => {
  it("follows the dates", () => {
    expect(feedbackStatus(item)).toBe("new");
    expect(feedbackStatus({ ...item, readAt: "x" })).toBe("read");
    expect(feedbackStatus({ ...item, readAt: "x", repliedAt: "y" })).toBe("replied");
    expect(feedbackStatus({ ...item, repliedAt: "y", doneAt: "z" })).toBe("done");
  });
});

describe("replyLink", () => {
  it("opens an email to the sender with their message quoted", () => {
    const link = replyLink(item, "Oct 7, 2026")!;
    expect(link.startsWith("mailto:rosa@example.com?")).toBe(true);
    expect(link).not.toContain("+");
    const params = new URLSearchParams(link.slice(link.indexOf("?") + 1));
    expect(params.get("subject")).toBe("Re: your Fennl feedback");
    expect(params.get("body")).toBe(
      "Hi Rosa,\n\n\n\nOn Oct 7, 2026 (on /settings) you wrote:\n> Cook mode is great.\n> Could it keep the screen on? 100% + more\n",
    );
  });

  it("shortens long messages, and needs a sender", () => {
    const long = replyLink({ ...item, message: "a".repeat(3000) }, "today")!;
    expect(decodeURIComponent(long)).toContain(`${"a".repeat(1500)}…`);
    expect(replyLink({ ...item, sender: null }, "today")).toBeNull();
  });
});
