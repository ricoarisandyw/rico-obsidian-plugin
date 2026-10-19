import { App, TFile } from "obsidian";
import { BlockInfo, BlockRef, blockKey, parseBlockLink, snippetFor } from "./references";

/**
 * Reads block ids and block links from Obsidian's metadata cache.
 * Block text is read from the file once and kept until that file changes.
 */
export class BlockIndex {
  private memo = new Map<string, BlockInfo[]>();

  constructor(private app: App) {}

  /** Forget what was read for one file (it changed, moved or was deleted). */
  invalidate(path: string): void {
    this.memo.delete(path);
  }

  clear(): void {
    this.memo.clear();
  }

  private files(): TFile[] {
    return this.app.vault.getMarkdownFiles();
  }

  /** Key of every block id in the vault. Cheap: it does not read any file. */
  existing(): Set<string> {
    const keys = new Set<string>();
    for (const file of this.files()) {
      const blocks = this.app.metadataCache.getFileCache(file)?.blocks;
      for (const block of Object.values(blocks ?? {})) keys.add(blockKey(file.path, block.id));
    }
    return keys;
  }

  /** Every `[[Note#^id]]` link and `![[Note#^id]]` embed in the vault. */
  refs(): BlockRef[] {
    const { metadataCache } = this.app;
    const refs: BlockRef[] = [];
    for (const file of this.files()) {
      const cache = metadataCache.getFileCache(file);
      for (const item of [...(cache?.links ?? []), ...(cache?.embeds ?? [])]) {
        const parsed = parseBlockLink(item.link);
        if (!parsed) continue;
        const target = parsed.path ? metadataCache.getFirstLinkpathDest(parsed.path, file.path) : file;
        if (target) refs.push({ source: file.path, target: target.path, id: parsed.id });
      }
    }
    return refs;
  }

  async blocksOf(file: TFile): Promise<BlockInfo[]> {
    const cached = this.memo.get(file.path);
    if (cached) return cached;

    const cache = this.app.metadataCache.getFileCache(file);
    // Not indexed yet (Obsidian is still starting): don't remember an empty answer.
    if (!cache) return [];
    const entries = Object.values(cache.blocks ?? {});
    if (entries.length === 0) {
      this.memo.set(file.path, []);
      return [];
    }

    const content = await this.app.vault.cachedRead(file);
    const blocks = entries.map((block) => ({
      path: file.path,
      id: block.id,
      line: block.position.start.line,
      snippet: snippetFor(content, block.position.start.offset, block.position.end.offset, block.id),
    }));
    this.memo.set(file.path, blocks);
    return blocks;
  }

  async allBlocks(): Promise<BlockInfo[]> {
    const lists = await Promise.all(this.files().map((file) => this.blocksOf(file)));
    return lists.flat();
  }
}
