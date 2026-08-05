// @vitest-environment jsdom

/**
 * 预览里那个签名盒子，落点必须就是后端 drawImage 的落点。
 *
 * backend/tests/test_signature_preview_alignment.py 钉的是"坐标表抄对了没有"，
 * 这里钉的是"抄对了的坐标有没有被正确画出来"——2026-08-05 那次两者正好分家：
 * 坐标表分毫不差，CSS 上一句 transform: translate(-50%, 50%) 把 WHT 的签名
 * 左移 47.5pt、下移 21pt，Python 侧完全看不见。
 *
 * 断言写成"内联 style 的百分比 == 后端点数 / 页面尺寸"，是因为这正是浏览器
 * 唯一用来定位的东西；换算一步都不做，抄错就直接现形。
 */
import { StyleProvider } from "@ant-design/cssinjs";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { useI18n } from "../../i18n";
import type { SignatureAsset, SignatureUsage } from "../wht/types";
import { SignaturePreviewModal, stampRectPt } from "./SignaturePreviewModal";

const PAGE_WIDTH_PT = 595.25;
const PAGE_HEIGHT_PT = 841.85;

/** 后端三处签名框，单位 PDF 点。改这里 = 后端也改了，两边必须同一次提交。 */
const BACKEND_BOXES = {
  // app/modules/wht/document_generator.py :: PDF_SIGNATURE_BOX
  wht: { x: 201.5, y: 83.0, width: 95.0, height: 42.0 },
  // app/modules/tax_invoice/document_generator.py :: SIGNATURE_BOX
  tax_inv: { x: 398.0, y: 112.0, width: 150.0, height: 46.0 },
  // app/modules/salary_advance/pdf_layout.py :: SIGNATURE_BOXES
  salary_advance_finance: { x: 294.88, y: 304.91, width: 90.0, height: 28.0 },
  salary_advance_md: { x: 294.82, y: 201.96, width: 90.0, height: 28.0 },
} as const;

beforeAll(() => {
  // i18n 在挂载时读 localStorage；jsdom 里它是个不可用的存根。
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
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
});

afterEach(cleanup);

function makeSignature(usage: SignatureUsage[], scalePercent = 100): SignatureAsset {
  return {
    id: "sig-1",
    name: "XINGLANHUI",
    originalFileName: "LANHUI XING.png",
    mimeType: "image/png",
    // demo 前缀让弹窗走内置 SVG，不去打后端 /content 接口。
    sha256: "demo".padEnd(64, "0"),
    version: 1,
    status: "active",
    usage,
    isDefault: false,
    scalePercent,
    createdByName: "tester",
    updatedByName: "tester",
  } as SignatureAsset;
}

function Harness({
  // 后端 SignatureAssetRead 返回的是**展开后**的集合（schemas.split_usage ->
  // parse_signature_usage），声明 salary_advance 会带出两个角色位。这里照抄，
  // 否则测的就不是真实数据形状。
  usage = [
    "wht",
    "tax_inv",
    "salary_advance",
    "salary_advance_finance",
    "salary_advance_md",
  ] as SignatureUsage[],
  scalePercent = 100,
}: {
  usage?: SignatureUsage[];
  scalePercent?: number;
}) {
  const { t } = useI18n();
  return (
    // mock="server" 关掉 cssinjs 的运行时注样式：不关的话 antd 会往 jsdom 注
    // 一千多条规则，按 role 查询会慢一个数量级（见 IssuanceConsole.test.tsx）。
    <StyleProvider mock="server">
      <SignaturePreviewModal
        open
        signature={makeSignature(usage, scalePercent)}
        t={t}
        onClose={() => undefined}
      />
    </StyleProvider>
  );
}

/** antd Segmented 的可点目标是隐藏 radio，不是那段文字。 */
function selectSalaryAdvanceTab() {
  fireEvent.click(screen.getByRole("radio", { name: /工资预支单凭证/ }));
}

/** 取那个签名盒子的内联定位样式，换算回 PDF 点。 */
function stampRectFromDom(usage: SignatureUsage) {
  const node = screen.getByTestId(`signature-stamp-${usage}`);
  const read = (value: string) => Number.parseFloat(value.replace("%", ""));
  return {
    x: (read(node.style.left) / 100) * PAGE_WIDTH_PT,
    y: (read(node.style.bottom) / 100) * PAGE_HEIGHT_PT,
    width: (read(node.style.width) / 100) * PAGE_WIDTH_PT,
    height: (read(node.style.height) / 100) * PAGE_HEIGHT_PT,
  };
}

