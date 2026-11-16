import { del, get, put } from "@vercel/blob";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

type BlobMetadata = Record<string, string>;

const isVercel = () => process.env.VERCEL === "1";
const vercelPath = (storeName: string, key: string) => `${storeName}/${key}`;
const localRoot = resolve(fileURLToPath(new URL("../local-demo-blobs/", import.meta.url)));
const localPath = (storeName: string, key: string) => {
  const file = resolve(localRoot, storeName, key);
  if (!file.startsWith(`${localRoot}${sep}`)) throw new Error("Invalid local blob key.");
  return file;
};

export const setStoredBlob = async (
  storeName: string,
  key: string,
  data: ArrayBuffer,
  metadata: BlobMetadata,
) => {
  if (isVercel()) {
    await put(vercelPath(storeName, key), data, {
      access: "private",
      contentType: metadata.contentType,
    });
    return;
  }

  const path = localPath(storeName, key);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, new Uint8Array(data));
};

export const getStoredBlob = async (storeName: string, key: string) => {
  if (isVercel()) {
    const blob = await get(vercelPath(storeName, key), { access: "private" });
    if (!blob || blob.statusCode !== 200) return null;
    return new Response(blob.stream).arrayBuffer();
  }

  try {
    const data = await readFile(localPath(storeName, key));
    return Uint8Array.from(data).buffer;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
};

export const deleteStoredBlob = async (storeName: string, key: string) => {
  if (isVercel()) {
    await del(vercelPath(storeName, key));
    return;
  }

  await rm(localPath(storeName, key), { force: true });
};
