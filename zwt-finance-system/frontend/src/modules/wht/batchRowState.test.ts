import { describe, expect, it } from "vitest";

import {
  type EditableRow,
  applyPayeeToRows,
  deriveRowState,
  roundHalfUp,
} from "./batchRowState";
import { demoIncomeTypes } from "./sampleData";

// ค่าบริการ（服务费）PND53 法定 3%；ค่าขนส่ง（运输费）PND53 法定 1%。
const SERVICE = "ค่าบริการ";
const TRANSPORT = "ค่าขนส่ง";

function row(overrides: Partial<EditableRow> = {}): EditableRow {
  return {
    rowNumber: 2,
    period: "2026-06",
    issuanceType: "normal",
    supplementRun: 0,
    incomeType: SERVICE,
    paymentDate: "2026-06-05",
    totalAmount: 3000,
    whtRate: null,
    rateReason: null,
    payee: {
      payeeId: "payee-1",
      taxId: "0105540057561",
      nameTh: "บริษัท ทดสอบ จำกัด",
      nameEn: "Test Co., Ltd.",
      addressTh: "99/1 ถนนสุขุมวิท กรุงเทพมหานคร",
      whtType: "PND53",
      branchType: "head_office",
      branchNumber: null,
      isActive: true,
    },
    ...overrides,
  };
}

function unknownPayee(overrides: Partial<EditableRow["payee"]> = {}) {
  return {
    payeeId: null,
    taxId: "0999999999999",
    nameTh: null,
    nameEn: null,
    addressTh: null,
    whtType: null,
    branchType: "none" as const,
    branchNumber: null,
    isActive: true,
    ...overrides,
  };
}

const derive = (input: EditableRow) => deriveRowState(input, demoIncomeTypes);

describe("核对表的行状态", () => {
  it("库里有收款方、税率能从目录带出来时是可开具的", () => {
    const state = derive(row());

    expect(state.status).toBe("ready");
    expect(state.statutoryRate).toBe(0.03);
    expect(state.effectiveRate).toBe(0.03);
    expect(state.whtAmount).toBe(90);
  });

  it("收款方不在主数据里时标成待补录，而不是报错", () => {
    // 这是整个分步流程的核心：查不到收款方不再整表退回，而是让人在页面上补。
    const state = derive(row({ payee: unknownPayee() }));

    expect(state.status).toBe("payee_missing");
    expect(state.issues).toEqual([
      { code: "payeeMissing", taxId: "0999999999999" },
    ]);
    // 不知道走 PND3 还是 PND53 就带不出法定税率。此时**不能猜**：
    // 猜出来的税率看着像模像样，反而没人会去改它。
    expect(state.statutoryRate).toBeNull();
  });

  it("补录到一半（缺申报表类型）仍然算没补完", () => {
    const state = derive(
      row({
        payee: unknownPayee({
          nameTh: "บริษัท ใหม่ จำกัด",
          addressTh: "กรุงเทพมหานคร",
        }),
      }),
    );

    expect(state.status).toBe("payee_missing");
  });

  it("补录填齐后立刻按新的申报表类型带出法定税率", () => {
    // 不回服务器就能算出来，正是这套判定在前端也要有一份的原因。
    const state = derive(
      row({
        payee: unknownPayee({
          nameTh: "บริษัท ใหม่ จำกัด",
          addressTh: "กรุงเทพมหานคร",
          whtType: "PND53",
        }),
      }),
    );

    expect(state.status).toBe("ready");
    expect(state.statutoryRate).toBe(0.03);
    expect(state.whtAmount).toBe(90);
  });

  it("停用的收款方说的是「已停用」，不是「查不到」", () => {
    const state = derive(
      row({ payee: { ...row().payee, isActive: false } }),
    );

    expect(state.status).toBe("needs_input");
    expect(state.issues[0].code).toBe("payeeInactive");
  });

  it("目录外的收入类型要求直接填税率", () => {
    const state = derive(row({ incomeType: "ค่าอะไรก็ไม่รู้" }));

    expect(state.status).toBe("needs_input");
    expect(state.issues[0].code).toBe("rateRequired");
  });

  it("目录外的收入类型填了税率就放行——查不到法定值就无从判定偏离", () => {
    const state = derive(
      row({ incomeType: "ค่าอะไรก็ไม่รู้", whtRate: 0.02 }),
    );

    expect(state.status).toBe("ready");
    expect(state.deviates).toBe(false);
  });

  it("税率偏离法定值时必须填理由", () => {
    const state = derive(row({ incomeType: TRANSPORT, whtRate: 0.05 }));

    expect(state.status).toBe("needs_input");
    expect(state.deviates).toBe(true);
    expect(state.issues[0]).toEqual({
      code: "rateReasonRequired",
      rate: "5.00%",
      statutory: "1.00%",
    });
  });

  it("填了理由就放行，但仍然记为偏离", () => {
    const state = derive(
      row({
        incomeType: TRANSPORT,
        whtRate: 0.05,
        rateReason: "合同约定 5%，见 2026-06 补充协议",
      }),
    );

    expect(state.status).toBe("ready");
    expect(state.deviates).toBe(true);
  });

  it("空白理由不算理由", () => {
    const state = derive(
      row({ incomeType: TRANSPORT, whtRate: 0.05, rateReason: "   " }),
    );

    expect(state.status).toBe("needs_input");
  });
});

describe("代扣金额", () => {
  it("按 ROUND_HALF_UP 保留两位，与服务端逐字一致", () => {
    // 1234.5 × 3% = 37.035。JS 的浮点里它其实是 37.034999…，
    // 直接 Math.round(x * 100) 会得到 37.03，而业务口径要 37.04。
    expect(roundHalfUp(1234.5 * 0.03)).toBe(37.04);
    expect(derive(row({ totalAmount: 1234.5 })).whtAmount).toBe(37.04);
  });
});

describe("补录的收款方资料", () => {
  it("一次填写套用到本批所有同税号的行", () => {
    // 一张导入表里同一个新供应商常常出现好几行；让人逐行重填泰文地址既折磨人，
    // 又必然填出不一致的版本，而它们最终要合并成主数据里的同一条档案。
    const rows = [
      row({ rowNumber: 2, payee: unknownPayee() }),
      row({ rowNumber: 3, payee: unknownPayee() }),
      row({ rowNumber: 4 }),
    ];

    const updated = applyPayeeToRows(rows, "0999999999999", {
      nameTh: "บริษัท ใหม่ จำกัด",
      nameEn: null,
      addressTh: "กรุงเทพมหานคร",
      whtType: "PND3",
      branchType: "none",
      branchNumber: null,
    });

    expect(updated[0].payee.whtType).toBe("PND3");
    expect(updated[1].payee.whtType).toBe("PND3");
    // 已在主数据里的行不受影响——主数据是权威副本，不该被界面上的输入覆盖。
    expect(updated[2].payee.whtType).toBe("PND53");
    expect(updated[2].payee.nameTh).toBe("บริษัท ทดสอบ จำกัด");
  });
});
