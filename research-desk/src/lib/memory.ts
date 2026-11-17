// Copyright 2026 Anthropic PBC
// SPDX-License-Identifier: Apache-2.0

/** Read-side helpers for the desk memory store, used by the Memory tab. */

import { getClient } from "./anthropic";
import { loadConfig } from "./config";

export interface MemoryEntry {
  type: string;
  path: string;
  size?: number;
  sha?: string;
}

export interface MemoryVersionEntry {
  id: string;
  operation: string;
  path: string;
  created_at: string;
}

function requireStoreId(): string {
  const storeId = loadConfig().memory_store_id;
  if (!storeId) throw new Error("the desk is not provisioned yet — open the Setup tab first");
  return storeId;
}

export async function listMemories(prefix = "/"): Promise<MemoryEntry[]> {
  const client = getClient();
  const storeId = requireStoreId();
  const entries: MemoryEntry[] = [];
  const page = await client.beta.memoryStores.memories.list(storeId, { path_prefix: prefix, limit: 100 } as never);
  for await (const memory of page) {

    entries.push({
      type: String(memory.type ?? "memory"),
      path: String(memory.path ?? ""),
      size: memory.type === "memory" && typeof memory.content_size_bytes === "number" ? memory.content_size_bytes : undefined,
      sha: memory.type === "memory" && typeof memory.content_sha256 === "string" ? memory.content_sha256.slice(0, 10) : undefined,
    });
  }
  return entries;
}

export async function showMemory(path: string): Promise<{ path: string; content: string } | null> {
  const client = getClient();
  const storeId = requireStoreId();
  // path_prefix must be segment-aligned and end with "/", so list the memory's
  // containing folder (everything up to and including the last slash) and pick
  // the exact file out of the results below.
  const dirPrefix = path.slice(0, path.lastIndexOf("/") + 1) || "/";
  const page = await client.beta.memoryStores.memories.list(storeId, {
    path_prefix: dirPrefix,
    view: "full",
    limit: 50,
  } as never);
  for await (const memory of page) {
    if (memory.type === "memory" && memory.path === path) {
      return { path, content: String(memory.content ?? "") };
    }
  }
  return null;
}

export async function listVersions(limit = 50): Promise<MemoryVersionEntry[]> {
  const client = getClient();
  const storeId = requireStoreId();
  const page = await client.beta.memoryStores.memoryVersions.list(storeId, { limit } as never);
  return (((page as unknown as { data?: Array<Record<string, unknown>> }).data ?? []) as Array<Record<string, unknown>>).map(
    (version) => ({
      id: String(version.id ?? ""),
      operation: String(version.operation ?? ""),
      path: String(version.path ?? ""),
      created_at: String(version.created_at ?? ""),
    }),
  );
}
