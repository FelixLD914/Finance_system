import type { BranchType } from "./types";

export function branchLabel(
  branchType: BranchType,
  branchNumber: string | null,
): string | null {
  if (branchType === "head_office") return "สำนักงานใหญ่";
  if (branchType === "branch" && branchNumber) return `สาขา ${branchNumber}`;
  return null;
}

export function displayPayeeName(
  name: string,
  branchType: BranchType,
  branchNumber: string | null,
): string {
  const label = branchLabel(branchType, branchNumber);
  if (!label) return name;
  const cleanName = name.trimEnd();
  if (cleanName.endsWith(`（${label}）`) || cleanName.endsWith(`(${label})`)) return name;
  return `${name}(${label})`;
}
