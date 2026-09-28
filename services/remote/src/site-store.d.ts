export type SiteRecord = {
    remoteSiteId: string;
    publishedCommitId: string | null;
    deploymentId: string | null;
    publicUrl: string;
    createdAt: string;
    updatedAt: string;
};
export declare function buildPublicUrl(publicBaseUrl: string, remoteSiteId: string): string;
export declare function createSiteRecord(dataRoot: string, publicBaseUrl: string): Promise<SiteRecord>;
export declare function loadSiteRecord(dataRoot: string, remoteSiteId: string): Promise<SiteRecord | null>;
export declare function saveSiteRecord(dataRoot: string, record: SiteRecord): Promise<void>;
export declare function releasePublicDir(dataRoot: string, remoteSiteId: string, deploymentId: string): string;
export declare function bareRepoDir(dataRoot: string, remoteSiteId: string): string;
export declare function publishedBundlePath(dataRoot: string, remoteSiteId: string, publishedCommitId: string): string;
export declare function savePublishedBundleBytes(dataRoot: string, remoteSiteId: string, publishedCommitId: string, bundleBytes: Buffer): Promise<void>;
//# sourceMappingURL=site-store.d.ts.map