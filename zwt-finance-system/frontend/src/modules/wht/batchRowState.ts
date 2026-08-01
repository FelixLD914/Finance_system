/**
 * 核对表每一行的状态推导。
 *
 * 为什么这套判定在前端也要有一份：核对页的全部意义就是让人**当场**把缺的东西补上。
 * 用户填完一个新收款方的申报表类型，那一行的法定税率、代扣金额、要不要写偏离理由
 * 立刻就变了 —— 这些都不该等一次服务器往返。所以这不是把后端逻辑抄一遍，而是这个
 * 交互本身要求的。
 *
 * 落库仍以服务端为准（batch-commit 会把每一行按主数据和收入类型目录重新判一遍），
 * 这里算错最多是把话说早了或说漏了，不会让错数据进库。口径与
 * backend/app/modules/wht/batch_review.py 对齐。
 */

import type {
  BatchPreviewRow,
  BatchRowStatus,
  IncomeTypeOption,
  WhtType,
} from "./types";

/** 核对表里可编辑的收款方。payeeId 为空 = 主数据里没有，等人补录。 */
export interface EditablePayee {
  payeeId: string | null;
  taxId: string;
  nameTh: string | null;
  nameEn: string | null;
  addressTh: string | null;
  whtType: WhtType | null;
  isActive: boolean;
}

/** 核对表里的一行。数值在这里是 number，提交时才转回后端要的形状。 */
export interface EditableRow {
  rowNumber: number;
  period: string;
  issuanceType: "normal" | "supplement";
  supplementRun: number;
  incomeType: string;
  paymentDate: string;
  totalAmount: number;
  /** 小数形式，0.03 = 3%。为空表示"按收入类型带出法定值"。 */
  whtRate: number | null;
  rateReason: string | null;
  payee: EditablePayee;
}

/** 结构化的问题码。文案由组件按当前语言翻译，不在这里拼中文。 */
export type RowIssue =
  | { code: "payeeInactive"; name: string }
  | { code: "payeeMissing"; taxId: string }
  | { code: "rateRequired"; incomeType: string; whtType: string }
  | { code: "rateReasonRequired"; rate: string; statutory: string };

export interface RowState {
  status: BatchRowStatus;
  /** 目录法定税率（小数）。收款方未补录时为空——不知道走哪张 PND 表。 */
  statutoryRate: number | null;
  /** 实际生效税率：行里填了就用行里的，否则取法定值。 */
  effectiveRate: number | null;
  whtAmount: number | null;
  deviates: boolean;
  issues: RowIssue[];
}

/**
 * 与后端 `_calculated_wht_amount` 对齐：ROUND_HALF_UP 保留两位。
 *
 * 直接 `Math.round(value * 100)` 会把 1.005（浮点里其实是 1.00499…）算成 1.00，
 * 所以先按 12 位有效数字把二进制表示误差抹掉再进位。核对页显示的金额与落库值
 * 差一分，这次核对就白做了。金额恒为正，不必处理负号。
 */
export function roundHalfUp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(Number((value * 100).toPrecision(12))) / 100;
}

/** 按 code 或泰文原文查目录。与服务端 income_types.find() 认同一组键。 */
export function findIncomeType(
  incomeTypes: IncomeTypeOption[],
  raw: string,
): IncomeTypeOption | null {
  const value = raw.trim();
  if (!value) return null;
  return (
    incomeTypes.find((option) => option.code === value || option.labelTh === value) ??
    null
  );
}

export function statutoryRateFor(
  incomeTypes: IncomeTypeOption[],
  incomeType: string,
  whtType: WhtType | null,
): number | null {
  if (!whtType) return null;
  const option = findIncomeType(incomeTypes, incomeType);
  const rate = option?.rates.find((entry) => entry.whtType === whtType)?.rate;
  return rate === undefined ? null : Number(rate);
}

function percent(rate: number): string {
  return `${(rate * 100).toFixed(2)}%`;
}

