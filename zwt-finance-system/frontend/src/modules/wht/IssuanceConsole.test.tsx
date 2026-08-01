// @vitest-environment jsdom

import { StyleProvider } from "@ant-design/cssinjs";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { App as AntApp } from "antd";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { useI18n } from "../../i18n";
import { IssuanceConsole } from "./IssuanceConsole";
import { demoIncomeTypes } from "./sampleData";
import type { Payee, WhtTask } from "./types";

const payee: Payee = {
  id: "payee-1",
  taxId: "3200600843133",
  nameTh: "น.ส. ฉวี อินเต๋",
  nameEn: "Ms. Chawee Inte",
  addressTh: "99/1 ถนนสุขุมวิท แขวงคลองเตย กรุงเทพมหานคร 10110",
  whtType: "PND3",
  branchType: "none",
  branchNumber: null,
  aliases: ["Chawee", "ฉวี"],
  isActive: true,
  sourceFileName: null,
  createdByName: "系统管理员",
  updatedByName: "系统管理员",
  createdAt: "2026-07-23T10:00:00+07:00",
  updatedAt: "2026-07-23T10:00:00+07:00",
  // 回收站里的收款方开不出票（listPayees 默认就不返回），这里固定是未删除。
  deletedAt: null,
  deletedByName: null,
};

beforeAll(() => {
  // Codex 的 Node 启动参数会注入一个没有可用路径的 localStorage，
  // jsdom 因而留下了对象却没有标准方法。测试只关心语言默认值，用内存桩隔离它。
  const storage = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      clear: () => storage.clear(),
      getItem: (key: string) => storage.get(key) ?? null,
      key: (index: number) => [...storage.keys()][index] ?? null,
      get length() {
        return storage.size;
      },
      removeItem: (key: string) => storage.delete(key),
      setItem: (key: string, value: string) => storage.set(key, String(value)),
    } satisfies Storage,
  });

  // antd 的响应式栅格在挂载时就问 matchMedia，jsdom 没有实现。
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;

  globalThis.ResizeObserver ??= class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

afterEach(() => cleanup());

/**
 * `mock="server"` 让 antd 6 的 cssinjs 只算样式、不把 <style> 灌进 document
 * （它自带的测试开关，`process.env.NODE_ENV !== "production"` 时才生效，
 * 打包产物里是死代码）。类名照旧挂在元素上——那是 token 哈希算出来的，与注不注入
 * 无关，所以 `.ant-select-item-option`、`is-warning` 这些选择器一个都不受影响。
 *
 * 为什么值得这么做：jsdom 没有排版但**实现了 CSS 级联**，且是线性匹配。antd 一屏
 * 要注入 ~384KB / 1375 条规则，此后每次 getComputedStyle 都得跑完整份。
 * `getByRole(name)` 要为每个后代算无障碍名，每个后代还要各问一次 ::before/::after，
 * 于是**一次查询就要 2.8s**；摘掉样式表后同一棵树上只要 68ms（实测 2026-08-01）。
 * 本套用例断言的是文本、类名与 disabled，从不读计算样式，这些 CSS 是纯开销。
 */
function Harness({ onCreate = vi.fn() }: { onCreate?: () => Promise<WhtTask> }) {
  const { locale, t } = useI18n();
  return (
    <StyleProvider mock="server">
      <AntApp>
        <IssuanceConsole
          defaultPeriod="2026-06"
          incomeTypes={demoIncomeTypes}
          locale={locale}
          payees={[payee]}
          pending={false}
          periodOptions={[{ value: "2026-06", label: "2026-06" }]}
          t={t}
          viewSwitch={null}
          onCancel={vi.fn()}
          onCreate={onCreate as never}
        />
      </AntApp>
    </StyleProvider>
  );
}

/** antd 的 Select / AutoComplete 靠 mouseDown 展开，选项渲染在 body 的浮层里。 */
async function pickOption(fieldId: string, optionText?: string) {
  const combobox = document.querySelector(`#${fieldId}`);
  fireEvent.mouseDown(combobox as Element);
  const option = await waitFor(() => {
    const items = [...document.querySelectorAll(".ant-select-item-option")];
    const match = optionText
      ? items.find((item) => item.textContent?.includes(optionText))
      : items[0];
    if (!match) throw new Error(`option not rendered: ${optionText ?? "(first)"}`);
    return match;
  });
  fireEvent.click(option);
}

function setNumber(fieldId: string, value: string) {
  const input = document.querySelector(`#${fieldId}`) as HTMLInputElement;
  fireEvent.change(input, { target: { value } });
}

/** DatePicker 光 change 不提交，要敲一下回车才落进表单值。 */
function setDate(fieldId: string, value: string) {
  const input = document.querySelector(`#${fieldId}`) as HTMLInputElement;
  fireEvent.mouseDown(input);
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value } });
  fireEvent.keyDown(input, { key: "Enter", code: "Enter", keyCode: 13 });
}

function settlementText() {
  return document.querySelector(".issuance-settlement")?.textContent ?? "";
}

