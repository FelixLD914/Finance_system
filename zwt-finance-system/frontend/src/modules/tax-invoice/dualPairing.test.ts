import { describe, expect, it } from "vitest";

import { classifyDualFile, isReadyPair, mergeDualFiles } from "./dualPairing";

function file(name: string): File {
  return new File(["x"], name);
}

/** 真实文件名长这样：序号 + 日期 + 单号 + 金额，Excel 与 PDF 只差扩展名。 */
function pairOf(index: number, day: string): [File, File] {
  const base = `${index}.2026${day}-TAX INV(ZWT-IV2026${day}-01)-THB431,369.94`;
  return [file(`${base}.xlsx`), file(`${base}.pdf`)];
}

describe("classifyDualFile", () => {
  it("按扩展名归位，认不出的返回 null", () => {
    expect(classifyDualFile(file("a.xlsx"))).toBe("invoice");
    expect(classifyDualFile(file("a.XLS"))).toBe("invoice");
    expect(classifyDualFile(file("a.PDF"))).toBe("customs");
    expect(classifyDualFile(file("a.docx"))).toBeNull();
  });
});

describe("mergeDualFiles", () => {
  it("同名的 Excel 与 PDF 配成一组", () => {
    const [excel, pdf] = pairOf(1, "0210");

    const { pairs, unsupported, duplicated } = mergeDualFiles([], [excel, pdf]);

    expect(pairs).toHaveLength(1);
    expect(pairs[0].invoiceFile).toBe(excel);
    expect(pairs[0].customsFile).toBe(pdf);
    expect(isReadyPair(pairs[0])).toBe(true);
    expect(unsupported).toEqual([]);
    expect(duplicated).toEqual([]);
  });

  // 这是这次要修的那个 bug：一次选 19 对，旧逻辑只留下第一对。
  it("一次多选保留全部组，不再只留第一组", () => {
    const files = [1, 2, 3].flatMap((index) => pairOf(index, "0210"));

    const { pairs, duplicated } = mergeDualFiles([], files);

    expect(pairs).toHaveLength(3);
    expect(pairs.every(isReadyPair)).toBe(true);
    expect(duplicated).toEqual([]);
  });

  it("按文件名里的序号排，不是按码位排", () => {
    const files = [10, 2, 1].flatMap((index) => pairOf(index, "0210"));

    const { pairs } = mergeDualFiles([], files);

    expect(pairs.map((pair) => pair.label.split(".")[0])).toEqual(["1", "2", "10"]);
  });

  it("先选 Excel 再补 PDF 会并进同一组，不会清空上一批", () => {
    const [excel, pdf] = pairOf(1, "0210");

    const first = mergeDualFiles([], [excel]);
    const second = mergeDualFiles(first.pairs, [pdf]);

    expect(first.pairs).toHaveLength(1);
    expect(isReadyPair(first.pairs[0])).toBe(false);
    expect(second.pairs).toHaveLength(1);
    expect(second.pairs[0].invoiceFile).toBe(excel);
    expect(second.pairs[0].customsFile).toBe(pdf);
  });

  it("配不上对的一边保留在队列里，标记为未就绪", () => {
    const [excel] = pairOf(1, "0210");
    const orphanPdf = file("完全不同的名字.pdf");

    const { pairs } = mergeDualFiles([], [excel, orphanPdf]);

    expect(pairs).toHaveLength(2);
    expect(pairs.filter(isReadyPair)).toHaveLength(0);
  });

  it("同一组里同类型撞车才算重复，不同组的两份 Excel 各自成组", () => {
    const [excelA] = pairOf(1, "0210");
    const [excelB] = pairOf(2, "0210");
    const sameKeyOtherExt = file(`${excelA.name.replace(/\.xlsx$/, "")}.xls`);

    const { pairs, duplicated } = mergeDualFiles([], [excelA, excelB, sameKeyOtherExt]);

    expect(pairs).toHaveLength(2);
    expect(duplicated).toEqual([sameKeyOtherExt.name]);
  });

  it("大小写不同的同名文件算同一组", () => {
    const excel = file("Invoice-01.XLSX");
    const pdf = file("invoice-01.pdf");

    const { pairs } = mergeDualFiles([], [excel, pdf]);

    expect(pairs).toHaveLength(1);
    expect(isReadyPair(pairs[0])).toBe(true);
  });

  it("扩展名认不出的整份忽略并回报文件名", () => {
    const { pairs, unsupported } = mergeDualFiles([], [file("说明.docx")]);

    expect(pairs).toEqual([]);
    expect(unsupported).toEqual(["说明.docx"]);
  });
});
