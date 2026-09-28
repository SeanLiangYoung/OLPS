export type DeployResult = {
    ok: true;
    deploymentId: string;
    log: string;
} | {
    ok: false;
    exitCode: number;
    log: string;
};
export declare function deployCommitFromWorkTree(input: {
    dataRoot: string;
    remoteSiteId: string;
    workDir: string;
    deploymentId: string;
}): Promise<DeployResult>;
//# sourceMappingURL=deploy.d.ts.map