import type { RemoteServiceConfig } from './types.js';
export declare function makeIsolatedDataRoot(label: string): Promise<string>;
export declare function startRemoteServer(config: RemoteServiceConfig): Promise<{
    baseUrl: string;
    close: () => void;
}>;
//# sourceMappingURL=test-harness.d.ts.map