export type SourceReader = {
  readText(relativePath: string): Promise<string>
  list(relativePath: string): Promise<string[]>
}
