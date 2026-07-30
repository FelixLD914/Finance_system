"""Export Invoice Excel 与出口报关单 PDF 的配对。

**按内容配，不按文件名配。**

原桌面版（Sample_previous_code/TAX INV/main.py::RecognizeWorker._recognize）本来就是
这么做的：收两个独立的路径列表，两边各自解析，再按解析出来的 C/I No. 撮合。
Web 版把它改成了"同名文件自动成一组"，这是个错误移植——实测把它推翻的证据：

- 真实归档里 34 组"同名 xlsx + pdf"，**34 组的 PDF 都是发票自己的打印件**
  （`3.ZWT：…IV&PL(ZWT-NSB26012304).pdf`），一组报关单都没有。
- 真报关单的文件名毫无规律：`QECL603151144.pdf`、`A0301690110291.pdf`、
  `0409 เจินเวสเทิร์น Rfe92472.pdf`、`ใบขนเจินเวสเทิร์น04.pdf`、
  `DRAFT ENTRY EXPORT-6444202080 R1.PDF`。

所以按文件名配对不是"配不上"，是**100% 配错**：把发票打印件当成报关单喂给识别，
读出来 CDN 空、提交日期空、汇率取不到，还一路静默生成税票。

C/I No. 则两边都稳：实测 140/140 份 IV&PL Excel、22/22 份报关单都能读出来。
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date
from typing import Any, Literal

PairStatus = Literal["ready", "invoice_only", "customs_only", "conflict"]

# 认得出的两种上传物。其它扩展名整份忽略并回报文件名，不静默吞掉。
INVOICE_SUFFIXES = (".xlsx", ".xls")
CUSTOMS_SUFFIXES = (".pdf",)


def classify_file(file_name: str) -> Literal["invoice", "customs"] | None:
    lowered = (file_name or "").lower()
    if lowered.endswith(INVOICE_SUFFIXES):
        return "invoice"
    if lowered.endswith(CUSTOMS_SUFFIXES):
        return "customs"
    return None


def pairing_key(ci_no: str | None) -> str:
    """配对键：C/I No. 去空白、去尾点、大写。

    两边的写法会差一点点——报关单上是 `INV# ZWT-NSB26012304 :23/01/2026`，Excel 上是
    `INV. NO.: ZWT-NSB26012304.`，尾巴上那个句点在 Excel 里很常见。
    """
    return re.sub(r"\s+", "", (ci_no or "")).rstrip(".").upper()


@dataclass
class IdentifiedFile:
    """一份已经识别过身份的上传文件。

    `data` 是完整的识别结果，配对完成后直接拿去导入，不用再解析一遍。
    解析失败的也留在列表里（`error` 非空）——用户要看到"这份文件我读不了"，
    而不是它凭空从清单里消失。
    """

    file_name: str
    kind: Literal["invoice", "customs"]
    key: str = ""
    error: str | None = None
    data: dict[str, Any] = field(default_factory=dict)

    @property
    def readable(self) -> bool:
        return self.error is None


@dataclass
class DualPair:
    """撮合出来的一组。两边任意一边缺失也保留——界面要显示是哪一组没配上。"""

    key: str
    invoice: IdentifiedFile | None = None
    customs: IdentifiedFile | None = None
    #: 同一个 C/I No. 命中多份报关单时，没被选中的那几份（见 choose_customs）。
    superseded_customs: list[IdentifiedFile] = field(default_factory=list)
    #: 撮合阶段发现的、需要人工处理的异常（多份不同报关单等）。
    conflicts: list[str] = field(default_factory=list)

    @property
    def status(self) -> PairStatus:
        if self.conflicts:
            return "conflict"
        if self.invoice and self.customs:
            return "ready"
        return "invoice_only" if self.invoice else "customs_only"


def _declaration_identity(item: IdentifiedFile) -> str:
    """认"是不是同一份报关单"用报关单号，读不到才退回文件名。"""
    return str(item.data.get("cdn") or "") or f"file:{item.file_name}"


def choose_customs(
    candidates: list[IdentifiedFile],
) -> tuple[IdentifiedFile, list[IdentifiedFile], list[str]]:
    """同一个 C/I No. 命中多份报关单时怎么办。

    业务口径（2026-07-30）：**一份发票正常只对应一份报关单。** 所以：

    - 多份文件但**报关单号相同** → 同一份关单被重复上传/重打印了。真实案例：
      `01期/3.NOKIA, PO 4502154203…` 目录下 `0409_1071805218.pdf` 与
      `A0091690101266.pdf` 的 CDN、提交日期完全相同，只是打印日期差了 10 天。
      这种安全，取其中一份即可，其余留痕给界面显示。
    - 报关单号**不同** → 与"一票对一单"的口径冲突（改单？串了单？拿错文件？）。
      不自动选：选错就是拿作废的那版开成了税票，而且金额看着都合理，事后极难发现。
      整组判为 conflict 转人工。

    返回 (选用的那份, 未选用的, 冲突说明)。
    """
    identities = {_declaration_identity(item) for item in candidates}
    # 提交日期最新的排前面；日期读不到的排后面（宁可用读得出日期的那份）。
    ordered = sorted(
        candidates,
        key=lambda item: (
            item.data.get("submission_date") is not None,
            item.data.get("submission_date") or date.min,
            item.file_name,
        ),
        reverse=True,
    )
    if len(identities) > 1:
        numbers = sorted(
            str(item.data.get("cdn") or item.file_name) for item in candidates
        )
        return (
            ordered[0],
            ordered[1:],
            [
                "同一个 C/I No. 配到了多份**不同**的报关单（"
                + "、".join(numbers)
                + "）。一份发票正常只对应一份报关单，请人工确认该用哪一份后，"
                "把多余的从清单里移除。"
            ],
        )
    return ordered[0], ordered[1:], []


def pair_identified_files(
    files: list[IdentifiedFile],
) -> tuple[list[DualPair], list[IdentifiedFile]]:
    """把已识别的文件按 C/I No. 撮合成组。

    返回 (配对结果, 读不出配对键的文件)。后者包括解析失败的、以及解析成功但
    C/I No. 为空的——它们没法参与撮合，但必须回报给用户。
    """
    pairs: dict[str, DualPair] = {}
    unpairable: list[IdentifiedFile] = []
    customs_by_key: dict[str, list[IdentifiedFile]] = {}

    for item in files:
        if not item.readable or not item.key:
            unpairable.append(item)
            continue
        pair = pairs.setdefault(item.key, DualPair(key=item.key))
        if item.kind == "invoice":
            if pair.invoice is None:
                pair.invoice = item
            else:
                # 同一张发票传了两份（改过的和原始的）。不猜，两份都不动，
                # 报给用户自己删掉一份——发票金额不一样时猜错就是开错票。
                unpairable.append(item)
        else:
            customs_by_key.setdefault(item.key, []).append(item)

    for key, candidates in customs_by_key.items():
        pair = pairs.setdefault(key, DualPair(key=key))
        chosen, superseded, conflicts = choose_customs(candidates)
        pair.customs = chosen
        pair.superseded_customs = superseded
        pair.conflicts.extend(conflicts)

    # 排序：要人工处理的排最前（不处理就漏掉了），然后能导的、缺关单的、孤立关单。
    status_order = {"conflict": 0, "ready": 1, "invoice_only": 2, "customs_only": 3}
    ordered = sorted(
        pairs.values(),
        key=lambda pair: (status_order[pair.status], pair.key),
    )
    return ordered, unpairable