export function deriveRowState(
  row: EditableRow,
  incomeTypes: IncomeTypeOption[],
): RowState {
  const empty: RowState = {
    status: "ready",
    statutoryRate: null,
    effectiveRate: row.whtRate,
    whtAmount:
      row.whtRate === null ? null : roundHalfUp(row.totalAmount * row.whtRate),
    deviates: false,
    issues: [],
  };

  if (!row.payee.payeeId) {
    // 新收款方要填齐才算补录完成：这三项都会原样印在正式凭证上，推导不出来。
    const complete =
      Boolean(row.payee.nameTh?.trim()) &&
      Boolean(row.payee.addressTh?.trim()) &&
      Boolean(row.payee.whtType);
    if (!complete) {
      return {
        ...empty,
        status: "payee_missing",
        issues: [{ code: "payeeMissing", taxId: row.payee.taxId }],
      };
    }
  } else if (!row.payee.isActive) {
    return {
      ...empty,
      status: "needs_input",
      issues: [{ code: "payeeInactive", name: row.payee.nameTh ?? row.payee.taxId }],
    };
  }

  const whtType = row.payee.whtType;
  const statutoryRate = statutoryRateFor(incomeTypes, row.incomeType, whtType);
  const effectiveRate = row.whtRate ?? statutoryRate;
  const whtAmount =
    effectiveRate === null ? null : roundHalfUp(row.totalAmount * effectiveRate);

  if (effectiveRate === null) {
    return {
      status: "needs_input",
      statutoryRate,
      effectiveRate,
      whtAmount,
      deviates: false,
      issues: [
        {
          code: "rateRequired",
          incomeType: row.incomeType,
          whtType: whtType ?? "—",
        },
      ],
    };
  }

  // 目录里查不到这个收入类型时无从比对，一律算不偏离——与服务端 _rate_deviation 一致。
  const deviates =
    statutoryRate !== null && roundHalfUp(effectiveRate) !== roundHalfUp(statutoryRate);
  const hasReason = Boolean(row.rateReason?.trim());

  return {
    status: deviates && !hasReason ? "needs_input" : "ready",
    statutoryRate,
    effectiveRate,
    whtAmount,
    deviates,
    issues:
      deviates && !hasReason
        ? [
            {
              code: "rateReasonRequired",
              rate: percent(effectiveRate),
              statutory: percent(statutoryRate ?? 0),
            },
          ]
        : [],
  };
}

/** 把服务端预览的一行转成可编辑行。数值字符串一次性转成 number。 */
export function toEditableRow(row: BatchPreviewRow): EditableRow {
  return {
    rowNumber: row.rowNumber,
    period: row.period,
    issuanceType: row.issuanceType,
    supplementRun: row.supplementRun,
    incomeType: row.incomeType,
    paymentDate: row.paymentDate,
    totalAmount: Number(row.totalAmount),
    // 预览已经把法定税率带进 whtRate 了；这里保留它，用户没动过就照原样提交。
    whtRate: row.whtRate === null ? null : Number(row.whtRate),
    rateReason: row.rateReason,
    payee: {
      payeeId: row.payee.payeeId,
      taxId: row.payee.taxId,
      nameTh: row.payee.nameTh,
      nameEn: row.payee.nameEn,
      addressTh: row.payee.addressTh,
      whtType: row.payee.whtType,
      isActive: row.payee.isActive,
    },
  };
}

/**
 * 把补录的收款方资料套到**所有同税号的行**上。
 *
 * 一张导入表里同一个新供应商常常出现好几行，让人为每一行重填一遍泰文地址既折磨人
 * 又必然填出不一致的版本 —— 而它们最终要合并成主数据里的同一条档案。
 */
export function applyPayeeToRows(
  rows: EditableRow[],
  taxId: string,
  profile: Omit<EditablePayee, "payeeId" | "taxId" | "isActive">,
): EditableRow[] {
  return rows.map((row) =>
    row.payee.taxId === taxId && !row.payee.payeeId
      ? { ...row, payee: { ...row.payee, ...profile } }
      : row,
  );
}
