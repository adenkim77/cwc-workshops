import Anthropic from "@anthropic-ai/sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getClient } from "../src/lib/anthropic";
import { listMemories, showMemory } from "../src/lib/memory";

vi.mock("../src/lib/anthropic", () => ({ getClient: vi.fn() }));
vi.mock("../src/lib/config", () => ({
  loadConfig: () => ({ memory_store_id: "store-test" }),
}));

const fetchMock = vi.fn();
const memory = (path: string) => ({
  type: "memory", path, content: "saved note",
  content_size_bytes: 10, content_sha256: "1234567890abcdef",
});
function page(data: unknown[], next_page: string | null = null) {
  return new Response(JSON.stringify({ data, next_page }), {
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.mocked(getClient).mockReturnValue(new Anthropic({
    apiKey: "test-key", fetch: fetchMock, maxRetries: 0,
  }));
});

describe("memory pagination", () => {
  it("finds a note beyond the first 50 results using the SDK cursor", async () => {
    fetchMock.mockResolvedValueOnce(page(
      Array.from({ length: 50 }, (_, i) => memory(`/companies/TEST/${i}.md`)), "second",
    )).mockResolvedValueOnce(page([memory("/companies/TEST/target.md")]));
    expect(await showMemory("/companies/TEST/target.md")).toEqual({
      path: "/companies/TEST/target.md", content: "saved note",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const url = new URL(String(fetchMock.mock.calls[1][0]));
    expect(url.searchParams.get("page")).toBe("second");
    expect(url.searchParams.get("path_prefix")).toBe("/companies/TEST/");
    expect(url.searchParams.get("view")).toBe("full");
  });

  it("stops fetching once the exact note is found", async () => {
    fetchMock.mockResolvedValueOnce(page([memory("/target.md")], "unused"));
    expect(await showMemory("/target.md")).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns null only after all pages have been searched", async () => {
    fetchMock.mockResolvedValueOnce(page([memory("/other.md")], "second"))
      .mockResolvedValueOnce(page([memory("/another.md")]));
    expect(await showMemory("/missing.md")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("includes later pages in the memory list", async () => {
    fetchMock.mockResolvedValueOnce(page(
      Array.from({ length: 100 }, (_, i) => memory(`/notes/${i}.md`)), "second",
    )).mockResolvedValueOnce(page([memory("/notes/last.md"), { type: "memory_prefix", path: "/notes/folder/" }]));
    const entries = await listMemories("/notes/");
    expect(entries).toHaveLength(102);
    expect(entries[101]).toMatchObject({ type: "memory_prefix", path: "/notes/folder/" });
    expect(entries[100]).toMatchObject({ path: "/notes/last.md", sha: "1234567890" });
  });

  it("propagates a later-page failure instead of reporting a missing note", async () => {
    fetchMock.mockResolvedValueOnce(page([memory("/other.md")], "second"))
      .mockResolvedValueOnce(new Response('{"error":{"message":"failed"}}', { status: 500 }));
    await expect(showMemory("/missing.md")).rejects.toThrow();
  });
});
