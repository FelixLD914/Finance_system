import { useState } from "react";
import {
  EyeOutlined,
  FileProtectOutlined,
  FileTextOutlined,
  SafetyCertificateOutlined,
} from "@ant-design/icons";
import { Modal, Segmented, Space, Tag } from "antd";

import type { Translate } from "../../i18n";
import type { SignatureAsset, SignatureUsage } from "../wht/types";

interface SignaturePreviewModalProps {
  signature: SignatureAsset | null;
  open: boolean;
  t: Translate;
  onClose: () => void;
}

const usageColors: Record<SignatureUsage, string> = {
  wht: "cyan",
  tax_inv: "blue",
  salary_advance: "purple",
};

/**
 * 生成默认的演示签名 SVG Data URL (当无法读取服务端真实图片时作为优雅降级)
 */
function createDemoSignatureDataUrl(name: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="120" viewBox="0 0 300 120">
    <rect width="100%" height="100%" fill="none"/>
    <path d="M 30 75 Q 60 20 90 65 T 150 45 T 210 70 T 270 35" stroke="#1d2939" stroke-width="3.5" fill="none" stroke-linecap="round"/>
    <path d="M 45 85 C 80 95, 160 90, 255 80" stroke="#8c6b3e" stroke-width="2" fill="none" stroke-dasharray="4,2"/>
    <text x="150" y="108" font-family="'Cormorant Garamond', 'Noto Serif SC', serif" font-size="16" font-style="italic" font-weight="600" fill="#475467" text-anchor="middle">${name}</text>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export function SignaturePreviewModal({
  signature,
  open,
  t,
  onClose,
}: SignaturePreviewModalProps) {
  const [activeTemplate, setActiveTemplate] = useState<SignatureUsage>("wht");

  if (!signature) return null;

  // 如果 signature 有对应服务端 Content URL，可以直接用；在 Mock/演示环境下使用 Data URL
  const isDemo = import.meta.env.VITE_USE_MOCK_API === "true" || signature.sha256.startsWith("demo");
  const signatureSrc = isDemo
    ? createDemoSignatureDataUrl(signature.name)
    : `/api/v1/wht/signatures/${signature.id}/content`;

  const templateOptions = [
    {
      label: (
        <Space size={4}>
          <FileProtectOutlined />
          <span>WHT 扣缴凭证 (P.N.D.53/3)</span>
        </Space>
      ),
      value: "wht",
    },
    {
      label: (
        <Space size={4}>
          <FileTextOutlined />
          <span>TAX INV 增值税发票</span>
        </Space>
      ),
      value: "tax_inv",
    },
    {
      label: (
        <Space size={4}>
          <SafetyCertificateOutlined />
          <span>工资预支单凭证</span>
        </Space>
      ),
      value: "salary_advance",
    },
  ];

  return (
    <Modal
      centered
      destroyOnClose
      footer={null}
      open={open}
      title={
        <div className="signature-preview-modal-header">
          <div className="title-row">
            <EyeOutlined className="header-icon" />
            <h2>{t("wht.signaturePreviewTitle") || "签名效果预览"}</h2>
            <Tag color={signature.status === "active" ? "green" : "default"}>
              {signature.status === "active" ? t("wht.enabled") : t("wht.disabled")}
            </Tag>
            {signature.isDefault && (
              <Tag color="gold">{t("wht.defaultSignature")}</Tag>
            )}
          </div>
          <p className="subtitle">
            {signature.name} (v{signature.version}) · {signature.originalFileName}
          </p>
        </div>
      }
      width={920}
      onCancel={onClose}
    >
      <div className="signature-preview-container">
        {/* 左侧：导入签名的原始图片信息 */}
        <div className="signature-source-panel">
          <div className="panel-title">
            <EyeOutlined />
            <span>导入的签名图片 (Source Image)</span>
          </div>

          <div className="signature-image-wrapper">
            <img
              alt={signature.name}
              className="source-signature-img"
              src={signatureSrc}
            />
          </div>

          <div className="source-meta-card">
            <div className="meta-item">
              <span className="meta-label">签名名称</span>
              <span className="meta-val">{signature.name}</span>
            </div>
            <div className="meta-item">
              <span className="meta-label">文件名</span>
              <span className="meta-val">{signature.originalFileName}</span>
            </div>
            <div className="meta-item">
              <span className="meta-label">格式类型</span>
              <span className="meta-val">{signature.mimeType || "image/png"}</span>
            </div>
            <div className="meta-item">
              <span className="meta-label">适用范围</span>
              <div className="meta-val tags-val">
                {signature.usage.map((mod) => (
                  <Tag color={usageColors[mod]} key={mod}>
                    {t(`wht.usage.${mod}` as Parameters<typeof t>[0])}
                  </Tag>
                ))}
              </div>
            </div>
            <div className="meta-item">
              <span className="meta-label">更新时间</span>
              <span className="meta-val">
                {new Date(signature.updatedAt).toLocaleString("zh-CN", {
                  hour12: false,
                })}
              </span>
            </div>
          </div>
        </div>

        {/* 右侧：按照不同文件模板显示的签名应用效果 */}
        <div className="signature-template-panel">
          <div className="panel-title">
            <FileProtectOutlined />
            <span>模板盖章效果 (Applied Preview)</span>
          </div>

          <div className="template-toolbar">
            <Segmented
              className="template-segmented"
              options={templateOptions}
              value={activeTemplate}
              onChange={(val) => setActiveTemplate(val as SignatureUsage)}
            />
          </div>

          {/* 模板模拟渲染区域 */}
          <div className="document-template-canvas">
            {activeTemplate === "wht" && (
              <div className="doc-mock wht-doc-mock">
                <div className="doc-watermark">P.N.D.53 / 3</div>
                <div className="doc-header">
                  <div className="gov-badge">หนังสือรับรองการหักภาษี ณ ที่จ่าย</div>
                  <div className="doc-title-th">WITHHOLDING TAX CERTIFICATE (ภ.ง.ด.53)</div>
                  <div className="doc-no-row">
                    <span>BOOK NO: 202607BK1</span>
                    <span>DOC NO: ZWT202607001</span>
                  </div>
                </div>

                <div className="doc-body-fields">
                  <div className="doc-field-row">
                    <span className="lbl">PAYER (ผู้มีหน้าที่หักภาษี):</span>
                    <span className="val">ZWT FINANCE (THAILAND) CO., LTD.</span>
                  </div>
                  <div className="doc-field-row">
                    <span className="lbl">TAX ID (เลขประจำตัวผู้เสียภาษี):</span>
                    <span className="val font-mono">0105562109841</span>
                  </div>
                  <div className="doc-field-row">
                    <span className="lbl">PAYEE (ผู้ถูกหักภาษี):</span>
                    <span className="val">บริษัท จั่วป่าร์รีไซเคิลสหวรุ่งเรือง จำกัด</span>
                  </div>
                  <div className="doc-table-mini">
                    <div className="tr th">
                      <span>INCOME TYPE</span>
                      <span>DATE</span>
                      <span>AMOUNT (THB)</span>
                      <span>TAX (THB)</span>
                    </div>
                    <div className="tr td">
                      <span>ค่าบริการ (Services)</span>
                      <span>2026-07-03</span>
                      <span>150,000.00</span>
                      <span>4,500.00</span>
                    </div>
                  </div>
                </div>

                {/* 签名盖章处 */}
                <div className="doc-signature-block">
                  <div className="seal-ring">
                    <span className="seal-text-top">ZWT FINANCE CO., LTD.</span>
                    <span className="seal-star">★</span>
                    <span className="seal-text-bot">OFFICIAL STAMP</span>
                  </div>
                  <div className="signature-overlay">
                    <img alt="Applied Signature" src={signatureSrc} />
                  </div>
                  <div className="signature-line">
                    <div className="dots">....................................................................</div>
                    <div className="signee-name">({signature.name})</div>
                    <div className="signee-title">Authorized Financial Officer</div>
                  </div>
                </div>
              </div>
            )}

            {activeTemplate === "tax_inv" && (
              <div className="doc-mock tax-inv-doc-mock">
                <div className="doc-watermark">TAX INVOICE</div>
                <div className="doc-header">
                  <div className="company-logo-text">ZWT LOGISTICS & TAX</div>
                  <div className="doc-title-th">ใบกำกับภาษี / TAX INVOICE</div>
                  <div className="doc-no-row">
                    <span>INV NO: INV202607089</span>
                    <span>DATE: 2026-07-15</span>
                  </div>
                </div>

                <div className="doc-body-fields">
                  <div className="doc-field-row">
                    <span className="lbl">CUSTOMER:</span>
                    <span className="val">SIAM LOGISTICS GROUP CO., LTD.</span>
                  </div>
                  <div className="doc-field-row">
                    <span className="lbl">DECLARATION NO:</span>
                    <span className="val font-mono">A019-06907-00381</span>
                  </div>
                  <div className="doc-table-mini">
                    <div className="tr th">
                      <span>ITEM DESCRIPTION</span>
                      <span>FOB THB</span>
                      <span>VAT 7%</span>
                      <span>TOTAL</span>
                    </div>
                    <div className="tr td">
                      <span>EXPORT FREIGHT SERVICES</span>
                      <span>480,000.00</span>
                      <span>33,600.00</span>
                      <span>513,600.00</span>
                    </div>
                  </div>
                </div>

                {/* 签名盖章处 */}
                <div className="doc-signature-block">
                  <div className="seal-ring blue-seal">
                    <span className="seal-text-top">ZWT TAX INVOICE DEPT</span>
                    <span className="seal-star">★</span>
                    <span className="seal-text-bot">APPROVED SEAL</span>
                  </div>
                  <div className="signature-overlay">
                    <img alt="Applied Signature" src={signatureSrc} />
                  </div>
                  <div className="signature-line">
                    <div className="dots">....................................................................</div>
                    <div className="signee-name">({signature.name})</div>
                    <div className="signee-title">Authorized Issuer / 发票签发人</div>
                  </div>
                </div>
              </div>
            )}

            {activeTemplate === "salary_advance" && (
              <div className="doc-mock salary-doc-mock">
                <div className="doc-watermark">SALARY ADVANCE</div>
                <div className="doc-header">
                  <div className="company-logo-text">ZWT HUMAN RESOURCES</div>
                  <div className="doc-title-th">ใบขอเบิกเงินล่วงหน้า / SALARY ADVANCE VOUCHER</div>
                  <div className="doc-no-row">
                    <span>BATCH NO: SA202607-01</span>
                    <span>PERIOD: 202607</span>
                  </div>
                </div>

                <div className="doc-body-fields">
                  <div className="doc-field-row">
                    <span className="lbl">EMPLOYEE NAME:</span>
                    <span className="val">SOMCHAI PRASERT (สมชาย ประเสริฐ)</span>
                  </div>
                  <div className="doc-field-row">
                    <span className="lbl">DEPARTMENT:</span>
                    <span className="val">OPERATIONS / LOGISTICS</span>
                  </div>
                  <div className="doc-field-row">
                    <span className="lbl">ADVANCE AMOUNT:</span>
                    <span className="val font-mono">12,000.00 THB</span>
                  </div>
                </div>

                {/* 签名盖章处 */}
                <div className="doc-signature-block">
                  <div className="seal-ring purple-seal">
                    <span className="seal-text-top">ZWT HR & PAYROLL</span>
                    <span className="seal-star">★</span>
                    <span className="seal-text-bot">VERIFIED</span>
                  </div>
                  <div className="signature-overlay">
                    <img alt="Applied Signature" src={signatureSrc} />
                  </div>
                  <div className="signature-line">
                    <div className="dots">....................................................................</div>
                    <div className="signee-name">({signature.name})</div>
                    <div className="signee-title">Payroll Approver / 工资审批人</div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