// 这里不要再写 { timeout: n }：describe 上的 timeout 会盖掉 vite.config.ts 里的
// testTimeout，连命令行 --testTimeout 也压不过它。超时口径统一由 vite.config.ts 的
// testTimeout 管，改一处就够。
describe("WHT 开票操作页", () => {
  it("选中收款方后，凭证上要打印的每一项都分行列出", async () => {
    render(<Harness />);

    // 没选之前不该有半张档案卡，只有引导文案。
    expect(screen.getByText("尚未选择收款方")).toBeTruthy();
    expect(screen.queryByText(payee.addressTh)).toBeNull();

    await pickOption("payeeId");

    // 地址是这次改动的重点：它会被快照进任务并原样印到凭证上，
    // 以前从下拉标签到详情面板都看不到。
    await waitFor(() => expect(screen.getByText(payee.addressTh)).toBeTruthy());
    const profile = document.querySelector(".issuance-profile:not(.is-empty)");
    expect(profile).toBeTruthy();
    expect(within(profile as HTMLElement).getByText(payee.nameEn as string)).toBeTruthy();
    expect(within(profile as HTMLElement).getByText("Chawee / ฉวี")).toBeTruthy();

    // 税号在档案里独立成行，不再只作为下拉标签的后半截存在。
    expect(
      document.querySelector(".issuance-profile-field .numeric")?.textContent,
    ).toBe(payee.taxId);
  });

  it("按 ROUND_HALF_UP 两位小数实时算出预扣税额与实付净额", async () => {
    render(<Harness />);
    await pickOption("payeeId");

    setNumber("totalAmount", "1234.55");

    // 默认 3%：1234.55 × 0.03 = 37.0365 → 37.04（半进位），净额 1197.51。
    await waitFor(() => {
      expect(settlementText()).toContain("37.04");
      expect(settlementText()).toContain("1,197.51");
    });
  });

  it("税率偏离法定值时必须填理由，理由随建单请求一起发出", async () => {
    const onCreate = vi.fn().mockResolvedValue({} as WhtTask);
    render(<Harness onCreate={onCreate as never} />);
    await pickOption("payeeId");

    // 选「运输费」会带出 1% 法定税率，没偏离时不该多问一句理由。
    await waitFor(() =>
      expect(
        (document.querySelector("#incomeType") as HTMLInputElement).disabled,
      ).toBe(false),
    );
    await pickOption("incomeType", "ค่าขนส่ง");
    await waitFor(() =>
      expect(screen.getByText(/与「运输费」的 1% 法定税率一致/)).toBeTruthy(),
    );
    expect(document.querySelector("#rateOverrideNote")).toBeNull();

    setNumber("totalAmount", "1000");
    setDate("paymentDate", "2026-06-20");
    setNumber("whtRate", "5");

    await waitFor(() => {
      const note = screen.getByText(/已手工改为 5%/);
      expect(note.className).toContain("is-warning");
    });
    // 偏离了才出现理由框。
    const reason = await waitFor(() => {
      const field = document.querySelector("#rateOverrideNote");
      if (!field) throw new Error("reason field not rendered");
      return field as HTMLTextAreaElement;
    });

    // 理由空着提交不了：按钮不禁用，但校验拦住，不会打出请求。
    fireEvent.click(screen.getByRole("button", { name: "创建草稿" }));
    await waitFor(() => expect(screen.getByText("税率偏离法定值时必须填写理由")).toBeTruthy());
    expect(onCreate).not.toHaveBeenCalled();

    fireEvent.change(reason, { target: { value: "合同约定 5%" } });
    fireEvent.click(screen.getByRole("button", { name: "创建草稿" }));

    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    expect(onCreate.mock.calls[0][0]).toMatchObject({
      whtRate: 0.05,
      rateOverrideNote: "合同约定 5%",
    });
  });

  it("没偏离时不发送理由字段", async () => {
    const onCreate = vi.fn().mockResolvedValue({} as WhtTask);
    render(<Harness onCreate={onCreate as never} />);
    await pickOption("payeeId");

    await waitFor(() =>
      expect(
        (document.querySelector("#incomeType") as HTMLInputElement).disabled,
      ).toBe(false),
    );
    await pickOption("incomeType", "ค่าขนส่ง");
    // 等目录把 1% 法定税率带出来再动别的控件：浮层还开着时
    // 点日期框会把事件吞掉，日期落不进表单值。
    await waitFor(() =>
      expect(screen.getByText(/与「运输费」的 1% 法定税率一致/)).toBeTruthy(),
    );
    expect(document.querySelector("#rateOverrideNote")).toBeNull();

    setNumber("totalAmount", "1000");
    setDate("paymentDate", "2026-06-20");
    fireEvent.click(screen.getByRole("button", { name: "创建草稿" }));

    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    expect(onCreate.mock.calls[0][0].rateOverrideNote).toBeNull();
  });

  it("收入类型只打字不点下拉项，也按目录判定偏离", async () => {
    render(<Harness />);
    await pickOption("payeeId");
    await waitFor(() =>
      expect(
        (document.querySelector("#incomeType") as HTMLInputElement).disabled,
      ).toBe(false),
    );

    // 粘贴泰文原文但不点下拉项：法定税率不会被回填，税率停在默认的 3%。
    // 服务端按同一份目录照样查得到「运输费」的 1%，会以「必须填理由」422 挡下——
    // 前端若只认 onSelect，这里既不提示偏离也不渲染理由框，人就被堵死在这一屏。
    // 末尾留个空格，顺带钉住前端 trim 与服务端 strip 的口径一致。
    const input = document.querySelector("#incomeType") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "ค่าขนส่ง " } });

    await waitFor(() => {
      const note = screen.getByText(/已手工改为 3%.*法定税率 1%/);
      expect(note.className).toContain("is-warning");
    });
    expect(document.querySelector("#rateOverrideNote")).toBeTruthy();
  });
});
