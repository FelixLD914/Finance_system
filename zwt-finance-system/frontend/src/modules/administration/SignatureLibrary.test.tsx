// @vitest-environment jsdom

/**
 * 签名人姓名只在「适用单据」勾了工资预支时才出现且必填。
 *
 * 业务口径（2026-08-05）：只有工资预支单会把姓名印到单据上（签名横线下方的
 * "( 姓名 )"），WHT 与 TAX INV 的单据上只有签名图。所以这一项不能做成"所有签名
 * 都要填"——那会逼着只用于 WHT 的签名去编一个没人看的名字。
 *
 * 后端 `signature_usage.requires_signer_name` 是同一条规则的权威实现，这里守的是
 * 前端不要先于它把用户拦住、也不要漏掉它该拦的。
 */
import { StyleProvider } from "@ant-design/cssinjs";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { App as AntApp } from "antd";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { useI18n } from "../../i18n";
import { SignatureLibrary } from "./SignatureLibrary";

const uploadSignature = vi.fn();

vi.mock("../wht/api", () => ({
  listSignatures: () => Promise.resolve([]),
  uploadSignature: (...args: unknown[]) => {
    uploadSignature(...args);
    return Promise.resolve({});
  },
  updateSignature: () => Promise.resolve({}),
  deleteSignature: () => Promise.resolve({}),
  restoreSignature: () => Promise.resolve({}),
}));

beforeAll(() => {
  const storage = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => void storage.set(key, value),
      removeItem: (key: string) => void storage.delete(key),
      clear: () => storage.clear(),
    },
  });
  // antd 的响应式栅格要用它；jsdom 没有。
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
    }),
  });
});

afterEach(() => {
  cleanup();
  uploadSignature.mockReset();
});

function Harness() {
  // StyleProvider mock="server" 是必需的：antd 6 的 cssinjs 往 jsdom 灌 CSS 会让
  // getByRole(name) 慢一个数量级（见 docs 与 IssuanceConsole.test.tsx 的说明）。
  const { t } = useI18n();
  return (
    <StyleProvider mock="server">
      <AntApp>
        <SignatureLibrary t={t} />
      </AntApp>
    </StyleProvider>
  );
}

async function openUploadModal() {
  render(<Harness />);
  // 用正则而不是精确串：antd 的图标是 <span role="img" aria-label="plus">，
  // 它会算进按钮的可及名称，精确匹配"上传签名图片"永远命不中。
  fireEvent.click(await screen.findByRole("button", { name: /上传签名图片/ }));
  await screen.findByLabelText("签名名称");
}

describe("签名人姓名的显隐与必填", () => {
  it("只勾 WHT 时不出现——WHT 单据上不印姓名", async () => {
    await openUploadModal();

    // 弹窗确实开着（适用单据的复选框在），但姓名一栏不该出现。
    // 不用 getByLabelText("适用单据")：Checkbox.Group 没有可解析的 label 关联。
    expect(screen.getByRole("checkbox", { name: /WHT/ })).toBeDefined();
    expect(screen.queryByLabelText("签名人姓名")).toBeNull();
  });

  it("勾上预支单角色后出现", async () => {
    await openUploadModal();

    fireEvent.click(screen.getByRole("checkbox", { name: /预支单-财务负责人/ }));

    await waitFor(() => {
      expect(screen.queryByLabelText("签名人姓名")).not.toBeNull();
    });
  });

  it("勾了预支单却不填姓名时不放行上传", async () => {
    await openUploadModal();

    fireEvent.change(screen.getByLabelText("签名名称"), {
      target: { value: "MD_GONG_YAOWEN" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: /预支单-董事/ }));
    await screen.findByLabelText("签名人姓名");

    // 弹窗的确定按钮走 common.save；恰好两个汉字，antd 会插一个空格，故用正则。
    fireEvent.click(screen.getByRole("button", { name: /保\s*存/ }));

    await waitFor(() => {
      expect(screen.getByText("勾选了工资预支单，签名人姓名为必填")).toBeDefined();
    });
    expect(uploadSignature).not.toHaveBeenCalled();
  });

  it("取消勾选预支单后又隐藏，不会把姓名带上去", async () => {
    await openUploadModal();

    const role = screen.getByRole("checkbox", { name: /预支单-董事/ });
    fireEvent.click(role);
    await screen.findByLabelText("签名人姓名");

    fireEvent.click(role);
    await waitFor(() => {
      expect(screen.queryByLabelText("签名人姓名")).toBeNull();
    });
  });
});
