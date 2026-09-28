export declare function ensureBareRepo(repoDir: string): Promise<void>;
export declare function fetchBundleToCandidateRef(repoDir: string, bundlePath: string, commitId: string): Promise<string>;
export declare function promoteCommitToMain(repoDir: string, commitId: string): Promise<void>;
export declare function createBundleFromBareRepo(repoDir: string, bundlePath: string, publishedCommitId: string | null): Promise<void>;
export declare function extractCommitToDir(repoDir: string, commitId: string, workDir: string): Promise<void>;
//# sourceMappingURL=git-store.d.ts.map