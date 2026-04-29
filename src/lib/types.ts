export type SetupIssueCode =
  | "GBRAIN_PATH_UNSET"
  | "VAULT_UNREACHABLE"
  | "WRAPPER_TIMEOUT";

export interface SetupIssue {
  code: SetupIssueCode;
  paragraph: string;
  configLines: string[];
}

export interface VaultEntry {
  slug: string;
  slugKey: string;
  title: string;
  deck: string;
  excerpt: string;
  category: string;
  updatedAt: Date;
  relativePath: string;
  absolutePath: string;
  realPath: string;
  markdown: string;
  bodyMarkdown: string;
  plainText: string;
  isStub: boolean;
}

export interface VaultIndex {
  entries: VaultEntry[];
  slugMap: Map<string, VaultEntry>;
  slugKeyMap: Map<string, VaultEntry>;
  assetRoot: string;
  assetRootReal: string;
}

export interface SearchResult {
  slug: string;
  title: string;
  excerpt: string;
  categories: string[];
  updatedAt?: string | null;
}

export interface BacklinkItem {
  slug: string;
  title: string;
  parentFolder: string;
}

export interface PreviewPayload {
  slug: string;
  title: string;
  dek: string;
  updatedAt: string;
  updatedLabel: string;
  broken: boolean;
}

export type NudgeMode = "broken-wikilink" | "typo" | "stub";

export interface NudgeCardModel {
  mode: NudgeMode;
  kicker: string;
  headline: string;
  deck: string;
  prompt: string | null;
  ctaLabel: string;
  disabledLabel: string;
}
