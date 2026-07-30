import { describe, expect, it } from "vitest";

import {
  classifyDualFile,
  findQueuedFile,
  mergeDualFiles,
  type QueuedFile,
} from "./dualPairing";

function file(name: string, size = 1024): File {
  return new File([new Uint8Array(size)], name);
}

const empty = { invoices: [] as QueuedFile[], customs: [] as QueuedFile[] };

describe("classifyDualFile", () => {
  it("按扩展名归位，认不出的返回 null", () => {
    expect(classifyDualFile(file("a.xlsx"))).toBe("invoice");
    expect(classifyDualFile(file("a.XLS"))).toBe("invoice");
    expect(classifyDualFile(file("QECL603151144.PDF"))).toBe("customs");
    expect(classifyDualFile(file("说明.docx"))).toBeNull();
  });
});

describe("mergeDualFiles", () => {
  it("Excel 与 PDF 分成两份清单，不按文件名撮合", () => {
    // 真实归档里最常见的一组：发票 Excel、发票自己的 PDF 打印件、真报关单。
    // 前两者同名——旧逻辑会把打印件当报关单配上去，新逻辑只按类型分清单，
    // 谁跟谁一组交给后端按 C/I No. 判。
    const { invoices, customs } = mergeDualFiles(empty, [
      file("3.ZWT：20260123-NOKIA-IV&PL(ZWT-NSB26012304).xlsx"),
      file("3.ZWT：20260123-NOKIA-IV&PL(ZWT-NSB26012304).pdf"),
      file("QECL603151144.pdf"),
    ]);
    expect(invoices.map((item) => item.file.name)).toEqual([
      "3.ZWT：20260123-NOKIA-IV&PL(ZWT-NSB26012304).xlsx",
    ]);
    expect(customs.map((item) => item.file.name)).toEqual([
      "3.ZWT：20260123-NOKIA-IV&PL(ZWT-NSB26012304).pdf",
      "QECL603151144.pdf",
    ]);
  });

  it("第二次选择并进队列，不清空第一次的", () => {
    const first = mergeDualFiles(empty, [file("a.xlsx")]);
    const second = mergeDualFiles(first, [file("QECL1.pdf")]);
    expect(second.invoices).toHaveLength(1);
    expect(second.customs).toHaveLength(1);
  });

  it("同名同大小算重复选择，忽略并回报", () => {
    const first = mergeDualFiles(empty, [file("a.xlsx", 2048)]);
    const second = mergeDualFiles(first, [file("a.xlsx", 2048)]);
    expect(second.invoices).toHaveLength(1);
    expect(second.duplicated).toEqual(["a.xlsx"]);
  });

  it("同名但大小不同是改过的版本，两份都留着让人自己挑", () => {
    const first = mergeDualFiles(empty, [file("a.xlsx", 2048)]);
    const second = mergeDualFiles(first, [file("a.xlsx", 4096)]);
    expect(second.invoices).toHaveLength(2);
    expect(second.duplicated).toEqual([]);
  });

  it("认不出扩展名的整份忽略并回报", () => {
    const { invoices, customs, unsupported } = mergeDualFiles(empty, [
      file("说明.docx"),
    ]);
    expect(invoices).toHaveLength(0);
    expect(customs).toHaveLength(0);
    expect(unsupported).toEqual(["说明.docx"]);
  });

  it("带序号前缀的文件名按自然序排，不是 1、10、2", () => {
    const { customs } = mergeDualFiles(empty, [
      file("10.decl.pdf"),
      file("2.decl.pdf"),
      file("1.decl.pdf"),
    ]);
    expect(customs.map((item) => item.file.name)).toEqual([
      "1.decl.pdf",
      "2.decl.pdf",
      "10.decl.pdf",
    ]);
  });
});

describe("findQueuedFile", () => {
  it("按后端回的文件名找回 File，找不到给 null", () => {
    const { customs } = mergeDualFiles(empty, [file("QECL603151144.pdf")]);
    expect(findQueuedFile(customs, "QECL603151144.pdf")?.name).toBe(
      "QECL603151144.pdf",
    );
    expect(findQueuedFile(customs, "别的.pdf")).toBeNull();
    // 关单没配到时后端回的是 null，不能当成"找第一个"。
    expect(findQueuedFile(customs, null)).toBeNull();
  });
});
