/**
 * 浏览器端「把响应存成文件」的唯一实现。
 *
 * 这段逻辑原先在 wht / tax-invoice / salary-advance 里各抄了一遍（6 处），
 * 与 AGENTS.md「shared/ 是平台能力，不在模块内复制」相违。抄出来的版本都带着
 * 同两个脆点，集中修一次：
 *
 *   1. anchor 必须挂进 DOM 再点。detached 的 <a download> 在部分浏览器
 *      （历史版本的 Firefox）上 click() 不触发下载，静默什么也不发生。
 *   2. revokeObjectURL 不能紧跟在 click() 后面同步调用。下载线程可能还没取到
 *      blob 引用就被释放，表现为偶发的「点了没反应 / 下载到 0 字节」。
 *      放到下一个宏任务里释放即可，不必长时间持有。
 *
 * 用 window.open 打开新标签的场景不适用本函数：那种情况新标签要在之后才去读
 * 这个 URL，得显式延后更久再 revoke（见 salary-advance 的 preview）。
 */
export function saveBlobAsFile(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = window.document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = "noopener";
  anchor.style.display = "none";
  window.document.body.append(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

/**
 * 从 Content-Disposition 里取服务器给的文件名，取不到就用兜底名。
 * 只认 RFC 5987 的 `filename*=UTF-8''`：本系统的中文/泰文文件名一律走这个形式。
 */
export function fileNameFromResponse(response: Response, fallback: string): string {
  const disposition = response.headers.get("content-disposition") ?? "";
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (!encoded) return fallback;
  try {
    return decodeURIComponent(encoded);
  } catch {
    // 服务器给了坏的百分号编码时，宁可用兜底名，也不要整个下载失败。
    return fallback;
  }
}
