/**
 * 识别建单的文件配对。
 *
 * 后端 /v1/tax-invoice/import/dual 一次只收一对文件（一份 Export Invoice
 * Excel + 一份报关单 PDF），批量是在前端把一堆文件配好组、再逐组发出去。
 * 配对规则本身没有 UI，是纯函数，所以单独放一个模块，能直接测。
 */

export type DualSlot = "invoice" | "customs";

/**
 * 待导入的一组。两边任意一边缺失也保留，界面要能显示是哪一组没配上——
 * 静默丢掉一份文件正是这次要修的毛病。
 */
export interface DualPair {
  /** 配对键：去扩展名、去首尾空白、小写化的文件名。 */
  key: string;
  /** 展示用的组名，保留原始大小写。 */
  label: string;
  invoiceFile: File | null;
  customsFile: File | null;
}

/** 两边都齐了的组，才是能真正发给后端的一次请求。 */
export type ReadyDualPair = DualPair & { invoiceFile: File; customsFile: File };

export function isReadyPair(pair: DualPair): pair is ReadyDualPair {
  return pair.invoiceFile !== null && pair.customsFile !== null;
}

/** 一次拖入的文件按扩展名分派槽位，认不出的返回 null 由调用方提示。 */
export function classifyDualFile(file: File): DualSlot | null {
  const name = file.name.toLocaleLowerCase();
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) return "invoice";
  if (name.endsWith(".pdf")) return "customs";
  return null;
}

/** 去掉扩展名。同一张税票的 Excel 和 PDF 文件名只差扩展名，这就是配对键。 */
export function baseNameOf(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "");
}

/**
 * 文件名带序号前缀（1. / 2. / … / 19.），按码位排会得到 1、10、11、…、2。
 * numeric 比较器让界面顺序和文件本身的编号顺序一致。
 */
const naturalOrder = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

export interface MergeResult {
  pairs: DualPair[];
  /** 扩展名不认识、整份忽略的文件名。 */
  unsupported: string[];
  /** 同一组里同类型撞车、被忽略的文件名。 */
  duplicated: string[];
}

/**
 * 把新选中的一批文件并进已有队列，按同名归组。
 *
 * 「并进」而不是「替换」：财务同事常常先选一堆 Excel、再补一堆 PDF，
 * 第二次选择不该把第一次的清空。
 */
export function mergeDualFiles(current: DualPair[], files: File[]): MergeResult {
  const unsupported: string[] = [];
  const duplicated: string[] = [];
  const byKey = new Map<string, DualPair>(
    current.map((pair) => [pair.key, { ...pair }]),
  );

  for (const file of files) {
    const slot = classifyDualFile(file);
    if (!slot) {
      unsupported.push(file.name);
      continue;
    }
    const label = baseNameOf(file.name);
    const key = label.trim().toLocaleLowerCase();
    const pair = byKey.get(key) ?? {
      key,
      label,
      invoiceFile: null,
      customsFile: null,
    };
    // 只有同一组、同一类型撞车才算重复（比如同时选了 a.xls 和 a.xlsx）。
    // 不同组的两份 Excel 各自成组，不再互相顶掉。
    if (slot === "invoice") {
      if (pair.invoiceFile) duplicated.push(file.name);
      else pair.invoiceFile = file;
    } else {
      if (pair.customsFile) duplicated.push(file.name);
      else pair.customsFile = file;
    }
    byKey.set(key, pair);
  }

  const pairs = [...byKey.values()].sort((a, b) =>
    naturalOrder.compare(a.label, b.label),
  );
  return { pairs, unsupported, duplicated };
}