describe("stampRectPt", () => {
  it("100% 时就是签名框本身", () => {
    for (const box of Object.values(BACKEND_BOXES)) {
      expect(stampRectPt(box, 100)).toEqual(box);
    }
  });

  it("缩放围绕签名框中心，中心点不随比例移动", () => {
    // 后端 wht / tax_invoice / salary_advance 三处 drawImage 之前都是
    //   scaled_x = x + (width - width * ratio) / 2
    // 钉住"中心不动"这个语义，而不是抄一遍算式——抄算式测不出抄错。
    for (const box of Object.values(BACKEND_BOXES)) {
      const centreX = box.x + box.width / 2;
      const centreY = box.y + box.height / 2;
      for (const scale of [50, 60, 80, 100, 120, 150, 200]) {
        const rect = stampRectPt(box, scale);
        expect(rect.x + rect.width / 2).toBeCloseTo(centreX, 6);
        expect(rect.y + rect.height / 2).toBeCloseTo(centreY, 6);
        expect(rect.width).toBeCloseTo((box.width * scale) / 100, 6);
        expect(rect.height).toBeCloseTo((box.height * scale) / 100, 6);
      }
    }
  });

  it("比例缺失时按 100% 处理，绝不缩成 0", () => {
    expect(stampRectPt(BACKEND_BOXES.wht, 0)).toEqual(BACKEND_BOXES.wht);
  });
});

describe("SignaturePreviewModal 的套印落点", () => {
  it("WHT 签名盒子的四个定位值就是后端的签名框", () => {
    render(<Harness />);
    // 默认就在 WHT 页签。
    const rect = stampRectFromDom("wht");
    expect(rect.x).toBeCloseTo(BACKEND_BOXES.wht.x, 2);
    expect(rect.y).toBeCloseTo(BACKEND_BOXES.wht.y, 2);
    expect(rect.width).toBeCloseTo(BACKEND_BOXES.wht.width, 2);
    expect(rect.height).toBeCloseTo(BACKEND_BOXES.wht.height, 2);
  });

  it("已保存的缩放比直接体现在落点上，且中心不动", () => {
    // 100% 时居中缩放与钉左下角看不出区别，所以非 100% 的这一条才是把
    // "组件确实把比例喂进了 stampRectPt" 接上的那一环。
    render(<Harness scalePercent={60} />);
    const rect = stampRectFromDom("wht");
    const box = BACKEND_BOXES.wht;
    expect(rect.width).toBeCloseTo(box.width * 0.6, 2);
    expect(rect.height).toBeCloseTo(box.height * 0.6, 2);
    expect(rect.x + rect.width / 2).toBeCloseTo(box.x + box.width / 2, 2);
    expect(rect.y + rect.height / 2).toBeCloseTo(box.y + box.height / 2, 2);
  });

  it("盒子上不挂任何 transform：left/bottom 就是签名框左下角", () => {
    render(<Harness />);
    // 内联 transform 会直接位移；CSS 侧的同名回归由
    // backend/tests/test_signature_preview_alignment.py 守着。
    expect(screen.getByTestId("signature-stamp-wht").style.transform).toBe("");
  });

  it("工资预支页签同时画出财务与董事两个签名位", () => {
    render(<Harness />);
    selectSalaryAdvanceTab();

    for (const usage of ["salary_advance_finance", "salary_advance_md"] as const) {
      const rect = stampRectFromDom(usage);
      expect(rect.x).toBeCloseTo(BACKEND_BOXES[usage].x, 2);
      expect(rect.y).toBeCloseTo(BACKEND_BOXES[usage].y, 2);
    }
  });

  it("适用范围没勾到的签名位画成空框，不画签名图", () => {
    // 只能盖财务位的签名：董事位出票时是空的，预览不能假装盖上了。
    render(<Harness usage={["salary_advance", "salary_advance_finance"]} />);
    selectSalaryAdvanceTab();

    const finance = screen.getByTestId("signature-stamp-salary_advance_finance");
    const md = screen.getByTestId("signature-stamp-salary_advance_md");
    expect(md.className).toContain("is-not-applicable");
    expect(md.querySelector("img")).toBeNull();
    expect(finance.className).not.toContain("is-not-applicable");
  });
});
