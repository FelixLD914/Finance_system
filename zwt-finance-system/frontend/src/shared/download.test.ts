// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fileNameFromResponse, saveBlobAsFile } from "./download";

describe("saveBlobAsFile", () => {
  let created: string;
  let revoked: string[];

  beforeEach(() => {
    created = "blob:zwt/abc";
    revoked = [];
    // jsdom 没有实现 createObjectURL / revokeObjectURL。
    URL.createObjectURL = vi.fn(() => created);
    URL.revokeObjectURL = vi.fn((url: string) => {
      revoked.push(url);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("点击期间 anchor 必须在 DOM 里，用完再摘掉", () => {
    let inDocumentAtClickTime = false;
    const append = HTMLElement.prototype.click;
    HTMLElement.prototype.click = function patched(this: HTMLElement) {
      inDocumentAtClickTime = window.document.body.contains(this);
    };

    try {
      saveBlobAsFile(new Blob(["x"]), "a.xlsx");
    } finally {
      HTMLElement.prototype.click = append;
    }

    // detached 的 <a download> 在部分浏览器上 click() 静默无效，
    // 所以「点击时在 DOM 里」是这个函数存在的理由之一。
    expect(inDocumentAtClickTime).toBe(true);
    // 但不能留在页面上堆积。
    expect(window.document.querySelectorAll("a[download]")).toHaveLength(0);
  });

  it("revoke 必须延后到下一个宏任务，不能紧跟 click 同步释放", () => {
    vi.useFakeTimers();

    saveBlobAsFile(new Blob(["x"]), "a.xlsx");

    // 同步释放会在下载线程取到 blob 引用之前把它掐掉，
    // 表现为偶发的「点了没反应 / 下载到 0 字节」。
    expect(revoked).toEqual([]);

    vi.runAllTimers();

    expect(revoked).toEqual([created]);
  });

  it("把文件名挂在 download 属性上", () => {
    const names: string[] = [];
    const original = HTMLElement.prototype.click;
    HTMLElement.prototype.click = function patched(this: HTMLAnchorElement) {
      names.push(this.download);
    };

    try {
      saveBlobAsFile(new Blob(["x"]), "ZWT-WHT-BatchIssue-Template.xlsx");
    } finally {
      HTMLElement.prototype.click = original;
    }

    expect(names).toEqual(["ZWT-WHT-BatchIssue-Template.xlsx"]);
  });
});

describe("fileNameFromResponse", () => {
  const withDisposition = (value: string | null) =>
    new Response("", { headers: value ? { "content-disposition": value } : {} });

  it("优先用服务器给的 RFC 5987 文件名", () => {
    const response = withDisposition(
      `attachment; filename*=UTF-8''${encodeURIComponent("预扣税凭证.pdf")}`,
    );

    expect(fileNameFromResponse(response, "fallback.pdf")).toBe("预扣税凭证.pdf");
  });

  it("没有 Content-Disposition 时用兜底名", () => {
    expect(fileNameFromResponse(withDisposition(null), "fallback.xlsx")).toBe(
      "fallback.xlsx",
    );
  });

  it("只有 ASCII filename= 时也用兜底名", () => {
    // 后端模板端点目前就是这种形式，兜底名与它给的名字一致，行为不变。
    const response = withDisposition('attachment; filename="Template.xlsx"');

    expect(fileNameFromResponse(response, "Template.xlsx")).toBe("Template.xlsx");
  });

  it("百分号编码坏掉时退回兜底名而不是抛错", () => {
    // decodeURIComponent("%E4%") 会抛 URIError，下载不该因为一个响应头就整个失败。
    const response = withDisposition("attachment; filename*=UTF-8''%E4%");

    expect(fileNameFromResponse(response, "fallback.xlsx")).toBe("fallback.xlsx");
  });
});
