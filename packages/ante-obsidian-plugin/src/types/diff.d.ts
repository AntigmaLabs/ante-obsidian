declare module "diff" {
  export type StructuredPatchHunk = {
    oldStart: number;
    oldLines: number;
    newStart: number;
    newLines: number;
    lines: string[];
  };

  export type StructuredPatch = {
    hunks: StructuredPatchHunk[];
  };

  export function structuredPatch(
    oldFileName: string,
    newFileName: string,
    oldStr: string,
    newStr: string,
    oldHeader?: string,
    newHeader?: string,
    options?: { context?: number }
  ): StructuredPatch;
}
