"""一次性：给 TAX INV 模板里两个泰文列头按词加换行，修好逐音节断行。

只在装了 Excel 的开发机上跑（用 COM 存盘，openpyxl 会把三联共用的 PNG 拆三份
把文件撑大）。跑完必须重跑 build_tax_inv_underlay.py 重制底版 + 重生成坐标表。

    cd zwt-finance-system\\backend
    .\\.venv\\Scripts\\python.exe ..\\scripts\\fix_tax_inv_thai_headers.py

改的两个表头（各三联）：
  FX Date  วันที่อัตราแลกเปลี่ยน → วันที่อัตรา / แลกเปลี่ยน
  FX Rate  อัตราแลกเปลี่ยน       → อัตรา / แลกเปลี่ยน
泰文没有词间空格，Excel 按字符宽度断行会切在音节中间（แลกเ|ปลี่ยน、…เปลี่ย|น），
在词边界插一个换行（Chr(10)，单元格本就 wrap_text）让它断得干净。FX Date 那列
(O，宽 11.4) 放不下整个 อัตราแลกเปลี่ยน（末尾 น 会被挤掉），所以断在 วันที่อัตรา /
แลกเปลี่ยน——两行各约 8 字符簇，稳稳落在列宽内（实测过整个 อัตราแลกเปลี่ยน 会溢出）。
这个脚本就是模板这次改动的唯一版本记录（模板不入 git）。
"""

from __future__ import annotations

import sys
from pathlib import Path

TEMPLATE = Path(r"D:\ZWTFinance\data\templates\TAX-INV-Template.xlsx")

# 词边界换行后的新表头（\n = Excel 单元格内换行）。三联各一份，值相同。
FX_DATE = "วันที่อัตรา\nแลกเปลี่ยน"
FX_RATE = "อัตรา\nแลกเปลี่ยน"
EDITS = {
    "O21": FX_DATE,
    "AG21": FX_DATE,
    "AY21": FX_DATE,
    "P21": FX_RATE,
    "AH21": FX_RATE,
    "AZ21": FX_RATE,
}


def main() -> int:
    if not TEMPLATE.is_file():
        print(f"template not found: {TEMPLATE}", file=sys.stderr)
        return 1

    import win32com.client

    excel = win32com.client.DispatchEx("Excel.Application")
    excel.Visible = False
    excel.DisplayAlerts = False
    try:
        workbook = excel.Workbooks.Open(str(TEMPLATE))
        worksheet = workbook.Worksheets("Invoice")
        for coord, value in EDITS.items():
            before = worksheet.Range(coord).Value
            worksheet.Range(coord).Value = value
            worksheet.Range(coord).WrapText = True
            print(f"  {coord}: {before!r} -> {value!r}")
        workbook.Save()
        workbook.Close(SaveChanges=False)
    finally:
        excel.Quit()
    print("done; now re-run build_tax_inv_underlay.py")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
